//! Membership-gated range certificate bounds, shared with the evaluator twin.
use super::*;

pub(super) fn add_visibility_cases(cases: &mut Vec<CorpusCase>) {
    for (name, field, hoist, examined) in [
        ("hoisted-list-certifies-reserve", "conversationId", true, 52),
        (
            "nonuniform-list-certifies-ceiling",
            "authorId",
            false,
            10_240,
        ),
    ] {
        let mut schema = Schema::default();
        schema.tables.insert(
            "memberships".to_owned(),
            public_table(
                columns([
                    ("id", ColumnType::Id),
                    ("conversationId", ColumnType::Id),
                    ("viewer", ColumnType::Principal),
                ]),
                indexes([
                    ("byId", &["id"], true),
                    ("byConvViewer", &["conversationId", "viewer"], true),
                ]),
            ),
        );
        let mut messages = public_table(
            columns([
                ("id", ColumnType::Id),
                ("conversationId", ColumnType::Id),
                ("authorId", ColumnType::Id),
                ("at", ColumnType::Time),
            ]),
            indexes([
                ("byId", &["id"], true),
                ("byConvTime", &["conversationId", "at", "id"], false),
            ]),
        );
        messages.rules.read = RuleExpr::Exists {
            table: "memberships".to_owned(),
            index: "byConvViewer".to_owned(),
            key: vec![RuleTerm::Field(field.to_owned()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
        };
        schema.tables.insert("messages".to_owned(), messages);
        let program = pure_program(
            name,
            Expr::Scan(Scan {
                site: "messages.list".to_owned(),
                table: "messages".to_owned(),
                index: "byConvTime".to_owned(),
                prefix: vec![Expr::Literal(id("c1"))],
                order: Order::Desc,
                take: Bound::Literal(50),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }),
            &BTreeMap::new(),
        );
        let case = case_from_parts(
            name,
            "scenario",
            schema,
            program,
            query_context([]),
            ClosureReceipt::default(),
            Vec::new(),
            None,
            None,
        );
        let certificate = case.certificate.as_ref().expect("visibility certificate");
        assert_eq!(certificate.max_examined, examined, "{name}");
        assert_eq!(certificate.max_index_entries, examined, "{name}");
        assert_eq!(certificate.read_sites[0].hoist, hoist, "{name}");
        assert_eq!(certificate.max_rule_probes, if hoist { 1 } else { 10_240 });
        assert_eq!(certificate.max_steps, if hoist { 263 } else { 51_203 });
        cases.push(case);
    }
    add_membership_pages(cases);
}

fn add_membership_pages(cases: &mut Vec<CorpusCase>) {
    for (name, merge, disjunction) in [
        ("self-probe-enriched-membership-page", false, false),
        ("self-probe-enriched-membership-merge", true, false),
        ("decided-or-enriched-membership-page", false, true),
        ("decided-or-unheld-other-arm", false, true),
    ] {
        let mut schema = membership_schema();
        if disjunction {
            // This first arm varies by row, but the second arm decides true.
            schema.tables.get_mut("memberships").unwrap().rules.read = RuleExpr::Or(vec![
                RuleExpr::Eq(
                    RuleTerm::Field("conversationId".into()),
                    RuleTerm::Literal(id("c0")),
                ),
                RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer),
            ]);
        }
        let mut program = membership_page(name, merge);
        if name == "decided-or-unheld-other-arm" {
            let mut grants = public_table(
                columns([("id", ColumnType::Id)]),
                indexes([("byId", &["id"], true)]),
            );
            grants.rules.read = RuleExpr::Deny;
            schema.tables.insert("grants".into(), grants);
            schema.tables.get_mut("memberships").unwrap().rules.read = RuleExpr::Or(vec![
                RuleExpr::Exists {
                    table: "grants".into(),
                    index: "byId".into(),
                    key: vec![RuleTerm::Field("conversationId".into())],
                    provenance: KeyProvenance::Shape,
                },
                RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer),
            ]);
            // No verdict for the first arm is held or needed: the prefix proves the second.
            let Stmt::For {
                domain: LoopDomain::Page(scan),
                ..
            } = &program.body[1]
            else {
                unreachable!()
            };
            program.body = vec![Stmt::Return(Expr::Scan(scan.clone()))];
        }
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for (n, viewer) in [(1, "u1"), (2, "u1"), (3, "other")] {
            let conversation = format!("c{n}");
            engine
                .seed(
                    "memberships",
                    row([
                        ("id", id(format!("m{n}"))),
                        ("conversationId", id(&conversation)),
                        ("principal", id(viewer)),
                    ]),
                )
                .unwrap();
            engine
                .seed(
                    "conversations",
                    row([("id", id(&conversation)), ("title", text(&conversation))]),
                )
                .unwrap();
            engine
                .seed(
                    "words",
                    row([
                        ("id", id(format!("w{n}"))),
                        ("conversationId", id(&conversation)),
                        ("term", text("hello")),
                        ("at", Value::Int(n)),
                    ]),
                )
                .unwrap();
        }
        let context = query_context([]);
        let execution = authoritative(&mut engine, &schema, &program, context.clone());
        assert_eq!(execution.state, ExecutionState::Complete, "{name}");
        assert_eq!(execution.result.as_array().unwrap().len(), 2);
        let expected = execution.result.clone();
        let case = case_from_parts(
            name,
            "visibility",
            schema,
            program,
            context,
            execution.receipt,
            Vec::new(),
            None,
            None,
        );
        assert_eq!(
            case.expected.local_result.as_ref(),
            Some(&expected),
            "{name}"
        );
        assert_eq!(case.expected.local_state, "fresh", "{name}");
        let site = case
            .certificate
            .as_ref()
            .unwrap()
            .read_sites
            .iter()
            .find(|s| s.site == "members.page")
            .unwrap();
        assert!(site.decided_true && site.hoist);
        assert_eq!(site.rule_probes_per_candidate, 0);
        cases.push(case);
    }
}

