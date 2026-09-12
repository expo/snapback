use super::*;
use crate::certificate::{Ceilings, Checker};
use crate::programs::spike_schema;

fn insert_row() -> Expr {
    Expr::Object(BTreeMap::from([
        ("id".to_owned(), Expr::Input(Input::NewId)),
        ("ownerId".to_owned(), Expr::Input(Input::Viewer)),
        (
            "resourceId".to_owned(),
            Expr::Literal(Value::Id("resource-1".to_owned())),
        ),
    ]))
}

#[test]
fn unhoisted_insert_and_return_evaluate_new_id_twice() {
    let schema = spike_schema();
    let program = Program {
        name: "waitlist.unhoistedInsertAndReturn".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        // This is the raw duplicated IR shape the compiler must prevent by hoisting.
        body: vec![
            Stmt::Insert {
                table: "waitlist".to_owned(),
                row: insert_row(),
            },
            Stmt::Return(insert_row()),
        ],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    context.new_ids = VecDeque::from(["stored-id".to_owned(), "returned-id".to_owned()]);
    let mut engine = Engine::memory(schema).unwrap();
    let execution = engine.execute(&program, &certificate, context).unwrap();
    let stored = engine.rows("waitlist").unwrap();

    assert_eq!(
        stored[0].field("id").unwrap().as_str().unwrap(),
        "stored-id"
    );
    assert_eq!(
        execution.result.field("id").unwrap().as_str().unwrap(),
        "returned-id"
    );
    assert_ne!(
        stored[0].field("id").unwrap(),
        execution.result.field("id").unwrap()
    );
}

#[test]
fn insert_row_expression_is_shared_by_storage_and_return() {
    let schema = spike_schema();
    let program = Program {
        name: "waitlist.insertAndReturn".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "row".to_owned(),
                value: insert_row(),
            },
            Stmt::Insert {
                table: "waitlist".to_owned(),
                row: Expr::Variable("row".to_owned()),
            },
            Stmt::Return(Expr::Variable("row".to_owned())),
        ],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    context.new_ids = VecDeque::from(["generated-once".to_owned()]);
    let mut engine = Engine::memory(schema).unwrap();
    let execution = engine.execute(&program, &certificate, context).unwrap();
    let stored = engine.rows("waitlist").unwrap();

    assert_eq!(
        execution.result.field("id").unwrap().as_str().unwrap(),
        "generated-once"
    );
    assert_eq!(
        stored[0].field("id").unwrap().as_str().unwrap(),
        "generated-once"
    );
}

#[test]
fn mutually_exclusive_branch_writes_certify_and_execute_at_the_same_bound() {
    let schema = spike_schema();
    let insert = |suffix: &str| Stmt::Insert {
        table: "waitlist".to_owned(),
        row: Expr::Object(BTreeMap::from([
            ("id".to_owned(), Expr::Input(Input::NewId)),
            ("ownerId".to_owned(), Expr::Input(Input::Viewer)),
            (
                "resourceId".to_owned(),
                Expr::Literal(Value::Id(format!("resource-{suffix}"))),
            ),
        ])),
    };
    let program = Program {
        name: "waitlist.branchInsert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("chooseFirst".to_owned(), ArgType::Bool)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::If {
                condition: Expr::Variable("chooseFirst".to_owned()),
                then_body: vec![insert("first")],
                else_body: vec![insert("second")],
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.write_sites[0].max_rows, 1);

    for choose_first in [true, false] {
        let args = BTreeMap::from([("chooseFirst".to_owned(), Value::Bool(choose_first))]);
        let mut context = Context::mutation(Actor::user("u1").unwrap(), args);
        context.new_ids = VecDeque::from([format!("branch-{choose_first}")]);
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let execution = engine.execute(&program, &certificate, context).unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(engine.rows("waitlist").unwrap().len(), 1);
    }
}

