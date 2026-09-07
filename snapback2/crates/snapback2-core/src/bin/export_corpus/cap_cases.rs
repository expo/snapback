//! LLP 1017 cap enforcement and page-origin admission, shared with the twin.
use super::*;
#[path = "cap_review_cases.rs"]
mod review;

pub(super) fn add_cap_cases(cases: &mut Vec<CorpusCase>) {
    review::add(cases);
    add_count_backed_cases(cases);
    let schema = schema(50);
    for (name, count, upsert) in [
        ("cap-metered-insert", 49, false),
        ("cap-seed-shaped-full-upsert", 50, true),
    ] {
        let row = Expr::Literal(member(100, false));
        let statement = if upsert {
            Stmt::Upsert {
                table: "memberships".into(),
                key: Expr::Literal(id("m100")),
                row,
            }
        } else {
            Stmt::Insert {
                table: "memberships".into(),
                row,
            }
        };
        let p = program(name, vec![statement]);
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for n in 0..count {
            engine.seed("memberships", member(n, false)).unwrap();
        }
        let receipt = snapshot(&mut engine, &schema, scan("members.read"));
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        assert_eq!(cert.max_examined, 50);
        assert_eq!(cert.max_index_entries, 50);
        let execution = engine.execute(&p, &cert, context());
        if upsert {
            assert_eq!(execution.unwrap_err().code(), "E_CONSTRAINT");
        } else {
            assert_eq!(execution.unwrap().trace.examined, count as u64);
        }
        let case = case_from_parts(
            name,
            "cap",
            schema.clone(),
            p,
            context(),
            receipt,
            vec![],
            None,
            None,
        );
        cases.push(case);
    }
    let mut optional = schema.clone();
    optional.tables.get_mut("memberships").unwrap().constraints = vec![Constraint::Cap {
        by: vec!["group".into()],
        max: 1,
    }];
    let p = program(
        "cap-optional-omission-is-null",
        vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(member(1, true)),
        }],
    );
    let mut engine = Engine::memory(optional.clone()).unwrap();
    engine.seed("memberships", member(0, false)).unwrap();
    let mut null_scan = scan("null.group");
    null_scan.index = "byGroup".into();
    null_scan.prefix = vec![Expr::Literal(Value::Null)];
    let receipt = snapshot(&mut engine, &optional, null_scan);
    cases.push(case_from_parts(
        &p.name.clone(),
        "cap",
        optional,
        p,
        context(),
        receipt,
        vec![],
        None,
        None,
    ));

    // Group-preserving updates need neither cap probe, in the engine and twin.
    // A complete mutation page uses the cap bound; only fifty source rows exist.
    let mut backfill_schema = self::schema(1000);
    backfill_schema
        .tables
        .get_mut("memberships")
        .unwrap()
        .constraints
        .push(Constraint::Cap {
            by: vec!["group".into()],
            max: 1000,
        });
    let mut page = scan("members.backfill");
    page.take = Bound::Literal(1000);
    let p = program(
        "cap-group-preserving-backfill",
        vec![Stmt::For {
            binding: "m".into(),
            domain: LoopDomain::Page(page.clone()),
            body: vec![Stmt::Update {
                table: "memberships".into(),
                key: field(var("m"), "id"),
                patch: Expr::Object(BTreeMap::from([(
                    "role".into(),
                    Expr::Literal(text("backfilled")),
                )])),
            }],
        }],
    );
    let mut engine = Engine::memory(backfill_schema.clone()).unwrap();
    for n in 0..50 {
        engine.seed("memberships", member(n, false)).unwrap();
    }
    let receipt = snapshot(&mut engine, &backfill_schema, page);
    let cert = Checker::new(&backfill_schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(cert.max_examined, 1002);
    let execution = engine.execute(&p, &cert, context()).unwrap();
    assert_eq!(execution.trace.examined, 50);
    assert!(execution.trace.examined <= cert.max_examined);
    let case = case_from_parts(
        &p.name.clone(),
        "cap",
        backfill_schema,
        p,
        context(),
        receipt,
        vec![],
        None,
        None,
    );
    assert_eq!(case.expected.local_state, "predicted");
    cases.push(case);

    for mode in [
        "direct",
        "binding",
        "const",
        "assign",
        "longer-prefix",
        "shape",
        "boundary-50",
        "insert-to-50",
    ] {
        let name = format!("fanout-complete-{mode}");
        let mut scan = scan("members.page");
        if mode == "longer-prefix" {
            scan.prefix.push(Expr::Literal(text("member")));
            scan.index = "byConversationRole".into();
        }
        let mut body = Vec::new();
        if mode == "insert-to-50" {
            body.push(Stmt::Insert {
                table: "memberships".into(),
                row: Expr::Literal(member(49, false)),
            });
        }
        let domain = if matches!(mode, "binding" | "shape" | "const" | "assign") {
            body.push(match mode {
                "const" => Stmt::Const {
                    name: "page".into(),
                    value: Expr::Scan(scan.clone()),
                },
                "assign" => Stmt::Assign {
                    name: "page".into(),
                    value: Expr::Scan(scan.clone()),
                },
                _ => Stmt::Let {
                    name: "page".into(),
                    value: Expr::Scan(scan.clone()),
                },
            });
            if mode == "shape" {
                body.push(Stmt::Let {
                    name: "shaped".into(),
                    value: Expr::Array(vec![]),
                });
                body.push(Stmt::For {
                    binding: "row".into(),
                    domain: derived("page"),
                    body: vec![Stmt::Push {
                        target: "shaped".into(),
                        value: Expr::Object(BTreeMap::from([(
                            "id".into(),
                            field(var("row"), "id"),
                        )])),
                    }],
                });
            }
            derived(if mode == "shape" { "shaped" } else { "page" })
        } else {
            LoopDomain::Page(scan.clone())
        };
        body.push(fanout(domain));
        let p = program(&name, body);
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let count = if mode == "boundary-50" {
            50
        } else if mode == "insert-to-50" {
            49
        } else {
            3
        };
        for n in 0..count {
            engine.seed("memberships", member(n, false)).unwrap();
        }
        let receipt = snapshot(&mut engine, &schema, scan);
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        assert!(cert.read_sites.iter().any(|s| s.complete));
        let execution = engine.execute(&p, &cert, context()).unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(
            engine.rows("deliveries").unwrap().len(),
            if mode == "insert-to-50" { 50 } else { count }
        );
        let case = case_from_parts(
            &name,
            "fanout",
            schema.clone(),
            p,
            context(),
            receipt,
            vec![],
            None,
            None,
        );
        assert_eq!(case.expected.local_state, "predicted", "{name}");
        cases.push(case);
    }
    for mode in [
        "uncapped",
        "binding-uncapped",
        "binding-unknown",
        "below-cap",
        "argument-bound",
        "nonuniform-rule",
        "nonuniform-elsewhere",
        "merge",
        "cursor",
        "slice",
        "concat",
        "sort",
    ] {
        let name = format!("fanout-refused-{mode}");
        let mut schema = schema.clone();
        let mut scan = scan("members.page");
        let mut body = Vec::new();
        if matches!(mode, "uncapped" | "binding-uncapped") {
            schema
                .tables
                .get_mut("memberships")
                .unwrap()
                .constraints
                .clear();
        }
        if mode == "below-cap" {
            schema.tables.get_mut("memberships").unwrap().constraints = vec![Constraint::Cap {
                by: vec!["conversationId".into()],
                max: 100,
            }];
        }
        if mode == "argument-bound" {
            scan.take = Bound::Arg {
                name: "n".into(),
                max: 50,
            };
        }
        if mode == "nonuniform-rule" {
            schema.tables.get_mut("memberships").unwrap().rules.read =
                RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);
        }
        if mode == "nonuniform-elsewhere" {
            let mut other = schema.tables["memberships"].clone();
            other.rules.read = RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);
            schema.tables.insert("other".into(), other);
            let mut other_scan = scan.clone();
            other_scan.table = "other".into();
            other_scan.site = "elsewhere".into();
            body.push(Stmt::Let {
                name: "unused".into(),
                value: Expr::Scan(other_scan),
            });
        }
        if mode == "cursor" {
            scan.after = Some(Box::new(var("c")));
            scan.opaque_cursor = true;
        }
        if mode == "merge" {
            scan.merge_site = Some("union".into());
        }
        let domain = match mode {
            "binding-uncapped" | "binding-unknown" | "slice" | "concat" | "sort" => {
                body.push(Stmt::Let {
                    name: "page".into(),
                    value: Expr::Scan(scan.clone()),
                });
                if mode == "binding-unknown" {
                    let mut second = scan.clone();
                    second.site = "members.other".into();
                    second.prefix[0] = Expr::Literal(id("c2"));
                    body.push(Stmt::If {
                        condition: var("choice"),
                        then_body: vec![Stmt::Assign {
                            name: "page".into(),
                            value: Expr::Scan(second),
                        }],
                        else_body: vec![],
                    });
                }
                if matches!(mode, "slice" | "concat" | "sort") {
                    let (builtin, args) = match mode {
                        "slice" => (
                            Builtin::Slice,
                            vec![
                                var("page"),
                                Expr::Literal(Value::Int(0)),
                                Expr::Literal(Value::Int(50)),
                            ],
                        ),
                        "concat" => (Builtin::Concat, vec![var("page"), Expr::Array(vec![])]),
                        _ => (
                            Builtin::Sort {
                                keys: vec![SortKey {
                                    field: "id".into(),
                                    order: Order::Asc,
                                }],
                            },
                            vec![var("page")],
                        ),
                    };
                    body.push(Stmt::Assign {
                        name: "page".into(),
                        value: Expr::Builtin { builtin, args },
                    });
                }
                derived("page")
            }
            _ => LoopDomain::Page(scan),
        };
        body.push(fanout(domain));
        let mut p = program(&name, body);
        p.args = BTreeMap::from([
            ("n".into(), ArgType::Int),
            ("choice".into(), ArgType::Bool),
            ("c".into(), ArgType::Optional(Box::new(ArgType::Cursor))),
        ]);
        let reason = match mode {
            "uncapped" | "binding-uncapped" => "has no cap over conversationId",
            "below-cap" => "bound 50 is below cap 100",
            "argument-bound" => "the bound is an argument",
            "nonuniform-rule" => "the read rule is not uniform",
            "nonuniform-elsewhere" => {
                "the non-uniform scan at elsewhere can spend the budget this loop needs"
            }
            "merge" => "a merge page has no union proof",
            "cursor" => "the loop reads after a cursor",
            _ => "`page` is not a single page scan",
        };
        cases.push(refused(&name, schema, p, "E_STRUCTURAL_FANOUT", reason));
    }
    let mut uncapped = schema.clone();
    uncapped
        .tables
        .get_mut("memberships")
        .unwrap()
        .constraints
        .clear();
    let mut p = program(
        "fanout-query-uncapped",
        vec![
            Stmt::For {
                binding: "m".into(),
                domain: LoopDomain::Page(scan("members.query")),
                body: vec![Stmt::Require {
                    condition: Expr::Literal(Value::Bool(true)),
                    code: "OK".into(),
                }],
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    );
    p.kind = ProgramKind::Query;
    let mut engine = Engine::memory(uncapped.clone()).unwrap();
    let receipt = snapshot(&mut engine, &uncapped, scan("members.query"));
    cases.push(case_from_parts(
        &p.name.clone(),
        "fanout",
        uncapped,
        p,
        context(),
        receipt,
        vec![],
        None,
        None,
    ));
}

fn add_count_backed_cases(cases: &mut Vec<CorpusCase>) {
    let schema = count_backed_schema(3);
    let insert = |row_id: &str| Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(object([
            ("id", id(row_id)),
            ("conversationId", id("c1")),
            ("principal", id("alice")),
            ("role", text("member")),
        ])),
    };
    let fill = program(
        "count-backed-cap-fill-to-max",
        vec![insert("m1"), insert("m2"), insert("m3")],
    );
    let fill_certificate = Checker::new(&schema, Ceilings::default())
        .check(&fill)
        .unwrap();
    assert_eq!(fill_certificate.max_examined, 3);
    assert_eq!(fill_certificate.max_index_entries, 3);
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let fill_execution = engine.execute(&fill, &fill_certificate, context()).unwrap();
    assert_eq!(fill_execution.trace.examined, 3);
    let over = program("count-backed-cap-refuses-at-max", vec![insert("m4")]);
    let over_certificate = Checker::new(&schema, Ceilings::default())
        .check(&over)
        .unwrap();
    assert_eq!(over_certificate.max_examined, 1);
    assert_eq!(
        engine
            .execute(&over, &over_certificate, context())
            .unwrap_err()
            .code(),
        "E_CONSTRAINT"
    );
    let mut receipt = ClosureReceipt::default();
    for table in ["memberships", "membershipCounts"] {
        receipt.rows.extend(
            engine
                .rows(table)
                .unwrap()
                .into_iter()
                .map(|row| RowRecord {
                    table: table.to_owned(),
                    id: row.field("id").unwrap().as_str().unwrap().to_owned(),
                    row,
                }),
        );
    }
    let case = case_from_parts(
        &over.name.clone(),
        "cap",
        schema,
        over,
        context(),
        receipt,
        vec![],
        None,
        None,
    );
    assert_eq!(case.expected.error_code.as_deref(), Some("E_CONSTRAINT"));
    cases.push(case);

    let schema = count_backed_schema(1000);
    let principals: Vec<_> = (0..49).map(|n| id(&format!("u{n}"))).collect();
    let bulk = Program {
        name: "cap-1000-49-inserts-count-backed".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([(
            "members".into(),
            ArgType::List {
                of: Some(Box::new(ArgType::Principal)),
                max: 49,
            },
        )]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::For {
                binding: "principal".into(),
                domain: LoopDomain::ArgList {
                    name: "members".into(),
                    max: 49,
                },
                body: vec![Stmt::Insert {
                    table: "memberships".into(),
                    row: Expr::Object(BTreeMap::from([
                        ("id".into(), Expr::Input(Input::NewId)),
                        ("conversationId".into(), Expr::Literal(id("c1"))),
                        ("principal".into(), var("principal")),
                        ("role".into(), Expr::Literal(text("member"))),
                    ])),
                }],
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    let mut bulk_context = context();
    bulk_context
        .args
        .insert("members".into(), Value::Array(principals.clone()));
    bulk_context.new_ids = (0..49).map(|n| format!("m{n}")).collect();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&bulk)
        .unwrap();
    assert_eq!(certificate.max_examined, 49);
    assert_eq!(certificate.max_index_entries, 49);
    assert_eq!(certificate.max_steps, 787);
    assert!(
        certificate
            .indexes_required
            .contains(&"membershipCounts.byId".to_owned())
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let mut receipt = ClosureReceipt::default();
    for principal in &principals {
        let count_id = snapback2_core::value::canonical_json(&vec![principal.clone()]);
        let row = object([
            ("id", Value::Id(count_id.clone())),
            ("principal", principal.clone()),
            ("value", Value::Int(0)),
        ]);
        engine.seed("membershipCounts", row.clone()).unwrap();
        receipt.rows.push(RowRecord {
            table: "membershipCounts".into(),
            id: count_id,
            row,
        });
    }
    let execution = engine
        .execute(&bulk, &certificate, bulk_context.clone())
        .unwrap();
    assert_eq!(execution.trace.examined, 49);
    assert_eq!(engine.rows("memberships").unwrap().len(), 49);
    let case = case_from_parts(
        &bulk.name.clone(),
        "cap",
        schema.clone(),
        bulk.clone(),
        bulk_context.clone(),
        receipt,
        vec![],
        None,
        None,
    );
    assert_eq!(case.expected.local_state, "predicted");
    cases.push(case);

    let mut unbacked = schema;
    unbacked.maintains.clear();
    unbacked.tables.remove("membershipCounts");
    let errors = Checker::new(&unbacked, Ceilings::default())
        .check_all(&bulk)
        .unwrap_err();
    let error = errors
        .iter()
        .find(|error| {
            error.code == "E_BOUND" && error.message.starts_with("examined entries 49000")
        })
        .unwrap();
    let maintain_line = "maintain membershipsCount = count memberships by principal:";
    assert!(error.rewrite.contains(maintain_line), "{error}");
    assert!(
        error.rewrite.contains("prices at one row per write"),
        "{error}"
    );
    let mut case = refused(
        "cap-1000-49-inserts-unbacked-refused",
        unbacked,
        bulk,
        "E_BOUND",
        "examined entries 49000 exceeds",
    );
    case.certification_rewrite = Some(error.rewrite.clone());
    cases.push(case);
}

fn schema(max: u32) -> Schema {
    let mut memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("conversationId".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("role".into(), ColumnType::Text { max: 32 }),
            (
                "group".into(),
                ColumnType::Optional(Box::new(ColumnType::Text { max: 32 })),
            ),
        ]),
        BTreeMap::from([
            ("byId".into(), index(&["id"], true)),
            (
                "byConversationPrincipal".into(),
                index(&["conversationId", "principal", "id"], false),
            ),
            (
                "byConversationRole".into(),
                index(&["conversationId", "role", "id"], false),
            ),
            ("byGroup".into(), index(&["group", "id"], false)),
        ]),
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["conversationId".into()],
        max,
    });
    let deliveries = public_table(
        BTreeMap::from([("id".into(), ColumnType::Id)]),
        BTreeMap::from([("byId".into(), index(&["id"], true))]),
    );
    Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("deliveries".into(), deliveries),
        ]),
        ..Schema::default()
    }
}