fn membership_schema() -> Schema {
    let rule = |field: &str| RuleExpr::Exists {
        table: "memberships".into(),
        index: "byConversationPrincipal".into(),
        key: vec![RuleTerm::Field(field.into()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let mut memberships = public_table(
        columns([
            ("id", ColumnType::Id),
            ("conversationId", ColumnType::Id),
            ("principal", ColumnType::Principal),
        ]),
        indexes([
            ("byId", &["id"], true),
            (
                "byConversationPrincipal",
                &["conversationId", "principal"],
                true,
            ),
            (
                "byPrincipalConversation",
                &["principal", "conversationId"],
                false,
            ),
        ]),
    );
    memberships.rules.read = rule("conversationId");
    memberships.constraints.push(Constraint::Cap {
        by: vec!["principal".into()],
        max: 100,
    });
    let mut conversations = public_table(
        columns([
            ("id", ColumnType::Id),
            ("title", ColumnType::Text { max: 50 }),
        ]),
        indexes([("byId", &["id"], true)]),
    );
    conversations.rules.read = rule("id");
    let mut words = public_table(
        columns([
            ("id", ColumnType::Id),
            ("conversationId", ColumnType::Id),
            ("term", ColumnType::Text { max: 64 }),
            ("at", ColumnType::Time),
        ]),
        indexes([
            ("byId", &["id"], true),
            (
                "byConversationTermTime",
                &["conversationId", "term", "at", "id"],
                false,
            ),
        ]),
    );
    words.rules.read = rule("conversationId");
    Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("conversations".into(), conversations),
            ("words".into(), words),
        ]),
        ..Schema::default()
    }
}

fn membership_page(name: &str, merge: bool) -> Program {
    let own = Scan {
        site: "members.page".into(),
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
    };
    let mut body = vec![Stmt::Let {
        name: "result".into(),
        value: Expr::Array(vec![]),
    }];
    let domain = if merge {
        let lane = Scan {
            site: "words.lane".into(),
            table: "words".into(),
            index: "byConversationTermTime".into(),
            prefix: vec![
                member_field("seat", "conversationId"),
                Expr::Literal(text("hello")),
            ],
            take: Bound::Literal(20),
            order: Order::Asc,
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: Some("words.merge".into()),
            provenance: KeyProvenance::Shape,
        };
        // L10's lazy k-way merge: the membership page is the discovery source and each
        // seat's words lane is merged by the heap; the page is then iterated as a bounded
        // derived collection, as the compiler lowers `for entry in merge …`.
        body.push(Stmt::Let {
            name: "merged".into(),
            value: Expr::Merge(Merge {
                site: "words.merge".into(),
                lanes: vec![MergeLane {
                    setup: Vec::new(),
                    scan: lane,
                    source: Some(own),
                    binding: "seat".into(),
                }],
            }),
        });
        LoopDomain::DerivedArray {
            value: var("merged"),
            max: 20,
            bound_source: "merge words take 20".into(),
        }
    } else {
        LoopDomain::Page(own)
    };
    body.push(Stmt::For {
        binding: "entry".into(),
        domain,
        body: vec![
            Stmt::Const {
                name: "conversation".into(),
                value: Expr::Get(Read {
                    site: "conversation.point".into(),
                    table: "conversations".into(),
                    index: "byId".into(),
                    key: vec![member_field("entry", "conversationId")],
                    provenance: KeyProvenance::Shape,
                }),
            },
            // Quarry's nullable nested shape: this local assignment refused under the old proof.
            Stmt::Let {
                name: "shape".into(),
                value: Expr::Literal(Value::Null),
            },
            Stmt::If {
                condition: Expr::Binary {
                    op: BinaryOp::Ne,
                    left: Box::new(var("conversation")),
                    right: Box::new(Expr::Literal(Value::Null)),
                },
                then_body: vec![Stmt::Assign {
                    name: "shape".into(),
                    value: Expr::Object(BTreeMap::from([(
                        "title".into(),
                        member_field("conversation", "title"),
                    )])),
                }],
                else_body: vec![],
            },
            Stmt::Push {
                target: "result".into(),
                value: Expr::Object(BTreeMap::from([
                    ("id".into(), member_field("entry", "id")),
                    ("conversation".into(), var("shape")),
                ])),
            },
        ],
    });
    body.push(Stmt::Return(var("result")));
    Program {
        name: name.into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        body,
        read_time_granularity_ms: None,
        result_page_site: Some(if merge { "words.merge" } else { "members.page" }.into()),
    }
}

fn member_field(binding: &str, name: &str) -> Expr {
    Expr::Field {
        base: Box::new(var(binding)),
        name: name.into(),
    }
}

fn columns<const N: usize>(columns: [(&str, ColumnType); N]) -> BTreeMap<String, ColumnType> {
    columns
        .into_iter()
        .map(|(name, kind)| (name.to_owned(), kind))
        .collect()
}

fn indexes<const N: usize>(indexes: [(&str, &[&str], bool); N]) -> BTreeMap<String, Index> {
    indexes
        .into_iter()
        .map(|(name, columns, unique)| {
            (
                name.to_owned(),
                Index {
                    columns: columns.iter().map(|name| (*name).to_owned()).collect(),
                    unique,
                },
            )
        })
        .collect()
}