#[test]
fn receipt_absence_missing_from_trace_is_rejected() {
    let mut connection = Connection::open_in_memory().unwrap();
    let transaction = connection.transaction().unwrap();
    let schema = Schema::default();
    let program = Program {
        name: "absence-bound".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let verdicts = Vec::new();
    let hashes = hashes::PolicyHashes::new(&schema);
    let mut runner = Runner::new(
        &transaction,
        &schema,
        &hashes,
        &certificate,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        &verdicts,
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
    );
    runner.receipt.absences.push((
        "items".to_owned(),
        "byId".to_owned(),
        vec![Value::Id("missing".to_owned())],
    ));

    let error = runner.assert_bounds().unwrap_err();
    assert!(error.to_string().starts_with("E_TRACE_SUBSET:"));
    assert!(
        matches!(error, RuntimeError::TraceSubset(message) if message.contains("receipt absence"))
    );
}

fn maintained_update_program() -> Program {
    Program {
        name: "cards.move".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Update {
            table: "cards".to_owned(),
            key: Expr::Literal(Value::Id("card-1".to_owned())),
            patch: Expr::Object(BTreeMap::from([(
                "columnId".to_owned(),
                Expr::Literal(Value::Id("column-2".to_owned())),
            )])),
        }],
    }
}

#[test]
fn maintained_amplification_must_match_the_derived_certificate_total() {
    let mut connection = Connection::open_in_memory().unwrap();
    let transaction = connection.transaction().unwrap();
    let schema = spike_schema();
    let program = maintained_update_program();
    let mut certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.maintained_amplification, 2);
    certificate.maintained_amplification = 1;
    let verdicts = Vec::new();
    let hashes = hashes::PolicyHashes::new(&schema);
    let runner = Runner::new(
        &transaction,
        &schema,
        &hashes,
        &certificate,
        Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        &verdicts,
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
    );

    let error = runner.assert_bounds().unwrap_err();
    assert!(
        matches!(error, RuntimeError::TraceSubset(message) if message.contains("maintained amplification 1 != derived 2"))
    );
}

#[test]
fn maintained_write_bounds_are_owned_by_each_target_table() {
    let mut schema = spike_schema();
    schema.tables.insert(
        "cardCountsMirror".to_owned(),
        schema.tables["cardCounts"].clone(),
    );
    let mut mirror = schema.maintains[0].clone();
    mirror.target = "cardCountsMirror".to_owned();
    schema.maintains.push(mirror);
    let program = maintained_update_program();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.maintained_amplification, 4);

    let mut connection = Connection::open_in_memory().unwrap();
    let transaction = connection.transaction().unwrap();
    let verdicts = Vec::new();
    let hashes = hashes::PolicyHashes::new(&schema);
    let mut runner = Runner::new(
        &transaction,
        &schema,
        &hashes,
        &certificate,
        Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        &verdicts,
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
    );
    runner.trace.writes.insert("cards".to_owned(), 1);
    runner.trace.writes.insert("cardCounts".to_owned(), 3);
    runner.trace.writes.insert("cardCountsMirror".to_owned(), 1);

    let error = runner.assert_bounds().unwrap_err();
    assert!(
        matches!(error, RuntimeError::TraceSubset(message) if message.contains("writes to cardCounts 3 > 2"))
    );
}

