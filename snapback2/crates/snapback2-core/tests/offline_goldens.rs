use serde_json::json;
use snapback2_core::engine::{
    AuthoritativeTrace, ClosureReceipt, ReceiptRange, RowRecord, Verdict,
};
use snapback2_core::ir::IndexKeyExpr;
use snapback2_core::{
    Actor, Auth, Bound, Builtin, Ceilings, Checker, ClientStore, ColumnType, Context,
    DeliveryProjectionContext, Engine, Execution, ExecutionState, Expr, Generation, Index,
    KeyProvenance, Order, Program, ProgramKind, ProjectJson, Read, ResultProvenance, RuleExpr,
    RuleTerm, Rules, Scan, Schema, Stmt, StopReason, Table, Value, digest, object,
    project_delivery, rule_inputs_digest, value_to_wire_json,
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
                retain: Default::default(),
                tombstones: Vec::new(),
                deliver: None,
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
                            components: (vec!["id".to_owned()])
                                .into_iter()
                                .map(snapback2_core::search_key::IndexComponent::Column)
                                .collect(),
                            unique: true,
                        },
                    ),
                    (
                        "byConversationAt".to_owned(),
                        Index {
                            components: (vec![
                                "conversationId".to_owned(),
                                "at".to_owned(),
                                "id".to_owned(),
                            ])
                            .into_iter()
                            .map(snapback2_core::search_key::IndexComponent::Column)
                            .collect(),
                            unique: false,
                        },
                    ),
                    (
                        "byBody".to_owned(),
                        Index {
                            components: (vec!["body".to_owned()])
                                .into_iter()
                                .map(snapback2_core::search_key::IndexComponent::Column)
                                .collect(),
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
        prefix: vec![snapback2_core::search_key::IndexAtom::Scalar(Value::Id(
            "conversation-1".to_owned(),
        ))],
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
        halo: halo.map(|row| snapback2_core::engine::RowRef {
            table: row.table,
            id: row.id,
        }),
        n2_suffix: None,
    }
}

fn execution(
    state: ExecutionState,
    result: Value,
    next: Option<&str>,
    receipt: ClosureReceipt,
) -> Execution {
    let result_provenance = match &result {
        Value::Row(_) => {
            receipt
                .rows
                .first()
                .map_or(ResultProvenance::None, |row| ResultProvenance::Row {
                    table: row.table.clone(),
                    id: row.id.clone(),
                })
        }
        Value::Array(values) => ResultProvenance::Array(
            values
                .iter()
                .map(|value| {
                    receipt.rows.iter().find(|row| &row.row == value).map_or(
                        ResultProvenance::None,
                        |row| ResultProvenance::Row {
                            table: row.table.clone(),
                            id: row.id.clone(),
                        },
                    )
                })
                .collect(),
        ),
        _ => ResultProvenance::None,
    };
    Execution {
        result,
        result_provenance,
        trace: AuthoritativeTrace::default(),
        receipt,
        state,
        seq: 17,
        next: next.map(ToOwned::to_owned),
    }
}

fn public_receipt(
    execution: &Execution,
    envelope: &snapback2_core::DeliveryEnvelopeV1,
) -> ClosureReceipt {
    let find_row = |table: &str, id: &str| {
        execution
            .receipt
            .rows
            .iter()
            .find(|row| row.table == table && row.id == id)
            .cloned()
            .unwrap()
    };
    ClosureReceipt {
        schema_hash: execution.receipt.schema_hash.clone(),
        rows: envelope
            .rows
            .iter()
            .map(|row| find_row(&row.table, &row.id))
            .collect(),
        ranges: execution
            .receipt
            .ranges
            .iter()
            .cloned()
            .map(|mut range| {
                range.n2_suffix = None;
                range
            })
            .collect(),
        absences: execution
            .receipt
            .absences
            .iter()
            .filter(|(_, index, _)| index == "byId")
            .cloned()
            .collect(),
        verdicts: execution.receipt.verdicts.clone(),
    }
}

/// The pinned inputs of the denied-query golden's one verdict: the table,
/// index, and key a twin would digest to look the verdict up.
const DENIED_INPUTS: (&str, &str) = ("memberships", "byConversationPrincipal");

fn denied_key() -> Vec<Value> {
    vec![
        Value::Id("conversation-1".to_owned()),
        Value::Id("alice".to_owned()),
    ]
}

