// @ref LLP 1001#maintained-addresses — certified Runtime boundary regressions.
use super::*;

fn project(schema: Schema, programs: Vec<Program>) -> crate::ProjectJson {
    crate::ProjectJson {
        version: 1,
        schema,
        programs,
        effects: vec![],
        auth: crate::Auth::default(),
    }
}

#[test]
fn maximal_realm_receipt_fits_ordinary_point_certificate() {
    // Original R2 project/program, with a synthetic value at the declared 64-scalar realm maximum.
    let witness: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/evaluator/src/test-maintained-fixtures/roundtrip-3.json"
    ))
    .unwrap();
    let project: crate::ProjectJson = serde_json::from_value(witness["project"].clone()).unwrap();
    let generation = crate::Generation::certify(&project, Ceilings::default()).unwrap();
    let certificate = generation.programs()["counts.byAddress"].1.clone();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let principal = Value::Id("a".repeat(135));
    let realm = Value::String("😀".repeat(64));
    let address = Value::Id(canonical_json(&vec![principal.clone(), realm.clone()]));
    let source = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("maximal".into())),
            ("principal".into(), principal),
            ("realm".into(), realm),
        ])
        .into(),
    );
    runtime
        .seed(&[("memberships".into(), source.clone())])
        .unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let result = runtime.execute(
        "counts.byAddress",
        Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([("address".into(), address.clone())]),
        ),
    );
    println!(
        "maximal_input={}",
        canonical_json(
            &serde_json::json!({"project":project,"source":source,"address":address,"certificate":certificate})
        )
    );
    println!(
        "maximal_result={result:?} seq_before={before} seq_after={}",
        runtime.store().commit_seq().unwrap()
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    let execution = result.unwrap();
    println!("maximal_execution={}", canonical_json(&execution));
    println!(
        "maximal_bytes={}",
        canonical_json(&serde_json::json!({
            "address":canonical_json(&address).len(),"row":canonical_json(&execution.result).len(),
            "receipt":canonical_json(&execution.receipt).len(),"maxClosure":certificate.max_closure_bytes,
            "maxOutput":certificate.max_output_bytes
        }))
    );
    assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
    assert!(canonical_json(&execution.receipt).len() as u64 <= certificate.max_closure_bytes);
    let mut held = crate::ClientStore::hydrate(project.schema.clone(), &execution.receipt).unwrap();
    let (state, replay) = held
        .reexecute(
            &project.programs[0],
            &certificate,
            Context::query(
                Actor::user("alice").unwrap(),
                BTreeMap::from([("address".into(), address)]),
            ),
        )
        .unwrap();
    assert_eq!(state, crate::LocalState::Fresh);
    assert_eq!(replay.result, execution.result);

    // A reduced result still discloses and retains the same complete first row image.
    let mut reduced = project.programs[0].clone();
    let Stmt::Return(Expr::Get(read)) = &reduced.body[0] else {
        panic!("original point witness must remain a Get");
    };
    reduced.body[0] = Stmt::Return(Expr::Exists(read.clone()));
    reduced.name = "counts.exists".into();
    let reduced_project = crate::ProjectJson {
        programs: vec![reduced.clone()],
        ..project
    };
    let generation = crate::Generation::certify(&reduced_project, Ceilings::default()).unwrap();
    let certificate = generation.programs()["counts.exists"].1.clone();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime.seed(&[("memberships".into(), source)]).unwrap();
    let context = Context::query(
        Actor::user("alice").unwrap(),
        BTreeMap::from([(
            "address".into(),
            execution.receipt.rows[0].row.field("id").unwrap().clone(),
        )]),
    );
    let execution = runtime.execute("counts.exists", context.clone()).unwrap();
    assert_eq!(execution.result, Value::Bool(true));
    assert_eq!(execution.receipt.rows.len(), 1);
    assert!(canonical_json(&execution.receipt).len() as u64 <= certificate.max_closure_bytes);
    assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
    let mut held = crate::ClientStore::hydrate(reduced_project.schema, &execution.receipt).unwrap();
    let (state, replay) = held.reexecute(&reduced, &certificate, context).unwrap();
    assert_eq!(state, crate::LocalState::Fresh);
    assert_eq!(replay.result, Value::Bool(true));
}

