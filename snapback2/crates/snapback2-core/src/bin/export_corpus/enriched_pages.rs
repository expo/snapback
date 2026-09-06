//! A nullable point-read shape preserves a non-uniform page's capped state.
use super::*;

pub(super) fn add_enriched_page_case(cases: &mut Vec<CorpusCase>) {
    let mut items = table(
        [
            ("group", ColumnType::Id),
            ("owner", ColumnType::Principal),
            ("at", ColumnType::Time),
        ],
        [("byGroup", vec!["group", "at", "id"], false)],
    );
    items.rules.read = RuleExpr::Exists {
        table: "shares".to_owned(),
        index: "byItemViewer".to_owned(),
        key: vec![RuleTerm::Field("id".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let mut profiles = table([("name", ColumnType::Text { max: 20 })], []);
    profiles.rules.read = RuleExpr::Eq(RuleTerm::Field("id".to_owned()), RuleTerm::Viewer);
    let schema = Schema {
        tables: BTreeMap::from([
            ("items".to_owned(), items),
            ("profiles".to_owned(), profiles),
            (
                "shares".to_owned(),
                table(
                    [("item", ColumnType::Id), ("viewer", ColumnType::Principal)],
                    [("byItemViewer", vec!["item", "viewer"], true)],
                ),
            ),
        ]),
        ..Schema::default()
    };
    let program = Program {
        name: "items.enriched".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Let {
                name: "rows".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(Scan {
                    site: "items.page".to_owned(),
                    table: "items".to_owned(),
                    index: "byGroup".to_owned(),
                    prefix: vec![lit(id("g1"))],
                    order: Order::Asc,
                    take: Bound::Literal(50),
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    // Fixed corpus prefix; the engine regression also covers Arg provenance.
                    provenance: KeyProvenance::Const,
                }),
                body: vec![
                    Stmt::Const {
                        name: "profile".to_owned(),
                        value: Expr::Get(Read {
                            site: "profiles.byId".to_owned(),
                            table: "profiles".to_owned(),
                            index: "byId".to_owned(),
                            key: vec![field(var("item"), "owner")],
                            provenance: KeyProvenance::Shape,
                        }),
                    },
                    Stmt::Let {
                        name: "shape".to_owned(),
                        value: lit(Value::Null),
                    },
                    Stmt::If {
                        condition: Expr::Binary {
                            op: BinaryOp::Ne,
                            left: Box::new(var("profile")),
                            right: Box::new(lit(Value::Null)),
                        },
                        then_body: vec![Stmt::Assign {
                            name: "shape".to_owned(),
                            value: Expr::Object(BTreeMap::from([(
                                "name".to_owned(),
                                field(var("profile"), "name"),
                            )])),
                        }],
                        else_body: Vec::new(),
                    },
                    Stmt::Push {
                        target: "rows".to_owned(),
                        value: Expr::Object(BTreeMap::from([
                            ("id".to_owned(), field(var("item"), "id")),
                            ("owner".to_owned(), var("shape")),
                        ])),
                    },
                ],
            },
            Stmt::Return(var("rows")),
        ],
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for (item, owner, at) in [("i1", "u1", 1), ("i2", "u2", 2), ("i3", "u1", 3)] {
        engine
            .seed(
                "items",
                row([
                    ("id", id(item)),
                    ("group", id("g1")),
                    ("owner", id(owner)),
                    ("at", Value::Int(at)),
                ]),
            )
            .unwrap();
        if item != "i3" {
            engine
                .seed(
                    "shares",
                    row([
                        ("id", id(&format!("s-{item}"))),
                        ("item", id(item)),
                        ("viewer", id("u1")),
                    ]),
                )
                .unwrap();
        }
    }
    for (owner, name) in [("u1", "Visible"), ("u2", "Secret")] {
        engine
            .seed("profiles", row([("id", id(owner)), ("name", text(name))]))
            .unwrap();
    }
    let context = query_context([]);
    let execution = authoritative(&mut engine, &schema, &program, context.clone());
    assert_eq!(execution.state, ExecutionState::Capped);
    assert_eq!(
        execution.result,
        Value::Array(vec![
            row([
                ("id", id("i1")),
                ("owner", row([("name", text("Visible"))]))
            ]),
            row([("id", id("i2")), ("owner", Value::Null)]),
        ])
    );
    assert!(
        execution
            .trace
            .points
            .iter()
            .any(|point| point.table == "profiles"
                && point.key == vec![id("u2")]
                && !point.visible)
    );
    let receipt = serde_json::to_value(&execution.receipt).unwrap();
    for set in ["rows", "ranges", "absences", "verdicts"] {
        for record in receipt[set].as_array().unwrap() {
            let mut keys = record.clone();
            if set == "rows" {
                keys.as_object_mut().unwrap().remove("row");
            }
            assert!(!keys.to_string().contains("\"u2\""), "{set}: {keys}");
        }
    }
    assert!(!receipt.to_string().contains("Secret"));
    assert!(
        !serde_json::to_string(&execution.result)
            .unwrap()
            .contains("Secret")
    );
    let case = case_from_parts(
        "enriched-capped-page-hidden-point-null",
        "scenario",
        schema,
        program,
        context,
        execution.receipt,
        Vec::new(),
        None,
        None,
    );
    // Opaque capped ranges and hidden points carry no complete coverage claims.
    // The local coverage state is partial; the query's read state remains capped.
    assert_eq!(case.expected.local_state, "partial");
    assert_eq!(case.expected.local_result, Some(execution.result));
    cases.push(case);
}

fn table<const N: usize, const M: usize>(
    columns: [(&str, ColumnType); N],
    indexes: [(&str, Vec<&str>, bool); M],
) -> Table {
    public_table(
        columns
            .into_iter()
            .map(|(name, kind)| (name.to_owned(), kind))
            .chain([("id".to_owned(), ColumnType::Id)])
            .collect(),
        indexes
            .into_iter()
            .chain([("byId", vec!["id"], true)])
            .map(|(name, columns, unique)| {
                (
                    name.to_owned(),
                    Index {
                        columns: columns.into_iter().map(str::to_owned).collect(),
                        unique,
                    },
                )
            })
            .collect(),
    )
}
