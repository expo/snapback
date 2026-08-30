use snapback2_core::*;
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn empty_schema() -> Schema {
    Schema {
        tables: BTreeMap::new(),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: vec!["audit".to_owned()],
    }
}

fn emit_program(kind: ProgramKind, effect: &str) -> Program {
    Program {
        name: format!("ops.{effect}"),
        kind,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Emit {
                effect: effect.to_owned(),
                payload: Expr::Literal(Value::String("payload".to_owned())),
            },
            Stmt::Return(Expr::Input(Input::NewId)),
        ],
    }
}

fn project(programs: Vec<Program>, schema: Schema) -> ProjectJson {
    ProjectJson {
        version: 1,
        schema,
        programs,
        effects: vec![EffectDecl {
            name: "audit".to_owned(),
            grants: vec!["network".to_owned()],
            source: "effects/audit.ts".to_owned(),
            then: None,
        }],
        auth: Auth::default(),
    }
}

fn ceiling_schema(body_max: u32) -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("body".to_owned(), ColumnType::Text { max: body_max }),
                ]),
                BTreeMap::from([(
                    "byId".to_owned(),
                    Index {
                        columns: vec!["id".to_owned()],
                        unique: true,
                    },
                )]),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn ceiling_scan(take: u32) -> Program {
    Program {
        name: "items.overCeiling".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "items.overCeiling".to_owned(),
            table: "items".to_owned(),
            index: "byId".to_owned(),
            prefix: Vec::new(),
            order: Order::Asc,
            take: Bound::Literal(take),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn assert_named_ceiling(schema: &Schema, program: &Program, ceilings: Ceilings, name: &str) {
    let errors = Checker::new(schema, ceilings)
        .check_all(program)
        .unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.message.starts_with(&format!("{name} "))
                && error.message.contains("exceeds ceiling")),
        "missing {name} refusal from {errors:?}"
    );
}

