use super::*;

pub(super) fn add_twin_cases(cases: &mut Vec<CorpusCase>) {
    add_rbac_twin_cases(cases);
    add_text_control_refusal_case(cases);
    add_constraint_and_memo_twin_cases(cases);
    add_optional_maintain_twin_case(cases);
    add_same_mutation_sum_read_twin_case(cases);
}

fn add_text_control_refusal_case(cases: &mut Vec<CorpusCase>) {
    let schema = Schema {
        tables: BTreeMap::from([(
            "notes".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("body".to_owned(), ColumnType::Text { max: 1 }),
                ]),
                BTreeMap::new(),
            ),
        )]),
        ..Schema::default()
    };
    let program = Program {
        name: "notes.insert-control".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("body".to_owned(), ArgType::Text { max: 1 })]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Insert {
            table: "notes".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), Expr::Input(Input::NewId)),
                ("body".to_owned(), var("body")),
            ])),
        }],
    };
    let context = mutation_context([("body", text("\u{0001}"))], ["note-1"]);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .expect("text control certificate");
    let mut server = Engine::memory(schema.clone()).expect("text control engine");
    let error = server
        .execute(&program, &certificate, context.clone())
        .expect_err("server accepted a disallowed text control");
    assert_eq!(
        error.to_string(),
        "E_INPUT: arg body contains disallowed control character U+0001"
    );
    let case = case_from_parts(
        "named-text-control-refusal",
        "named",
        schema,
        program,
        context,
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    );
    assert_eq!(case.expected.error_code.as_deref(), Some("E_INPUT"));
    cases.push(case);
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — both runtimes expose an engine-maintained sum to later statements in the writing mutation.
fn add_same_mutation_sum_read_twin_case(cases: &mut Vec<CorpusCase>) {
    let public = RuleExpr::Public {
        reason: "frozen same-mutation maintain fixture".to_owned(),
    };
    let table = |columns: BTreeMap<String, ColumnType>,
                 indexes: BTreeMap<String, Index>,
                 writes: RuleExpr| Table {
        columns,
        indexes,
        rules: Rules {
            read: public.clone(),
            insert: writes.clone(),
            update: writes.clone(),
            delete: writes,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let schema = Schema {
        tables: BTreeMap::from([
            (
                "ledger".to_owned(),
                table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("owner".to_owned(), ColumnType::Principal),
                        ("amount".to_owned(), ColumnType::Int),
                    ]),
                    BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    )]),
                    RuleExpr::Allow,
                ),
            ),
            (
                "balances".to_owned(),
                table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("owner".to_owned(), ColumnType::Principal),
                        ("value".to_owned(), ColumnType::Int),
                    ]),
                    BTreeMap::from([
                        (
                            "byId".to_owned(),
                            Index {
                                columns: vec!["id".to_owned()],
                                unique: true,
                            },
                        ),
                        (
                            "byOwner".to_owned(),
                            Index {
                                columns: vec!["owner".to_owned()],
                                unique: true,
                            },
                        ),
                    ]),
                    RuleExpr::Deny,
                ),
            ),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Sum {
                of: "amount".to_owned(),
            },
            source: "ledger".to_owned(),
            by: vec!["owner".to_owned()],
            target: "balances".to_owned(),
            readable: None,
        }],
        ..Schema::default()
    };
    let program = Program {
        name: "ledger.insertAndReadBalance".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Insert {
                table: "ledger".to_owned(),
                row: Expr::Literal(row([
                    ("id", id("entry-1")),
                    ("owner", id("dev:alice")),
                    ("amount", Value::Int(500)),
                ])),
            },
            Stmt::Let {
                name: "balance".to_owned(),
                value: Expr::Get(Read {
                    site: "balances.afterInsert".to_owned(),
                    table: "balances".to_owned(),
                    index: "byOwner".to_owned(),
                    key: vec![Expr::Literal(id("dev:alice"))],
                    provenance: KeyProvenance::Const,
                }),
            },
            Stmt::Return(Expr::Field {
                base: Box::new(var("balance")),
                name: "value".to_owned(),
            }),
        ],
    };
    let context = mutation_context([], Vec::<String>::new());
    let mut engine = Engine::memory(schema.clone()).expect("same-mutation maintain engine");
    engine
        .seed(
            "ledger",
            row([
                ("id", id("entry-0")),
                ("owner", id("dev:alice")),
                ("amount", Value::Int(-250)),
            ]),
        )
        .expect("same-mutation maintain prelude");
    engine
        .seed(
            "balances",
            row([
                ("id", id(canonical_json(&vec![id("dev:alice")]))),
                ("owner", id("dev:alice")),
                ("value", Value::Int(-250)),
            ]),
        )
        .expect("same-mutation maintained target prelude");
    let execution = authoritative(&mut engine, &schema, &program, context.clone());
    assert_eq!(execution.result, Value::Int(250));
    let case = case_from_parts(
        "named-maintained-sum-read-after-insert",
        "maintain",
        schema,
        program,
        context,
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "balances".to_owned(),
                id: canonical_json(&vec![id("dev:alice")]),
                row: row([
                    ("id", id(canonical_json(&vec![id("dev:alice")]))),
                    ("owner", id("dev:alice")),
                    ("value", Value::Int(-250)),
                ]),
            }],
            absences: vec![("ledger".to_owned(), "byId".to_owned(), vec![id("entry-1")])],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    );
    assert_eq!(case.expected.local_result, Some(Value::Int(250)));
    cases.push(case);
}
// @ref LLP 1001#9-schema-additions — the frozen client twin exercises the
// relational update, created-row, and intrinsic addressed-id rules directly.
fn add_rbac_twin_cases(cases: &mut Vec<CorpusCase>) {
    let schema = rbac_twin_schema();
    let existing_membership = vec![(
        "memberships",
        row([
            ("id", id("seat-1")),
            ("group", id("group-1")),
            ("principal", id("u1")),
            ("role", text("member")),
        ]),
    )];
    let program = |name: &str, body: Vec<Stmt>| Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body,
    };
    let committed = || Stmt::Return(Expr::Literal(Value::Bool(true)));

    let mut transition_receipt = rbac_receipt(&existing_membership);
    transition_receipt.absences.push((
        "memberships".to_owned(),
        "byGroupPrincipalRole".to_owned(),
        vec![id("group-1"), id("u1"), text("admin")],
    ));
    cases.push(rbac_twin_case_with_receipt(
        "named-rbac-transition-update",
        schema.clone(),
        program(
            "memberships.promote",
            vec![
                Stmt::Update {
                    table: "memberships".to_owned(),
                    key: Expr::Literal(id("seat-1")),
                    patch: Expr::Object(BTreeMap::from([(
                        "role".to_owned(),
                        Expr::Literal(text("admin")),
                    )])),
                },
                committed(),
            ],
        ),
        transition_receipt,
    ));

    let existing_admin = vec![(
        "memberships",
        row([
            ("id", id("seat-1")),
            ("group", id("group-1")),
            ("principal", id("u1")),
            ("role", text("admin")),
        ]),
    )];
    cases.push(rbac_twin_case(
        "named-rbac-transition-denied",
        schema.clone(),
        program(
            "memberships.promoteDenied",
            vec![Stmt::Update {
                table: "memberships".to_owned(),
                key: Expr::Literal(id("seat-1")),
                patch: Expr::Object(BTreeMap::from([(
                    "role".to_owned(),
                    Expr::Literal(text("admin")),
                )])),
            }],
        ),
        existing_admin,
    ));

    let bootstrap_receipt = ClosureReceipt {
        absences: vec![
            (
                "groups".to_owned(),
                "byId".to_owned(),
                vec![id("group-new")],
            ),
            (
                "memberships".to_owned(),
                "byId".to_owned(),
                vec![id("seat-new")],
            ),
            (
                "memberships".to_owned(),
                "byGroupPrincipalRole".to_owned(),
                vec![id("group-new"), id("u1"), text("admin")],
            ),
        ],
        ..ClosureReceipt::default()
    };
    cases.push(rbac_twin_case_with_receipt(
        "named-rbac-created-bootstrap",
        schema.clone(),
        program(
            "groups.bootstrap",
            vec![
                Stmt::Insert {
                    table: "groups".to_owned(),
                    row: Expr::Literal(row([("id", id("group-new")), ("creator", id("u1"))])),
                },
                Stmt::Insert {
                    table: "memberships".to_owned(),
                    row: Expr::Literal(row([
                        ("id", id("seat-new")),
                        ("group", id("group-new")),
                        ("principal", id("u1")),
                        ("role", text("admin")),
                    ])),
                },
                committed(),
            ],
        ),
        bootstrap_receipt,
    ));

    cases.push(rbac_twin_case(
        "named-rbac-final-seat-missing",
        schema.clone(),
        program(
            "groups.missingCreatorSeat",
            vec![Stmt::Insert {
                table: "groups".to_owned(),
                row: Expr::Literal(row([("id", id("group-new")), ("creator", id("u1"))])),
            }],
        ),
        Vec::new(),
    ));

    cases.push(rbac_twin_case(
        "named-rbac-final-seat-deleted",
        schema.clone(),
        program(
            "groups.deleteCreatorSeat",
            vec![
                Stmt::Insert {
                    table: "groups".to_owned(),
                    row: Expr::Literal(row([("id", id("group-new")), ("creator", id("u1"))])),
                },
                Stmt::Insert {
                    table: "memberships".to_owned(),
                    row: Expr::Literal(row([
                        ("id", id("seat-new")),
                        ("group", id("group-new")),
                        ("principal", id("u1")),
                        ("role", text("admin")),
                    ])),
                },
                Stmt::Delete {
                    table: "memberships".to_owned(),
                    key: Expr::Literal(id("seat-new")),
                },
            ],
        ),
        Vec::new(),
    ));

    cases.push(rbac_twin_case(
        "named-rbac-created-preexisting-denied",
        schema,
        program(
            "groups.claimPreexisting",
            vec![Stmt::Insert {
                table: "memberships".to_owned(),
                row: Expr::Literal(row([
                    ("id", id("seat-new")),
                    ("group", id("group-existing")),
                    ("principal", id("u1")),
                    ("role", text("admin")),
                ])),
            }],
        ),
        vec![(
            "groups",
            row([("id", id("group-existing")), ("creator", id("u1"))]),
        )],
    ));
}

