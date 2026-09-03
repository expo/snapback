use snapback2_core::*;
use std::collections::BTreeMap;

const ID_PAYLOAD_MAX: usize = 135;
const TEXT_MAX: usize = 50;
const BIG_TEXT_MAX: usize = 1_000;

fn by_id() -> BTreeMap<String, Index> {
    BTreeMap::from([(
        "byId".to_owned(),
        Index {
            columns: vec!["id".to_owned()],
            unique: true,
        },
    )])
}

fn schema() -> Schema {
    Schema {
        tables: BTreeMap::from([
            (
                "allTypes".to_owned(),
                public_table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("principal".to_owned(), ColumnType::Principal),
                        (
                            "text".to_owned(),
                            ColumnType::Text {
                                max: TEXT_MAX as u32,
                            },
                        ),
                        (
                            "big".to_owned(),
                            ColumnType::Text {
                                max: BIG_TEXT_MAX as u32,
                            },
                        ),
                        ("bytes".to_owned(), ColumnType::Bytes { max: 4 }),
                        ("int".to_owned(), ColumnType::Int),
                        (
                            "enum".to_owned(),
                            ColumnType::Enum {
                                variants: vec!["x".to_owned(), "long".to_owned()],
                            },
                        ),
                        ("decimal".to_owned(), ColumnType::Decimal { scale: 4 }),
                        (
                            "money".to_owned(),
                            ColumnType::Money {
                                currency: "USD".to_owned(),
                                scale: 2,
                            },
                        ),
                        ("bool".to_owned(), ColumnType::Bool),
                        ("time".to_owned(), ColumnType::Time),
                        (
                            "reference".to_owned(),
                            ColumnType::Ref {
                                table: "profiles".to_owned(),
                            },
                        ),
                        ("json".to_owned(), ColumnType::Json { max_bytes: 16 }),
                        (
                            "optional".to_owned(),
                            ColumnType::Optional(Box::new(ColumnType::Text {
                                max: TEXT_MAX as u32,
                            })),
                        ),
                        (
                            "list".to_owned(),
                            ColumnType::List {
                                of: Box::new(ColumnType::Id),
                                max: 2,
                            },
                        ),
                    ]),
                    by_id(),
                ),
            ),
            (
                "onlytext".to_owned(),
                public_table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        (
                            "txt".to_owned(),
                            ColumnType::Text {
                                max: TEXT_MAX as u32,
                            },
                        ),
                    ]),
                    by_id(),
                ),
            ),
            (
                "profiles".to_owned(),
                public_table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        (
                            "displayName".to_owned(),
                            ColumnType::Text {
                                max: TEXT_MAX as u32,
                            },
                        ),
                        (
                            "handle".to_owned(),
                            ColumnType::Text {
                                max: TEXT_MAX as u32,
                            },
                        ),
                    ]),
                    by_id(),
                ),
            ),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn max_id(prefix: char) -> Value {
    id_with_payload(prefix, ID_PAYLOAD_MAX)
}

fn id_with_payload(prefix: char, payload: usize) -> Value {
    Value::Id(std::iter::repeat_n(prefix, payload).collect())
}

fn max_json() -> Value {
    let value = Value::String("xxx".to_owned());
    assert_eq!(canonical_json(&value).len(), 16);
    value
}

fn max_text(pattern: &[char], count: usize) -> Value {
    assert!(!pattern.is_empty());
    Value::String(pattern.iter().copied().cycle().take(count).collect())
}

fn maximum_rows(pattern: &[char]) -> BTreeMap<&'static str, Value> {
    BTreeMap::from([
        (
            "allTypes",
            object([
                ("id", max_id('a')),
                ("principal", max_id('p')),
                ("text", max_text(pattern, TEXT_MAX)),
                ("big", max_text(pattern, BIG_TEXT_MAX)),
                ("bytes", Value::Bytes(vec![u8::MAX; 4])),
                ("int", Value::Int(I53_MIN)),
                ("enum", Value::String("long".to_owned())),
                ("decimal", Value::Int(I53_MIN)),
                ("money", Value::Int(I53_MIN)),
                ("bool", Value::Bool(false)),
                ("time", Value::Int(I53_MIN)),
                ("reference", max_id('r')),
                ("json", max_json()),
                ("optional", max_text(pattern, TEXT_MAX)),
                ("list", Value::Array(vec![max_id('x'), max_id('y')])),
            ]),
        ),
        (
            "onlytext",
            object([("id", max_id('o')), ("txt", max_text(pattern, TEXT_MAX))]),
        ),
        (
            "profiles",
            object([
                ("id", max_id('r')),
                ("displayName", max_text(pattern, TEXT_MAX)),
                ("handle", max_text(pattern, TEXT_MAX)),
            ]),
        ),
    ])
}

