use serde_json::json;
use snapback2_core::engine::{
    AuthoritativeTrace, ClosureReceipt, ReceiptRange, RowRecord, Verdict,
};
use snapback2_core::{
    Auth, Ceilings, ColumnType, DeliveryProjectionContext, Execution, ExecutionState, Expr,
    Generation, Index, Order, Program, ProgramKind, ProjectJson, RuleExpr, Rules, Schema, Stmt,
    StopReason, Table, Value, digest, object, project_delivery,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

fn hash(character: char) -> String {
    std::iter::repeat_n(character, 64).collect()
}

fn schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "messages".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("at".to_owned(), ColumnType::Time),
                    ("body".to_owned(), ColumnType::Text { max: 256 }),
                    (
                        "conversationId".to_owned(),
                        ColumnType::Ref {
                            table: "conversations".to_owned(),
                        },
                    ),
                    ("id".to_owned(), ColumnType::Id),
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
                        "byConversationAt".to_owned(),
                        Index {
                            columns: vec![
                                "conversationId".to_owned(),
                                "at".to_owned(),
                                "id".to_owned(),
                            ],
                            unique: false,
                        },
                    ),
                    (
                        "byBody".to_owned(),
                        Index {
                            columns: vec!["body".to_owned()],
                            unique: true,
                        },
                    ),
                ]),
                rules: Rules {
                    read: RuleExpr::Allow,
                    insert: RuleExpr::Allow,
                    update: RuleExpr::Allow,
                    delete: RuleExpr::Allow,
                },
                constraints: Vec::new(),
            },
        )]),
        ..Schema::default()
    }
}

fn row(id: &str, at: i64, body: &str) -> RowRecord {
    RowRecord {
        table: "messages".to_owned(),
        id: id.to_owned(),
        row: object([
            ("at", Value::Int(at)),
            ("body", Value::String(body.to_owned())),
            ("conversationId", Value::Id("conversation-1".to_owned())),
            ("id", Value::Id(id.to_owned())),
        ]),
    }
}

fn range(rows: &[RowRecord], halo: Option<RowRecord>, stop: StopReason) -> ReceiptRange {
    ReceiptRange {
        site: "messages.page".to_owned(),
        table: "messages".to_owned(),
        index: "byConversationAt".to_owned(),
        prefix: vec![Value::Id("conversation-1".to_owned())],
        order: Order::Asc,
        take: 2,
        after: None,
        before: None,
        gt: None,
        gte: None,
        lt: None,
        lte: None,
        rule_hash: hash('a'),
        row_ids: rows.iter().map(|row| row.id.clone()).collect(),
        stop,
        absence: rows.is_empty(),
        halo,
        n2_key: None,
    }
}

fn execution(
    state: ExecutionState,
    result: Value,
    next: Option<&str>,
    receipt: ClosureReceipt,
) -> Execution {
    Execution {
        result,
        trace: AuthoritativeTrace::default(),
        receipt,
        state,
        seq: 17,
        next: next.map(ToOwned::to_owned),
    }
}

fn cases(schema_hash: &str) -> Vec<(&'static str, Execution)> {
    let first = row("message-1", 1, "hello");
    let second = row("message-2", 2, "later");
    vec![
        (
            "uniform-range-halo",
            execution(
                ExecutionState::Complete,
                Value::Array(vec![first.row.clone()]),
                None,
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    rows: vec![first.clone(), second.clone()],
                    ranges: vec![range(
                        std::slice::from_ref(&first),
                        Some(second.clone()),
                        StopReason::Exhausted,
                    )],
                    absences: Vec::new(),
                    verdicts: Vec::new(),
                },
            ),
        ),
        (
            "point-hit",
            execution(
                ExecutionState::Complete,
                first.row.clone(),
                None,
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    rows: vec![first.clone()],
                    ..ClosureReceipt::default()
                },
            ),
        ),
        (
            "point-miss-by-id",
            execution(
                ExecutionState::Complete,
                Value::Null,
                None,
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    absences: vec![(
                        "messages".to_owned(),
                        "byId".to_owned(),
                        vec![Value::Id("missing".to_owned())],
                    )],
                    ..ClosureReceipt::default()
                },
            ),
        ),
        (
            "hidden-point-alternate-key",
            execution(
                ExecutionState::Complete,
                Value::Null,
                None,
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    ..ClosureReceipt::default()
                },
            ),
        ),
        (
            "non-uniform-range",
            execution(
                ExecutionState::Capped,
                Value::Array(vec![first.row.clone()]),
                None,
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    rows: vec![first.clone()],
                    ranges: Vec::new(),
                    absences: Vec::new(),
                    verdicts: Vec::new(),
                },
            ),
        ),
        (
            "denied-query",
            execution(
                ExecutionState::Denied {
                    rule: "messages.Read".to_owned(),
                },
                Value::Null,
                None,
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    verdicts: vec![Verdict {
                        rule_hash: hash('b'),
                        pinned_inputs_digest: hash('c'),
                        principal: "alice".to_owned(),
                        auth_epoch: 9,
                        result: false,
                    }],
                    ..ClosureReceipt::default()
                },
            ),
        ),
        (
            "capped-page-next",
            execution(
                ExecutionState::Capped,
                Value::Array(vec![first.row.clone()]),
                Some("cursor-page-2"),
                ClosureReceipt {
                    schema_hash: Some(schema_hash.to_owned()),
                    rows: vec![first.clone(), second.clone()],
                    ranges: vec![range(
                        std::slice::from_ref(&first),
                        Some(second),
                        StopReason::Limit,
                    )],
                    absences: Vec::new(),
                    verdicts: Vec::new(),
                },
            ),
        ),
    ]
}