/// The verdict inputs written beside each golden so the TypeScript side can
/// recompute every `pinnedInputsDigest` from wire values.
fn verdict_inputs(name: &str) -> Vec<serde_json::Value> {
    match name {
        "denied-query" => vec![json!({
            "ruleHash": hash('b'),
            "table": DENIED_INPUTS.0,
            "index": DENIED_INPUTS.1,
            "key": denied_key().iter().map(value_to_wire_json).collect::<Vec<_>>(),
        })],
        _ => Vec::new(),
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
                        pinned_inputs_digest: rule_inputs_digest(
                            DENIED_INPUTS.0,
                            DENIED_INPUTS.1,
                            &denied_key(),
                        ),
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
                schema: &schema,
                read_time: None,
                op: "messages.thread",
                args: &args,
                generation: &hash('d'),
                schema_hash: &schema_hash,
                plan_hash: &hash('e'),
                principal: "alice",
                auth_epoch: 9,
            },
        )
        .unwrap();
        let receipt = public_receipt(&execution, &envelope);
        let envelope_bytes = format!("{}\n", serde_json::to_string(&envelope).unwrap());
        let closure_bytes = format!(
            "{}\n",
            serde_json::to_string(&json!({
                "schema": schema,
                "receipt": receipt,
                "receiptBytes": serde_json::to_string(&receipt).unwrap(),
                "verdictInputs": verdict_inputs(name),
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
            schema: &schema,
            read_time: None,
            op: "messages.byBody",
            args: &args,
            generation: &hash('d'),
            schema_hash: &schema.hash(),
            plan_hash: &hash('e'),
            principal: "alice",
            auth_epoch: 9,
        },
    )
    .unwrap();
    assert!(envelope.receipt.absences.is_empty());
}

fn allow_rules() -> Rules {
    Rules {
        read: RuleExpr::Allow,
        insert: RuleExpr::Allow,
        update: RuleExpr::Allow,
        delete: RuleExpr::Allow,
    }
}

fn oracle_schema() -> Schema {
    let messages = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("owner".to_owned(), ColumnType::Principal),
            ("at".to_owned(), ColumnType::Time),
            ("body".to_owned(), ColumnType::Text { max: 256 }),
        ]),
        indexes: BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byOwnerAt".to_owned(),
                Index {
                    components: (vec!["owner".to_owned(), "at".to_owned(), "id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
            (
                "byAt".to_owned(),
                Index {
                    components: (vec!["at".to_owned(), "id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
            (
                "byBody".to_owned(),
                Index {
                    components: (vec!["body".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
        rules: Rules {
            read: RuleExpr::Eq(RuleTerm::Field("owner".to_owned()), RuleTerm::Viewer),
            ..allow_rules()
        },
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
        deliver: None,
    };
    let secrets = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("slug".to_owned(), ColumnType::Text { max: 64 }),
            (
                "grantId".to_owned(),
                ColumnType::Ref {
                    table: "grants".to_owned(),
                },
            ),
        ]),
        indexes: BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "bySlug".to_owned(),
                Index {
                    components: (vec!["slug".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
        rules: Rules {
            read: RuleExpr::Exists {
                table: "grants".to_owned(),
                index: "byId".to_owned(),
                key: vec![RuleTerm::Field("grantId".to_owned())],
                provenance: KeyProvenance::Shape,
            },
            ..allow_rules()
        },
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
        deliver: None,
    };
    let grants = Table {
        columns: BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
        rules: allow_rules(),
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
        deliver: None,
    };
    Schema {
        tables: BTreeMap::from([
            ("grants".to_owned(), grants),
            ("messages".to_owned(), messages),
            ("secrets".to_owned(), secrets),
        ]),
        ..Schema::default()
    }
}

fn point_program(name: &str, table: &str, index: &str, key: Value) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: format!("{name}.point"),
            table: table.to_owned(),
            index: index.to_owned(),
            key: vec![Expr::Literal(key)],
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn scan_program(name: &str, index: &str, prefix: Vec<Value>, take: u32) -> Program {
    let site = format!("{name}.range");
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site,
            table: "messages".to_owned(),
            index: index.to_owned(),
            prefix: (prefix.into_iter().map(Expr::Literal).collect::<Vec<_>>())
                .into_iter()
                .map(IndexKeyExpr::Scalar)
                .collect(),
            order: Order::Asc,
            take: Bound::Literal(take),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn execute_oracle(schema: &Schema, program: &Program) -> Execution {
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for (id, owner, at, body) in [
        ("message-1", "alice", 1, "hello"),
        ("message-2", "alice", 2, "later"),
        ("message-3", "bob", 3, "hidden"),
    ] {
        engine
            .seed(
                "messages",
                object([
                    ("id", Value::Id(id.to_owned())),
                    ("owner", Value::Id(owner.to_owned())),
                    ("at", Value::Int(at)),
                    ("body", Value::String(body.to_owned())),
                ]),
            )
            .unwrap();
    }
    engine
        .seed(
            "secrets",
            object([
                ("id", Value::Id("secret-1".to_owned())),
                ("slug", Value::String("hidden-secret".to_owned())),
                ("grantId", Value::Id("missing-grant".to_owned())),
            ]),
        )
        .unwrap();
    let certificate = Checker::new(schema, Ceilings::default())
        .check(program)
        .unwrap();
    let mut context = Context::query(Actor::user("alice").unwrap(), BTreeMap::new());
    context.auth_epoch = 9;
    engine.execute(program, &certificate, context).unwrap()
}

fn write_or_assert_golden(name: &str, schema: &Schema, op: &str, execution: &Execution) {
    let output = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../corpus/offline");
    if std::env::var_os("UPDATE_OFFLINE_GOLDENS").is_some() {
        fs::create_dir_all(&output).unwrap();
    }
    let args = BTreeMap::new();
    let envelope = project_delivery(
        execution,
        &DeliveryProjectionContext {
            schema: &schema,
            read_time: None,
            op,
            args: &args,
            generation: &hash('d'),
            schema_hash: &schema.hash(),
            plan_hash: &hash('e'),
            principal: "alice",
            auth_epoch: 9,
        },
    )
    .unwrap();
    let receipt = public_receipt(execution, &envelope);
    let envelope_bytes = format!("{}\n", serde_json::to_string(&envelope).unwrap());
    let closure_bytes = format!(
        "{}\n",
        serde_json::to_string(&json!({
            "schema": schema,
            "receipt": receipt,
            "receiptBytes": serde_json::to_string(&receipt).unwrap(),
        }))
        .unwrap()
    );
    let envelope_path = output.join(format!("envelope-{name}.json"));
    let closure_path = output.join(format!("closure-{name}.json"));
    if std::env::var_os("UPDATE_OFFLINE_GOLDENS").is_some() {
        fs::write(&envelope_path, &envelope_bytes).unwrap();
        fs::write(&closure_path, &closure_bytes).unwrap();
    }
    assert_eq!(fs::read_to_string(envelope_path).unwrap(), envelope_bytes);
    assert_eq!(fs::read_to_string(closure_path).unwrap(), closure_bytes);
}

#[test]
fn engine_executed_oracle_goldens_match_public_projection() {
    let schema = oracle_schema();
    let cases = [
        (
            "engine-point-miss-by-id",
            point_program(
                "messages.missingById",
                "messages",
                "byId",
                Value::Id("missing".to_owned()),
            ),
        ),
        (
            "engine-hidden-point-alternate-key",
            point_program(
                "secrets.hiddenBySlug",
                "secrets",
                "bySlug",
                Value::String("hidden-secret".to_owned()),
            ),
        ),
        (
            "engine-point-miss-alternate-key",
            point_program(
                "messages.missingByBody",
                "messages",
                "byBody",
                Value::String("missing-body".to_owned()),
            ),
        ),
        (
            "engine-uniform-range-halo",
            scan_program(
                "messages.ownerPage",
                "byOwnerAt",
                vec![Value::Id("alice".to_owned())],
                1,
            ),
        ),
        (
            "engine-uniform-range-exhausted",
            scan_program(
                "messages.ownerAll",
                "byOwnerAt",
                vec![Value::Id("alice".to_owned())],
                2,
            ),
        ),
        (
            "engine-non-uniform-range",
            scan_program("messages.all", "byAt", Vec::new(), 2),
        ),
    ];
    for (name, program) in cases {
        let execution = execute_oracle(&schema, &program);
        if name == "engine-hidden-point-alternate-key" {
            assert_eq!(execution.result, Value::Null);
            assert!(execution.receipt.rows.is_empty());
            assert!(execution.receipt.ranges.is_empty());
            assert!(execution.receipt.absences.is_empty());
            assert!(execution.receipt.verdicts.is_empty());
        }
        write_or_assert_golden(name, &schema, &program.name, &execution);
    }
}

#[test]
fn hidden_candidate_memo_rollback_preserves_envelope_receipt_replay() {
    let by_id = || Index {
        components: (vec!["id".to_owned()])
            .into_iter()
            .map(snapback2_core::search_key::IndexComponent::Column)
            .collect(),
        unique: true,
    };
    let read_rule = RuleExpr::And(vec![
        RuleExpr::Exists {
            table: "grants".to_owned(),
            index: "byId".to_owned(),
            key: vec![RuleTerm::Field("grantId".to_owned())],
            provenance: KeyProvenance::Shape,
        },
        RuleExpr::Eq(RuleTerm::Field("owner".to_owned()), RuleTerm::Viewer),
    ]);
    let schema = Schema {
        tables: BTreeMap::from([
            (
                "documents".to_owned(),
                Table {
                    columns: BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        (
                            "grantId".to_owned(),
                            ColumnType::Ref {
                                table: "grants".to_owned(),
                            },
                        ),
                        ("owner".to_owned(), ColumnType::Principal),
                        ("rank".to_owned(), ColumnType::Int),
                    ]),
                    indexes: BTreeMap::from([
                        ("byId".to_owned(), by_id()),
                        (
                            "byRank".to_owned(),
                            Index {
                                components: (vec!["rank".to_owned(), "id".to_owned()])
                                    .into_iter()
                                    .map(snapback2_core::search_key::IndexComponent::Column)
                                    .collect(),
                                unique: false,
                            },
                        ),
                    ]),
                    rules: Rules {
                        read: read_rule,
                        ..allow_rules()
                    },
                    constraints: Vec::new(),
                    retain: Default::default(),
                    tombstones: Vec::new(),
                    deliver: None,
                },
            ),
            (
                "grants".to_owned(),
                Table {
                    columns: BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
                    indexes: BTreeMap::from([("byId".to_owned(), by_id())]),
                    rules: Rules {
                        read: RuleExpr::Deny,
                        ..allow_rules()
                    },
                    constraints: Vec::new(),
                    retain: Default::default(),
                    tombstones: Vec::new(),
                    deliver: None,
                },
            ),
        ]),
        ..Schema::default()
    };
    let point = Program {
        name: "documents.pointMemo".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "discarded".to_owned(),
                value: Expr::Get(Read {
                    site: "documents.pointMemo.hidden".to_owned(),
                    table: "documents".to_owned(),
                    index: "byId".to_owned(),
                    key: vec![Expr::Literal(Value::Id("document-hidden".to_owned()))],
                    provenance: KeyProvenance::Const,
                }),
            },
            Stmt::Return(Expr::Get(Read {
                site: "documents.pointMemo.visible".to_owned(),
                table: "documents".to_owned(),
                index: "byId".to_owned(),
                key: vec![Expr::Literal(Value::Id("document-visible".to_owned()))],
                provenance: KeyProvenance::Const,
            })),
        ],
    };
    let range = Program {
        name: "documents.rangeMemo".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "documents.rangeMemo.rows".to_owned(),
            table: "documents".to_owned(),
            index: "byRank".to_owned(),
            prefix: (Vec::new()).into_iter().map(IndexKeyExpr::Scalar).collect(),
            order: Order::Asc,
            take: Bound::Literal(2),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    };

    for readable in [false, true] {
        let mut schema = schema.clone();
        if readable {
            schema.tables.get_mut("grants").unwrap().rules.read = RuleExpr::Allow;
        }
        for program in [&point, &range] {
            let certificate = Checker::new(&schema, Ceilings::default())
                .check(program)
                .unwrap();
            let mut server = Engine::memory(schema.clone()).unwrap();
            server
                .seed(
                    "grants",
                    object([("id", Value::Id("grant-shared".to_owned()))]),
                )
                .unwrap();
            for (id, owner, rank) in [
                ("document-hidden", "bob", 1),
                ("document-visible", "alice", 2),
            ] {
                server
                    .seed(
                        "documents",
                        object([
                            ("id", Value::Id(id.to_owned())),
                            ("grantId", Value::Id("grant-shared".to_owned())),
                            ("owner", Value::Id(owner.to_owned())),
                            ("rank", Value::Int(rank)),
                        ]),
                    )
                    .unwrap();
            }
            let mut context = Context::query(Actor::user("alice").unwrap(), BTreeMap::new());
            context.auth_epoch = 9;
            let served = server
                .execute(program, &certificate, context.clone())
                .unwrap();
            assert_eq!(
                served.receipt.verdicts.len(),
                usize::from(!readable),
                "{}",
                program.name
            );
            assert_eq!(
                served
                    .receipt
                    .rows
                    .iter()
                    .filter(|r| r.table == "grants")
                    .count(),
                usize::from(readable)
            );
            if readable {
                // The denied first candidate recorded then rolled back this exact
                // row. The visible candidate must deliver it again, in order.
                assert_eq!(served.receipt.rows[0].id, "grant-shared");
                assert_eq!(
                    served
                        .trace
                        .rows
                        .iter()
                        .filter(|r| r.table == "grants")
                        .count(),
                    1
                );
            }
            assert!(
                served
                    .receipt
                    .rows
                    .iter()
                    .any(|row| { row.table == "documents" && row.id == "document-visible" })
            );
            assert!(
                served
                    .receipt
                    .rows
                    .iter()
                    .all(|row| { row.table != "documents" || row.id != "document-hidden" })
            );

            let args = BTreeMap::new();
            let envelope = project_delivery(
                &served,
                &DeliveryProjectionContext {
                    schema: &schema,
                    read_time: None,
                    op: &program.name,
                    args: &args,
                    generation: &hash('d'),
                    schema_hash: &schema.hash(),
                    plan_hash: &hash('e'),
                    principal: "alice",
                    auth_epoch: 9,
                },
            )
            .unwrap();
            let delivered = public_receipt(&served, &envelope);
            assert_eq!(
                delivered.verdicts.len(),
                usize::from(!readable),
                "{}",
                program.name
            );
            let mut client = ClientStore::hydrate(schema.clone(), &delivered).unwrap();
            let (_, replayed) = client.reexecute(program, &certificate, context).unwrap();
            assert_eq!(replayed.result, served.result, "{}", program.name);
        }
    }
}

#[test]
fn engine_result_provenance_distinguishes_identical_rows_from_two_tables() {
    let table = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("body".to_owned(), ColumnType::Text { max: 16 }),
        ]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
        rules: allow_rules(),
        constraints: Vec::new(),
        retain: Default::default(),
        tombstones: Vec::new(),
        deliver: None,
    };
    let schema = Schema {
        tables: BTreeMap::from([
            ("alpha".to_owned(), table.clone()),
            ("beta".to_owned(), table),
        ]),
        ..Schema::default()
    };
    let get = |table: &str| {
        Expr::Get(Read {
            site: format!("{table}.point"),
            table: table.to_owned(),
            index: "byId".to_owned(),
            key: vec![Expr::Literal(Value::Id("shared".to_owned()))],
            provenance: KeyProvenance::Const,
        })
    };
    let program = Program {
        name: "identicalRows".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::Concat,
            args: vec![
                Expr::Array(vec![get("alpha"), get("beta")]),
                Expr::Array(Vec::new()),
            ],
        })],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let row = object([
        ("id", Value::Id("shared".to_owned())),
        ("body", Value::String("same".to_owned())),
    ]);
    engine.seed("alpha", row.clone()).unwrap();
    engine.seed("beta", row).unwrap();
    let execution = engine
        .execute(
            &program,
            &certificate,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    let args = BTreeMap::new();
    let envelope = project_delivery(
        &execution,
        &DeliveryProjectionContext {
            schema: &schema,
            read_time: None,
            op: &program.name,
            args: &args,
            generation: &hash('d'),
            schema_hash: &schema.hash(),
            plan_hash: &hash('e'),
            principal: "alice",
            auth_epoch: 0,
        },
    )
    .unwrap();
    assert_eq!(
        envelope.data,
        json!([
            { "$row": { "table": "alpha", "id": "shared" } },
            { "$row": { "table": "beta", "id": "shared" } },
        ])
    );
}

fn all_types_schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "allTypes".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("bytes".to_owned(), ColumnType::Bytes { max: 16 }),
                    (
                        "list".to_owned(),
                        ColumnType::List {
                            of: Box::new(ColumnType::Text { max: 16 }),
                            max: 2,
                        },
                    ),
                    (
                        "image".to_owned(),
                        ColumnType::Image {
                            max: 10_000,
                            once: false,
                        },
                    ),
                    ("video".to_owned(), ColumnType::Video { max: 10_000 }),
                    ("json".to_owned(), ColumnType::Json { max_bytes: 256 }),
                    ("decimal".to_owned(), ColumnType::Decimal { scale: 2 }),
                    (
                        "money".to_owned(),
                        ColumnType::Money {
                            currency: "USD".to_owned(),
                            scale: 2,
                        },
                    ),
                    (
                        "enum".to_owned(),
                        ColumnType::Enum {
                            variants: vec!["one".to_owned(), "two".to_owned()],
                        },
                    ),
                    (
                        "optional".to_owned(),
                        ColumnType::Optional(Box::new(ColumnType::Text { max: 16 })),
                    ),
                ]),
                indexes: BTreeMap::from([(
                    "byId".to_owned(),
                    Index {
                        components: (vec!["id".to_owned()])
                            .into_iter()
                            .map(snapback2_core::search_key::IndexComponent::Column)
                            .collect(),
                        unique: true,
                    },
                )]),
                rules: allow_rules(),
                constraints: Vec::new(),
                retain: Default::default(),
                tombstones: Vec::new(),
                deliver: None,
            },
        )]),
        ..Schema::default()
    }
}