#[test]
fn emit_has_the_wire_shape_certificate_outbox_trace_and_id_consumption() {
    let statement = Stmt::Emit {
        effect: "audit".to_owned(),
        payload: Expr::Literal(Value::String("payload".to_owned())),
    };
    assert_eq!(
        serde_json::to_value(&statement).unwrap(),
        serde_json::json!({
            "Emit": {
                "effect": "audit",
                "payload": { "Literal": { "String": "payload" } }
            }
        })
    );

    let program = emit_program(ProgramKind::Mutation, "audit");
    let generation = Generation::certify(
        &project(vec![program.clone()], empty_schema()),
        Ceilings::default(),
    )
    .unwrap();
    let certificate = &generation.programs[&program.name].1;
    assert_eq!(
        certificate.write_sites,
        vec![WriteSite {
            table: "_outbox".to_owned(),
            kind: WriteKind::Emit,
            max_rows: 1,
        }]
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation("u1", BTreeMap::new());
    context.now = Some(444);
    context.new_ids = VecDeque::from(["effect-id".to_owned(), "after-id".to_owned()]);
    let execution = runtime.execute(&program.name, context).unwrap();
    assert_eq!(execution.result, Value::Id("after-id".to_owned()));
    assert_eq!(execution.trace.emits[0].id, "effect-id");
    assert_eq!(execution.state, ExecutionState::Committed { seq: 1 });
    assert_eq!(runtime.store().commits_since(0, 1).unwrap()[0].emits, 1);

    let snapshot = temp_path();
    runtime.store().snapshot_to(&snapshot).unwrap();
    let connection = rusqlite::Connection::open(&snapshot).unwrap();
    let row: (i64, String, String, String, i64, i64) = connection
        .query_row(
            "SELECT seq, effect, payload, state, attempts, next_at FROM _outbox",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        row,
        (
            1,
            "audit".to_owned(),
            "{\"String\":\"payload\"}".to_owned(),
            "queued".to_owned(),
            0,
            444
        )
    );
    drop(connection);
    cleanup(&snapshot);
}

#[test]
fn emit_refusals_are_complete_and_schema_defaults_preserve_old_json() {
    let query = emit_program(ProgramKind::Query, "missingQuery");
    let mutation = emit_program(ProgramKind::Mutation, "missingMutation");
    let errors = Generation::certify(
        &project(vec![query, mutation], empty_schema()),
        Ceilings::default(),
    )
    .unwrap_err();
    let codes: Vec<_> = errors
        .iter()
        .map(|(_, error)| error.code.as_str())
        .collect();
    assert!(codes.contains(&"E_EMIT_IN_QUERY"));
    assert_eq!(
        codes
            .iter()
            .filter(|code| **code == "E_EFFECT_UNKNOWN")
            .count(),
        2
    );

    let old: Schema = serde_json::from_value(serde_json::json!({
        "tables": {},
        "maintains": []
    }))
    .unwrap();
    assert!(old.channels.is_empty());
    assert_eq!(old.auth, Auth::default());
    assert!(old.effects.is_empty());
}

#[test]
fn project_effect_declarations_are_authoritative_and_compiler_json_shape_certifies() {
    let fixture = serde_json::json!({
        "version": 1,
        "schema": {
            "tables": {},
            "maintains": [],
            "effects": ["notifications.notify"]
        },
        "programs": [{
            "name": "notifications.send",
            "kind": "Mutation",
            "args": {},
            "read_time_granularity_ms": null,
            "body": [{
                "Emit": {
                    "effect": "notifications.notify",
                    "payload": { "Literal": { "String": "hello" } }
                }
            }]
        }],
        "effects": [{
            "name": "notifications.notify",
            "grants": ["network"],
            "source": "effects/notifications.ts",
            "then": null
        }],
        "auth": { "password": false, "guests": false }
    });
    let project: ProjectJson = serde_json::from_value(fixture).unwrap();
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    assert!(generation.effects.contains_key("notifications.notify"));
    assert!(generation.programs.contains_key("notifications.send"));

    let mut declaration_only = project.clone();
    declaration_only.schema.effects.clear();
    Generation::certify(&declaration_only, Ceilings::default())
        .expect("ProjectJson.effects, not schema.effects, authorizes emit names");

    let mut schema_only = project.clone();
    schema_only.effects.clear();
    schema_only.programs.clear();
    schema_only
        .schema
        .effects
        .extend(["mail.send".to_owned(), "sms.send".to_owned()]);
    let errors = Generation::certify(&schema_only, Ceilings::default()).unwrap_err();
    assert_eq!(
        errors
            .iter()
            .filter(|(_, error)| error.code == "E_EFFECT_UNDECLARED")
            .count(),
        3,
        "every schema effect without a ProjectJson declaration is reported"
    );
    assert!(errors.iter().all(|(_, error)| {
        error.code != "E_EFFECT_UNKNOWN" || !error.message.contains("notifications.notify")
    }));
}

#[test]
fn duplicate_program_is_still_checked_and_reports_all_its_own_refusals() {
    let first = Program {
        name: "ops.duplicate".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    let duplicate = Program {
        name: first.name.clone(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Emit {
            effect: "missing".to_owned(),
            payload: Expr::Literal(Value::Null),
        }],
    };
    let errors = Generation::certify(
        &project(vec![first, duplicate], empty_schema()),
        Ceilings::default(),
    )
    .unwrap_err();
    let codes: Vec<_> = errors
        .iter()
        .map(|(_, error)| error.code.as_str())
        .collect();
    assert!(codes.contains(&"E_OP_DUPLICATE"));
    assert!(codes.contains(&"E_EMIT_IN_QUERY"));
    assert!(codes.contains(&"E_EFFECT_UNKNOWN"));
}

#[test]
fn checker_and_generation_report_all_refusals_per_program() {
    let items = public_table(
        BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
    );
    let schema = Schema {
        tables: BTreeMap::from([("items".to_owned(), items)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: vec!["audit".to_owned()],
    };
    let program = Program {
        name: "items.invalidQuery".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "items".to_owned(),
                row: Expr::Literal(object([("id", Value::Id("i1".to_owned()))])),
            },
            Stmt::Emit {
                effect: "missing".to_owned(),
                payload: Expr::Literal(Value::Null),
            },
            Stmt::Let {
                name: "time".to_owned(),
                value: Expr::Input(Input::Now),
            },
            Stmt::Return(Expr::Get(Read {
                site: "missing.read".to_owned(),
                table: "missing".to_owned(),
                index: "byId".to_owned(),
                key: vec![Expr::Literal(Value::Id("i1".to_owned()))],
                provenance: KeyProvenance::Const,
            })),
        ],
    };
    let checker = Checker::new(&schema, Ceilings::default());
    let errors = checker.check_all(&program).unwrap_err();
    let codes: Vec<_> = errors.iter().map(|error| error.code.as_str()).collect();
    assert!(codes.contains(&"E_WRITE_IN_QUERY"));
    assert!(codes.contains(&"E_EMIT_IN_QUERY"));
    assert!(codes.contains(&"E_AMBIENT_TIME"));
    assert!(codes.contains(&"E_UNBOUND_SCAN"));
    assert_eq!(
        checker.check(&program).unwrap_err().code,
        "E_WRITE_IN_QUERY"
    );

    let errors_with_bound = Checker::new(
        &schema,
        Ceilings {
            examined: 0,
            ..Ceilings::default()
        },
    )
    .check_all(&program)
    .unwrap_err();
    assert_eq!(errors_with_bound.last().unwrap().code, "E_BOUND");
    assert_eq!(
        errors_with_bound
            .iter()
            .filter(|error| error.code == "E_BOUND" || error.code == "E_STEPS")
            .count(),
        1,
        "only the first bound-analysis refusal follows the structural refusals"
    );

    let errors = Generation::certify(&project(vec![program], schema.clone()), Ceilings::default())
        .unwrap_err();
    let codes: Vec<_> = errors
        .iter()
        .map(|(_, error)| error.code.as_str())
        .collect();
    for expected in [
        "E_WRITE_IN_QUERY",
        "E_EMIT_IN_QUERY",
        "E_AMBIENT_TIME",
        "E_UNBOUND_SCAN",
        "E_EFFECT_UNKNOWN",
    ] {
        assert!(
            codes.contains(&expected),
            "missing {expected} from {codes:?}"
        );
    }

    let bounded = Program {
        name: "items.bounded".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::For {
            binding: "item".to_owned(),
            domain: LoopDomain::Page(Scan {
                site: "items.bounded".to_owned(),
                table: "items".to_owned(),
                index: "byId".to_owned(),
                prefix: Vec::new(),
                order: Order::Asc,
                take: Bound::Literal(10),
                after: None,
                before: None,
                range: None,
                provenance: KeyProvenance::Const,
            }),
            body: Vec::new(),
        }],
    };
    let bound_errors = Checker::new(
        &schema,
        Ceilings {
            examined: 1,
            index_entries: 1,
            steps: 1,
            ..Ceilings::default()
        },
    );
    let errors = bound_errors.check_all(&bounded).unwrap_err();
    assert_eq!(
        errors
            .iter()
            .map(|error| error.code.as_str())
            .collect::<Vec<_>>(),
        vec!["E_BOUND", "E_BOUND", "E_STEPS"],
        "every exceeded ceiling is returned"
    );
    assert!(errors[0].message.starts_with("examined entries 12"));
    assert!(errors[1].message.starts_with("index entries 12"));
    assert!(errors[2].message.starts_with("steps 61"));
}

#[test]
fn closure_and_output_estimates_follow_retained_shape_and_declared_maxima() {
    let schema = ceiling_schema(1024);
    let page = ceiling_scan(4095);
    let page_certificate = Checker::new(
        &schema,
        Ceilings {
            output_bytes: u64::MAX,
            closure_bytes: u64::MAX,
            ..Ceilings::default()
        },
    )
    .check(&page)
    .unwrap();
    assert_eq!(page_certificate.max_closure_bytes, 4_946_760);
    assert_named_ceiling(&schema, &page, Ceilings::default(), "closure bytes");

    let inbox_schema = spike_schema();
    let inbox = Checker::new(&inbox_schema, Ceilings::default())
        .check(&inbox_program(false))
        .expect("count-shaped inbox must retain only its bounded result rows");
    assert_eq!(inbox.max_closure_bytes, 39_800);

    let declared_max = 3 * 1024 * 1024;
    let text_schema = ceiling_schema(declared_max);
    let text = Checker::new(
        &text_schema,
        Ceilings {
            output_bytes: u64::MAX,
            ..Ceilings::default()
        },
    )
    .check(&ceiling_scan(1))
    .unwrap();
    assert_eq!(text.max_output_bytes, 3_145_915);
    assert!(text.max_output_bytes >= u64::from(declared_max));
    assert_named_ceiling(
        &text_schema,
        &ceiling_scan(1),
        Ceilings::default(),
        "output bytes",
    );
}

#[test]
fn one_valid_program_reports_every_default_ceiling_refusal() {
    let mut schema = ceiling_schema(1024);
    schema.tables.get_mut("items").unwrap().rules.read = RuleExpr::Exists {
        table: "items".to_owned(),
        index: "byId".to_owned(),
        key: vec![RuleTerm::Field("id".to_owned())],
        provenance: KeyProvenance::Shape,
        input_visibility: RuleInputVisibility::Readable,
    };
    let scan = match ceiling_scan(12_000).body.remove(0) {
        Stmt::Return(scan) => scan,
        _ => unreachable!(),
    };
    let program = Program {
        name: "items.everyCeiling".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "rows".to_owned(),
                value: scan,
            },
            Stmt::For {
                binding: "number".to_owned(),
                domain: LoopDomain::LiteralRange {
                    start: 0,
                    end_exclusive: 200_000,
                },
                body: vec![Stmt::Insert {
                    table: "items".to_owned(),
                    row: Expr::Object(BTreeMap::from([
                        ("id".to_owned(), Expr::Input(Input::NewId)),
                        (
                            "body".to_owned(),
                            Expr::Literal(Value::String("x".to_owned())),
                        ),
                    ])),
                }],
            },
            Stmt::Return(Expr::Variable("rows".to_owned())),
        ],
    };
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    let expected = [
        "examined entries",
        "index entries",
        "rule probes",
        "steps",
        "heap bytes",
        "output bytes",
        "closure bytes",
        "write amplification",
    ];
    assert_eq!(
        errors.len(),
        expected.len(),
        "unexpected refusals: {errors:?}"
    );
    for name in expected {
        assert!(
            errors.iter().any(|error| error.message.starts_with(name)),
            "missing {name} from {errors:?}"
        );
    }
}