#[test]
fn offline_golden_fixtures_match_rust_projection() {
    let schema = schema();
    let schema_hash = schema.hash();
    let args = BTreeMap::from([(
        "conversationId".to_owned(),
        Value::Id("conversation-1".to_owned()),
    )]);
    let output = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../corpus/offline");
    if std::env::var_os("UPDATE_OFFLINE_GOLDENS").is_some() {
        fs::create_dir_all(&output).unwrap();
    }
    for (name, execution) in cases(&schema_hash) {
        let envelope = project_delivery(
            &execution,
            &DeliveryProjectionContext {
                op: "messages.thread",
                args: &args,
                generation: &hash('d'),
                schema_hash: &schema_hash,
                plan_hash: &hash('e'),
                principal: "alice",
                auth_epoch: 9,
            },
        );
        let envelope_bytes = format!("{}\n", serde_json::to_string(&envelope).unwrap());
        let closure_bytes = format!(
            "{}\n",
            serde_json::to_string(&json!({
                "schema": schema,
                "receipt": execution.receipt,
            }))
            .unwrap()
        );
        let envelope_path = output.join(format!("envelope-{name}.json"));
        let closure_path = output.join(format!("closure-{name}.json"));
        if std::env::var_os("UPDATE_OFFLINE_GOLDENS").is_some() {
            fs::write(&envelope_path, &envelope_bytes).unwrap();
            fs::write(&closure_path, &closure_bytes).unwrap();
        }
        assert_eq!(
            fs::read_to_string(&envelope_path).unwrap(),
            envelope_bytes,
            "{name} envelope drifted"
        );
        assert_eq!(
            fs::read_to_string(&closure_path).unwrap(),
            closure_bytes,
            "{name} closure drifted"
        );
    }
}

#[test]
fn alternate_key_miss_is_not_projected_as_public_absence() {
    let schema = schema();
    let args = BTreeMap::new();
    let execution = execution(
        ExecutionState::Complete,
        Value::Null,
        None,
        ClosureReceipt {
            schema_hash: Some(schema.hash()),
            absences: vec![(
                "messages".to_owned(),
                "byBody".to_owned(),
                vec![Value::String("private".to_owned())],
            )],
            ..ClosureReceipt::default()
        },
    );
    let envelope = project_delivery(
        &execution,
        &DeliveryProjectionContext {
            op: "messages.byBody",
            args: &args,
            generation: &hash('d'),
            schema_hash: &schema.hash(),
            plan_hash: &hash('e'),
            principal: "alice",
            auth_epoch: 9,
        },
    );
    assert!(envelope.receipt.absences.is_empty());
}

#[test]
fn certified_program_generation_binds_ir_without_changing_schema_generation() {
    let build = |value| {
        Generation::certify(
            &ProjectJson {
                version: 1,
                schema: Schema::default(),
                programs: vec![Program {
                    name: "answer".to_owned(),
                    kind: ProgramKind::Query,
                    args: BTreeMap::new(),
                    read_time_granularity_ms: None,
                    result_page_site: None,
                    body: vec![Stmt::Return(Expr::Literal(Value::Int(value)))],
                }],
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap()
    };
    let first = build(1);
    let second = build(2);
    assert_eq!(
        first.hash(),
        second.hash(),
        "legacy generation remains schema-only"
    );
    assert_ne!(first.program_hash(), second.program_hash());
    let (program, certificate) = &first.programs()["answer"];
    assert_eq!(certificate.plan_hash, digest(program));
}
