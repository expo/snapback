use super::*;
use snapback3_core::ir::IndexKeyExpr;

pub(super) fn add_bytes_cases(cases: &mut Vec<CorpusCase>) {
    let schema = bytes_schema();
    let insert = bytes_insert_program();
    let scan = bytes_scan_program("bytesRoundTrip");
    let prelude = PreludeStep {
        certificate: None,
        program: insert.clone(),
        context: mutation_context(
            [
                ("id", id("round-trip")),
                ("payload", Value::Bytes(vec![0, 127, 128, 255])),
            ],
            Vec::<String>::new(),
        ),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "edge-bytes-round-trip",
        "edge",
        schema.clone(),
        scan,
        query_context([]),
        ClosureReceipt::default(),
        vec![prelude],
        None,
        None,
    ));

    cases.push(case_from_parts(
        "edge-bytes-max-refusal",
        "edge",
        schema.clone(),
        insert,
        mutation_context(
            [
                ("id", id("too-large")),
                ("payload", Value::Bytes(vec![0, 1, 2, 3, 4])),
            ],
            Vec::<String>::new(),
        ),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));

    let receipt = ClosureReceipt {
        schema_hash: None,
        rows: vec![
            RowRecord {
                table: "blobs".to_owned(),
                id: "high".to_owned(),
                row: row([("id", id("high")), ("payload", Value::Bytes(vec![0xff, 0]))]),
            },
            RowRecord {
                table: "blobs".to_owned(),
                id: "low".to_owned(),
                row: row([("id", id("low")), ("payload", Value::Bytes(vec![0, 0xff]))]),
            },
            RowRecord {
                table: "blobs".to_owned(),
                id: "prefix".to_owned(),
                row: row([("id", id("prefix")), ("payload", Value::Bytes(vec![0]))]),
            },
        ],
        ranges: Vec::new(),
        absences: Vec::new(),
        verdicts: Vec::new(),
    };
    cases.push(case_from_parts(
        "edge-bytes-index-order",
        "edge",
        schema,
        bytes_scan_program("bytesIndexOrder"),
        query_context([]),
        receipt,
        Vec::new(),
        None,
        None,
    ));

    cases.push(pure_case(
        "edge-bytes-canonical-serialization",
        Expr::Literal(row([("payload", Value::Bytes(vec![0, 127, 128, 255]))])),
    ));
}

fn bytes_schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "blobs".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("payload".to_owned(), ColumnType::Bytes { max: 4 }),
                ]),
                BTreeMap::from([
                    (
                        "byId".to_owned(),
                        Index {
                            components: (vec!["id".to_owned()])
                                .into_iter()
                                .map(snapback3_core::search_key::IndexComponent::Column)
                                .collect(),
                            unique: true,
                        },
                    ),
                    (
                        "byPayload".to_owned(),
                        Index {
                            components: (vec!["payload".to_owned(), "id".to_owned()])
                                .into_iter()
                                .map(snapback3_core::search_key::IndexComponent::Column)
                                .collect(),
                            unique: false,
                        },
                    ),
                ]),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        schedules: Vec::new(),
        effects: Vec::new(),
    }
}

fn bytes_insert_program() -> Program {
    Program {
        name: "bytesInsert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("id".to_owned(), ArgType::Scalar),
            ("payload".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "blobs".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("id")),
                    ("payload".to_owned(), var("payload")),
                ])),
            },
            Stmt::Return(var("payload")),
        ],
    }
}

fn bytes_scan_program(name: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: format!("{name}.blobs"),
            table: "blobs".to_owned(),
            index: "byPayload".to_owned(),
            prefix: (Vec::new()).into_iter().map(IndexKeyExpr::Scalar).collect(),
            order: Order::Asc,
            take: Bound::Literal(10),
            after: None,
            before: None,
            range: None, // no scalar range bounds
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    }
}
