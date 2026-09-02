use super::*;

pub(super) fn add_twin_cases(cases: &mut Vec<CorpusCase>) {
    add_rbac_twin_cases(cases);
    add_constraint_and_memo_twin_cases(cases);
    add_optional_maintain_twin_case(cases);
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
        body,
    };
    let committed = || Stmt::Return(Expr::Literal(Value::Bool(true)));

    cases.push(rbac_twin_case(
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
        existing_membership.clone(),
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

    cases.push(rbac_twin_case(
        "named-rbac-update-rekeys-id",
        schema.clone(),
        program(
            "memberships.rekeyUpdate",
            vec![Stmt::Update {
                table: "memberships".to_owned(),
                key: Expr::Literal(id("seat-1")),
                patch: Expr::Object(BTreeMap::from([(
                    "id".to_owned(),
                    Expr::Literal(id("seat-2")),
                )])),
            }],
        ),
        existing_membership.clone(),
    ));

    cases.push(rbac_twin_case(
        "named-rbac-upsert-rekeys-id",
        schema.clone(),
        program(
            "memberships.rekeyUpsert",
            vec![Stmt::Upsert {
                table: "memberships".to_owned(),
                key: Expr::Literal(id("seat-1")),
                row: Expr::Literal(row([
                    ("id", id("seat-2")),
                    ("group", id("group-1")),
                    ("principal", id("u1")),
                    ("role", text("admin")),
                ])),
            }],
        ),
        existing_membership,
    ));

    cases.push(rbac_twin_case(
        "named-rbac-upsert-missing-rekeys-id",
        schema.clone(),
        program(
            "memberships.rekeyMissingUpsert",
            vec![Stmt::Upsert {
                table: "memberships".to_owned(),
                key: Expr::Literal(id("seat-missing")),
                row: Expr::Literal(row([
                    ("id", id("seat-other")),
                    ("group", id("group-1")),
                    ("principal", id("u1")),
                    ("role", text("admin")),
                ])),
            }],
        ),
        Vec::new(),
    ));

    cases.push(rbac_twin_case(
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
        Vec::new(),
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
    };
    Schema {
        tables: BTreeMap::from([
            ("groups".to_owned(), groups),
            ("memberships".to_owned(), memberships),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn rbac_twin_case(
    name: &str,
    schema: Schema,
    program: Program,
    rows: Vec<(&str, Value)>,
) -> CorpusCase {
    let receipt = ClosureReceipt {
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
    };
    rbac_twin_case_with_receipt(name, schema, program, receipt)
}

fn by_id_absence(table: &str, id: String) -> ClosureReceipt {
    ClosureReceipt {
        absences: vec![(table.to_owned(), "byId".to_owned(), vec![Value::Id(id)])],
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
    };
    let profile_schema = Schema {
        tables: BTreeMap::from([("profiles".to_owned(), profiles)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let profile_program = |name: &str, display: &str, handle: &str, link: Value| Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
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
        effects: Vec::new(),
    };
    let maintained_program = Program {
        name: "events.record".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
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
        by_id_absence("counts", canonical_json(&vec![id("bucket-1")])),
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
    cases.push(rbac_twin_case(
        "named-rule-memo-granted",
        schema,
        Program {
            name: "actions.afterGrant".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
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
        vec![("docs", row([("id", id("doc-1"))]))],
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
        effects: Vec::new(),
    };
    let program = Program {
        name: "events.recordWithoutBucket".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
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
    cases.push(rbac_twin_case_with_receipt(
        "named-maintained-optional-null-group",
        schema.clone(),
        program.clone(),
        by_id_absence("counts", aggregate_id.clone()),
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
