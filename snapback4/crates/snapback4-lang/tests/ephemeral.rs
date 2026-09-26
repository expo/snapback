use snapback4_lang::{Bound, compile};
const TABLES: &str = r#"
table rooms:
  title: text <=80
  public 'rooms'
  insert <- allow
  sync public
table members:
  roomId: rooms
  principal: principal
  unique byRoomPrincipal: roomId, principal
  public 'members'
  sync public
table typing:
  roomId: rooms
  principal: principal
  unique byRoomPrincipal: roomId, principal
  cap 50 by roomId
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer and exists members[.roomId, viewer]
  update <- .principal = viewer and exists members[.roomId, viewer]
  delete <- .principal = viewer
  ephemeral 4s
"#;
const OPS: &str = r#"
mutation setTyping(roomId: rooms):
  upsert typing[roomId, viewer] {}
mutation stopTyping(roomId: rooms):
  delete typing[roomId, viewer]
query typingIn(roomId: rooms):
  return typing where .roomId = roomId and .principal != viewer by .principal { principal }
"#;
fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}
fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn refusal(source: &str, clause: &str, fix: &str) {
    let b = bound(source);
    assert!(
        b.diagnostics.iter().any(|d| d.code == "E_QUARRY_EPHEMERAL"
            && d.message.contains(clause)
            && d.rewrite.contains(fix)),
        "{source}\n{:?}",
        b.diagnostics
    );
}
#[test]
fn declaration_classification_facts_and_emission() {
    let b = clean(&format!("{TABLES}{OPS}"));
    let t = &b.schema.tables["typing"];
    assert_eq!(t.ephemeral.as_ref().unwrap().life_ms, 4000);
    assert!(t.engine_field("$deadline") && t.is_expiring());
    assert_eq!(t.expiry_column(), Some("$deadline"));
    let set = &b.schema.operations["setTyping"];
    assert!(set.ephemeral && set.renews);
    assert_eq!(set.renew_ms, Some(1000));
    assert!(!b.schema.operations["stopTyping"].renews);
    assert_eq!(
        b.schema.operations["typingIn"].ephemeral_reads,
        vec!["typing"]
    );
    assert_eq!(
        b.schema.required_capabilities(),
        ["ephemeral".into()].into()
    );
    let wire = serde_json::to_string(&b.schema).unwrap();
    assert_eq!(
        serde_json::from_str::<snapback4_core::Schema>(&wire).unwrap(),
        b.schema
    );
    assert!(wire.contains("\"renewMs\":1000") && wire.contains("\"ephemeralReads\":[\"typing\"]"));
    let ts = snapback4_lang::emit::typescript(&b);
    assert!(ts.contains("Ephemeral<"));
    assert!(!ts.contains("$deadline"));
    assert!(
        ts.contains(
            "runs: \"server\", predicts: \"never\", ephemeral: true, renews: true, renewMs: 1000"
        ),
        "{ts}"
    );
    assert!(ts.contains("ephemeralReads: [\"typing\"]"));
    assert_eq!(
        snapback4_lang::bind::residency::table_line(&b.schema, "typing"),
        "ephemeral 4s: server memory, never on a device"
    );
    assert!(
        snapback4_lang::bind::residency::operation_lines("setTyping", set)
            .contains("ephemeral, renews")
    );
    assert!(
        b.notes
            .iter()
            .any(|d| d.code == "N_EPHEMERAL_SERVER" && d.rewrite.contains("split"))
    );
}
#[test]
fn life_bounds_and_missing_life() {
    for life in [
        "",
        "500ms",
        "0s",
        "61s",
        "2h",
        "-1s",
        "18446744073709551615d",
    ] {
        refusal(
            &TABLES.replace("4s", life),
            "between 1 second and 60 seconds",
            "ephemeral 4s",
        );
    }
    for life in ["1s", "1m", "1500ms"] {
        clean(&TABLES.replace("4s", life));
    }
}
#[test]
fn forbidden_table_clauses() {
    for (line, clause, fix) in [
        ("sync public", "sync", "delete"),
        ("sync to .principal", "sync", "delete"),
        (
            "sync to members[.roomId] last 10 by byRoomPrincipal",
            "horizon",
            "delete",
        ),
        ("online only", "online only", "delete"),
        (
            "expiresAt: time\n  by byExpiry: expiresAt\n  expire at .expiresAt",
            "expire at",
            "delete",
        ),
        ("ordinal: sequence by roomId", "sequence by", "durable"),
        (
            "body: text <=80\n  by search: roomId, words(body), id",
            "words(..)",
            "durable",
        ),
        ("photo: image <=1000000", "asset", "durable"),
        ("clip: video <=1000000", "asset", "durable"),
        ("photo: image <=1000000 once", "once", "durable"),
    ] {
        refusal(
            &TABLES.replace("ephemeral 4s", &format!("ephemeral 4s\n  {line}")),
            clause,
            fix,
        );
    }
    refusal(
        &TABLES.replace(
            "read <- exists members[.roomId, viewer]",
            "read through .roomId",
        ),
        "through",
        "durable",
    );
}
#[test]
fn no_durable_dependents_or_rule_probes() {
    for table in ["rooms", "typing"] {
        for line in [
            "read <- exists typing['x']",
            "insert <- exists typing['x']",
            "after insert <- exists typing['x']",
        ] {
            let source = TABLES.replace(
                &format!("table {table}:"),
                &format!("table {table}:\n  {line}"),
            );
            // Replace the original read/insert to avoid a duplicate-rule diagnostic obscuring the probe.
            let source = source
                .replace("  public 'rooms'\n", "")
                .replace("  insert <- allow\n", "")
                .replace("  read <- exists members[.roomId, viewer]\n", "")
                .replace(
                    "  insert <- .principal = viewer and exists members[.roomId, viewer]\n",
                    "",
                );
            refusal(&source, "probe ephemeral", "durable");
        }
    }
    refusal(
        &format!("{TABLES}\ntable bad:\n  parent: typing\n"),
        "reference",
        "durable",
    );
    refusal(
        &format!("{TABLES}\nview counts: count typing by roomId\n"),
        "maintain",
        "durable",
    );
    refusal(
        &TABLES.replace("sync public", "sync to typing[.id]"),
        "sync to",
        "durable",
    );
}
#[test]
fn durable_job_action_and_held_reads_refuse() {
    refusal(
        &format!("{TABLES}\nmutation bad():\n  return typing['x']\n"),
        "durable mutation",
        "split",
    );
    refusal(
        &format!(
            "{TABLES}\njob bad():\n  chunk row in typing first 10 by byId:\n    delete typing[row.id]\n"
        ),
        "job",
        "client",
    );
    refusal(
        &format!("{TABLES}\nquery bad() held:\n  return typing['x']\n"),
        "held",
        "split",
    );
}
#[test]
fn mixed_writes_and_emit_refuse_including_inlined_helper() {
    let mixed = "insert rooms { title: 'x' }\n  upsert typing['r', viewer] {}";
    refusal(
        &format!("{TABLES}\nmutation bad():\n  {mixed}\n"),
        "mixed",
        "split",
    );
    refusal(
        &format!(
            "{TABLES}\nfn durable():\n  insert rooms {{ title: 'x' }}\n  return 1\nmutation bad():\n  n = durable()\n  upsert typing['r', viewer] {{}}\n"
        ),
        "mixed",
        "split",
    );
    refusal(
        &format!(
            "{TABLES}\neffect ping\nmutation bad():\n  upsert typing['r', viewer] {{}}\n  emit ping {{}}\n"
        ),
        "emit",
        "durable",
    );
}
#[test]
fn expression_block_effects_cannot_hide_a_mixed_write() {
    use snapback4_core::{Value, ir::*};
    let b = clean(TABLES);
    let p = Program {
        name: "probe".into(),
        kind: ProgramKind::Mutation,
        args: Default::default(),
        read_time_granularity_ms: None,
        returned_shapes: Default::default(),
        native: false,
        body: vec![
            Stmt::Upsert {
                table: "typing".into(),
                key: Expr::Literal(Value::Id("t".into())),
                row: Expr::Object(Default::default()),
            },
            Stmt::Return(Expr::Block {
                body: vec![Stmt::Insert {
                    table: "rooms".into(),
                    row: Expr::Object(Default::default()),
                }],
                value: Box::new(Expr::Literal(Value::Null)),
            }),
        ],
    };
    let mut fact = Default::default();
    assert!(
        snapback4_core::schema::ephemeral::execution(&b.schema, &p, &mut fact)
            .unwrap_err()
            .contains("mixed")
    );
}
#[test]
fn renews_only_with_stable_update_or_upsert_keys() {
    for (body, renews) in [
        ("upsert typing[roomId, viewer] {}", true),
        ("update typing[roomId, viewer] {}", true),
        ("insert typing { roomId, principal: viewer }", false),
        ("delete typing[roomId, viewer]", false),
        (
            "r = rooms[roomId] ! else MISSING\n  upsert typing[r.id, viewer] {}",
            false,
        ),
    ] {
        let b = clean(&format!(
            "{TABLES}\nmutation op(roomId: rooms):\n  {body}\n"
        ));
        assert_eq!(b.schema.operations["op"].renews, renews, "{body}");
    }
}
#[test]
fn changing_ephemeral_tables_is_additive_but_losing_durable_rows_is_destructive() {
    use snapback4_core::successor::{Change, classify};
    let eph = clean(TABLES).schema;
    let durable = clean(&TABLES.replace("  ephemeral 4s\n", "")).schema;
    assert!(
        classify(&durable, &eph)
            .iter()
            .any(|s| s.change == Change::Destructive)
    );
    assert!(
        classify(&eph, &durable)
            .iter()
            .all(|s| s.change == Change::Additive)
    );
    let mut removed = eph.clone();
    removed.tables.remove("typing");
    assert!(
        classify(&eph, &removed)
            .iter()
            .all(|s| s.change == Change::Additive)
    );
}