fn get(table: &str, site: &str, key: Value) -> Expr {
    Expr::Get(Read {
        site: site.to_owned(),
        table: table.to_owned(),
        index: "byId".to_owned(),
        key: vec![Expr::Literal(key)],
        provenance: KeyProvenance::Const,
    })
}

fn scan(table: &str, site: &str, take: u32) -> Scan {
    Scan {
        site: site.to_owned(),
        table: table.to_owned(),
        index: "byId".to_owned(),
        prefix: Vec::new(),
        order: Order::Asc,
        take: Bound::Literal(take),
        after: None,
        before: None,
        range: None,
        provenance: KeyProvenance::Const,
    }
}

fn field(base: &str, name: &str) -> Expr {
    Expr::Field {
        base: Box::new(Expr::Variable(base.to_owned())),
        name: name.to_owned(),
    }
}

fn program(name: &str, body: Vec<Stmt>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}

fn row_binding(table: &str, name: &str, site: &str, key: Value) -> Stmt {
    Stmt::Const {
        name: name.to_owned(),
        value: get(table, site, key),
    }
}

fn full_shape(table: &Table, base: &str) -> Expr {
    Expr::Object(
        table
            .columns
            .keys()
            .map(|name| (name.clone(), field(base, name)))
            .collect(),
    )
}

fn optional_shape_program(name: &str) -> Program {
    program(
        name,
        vec![
            row_binding("allTypes", "row", &format!("{name}.row"), max_id('a')),
            Stmt::Let {
                name: "shape".to_owned(),
                value: Expr::Literal(Value::Null),
            },
            Stmt::If {
                condition: Expr::Binary {
                    op: BinaryOp::Ne,
                    left: Box::new(Expr::Variable("row".to_owned())),
                    right: Box::new(Expr::Literal(Value::Null)),
                },
                then_body: vec![Stmt::Assign {
                    name: "shape".to_owned(),
                    value: Expr::Object(BTreeMap::from([("big".to_owned(), field("row", "big"))])),
                }],
                else_body: Vec::new(),
            },
            Stmt::Return(Expr::Object(BTreeMap::from([(
                "p".to_owned(),
                Expr::Variable("shape".to_owned()),
            )]))),
        ],
    )
}

fn width_programs(schema: &Schema) -> Vec<Program> {
    let all_id = max_id('a');
    let profile_id = max_id('r');
    vec![
        program(
            "width.get-wide",
            vec![Stmt::Return(get(
                "allTypes",
                "width.get-wide.row",
                all_id.clone(),
            ))],
        ),
        program(
            "width.get-onlytext",
            vec![Stmt::Return(get(
                "onlytext",
                "width.get-onlytext.row",
                max_id('o'),
            ))],
        ),
        program(
            "width.spread",
            vec![
                row_binding("allTypes", "row", "width.spread.row", all_id.clone()),
                Stmt::Return(full_shape(schema.table("allTypes").unwrap(), "row")),
            ],
        ),
        program(
            "width.scalar",
            vec![
                row_binding("allTypes", "row", "width.scalar.row", all_id.clone()),
                Stmt::Return(Expr::Object(BTreeMap::from([(
                    "txt".to_owned(),
                    field("row", "text"),
                )]))),
            ],
        ),
        program(
            "width.big",
            vec![
                row_binding("allTypes", "row", "width.big.row", all_id.clone()),
                Stmt::Return(Expr::Object(BTreeMap::from([(
                    "big".to_owned(),
                    field("row", "big"),
                )]))),
            ],
        ),
        program(
            "width.nested",
            vec![
                row_binding("allTypes", "row", "width.nested.row", all_id),
                row_binding("profiles", "profile", "width.nested.profile", profile_id),
                Stmt::Return(Expr::Object(BTreeMap::from([
                    ("id".to_owned(), field("row", "id")),
                    ("text".to_owned(), field("row", "text")),
                    (
                        "profile".to_owned(),
                        Expr::Object(BTreeMap::from([
                            ("displayName".to_owned(), field("profile", "displayName")),
                            ("handle".to_owned(), field("profile", "handle")),
                        ])),
                    ),
                ]))),
            ],
        ),
        program(
            "width.list",
            vec![
                row_binding("allTypes", "row", "width.list.row", max_id('a')),
                Stmt::Return(Expr::Object(BTreeMap::from([(
                    "list".to_owned(),
                    field("row", "list"),
                )]))),
            ],
        ),
        optional_shape_program("width.optional-shape"),
    ]
}