fn count_backed_schema(max: u32) -> Schema {
    let mut schema = schema(max);
    let memberships = schema.tables.get_mut("memberships").unwrap();
    memberships.indexes.insert(
        "byPrincipalConversation".into(),
        index(&["principal", "conversationId", "id"], false),
    );
    memberships.constraints = vec![Constraint::Cap {
        by: vec!["principal".into()],
        max,
    }];
    let counts = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            ("byId".into(), index(&["id"], true)),
            ("byPrincipal".into(), index(&["principal"], true)),
        ]),
    );
    schema.tables.insert("membershipCounts".into(), counts);
    schema.maintains.push(Maintain {
        kind: MaintainKind::Count,
        source: "memberships".into(),
        by: vec!["principal".into()],
        target: "membershipCounts".into(),
        readable: None,
    });
    schema
}
fn index(columns: &[&str], unique: bool) -> Index {
    Index {
        columns: columns.iter().map(|s| (*s).into()).collect(),
        unique,
    }
}
fn member(n: usize, null: bool) -> Value {
    let mut row = object([
        ("id", id(&format!("m{n}"))),
        ("conversationId", id("c1")),
        ("principal", id(&format!("u{n}"))),
        ("role", text("member")),
    ]);
    if null {
        if let Value::Row(fields) = &mut row {
            fields.insert("group".into(), Value::Null);
        }
    }
    row
}
fn scan(site: &str) -> Scan {
    Scan {
        site: site.into(),
        table: "memberships".into(),
        index: "byConversationPrincipal".into(),
        prefix: vec![Expr::Literal(id("c1"))],
        order: Order::Asc,
        take: Bound::Literal(50),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    }
}
fn program(name: &str, body: Vec<Stmt>) -> Program {
    Program {
        name: name.into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}
fn derived(name: &str) -> LoopDomain {
    LoopDomain::DerivedArray {
        value: var(name),
        max: 50,
        bound_source: "page take 50".into(),
    }
}
fn fanout(domain: LoopDomain) -> Stmt {
    Stmt::For {
        binding: "m".into(),
        domain,
        body: vec![Stmt::Insert {
            table: "deliveries".into(),
            row: Expr::Object(BTreeMap::from([("id".into(), field(var("m"), "id"))])),
        }],
    }
}
fn context() -> Context {
    Context::mutation(Actor::user("u0").unwrap(), BTreeMap::new())
}
fn snapshot(engine: &mut Engine, schema: &Schema, scan: Scan) -> ClosureReceipt {
    let mut p = program("snapshot", vec![Stmt::Return(Expr::Scan(scan))]);
    p.kind = ProgramKind::Query;
    let cert = Checker::new(schema, Ceilings::default()).check(&p).unwrap();
    engine.execute(&p, &cert, context()).unwrap().receipt
}
fn refused(name: &str, schema: Schema, program: Program, code: &str, reason: &str) -> CorpusCase {
    let error = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert!(
        error
            .iter()
            .any(|e| e.code == code && e.message.contains(reason)),
        "{name}: {error:?}"
    );
    let envelope = json!({"Error": code});
    CorpusCase {
        server_only: true,
        certification_rewrite: None,
        corpus_version: CORPUS_VERSION,
        name: name.into(),
        category: "fanout".into(),
        random_seed: None,
        schema,
        program,
        certificate: None,
        context: context(),
        receipt: ClosureReceipt::default(),
        prelude: vec![],
        replacement_receipt: None,
        expected: Expected {
            error_reason: Some(reason.into()),
            local_result: None,
            error_code: Some(code.into()),
            local_state: "certification-refused".into(),
            partial_sites: vec![],
            canonical_result: serde_json::to_string(&envelope).unwrap(),
            digest: digest(&envelope),
            range_stops: BTreeMap::new(),
            evicted_rows: None,
            next: None,
        },
    }
}
