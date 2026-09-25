use snapback4_core::{Context, Engine, Value, WriteState, value::object};
const SOURCE: &str = include_str!("fixtures/row-keyed-view.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn ctx(args: &[(&str, Value)], now: i64) -> Context {
    Context::new(
        "alice",
        args.iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
fn write(e: &mut Engine, name: &str, args: &[(&str, Value)]) {
    let result = e.mutate(name, None, ctx(args, 1)).unwrap();
    assert!(
        matches!(result.state, WriteState::Sent { .. }),
        "{name}: {result:?}"
    );
}
fn count(e: &mut Engine, member: &str, expected: i64) {
    let r = e
        .query("unreadFor", ctx(&[("member", id(member))], 1))
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(expected), "{member}: {r:?}");
}
fn join(e: &mut Engine, member: &str, principal: &str, mark: i64, joined: i64) {
    write(
        e,
        "join",
        &[
            ("id", id(member)),
            ("conversationId", id("c")),
            ("principal", id(principal)),
            ("readUpTo", Value::Int(mark)),
            ("joinedAt", Value::Int(joined)),
        ],
    );
}
// Private fixture members must be established by a reader of the new image.
fn join_as_owner(e: &mut Engine, member: &str, principal: &str, mark: i64, joined: i64) {
    let args = [("id", id(member)), ("conversationId", id("c")),
        ("principal", id(principal)), ("readUpTo", Value::Int(mark)),
        ("joinedAt", Value::Int(joined))];
    let result = e.mutate("join", None, Context::new(principal,
        args.into_iter().map(|(k,v)|(k.into(),v)).collect()).at(1)).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
}
fn send(e: &mut Engine, name: &str, n: i64, who: &str, until: Value) {
    write(
        e,
        "send",
        &[
            ("id", id(name)),
            ("conversationId", id("c")),
            ("ordinal", Value::Int(n)),
            ("senderId", id(who)),
            ("until", until),
        ],
    );
}
#[test]
fn parse_bind_and_explain() {
    let b = bound(SOURCE);
    let m = &b.schema.maintains[0];
    let k = m.row_key.as_ref().unwrap();
    assert_eq!(k.table, "members");
    assert_eq!(k.fanout, 100);
    assert!(snapback4_lang::guide::explain_code("E_VIEW_KEY").is_some());
    assert!(
        b.schema.tables["messages"]
            .indexes
            .contains_key(&k.range_index("ordinal"))
    );
}
#[test]
fn rejected_shapes_have_rewrites() {
    let good = ".conversationId = m.conversationId and .ordinal > m.readUpTo\n    and .senderId != m.principal and not .tombstone and .ordinal > m.joinedAt";
    for bad in [
        ".ordinal > m.readUpTo",
        ".conversationId = m.conversationId and .conversationId = m.conversationId",
        ".conversationId != m.conversationId",
        ".conversationId = m.conversationId or .ordinal > m.readUpTo",
        ".conversationId = m.conversationId and m.readUpTo > 0",
        ".conversationId = m.conversationId and .ordinal > m.readUpTo + 1",
        ".conversationId = m.conversationId and exists members[.conversationId, viewer]",
        ".conversationId = m.conversationId and .senderId = viewer",
        ".conversationId = m.conversationId and not (.ordinal > m.readUpTo)",
    ] {
        let b = snapback4_lang::compile(&[("bad.q".into(), SOURCE.replace(good, bad))]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY"
                && d.rewrite.contains("view unread:")
                && d.guide == "maintains"),
            "{bad}: {:?}",
            b.diagnostics
        );
    }
}
fn lifecycle(mut e: Engine) {
    join(&mut e, "a", "alice", 0, 0);
    join(&mut e, "b", "bob", 2, 0);
    join(&mut e, "c", "carol", 0, 2);
    for n in 1..=4 {
        send(&mut e, &format!("m{n}"), n, "alice", Value::Null);
    }
    count(&mut e, "a", 0);
    count(&mut e, "b", 2);
    count(&mut e, "c", 2);
    send(&mut e, "other", 4, "bob", Value::Null);
    count(&mut e, "a", 1);
    count(&mut e, "b", 2);
    count(&mut e, "c", 3);
    write(&mut e, "tombstone", &[("message", id("m3"))]);
    count(&mut e, "b", 1);
    count(&mut e, "c", 2);
    write(
        &mut e,
        "edit",
        &[
            ("message", id("m2")),
            ("ordinal", Value::Int(5)),
            ("senderId", id("carol")),
        ],
    );
    count(&mut e, "a", 2);
    count(&mut e, "b", 2);
    count(&mut e, "c", 2);
    write(&mut e, "remove", &[("message", id("m4"))]);
    count(&mut e, "b", 1);
    count(&mut e, "c", 1);
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(5))],
    );
    count(&mut e, "b", 0);
    send(&mut e, "exp", 6, "alice", Value::Int(10));
    count(&mut e, "b", 1);
    let live = e
        .query("unreadFor", ctx(&[("member", id("b"))], 11))
        .unwrap();
    assert!(live.complete);
    assert_eq!(live.data, Value::Int(0));
    assert_eq!(e.sweep_expired(11, 100).unwrap(), 1);
    count(&mut e, "b", 0);
    write(&mut e, "leave", &[("member", id("c"))]);
    assert!(
        e.store()
            .rows("unread")
            .unwrap()
            .iter()
            .all(|v| v.field("member") != Ok(&id("c")))
    );
}
#[test]
fn lifecycle_memory() {
    let b = bound(SOURCE);
    lifecycle(Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap());
}
#[test]
fn lifecycle_sqlite() {
    let b = bound(SOURCE);
    let dir = std::env::temp_dir().join(format!("b3-lifecycle-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let _ = std::fs::remove_file(&path);
    lifecycle(
        Engine::new(
            snapback4_core::Store::open(&path).unwrap(),
            b.schema,
            b.programs.into_iter().map(|p| p.program),
        )
        .unwrap(),
    );
    let _ = std::fs::remove_file(path);
}
#[test]
fn large_mark_commits_pending_then_settles() {
    let b = bound(SOURCE);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    count(&mut e, "b", 10000);
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(10000))],
    );
    let r = e
        .query("unreadFor", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert!(!r.complete, "{r:?}");
    let mut chunks = 0;
    while let Some(m) = e.run_view_chunk(1).unwrap() {
        chunks += 1;
        assert!(m.examined <= 260, "{m:?}");
        assert!(chunks < 50);
    }
    assert!(chunks >= 40);
    count(&mut e, "b", 0);
}