#[test]
fn indexed_rows_keep_first_images_across_growth_and_candidate_rollback() {
    let mut store = Store::memory().unwrap();
    let tx = store.conn.transaction().unwrap();
    let schema = Schema::default();
    let hashes = hashes::PolicyHashes::new(&schema);
    let program = Program {
        name: "row-membership".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut runner = Runner::new(
        &tx,
        &schema,
        &hashes,
        &cert,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
    );
    let image = |n| object([("id", Value::Id("same".into())), ("n", Value::Int(n))]);
    runner.record_row("a", "same", &image(0), true);
    let checkpoint = runner.candidate_checkpoint();
    // Equal ids in different tables stay distinct. Growth must retain the
    // receipt bit as well as every trace key, including collision chains.
    for n in 0..1025 {
        runner.record_row(&format!("table{n}"), "same", &image(n), true);
    }
    runner.record_row("a", "same", &image(1), true);
    runner.rollback_candidate(checkpoint);
    assert_eq!(runner.trace.rows.len(), 1026);
    assert_eq!(runner.receipt.rows.len(), 1);
    assert_eq!(runner.trace.rows[0].row, image(0));
    assert_eq!(runner.receipt.rows[0].row, image(0));
    for n in (0..1025).rev() {
        runner.record_row(&format!("table{n}"), "same", &image(n + 10), true);
    }
    assert_eq!(runner.trace.rows.len(), 1026);
    assert_eq!(runner.receipt.rows.len(), 1026);
    assert_eq!(runner.trace.rows[1].row, image(0));
    assert_eq!(runner.receipt.rows.last().unwrap().row, image(10));
    runner.assert_bounds().unwrap();
    // Containment still checks every receipt entry, independently of its bit.
    runner.receipt.rows.push(RowRecord {
        table: "unobserved".into(),
        id: "same".into(),
        row: image(0),
    });
    assert!(
        matches!(runner.assert_bounds(), Err(RuntimeError::TraceSubset(message))
        if message.contains("receipt row unobserved.same absent from trace"))
    );
}

#[test]
fn generation_hashes_match_canonical_inputs_and_replace_atomically() {
    let mut schema = spike_schema();
    schema.channels.insert(
        "presence".into(),
        Channel {
            value: BTreeMap::from([("typing".to_owned(), ArgType::Bool)]),
            args: BTreeMap::new(),
            publish: RuleExpr::Allow,
            subscribe: RuleExpr::Deny,
            ttl_ms: 1000,
        },
    );
    schema.tables.get_mut("cards").unwrap().rules.read = RuleExpr::Exists {
        table: "cards".into(),
        index: "byId".into(),
        key: vec![RuleTerm::Field("id".into())],
        provenance: KeyProvenance::Shape,
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let check = |engine: &Engine| {
        assert_eq!(engine.hashes.schema, engine.schema.hash());
        for (name, table) in &engine.schema.tables {
            for effect in [Effect::Read, Effect::Insert, Effect::Update, Effect::Delete] {
                assert_eq!(
                    engine.hashes.table(name, effect),
                    engine.schema.rule_hash(table.rules.for_effect(effect))
                );
            }
        }
        for channel in engine.schema.channels.values() {
            for rule in [&channel.publish, &channel.subscribe] {
                assert_eq!(engine.hashes.rule(rule), engine.schema.rule_hash(rule));
            }
        }
    };
    check(&engine);
    let copy = engine.memory_copy().unwrap();
    let predecessor = engine.hashes.schema.clone();
    schema.tables.get_mut("cards").unwrap().rules.read = RuleExpr::Deny;
    schema.channels.get_mut("presence").unwrap().subscribe = RuleExpr::Allow;
    engine.set_schema(schema.clone()).unwrap();
    assert_ne!(engine.hashes.schema, predecessor);
    assert_eq!(copy.hashes.schema, predecessor);
    check(&engine);
    check(&copy);
    schema
        .tables
        .get_mut("cards")
        .unwrap()
        .indexes
        .get_mut("byId")
        .unwrap()
        .components = vec![IndexComponent::Column("missing".into())];
    let installed = engine.hashes.schema.clone();
    assert!(engine.set_schema(schema).is_err());
    assert_eq!(engine.hashes.schema, installed);
    check(&engine);
}

#[test]
fn incoming_certificate_hashes_cannot_mint_runtime_policy_authority() {
    let frozen: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../corpus/merge-runtime-overlap-deduped.json"
    ))
    .unwrap();
    let schema: Schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
    let program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
    let mut cert = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    for hash in cert.rule_hashes.values_mut() {
        *hash = "forged".into();
    }
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let receipt: ClosureReceipt = serde_json::from_value(frozen["receipt"].clone()).unwrap();
    for row in receipt.rows {
        engine.seed(&row.table, row.row).unwrap();
    }
    let execution = engine
        .execute(
            &program,
            &cert,
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(execution.receipt.schema_hash, Some(schema.hash()));
    assert!(!execution.trace.ranges.is_empty());
    for range in &execution.trace.ranges {
        assert_eq!(
            range.rule_hash,
            schema.rule_hash(&schema.tables[&range.table].rules.read)
        );
    }
    cert.schema_hash = "forged".into();
    assert!(matches!(engine.execute(&program, &cert,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new())),
        Err(RuntimeError::TraceSubset(message)) if message == "schema hash mismatch"));
}