fn rbac_twin_schema() -> Schema {
    let public = RuleExpr::Public {
        reason: "frozen RBAC twin fixture".to_owned(),
    };
    let groups = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("creator".to_owned(), ColumnType::Principal),
        ]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
        rules: Rules {
            read: public.clone(),
            insert: RuleExpr::Allow,
            update: RuleExpr::Deny,
            delete: RuleExpr::Deny,
        },
        constraints: vec![Constraint::FinalExistsOnInsert {
            table: "memberships".to_owned(),
            index: "byGroupPrincipalRole".to_owned(),
            key: vec![
                RuleTerm::Field("id".to_owned()),
                RuleTerm::Field("creator".to_owned()),
                RuleTerm::Literal(text("admin")),
            ],
        }],
        retain: Default::default(),
    };
    let memberships = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("principal".to_owned(), ColumnType::Principal),
            ("role".to_owned(), ColumnType::Text { max: 16 }),
        ]),
        indexes: BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    columns: vec!["id".to_owned()],
                    unique: true,
                },
            ),
            (
                "byGroupPrincipalRole".to_owned(),
                Index {
                    columns: vec![
                        "group".to_owned(),
                        "principal".to_owned(),
                        "role".to_owned(),
                    ],
                    unique: true,
                },
            ),
        ]),
        rules: Rules {
            read: public,
            insert: RuleExpr::Created {
                table: "groups".to_owned(),
                index: "byId".to_owned(),
                key: vec![RuleTerm::Field("group".to_owned())],
                provenance: KeyProvenance::Shape,
            },
            update: RuleExpr::And(vec![
                RuleExpr::Eq(
                    RuleTerm::OldField("role".to_owned()),
                    RuleTerm::Literal(text("member")),
                ),
                RuleExpr::Eq(
                    RuleTerm::NextField("role".to_owned()),
                    RuleTerm::Literal(text("admin")),
                ),
                RuleExpr::Eq(
                    RuleTerm::OldField("group".to_owned()),
                    RuleTerm::NextField("group".to_owned()),
                ),
                RuleExpr::Eq(
                    RuleTerm::OldField("principal".to_owned()),
                    RuleTerm::NextField("principal".to_owned()),
                ),
                RuleExpr::Eq(RuleTerm::OldField("principal".to_owned()), RuleTerm::Viewer),
            ]),
            delete: RuleExpr::Allow,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    Schema {
        tables: BTreeMap::from([
            ("groups".to_owned(), groups),
            ("memberships".to_owned(), memberships),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        schedules: Vec::new(),
        effects: Vec::new(),
    }
}

fn rbac_twin_case(
    name: &str,
    schema: Schema,
    program: Program,
    rows: Vec<(&str, Value)>,
) -> CorpusCase {
    rbac_twin_case_with_receipt(name, schema, program, rbac_receipt(&rows))
}

fn rbac_receipt(rows: &[(&str, Value)]) -> ClosureReceipt {
    ClosureReceipt {
        rows: rows
            .iter()
            .map(|(table, row)| RowRecord {
                table: (*table).to_owned(),
                id: row
                    .field("id")
                    .and_then(Value::as_str)
                    .expect("RBAC twin row id")
                    .to_owned(),
                row: row.clone(),
            })
            .collect(),
        ..ClosureReceipt::default()
    }
}

fn rbac_twin_case_with_receipt(
    name: &str,
    schema: Schema,
    program: Program,
    receipt: ClosureReceipt,
) -> CorpusCase {
    let context = mutation_context([], Vec::<String>::new());
    let mut server = Engine::memory(schema.clone()).expect("RBAC twin engine");
    for record in &receipt.rows {
        server
            .seed(&record.table, record.row.clone())
            .expect("RBAC twin seed");
    }
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .expect("RBAC twin certificate");
    let authoritative = server.execute(&program, &certificate, context.clone());
    let case = case_from_parts(
        name,
        "named",
        schema,
        program,
        context,
        receipt,
        Vec::new(),
        None,
        None,
    );
    match authoritative {
        Ok(execution) => assert_eq!(case.expected.local_result, Some(execution.result)),
        Err(error) => {
            let rendered = error.to_string();
            let code = rendered.split(':').next().unwrap_or("E_UNKNOWN");
            assert_eq!(case.expected.error_code.as_deref(), Some(code));
        }
    }
    case
}

fn add_constraint_and_memo_twin_cases(cases: &mut Vec<CorpusCase>) {
    let public = RuleExpr::Public {
        reason: "frozen evaluator constraint fixture".to_owned(),
    };
    let profiles = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("displayName".to_owned(), ColumnType::Text { max: 64 }),
            ("handle".to_owned(), ColumnType::Text { max: 32 }),
            (
                "link".to_owned(),
                ColumnType::Optional(Box::new(ColumnType::Text { max: 256 })),
            ),
        ]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
        rules: Rules {
            read: public.clone(),
            insert: RuleExpr::Allow,
            update: RuleExpr::Allow,
            delete: RuleExpr::Allow,
        },
        constraints: vec![
            Constraint::Text {
                field: "displayName".to_owned(),
                min: 1,
                format: None,
            },
            Constraint::Text {
                field: "handle".to_owned(),
                min: 3,
                format: Some(TextFormat::Handle),
            },
            Constraint::Text {
                field: "link".to_owned(),
                min: 0,
                format: Some(TextFormat::Url),
            },
        ],
        retain: Default::default(),
    };
    let profile_schema = Schema {
        tables: BTreeMap::from([("profiles".to_owned(), profiles)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        schedules: Vec::new(),
        effects: Vec::new(),
    };
    let profile_program = |name: &str, display: &str, handle: &str, link: Value| Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Insert {
            table: "profiles".to_owned(),
            row: Expr::Literal(row([
                ("id", id("profile-1")),
                ("displayName", text(display)),
                ("handle", text(handle)),
                ("link", link),
            ])),
        }],
    };
    for (name, display, handle, link) in [
        (
            "named-text-valid-profile",
            "Alice Example",
            "alice_123",
            text("https://example.com/\u{feff}profile"),
        ),
        ("named-text-empty-display", "", "alice", Value::Null),
        ("named-text-invalid-handle", "Alice", "Alice!", Value::Null),
        (
            "named-text-invalid-url",
            "Alice",
            "alice",
            text("https://example.com/bad path"),
        ),
    ] {
        cases.push(rbac_twin_case(
            name,
            profile_schema.clone(),
            profile_program(name, display, handle, link),
            Vec::new(),
        ));
    }

    let events = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
        ]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
        rules: Rules {
            read: public.clone(),
            insert: RuleExpr::Allow,
            update: RuleExpr::Allow,
            delete: RuleExpr::Allow,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let counts = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
            ("value".to_owned(), ColumnType::Int),
        ]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
        rules: Rules {
            read: RuleExpr::Deny,
            insert: RuleExpr::Deny,
            update: RuleExpr::Deny,
            delete: RuleExpr::Deny,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let maintained_schema = Schema {
        tables: BTreeMap::from([("counts".to_owned(), counts), ("events".to_owned(), events)]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "events".to_owned(),
            by: vec!["bucket".to_owned()],
            target: "counts".to_owned(),
            readable: None,
        }],
        channels: BTreeMap::new(),
        auth: Auth::default(),
        schedules: Vec::new(),
        effects: Vec::new(),
    };
    let maintained_program = Program {
        name: "events.record".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Insert {
                table: "events".to_owned(),
                row: Expr::Literal(row([("id", id("event-1")), ("bucket", id("bucket-1"))])),
            },
            Stmt::Return(Expr::Literal(Value::Bool(true))),
        ],
    };
    cases.push(rbac_twin_case_with_receipt(
        "named-maintained-deny-target",
        maintained_schema,
        maintained_program,
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "counts".to_owned(),
                id: canonical_json(&vec![id("bucket-1")]),
                row: row([
                    ("id", id(canonical_json(&vec![id("bucket-1")]))),
                    ("bucket", id("bucket-1")),
                    ("value", Value::Int(0)),
                ]),
            }],
            ..ClosureReceipt::default()
        },
    ));

    add_rule_memo_twin_cases(cases, public);
}