#[test]
fn small_mark_uses_the_changed_range_in_a_large_chat() {
    let source = SOURCE.replace("  expire at .until\n", "");
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 9998, 0);
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    count(&mut e, "b", 2);
    let r = e
        .mutate(
            "mark",
            None,
            ctx(&[("member", id("b")), ("readUpTo", Value::Int(9999))], 1),
        )
        .unwrap();
    assert!(matches!(r.state, WriteState::Sent { .. }), "{r:?}");
    assert!(r.metered.examined < 1050, "{r:?}"); // Includes the fixed 1,024-row private scan reservation.
    count(&mut e, "b", 1);
    assert!(e.run_view_chunk(1).unwrap().is_none());
}
#[test]
fn recount_survives_restart_and_concurrent_changes_on_both_sides_of_cursor() {
    let source = SOURCE.replace("  expire at .until\n", "");
    let b = bound(&source);
    let dir = std::env::temp_dir().join(format!("b3-restart-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let _ = std::fs::remove_file(&path);
    let mut e = Engine::new(
        snapback4_core::Store::open(&path).unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(5000))],
    );
    e.run_view_chunk(1).unwrap().unwrap();
    drop(e);
    let mut e = Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
    write(
        &mut e,
        "edit",
        &[
            ("message", id("m00001")),
            ("ordinal", Value::Int(6000)),
            ("senderId", id("alice")),
        ],
    );
    write(&mut e, "tombstone", &[("message", id("m09000"))]);
    send(&mut e, "a-before-cursor", 7000, "alice", Value::Null);
    send(&mut e, "z-after-cursor", 8000, "alice", Value::Null);
    write(&mut e, "remove", &[("message", id("m08000"))]);
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 5001);
    // Replacing a mark while pending cancels its partial prefix, in the same transaction.
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(0))],
    );
    e.run_view_chunk(1).unwrap();
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(10000))],
    );
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 0);
    drop(e);
    let _ = std::fs::remove_dir_all(dir);
}
#[test]
fn unread_inherits_member_authority_and_expiry_timer() {
    let source=SOURCE.replacen("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal",1);
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join_as_owner(&mut e, "b", "bob", 0, 0);
    send(&mut e, "m1", 1, "alice", Value::Int(10));
    let r = e
        .query(
            "unreadFor",
            Context::new("bob", [("member".into(), id("b"))].into()).at(1),
        )
        .unwrap();
    assert!(r.complete);
    assert_eq!(r.data, Value::Int(1));
    assert_eq!(r.next_expiry, Some(10));
    let hidden = e
        .query("unreadFor", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert_eq!(hidden.data, Value::Int(0));
}
#[test]
fn live_cap_ignores_unswept_expired_members() {
    let source = SOURCE.replace(
        "  cap 100 by conversationId",
        "  cap 1 by conversationId\n  expires: time default 10\n  expire at .expires",
    );
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "a", "alice", 0, 0);
    e.seed([(
        "members".into(),
        object([
            ("id", id("b")),
            ("conversationId", id("c")),
            ("principal", id("bob")),
            ("readUpTo", Value::Int(0)),
            ("joinedAt", Value::Int(0)),
            ("expires", Value::Int(100)),
        ]),
    )])
    .unwrap();
    let result = e
        .mutate(
            "send",
            None,
            ctx(
                &[
                    ("id", id("m")),
                    ("conversationId", id("c")),
                    ("ordinal", Value::Int(1)),
                    ("senderId", id("alice")),
                    ("until", Value::Null),
                ],
                11,
            ),
        )
        .unwrap();
    assert!(
        matches!(result.state, WriteState::Sent { .. }),
        "{result:?}"
    );
    let r = e
        .query("unreadFor", ctx(&[("member", id("b"))], 11))
        .unwrap();
    assert_eq!(r.data, Value::Int(1));
    assert_eq!(r.next_expiry, Some(100));
}

