//! A content table carrying `deliver` with its engine-generated log: the
//! corpus golden that binds the evaluator's canonical schema form to Rust's
//! `Schema::hash()` once the declaration is present, and the refusal of a
//! program that writes the log (LLP 1019 §1–§2).
use super::*;
use snapback2_core::delivery::{self, Deliver};

fn schema() -> Schema {
    let mut schema = Schema::default();
    schema.tables.insert(
        "conversations".to_owned(),
        public_table(
            columns([("id", ColumnType::Id)]),
            indexes([("byId", &["id"], true)]),
        ),
    );
    let mut memberships = public_table(
        columns([
            ("id", ColumnType::Id),
            (
                "conversationId",
                ColumnType::Ref {
                    table: "conversations".to_owned(),
                },
            ),
            ("principal", ColumnType::Principal),
        ]),
        indexes([
            ("byId", &["id"], true),
            (
                "byConversationPrincipal",
                &["conversationId", "principal"],
                false,
            ),
        ]),
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["conversationId".to_owned()],
        max: 3,
    });
    schema.tables.insert("memberships".to_owned(), memberships);
    let mut messages = public_table(
        columns([
            ("id", ColumnType::Id),
            (
                "conversationId",
                ColumnType::Ref {
                    table: "conversations".to_owned(),
                },
            ),
            ("authorId", ColumnType::Principal),
            ("body", ColumnType::Text { max: 256 }),
        ]),
        indexes([("byId", &["id"], true)]),
    );
    let deliver = Deliver {
        target: "memberships".to_owned(),
        prefix: vec!["conversationId".to_owned()],
        principal: "principal".to_owned(),
        log: "deliveries".to_owned(),
        receipts: false,
        bootstrap: false,
    };
    messages.deliver = Some(deliver.clone());
    schema.tables.insert("messages".to_owned(), messages);
    let log = delivery::log_table(&schema, "messages", &deliver).expect("log shape");
    schema.tables.insert("deliveries".to_owned(), log);
    schema
}

pub(super) fn add_delivery_cases(cases: &mut Vec<CorpusCase>) {
    add_write_cases(cases);
    add_bound_case(cases);
    let name = "deliver-log-schema-identity";
    let program = pure_program(
        name,
        Expr::Scan(Scan {
            site: "deliveries.inbox".to_owned(),
            table: "deliveries".to_owned(),
            index: "byRecipient".to_owned(),
            prefix: vec![IndexKeyExpr::Scalar(Expr::Input(Input::Viewer))],
            order: Order::Asc,
            take: Bound::Literal(10),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Viewer,
        }),
        &BTreeMap::new(),
    );
    let case = case_from_parts(
        name,
        "scenario",
        schema(),
        program,
        query_context([]),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    );
    let certificate = case.certificate.as_ref().expect("deliver certificate");
    assert_eq!(certificate.schema_hash, case.schema.hash(), "{name}");
    assert!(case.schema.tables["messages"].deliver.is_some(), "{name}");
    cases.push(case);

    let name = "deliver-owned-write-refused";
    let schema = schema();
    let program = Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "deliveries".to_owned(),
                row: Expr::Literal(object([
                    ("id", id("e1")),
                    ("recipient", id("u1")),
                    ("row", id("m1")),
                    ("incarnation", Value::Int(1)),
                    ("conversationId", id("c1")),
                    ("kind", text("delivered")),
                    ("audience", Value::Int(1)),
                    ("seq", Value::Int(1)),
                    ("at", Value::Int(1)),
                ])),
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    let code = "E_SCHEMA_DELIVER";
    let reason = "engine-owned table deliveries";
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
    cases.push(CorpusCase {
        server_only: true,
        certification_rewrite: None,
        corpus_version: CORPUS_VERSION,
        name: name.to_owned(),
        category: "scenario".to_owned(),
        random_seed: None,
        schema,
        program,
        certificate: None,
        context: Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        receipt: ClosureReceipt::default(),
        prelude: Vec::new(),
        replacement_receipt: None,
        expected: Expected {
            error_reason: Some(reason.to_owned()),
            local_result: None,
            error_code: Some(code.to_owned()),
            local_state: "certification-refused".to_owned(),
            partial_sites: Vec::new(),
            canonical_result: serde_json::to_string(&envelope).unwrap(),
            digest: digest(&envelope),
            range_stops: BTreeMap::new(),
            evicted_rows: None,
            next: None,
        },
    });
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
                    components: columns
                        .iter()
                        .map(|column| IndexComponent::Column((*column).to_owned()))
                        .collect(),
                    unique,
                },
            )
        })
        .collect()
}

fn content(id_value: &str, body: &str) -> Value {
    object([("id", id(id_value)), ("conversationId", id("c1")), ("authorId", id("u1")), ("body", text(body))])
}
fn write_program(name: &str, body: Vec<Stmt>) -> Program {
    Program { name: name.into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None, body }
}
fn inbox() -> Expr {
    Expr::Scan(Scan { site: "delivery.inbox".into(), table: "deliveries".into(), index: "byRecipient".into(),
        prefix: vec![IndexKeyExpr::Scalar(Expr::Input(Input::Viewer))], order: Order::Asc, take: Bound::Literal(50),
        after: None, before: None, range: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Viewer })
}