fn add_rule_memo_twin_cases(cases: &mut Vec<CorpusCase>, public: RuleExpr) {
    let authority = RuleExpr::Exists {
        table: "grants".to_owned(),
        index: "byPrincipal".to_owned(),
        key: vec![RuleTerm::Viewer],
        provenance: KeyProvenance::Viewer,
    };
    let table = |columns, indexes, rules| Table {
        columns,
        indexes,
        rules,
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let by_id = || {
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )])
    };
    let docs = table(
        BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
        by_id(),
        Rules {
            read: authority.clone(),
            insert: RuleExpr::Deny,
            update: RuleExpr::Deny,
            delete: RuleExpr::Deny,
        },
    );
    let actions = table(
        BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
        by_id(),
        Rules {
            read: public.clone(),
            insert: authority,
            update: RuleExpr::Deny,
            delete: RuleExpr::Deny,
        },
    );
    let grants = table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("principal".to_owned(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    columns: vec!["id".to_owned()],
                    unique: true,
                },
            ),
            (
                "byPrincipal".to_owned(),
                Index {
                    columns: vec!["principal".to_owned()],
                    unique: true,
                },
            ),
        ]),
        Rules {
            read: public,
            insert: RuleExpr::Allow,
            update: RuleExpr::Allow,
            delete: RuleExpr::Allow,
        },
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("actions".to_owned(), actions),
            ("docs".to_owned(), docs),
            ("grants".to_owned(), grants),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        schedules: Vec::new(),
        effects: Vec::new(),
    };
    let probe = || Stmt::Let {
        name: "probe".to_owned(),
        value: Expr::Get(Read {
            site: "memo.doc".to_owned(),
            table: "docs".to_owned(),
            index: "byId".to_owned(),
            key: vec![Expr::Literal(id("doc-1"))],
            provenance: KeyProvenance::Const,
        }),
    };
    let action = |id_value: &str| Stmt::Insert {
        table: "actions".to_owned(),
        row: Expr::Literal(row([("id", id(id_value))])),
    };

    cases.push(rbac_twin_case(
        "named-rule-memo-revoked",
        schema.clone(),
        Program {
            name: "actions.afterRevoke".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![
                probe(),
                Stmt::Delete {
                    table: "grants".to_owned(),
                    key: Expr::Literal(id("grant-1")),
                },
                action("action-1"),
            ],
        },
        vec![
            ("docs", row([("id", id("doc-1"))])),
            (
                "grants",
                row([("id", id("grant-1")), ("principal", id("u1"))]),
            ),
        ],
    ));
    let mut granted_receipt = rbac_receipt(&[("docs", row([("id", id("doc-1"))]))]);
    granted_receipt.absences.push((
        "grants".to_owned(),
        "byPrincipal".to_owned(),
        vec![id("u1")],
    ));
    cases.push(rbac_twin_case_with_receipt(
        "named-rule-memo-granted",
        schema,
        Program {
            name: "actions.afterGrant".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![
                probe(),
                Stmt::Insert {
                    table: "grants".to_owned(),
                    row: Expr::Literal(row([("id", id("grant-1")), ("principal", id("u1"))])),
                },
                action("action-1"),
                Stmt::Return(Expr::Literal(Value::Bool(true))),
            ],
        },
        granted_receipt,
    ));
}