#[test]
fn conditional_updates_rollback_before_disclosing_current_and_absent_insert_never_discloses_a_duplicate() {
    use crate::schema::{ColumnType, Index, RuleExpr, RuleTerm};
    let index = Index { components: vec![crate::search_key::IndexComponent::Column("label".into())], unique: true };
    let mut table = crate::public_table(BTreeMap::from([
        ("id".into(), ColumnType::Id), ("label".into(), ColumnType::Text { max: 40 }),
        ("body".into(), ColumnType::Text { max: 40 }),
    ]), BTreeMap::from([("byLabel".into(), index)]));
    let by_id = Index { components: vec![crate::search_key::IndexComponent::Column("id".into())], unique: true };
    table.indexes.insert("byId".into(), by_id.clone());
    let mut grant = crate::public_table(BTreeMap::from([("id".into(), ColumnType::Id)]), BTreeMap::new());
    grant.indexes.insert("byId".into(), by_id);
    grant.rules.read = RuleExpr::Deny;
    table.rules.read = RuleExpr::Exists { table: "grants".into(), index: "byId".into(),
        key: vec![RuleTerm::Viewer], provenance: KeyProvenance::Viewer };
    let schema = Schema { tables: BTreeMap::from([("items".into(), table), ("grants".into(), grant)]), ..Schema::default() };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let row = object([("id", Value::Id("old".into())), ("label", Value::String("taken".into())), ("body", Value::String("private".into()))]);
    engine.seed("items", row.clone()).unwrap();
    let current = Read { site: "current".into(), table: "items".into(), index: "byId".into(),
        key: vec![Expr::Literal(Value::Id("old".into()))], provenance: KeyProvenance::Const };
    let program = Program { name: "guarded".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Insert { table: "grants".into(), row: Expr::Object(BTreeMap::from([("id".into(), Expr::Input(Input::Viewer))])) },
            Stmt::Check { condition: Expr::Literal(Value::Bool(false)), current: current.clone() }] };
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    let context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    let result = engine.execute(&program, &certificate, context.clone()).unwrap();
    assert!(matches!(result.state, ExecutionState::Rejected { ref code, .. } if code == "E_CONFLICT"));
    assert_eq!(result.result, Value::Null, "temporary grant survived rollback disclosure");
    assert!(engine.rows("grants").unwrap().is_empty());
    engine.seed("grants", object([("id", Value::Id("u1".into()))])).unwrap();
    let mut conflict = program.clone(); conflict.body.remove(0);
    let certificate = Checker::new(&schema, Ceilings::default()).check(&conflict).unwrap();
    assert_eq!(engine.execute(&conflict, &certificate, context.clone()).unwrap().result, row);
    let mut insert = conflict.clone(); insert.name = "create".into();
    insert.body = vec![Stmt::InsertIfAbsent { table: "items".into(), result: "result".into(),
        row: Expr::Object(BTreeMap::from([("id".into(), Expr::Literal(Value::Id("new".into()))),
            ("label".into(), Expr::Literal(Value::String("taken".into()))), ("body".into(), Expr::Literal(Value::String("ours".into())))])) },
        Stmt::Return(Expr::Variable("result".into()))];
    let certificate = Checker::new(&schema, Ceilings::default()).check(&insert).unwrap();
    let result = engine.execute(&insert, &certificate, Context::mutation(Actor::user("u2").unwrap(), BTreeMap::new())).unwrap();
    assert!(matches!(result.state, ExecutionState::Committed { .. }));
    assert_eq!(result.result, Value::Null);
    assert_eq!(engine.rows("items").unwrap(), vec![row]);
    assert!(result.receipt.rows.is_empty(), "duplicate row entered the receipt");
}