// These paired cases assert authoritative fan-out during export, then freeze
// receipt-only execution over the same schema and rows for Rust and the TS twin.
fn add_write_cases(cases: &mut Vec<CorpusCase>) {
    for action in ["insert-cap3", "changed-original", "upsert-existing", "delete-departed", "rollback", "id-reuse", "seed", "replay-skip", "schedule-delete-target", "job-delete-chunk"] {
        let schema = schema();
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for (name, principal) in [("a", "u1"), ("b", "u2"), ("b2", "u2")] {
            engine.seed("memberships", object([("id", id(name)), ("conversationId", id("c1")), ("principal", id(principal))])).unwrap();
        }
        let existing = !matches!(action, "insert-cap3" | "replay-skip");
        if existing { engine.seed("messages", content("m", "hello")).unwrap(); assert_eq!(engine.rows("deliveries").unwrap().len(), 2); }
        let delete = |table: &str, key: &str| Stmt::Delete { table: table.into(), key: Expr::Literal(id(key)) };
        let execute = |engine: &mut Engine, body: Vec<Stmt>| {
            let program = write_program("setup", body);
            let cert = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
            engine.execute(&program, &cert, mutation_context([], [] as [&str; 0]))
        };
        if matches!(action, "changed-original" | "delete-departed" | "schedule-delete-target" | "job-delete-chunk") {
            execute(&mut engine, vec![delete("memberships", "b"), delete("memberships", "b2")]).unwrap();
        }
        if action == "id-reuse" { execute(&mut engine, vec![delete("messages", "m")]).unwrap(); }
        let read = pure_program("inbox", inbox(), &BTreeMap::new());
        let cert = Checker::new(&schema, Ceilings::default()).check(&read).unwrap();
        let mut receipt = engine.execute(&read, &cert, query_context([])).unwrap().receipt;
        for table in ["messages", "memberships"] {
            for row in engine.rows(table).unwrap() {
                receipt.rows.push(RowRecord { table: table.into(), id: row.field("id").unwrap().as_str().unwrap().into(), row });
            }
        }
        if !existing || action == "id-reuse" { receipt.absences.push(("messages".into(), "byId".into(), vec![id("m")])); }
        let insert = Stmt::Insert { table: "messages".into(), row: Expr::Literal(content("m", "hello")) };
        let update = |body: &str| Stmt::Update { table: "messages".into(), key: Expr::Literal(id("m")), patch: Expr::Literal(object([("body", text(body))])) };
        let body = match action {
            "insert-cap3" | "replay-skip" | "id-reuse" => vec![insert],
            "changed-original" => vec![update("first"), update("second")],
            "upsert-existing" => vec![Stmt::Upsert { table: "messages".into(), key: Expr::Literal(id("m")), row: Expr::Literal(content("m", "replacement")) }],
            "delete-departed" | "schedule-delete-target" | "job-delete-chunk" => vec![delete("messages", "m")],
            "rollback" => vec![delete("messages", "m"), Stmt::Require { condition: Expr::Literal(Value::Bool(false)), code: "ROLLBACK".into(), site: None }],
            _ => vec![],
        };
        let before = engine.rows("deliveries").unwrap();
        let server = execute(&mut engine, body.clone());
        if action == "id-reuse" { assert_eq!(server.unwrap_err().code(), "E_DELIVER_INCARNATION"); }
        else if action == "rollback" { assert!(server.is_err()); assert_eq!(engine.rows("deliveries").unwrap(), before); }
        else {
            server.unwrap();
            let added = match action { "insert-cap3" | "replay-skip" | "upsert-existing" | "delete-departed" | "schedule-delete-target" | "job-delete-chunk" => 2, "changed-original" => 4, _ => 0 };
            assert_eq!(engine.rows("deliveries").unwrap().len(), before.len() + added, "{action}");
        }
        let name = format!("deliver-{action}");
        let program = write_program(&name, body.into_iter().chain([Stmt::Return(inbox())]).collect());
        let case = case_from_parts(&name, "scenario", schema, program, mutation_context([], [] as [&str; 0]), receipt, vec![], None, None);
        // Local reads see exactly the accepted events: none is manufactured
        // from the fully held members, even for an otherwise predictable write.
        if action != "rollback" { assert!(!case.expected.local_state.contains("partial"), "{action}: {}", case.expected.local_state); }
        cases.push(case);
    }
}

fn add_bound_case(cases: &mut Vec<CorpusCase>) {
    let mut schema = schema();
    schema.tables.get_mut("memberships").unwrap().constraints = vec![Constraint::Cap { by: vec!["conversationId".into()], max: 3000 }];
    let name = "deliver-audience-bound-refused";
    let program = write_program(name, vec![Stmt::Insert { table: "messages".into(), row: Expr::Literal(content("m", "hello")) }]);
    let error = Checker::new(&schema, Ceilings::default()).check(&program).unwrap_err();
    assert_eq!(error.code, "E_BOUND");
    assert_eq!(error.site.as_deref(), Some("schema.tables.messages.deliver"));
    assert!(error.message.contains("deliver"));
    let envelope = json!({"Error": "E_BOUND"});
    cases.push(CorpusCase { server_only: true, certification_rewrite: None, corpus_version: CORPUS_VERSION,
        name: name.into(), category: "scenario".into(), random_seed: None, schema, program, certificate: None,
        context: mutation_context([], [] as [&str; 0]), receipt: ClosureReceipt::default(), prelude: vec![], replacement_receipt: None,
        expected: Expected { error_reason: Some("deliver".into()), local_result: None, error_code: Some("E_BOUND".into()), local_state: "certification-refused".into(),
            partial_sites: vec![], canonical_result: serde_json::to_string(&envelope).unwrap(), digest: digest(&envelope), range_stops: BTreeMap::new(), evicted_rows: None, next: None } });
}