#[test]
fn cyclic_exists_refuses_custody_domain_but_unrelated_query_runs() {
    let mut schema = maintained_boundary_schema();
    for name in ["memberships", "membershipCounts"] {
        schema.tables.get_mut(name).unwrap().columns.insert(
            "principal".into(),
            ColumnType::Ref {
                table: "membershipCounts".into(),
            },
        );
    }
    let ordinary = Program {
        name: "ordinary".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Int(7)))],
    };
    let consumer = Program {
        name: "cyclic.exists".into(),
        args: BTreeMap::from([(
            "address".into(),
            ArgType::Ref {
                table: "membershipCounts".into(),
            },
        )]),
        body: vec![Stmt::Return(Expr::Exists(Read {
            site: "exists".into(),
            table: "membershipCounts".into(),
            index: "byId".into(),
            key: vec![Expr::Variable("address".into())],
            provenance: KeyProvenance::Arg,
        }))],
        ..ordinary.clone()
    };
    let consuming = project(schema.clone(), vec![consumer]);
    let checked = crate::Generation::certify(&consuming, Ceilings::default());
    println!("cyclic_exists_project={}", canonical_json(&consuming));
    let errors = match checked {
        Ok(generation) => {
            println!(
                "cyclic_exists_certificate={}",
                canonical_json(&generation.programs()["cyclic.exists"].1)
            );
            let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
            let source = Value::Row(
                BTreeMap::from([
                    ("id".into(), Value::Id("source".into())),
                    ("principal".into(), Value::Id("short".into())),
                ])
                .into(),
            );
            runtime.seed(&[("memberships".into(), source)]).unwrap();
            let address = Value::Id(canonical_json(&vec![Value::Id("short".into())]));
            let before = runtime.store().commit_seq().unwrap();
            let result = runtime.execute(
                "cyclic.exists",
                Context::query(
                    Actor::user("alice").unwrap(),
                    BTreeMap::from([("address".into(), address)]),
                ),
            );
            println!(
                "cyclic_exists_result={result:?} seq_before={before} seq_after={}",
                runtime.store().commit_seq().unwrap()
            );
            assert_eq!(runtime.store().commit_seq().unwrap(), before);
            None
        }
        Err(errors) => {
            println!("cyclic_exists_refusal={errors:?}");
            Some(errors)
        }
    };
    let generation =
        crate::Generation::certify(&project(schema, vec![ordinary]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    assert_eq!(
        runtime
            .execute(
                "ordinary",
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new())
            )
            .unwrap()
            .result,
        Value::Int(7)
    );
    assert!(errors.is_some_and(|errors| errors.iter().any(|(_, error)| error.code == "E_BOUND")));
}

#[test]
fn removing_maintain_rebuilds_before_surviving_index_admission() {
    let schema = maintained_boundary_schema();
    let generation =
        crate::Generation::certify(&project(schema.clone(), vec![]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let source = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("source".into())),
            ("principal".into(), Value::Id("a".repeat(135))),
        ])
        .into(),
    );
    runtime.seed(&[("memberships".into(), source)]).unwrap();
    let old_rows = runtime.engine.rows("membershipCounts").unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let old_generation = runtime.generation().hash();
    let mut next = schema;
    next.maintains.clear();
    next.tables
        .get_mut("membershipCounts")
        .unwrap()
        .indexes
        .insert(
            "byValue".into(),
            Index {
                components: vec!["value".into(), "id".into()]
                    .into_iter()
                    .map(crate::search_key::IndexComponent::Column)
                    .collect(),
                unique: false,
            },
        );
    let next = crate::Generation::certify(&project(next, vec![]), Ceilings::default()).unwrap();
    let result = runtime.apply_successor_at(next, 0);
    println!(
        "remove_maintain_result={result:?} seq_before={before} seq_after={} old_generation={old_generation} current_generation={} rows={:?}",
        runtime.store().commit_seq().unwrap(),
        runtime.generation().hash(),
        runtime.engine.rows("membershipCounts")
    );
    if result.is_err() {
        assert_eq!(runtime.store().commit_seq().unwrap(), before);
        assert_eq!(runtime.generation().hash(), old_generation);
        assert_eq!(runtime.engine.rows("membershipCounts").unwrap(), old_rows);
    }
    assert!(
        result.is_ok(),
        "predecessor-owned projection should be removed before successor index inputs are admitted"
    );
    assert!(runtime.engine.rows("membershipCounts").unwrap().is_empty());
    assert_eq!(runtime.engine.rows("memberships").unwrap().len(), 1);
    assert!(
        runtime.generation().schema().tables["membershipCounts"]
            .indexes
            .contains_key("byValue")
    );
}

