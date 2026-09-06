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
        name: "row-membership".into(), kind: ProgramKind::Query,
        args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    let mut runner = Runner::new(&tx, &schema, &hashes, &cert,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        &[], &[], RuleAuthority::StoreAuthoritative, 0);
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
    runner.receipt.rows.push(RowRecord { table: "unobserved".into(), id: "same".into(), row: image(0) });
    assert!(matches!(runner.assert_bounds(), Err(RuntimeError::TraceSubset(message))
        if message.contains("receipt row unobserved.same absent from trace")));
}

#[test]
fn generation_hashes_match_canonical_inputs_and_replace_atomically() {
    let mut schema = spike_schema();
    schema.channels.insert("presence".into(), Channel {
        args: BTreeMap::new(), publish: RuleExpr::Allow, subscribe: RuleExpr::Deny, ttl_ms: 10,
    });
    schema.tables.get_mut("cards").unwrap().rules.read = RuleExpr::Exists {
        table: "cards".into(), index: "byId".into(),
        key: vec![RuleTerm::Field("id".into())], provenance: KeyProvenance::Shape,
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let check = |engine: &Engine| {
        assert_eq!(engine.hashes.schema, engine.schema.hash());
        for (name, table) in &engine.schema.tables {
            for effect in [Effect::Read, Effect::Insert, Effect::Update, Effect::Delete] {
                assert_eq!(engine.hashes.table(name, effect), engine.schema.rule_hash(table.rules.for_effect(effect)));
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
    schema.tables.get_mut("cards").unwrap().indexes.get_mut("byId").unwrap().columns = vec!["missing".into()];
    let installed = engine.hashes.schema.clone();
    assert!(engine.set_schema(schema).is_err());
    assert_eq!(engine.hashes.schema, installed);
    check(&engine);
}

#[test]
fn incoming_certificate_hashes_cannot_mint_runtime_policy_authority() {
    let frozen: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../corpus/merge-runtime-overlap-deduped.json"
    )).unwrap();
    let schema: Schema = serde_json::from_value(frozen["schema"].clone()).unwrap();
    let program: Program = serde_json::from_value(frozen["program"].clone()).unwrap();
    let mut cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    for hash in cert.rule_hashes.values_mut() { *hash = "forged".into(); }
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let receipt: ClosureReceipt = serde_json::from_value(frozen["receipt"].clone()).unwrap();
    for row in receipt.rows { engine.seed(&row.table, row.row).unwrap(); }
    let execution = engine.execute(&program, &cert,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new())).unwrap();
    assert_eq!(execution.receipt.schema_hash, Some(schema.hash()));
    assert!(!execution.trace.ranges.is_empty());
    for range in &execution.trace.ranges {
        assert_eq!(range.rule_hash, schema.rule_hash(&schema.tables[&range.table].rules.read));
    }
    cert.schema_hash = "forged".into();
    assert!(matches!(engine.execute(&program, &cert,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new())),
        Err(RuntimeError::TraceSubset(message)) if message == "schema hash mismatch"));
}