#[test]
fn existence_with_expiring_sources_and_raw_metadata_refusals() {
    let b = bound(
        &(SOURCE.to_owned()
            + "\nquery existsUnread(member: members):\n  return exists unread[member = member]\n"),
    );
    let mut e =
        Engine::memory(b.schema.clone(), b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    send(&mut e, "m", 1, "alice", Value::Int(10));
    let r = e
        .query("existsUnread", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert_eq!(r.data, Value::Bool(true));
    for kind in 0..5 {
        let mut s = b.schema.clone();
        match kind {
            0 => {
                s.maintains[0].row_key.as_mut().unwrap().predicate =
                    snapback4_core::maintain::Predicate::Bool(true)
            }
            1 => s.maintains[0].row_key.as_mut().unwrap().fanout = 100000,
            2 => {
                s.tables.get_mut("unread").unwrap().rules.read =
                    snapback4_core::schema::RuleExpr::Deny;
            }
            3 => {
                s.tables
                    .get_mut("unread")
                    .unwrap()
                    .columns
                    .remove("recountPending");
            }
            _ => {
                s.tables
                    .get_mut("members")
                    .unwrap()
                    .columns
                    .insert("value".into(), snapback4_core::schema::ColumnType::Int);
            }
        }
        assert!(
            snapback4_core::schema::validate(&s)
                .iter()
                .any(|i| i.message.contains("E_VIEW_KEY")),
            "raw mutation {kind}"
        );
    }
}

#[test]
fn emitted_work_and_chunked_deletes_maintain_all_members() {
    let b = bound(
        &(SOURCE.to_owned()
            + "\neffect deleted\njob cleanup():\n  for msg in messages:\n    emit deleted { message: msg.id }\n    delete messages[msg.id]\n"),
    );
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    join(&mut e, "c", "carol", 0, 0);
    for n in 1..=5 {
        send(&mut e, &format!("m{n}"), n, "alice", Value::Null);
    }
    let run = e.run_job("cleanup", Default::default(), 1).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done);
    count(&mut e, "b", 0);
    count(&mut e, "c", 0);
}
#[test]
fn row_key_requires_same_parent_and_bounded_recipients() {
    for source in [
        SOURCE.replace("  cap 100 by conversationId\n", ""),
        SOURCE.replacen("conversationId: conversations", "conversationId: id", 1),
        SOURCE.replace(
            "conversationId: conversations",
            "conversationId: conversations ?",
        ),
        SOURCE.replace(
            "count messages by members m",
            "sum messages of .ordinal by members m",
        ),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.code == "E_VIEW_KEY" && !d.rewrite.is_empty()),
            "{:?}",
            b.diagnostics
        );
    }
}