fn retained_canonical_bytes(program: &str, result: &Value) -> u64 {
    let size = |value: &Value| canonical_json(value).len() as u64;
    match program {
        "width.get-wide" | "width.get-onlytext" | "width.spread" => size(result),
        "width.scalar" => size(result.field("txt").unwrap()),
        "width.big" => size(result.field("big").unwrap()),
        "width.list" => size(result.field("list").unwrap()),
        "width.optional-shape" => size(result.field("p").unwrap().field("big").unwrap()),
        "width.nested" => {
            let profile = result.field("profile").unwrap();
            size(result.field("id").unwrap())
                + size(result.field("text").unwrap())
                + size(profile.field("displayName").unwrap())
                + size(profile.field("handle").unwrap())
        }
        _ => unreachable!("unknown width program"),
    }
}

#[test]
fn maximum_text_rows_are_bounded_as_canonical_json() {
    let schema = schema();
    for pattern in [
        &['\u{10ffff}'][..],
        &['\n'][..],
        &['"'][..],
        &['\\'][..],
        &['\u{10ffff}', '\n', '"', '\\'][..],
    ] {
        let rows = maximum_rows(pattern);
        let mut engine = Engine::memory(schema.clone()).unwrap();
        for (table, row) in &rows {
            engine.seed(table, row.clone()).unwrap();
        }

        for program in width_programs(&schema) {
            let certificate = Checker::new(&schema, Ceilings::default())
                .check(&program)
                .unwrap();
            let execution = engine
                .execute(
                    &program,
                    &certificate,
                    Context::query(Actor::user("viewer").unwrap(), BTreeMap::new()),
                )
                .unwrap();
            let actual = canonical_json(&execution.result).len() as u64;
            let retained = retained_canonical_bytes(&program.name, &execution.result);
            assert!(
                certificate.max_output_bytes >= actual,
                "{} output {} did not bound canonical result {actual}",
                program.name,
                certificate.max_output_bytes,
            );
            assert!(
                certificate.max_closure_bytes >= retained,
                "{} closure {} did not bound retained canonical values {retained}",
                program.name,
                certificate.max_closure_bytes,
            );
            if program.name == "width.spread" {
                let row = declared_serialized_row_max(&schema, "allTypes");
                assert_eq!(certificate.max_output_bytes, row, "* must cost one row");
                assert_eq!(certificate.max_closure_bytes, row, "* must retain one row");
            }
        }
    }
}

#[test]
fn text_arguments_use_the_four_byte_code_point_bound() {
    let schema = schema();
    let program = Program {
        name: "width.text-argument".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(
            "txt".to_owned(),
            ArgType::Text {
                max: TEXT_MAX as u32,
            },
        )]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Variable("txt".to_owned()))],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.max_output_bytes, 4 * TEXT_MAX as u64 + 16);
    for pattern in [&['\u{10ffff}'][..], &['"'][..]] {
        let actual = canonical_json(&max_text(pattern, TEXT_MAX)).len() as u64;
        assert!(certificate.max_output_bytes >= actual);
    }
}