#[test]
fn removing_maintain_checks_survivors_and_rolls_back_before_lawful_rebuild() {
    let schema = maintained_boundary_schema();
    let generation =
        crate::Generation::certify(&project(schema.clone(), vec![]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let source = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("source".into())),
            ("principal".into(), Value::Id("a".repeat(135))),
        ])
        .into(),
    );
    runtime.seed(&[("memberships".into(), source)]).unwrap();
    // Synthetic legacy storage: this row is outside the predecessor projection's exact owned IDs.
    let mut legacy = Value::Row(
        BTreeMap::from([
            ("id".into(), Value::Id("manual".into())),
            ("principal".into(), Value::Id("ordinary".into())),
            (
                "value".into(),
                Value::String("invalid consumed integer".into()),
            ),
        ])
        .into(),
    );
    runtime
        .store()
        .conn
        .execute(
            "INSERT INTO rows (table_name,row_id,data) VALUES (?1,?2,?3)",
            rusqlite::params!["membershipCounts", "manual", canonical_json(&legacy)],
        )
        .unwrap();
    let mut next = schema;
    next.maintains.clear();
    next.tables
        .get_mut("membershipCounts")
        .unwrap()
        .indexes
        .insert(
            "byValue".into(),
            Index {
                components: vec![
                    crate::search_key::IndexComponent::Column("value".into()),
                    crate::search_key::IndexComponent::Column("id".into()),
                ],
                unique: false,
            },
        );
    let generation =
        crate::Generation::certify(&project(next, vec![]), Ceilings::default()).unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let hash = runtime.generation().hash();
    let rows = runtime.engine.rows("membershipCounts").unwrap();
    let refusal = runtime
        .apply_successor_at(generation.clone(), 0)
        .unwrap_err();
    println!("surviving_index_refusal={refusal:?}");
    assert_eq!(refusal.code, "E_SUCCESSOR_STORE");
    assert!(refusal.message.contains("value"));
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(runtime.generation().hash(), hash);
    assert_eq!(runtime.engine.rows("membershipCounts").unwrap(), rows);
    let Value::Row(fields) = &mut legacy else {
        unreachable!()
    };
    fields.insert("value".into(), Value::Int(4));
    runtime
        .store()
        .conn
        .execute(
            "UPDATE rows SET data=?1 WHERE table_name=?2 AND row_id=?3",
            rusqlite::params![canonical_json(&legacy), "membershipCounts", "manual"],
        )
        .unwrap();
    runtime.apply_successor_at(generation, 0).unwrap();
    assert_eq!(
        runtime.engine.rows("membershipCounts").unwrap(),
        vec![legacy]
    );
    assert_eq!(runtime.engine.rows("memberships").unwrap().len(), 1);
}