#[test]
fn following_action_and_schedule_refusals_name_ephemeral_boundary() {
    let source = include_str!("fixtures/following-view.q");
    for table in ["posts", "reposts", "follows"] {
        let header = format!("table {table}:");
        let source = source.replace(&header, &format!("{header}\n  ephemeral 4s"));
        refusal(&source, "Following/feed", "durable");
    }
    refusal(
        &format!("use server\n{TABLES}\naction bad() <- exists typing['x']\n"),
        "action",
        "client",
    );
    refusal(
        &format!("{TABLES}{OPS}\nschedule wrong every 1m: schema.setTyping\n"),
        "schedule",
        "client",
    );
}

#[test]
fn minimum_written_life_sets_renewal_and_helpers_extend_read_closure() {
    let source = format!(
        "{TABLES}\ntable viewing:\n  owner: principal\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  ephemeral 1s\nmutation together(roomId: rooms):\n  upsert typing[roomId, viewer] {{}}\n  upsert viewing[owner = viewer] {{}}\nfn hint(roomId: rooms):\n  return typing[roomId, viewer]\nquery wrapped(roomId: rooms):\n  return hint(roomId)\n"
    );
    let b = clean(&source);
    assert_eq!(b.schema.operations["together"].renew_ms, Some(250));
    // Revision 3 requires exactly one write, even across different tables.
    assert!(!b.schema.operations["together"].renews);
    assert_eq!(
        b.schema.operations["wrapped"].ephemeral_reads,
        vec!["typing"]
    );
}