#[test]
fn member_expiry_ends_existence_and_rule_authority_before_sweep() {
    let source = SOURCE.replace(
        "  cap 100 by conversationId",
        "  cap 100 by conversationId\n  until: time default 10\n  expire at .until",
    ) + "\nquery viewExists(member: members):\n  return exists unread[member = member]\ntable secrets:\n  member: members\n  read <- exists unread[member = .member]\nquery secrets():\n  return secrets first 10\n";
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed([(
        "secrets".into(),
        object([("id", id("secret")), ("member", id("b"))]),
    )])
    .unwrap();
    let before = e
        .query("viewExists", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert_eq!(before.data, Value::Bool(true));
    assert_eq!(before.next_expiry, Some(10));
    assert_eq!(
        e.query("viewExists", ctx(&[("member", id("b"))], 11))
            .unwrap()
            .data,
        Value::Bool(false)
    );
    assert_eq!(
        e.query("secrets", ctx(&[], 11)).unwrap().data,
        Value::Array(vec![])
    );
}

#[test]
fn defaulted_member_fields_are_materialized_in_durable_recounts() {
    let final_source = SOURCE
        .replace("  expire at .until\n", "")
        .replace("readUpTo: int default 0", "readUpTo: int default 5000");
    let start = final_source.find("view unread:").unwrap();
    let before = final_source[..start].replace("  readUpTo: int default 5000\n", "");
    let b = bound(&before);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([(
        "members".into(),
        object([
            ("id", id("b")),
            ("conversationId", id("c")),
            ("principal", id("bob")),
            ("joinedAt", Value::Int(0)),
        ]),
    )])
    .unwrap();
    e.seed((1..=10000).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Null),
            ]),
        )
    }))
    .unwrap();
    let b = bound(&final_source);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 1)
        .unwrap();
    assert!(
        !e.query("unreadFor", ctx(&[("member", id("b"))], 1))
            .unwrap()
            .complete
    );
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 5000);
    assert!(
        e.store().rows("unread").unwrap()[0]
            .field("readUpTo")
            .is_err()
    );
}

#[test]
fn incomplete_counts_cannot_authorize_writes_or_numeric_probes() {
    let source = SOURCE.to_owned()
        + "\nmutation depend(member: members):\n  n = unread[member]\n  update members[member] { readUpTo: n }\nquery valueExists(member: members):\n  return exists unread[member = member, value = 1200]\n";
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed_at((1..=1200).map(|n| {
        (
            "messages".into(),
            object([
                ("id", id(&format!("m{n:05}"))),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(n)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Int(10000)),
            ]),
        )
    }), 1)
    .unwrap();
    let settled = e
        .query("unreadFor", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert!(settled.complete, "{settled:?}");
    assert_eq!(settled.data, Value::Int(1200));
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(1200))],
    );
    let r = e
        .query("valueExists", ctx(&[("member", id("b"))], 1))
        .unwrap();
    assert!(!r.complete, "{r:?}"); // A query's scalar existence result carries the same pending fact.
    let r = e.mutate("depend", None, ctx(&[("member", id("b"))], 1));
    let outcome = r.unwrap();
    let WriteState::Failed { why, .. } = outcome.state else {
        panic!("{outcome:?}")
    };
    assert_eq!(why.code, "E_VIEW_KEY");
    assert_eq!(why.guide.as_deref(), Some("maintains"));
    assert!(why.rewrite.is_some());
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 0);
}

#[test]
fn counts_cannot_be_indexed_for_rules_or_ranking() {
    for extra in [
        "\ntable secrets:\n  read <- exists unread[value = 1]\n",
        "\nquery ranked():\n  return unread last 1 by .value\n",
    ] {
        let b = snapback4_lang::compile(&[(
            "schema.q".into(),
            SOURCE.replace("  expire at .until\n", "") + extra,
        )]);
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.code == "E_VIEW_KEY" && d.rewrite.contains("view unread:")),
            "{:?}",
            b.diagnostics
        );
    }
}