#[test]
fn checker_reports_recurse_read_refusals_with_other_errors() {
    let items = public_table(
        BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
    );
    let schema = Schema {
        tables: BTreeMap::from([("items".to_owned(), items)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let recurse = |site: &str, table: &str, index: &str| Stmt::For {
        binding: "row".to_owned(),
        domain: LoopDomain::Recurse(Recurse {
            site: site.to_owned(),
            table: table.to_owned(),
            index: index.to_owned(),
            seed: Box::new(Expr::Literal(Value::Id("seed".to_owned()))),
            next_field: "parent".to_owned(),
            depth: 0,
            fanout: 1,
            provenance: KeyProvenance::Const,
        }),
        body: Vec::new(),
    };
    let program = Program {
        name: "items.invalidRecurse".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "ambient".to_owned(),
                value: Expr::Input(Input::Now),
            },
            recurse("missing.table", "missing", "byId"),
            recurse("missing.index", "items", "missing"),
            recurse("reserved.table", "_commits", "byId"),
        ],
    };

    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert_eq!(
        errors
            .iter()
            .map(|error| error.code.as_str())
            .collect::<Vec<_>>(),
        vec![
            "E_AMBIENT_TIME",
            "E_UNBOUND_SCAN",
            "E_UNBOUND_SCAN",
            "E_SCHEMA_RESERVED",
        ]
    );
}

#[test]
fn mutation_value_errors_are_rejected_but_query_value_errors_remain_errors() {
    fn operation(name: &str, kind: ProgramKind, expression: Expr) -> Program {
        Program {
            name: name.to_owned(),
            kind,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(expression)],
        }
    }
    fn div_zero() -> Expr {
        Expr::Builtin {
            builtin: Builtin::Divmod {
                remainder_sink: "stable".to_owned(),
            },
            args: vec![Expr::Literal(Value::Int(1)), Expr::Literal(Value::Int(0))],
        }
    }
    let mutations = vec![
        operation("ops.divZero", ProgramKind::Mutation, div_zero()),
        operation(
            "ops.overflow",
            ProgramKind::Mutation,
            Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(Expr::Literal(Value::Int(I53_MAX))),
                right: Box::new(Expr::Literal(Value::Int(1))),
            },
        ),
        operation(
            "ops.type",
            ProgramKind::Mutation,
            Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(Expr::Literal(Value::String("one".to_owned()))),
                right: Box::new(Expr::Literal(Value::Int(1))),
            },
        ),
        operation(
            "ops.field",
            ProgramKind::Mutation,
            field(Expr::Literal(Value::Row(BTreeMap::new())), "missing"),
        ),
        operation("ops.queryDivZero", ProgramKind::Query, div_zero()),
    ];
    let generation =
        Generation::certify(&project(mutations, empty_schema()), Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    for (operation, expected) in [
        ("ops.divZero", "E_DIV_ZERO"),
        ("ops.overflow", "E_OVERFLOW"),
        ("ops.type", "E_TYPE"),
        ("ops.field", "E_FIELD"),
    ] {
        let execution = runtime
            .execute(operation, Context::mutation("u1", BTreeMap::new()))
            .unwrap();
        assert!(matches!(
            execution.state,
            ExecutionState::Rejected { ref code, .. } if code == expected
        ));
    }
    assert!(matches!(
        runtime.execute("ops.queryDivZero", Context::query("u1", BTreeMap::new())),
        Err(RuntimeError::Value(ValueError::DivideByZero))
    ));
}