#[test]
fn typed_reference_list_refusals_use_the_declared_target_before_fanout() {
    let mut schema = maintained_boundary_schema();
    let mut links = schema.tables["memberships"].clone();
    links.columns = BTreeMap::from([
        ("id".into(), ColumnType::Id),
        (
            "refs".into(),
            ColumnType::Optional(Box::new(ColumnType::List {
                of: Box::new(ColumnType::Optional(Box::new(ColumnType::Ref {
                    table: "membershipCounts".into(),
                }))),
                max: 1,
            })),
        ),
    ]);
    links.constraints.clear();
    links.indexes.retain(|name, _| name == "byId");
    schema.tables.insert("links".into(), links);
    let program = Program {
        name: "lists".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(
            "refs".into(),
            ArgType::List {
                of: Some(Box::new(ArgType::Ref {
                    table: "membershipCounts".into(),
                })),
                max: 1,
            },
        )]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Bool(true)))],
    };
    let generation =
        crate::Generation::certify(&project(schema, vec![program]), Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let long = Value::Id(canonical_json(&vec![Value::Id("a".repeat(135))]));
    let context = |refs| {
        Context::query(
            Actor::user("alice").unwrap(),
            BTreeMap::from([("refs".into(), Value::Array(refs))]),
        )
    };
    assert_eq!(
        runtime
            .execute("lists", context(vec![long.clone()]))
            .unwrap()
            .result,
        Value::Bool(true)
    );
    let before = runtime.store().commit_seq().unwrap();
    let short_error = runtime
        .execute("lists", context(vec![Value::Id("a".into()); 2]))
        .unwrap_err();
    let long_error = runtime
        .execute("lists", context(vec![long.clone(); 2]))
        .unwrap_err();
    println!("list_short_refusal={short_error:?} list_long_refusal={long_error:?}");
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(short_error.code(), "E_FANOUT");
    assert_eq!(long_error.code(), "E_FANOUT");
    let reserved = runtime
        .execute(
            "lists",
            context(vec![long.clone(), Value::Id("system".into())]),
        )
        .unwrap_err();
    assert_eq!(reserved.code(), "E_INPUT");
    assert!(reserved.to_string().contains("reserved system principal"));
    let shape = runtime
        .execute("lists", context(vec![Value::Bool(true); 2]))
        .unwrap_err();
    assert_eq!(
        shape.code(),
        "E_FANOUT",
        "fanout precedes element type checks after identity preflight"
    );
    let row = |id: &str, refs| {
        Value::Row(
            BTreeMap::from([
                ("id".into(), Value::Id(id.into())),
                ("refs".into(), Value::Array(refs)),
            ])
            .into(),
        )
    };
    runtime
        .seed(&[("links".into(), row("valid", vec![long.clone()]))])
        .unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let rows = runtime.engine.rows("links").unwrap();
    let error = runtime
        .seed(&[("links".into(), row("oversize", vec![long; 2]))])
        .unwrap_err();
    println!("stored_optional_reference_list_refusal={error:?}");
    assert_eq!(error.code(), "E_INPUT");
    assert!(error.to_string().contains("violates Optional(List"));
    assert_eq!(runtime.store().commit_seq().unwrap(), before);
    assert_eq!(runtime.engine.rows("links").unwrap(), rows);
}