fn closure_grouping_schema() -> Schema {
    let schema = Schema {
        tables: BTreeMap::from([(
            "wide".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("big".to_owned(), ColumnType::Json { max_bytes: 1_000 }),
                    ("txt".to_owned(), ColumnType::Json { max_bytes: 50 }),
                    (
                        "list".to_owned(),
                        ColumnType::List {
                            of: Box::new(ColumnType::Id),
                            max: 2,
                        },
                    ),
                    ("n".to_owned(), ColumnType::Int),
                    (
                        "opt".to_owned(),
                        ColumnType::Optional(Box::new(ColumnType::Json { max_bytes: 40 })),
                    ),
                ]),
                by_id(),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    assert_eq!(declared_serialized_row_max(&schema, "wide"), 1_666);
    schema
}

fn page_binding() -> Stmt {
    Stmt::Const {
        name: "page".to_owned(),
        value: Expr::Scan(scan("wide", "s1", 2)),
    }
}

fn page_loop(binding: &str, body: Vec<Stmt>) -> Stmt {
    Stmt::For {
        binding: binding.to_owned(),
        domain: LoopDomain::DerivedArray {
            value: Expr::Variable("page".to_owned()),
            max: 2,
            bound_source: "page take 2".to_owned(),
        },
        body,
    }
}

#[test]
fn closure_objects_never_merge_distinct_row_bases() {
    let schema = closure_grouping_schema();
    let cases = [
        (
            "closure.two-bases",
            vec![
                page_binding(),
                page_loop(
                    "a",
                    vec![page_loop(
                        "b",
                        vec![Stmt::Return(Expr::Object(BTreeMap::from([
                            ("x".to_owned(), field("a", "big")),
                            ("y".to_owned(), field("b", "big")),
                        ])))],
                    )],
                ),
            ],
            2_046,
        ),
        (
            "closure.page-and-row",
            vec![
                page_binding(),
                page_loop(
                    "r",
                    vec![Stmt::Return(Expr::Object(BTreeMap::from([
                        ("all".to_owned(), Expr::Variable("page".to_owned())),
                        ("one".to_owned(), field("r", "big")),
                    ])))],
                ),
            ],
            4_355,
        ),
        (
            "closure.push-page-and-row",
            vec![
                page_binding(),
                Stmt::Let {
                    name: "out".to_owned(),
                    value: Expr::Array(Vec::new()),
                },
                page_loop(
                    "a",
                    vec![Stmt::Push {
                        target: "out".to_owned(),
                        value: Expr::Object(BTreeMap::from([
                            ("me".to_owned(), Expr::Variable("a".to_owned())),
                            ("all".to_owned(), Expr::Variable("page".to_owned())),
                        ])),
                    }],
                ),
                Stmt::Return(Expr::Variable("out".to_owned())),
            ],
            9_996,
        ),
        (
            "closure.push-two-bases",
            vec![
                page_binding(),
                Stmt::Let {
                    name: "out".to_owned(),
                    value: Expr::Array(Vec::new()),
                },
                page_loop(
                    "a",
                    vec![page_loop(
                        "b",
                        vec![Stmt::Push {
                            target: "out".to_owned(),
                            value: Expr::Object(BTreeMap::from([
                                ("x".to_owned(), field("a", "big")),
                                ("y".to_owned(), field("b", "big")),
                            ])),
                        }],
                    )],
                ),
                Stmt::Return(Expr::Variable("out".to_owned())),
            ],
            8_184,
        ),
    ];

    for (name, body, expected) in cases {
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program(name, body))
            .unwrap();
        assert_eq!(
            certificate.max_closure_bytes, expected,
            "{name} mixed distinct row bases"
        );
    }
}

#[test]
fn canonical_tags_are_included_in_structural_bounds() {
    let schema = schema();
    let literal = program(
        "canonical.literal-row",
        vec![Stmt::Return(Expr::Object(BTreeMap::from([(
            "a".to_owned(),
            Expr::Literal(Value::Int(1)),
        )])))],
    );
    let literal_certificate = Checker::new(&schema, Ceilings::default())
        .check(&literal)
        .unwrap();
    let literal_actual = canonical_json(&object([("a", Value::Int(1))])).len() as u64;
    assert_eq!(literal_actual, 23);
    assert!(literal_certificate.max_output_bytes >= literal_actual);

    let list_program = width_programs(&schema)
        .into_iter()
        .find(|program| program.name == "width.list")
        .unwrap();
    let rows = maximum_rows(&['x']);
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for (table, row) in &rows {
        engine.seed(table, row.clone()).unwrap();
    }
    let list_certificate = Checker::new(&schema, Ceilings::default())
        .check(&list_program)
        .unwrap();
    let list_result = engine
        .execute(
            &list_program,
            &list_certificate,
            Context::query(Actor::user("viewer").unwrap(), BTreeMap::new()),
        )
        .unwrap()
        .result;
    let list_actual = canonical_json(&list_result).len() as u64;
    assert_eq!(list_actual, 318);
    assert!(list_certificate.max_output_bytes >= list_actual);

    let optional = optional_shape_program("canonical.optional-shape");
    let optional_certificate = Checker::new(&schema, Ceilings::default())
        .check(&optional)
        .unwrap();
    let optional_result = engine
        .execute(
            &optional,
            &optional_certificate,
            Context::query(Actor::user("viewer").unwrap(), BTreeMap::new()),
        )
        .unwrap()
        .result;
    let optional_actual = canonical_json(&optional_result).len() as u64;
    assert_eq!(optional_actual, 1_043);
    assert!(optional_certificate.max_output_bytes >= optional_actual);
}

#[test]
fn canonical_array_and_whole_row_pins_cover_the_review_cases() {
    let mut schema = schema();
    schema.tables.insert(
        "slim".to_owned(),
        public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                (
                    "ref".to_owned(),
                    ColumnType::Ref {
                        table: "profiles".to_owned(),
                    },
                ),
                ("principal".to_owned(), ColumnType::Principal),
                (
                    "list".to_owned(),
                    ColumnType::List {
                        of: Box::new(ColumnType::Id),
                        max: 2,
                    },
                ),
            ]),
            by_id(),
        ),
    );
    let slim_id = id_with_payload('s', 133);
    let mut engine = Engine::memory(schema.clone()).unwrap();
    engine
        .seed(
            "slim",
            object([
                ("id", slim_id.clone()),
                ("ref", id_with_payload('r', 133)),
                ("principal", id_with_payload('p', 133)),
                (
                    "list",
                    Value::Array(vec![id_with_payload('x', 133), id_with_payload('y', 133)]),
                ),
            ]),
        )
        .unwrap();
    for id in [max_id('a'), max_id('b')] {
        let mut columns = maximum_rows(&['x'])
            .remove("allTypes")
            .unwrap()
            .as_object()
            .unwrap()
            .clone();
        columns.insert("id".to_owned(), id);
        engine.seed("allTypes", Value::Row(columns)).unwrap();
    }

    let get_slim = program(
        "canonical.get-slim",
        vec![Stmt::Return(get("slim", "canonical.get-slim.row", slim_id))],
    );
    let get_certificate = Checker::new(&schema, Ceilings::default())
        .check(&get_slim)
        .unwrap();
    let get_result = engine
        .execute(
            &get_slim,
            &get_certificate,
            Context::query(Actor::user("viewer").unwrap(), BTreeMap::new()),
        )
        .unwrap()
        .result;
    let get_actual = canonical_json(&get_result).len() as u64;
    assert_eq!(get_actual, 766);
    assert!(get_certificate.max_output_bytes >= get_actual);

    let pushed = program(
        "canonical.push-two",
        vec![
            Stmt::Let {
                name: "out".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "r".to_owned(),
                domain: LoopDomain::Page(scan("allTypes", "canonical.push-two.page", 2)),
                body: vec![Stmt::Push {
                    target: "out".to_owned(),
                    value: Expr::Object(BTreeMap::from([("big".to_owned(), field("r", "big"))])),
                }],
            },
            Stmt::Return(Expr::Variable("out".to_owned())),
        ],
    );
    let pushed_certificate = Checker::new(&schema, Ceilings::default())
        .check(&pushed)
        .unwrap();
    let pushed_result = engine
        .execute(
            &pushed,
            &pushed_certificate,
            Context::query(Actor::user("viewer").unwrap(), BTreeMap::new()),
        )
        .unwrap()
        .result;
    let pushed_actual = canonical_json(&pushed_result).len() as u64;
    assert_eq!(pushed_actual, 2_071);
    assert!(pushed_certificate.max_output_bytes >= pushed_actual);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusCase {
    name: String,
    schema: Schema,
    program: Program,
    expected: CorpusExpected,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusExpected {
    local_result: Option<Value>,
    canonical_result: String,
}

#[test]
fn corpus_output_estimates_bound_recorded_canonical_results() {
    let cases: Vec<CorpusCase> =
        serde_json::from_str(include_str!("../../../corpus/manifest.json")).unwrap();
    let mut failures = Vec::new();
    for case in cases {
        let Ok(certificate) = Checker::new(&case.schema, Ceilings::default()).check(&case.program)
        else {
            failures.push(format!("{}: current program refused", case.name));
            continue;
        };
        let Some(result) = case.expected.local_result else {
            continue;
        };
        let canonical = canonical_json(&result);
        if canonical != case.expected.canonical_result {
            failures.push(format!("{}: recorded canonical result is stale", case.name));
        } else if certificate.max_output_bytes < canonical.len() as u64 {
            failures.push(format!(
                "{}: output {} < canonical result {}",
                case.name,
                certificate.max_output_bytes,
                canonical.len(),
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "unsound corpus estimates:\n{}",
        failures.join("\n"),
    );
}