#[test]
fn mutation_refusal_is_a_typed_rejected_execution_without_a_commit() {
    let program = Program {
        name: "ops.reject".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Require {
            condition: Expr::Literal(Value::Bool(false)),
            code: "NOPE".to_owned(),
        }],
    };
    let generation =
        Generation::certify(&project(vec![program], empty_schema()), Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let execution = runtime
        .execute("ops.reject", Context::mutation("u1", BTreeMap::new()))
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "NOPE"
    ));
    assert_eq!(execution.seq, 0);
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    assert_eq!(
        serde_json::to_value(ExecutionState::Complete).unwrap(),
        serde_json::json!({ "state": "complete" })
    );
}

#[test]
fn query_require_is_a_typed_denied_execution() {
    let program = Program {
        name: "ops.refuseQuery".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Require {
            condition: Expr::Literal(Value::Bool(false)),
            code: "QUERY_REFUSED".to_owned(),
        }],
    };
    let generation =
        Generation::certify(&project(vec![program], empty_schema()), Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let execution = runtime
        .execute("ops.refuseQuery", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert_eq!(
        execution.state,
        ExecutionState::Denied {
            rule: "QUERY_REFUSED".to_owned()
        }
    );
}

#[test]
fn sqlite_and_declared_unique_constraints_are_typed_mutation_rejections() {
    let rows = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("email".to_owned(), ColumnType::Text { max: 128 }),
        ]),
        BTreeMap::new(),
    );
    let schema = Schema {
        tables: BTreeMap::from([("users".to_owned(), rows)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: vec!["audit".to_owned()],
    };
    let duplicate_row = object([
        ("id", Value::Id("u1".to_owned())),
        ("email", Value::String("one@example.com".to_owned())),
    ]);
    let duplicate_primary_key = Program {
        name: "users.duplicatePrimaryKey".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "users".to_owned(),
                row: Expr::Literal(duplicate_row.clone()),
            },
            Stmt::Insert {
                table: "users".to_owned(),
                row: Expr::Literal(duplicate_row),
            },
        ],
    };
    let generation = Generation::certify(
        &project(vec![duplicate_primary_key.clone()], schema.clone()),
        Ceilings::default(),
    )
    .unwrap();
    let certificate = generation.programs[&duplicate_primary_key.name].1.clone();
    let mut engine = Engine::memory(schema).unwrap();
    let direct = engine
        .execute(
            &duplicate_primary_key,
            &certificate,
            Context::mutation("u1", BTreeMap::new()),
        )
        .unwrap();
    assert!(matches!(
        direct.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT"
    ));
    assert!(engine.rows("users").unwrap().is_empty());

    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let through_runtime = runtime
        .execute(
            "users.duplicatePrimaryKey",
            Context::mutation("u1", BTreeMap::new()),
        )
        .unwrap();
    assert!(matches!(
        through_runtime.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT"
    ));
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);

    let duplicate_outbox = Program {
        name: "ops.duplicateOutbox".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Emit {
                effect: "audit".to_owned(),
                payload: Expr::Literal(Value::Null),
            },
            Stmt::Emit {
                effect: "audit".to_owned(),
                payload: Expr::Literal(Value::Null),
            },
        ],
    };
    let generation = Generation::certify(
        &project(vec![duplicate_outbox], empty_schema()),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation("u1", BTreeMap::new());
    context.new_ids = VecDeque::from(["same".to_owned(), "same".to_owned()]);
    let execution = runtime.execute("ops.duplicateOutbox", context).unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT"
    ));
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);

    let unique_users = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("email".to_owned(), ColumnType::Text { max: 128 }),
        ]),
        BTreeMap::from([(
            "byEmail".to_owned(),
            Index {
                columns: vec!["email".to_owned()],
                unique: true,
            },
        )]),
    );
    let unique_schema = Schema {
        tables: BTreeMap::from([("users".to_owned(), unique_users)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: vec!["audit".to_owned()],
    };
    let unique_violation = Program {
        name: "users.duplicateEmail".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "users".to_owned(),
                row: Expr::Literal(object([
                    ("id", Value::Id("u1".to_owned())),
                    ("email", Value::String("same@example.com".to_owned())),
                ])),
            },
            Stmt::Insert {
                table: "users".to_owned(),
                row: Expr::Literal(object([
                    ("id", Value::Id("u2".to_owned())),
                    ("email", Value::String("same@example.com".to_owned())),
                ])),
            },
        ],
    };
    let generation = Generation::certify(
        &project(vec![unique_violation], unique_schema),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let execution = runtime
        .execute(
            "users.duplicateEmail",
            Context::mutation("u1", BTreeMap::new()),
        )
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT"
    ));
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
}