mod index_replacement {
    use super::*;
    use crate::search_key::SearchContract;

    fn fixture() -> Engine {
        let plain = |columns: &[&str], unique| Index {
            components: columns
                .iter()
                .map(|name| IndexComponent::Column((*name).into()))
                .collect(),
            unique,
        };
        let mut table = public_table(
            BTreeMap::from([
                ("id".into(), ColumnType::Id),
                ("group".into(), ColumnType::Id),
                ("label".into(), ColumnType::Text { max: 40 }),
                ("body".into(), ColumnType::Text { max: 40 }),
                ("score".into(), ColumnType::Int),
                (
                    "tag".into(),
                    ColumnType::Optional(Box::new(ColumnType::Text { max: 40 })),
                ),
            ]),
            BTreeMap::from([
                ("byId".into(), plain(&["id"], true)),
                ("byLabel".into(), plain(&["label"], true)),
                ("byGroup".into(), plain(&["group", "label", "id"], false)),
                ("byTag".into(), plain(&["tag", "id"], false)),
                (
                    "bySearch".into(),
                    Index {
                        components: vec![
                            IndexComponent::WordPrefixes {
                                fields: vec!["body".into()],
                                contract: SearchContract::Unicode17,
                            },
                            IndexComponent::Column("id".into()),
                        ],
                        unique: false,
                    },
                ),
            ]),
        );
        table.constraints.push(Constraint::Unique {
            index: "byLabel".into(),
        });
        let schema = Schema {
            tables: BTreeMap::from([("indexed".into(), table)]),
            ..Schema::default()
        };
        let mut engine = Engine::memory(schema).unwrap();
        for (id, label, body) in [("a", "é", "cafe alpha"), ("b", "other", "beta")] {
            engine
                .seed(
                    "indexed",
                    object([
                        ("id", Value::Id(id.into())),
                        ("group", Value::Id("g1".into())),
                        ("label", Value::String(label.into())),
                        ("body", Value::String(body.into())),
                        ("score", Value::Int(0)),
                        ("tag", Value::Null),
                    ]),
                )
                .unwrap();
        }
        // An independent physical-write witness: final index contents alone would
        // also pass if every unchanged entry were unnecessarily deleted and rebuilt.
        engine
            .store
            .conn
            .execute_batch(
                "CREATE TEMP TABLE physical_index_changes(index_name TEXT, kind TEXT);
             CREATE TEMP TRIGGER index_insert AFTER INSERT ON index_entries
             WHEN new.table_name = 'indexed' BEGIN
               INSERT INTO physical_index_changes VALUES(new.index_name, 'insert'); END;
             CREATE TEMP TRIGGER index_delete AFTER DELETE ON index_entries
             WHEN old.table_name = 'indexed' BEGIN
               INSERT INTO physical_index_changes VALUES(old.index_name, 'delete'); END;",
            )
            .unwrap();
        engine
    }

    fn update(patch: Value) -> Stmt {
        Stmt::Update {
            table: "indexed".into(),
            key: Expr::Literal(Value::Id("a".into())),
            patch: Expr::Literal(patch),
        }
    }

    fn execute(engine: &mut Engine, body: Vec<Stmt>) -> Execution {
        try_execute(engine, body).unwrap()
    }

