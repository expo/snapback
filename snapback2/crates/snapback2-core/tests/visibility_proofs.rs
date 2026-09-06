use snapback2_core::*;
use std::collections::BTreeMap;

fn id(value: &str) -> Value {
    Value::Id(value.into())
}
fn text(value: &str) -> Value {
    Value::String(value.into())
}
fn row<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Row(
        fields
            .into_iter()
            .map(|(name, value)| (name.into(), value))
            .collect(),
    )
}

fn membership_rule() -> RuleExpr {
    RuleExpr::Exists {
        table: "memberships".into(),
        index: "byConversationPrincipal".into(),
        key: vec![RuleTerm::Field("conversationId".into()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    }
}

fn own_principal(value: RuleTerm) -> RuleExpr {
    RuleExpr::Eq(RuleTerm::Field("principal".into()), value)
}

fn schema(rule: RuleExpr) -> Schema {
    let mut memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("conversationId".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byConversationPrincipal".into(),
                Index {
                    columns: vec!["conversationId".into(), "principal".into()],
                    unique: true,
                },
            ),
            (
                "byPrincipalConversation".into(),
                Index {
                    columns: vec!["principal".into(), "conversationId".into()],
                    unique: false,
                },
            ),
        ]),
    );
    memberships.rules.read = rule;
    memberships.constraints.push(Constraint::Cap {
        by: vec!["principal".into()],
        max: 100,
    });
    let mut conversations = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("title".into(), ColumnType::Text { max: 50 }),
        ]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                columns: vec!["id".into()],
                unique: true,
            },
        )]),
    );
    conversations.rules.read = RuleExpr::Exists {
        table: "memberships".into(),
        index: "byConversationPrincipal".into(),
        key: vec![RuleTerm::Field("id".into()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("conversations".into(), conversations),
        ]),
        ..Schema::default()
    }
}

fn scan() -> Scan {
    Scan {
        site: "members.list".into(),
        table: "memberships".into(),
        index: "byPrincipalConversation".into(),
        prefix: vec![Expr::Input(Input::Viewer)],
        take: Bound::Literal(100),
        order: Order::Asc,
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Viewer,
    }
}

fn program(body: Vec<Stmt>) -> Program {
    Program {
        name: "members.list".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        body,
        read_time_granularity_ms: None,
        result_page_site: None,
    }
}

fn page(scan: Scan) -> Program {
    program(vec![Stmt::Return(Expr::Scan(scan))])
}

fn certificate(schema: &Schema, program: &Program) -> Certificate {
    Checker::new(schema, Ceilings::default())
        .check_all(program)
        .unwrap()
}

fn assert_visibility(schema: &Schema, scan: Scan, uniform: bool, decided: bool) {
    let p = page(scan.clone());
    let cert = certificate(schema, &p);
    assert_eq!(cert.read_sites[0].hoist, uniform);
    let site = serde_json::to_value(&cert.read_sites[0]).unwrap();
    assert_eq!(site["decided_true"].as_bool().unwrap_or(false), decided);
    if decided {
        assert_eq!(cert.max_rule_probes, 0);
    }
    assert_eq!(
        cert.completeness,
        if uniform {
            Completeness::Page
        } else {
            Completeness::Capped
        }
    );
    let count = program(vec![Stmt::Return(Expr::Builtin {
        builtin: Builtin::Len,
        args: vec![Expr::Scan(scan)],
    })]);
    let result = Checker::new(schema, Ceilings::default()).check_all(&count);
    if uniform {
        result.unwrap();
    } else {
        assert!(
            result
                .unwrap_err()
                .iter()
                .any(|e| e.code == "E_STRUCTURAL_COUNT")
        );
    }
}

#[test]
fn membership_self_probe_is_decided_true_only_over_own_rows() {
    let schema = schema(membership_rule());
    assert_visibility(&schema, scan(), true, true);
    let mut other = scan();
    other.prefix = vec![Expr::Literal(id("bob"))];
    assert_visibility(&schema, other, false, false);
    let mut by_conversation = scan();
    by_conversation.index = "byConversationPrincipal".into();
    by_conversation.prefix = vec![Expr::Literal(id("c1"))];
    assert_visibility(&schema, by_conversation, true, false);
}