#[test]
fn channel_admission_evaluates_one_args_row_under_the_selected_rule() {
    let memberships = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("room".to_owned(), ColumnType::Id),
            ("user".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byRoomUser".to_owned(),
            Index {
                columns: vec!["room".to_owned(), "user".to_owned()],
                unique: true,
            },
        )]),
    );
    let channel = Channel {
        args: BTreeMap::from([("room".to_owned(), ArgType::Scalar)]),
        publish: RuleExpr::Public {
            reason: "typing is public to members".to_owned(),
        },
        subscribe: RuleExpr::Exists {
            table: "memberships".to_owned(),
            index: "byRoomUser".to_owned(),
            key: vec![RuleTerm::Field("room".to_owned()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
            input_visibility: RuleInputVisibility::Readable,
        },
        ttl_ms: 10_000,
    };
    let schema = Schema {
        tables: BTreeMap::from([("memberships".to_owned(), memberships)]),
        maintains: Vec::new(),
        channels: BTreeMap::from([("typing".to_owned(), channel)]),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime
        .seed(&[(
            "memberships".to_owned(),
            object([
                ("id", Value::Id("m1".to_owned())),
                ("room", Value::Id("r1".to_owned())),
                ("user", Value::Id("u1".to_owned())),
            ]),
        )])
        .unwrap();
    let args = BTreeMap::from([("room".to_owned(), Value::Id("r1".to_owned()))]);
    let admitted = runtime
        .channel_admit(
            "typing",
            ChannelSide::Subscribe,
            &args,
            &Context::query("u1", BTreeMap::new()),
        )
        .unwrap();
    assert!(admitted.admitted);
    assert_eq!(admitted.rule_inputs.len(), 1);
    let refused = runtime
        .channel_admit(
            "typing",
            ChannelSide::Subscribe,
            &args,
            &Context::query("u2", BTreeMap::new()),
        )
        .unwrap();
    assert!(!refused.admitted);
    assert_eq!(refused.rule_inputs.len(), 1);

    let unrelated_seq = runtime
        .seed(&[(
            "memberships".to_owned(),
            object([
                ("id", Value::Id("m3".to_owned())),
                ("room", Value::Id("r1".to_owned())),
                ("user", Value::Id("u3".to_owned())),
            ]),
        )])
        .unwrap();
    let unrelated = runtime
        .store()
        .commits_since(unrelated_seq - 1, 1)
        .unwrap()
        .remove(0);
    assert!(!Runtime::channel_touched(&unrelated, &refused));

    let matching_seq = runtime
        .seed(&[(
            "memberships".to_owned(),
            object([
                ("id", Value::Id("m2".to_owned())),
                ("room", Value::Id("r1".to_owned())),
                ("user", Value::Id("u2".to_owned())),
            ]),
        )])
        .unwrap();
    let matching = runtime
        .store()
        .commits_since(matching_seq - 1, 1)
        .unwrap()
        .remove(0);
    assert!(Runtime::channel_touched(&matching, &refused));
}

#[test]
fn store_claim_settle_restart_and_requeue_accessors_are_durable() {
    let generation = Generation::certify(
        &project(
            vec![emit_program(ProgramKind::Mutation, "audit")],
            empty_schema(),
        ),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
    let mut context = Context::mutation("u1", BTreeMap::new());
    context.now = Some(100);
    context.new_ids = VecDeque::from(["outbox-1".to_owned(), "return-1".to_owned()]);
    runtime.execute("ops.audit", context).unwrap();

    let claimed = runtime
        .store()
        .outbox_claim_next(100, &["audit".to_owned()])
        .unwrap()
        .expect("queued row");
    assert_eq!(claimed.state, "running");
    assert_eq!(claimed.attempts, 1);
    assert_eq!(claimed.payload, Value::String("payload".to_owned()));
    assert_eq!(claimed.generation, Some(generation.hash));
    assert!(
        runtime
            .store()
            .outbox_claim_next(100, &["audit".to_owned()])
            .unwrap()
            .is_none()
    );

    runtime
        .store()
        .outbox_settle("outbox-1", "failed", None, Some("permanent"), None)
        .unwrap();
    assert!(runtime.store().outbox_requeue("outbox-1").unwrap());
    let requeued = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(requeued.state, "queued");
    assert_eq!(requeued.attempts, 0);
    let claimed = runtime
        .store()
        .outbox_claim_next(i64::MAX, &["audit".to_owned()])
        .unwrap()
        .unwrap();
    assert_eq!(claimed.attempts, 1);
    assert_eq!(runtime.store().outbox_mark_unknown_running().unwrap(), 1);
    assert_eq!(
        runtime
            .store()
            .outbox_get("outbox-1")
            .unwrap()
            .unwrap()
            .state,
        "sent_unknown"
    );
    assert!(
        runtime
            .store()
            .outbox_claim_next(i64::MAX, &["audit".to_owned()])
            .unwrap()
            .is_none()
    );
}

#[test]
fn store_open_adds_then_binding_columns_to_an_existing_outbox() {
    let path = temp_path();
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE _outbox (
                    id TEXT PRIMARY KEY, seq INTEGER NOT NULL, effect TEXT NOT NULL,
                    payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL,
                    next_at INTEGER NOT NULL, last_error TEXT, result TEXT,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                 );
                 INSERT INTO _outbox VALUES
                    ('old', 1, 'audit', '\"Null\"', 'queued', 0, 0, NULL, NULL, 0, 0);",
            )
            .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let old = store.outbox_get("old").unwrap().unwrap();
    assert_eq!(old.then_op, None);
    assert_eq!(old.generation, None);
    drop(store);
    cleanup(&path);
}

#[test]
fn execute_then_commits_bookkeeping_and_sent_settlement_once() {
    let path = temp_path();
    let generation = then_generation("async () => ({ providerId: 'p1' })");
    {
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
        leave_then_pending(&mut runtime);
        let execution = runtime
            .execute_then("notifications.record", then_context(), "outbox-1")
            .unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(
            runtime
                .store()
                .outbox_get("outbox-1")
                .unwrap()
                .unwrap()
                .state,
            "sent"
        );
        let then_commit = runtime
            .store()
            .commits_since(execution.seq - 1, 1)
            .unwrap()
            .remove(0);
        assert_eq!(then_commit.principal, "system");
        assert_eq!(then_commit.kind, "system");
    }

    let mut restarted = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    assert!(
        restarted
            .store()
            .outbox_then_pending(16)
            .unwrap()
            .is_empty()
    );
    let listed = restarted
        .execute("notifications.list", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert_eq!(listed.result.as_array().unwrap().len(), 1);
    assert!(
        restarted
            .execute_then("notifications.record", then_context(), "outbox-1")
            .unwrap_err()
            .to_string()
            .contains("not then_pending")
    );
    let listed = restarted
        .execute("notifications.list", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert_eq!(listed.result.as_array().unwrap().len(), 1);
    drop(restarted);
    cleanup(&path);
}

#[test]
fn changed_effect_source_fails_pending_then_without_running_new_target() {
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        then_generation("async () => ({ providerId: 'old' })"),
    )
    .unwrap();
    leave_then_pending(&mut runtime);
    runtime
        .apply_successor(then_generation("async () => ({ providerId: 'new' })"))
        .unwrap();
    let execution = runtime
        .execute_then("notifications.record", then_context(), "outbox-1")
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_EFFECT_THEN_CHANGED"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "failed");
    assert_eq!(row.last_error.as_deref(), Some("E_EFFECT_THEN_CHANGED"));
    let listed = runtime
        .execute("notifications.list", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert!(listed.result.as_array().unwrap().is_empty());
}

#[test]
fn rejected_then_is_sent_with_error_across_an_unchanged_effect_declaration() {
    let source = "async () => ({ providerId: 'same' })";
    let mut runtime = Runtime::open(Store::memory().unwrap(), then_generation(source)).unwrap();
    leave_then_pending(&mut runtime);
    runtime
        .apply_successor(then_generation_with_rejection(source, true))
        .unwrap();

    let execution = runtime
        .execute_then("notifications.record", then_context(), "outbox-1")
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "THEN_REFUSED"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "sent");
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|error| error.contains("THEN_REFUSED"))
    );
}

#[test]
fn rule_denied_then_is_rejected_and_settled_sent_in_the_same_transaction() {
    let source = "async () => ({ providerId: 'denied' })";
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        then_generation_with_rule(source, false, RuleExpr::Deny),
    )
    .unwrap();
    leave_then_pending(&mut runtime);

    let execution = runtime
        .execute_then("notifications.record", then_context(), "outbox-1")
        .unwrap();

    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "rule"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "sent");
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|error| error.contains("rule")),
        "the rejected then must remain visible on its outbox trace row"
    );
    let listed = runtime
        .execute("notifications.list", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert!(listed.result.as_array().unwrap().is_empty());
}