fn private_members(source: &str) -> String {
    source.replacen("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal", 1)
}
fn message_row(name: &str, parent: &str, n: i64) -> Value {
    object([
        ("id", id(name)),
        ("conversationId", id(parent)),
        ("ordinal", Value::Int(n)),
        ("senderId", id("alice")),
        ("tombstone", Value::Bool(false)),
        ("until", Value::Null),
    ])
}
#[test]
fn hidden_marks_have_identical_meters_bounds_and_changes() {
    for bounded in [false, true] {
        let mut worlds = Vec::new();
        for mark in [0, 10] {
            let b = bound(&private_members(SOURCE));
            let mut e =
                Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            join_as_owner(&mut e, "b", "bob", mark, 0);
            let from = e.seq().unwrap();
            if bounded {
                e.set_ceilings(snapback4_core::Ceilings {
                    rows_written: 1,
                    ..Default::default()
                });
            }
            let out = e
                .mutate(
                    "send",
                    None,
                    ctx(
                        &[
                            ("id", id("probe")),
                            ("conversationId", id("c")),
                            ("ordinal", Value::Int(5)),
                            ("senderId", id("alice")),
                            ("until", Value::Null),
                        ],
                        1,
                    ),
                )
                .unwrap();
            if bounded {
                assert!(
                    matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_BOUND")
                );
                assert!(e.store().rows("messages").unwrap().is_empty());
            } else {
                assert!(matches!(&out.state, WriteState::Sent { .. }));
                assert!(out.tables.contains(&"unread".into()));
                assert!(out.metered.rows_written > 1);
            }
            worlds.push(serde_json::to_vec(&(out, e.changes(from, 100).unwrap())).unwrap());
        }
        assert_eq!(worlds[0], worlds[1], "bounded={bounded}");
    }
}

#[test]
fn blind_member_marks_have_identical_meters_bounds_and_changes() {
    for writes in [0, 1023] {
        let mut worlds = Vec::new();
        for mark in [0, 10] {
            let source = private_members(SOURCE) + &format!(
                "\ntable publicRows:\n  n: int\n  read <- allow\n  update <- allow\nmutation blind(member: members):\n{}  update members[member] {{ readUpTo: 10 }}\n",
                "  update publicRows['p'] { n: 1 }\n".repeat(writes));
            let b = bound(&source);
            let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            join_as_owner(&mut e, "b", "bob", mark, 0);
            e.seed([("publicRows".into(), object([("id", id("p")), ("n", Value::Int(0))]))]).unwrap();
            for n in 1..=5 { send(&mut e, &format!("m{n}"), n, "alice", Value::Null); }
            let from = e.seq().unwrap();
            let out = e.mutate("blind", None, ctx(&[("member", id("b"))], 1)).unwrap();
            if writes == 0 {
                assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_VIEW_KEY"), "{out:?}");
            } else {
                assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"), "{out:?}");
            }
            assert_eq!(e.seq().unwrap(), from);
            assert_eq!(e.store().rows("members").unwrap()[0].field("readUpTo"), Ok(&Value::Int(mark)));
            assert_eq!(e.store().rows("publicRows").unwrap()[0].field("n"), Ok(&Value::Int(0)));
            assert!(e.run_view_chunk(1).unwrap().is_none());
            worlds.push(serde_json::to_vec(&(out, e.changes(from, 100).unwrap())).unwrap());
        }
        assert_eq!(worlds[0], worlds[1], "prior writes={writes}");
    }
}

#[test]
fn parent_reference_comparison_keeps_parent_scan_and_residual() {
    let source = SOURCE.replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  excludedConversation: conversations default 'other'")
        .replace("and not .tombstone", "and not .tombstone and .conversationId != m.excludedConversation")
        + "\nmutation exclude(member: members, conversation: conversations):\n  update members[member] { excludedConversation: conversation }\n";
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    send(&mut e, "m1", 1, "alice", Value::Null);
    count(&mut e, "b", 1);
    for (parent, expected) in [("c", 0), ("other", 1)] {
        write(&mut e, "exclude", &[("member", id("b")), ("conversation", id(parent))]);
        count(&mut e, "b", expected);
    }
}

#[test]
fn comparison_boundaries_exclude_or_include_the_exact_mark() {
    for op in ["<", "<=", ">", ">=", "=", "!="] {
        let b = bound(&SOURCE.replace(".ordinal > m.readUpTo", &format!(".ordinal {op} m.readUpTo")));
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        join(&mut e, "b", "bob", 2, 0);
        for n in 1..=3 { send(&mut e, &format!("m{n}"), n, "alice", Value::Null); }
        for mark in [2, 3, 1, 2] {
            write(&mut e, "mark", &[("member", id("b")), ("readUpTo", Value::Int(mark))]);
            let expected = (1..=3).filter(|&n| match op {
                "<" => n < mark, "<=" => n <= mark, ">" => n > mark,
                ">=" => n >= mark, "=" => n == mark, _ => n != mark,
            }).count() as i64;
            count(&mut e, "b", expected);
        }
    }
}