#[test]
fn every_column_kind_and_reserved_application_value_have_goldens() {
    let schema = all_types_schema();
    let image = Value::Map(
        BTreeMap::from([
            (
                "id".to_owned(),
                Value::String("s2id-00000000000000000000000000000001-0000000000000001".to_owned()),
            ),
            ("width".to_owned(), Value::Int(640)),
            ("height".to_owned(), Value::Int(480)),
        ])
        .into(),
    );
    let video = Value::Map(
        BTreeMap::from([
            (
                "id".to_owned(),
                Value::String("s2id-00000000000000000000000000000001-0000000000000002".to_owned()),
            ),
            ("width".to_owned(), Value::Int(1920)),
            ("height".to_owned(), Value::Int(1080)),
            ("duration".to_owned(), Value::Int(9000)),
        ])
        .into(),
    );
    let row = RowRecord {
        table: "allTypes".to_owned(),
        id: "all-1".to_owned(),
        row: object([
            ("id", Value::Id("all-1".to_owned())),
            ("bytes", Value::Bytes(vec![0, 255])),
            (
                "list",
                Value::Array(vec![
                    Value::String("a".to_owned()),
                    Value::String("b".to_owned()),
                ]),
            ),
            ("image", image),
            ("video", video),
            (
                "json",
                Value::Map(
                    BTreeMap::from([
                        ("enabled".to_owned(), Value::Bool(true)),
                        (
                            "values".to_owned(),
                            Value::Array(vec![Value::Int(1), Value::Null]),
                        ),
                    ])
                    .into(),
                ),
            ),
            ("decimal", Value::Int(1234)),
            ("money", Value::Int(567)),
            ("enum", Value::String("two".to_owned())),
            ("optional", Value::Null),
        ]),
    };
    let execution = Execution {
        result: row.row.clone(),
        result_provenance: ResultProvenance::Row {
            table: row.table.clone(),
            id: row.id.clone(),
        },
        trace: AuthoritativeTrace::default(),
        receipt: ClosureReceipt {
            schema_hash: Some(schema.hash()),
            rows: vec![row],
            ..ClosureReceipt::default()
        },
        state: ExecutionState::Complete,
        seq: 17,
        next: None,
    };
    // Projection coverage uses a synthetic authoritative receipt, not asset
    // ledger admission. Hydration still checks every declared column shape.
    ClientStore::hydrate(schema.clone(), &execution.receipt).unwrap();
    for (field, invalid_id) in [("image", "image-1"), ("video", "video-1")] {
        let mut invalid = execution.receipt.clone();
        let Value::Row(fields) = &mut invalid.rows[0].row else {
            panic!("row")
        };
        let Value::Map(asset) = fields.get_mut(field).unwrap() else {
            panic!("asset")
        };
        asset.insert("id".into(), Value::String(invalid_id.into()));
        assert!(matches!(
            ClientStore::hydrate(schema.clone(), &invalid),
            Err(snapback2_core::RuntimeError::AssetType(_))
        ));
    }
    write_or_assert_golden("every-column-kind", &schema, "allTypes.get", &execution);

    let application_schema = Schema::default();
    let application = Execution {
        result: Value::Map(
            BTreeMap::from([(
                "$row".to_owned(),
                Value::Map(
                    BTreeMap::from([
                        ("id".to_owned(), Value::String("literal".to_owned())),
                        ("table".to_owned(), Value::String("application".to_owned())),
                    ])
                    .into(),
                ),
            )])
            .into(),
        ),
        result_provenance: ResultProvenance::None,
        trace: AuthoritativeTrace::default(),
        receipt: ClosureReceipt {
            schema_hash: Some(application_schema.hash()),
            ..ClosureReceipt::default()
        },
        state: ExecutionState::Complete,
        seq: 17,
        next: None,
    };
    write_or_assert_golden(
        "application-row-reference-json",
        &application_schema,
        "json.literal",
        &application,
    );
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