#[test]
fn undeclared_effect_is_failed_without_ever_becoming_running() {
    let generation = Generation::certify(
        &project(
            vec![emit_program(ProgramKind::Mutation, "audit")],
            empty_schema(),
        ),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation("u1", BTreeMap::new());
    context.now = Some(10);
    context.new_ids = VecDeque::from(["unknown-outbox".to_owned(), "return-id".to_owned()]);
    runtime.execute("ops.audit", context).unwrap();

    let mut successor = empty_schema();
    successor.effects = vec!["kept".to_owned()];
    let successor = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: successor,
            programs: vec![emit_program(ProgramKind::Mutation, "kept")],
            effects: vec![EffectDecl {
                name: "kept".to_owned(),
                grants: vec!["network".to_owned()],
                source: "effects/kept.ts".to_owned(),
                then: None,
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    runtime.apply_successor(successor).unwrap();
    let mut context = Context::mutation("u1", BTreeMap::new());
    context.now = Some(11);
    context.new_ids = VecDeque::from(["kept-outbox".to_owned(), "kept-return".to_owned()]);
    runtime.execute("ops.kept", context).unwrap();

    let claimed = runtime
        .store()
        .outbox_claim_next(11, &["kept".to_owned()])
        .unwrap()
        .expect("the declared row is claimed in the unknown-settlement transaction");
    assert_eq!(claimed.id, "kept-outbox");
    assert_eq!(claimed.state, "running");
    assert_eq!(claimed.attempts, 1);
    assert!(
        runtime
            .store()
            .outbox_claim_next(11, &["kept".to_owned()])
            .unwrap()
            .is_none()
    );
    let row = runtime
        .store()
        .outbox_get("unknown-outbox")
        .unwrap()
        .unwrap();
    assert_eq!(row.state, "failed");
    assert_eq!(row.attempts, 0);
    assert_eq!(row.then_op, None);
    assert_eq!(row.generation, None);
    assert_eq!(row.last_error.as_deref(), Some("E_EFFECT_UNKNOWN"));
}

fn then_generation(source: &str) -> Generation {
    then_generation_with_rejection(source, false)
}

fn then_generation_with_rejection(source: &str, reject: bool) -> Generation {
    then_generation_with_rule(source, reject, RuleExpr::PrincipalKind("system".to_owned()))
}

fn then_generation_with_rule(source: &str, reject: bool, write_rule: RuleExpr) -> Generation {
    let notifications = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("outboxId".to_owned(), ColumnType::Id),
        ]),
        indexes: BTreeMap::from([(
            "byOutbox".to_owned(),
            Index {
                columns: vec!["outboxId".to_owned()],
                unique: true,
            },
        )]),
        rules: Rules {
            read: RuleExpr::Public {
                reason: "test observation".to_owned(),
            },
            insert: write_rule.clone(),
            update: write_rule,
            delete: RuleExpr::Deny,
        },
        constraints: Vec::new(),
    };
    let emit = Program {
        name: "notifications.emit".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Emit {
            effect: "notifications.notify".to_owned(),
            payload: Expr::Literal(Value::Null),
        }],
    };
    let record = Program {
        name: "notifications.record".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("outboxId".to_owned(), ArgType::Id),
            ("effect".to_owned(), ArgType::Text { max: 100 }),
            ("result".to_owned(), ArgType::Json { max_bytes: 1_000 }),
        ]),
        read_time_granularity_ms: None,
        body: if reject {
            vec![Stmt::Require {
                condition: Expr::Literal(Value::Bool(false)),
                code: "THEN_REFUSED".to_owned(),
            }]
        } else {
            vec![Stmt::Insert {
                table: "notifications".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), Expr::Input(Input::NewId)),
                    ("outboxId".to_owned(), var("outboxId")),
                ])),
            }]
        },
    };
    let list = Program {
        name: "notifications.list".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "notifications.list".to_owned(),
            table: "notifications".to_owned(),
            index: "byOutbox".to_owned(),
            prefix: Vec::new(),
            order: Order::Asc,
            take: Bound::Literal(10),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::from([("notifications".to_owned(), notifications)]),
                maintains: Vec::new(),
                channels: BTreeMap::new(),
                auth: Auth::default(),
                effects: vec!["notifications.notify".to_owned()],
            },
            programs: vec![emit, record, list],
            effects: vec![EffectDecl {
                name: "notifications.notify".to_owned(),
                grants: vec!["http://127.0.0.1:1".to_owned()],
                source: source.to_owned(),
                then: Some("notifications.record".to_owned()),
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn leave_then_pending(runtime: &mut Runtime) {
    let mut emit = Context::mutation("u1", BTreeMap::new());
    emit.now = Some(10);
    emit.new_ids = VecDeque::from(["outbox-1".to_owned()]);
    runtime.execute("notifications.emit", emit).unwrap();
    runtime
        .store()
        .outbox_claim_next(10, &["notifications.notify".to_owned()])
        .unwrap()
        .unwrap();
    runtime
        .store()
        .outbox_settle(
            "outbox-1",
            "then_pending",
            Some(&serde_json::json!({ "providerId": "provider-1" })),
            None,
            None,
        )
        .unwrap();
}

fn then_context() -> Context {
    let mut context = Context::system();
    context.args = BTreeMap::from([
        ("outboxId".to_owned(), Value::Id("outbox-1".to_owned())),
        (
            "effect".to_owned(),
            Value::String("notifications.notify".to_owned()),
        ),
        (
            "result".to_owned(),
            object([("providerId", Value::String("provider-1".to_owned()))]),
        ),
    ]);
    context.now = Some(20);
    context.new_ids = VecDeque::from(["notification-1".to_owned()]);
    context
}

fn temp_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback2-outbox-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn cleanup(path: &Path) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = std::fs::remove_file(path);
    }
}