#[test]
fn settled_expiring_counts_use_only_the_expired_subset() {
    for size in [1200, 10000] {
        let b = bound(&(SOURCE.to_owned() + "\nmutation useCount(member: members):\n  n = unread[member]\n  return n\n"));
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        join(&mut e, "b", "bob", 0, 0);
        e.seed_at((1..=size).map(|n| {
            let mut row = message_row(&format!("m{n:05}"), "c", n).as_object().unwrap().clone();
            row.insert("until".into(), if n % 2 == 0 || size == 10000 && n > 1 { Value::Int(10) } else { Value::Null });
            ("messages".into(), Value::Row(row.into()))
        }), 1).unwrap();
        count(&mut e, "b", size);
        let out = e.mutate("useCount", None, ctx(&[("member", id("b"))], 1)).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        assert!(matches!(&out.state, WriteState::Sent { result, .. } if result == &Value::Int(size)));
        assert!(out.metered.examined < 20, "{out:?}");
        let remaining = if size == 10000 { 1 } else { size / 2 };
        let expired = e.query("unreadFor", ctx(&[("member", id("b"))], 10)).unwrap();
        assert_eq!(expired.complete, size == 1200, "{expired:?}");
        assert!(expired.metered.examined < 20, "subtraction leaked its population: {expired:?}");
        assert!(expired.metered.steps < 100, "subtraction leaked its work: {expired:?}");
        assert_eq!(expired.data, Value::Int(if expired.complete { remaining } else { 0 }));
        let out = e.mutate("useCount", None, ctx(&[("member", id("b"))], 10)).unwrap();
        if size == 10000 {
            assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_VIEW_KEY"), "{out:?}");
        } else {
            assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        }
        while e.sweep_expired(10, 100).unwrap() > 0 {}
        let swept = e.query("unreadFor", ctx(&[("member", id("b"))], 10)).unwrap();
        assert!(swept.complete, "{swept:?}");
        assert_eq!(swept.data, Value::Int(remaining));
        let out = e.mutate("useCount", None, ctx(&[("member", id("b"))], 10)).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        assert!(out.metered.examined < 20, "{out:?}");
    }
}
#[test]
fn expired_private_member_catchup_deletes_view_before_sweep() {
    let source = private_members(SOURCE).replace(
        "  cap 100 by conversationId",
        "  cap 100 by conversationId\n  until: time default 10\n  expire at .until",
    );
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join_as_owner(&mut e, "b", "bob", 0, 0);
    let from = e.seq().unwrap();
    send(&mut e, "m1", 1, "alice", Value::Null);
    assert!(
        e.stream_at("bob", from, 100, 9)
            .unwrap()
            .events
            .iter()
            .any(|v| v.table == "unread" && v.kind == "put")
    );
    let page = e.stream_at("bob", from, 100, 11).unwrap();
    assert!(
        page.events
            .iter()
            .any(|v| v.table == "unread" && v.kind == "del" && v.data.is_none())
    );
    assert!(
        !page
            .events
            .iter()
            .any(|v| v.table == "unread" && v.data.is_some())
    );
    assert_eq!(e.store().rows("members").unwrap().len(), 1, "still unswept");
}
#[test]
fn expired_unswept_recipients_do_not_consume_the_live_cap_scan() {
    let source = SOURCE.replace(
        "  cap 100 by conversationId",
        "  cap 100 by conversationId\n  expiresAt: time ?\n  expire at .expiresAt",
    );
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "live-null", "bob", 0, 0);
    e.seed_at(
        [(
            "members".into(),
            object([
                ("id", id("live-future")),
                ("conversationId", id("c")),
                ("principal", id("carol")),
                ("readUpTo", Value::Int(0)),
                ("joinedAt", Value::Int(0)),
                ("expiresAt", Value::Int(100)),
            ]),
        )],
        1,
    )
    .unwrap();
    // Install an unswept backlog through the store: no O(n²) fixture cap checks.
    // Expired rows need no view values; the assertion measures source-event selection.
    let table = e.schema().tables["members"].clone();
    let tx = e.store_mut().transaction().unwrap();
    for n in 0..9000 {
        let row = object([
            ("id", id(&format!("expired{n:05}"))),
            ("conversationId", id("c")),
            ("principal", id(&format!("p{n}"))),
            ("readUpTo", Value::Int(0)),
            ("joinedAt", Value::Int(0)),
            ("expiresAt", Value::Int(0)),
        ]);
        tx.put("members", &table, &row, None).unwrap();
    }
    tx.commit().unwrap();
    let out = e
        .mutate(
            "send",
            None,
            ctx(
                &[
                    ("id", id("probe")),
                    ("conversationId", id("c")),
                    ("ordinal", Value::Int(5)),
                    ("senderId", id("alice")),
                    ("until", Value::Null),
                ],
                1,
            ),
        )
        .unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    assert!(out.metered.examined < 1000, "{out:?}");
    count(&mut e, "live-null", 1);
    count(&mut e, "live-future", 1);
}
#[test]
fn moving_source_between_two_parents_updates_both_groups() {
    let b = bound(
        &(SOURCE.replace("  expire at .until\n", "")
            + "\nmutation move(message: messages, conversationId: conversations):\n  update messages[message] { conversationId }\n"),
    );
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    write(
        &mut e,
        "join",
        &[
            ("id", id("other")),
            ("conversationId", id("other-parent")),
            ("principal", id("bob")),
            ("readUpTo", Value::Int(0)),
            ("joinedAt", Value::Int(0)),
        ],
    );
    send(&mut e, "message", 1, "alice", Value::Null);
    count(&mut e, "b", 1);
    count(&mut e, "other", 0);
    write(
        &mut e,
        "move",
        &[
            ("message", id("message")),
            ("conversationId", id("other-parent")),
        ],
    );
    count(&mut e, "b", 0);
    count(&mut e, "other", 1);
}
#[test]
fn tombstoning_exact_recount_cursor_removes_its_already_counted_contribution() {
    let b = bound(&SOURCE.replace("  expire at .until\n", ""));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed((1..=10000).map(|n| ("messages".into(), message_row(&format!("m{n:05}"), "c", n))))
        .unwrap();
    // The changed interval is small by default; lower this writer's remaining
    // examined allowance to exercise the specified pending cursor boundary.
    e.set_ceilings(snapback4_core::Ceilings {
        examined: 80,
        ..Default::default()
    });
    write(
        &mut e,
        "mark",
        &[("member", id("b")), ("readUpTo", Value::Int(100))],
    );
    e.set_ceilings(Default::default());
    assert!(e.run_view_chunk(1).unwrap().is_some());
    assert_eq!(
        e.store().rows("$recount:unread").unwrap()[0].field("cursor"),
        Ok(&id("m00256"))
    );
    write(&mut e, "tombstone", &[("message", id("m00256"))]);
    while e.run_view_chunk(1).unwrap().is_some() {}
    count(&mut e, "b", 9899);
}
#[test]
fn oversized_recount_parks_without_starving_another_member() {
    let source = SOURCE.replace("  expire at .until\n", "").replace(
        "  ordinal: int",
        "  payload: text <=20000000 default ''\n  ordinal: int",
    ) + "\nmutation shrink(message: messages):\n  update messages[message] { payload: 'small' }\n";
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    join(&mut e, "a-stuck", "bob", 0, 0);
    write(
        &mut e,
        "join",
        &[
            ("id", id("b-ready")),
            ("conversationId", id("other")),
            ("principal", id("bob")),
            ("readUpTo", Value::Int(0)),
            ("joinedAt", Value::Int(0)),
        ],
    );
    let mut huge = message_row("huge", "c", 1).as_object().unwrap().clone();
    huge.insert("payload".into(), Value::String("x".repeat(17 << 20)));
    e.seed(
        std::iter::once(("messages".into(), Value::Row(huge.into()))).chain((1..=1100).map(|n| {
            (
                "messages".into(),
                message_row(&format!("m{n:05}"), "other", n),
            )
        })),
    )
    .unwrap();
    write(
        &mut e,
        "mark",
        &[("member", id("a-stuck")), ("readUpTo", Value::Int(1))],
    );
    write(
        &mut e,
        "mark",
        &[("member", id("b-ready")), ("readUpTo", Value::Int(1100))],
    );
    let mut chunks = 0;
    while e.run_view_chunk(1).unwrap().is_some() {
        chunks += 1;
        assert!(chunks < 20);
    }
    count(&mut e, "b-ready", 0);
    let work = e.store().rows("$recount:unread").unwrap();
    assert_eq!(work.len(), 1);
    assert_eq!(work[0].field("id"), Ok(&id("a-stuck")));
    assert_eq!(work[0].field("parked"), Ok(&Value::Bool(true)));
    assert_eq!(work[0].field("cursor"), Ok(&Value::Null));
    // The declared payload width needs the system's repair allowance for this edit.
    e.set_ceilings(snapback4_core::Ceilings::unbounded());
    write(&mut e, "shrink", &[("message", id("huge"))]);
    e.set_ceilings(Default::default());
    assert!(e.run_view_chunk(1).unwrap().is_some());
    assert!(e.run_view_chunk(1).unwrap().is_none());
    count(&mut e, "a-stuck", 0);
    assert!(e.store().rows("$recount:unread").unwrap().is_empty());
}