#[test]
fn renewal_keys_account_for_later_loop_iterations() {
    use snapback4_core::{Value, ir::*};
    let program = Program {
        name: "changingKey".into(),
        kind: ProgramKind::Mutation,
        args: [("key".into(), ArgType::Id)].into(),
        read_time_granularity_ms: None,
        returned_shapes: Default::default(),
        native: false,
        body: vec![
            Stmt::For {
                binding: "i".into(),
                domain: LoopDomain::LiteralRange {
                    start: 0,
                    end_exclusive: 2,
                },
                body: vec![
                    Stmt::Upsert {
                        table: "typing".into(),
                        key: Expr::Variable("key".into()),
                        row: Expr::Object(Default::default()),
                    },
                    Stmt::Assign {
                        name: "key".into(),
                        value: Expr::Input(Input::NewId),
                    },
                ],
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    assert!(!effects::Effects::of(&program).renews);
}

#[test]
fn renewal_keys_do_not_retain_stability_after_write_results_or_divmod_sinks() {
    use snapback4_core::{ir::*, Value};
    let target=Read { table:"typing".into(), index:"byId".into(), key:vec![Expr::Variable("key".into())], site:"probe".into(), provenance:KeyProvenance::Arg };
    for setup in [
        Stmt::WriteTarget { target, patch:Expr::Object(Default::default()), upsert:true, condition:None, result:Some("key".into()) },
        Stmt::Let { name:"q".into(), value:Expr::Builtin { builtin:Builtin::Divmod { remainder_sink:"key".into() }, args:vec![Expr::Input(Input::Now),Expr::Literal(Value::Int(3))] } },
    ] {
        let p=Program { name:"probe".into(),kind:ProgramKind::Mutation,args:[("key".into(),ArgType::Id)].into(),read_time_granularity_ms:None,returned_shapes:Default::default(),native:false,body:vec![setup,Stmt::Upsert {table:"typing".into(),key:Expr::Variable("key".into()),row:Expr::Object(Default::default())}] };
        assert!(!effects::Effects::of(&p).renews);
    }
}

#[test]
fn a_clock_controlled_key_assignment_is_not_a_renewal() {
    let b = clean(&format!("{TABLES}\nmutation signal(roomId: rooms, otherRoom: rooms):\n  key = roomId\n  if now > 1000:\n    key = otherRoom\n  upsert typing[key, viewer] {{}}\n"));
    assert!(b.schema.operations["signal"].ephemeral);
    assert!(!b.schema.operations["signal"].renews);
}

#[test]
fn renewal_requires_one_write_without_read_derived_values_or_a_result() {
    let tables = r#"
table signals:
  owner: principal
  n: int default 0
  enabled: bool default false
  at: time default now
  unique owner
  read <- allow
  insert <- .owner = viewer
  update <- .owner = viewer
  ephemeral 4s
"#;
    for (body, renews) in [
        ("upsert signals[owner = viewer] { n, enabled: true, at: now }", true),
        ("require n > 0 else BAD\n  update signals[owner = viewer] { n }", true),
        ("ok = exists signals[owner = viewer]\n  require ok else MISSING\n  update signals[owner = viewer] { n }", true),
        ("old = signals[owner = viewer] ! else MISSING\n  upsert signals[owner = viewer] { n: old.n + 1 }", false),
        ("old = signals[owner = viewer] ! else MISSING\n  update signals[owner = viewer] { enabled: not old.enabled }", false),
        ("return upsert signals[owner = viewer] { n }", false),
        ("upsert signals[owner = viewer] { n }\n  return n", false),
        ("upsert signals[owner = viewer] { n }\n  upsert signals[owner = viewer] { n }", false),
        ("copy = n\n  upsert signals[owner = viewer] { n: copy }", false),
        ("unused = n\n  upsert signals[owner = viewer] { n }", false),
        ("if n > 0:\n    upsert signals[owner = viewer] { n }", false),
        ("update signals[owner = viewer] { n } if .n = 0", false),
    ] {
        let b = clean(&format!("{tables}\nmutation op(n: int):\n  {body}\n"));
        assert!(b.schema.operations["op"].ephemeral);
        assert_eq!(b.schema.operations["op"].renews, renews, "{body}");
        if renews {
            assert!(snapback4_lang::emit::typescript(&b).contains("Ephemeral<{ n: number }, null>"));
        }
    }
    let card = snapback4_lang::guide::card("ephemeral").unwrap();
    let source = card.split("```quarry\n").nth(1).unwrap().split("```").next().unwrap();
    let b = clean(source);
    for op in ["setTyping", "markViewing"] {
        assert!(b.schema.operations[op].renews, "{op}");
    }
}
