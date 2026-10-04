use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, compile};

fn checked(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(b: Bound) -> Engine {
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn context(args: &[(&str, Value)]) -> Context {
    Context::new("alice", args.iter().map(|(k,v)| (k.to_string(), v.clone())).collect()).at(100)
}
const ROWS: &str = "table messages:\n  photo: image <=1000 ?\n  edited: bool default false\n  at: time default now\n  public\n  insert <- allow\n  update <- allow\n  sync public\n";

#[test]
fn insert_result_is_total_and_predictable() {
    let b = checked(&format!("{ROWS}mutation send():\n  m = insert messages {{}}\n  return {{ photo: m.photo, edited: m.edited, at: m.at }}\n"));
    assert_eq!(b.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    let mut e = engine(b);
    let result = e.mutate("send", Some("send"), context(&[]).with_ids(["message".into()])).unwrap();
    let WriteState::Sent { result, .. } = result.state else { panic!("{result:?}") };
    assert_eq!(result.field("photo"), Ok(&Value::Null));
    assert_eq!(result.field("edited"), Ok(&Value::Bool(false)));
    assert_eq!(result.field("at"), Ok(&Value::Int(100)));
}

#[test]
fn unbound_raw_insert_does_not_reserve_an_unused_result_copy() {
    use snapback4_core::{ir::{Expr, Stmt}, value::object};
    let mut b = checked("table records:\n  payload: text <=10000000\n  optional: bool ?\n  public\n  insert <- allow\nmutation seed():\n  return true\n");
    b.programs[0].program.body = vec![Stmt::Insert {
        table: "records".into(),
        row: Expr::Literal(object([
            ("id", Value::Id("large".into())),
            ("payload", Value::String("x".repeat(10_000_000))),
        ])),
    }];
    let out = engine(b).mutate("seed", None, Context::system().at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}

const REFERENCES: &str = "table conversations:\n  disappearing: enum('off', '24h', '7d') default 'off'\n  read <- exists members[.id, viewer]\n  insert <- allow\ntable members:\n  conversation: conversations\n  principal: principal\n  unique conversation, principal\n  public\n  insert <- allow\ntable messages:\n  conversation: conversations\n  read <- exists members[.conversation, viewer]\n  insert <- allow\nfn ttl(setting: text): 1 if setting = '24h' else 7 if setting = '7d' else 0\n";
#[test]
fn write_rule_follows_one_authorized_reference() {
    checked(&format!("{REFERENCES}table reactions:\n  message: messages\n  principal: principal\n  public\n  insert <- .principal = viewer and exists members[.message.conversation, viewer]\n"));
}
#[test]
fn point_guards_narrow_into_helpers() {
    for body in [
        "require exists conversations[key] else NOT_FOUND\n  return ttl(conversations[key].disappearing)",
        "require conversations[key] != null else NOT_FOUND\n  return ttl(conversations[key].disappearing)",
        "if conversations[key] != null:\n    return ttl(conversations[key].disappearing)\n  return 0",
    ] {
        checked(&format!("{REFERENCES}query run(key: conversations):\n  {body}\n"));
    }
}

fn calibration(reverted: bool, direct_guard: bool) -> Bound {
    let mut source = include_str!("fixtures/qe2/cal30/schema.q").to_string();
    if reverted {
        source = source.replace(".disappearing ?? 'off'", ".disappearing");
        source = source.replace("preview: slice(text, 0, 80)", "preview: 'Photo' if m.photo != null else slice(text, 0, 80)");
        source = source.replace("  read through .message\n  insert <- .principal = viewer\n  update <- .principal = viewer", "  read through .message\n  insert <- .principal = viewer and exists members[.message.conversation, viewer]\n  update <- .principal = viewer and exists members[.message.conversation, viewer]");
    }
    if direct_guard {
        source = source.replace("  ttl = config.disappearingTtl(", "  require exists conversations[conversation] else NOT_FOUND\n  ttl = config.disappearingTtl(");
    }
    compile(&[("schema.q".into(), source), ("config.q".into(), include_str!("fixtures/qe2/cal30/config.q").into()), ("schedule.q".into(), include_str!("fixtures/qe2/cal30/schedule.q").into())])
}
#[test]
fn calibration_original_compiles() {
    let b = calibration(false, false);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}
#[test]
fn calibration_reverted_with_explicit_parent_guard_compiles() {
    let b = calibration(true, true);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}
#[test]
fn calibration_membership_alone_gets_exact_parent_rewrite() {
    let b = calibration(true, false);
    assert_eq!(b.diagnostics.len(), 3, "{:?}", b.diagnostics);
    for d in b.diagnostics {
        assert_eq!(d.code, "E_QUARRY_TYPE");
        assert!(d.rewrite.contains("require exists conversations[conversation] else NOT_FOUND"), "{d:?}");
    }
}

#[test]
fn total_update_and_reference_rules_execute() {
    let mut e = engine(checked(include_str!("fixtures/qe2/rows.q")));
    for (op, args, expected) in [
        ("room", vec![("id", Value::Id("c".into()))], None),
        ("send", vec![("id", Value::Id("m".into())), ("conversation", Value::Id("c".into()))], Some(false)),
        ("patch", vec![("message", Value::Id("m".into()))], Some(true)),
        ("react", vec![("id", Value::Id("r".into())), ("message", Value::Id("m".into()))], None),
        ("editReaction", vec![("id", Value::Id("r".into()))], None),
        ("dropReaction", vec![("id", Value::Id("r".into()))], None),
    ] {
        let out = e.mutate(op, Some(op), context(&args)).unwrap();
        let WriteState::Sent { result, .. } = out.state else { panic!("{op}: {out:?}") };
        if let Some(edited) = expected {
            assert_eq!(result.field("photo"), Ok(&Value::Null));
            assert_eq!(result.field("edited"), Ok(&Value::Bool(edited)));
            assert_eq!(result.field("at"), Ok(&Value::Int(100)));
        }
    }
}

#[test]
fn reference_rule_absent_hidden_expired_and_negated_fail_closed_with_fixed_meter() {
    for rule in [".parent.value = 1", ".parent.value != 2", ".parent.value = null", "not (.parent.value = 1)", "parents[.parent].value = 1"] {
        let source = format!("table parents:\n  owner: principal\n  value: int default 1\n  expires: time ?\n  read <- .owner = viewer\n  expire at .expires\ntable children:\n  parent: parents ?\n  public\n  insert <- {rule}\nmutation add(parent: parents ?):\n  insert children {{ parent }}\n");
        let mut e = engine(checked(&source));
        for (id, owner, expires) in [("hidden", "bob", Value::Null), ("expired", "alice", Value::Int(1))] {
            e.load([("parents".into(), snapback4_core::value::object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("expires", expires), ("value", Value::Int(1))]))]).unwrap();
        }
        let mut meters = Vec::new();
        for parent in [Value::Id("absent".into()), Value::Id("hidden".into()), Value::Id("expired".into()), Value::Null] {
            let out = e.mutate("add", None, context(&[("parent", parent)]).with_ids(["child".into()])).unwrap();
            let WriteState::Failed { why, .. } = out.state else { panic!("{rule}: {out:?}") };
            assert_eq!(why.code, "E_RULE", "{rule}: {why:?}");
            assert_eq!(out.metered.rule_probes, 1);
            meters.push(out.metered.rule_probes);
        }
        assert!(meters.iter().all(|n| *n == meters[0]));
    }
}

#[test]
fn point_facts_do_not_survive_changed_keys_writes_branches_or_loop_iterations() {
    for body in [
        "require exists conversations[key] else NOT_FOUND\n  return ttl(conversations[other].disappearing)",
        "if conversations[key] != null:\n    x = 1\n  return ttl(conversations[key].disappearing)",
        "require exists conversations[key] else NOT_FOUND\n  delete conversations[key]\n  return ttl(conversations[key].disappearing)",
        "require exists conversations[key] else NOT_FOUND\n  remove(key)\n  return ttl(conversations[key].disappearing)",
        "require exists conversations[key] else NOT_FOUND\n  for n in [1, 2]:\n    x = ttl(conversations[key].disappearing)\n    delete conversations[key]",
        "k = key\n  require exists conversations[k] else NOT_FOUND\n  k = other\n  return ttl(conversations[k].disappearing)",
        "require exists conversations[key] else NOT_FOUND\n  ignored = remove(key) if true else false\n  return ttl(conversations[key].disappearing)",
        "require exists conversations[key] and remove(key) else NOT_FOUND\n  return ttl(conversations[key].disappearing)",
        "require exists conversations[key] else NOT_FOUND\n  if true:\n    delete conversations[key]\n  return ttl(conversations[key].disappearing)",
    ] {
        let source = format!("{REFERENCES}fn remove(k: conversations):\n  delete conversations[k]\n  return true\nmutation run(key: conversations, other: conversations):\n  {body}\n");
        let b = compile(&[("schema.q".into(), source.clone())]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "unsafe proof: {source}\n{:?}", b.diagnostics);
    }
}

#[test]
fn calibration_send_replays_successfully_and_emits_preview() {
    for reverted in [false, true] {
        let b = calibration(reverted, reverted);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        // Both forms independently depend on receipt-derived unread maintenance.
        assert_eq!(b.schema.operations["send"].predicts.as_deref(), Some("never"));
        assert!(b.schema.operations["send"].sites.iter().any(|s| s.reason.contains("receipt-derived maintenance unread")));
        let mut e = engine(b);
        for who in ["alice", "bob"] {
            let out = e.mutate("saveProfile", None, Context::new(who, std::collections::BTreeMap::from([
                ("displayName".into(), Value::String(who.into())), ("handle".into(), Value::String(who.into())),
                ("bio".into(), Value::String("".into())), ("location".into(), Value::String("".into())), ("link".into(), Value::Null),
            ])).at(100).with_ids([format!("profile-{who}")])).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        }
        let created = e.mutate("createGroup", Some("group"), context(&[("id", Value::Id("conversation".into())), ("title", Value::String("Room".into())), ("description", Value::String("".into())), ("other", Value::Id("bob".into()))]).with_ids(["member-a".into(), "member-b".into()])).unwrap();
        assert!(matches!(created.state, WriteState::Sent { .. }), "{created:?}");
        let send = context(&[("id", Value::Id("message".into())), ("conversation", Value::Id("conversation".into())), ("text", Value::String("Hello".into())), ("quote", Value::Null)]);
        let out = e.mutate("send", Some("send"), send.clone()).unwrap();
        assert!(matches!(&out.state, WriteState::Sent { result: Value::Id(id), .. } if id == "message"), "{out:?}");
        let replay = e.mutate("send", Some("send"), send).unwrap();
        assert!(replay.replayed);
        let (WriteState::Sent { seq: replay_seq, .. }, WriteState::Sent { seq, .. }) = (&replay.state, &out.state) else { panic!("{replay:?}") };
        assert_eq!(replay_seq, seq);
        let effects = e.effects(None, 10).unwrap();
        assert_eq!(effects.len(), 1, "{effects:?}");
        assert_eq!(effects[0].payload.field("preview"), Ok(&Value::String("Hello".into())));
        let reaction = e.mutate("setReaction", None, context(&[("message", Value::Id("message".into())), ("emoji", Value::String("like".into()))]).with_ids(["reaction".into()])).unwrap();
        assert!(matches!(reaction.state, WriteState::Sent { .. }), "{reaction:?}");
    }
}

#[test]
fn reference_rule_refusals_name_the_known_construct_and_rewrite() {
    let prefix = "table orgs:\n  public\ntable parents:\n  org: orgs\n  value: int\n  owner: principal\n  privateValue: int default 0 written by .owner\n  public\ntable children:\n  parent: parents\n  public\n";
    for (line, repair) in [
        ("insert <- .parent.org.id != null", "orgs[parents[.parent].org].id"),
        ("insert <- .parent.privateValue = 0", "parents[.parent].privateValue"),
        ("after insert <- exists orgs[.parent.org]", "parents[.parent].org"),
    ] {
        let b = compile(&[("schema.q".into(), format!("{prefix}  {line}\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_RULE_HOP" && d.rewrite.contains(repair)), "{line}: {:?}", b.diagnostics);
        assert!(!b.diagnostics.iter().any(|d| d.code == "E_QUARRY_UNKNOWN"));
    }
}

#[test]
fn rule_hops_are_fenced_and_invalid_raw_positions_refuse() {
    use snapback4_core::schema::{self, Constraint, RuleExpr, RuleTerm};
    let b = checked(include_str!("fixtures/qe2/rows.q"));
    assert!(b.schema.required_capabilities().contains("rule-reference"));
    let term = RuleTerm::Reference { table: "messages".into(), column: "message".into(), field: "conversation".into(), old: false };
    let mut schema = b.schema.clone();
    schema.tables.get_mut("reactions").unwrap().rules.read = RuleExpr::Ne(term.clone(), RuleTerm::Literal(Value::Null));
    assert!(schema::validate(&schema).iter().any(|d| d.message.contains("E_QUARRY_RULE_HOP")));
    let mut schema = b.schema;
    schema.tables.get_mut("reactions").unwrap().constraints.push(Constraint::FinalExistsOnInsert { table: "conversations".into(), index: "byId".into(), key: vec![term] });
    assert!(schema::validate(&schema).iter().any(|d| d.message.contains("E_QUARRY_RULE_HOP")));
}

#[test]
fn hidden_reference_and_absence_have_identical_refusal_and_logical_meter() {
    let source = "table parents:\n  owner: principal\n  value: text <=200\n  read <- .owner = viewer\ntable children:\n  parent: parents\n  public\n  insert <- .parent.value != 'no'\nmutation add():\n  insert children { id: 'child', parent: 'parent' }\n";
    let mut answers = Vec::new();
    for value in [None, Some("".to_string()), Some("x".repeat(200))] {
        let mut e = engine(checked(source));
        if let Some(value) = value {
            e.load([("parents".into(), snapback4_core::value::object([("id", Value::Id("parent".into())), ("owner", Value::Id("bob".into())), ("value", Value::String(value))]))]).unwrap();
        }
        let out = e.mutate("add", None, context(&[])).unwrap();
        assert!(matches!(out.state, WriteState::Failed { .. }));
        answers.push((out.state, out.metered));
    }
    assert_eq!(answers[0], answers[1]);
    assert_eq!(answers[0], answers[2]);
}

#[test]
fn reference_rule_prepays_even_a_short_circuited_hop() {
    use snapback4_core::Ceilings;
    for rule in [".parent.value = 1", "false and .parent.value = 1"] {
        let b = checked(&format!("table parents:\n  value: int\n  public\ntable children:\n  parent: parents\n  public\n  insert <- {rule}\nmutation add():\n  insert children {{ id: 'child', parent: 'parent' }}\n"));
        let mut e = engine(b);
        e.set_ceilings(Ceilings { rule_probes: 0, ..Ceilings::default() });
        let out = e.mutate("add", None, context(&[])).unwrap();
        let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
        assert_eq!(why.code, "E_BOUND");
    }
}

#[test]
fn an_optional_column_keeps_its_field_guard_rewrite() {
    let b = compile(&[("schema.q".into(), "table configs:\n  setting: text ?\n  public\nfn label(setting: text): setting\nquery run(key: configs):\n  require exists configs[key] else NOT_FOUND\n  return label(configs[key].setting)\n".into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.rewrite.contains(".setting ! else NOT_FOUND") && !d.rewrite.contains("require exists configs")), "{:?}", b.diagnostics);
}

#[test]
fn point_facts_do_not_cross_job_viewer_authority_edges() {
    let source = format!("{REFERENCES}table people:\n  principal: principal\n  conversation: conversations\n  public\njob digest():\n  for p in people:\n    require exists conversations[p.conversation] else NOT_FOUND\n    as p.principal:\n      result = ttl(conversations[p.conversation].disappearing)\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{:?}", b.diagnostics);
}
