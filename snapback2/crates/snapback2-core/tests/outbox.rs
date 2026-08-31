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
    let certificate = &generation.programs()[&program.name].1;
    assert_eq!(
        certificate.write_sites,
        vec![WriteSite {
            table: "_outbox".to_owned(),
            kind: WriteKind::Emit,
            max_rows: 1,
        }]
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
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
fn reserved_system_principal_cannot_be_forged_as_an_application_actor() {
    assert_eq!(
        Actor::new(SYSTEM_PRINCIPAL_ID.to_owned(), "user"),
        Err(ActorError::ReservedSystem)
    );
    assert_eq!(
        Actor::new("u1", SYSTEM_PRINCIPAL_ID.to_owned()),
        Err(ActorError::ReservedSystem)
    );

    let program = emit_program(ProgramKind::Mutation, "audit");
    let generation = Generation::certify(
        &project(vec![program.clone()], empty_schema()),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();

    let actor = Actor::new("u1", "service").unwrap();
    let mut context = Context::mutation(actor, BTreeMap::new());
    context.new_ids = VecDeque::from(["user-effect".to_owned(), "user-result".to_owned()]);
    runtime.execute(&program.name, context).unwrap();

    let commits = runtime.store().commits_since(0, 1).unwrap();
    assert_eq!(commits[0].principal, "u1");
    assert_eq!(commits[0].kind, "mutation");
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
    assert!(generation.effects().contains_key("notifications.notify"));
    assert!(generation.programs().contains_key("notifications.send"));

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
            .execute(
                operation,
                Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
            )
            .unwrap();
        assert!(matches!(
            execution.state,
            ExecutionState::Rejected { ref code, .. } if code == expected
        ));
    }
    assert!(matches!(
        runtime.execute(
            "ops.queryDivZero",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new())
        ),
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
        .execute(
            "ops.reject",
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
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
fn auth_refusal_namespace_is_reserved_at_the_raw_ir_certificate_boundary() {
    let mut program = Program {
        name: "ops.reject".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::If {
            condition: Expr::Literal(Value::Bool(true)),
            then_body: vec![Stmt::Require {
                condition: Expr::Literal(Value::Bool(false)),
                code: "E_AUTH_SESSION".to_owned(),
            }],
            else_body: Vec::new(),
        }],
    };
    let schema = empty_schema();
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert!(
        errors.iter().any(|error| {
            error.code == "E_OP_RESERVED"
                && error.message
                    == "application refusal code E_AUTH_SESSION uses the reserved E_AUTH_* namespace"
                && error.rewrite
                    == "use an application-owned refusal code without the E_AUTH_ prefix"
        }),
        "raw nested require bypassed the reserved auth namespace: {errors:?}"
    );

    let certification =
        Generation::certify(&project(vec![program.clone()], schema), Ceilings::default())
            .unwrap_err();
    assert!(
        certification
            .iter()
            .any(|(name, error)| { name == "ops.reject" && error.code == "E_OP_RESERVED" }),
        "generation admission bypassed the reserved auth namespace: {certification:?}"
    );

    let Stmt::If { then_body, .. } = &mut program.body[0] else {
        unreachable!()
    };
    let Stmt::Require { code, .. } = &mut then_body[0] else {
        unreachable!()
    };
    *code = "ACCESS_DENIED".to_owned();
    Generation::certify(&project(vec![program], empty_schema()), Ceilings::default())
        .expect("application-owned refusal code should certify");
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
        .execute(
            "ops.refuseQuery",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
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
    let certificate = generation.programs()[&duplicate_primary_key.name].1.clone();
    let mut engine = Engine::memory(schema).unwrap();
    let direct = engine
        .execute(
            &duplicate_primary_key,
            &certificate,
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
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
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
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
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
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
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
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
            ("user".to_owned(), ColumnType::Principal),
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
        args: BTreeMap::from([("room".to_owned(), ArgType::Id)]),
        publish: RuleExpr::Public {
            reason: "typing is public to members".to_owned(),
        },
        subscribe: RuleExpr::Exists {
            table: "memberships".to_owned(),
            index: "byRoomUser".to_owned(),
            key: vec![RuleTerm::Field("room".to_owned()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
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
    let subscribe_certificate = &generation.channel_certificates()["typing"].subscribe;
    assert_eq!(subscribe_certificate.max_rule_probes, 1);
    assert_eq!(subscribe_certificate.max_steps, 2);
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
            &Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert!(admitted.admitted);
    assert_eq!(admitted.rule_inputs.len(), 1);
    let refused = runtime
        .channel_admit(
            "typing",
            ChannelSide::Subscribe,
            &args,
            &Context::query(Actor::user("u2").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert!(!refused.admitted);
    assert_eq!(refused.rule_inputs.len(), 1);
    let reserved_scalar = runtime.channel_admit(
        "typing",
        ChannelSide::Subscribe,
        &BTreeMap::from([(
            "room".to_owned(),
            Value::Id(SYSTEM_PRINCIPAL_ID.to_string()),
        )]),
        &Context::query(Actor::user("u2").unwrap(), BTreeMap::new()),
    );
    assert!(matches!(reserved_scalar, Err(RuntimeError::Input(_))));

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
fn channel_rules_are_refused_when_their_certified_probe_or_step_bound_exceeds_the_ceiling() {
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
    let probe = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byRoomUser".to_owned(),
        key: vec![RuleTerm::Field("room".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let schema = Schema {
        tables: BTreeMap::from([("memberships".to_owned(), memberships)]),
        channels: BTreeMap::from([(
            "typing".to_owned(),
            Channel {
                args: BTreeMap::from([("room".to_owned(), ArgType::Scalar)]),
                publish: RuleExpr::And(vec![probe.clone(), probe]),
                subscribe: RuleExpr::Allow,
                ttl_ms: 10_000,
            },
        )]),
        ..Schema::default()
    };
    let errors = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings {
            rule_probes: 1,
            steps: 1,
            ..Ceilings::default()
        },
    )
    .unwrap_err();

    assert!(
        errors
            .iter()
            .any(|(site, error)| { site == "channel.typing.publish" && error.code == "E_BOUND" })
    );
    assert!(
        errors
            .iter()
            .any(|(site, error)| { site == "channel.typing.publish" && error.code == "E_STEPS" })
    );
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

#[path = "outbox/lifecycle.rs"]
mod lifecycle;