// @ref LLP 1001#2-what-a-commit-records — omitted Optional source fields
// materialize as Null before both authoritative and local maintained grouping.
fn add_optional_maintain_twin_case(cases: &mut Vec<CorpusCase>) {
    let public = RuleExpr::Public {
        reason: "frozen optional maintain fixture".to_owned(),
    };
    let by_id = || {
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )])
    };
    let optional_bucket = ColumnType::Optional(Box::new(ColumnType::Id));
    let events = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("__proto__".to_owned(), optional_bucket.clone()),
            ("toString".to_owned(), optional_bucket.clone()),
        ]),
        indexes: by_id(),
        rules: Rules {
            read: public.clone(),
            insert: public.clone(),
            update: public.clone(),
            delete: public,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let counts = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("__proto__".to_owned(), optional_bucket.clone()),
            ("toString".to_owned(), optional_bucket),
            ("value".to_owned(), ColumnType::Int),
        ]),
        indexes: BTreeMap::from([
            (
                "byGroup".to_owned(),
                Index {
                    columns: vec!["__proto__".to_owned(), "toString".to_owned()],
                    unique: true,
                },
            ),
            (
                "byId".to_owned(),
                Index {
                    columns: vec!["id".to_owned()],
                    unique: true,
                },
            ),
        ]),
        rules: Rules {
            read: RuleExpr::Public {
                reason: "assert the materialized Null group".to_owned(),
            },
            insert: RuleExpr::Deny,
            update: RuleExpr::Deny,
            delete: RuleExpr::Deny,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let schema = Schema {
        tables: BTreeMap::from([("counts".to_owned(), counts), ("events".to_owned(), events)]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "events".to_owned(),
            by: vec!["__proto__".to_owned(), "toString".to_owned()],
            target: "counts".to_owned(),
            readable: None,
        }],
        channels: BTreeMap::new(),
        auth: Auth::default(),
        schedules: Vec::new(),
        effects: Vec::new(),
    };
    let program = Program {
        name: "events.recordWithoutBucket".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Insert {
                table: "events".to_owned(),
                row: Expr::Literal(row([("id", id("event-optional"))])),
            },
            Stmt::Return(Expr::Get(Read {
                site: "optionalMaintain.count".to_owned(),
                table: "counts".to_owned(),
                index: "byGroup".to_owned(),
                key: vec![Expr::Literal(Value::Null), Expr::Literal(Value::Null)],
                provenance: KeyProvenance::Const,
            })),
        ],
    };
    let aggregate_id = canonical_json(&vec![Value::Null, Value::Null]);
    cases.push(rbac_twin_case(
        "named-maintained-optional-null-group",
        schema.clone(),
        program.clone(),
        vec![(
            "counts",
            row([
                ("id", Value::Id(aggregate_id.clone())),
                ("__proto__", Value::Null),
                ("toString", Value::Null),
                ("value", Value::Int(0)),
            ]),
        )],
    ));
    cases.push(rbac_twin_case(
        "named-maintained-held-target",
        schema.clone(),
        program.clone(),
        vec![(
            "counts",
            row([
                ("id", Value::Id(aggregate_id)),
                ("__proto__", Value::Null),
                ("toString", Value::Null),
                ("value", Value::Int(5)),
            ]),
        )],
    ));
    cases.push(case_from_parts(
        "named-maintained-authority-missing",
        "authority",
        schema,
        program,
        mutation_context([], Vec::<String>::new()),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));
}