#[test]
fn parent_moves_recount_the_new_domain_and_clear_the_pending_fallback() {
    let source = SOURCE.replace("  expire at .until\n", "") + "\nmutation moveMember(member: members, parent: conversations):\n  update members[member] { conversationId: parent }\n";
    for size in [2, 1200] {
        for old_size in [1, 2, 5] {
            let b = bound(&source);
            let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
            join(&mut e, "b", "bob", 0, 0);
            let rows = [("c", old_size), ("d", size)].into_iter().flat_map(|(parent, size)| {
                (1..=size).map(move |n| ("messages".into(), message_row(&format!("{parent}{n:05}"), parent, n)))
            });
            e.seed_at(rows, 1).unwrap();
            count(&mut e, "b", old_size);
            let from = e.seq().unwrap();
            write(&mut e, "moveMember", &[("member", id("b")), ("parent", id("d"))]);
            let r = e.query("unreadFor", ctx(&[("member", id("b"))], 1)).unwrap();
            assert_eq!(r.data, Value::Int(if size == 2 {2} else {0}), "{r:?}");
            assert_eq!(r.complete, size == 2);
            let wire = e.stream_at("alice", from, 100, 1).unwrap();
            let image = wire.events.iter().find(|e|e.table == "unread" && e.kind == "put").unwrap().data.as_ref().unwrap();
            assert_eq!(image.field("value").unwrap(), &r.data);
            while e.run_view_chunk(1).unwrap().is_some() {}
            count(&mut e, "b", size);
            write(&mut e, "moveMember", &[("member", id("b")), ("parent", id("c"))]);
            count(&mut e, "b", old_size);
        }
    }
}

