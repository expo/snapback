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
        audience: 3,
        bootstrap: false,
    };
    messages.deliver = Some(deliver.clone());
    schema.tables.insert("messages".to_owned(), messages);
    let log = delivery::log_table(&schema, "messages", &deliver).expect("log shape");
    schema.tables.insert("deliveries".to_owned(), log);
    schema
}

pub(super) fn add_delivery_cases(cases: &mut Vec<CorpusCase>) {
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