    fn try_execute(engine: &mut Engine, body: Vec<Stmt>) -> Result<Execution, RuntimeError> {
        let program = Program {
            name: "indexed.update".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body,
        };
        let certificate = Checker::new(&engine.schema, Ceilings::default())
            .check(&program)
            .unwrap();
        engine.execute(
            &program,
            &certificate,
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
    }

    fn physical_changes(engine: &Engine) -> Vec<(String, String)> {
        engine
            .store
            .conn
            .prepare(
                "SELECT index_name, kind FROM physical_index_changes ORDER BY index_name, kind",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn assert_changed(engine: &Engine, names: &[&str]) {
        let mut expected: Vec<_> = names
            .iter()
            .flat_map(|name| {
                [
                    (name.to_string(), "delete".into()),
                    (name.to_string(), "insert".into()),
                ]
            })
            .collect();
        expected.sort();
        assert_eq!(physical_changes(engine), expected);
        engine
            .store
            .conn
            .execute("DELETE FROM physical_index_changes", [])
            .unwrap();
    }

    fn plain_entries(engine: &Engine) -> Vec<(String, String, Vec<Option<String>>)> {
        engine
            .store
            .conn
            .prepare(
                "SELECT index_name, row_id, c0,c1,c2,c3,c4,c5,c6,c7 FROM index_entries
             WHERE table_name = 'indexed' ORDER BY index_name, row_id",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    (2..10)
                        .map(|column| row.get(column))
                        .collect::<Result<_, _>>()?,
                ))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn search(engine: &mut Engine, term: &str) -> Value {
        let program = Program {
            name: "indexed.search".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Scan(Scan {
                site: "words".into(),
                table: "indexed".into(),
                index: "bySearch".into(),
                prefix: vec![IndexKeyExpr::WordPrefix {
                    source: Expr::Literal(Value::String(term.into())),
                    source_max: term.chars().count(),
                    contract: SearchContract::Unicode17,
                }],
                order: Order::Asc,
                take: Bound::Literal(10),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }))],
        };
        let certificate = Checker::new(&engine.schema, Ceilings::default())
            .check(&program)
            .unwrap();
        engine
            .execute(
                &program,
                &certificate,
                Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
            )
            .unwrap()
            .result
    }

    fn assert_matches_rebuild(engine: &mut Engine) {
        let mut rebuilt = Engine::memory(engine.schema.clone()).unwrap();
        for row in engine.rows("indexed").unwrap() {
            rebuilt.seed("indexed", row).unwrap();
        }
        assert_eq!(plain_entries(engine), plain_entries(&rebuilt));
        for term in ["cafe", "alpha", "beta", "gamma"] {
            assert_eq!(search(engine, term), search(&mut rebuilt, term));
        }
    }

    #[test]
    fn repeated_unique_declarations_keep_each_trace_and_refresh_after_a_row_write() {
        let mut engine = fixture();
        let execution = execute(
            &mut engine,
            vec![
                update(object([("label", Value::String("temporary".into()))])),
                update(object([("score", Value::Int(1))])),
            ],
        );
        assert_eq!(execution.trace.writes.get("indexed"), Some(&2));
        let checks = &execution.trace.constraint_inputs;
        assert_eq!(checks.len(), 6);
        for (offset, examined_ids) in [(0, vec![]), (3, vec!["a".to_owned()])] {
            let expected = ConstraintTrace {
                table: "indexed".into(),
                check: "Unique(byLabel)".into(),
                index: "byLabel".into(),
                prefix: vec![Value::String("temporary".into())],
                examined_ids,
            };
            assert_eq!(checks[offset], expected);
            assert_eq!(checks[offset + 2], expected);
            assert_eq!(checks[offset + 1].check, "Unique(byId)");
            assert_eq!(checks[offset + 1].examined_ids, vec!["a".to_owned()]);
        }
        assert_matches_rebuild(&mut engine);
        let rows = engine.rows("indexed").unwrap();
        let refusal = try_execute(
            &mut engine,
            vec![update(object([("label", Value::String("other".into()))]))],
        );
        assert!(matches!(refusal, Err(RuntimeError::Constraint(message)) if message.contains("indexed.byLabel")));
        assert_eq!(engine.rows("indexed").unwrap(), rows);
    }

    #[test]
    fn unchanged_keys_keep_physical_entries_and_logical_touches() {
        let mut engine = fixture();
        let before = plain_entries(&engine);
        let execution = execute(
            &mut engine,
            vec![update(object([
                ("score", Value::Int(1)),
                ("tag", Value::Null),
            ]))],
        );
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(execution.trace.writes.get("indexed"), Some(&1));
        assert_eq!(execution.trace.derived_steps, 0);
        assert_eq!(plain_entries(&engine), before);
        assert_changed(&engine, &[]);
        for name in ["byId", "byLabel", "byGroup", "byTag"] {
            assert!(
                execution
                    .trace
                    .touched
                    .iter()
                    .any(|touch| touch.table == "indexed"
                        && touch.index == name
                        && touch.row_id == "a")
            );
        }
        assert!(
            execution
                .trace
                .scope_touches
                .iter()
                .any(|touch| touch.table == "indexed" && touch.index == "bySearch")
        );
        assert_eq!(
            engine.rows("indexed").unwrap()[0].field("score").unwrap(),
            &Value::Int(1)
        );
        assert_matches_rebuild(&mut engine);
    }

    #[test]
    fn changed_text_compound_and_optional_keys_match_a_rebuild() {
        let mut engine = fixture();
        // Ordinary text keys compare exact typed values, independently of the
        // Unicode normalization contract belonging to the derived search index.
        for (patch, changed) in [
            (
                object([("label", Value::String("e\u{301}".into()))]),
                vec!["byLabel", "byGroup"],
            ),
            (object([("group", Value::Id("g2".into()))]), vec!["byGroup"]),
            (
                object([("tag", Value::String("tag".into()))]),
                vec!["byTag"],
            ),
            (object([("tag", Value::Null)]), vec!["byTag"]),
        ] {
            let execution = execute(&mut engine, vec![update(patch)]);
            assert!(matches!(execution.state, ExecutionState::Committed { .. }));
            assert_eq!(execution.trace.derived_steps, 0);
            assert_changed(&engine, &changed);
            assert_matches_rebuild(&mut engine);
        }
        let index = &engine.schema.tables["indexed"].indexes["byLabel"];
        assert!(
            lookup_indexed(
                &engine.store.conn,
                &engine.schema,
                "indexed",
                "byLabel",
                index,
                &[Value::String("é".into())]
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(
            lookup_indexed(
                &engine.store.conn,
                &engine.schema,
                "indexed",
                "byLabel",
                index,
                &[Value::String("e\u{301}".into())]
            )
            .unwrap()
            .unwrap()
            .field("id")
            .unwrap(),
            &Value::Id("a".into())
        );
        // A derived source change must still take the existing re-derivation path.
        let execution = execute(
            &mut engine,
            vec![update(object([(
                "body",
                Value::String("beta gamma".into()),
            )]))],
        );
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert!(execution.trace.derived_steps > 0);
        assert_matches_rebuild(&mut engine);
        assert_eq!(search(&mut engine, "cafe"), Value::Array(vec![]));
        assert_eq!(search(&mut engine, "beta").as_array().unwrap().len(), 2);
    }

    #[test]
    fn constraints_and_later_refusals_rollback_rows_and_index_changes() {
        let mut engine = fixture();
        let before_rows = engine.rows("indexed").unwrap();
        let before_entries = plain_entries(&engine);
        let unique = try_execute(
            &mut engine,
            vec![update(object([("label", Value::String("other".into()))]))],
        );
        assert!(
            matches!(unique, Err(RuntimeError::Constraint(message)) if message.contains("indexed.byLabel"))
        );
        assert_eq!(engine.rows("indexed").unwrap(), before_rows);
        assert_eq!(plain_entries(&engine), before_entries);
        assert_changed(&engine, &[]);
        for patch in [
            object([("label", Value::String("temporary".into()))]),
            object([("body", Value::String("gamma".into()))]),
        ] {
            let refusal = try_execute(
                &mut engine,
                vec![
                    update(patch),
                    Stmt::Require {
                        condition: Expr::Literal(Value::Bool(false)),
                        code: "rollback".into(),
                        site: None,
                    },
                ],
            );
            assert!(
                matches!(refusal, Err(RuntimeError::Require { code, .. }) if code == "rollback")
            );
            assert_eq!(engine.rows("indexed").unwrap(), before_rows);
            assert_eq!(plain_entries(&engine), before_entries);
            assert_changed(&engine, &[]);
            assert_matches_rebuild(&mut engine);
        }
    }
}