#[test]
fn decided_true_without_hoist_still_checks_hidden_candidates() {
    let schema = schema(membership_rule());
    let mut other = scan();
    other.prefix = vec![Expr::Literal(id("bob"))];
    let p = page(other);
    let mut cert = certificate(&schema, &p);
    assert!(!cert.read_sites[0].hoist);
    assert!(cert.read_sites[0].rule_probes_per_candidate > 0);
    cert.read_sites[0].decided_true = true;
    let result = seeded(&schema)
        .execute(
            &p,
            &cert,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(result.result, Value::Array(vec![]));
    assert_eq!(result.trace.rule_probes, 1);
}

#[test]
fn uniform_undecided_membership_scan_evaluates_one_verdict() {
    let schema = schema(membership_rule());
    let mut by_conversation = scan();
    by_conversation.index = "byConversationPrincipal".into();
    by_conversation.prefix = vec![Expr::Literal(id("c1"))];
    let p = page(by_conversation);
    let cert = certificate(&schema, &p);
    assert!(cert.read_sites[0].hoist);
    assert!(!cert.read_sites[0].decided_true);
    assert!(cert.read_sites[0].rule_probes_per_candidate > 0);
    let mut engine = seeded(&schema);
    for (viewer, expected, probes) in [
        ("bob", vec![], 1),
        (
            "alice",
            vec![row([
                ("id", id("m1")),
                ("conversationId", id("c1")),
                ("principal", id("alice")),
            ])],
            2,
        ),
    ] {
        let result = engine
            .execute(
                &p,
                &cert,
                Context::query(Actor::user(viewer).unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert_eq!(result.state, ExecutionState::Complete);
        assert_eq!(result.result, Value::Array(expected));
        // A hit also meters the matched membership's self-referential read policy.
        assert_eq!(result.trace.rule_probes, probes);
    }
}

#[test]
fn self_probe_accepts_own_fields_and_matching_literal_pins() {
    let mut rule = membership_rule();
    let RuleExpr::Exists { key, .. } = &mut rule else {
        unreachable!()
    };
    key[1] = RuleTerm::Field("principal".into());
    let mut whole = scan();
    whole.prefix.clear();
    assert_visibility(&schema(rule.clone()), whole, true, true);
    let RuleExpr::Exists { key, .. } = &mut rule else {
        unreachable!()
    };
    key[1] = RuleTerm::Literal(id("alice"));
    let mut literal = scan();
    literal.prefix = vec![Expr::Literal(id("alice"))];
    assert_visibility(&schema(rule.clone()), literal, true, true);
    assert_visibility(&schema(rule), scan(), false, false);
}

#[test]
fn self_probe_requires_full_unique_nonnullable_own_key() {
    let mut nonunique = schema(membership_rule());
    nonunique
        .tables
        .get_mut("memberships")
        .unwrap()
        .indexes
        .get_mut("byConversationPrincipal")
        .unwrap()
        .unique = false;
    assert_visibility(&nonunique, scan(), false, false);
    let mut optional = schema(membership_rule());
    optional
        .tables
        .get_mut("memberships")
        .unwrap()
        .columns
        .insert(
            "conversationId".into(),
            ColumnType::Optional(Box::new(ColumnType::Id)),
        );
    assert_visibility(&optional, scan(), false, false);
    let mut rule = membership_rule();
    let RuleExpr::Exists { key, .. } = &mut rule else {
        unreachable!()
    };
    key.pop();
    assert_visibility(&schema(rule), scan(), false, false);
    let mut rule = membership_rule();
    let RuleExpr::Exists { key, .. } = &mut rule else {
        unreachable!()
    };
    key[0] = RuleTerm::Field("id".into());
    assert_visibility(&schema(rule), scan(), false, false);
}

#[test]
fn a_probe_of_another_table_is_not_a_self_proof() {
    let mut schema = schema(membership_rule());
    let mut other = schema.tables["memberships"].clone();
    other.rules.read = RuleExpr::Allow;
    schema.tables.insert("other".into(), other);
    let RuleExpr::Exists { table, .. } =
        &mut schema.tables.get_mut("memberships").unwrap().rules.read
    else {
        unreachable!()
    };
    *table = "other".into();
    assert_visibility(&schema, scan(), false, false);
}

#[test]
fn or_with_own_principal_or_self_probe_decides_but_conversation_prefix_does_not() {
    let schema = schema(RuleExpr::Or(vec![
        own_principal(RuleTerm::Viewer),
        membership_rule(),
    ]));
    assert_visibility(&schema, scan(), true, true);
    let mut other = scan();
    other.index = "byConversationPrincipal".into();
    other.prefix = vec![Expr::Literal(id("c1"))];
    assert_visibility(&schema, other, false, false);
}

#[test]
fn or_requires_a_true_arm_not_merely_one_pinned_arm() {
    let varies = RuleExpr::Eq(
        RuleTerm::Field("conversationId".into()),
        RuleTerm::Literal(id("c1")),
    );
    assert_visibility(
        &schema(RuleExpr::Or(vec![
            own_principal(RuleTerm::Viewer),
            varies.clone(),
        ])),
        scan(),
        true,
        true,
    );
    let wrong = own_principal(RuleTerm::Literal(id("bob")));
    assert_visibility(
        &schema(RuleExpr::Or(vec![wrong.clone(), varies.clone()])),
        scan(),
        false,
        false,
    );
    let mut literal = scan();
    literal.prefix = vec![Expr::Literal(id("bob"))];
    assert_visibility(
        &schema(RuleExpr::Or(vec![wrong, varies.clone()])),
        literal,
        true,
        true,
    );
    let mut pinned = scan();
    pinned.prefix = vec![Expr::Literal(id("bob")), Expr::Literal(id("c2"))];
    assert_visibility(
        &schema(RuleExpr::Or(vec![own_principal(RuleTerm::Viewer), varies])),
        pinned,
        true,
        false,
    );
}

#[test]
fn or_public_allow_and_self_probe_arms_decide_in_either_order() {
    let varies = RuleExpr::Eq(
        RuleTerm::Field("conversationId".into()),
        RuleTerm::Literal(id("c1")),
    );
    for truth in [
        RuleExpr::Public {
            reason: "test".into(),
        },
        RuleExpr::Allow,
        membership_rule(),
    ] {
        for rules in [
            vec![truth.clone(), varies.clone()],
            vec![varies.clone(), truth.clone()],
        ] {
            assert_visibility(&schema(RuleExpr::Or(rules)), scan(), true, true);
        }
    }
}

#[test]
fn negation_and_conjunction_do_not_borrow_a_true_arm() {
    let varies = RuleExpr::Eq(
        RuleTerm::Field("conversationId".into()),
        RuleTerm::Literal(id("c1")),
    );
    assert_visibility(
        &schema(RuleExpr::Not(Box::new(membership_rule()))),
        scan(),
        false,
        false,
    );
    assert_visibility(
        &schema(RuleExpr::And(vec![membership_rule(), varies])),
        scan(),
        false,
        false,
    );
}

#[test]
fn a_viewer_provenance_label_does_not_turn_an_argument_into_the_viewer() {
    let schema = schema(membership_rule());
    let mut scan = scan();
    scan.prefix = vec![Expr::Variable("owner".into())];
    let mut p = page(scan);
    p.args.insert("owner".into(), ArgType::Principal);
    let cert = certificate(&schema, &p);
    assert!(!cert.read_sites[0].hoist);
    assert_eq!(cert.completeness, Completeness::Capped);
}

#[test]
fn frozen_visibility_pages_and_merge_execute_against_the_engine() {
    for bytes in [
        include_str!("../../../corpus/self-probe-enriched-membership-page.json"),
        include_str!("../../../corpus/self-probe-enriched-membership-merge.json"),
        include_str!("../../../corpus/decided-or-enriched-membership-page.json"),
        include_str!("../../../corpus/decided-or-unheld-other-arm.json"),
    ] {
        let case: serde_json::Value = serde_json::from_str(bytes).unwrap();
        let schema: Schema = serde_json::from_value(case["schema"].clone()).unwrap();
        let p: Program = serde_json::from_value(case["program"].clone()).unwrap();
        let cert = certificate(&schema, &p);
        let mut engine = Engine::memory(schema).unwrap();
        for row in case["receipt"]["rows"].as_array().unwrap() {
            engine
                .seed(
                    row["table"].as_str().unwrap(),
                    serde_json::from_value(row["row"].clone()).unwrap(),
                )
                .unwrap();
        }
        let result = engine
            .execute(
                &p,
                &cert,
                Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert_eq!(result.state, ExecutionState::Complete, "{}", case["name"]);
        assert_eq!(
            serde_json::to_value(result.result).unwrap(),
            case["expected"]["localResult"]
        );
    }
}

fn fanout(take: u32) -> Program {
    let mut scan = scan();
    scan.take = Bound::Literal(take);
    let mut p = program(vec![
        Stmt::For {
            binding: "seat".into(),
            domain: LoopDomain::Page(scan),
            body: vec![Stmt::Insert {
                table: "conversations".into(),
                row: Expr::Object(BTreeMap::from([
                    ("id".into(), Expr::Input(Input::NewId)),
                    ("title".into(), Expr::Literal(text("hello"))),
                ])),
            }],
        },
        Stmt::Return(Expr::Literal(Value::Bool(true))),
    ]);
    p.kind = ProgramKind::Mutation;
    p
}

#[test]
fn decided_fanout_still_needs_the_covering_cap() {
    for rule in [
        membership_rule(),
        RuleExpr::Or(vec![own_principal(RuleTerm::Viewer), membership_rule()]),
    ] {
        let schema = schema(rule);
        let cert = certificate(&schema, &fanout(100));
        assert!(cert.read_sites[0].complete);
        assert_eq!(cert.max_rule_probes, 0);
        let errors = Checker::new(&schema, Ceilings::default())
            .check_all(&fanout(50))
            .unwrap_err();
        assert!(
            errors
                .iter()
                .any(|e| e.code == "E_STRUCTURAL_FANOUT" && e.message.contains("below cap 100"))
        );
    }
}

fn seeded(schema: &Schema) -> Engine {
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for (member, conversation, principal) in [("m1", "c1", "alice"), ("m2", "c2", "bob")] {
        engine
            .seed(
                "memberships",
                row([
                    ("id", id(member)),
                    ("conversationId", id(conversation)),
                    ("principal", id(principal)),
                ]),
            )
            .unwrap();
        engine
            .seed(
                "conversations",
                row([("id", id(conversation)), ("title", text(conversation))]),
            )
            .unwrap();
    }
    engine
}

#[test]
fn decided_scan_executes_with_zero_probes_and_never_rewrites_point_policy() {
    let schema = schema(membership_rule());
    let p = page(scan());
    let cert = certificate(&schema, &p);
    let mut engine = seeded(&schema);
    let context = || Context::query(Actor::user("alice").unwrap(), BTreeMap::new());
    let result = engine.execute(&p, &cert, context()).unwrap();
    assert_eq!(result.state, ExecutionState::Complete);
    assert_eq!(result.trace.rule_probes, 0);
    assert_eq!(
        result.result,
        Value::Array(vec![row([
            ("id", id("m1")),
            ("conversationId", id("c1")),
            ("principal", id("alice"))
        ])])
    );
    let point = program(vec![Stmt::Return(Expr::Get(Read {
        site: "conversation.point".into(),
        table: "conversations".into(),
        index: "byId".into(),
        key: vec![Expr::Literal(id("c1"))],
        provenance: KeyProvenance::Const,
    }))]);
    let point_cert = certificate(&schema, &point);
    assert_eq!(point_cert.max_rule_probes, 2);
    let case: serde_json::Value = serde_json::from_str(include_str!(
        "../../../corpus/self-probe-enriched-membership-page.json"
    ))
    .unwrap();
    let enriched: Program = serde_json::from_value(case["program"].clone()).unwrap();
    let enriched_cert = certificate(&schema, &enriched);
    let conversation_site = enriched_cert
        .read_sites
        .iter()
        .find(|site| site.site == "conversation.point")
        .unwrap();
    assert!(!conversation_site.hoist && !conversation_site.decided_true);
    let enriched_before = engine
        .execute(&enriched, &enriched_cert, context())
        .unwrap();
    assert_eq!(enriched_before.state, ExecutionState::Complete);
    assert_eq!(
        enriched_before.result,
        Value::Array(vec![row([
            ("id", id("m1")),
            ("conversation", row([("title", text("c1"))]))
        ])])
    );
    assert_eq!(enriched_before.trace.rule_probes, 2);
    assert_ne!(
        engine
            .execute(&point, &point_cert, context())
            .unwrap()
            .result,
        Value::Null
    );
    let mut revoke = program(vec![
        Stmt::Delete {
            table: "memberships".into(),
            key: Expr::Literal(id("m1")),
        },
        Stmt::Return(Expr::Literal(Value::Bool(true))),
    ]);
    revoke.kind = ProgramKind::Mutation;
    let revoke_cert = certificate(&schema, &revoke);
    assert!(matches!(
        engine
            .execute(&revoke, &revoke_cert, context())
            .unwrap()
            .state,
        ExecutionState::Committed { .. }
    ));
    assert_eq!(
        engine
            .execute(&point, &point_cert, context())
            .unwrap()
            .result,
        Value::Null
    );
    assert_eq!(
        engine.execute(&p, &cert, context()).unwrap().result,
        Value::Array(vec![])
    );
    let enriched_after = engine
        .execute(&enriched, &enriched_cert, context())
        .unwrap();
    assert_eq!(enriched_after.result, Value::Array(vec![]));
    assert_eq!(enriched_after.state, ExecutionState::Complete);
    assert!(!conversation_site.decided_true);
}

#[test]
fn decided_fanout_executes_within_its_certificate() {
    let schema = schema(membership_rule());
    let p = fanout(100);
    let cert = certificate(&schema, &p);
    let mut engine = seeded(&schema);
    let mut context = Context::query(Actor::user("alice").unwrap(), BTreeMap::new());
    context.new_ids.push_back("new-conversation".into());
    let result = engine.execute(&p, &cert, context).unwrap();
    assert!(
        matches!(result.state, ExecutionState::Committed { .. }),
        "{:?}",
        result.state
    );
    assert_eq!(result.trace.rule_probes, 0);
    assert_eq!(engine.rows("conversations").unwrap().len(), 3);
}