#[test]
fn sparse_aggregate_lifecycle_matches_rebuild_timers_and_rollback() {
    use crate::search_key::IndexComponent;
    use crate::timers::{Schedule, Trigger};

    let index = |columns: &[&str], unique| Index {
        components: columns
            .iter()
            .map(|column| IndexComponent::Column((*column).into()))
            .collect(),
        unique,
    };
    let source = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("label".into(), ColumnType::Text { max: 20 }),
            ("at".into(), ColumnType::Time),
            ("amount".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            ("byId".into(), index(&["id"], true)),
            ("byGroup".into(), index(&["label", "at", "id"], false)),
        ]),
    );
    let target = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("label".into(), ColumnType::Text { max: 20 }),
            ("at".into(), ColumnType::Time),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            ("byId".into(), index(&["id"], true)),
            ("byAt".into(), index(&["at"], true)),
            ("byValue".into(), index(&["value"], true)),
            (
                "byWords".into(),
                Index {
                    unique: false,
                    components: vec![
                        IndexComponent::WordPrefixes {
                            fields: vec!["label".into()],
                            contract: crate::search_key::SearchContract::Unicode17,
                        },
                        IndexComponent::Column("at".into()),
                        IndexComponent::Column("id".into()),
                    ],
                },
            ),
        ]),
    );
    let schema = Schema {
        tables: BTreeMap::from([("ledger".into(), source), ("balances".into(), target)]),
        maintains: vec![Maintain {
            kind: MaintainKind::Sum {
                of: "amount".into(),
            },
            source: "ledger".into(),
            by: vec!["label".into(), "at".into()],
            target: "balances".into(),
            readable: Some(RuleExpr::Allow),
        }],
        schedules: vec![Schedule {
            name: "balance.due".into(),
            trigger: Trigger::Row {
                table: "balances".into(),
                column: "at".into(),
            },
            target: "noop".into(),
            binding: "noop.bind".into(),
            site: "test:1:1".into(),
        }],
        ..Schema::default()
    };
    let row = |id: &str, at: i64, amount: i64| {
        object([
            ("id", Value::Id(id.into())),
            ("label", Value::String("room".into())),
            ("at", Value::Int(at)),
            ("amount", Value::Int(amount)),
        ])
    };
    let run = |engine: &mut Engine, name: &str, body: Vec<Stmt>| {
        let program = Program {
            name: name.into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body,
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        assert!(
            certificate
                .write_sites
                .iter()
                .any(|write| write.table == "_timers"),
            "maintained target schedules are part of the certified write bound"
        );
        engine.execute(
            &program,
            &certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
    };
    let insert = |value| Stmt::Insert {
        table: "ledger".into(),
        row: Expr::Literal(value),
    };
    let update = |id: &str, fields| Stmt::Update {
        table: "ledger".into(),
        key: Expr::Literal(Value::Id(id.into())),
        patch: Expr::Literal(fields),
    };
    let delete = |id: &str| Stmt::Delete {
        table: "ledger".into(),
        key: Expr::Literal(Value::Id(id.into())),
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();

    run(&mut engine, "insert.a", vec![insert(row("a", 100, 5))]).unwrap();
    assert_eq!(
        engine.rows("balances").unwrap()[0].field("value"),
        Ok(&Value::Int(5))
    );
    assert_eq!(engine.store.due_timers(1_000, 10).unwrap().len(), 1);

    run(&mut engine, "insert.b", vec![insert(row("b", 100, -5))]).unwrap();
    assert!(
        engine.rows("balances").unwrap().is_empty(),
        "a nonempty zero-sum group has the canonical absent target"
    );
    assert_eq!(
        engine
            .store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _search_postings WHERE table_name='balances'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    assert!(engine.store.due_timers(1_000, 10).unwrap().is_empty());

    run(
        &mut engine,
        "update.same",
        vec![update("b", object([("amount", Value::Int(-4))]))],
    )
    .unwrap();
    assert_eq!(
        engine.rows("balances").unwrap()[0].field("value"),
        Ok(&Value::Int(1))
    );
    assert_eq!(engine.store.due_timers(1_000, 10).unwrap().len(), 1);

    run(
        &mut engine,
        "update.move",
        vec![update("b", object([("at", Value::Int(200))]))],
    )
    .unwrap();
    assert_eq!(engine.rows("balances").unwrap().len(), 2);
    assert_eq!(engine.store.due_timers(1_000, 10).unwrap().len(), 2);

    run(&mut engine, "delete.a", vec![delete("a")]).unwrap();
    assert_eq!(engine.rows("balances").unwrap().len(), 1);
    assert_eq!(
        engine.rows("balances").unwrap()[0].field("at"),
        Ok(&Value::Int(200))
    );
    assert_eq!(engine.store.due_timers(1_000, 10).unwrap().len(), 1);

    let before_rows = engine.rows("balances").unwrap();
    let before_timers = engine.store.due_timers(1_000, 10).unwrap();
    let mut owned_ids = before_rows
        .iter()
        .map(|row| Ok(row.field("id")?.as_str()?.to_owned()))
        .collect::<Result<BTreeSet<_>, RuntimeError>>()
        .unwrap();
    let zero_id = canonical_json(&vec![Value::String("room".into()), Value::Int(100)]);
    owned_ids.insert(zero_id.clone());
    let mut projected = before_rows.clone();
    projected.push(object([
        ("id", Value::Id(zero_id)),
        ("label", Value::String("room".into())),
        ("at", Value::Int(100)),
        ("value", Value::Int(0)),
    ]));
    let tx = engine.store.conn.transaction().unwrap();
    rebuild_owned_aggregate_target(&tx, &schema, "balances", &owned_ids, projected).unwrap();
    tx.commit().unwrap();
    assert_eq!(engine.rows("balances").unwrap(), before_rows);
    assert_eq!(engine.store.due_timers(1_000, 10).unwrap(), before_timers);
    assert!(
        engine
            .store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _search_postings WHERE table_name='balances'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
            > 0
    );

    let refused = run(
        &mut engine,
        "rollback.zero",
        vec![
            update("b", object([("amount", Value::Int(0))])),
            Stmt::Require {
                site: None,
                condition: Expr::Literal(Value::Bool(false)),
                code: "ROLLBACK".into(),
            },
        ],
    );
    assert!(refused.is_err() || matches!(refused.unwrap().state, ExecutionState::Rejected { .. }));
    assert_eq!(engine.rows("balances").unwrap(), before_rows);
    assert_eq!(engine.store.due_timers(1_000, 10).unwrap(), before_timers);

    run(&mut engine, "delete.b", vec![delete("b")]).unwrap();
    assert!(engine.rows("balances").unwrap().is_empty());
    assert!(engine.store.due_timers(1_000, 10).unwrap().is_empty());
    assert_eq!(
        engine
            .store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _search_postings WHERE table_name='balances'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );

    let mut zero_projection = Engine::memory(schema.clone()).unwrap();
    for (name, value) in [
        ("zero.100.a", row("za", 100, 2)),
        ("zero.100.b", row("zb", 100, -2)),
        ("zero.200.a", row("zc", 200, 3)),
        ("zero.200.b", row("zd", 200, -3)),
    ] {
        run(&mut zero_projection, name, vec![insert(value)]).unwrap();
    }
    let tx = zero_projection.store.conn.transaction().unwrap();
    crate::successor::rebuild_target(&tx, &schema, "balances", BTreeSet::new()).unwrap();
    tx.commit().unwrap();
    assert!(zero_projection.rows("balances").unwrap().is_empty());

    // Address order puts 300 before 400, but the source row moves from 400
    // to 300. Releasing the old group's unique aggregate value first makes
    // the move admissible in both native and the receipt-only evaluator.
    let mut ordered = Engine::memory(schema.clone()).unwrap();
    run(&mut ordered, "ordered.a", vec![insert(row("a", 400, 1))]).unwrap();
    run(&mut ordered, "ordered.b", vec![insert(row("b", 400, 1))]).unwrap();
    run(&mut ordered, "ordered.c", vec![insert(row("c", 300, 1))]).unwrap();
    let unique_refusal = run(
        &mut ordered,
        "ordered.move",
        vec![update("b", object([("at", Value::Int(300))]))],
    );
    assert!(
        unique_refusal.is_err()
            || matches!(
                unique_refusal.unwrap().state,
                ExecutionState::Rejected { .. }
            )
    );
    let values = ordered
        .rows("balances")
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.field("at").unwrap().as_int().unwrap(),
                row.field("value").unwrap().as_int().unwrap(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(values.get(&400), Some(&2));
    assert_eq!(values.get(&300), Some(&1));

    let mut released = Engine::memory(schema.clone()).unwrap();
    run(
        &mut released,
        "released.insert",
        vec![insert(row("move", 400, 1))],
    )
    .unwrap();
    run(
        &mut released,
        "released.move",
        vec![update("move", object([("at", Value::Int(300))]))],
    )
    .unwrap();
    let released_rows = released.rows("balances").unwrap();
    assert_eq!(released_rows.len(), 1);
    assert_eq!(released_rows[0].field("at"), Ok(&Value::Int(300)));
    assert_eq!(released_rows[0].field("value"), Ok(&Value::Int(1)));

    let path = std::env::temp_dir().join(format!(
        "snapback3-sparse-evaluator-migration-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut v4_schema = schema.clone();
    for table in ["ledger", "balances"] {
        v4_schema.tables.get_mut(table).unwrap().columns.insert(
            "at".into(),
            ColumnType::Optional(Box::new(ColumnType::Time)),
        );
    }
    v4_schema
        .tables
        .get_mut("balances")
        .unwrap()
        .indexes
        .remove("byValue");
    let timer_target = Program {
        name: "noop".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("id".into(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    let timer_binding = Program {
        name: "noop.bind".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("id".into(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), Expr::Literal(Value::Bool(true))),
            (
                "args".into(),
                Expr::Object(BTreeMap::from([("id".into(), Expr::Variable("id".into()))])),
            ),
        ])))],
    };
    let v4_generation = crate::Generation::certify(
        &project(v4_schema.clone(), vec![timer_target, timer_binding]),
        Ceilings::default(),
    )
    .unwrap();
    {
        let mut runtime = crate::Runtime::open(Store::open(&path).unwrap(), v4_generation).unwrap();
        runtime
            .seed(&[("ledger".into(), row("legacy-a", 100, 5))])
            .unwrap();
        let cancelling = row("legacy-b", 100, -5);
        runtime
            .store()
            .conn
            .execute(
                "INSERT INTO rows(table_name,row_id,data) VALUES (?1,?2,?3)",
                rusqlite::params!["ledger", "legacy-b", canonical_json(&cancelling)],
            )
            .unwrap();
        crate::engine::reindex_row(&runtime.store().conn, &v4_schema, "ledger", &cancelling)
            .unwrap();
        let legacy = object([
            (
                "id",
                Value::Id(canonical_json(&vec![
                    Value::String("room".into()),
                    Value::Int(100),
                ])),
            ),
            ("label", Value::String("room".into())),
            ("at", Value::Int(100)),
            ("value", Value::Int(0)),
        ]);
        runtime
            .store()
            .conn
            .execute(
                "UPDATE rows SET data=?1 WHERE table_name='balances' AND row_id=?2",
                rusqlite::params![
                    canonical_json(&legacy),
                    legacy.field("id").unwrap().as_str().unwrap()
                ],
            )
            .unwrap();
        crate::engine::reindex_row(&runtime.store().conn, &v4_schema, "balances", &legacy).unwrap();
        let survivor = object([
            ("id", Value::Id("legacy-survivor".into())),
            ("label", Value::String("room".into())),
            ("at", Value::Int(999)),
            ("value", Value::Int(0)),
        ]);
        runtime
            .store()
            .conn
            .execute(
                "INSERT INTO rows(table_name,row_id,data) VALUES (?1,?2,?3)",
                rusqlite::params!["balances", "legacy-survivor", canonical_json(&survivor)],
            )
            .unwrap();
        crate::engine::reindex_row(&runtime.store().conn, &v4_schema, "balances", &survivor)
            .unwrap();
        for (id, at) in [("legacy-conflict-a", 997), ("legacy-conflict-b", 998)] {
            let conflict = object([
                ("id", Value::Id(id.into())),
                ("label", Value::String("room".into())),
                ("at", Value::Int(at)),
                ("value", Value::Int(7)),
            ]);
            runtime
                .store()
                .conn
                .execute(
                    "INSERT INTO rows(table_name,row_id,data) VALUES (?1,?2,?3)",
                    rusqlite::params!["balances", id, canonical_json(&conflict)],
                )
                .unwrap();
            crate::engine::reindex_row(&runtime.store().conn, &v4_schema, "balances", &conflict)
                .unwrap();
        }
        runtime.store().conn.execute(
            "INSERT INTO _meta(key,value) VALUES ('evaluator_version',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ["bounded-spike-rust-search-text-refinements-4"],
        ).unwrap();
    }
    let mut v5_schema = v4_schema.clone();
    v5_schema
        .tables
        .get_mut("balances")
        .unwrap()
        .indexes
        .insert("byValue".into(), index(&["value"], true));
    v5_schema.schedules.clear();
    let v5_generation =
        crate::Generation::certify(&project(v5_schema, vec![]), Ceilings::default()).unwrap();
    let refusal = match crate::Runtime::open(Store::open(&path).unwrap(), v5_generation.clone()) {
        Ok(_) => panic!("surviving unique conflict must refuse evaluator upgrade"),
        Err(refusal) => refusal,
    };
    assert_eq!(refusal.code, "E_SUCCESSOR_UNIQUE");
    {
        let store = Store::open(&path).unwrap();
        assert_eq!(
            store.meta("evaluator_version").unwrap().as_deref(),
            Some("bounded-spike-rust-search-text-refinements-4")
        );
        assert_eq!(
            store.due_timers(1_000, 10).unwrap().len(),
            1,
            "failed successor rolls back old timer cleanup"
        );
        store
            .conn
            .execute(
                "DELETE FROM rows WHERE table_name='balances' AND row_id='legacy-conflict-b'",
                [],
            )
            .unwrap();
        crate::engine::delete_index_row(&store.conn, "balances", "legacy-conflict-b").unwrap();
    }
    let reopened = crate::Runtime::open(Store::open(&path).unwrap(), v5_generation).unwrap();
    assert_eq!(
        reopened
            .store()
            .conn
            .query_row(
                "SELECT COUNT(*) FROM rows WHERE table_name='balances'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        2
    );
    let survivors = crate::engine::fetch_table_connection(&reopened.store().conn, "balances")
        .unwrap()
        .into_iter()
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        survivors,
        BTreeSet::from(["legacy-conflict-a".into(), "legacy-survivor".into()])
    );
    assert!(reopened.store().due_timers(1_000, 10).unwrap().is_empty());
    assert_eq!(
        reopened
            .store()
            .meta("evaluator_version")
            .unwrap()
            .as_deref(),
        Some(crate::certificate::CURRENT_EVALUATOR_VERSION)
    );
    drop(reopened);
    for candidate in [
        path.clone(),
        path.with_extension("sqlite-wal"),
        path.with_extension("sqlite-shm"),
    ] {
        let _ = std::fs::remove_file(candidate);
    }
}