#[test]
fn completed_expiry_correction_has_one_constant_public_meter_charge() {
    let mut observations = Vec::new();
    for expired in [0, 3, 30] {
        let b = bound(SOURCE);
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
        join(&mut e, "b", "bob", 0, 0);
        let mut rows = vec![("messages".into(), message_row("live", "c", 1))];
        for n in 0..expired {
            let mut row = message_row(&format!("expired{n}"), "c", 1).as_object().unwrap().clone();
            row.insert("until".into(), Value::Int(10));
            rows.push(("messages".into(), Value::Row(row.into())));
        }
        e.seed_at(rows, 1).unwrap();
        let r = e.query("unreadFor", ctx(&[("member", id("b"))], 10)).unwrap();
        assert_eq!(r.data, Value::Int(1));
        assert!(r.complete);
        assert!(r.metered.examined < 20 && r.metered.steps < 100, "{r:?}");
        observations.push(serde_json::to_value(r).unwrap());
    }
    assert_eq!(observations[0], observations[1]);
    assert_eq!(observations[0], observations[2]);
}

#[test]
fn pending_expiring_count_never_bypasses_the_live_correction() {
    let b = bound(SOURCE);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    join(&mut e, "b", "bob", 0, 0);
    e.seed_at((0..1200).map(|n| {
        let mut row = message_row(&format!("expired{n:05}"), "c", 5).as_object().unwrap().clone();
        row.insert("until".into(),Value::Int(10));
        ("messages".into(),Value::Row(row.into()))
    }), 1).unwrap();
    let before = e.query("unreadFor",ctx(&[("member",id("b"))],10)).unwrap();
    assert!(before.complete);
    assert_eq!(before.data,Value::Int(0));
    let from = e.seq().unwrap();
    let out = e.mutate("mark",None,ctx(&[("member",id("b")),("readUpTo",Value::Int(6))],10)).unwrap();
    assert!(matches!(out.state,WriteState::Sent {..}));
    let pending = e.query("unreadFor",ctx(&[("member",id("b"))],10)).unwrap();
    assert!(!pending.complete);
    assert_eq!(pending.data,Value::Int(0));
    let stream = e.stream_at("alice",from,100,10).unwrap();
    for event in stream.events.iter().filter(|e|e.table == "unread" && e.kind == "put") {
        assert_eq!(event.data.as_ref().unwrap().field("value").unwrap(),&Value::Int(0));
    }
    while e.run_view_chunk(10).unwrap().is_some() {}
    assert_eq!(e.query("unreadFor",ctx(&[("member",id("b"))],10)).unwrap().data,Value::Int(0));
}
