use serde::Deserialize;
use snapback2_core::engine::RowRecord;
use snapback2_core::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorCorpusCase {
    name: String,
    category: String,
    schema: Schema,
    program: Program,
    context: FrozenContext,
    receipt: FrozenReceipt,
    expected: FrozenExpected,
}

#[derive(Deserialize)]
struct FrozenContext {
    viewer: String,
    principal_kind: String,
    auth_epoch: u64,
    args: BTreeMap<String, Value>,
    now: Option<i64>,
    new_ids: VecDeque<String>,
    read_time: Option<i64>,
}

impl FrozenContext {
    fn thaw(self) -> Context {
        let actor = Actor::new(self.viewer, self.principal_kind).expect("corpus actor");
        let mut context = Context::query(actor, self.args);
        context.auth_epoch = self.auth_epoch;
        context.now = self.now;
        context.new_ids = self.new_ids;
        context.read_time = self.read_time;
        context
    }
}

#[derive(Deserialize)]
struct FrozenReceipt {
    rows: Vec<RowRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrozenExpected {
    local_result: Option<Value>,
    next: Option<String>,
}

#[test]
fn frozen_cursor_cases_execute_against_the_engine() {
    let cases: Vec<CursorCorpusCase> =
        serde_json::from_str(include_str!("../../../corpus/manifest.json")).unwrap();
    let selected = cases
        .into_iter()
        .filter(|case| case.category == "cursor")
        .collect::<Vec<_>>();
    assert_eq!(selected.len(), 10, "the frozen cursor case count changed");
    let names = selected
        .iter()
        .map(|case| case.name.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        names,
        BTreeSet::from([
            "cursor-asc-after-duplicate-tie",
            "cursor-asc-before-two-pages",
            "cursor-desc-after-two-pages",
            "cursor-desc-before-two-pages",
            "opaque-cursor-capped-next-token",
            "opaque-cursor-complete-next-null",
            "opaque-cursor-empty-capped-next-null",
            "opaque-cursor-merge-capped-token",
            "opaque-cursor-merge-page-two",
            "opaque-cursor-page-two-no-overlap",
        ])
    );

    let bodies = selected
        .iter()
        .map(|case| serde_json::to_value(&case.program.body).unwrap())
        .collect::<Vec<_>>();
    assert!(
        bodies
            .iter()
            .any(|body| contains_key_value(body, "order", "Desc"))
    );
    assert!(
        bodies
            .iter()
            .any(|body| body.to_string().contains("\"opaque_cursor\":true"))
    );

    for case in selected {
        let certificate = Checker::new(&case.schema, Ceilings::default())
            .check(&case.program)
            .unwrap_or_else(|errors| panic!("{} refused: {errors:?}", case.name));
        let mut engine = Engine::memory(case.schema.clone()).expect("memory engine");
        for seeded in case.receipt.rows {
            engine.seed(&seeded.table, seeded.row).unwrap();
        }
        let execution = engine
            .execute(&case.program, &certificate, case.context.thaw())
            .unwrap_or_else(|error| panic!("{} failed: {error}", case.name));
        assert_eq!(
            Some(execution.result),
            case.expected.local_result,
            "{}",
            case.name
        );
        assert_eq!(execution.next, case.expected.next, "{} next", case.name);
    }
}

#[test]
fn opaque_cursor_argument_may_flow_through_a_binding() {
    let mut case: CursorCorpusCase = serde_json::from_str(include_str!(
        "../../../corpus/opaque-cursor-page-two-no-overlap.json"
    ))
    .unwrap();
    let Stmt::Return(Expr::Scan(mut scan)) = case.program.body.pop().unwrap() else {
        panic!("opaque cursor case stopped returning one scan")
    };
    scan.after = Some(Box::new(Expr::Variable("position".to_owned())));
    case.program.body = vec![
        Stmt::Const {
            name: "position".to_owned(),
            value: Expr::Variable("c".to_owned()),
        },
        Stmt::Return(Expr::Scan(scan)),
    ];
    let certificate = Checker::new(&case.schema, Ceilings::default())
        .check(&case.program)
        .expect("bound cursor program must certify");
    let mut engine = Engine::memory(case.schema.clone()).unwrap();
    for seeded in case.receipt.rows {
        engine.seed(&seeded.table, seeded.row).unwrap();
    }
    let execution = engine
        .execute(&case.program, &certificate, case.context.thaw())
        .expect("bound opaque cursor must validate before its scan");
    assert_eq!(Some(execution.result), case.expected.local_result);
}

#[test]
fn engine_rejects_a_non_scalar_cursor_component() {
    let schema = cursor_schema();
    let program = scan_program(
        "objectCursor",
        "byId",
        vec![],
        Expr::Object(BTreeMap::new()),
    );
    let refusal = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err()
        .into_iter()
        .find(|error| error.code == "E_ARGS_CURSOR_SHAPE")
        .expect("known one-column object cursor refusal");
    assert_eq!(
        refusal.message,
        "scan programs.objectCursor.0 after cursor must be an indexable scalar"
    );
    let error = execute_with_cursor(&schema, &program).unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: row is not an indexable scalar"
    );
}

#[test]
fn full_prefix_cursor_is_rejected_at_certify_and_runtime() {
    let schema = cursor_schema();
    let mut program = scan_program(
        "fullPrefixCursor",
        "byOwnerAt",
        vec![literal_id("owner-1"), literal_int(1), literal_id("row-1")],
        literal_id("row-1"),
    );
    let Stmt::Return(Expr::Scan(scan)) = &mut program.body[0] else {
        unreachable!()
    };
    scan.before = Some(Box::new(literal_id("row-2")));
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    let cursor_errors = errors
        .iter()
        .filter(|error| error.code == "E_ARGS_CURSOR_SHAPE")
        .collect::<Vec<_>>();
    assert_eq!(cursor_errors.len(), 2);
    let cursor_error = cursor_errors[0];
    assert_eq!(
        cursor_error.message,
        "scan items.byOwnerAt prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix"
    );
    assert_eq!(
        cursor_error.rewrite,
        "remove after and before from the scan of items.byOwnerAt; its prefix already names every index column"
    );
    let error = execute_with_cursor(&schema, &program).unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: scan items.byOwnerAt prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix"
    );
}

#[test]
fn overlong_scan_prefix_is_rejected_at_certify_and_runtime() {
    let schema = cursor_schema();
    let program = scan_program(
        "overlongPrefix",
        "byId",
        vec![literal_id("a"), literal_id("b")],
        literal_id("c"),
    );
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert_eq!(
        errors
            .iter()
            .filter(|error| error.code == "E_ARGS_TYPE")
            .map(|error| error.message.as_str())
            .collect::<Vec<_>>(),
        vec![
            "scan programs.overlongPrefix.0 prefix supplies 2 components but items.byId has 1 columns"
        ]
    );
    assert!(
        errors
            .iter()
            .all(|error| error.code != "E_ARGS_CURSOR_SHAPE")
    );
    let error = execute_with_overlong_prefix(&schema, &program).unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: scan items.byId prefix has too many columns"
    );
}

#[test]
fn point_read_key_arity_is_rejected_at_certify_and_runtime() {
    let schema = cursor_schema();
    let program = Program {
        name: "overlongPoint".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "programs.overlongPoint.0".to_owned(),
            table: "items".to_owned(),
            index: "byId".to_owned(),
            key: vec![literal_id("a"), literal_id("b")],
            provenance: KeyProvenance::Const,
        }))],
    };
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert!(errors.iter().any(|error| {
        error.code == "E_ARGS_TYPE"
            && error.message
                == "point read programs.overlongPoint.0 key supplies 2 components but items.byId has 1 columns"
    }));
    let error = execute_with_overlong_point_key(&schema, &program).unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: point read items.byId supplied 2 of 1 key columns"
    );
}

#[test]
fn one_column_scalar_cursor_kind_is_checked_statically() {
    let schema = cursor_schema();
    let program = scan_program("scalarKind", "byId", vec![], literal_int(1));
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert!(errors.iter().any(|error| {
        error.code == "E_ARGS_TYPE"
            && error.message
                == "scan programs.scalarKind.0 after cursor component 1 is Int but items.byId column id is Id"
    }));
}

#[test]
fn wrong_domain_cursor_is_rejected_at_certify_and_runtime() {
    let schema = cursor_schema();
    let program = scan_program(
        "wrongDomainCursor",
        "byAt",
        vec![],
        Expr::Array(vec![literal_id("row-1"), literal_int(1)]),
    );
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    let messages = errors
        .iter()
        .filter(|error| error.code == "E_ARGS_TYPE")
        .map(|error| error.message.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        messages,
        vec![
            "scan programs.wrongDomainCursor.0 after cursor component 1 is Id but items.byAt column at is Int",
            "scan programs.wrongDomainCursor.0 after cursor component 2 is Int but items.byAt column id is Id",
        ]
    );
    let error = execute_with_cursor(&schema, &program).unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: cursor component for items.byAt column at must be Int, got id"
    );
}

#[test]
fn optional_cursor_defers_its_non_null_arm_to_runtime() {
    let schema = cursor_schema();
    let mut program = scan_program(
        "optionalCursor",
        "byId",
        vec![],
        Expr::Variable("cursor".to_owned()),
    );
    program.args.insert(
        "cursor".to_owned(),
        ArgType::Optional(Box::new(ArgType::Int)),
    );
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .expect("optional cursor must certify");
    let context = |cursor| {
        Context::query(
            Actor::user("viewer-1").unwrap(),
            BTreeMap::from([("cursor".to_owned(), cursor)]),
        )
    };
    let mut engine = Engine::memory(schema).unwrap();
    let execution = engine
        .execute(&program, &certificate, context(Value::Null))
        .expect("Null cursor sentinel must execute");
    assert_eq!(execution.result, Value::Array(vec![]));
    let error = engine
        .execute(&program, &certificate, context(Value::Int(1)))
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: cursor component for items.byId column id must be Id, got int"
    );
}

#[test]
fn missing_point_read_cursor_certifies_and_executes_as_null() {
    let schema = cursor_schema();
    let program = scan_program(
        "missingPointCursor",
        "byId",
        vec![],
        Expr::Get(Read {
            site: "programs.missingPointCursor.1".to_owned(),
            table: "items".to_owned(),
            index: "byId".to_owned(),
            key: vec![literal_id("missing")],
            provenance: KeyProvenance::Const,
        }),
    );
    let execution = execute_checked(
        &schema,
        &program,
        Context::query(Actor::user("viewer-1").unwrap(), BTreeMap::new()),
    )
    .expect("a missing point read becomes the Null cursor sentinel");
    assert_eq!(execution.result, Value::Array(vec![]));
}

#[test]
fn engine_rejects_non_indexable_point_prefix_range_and_indexed_write_values() {
    let schema = cursor_schema();
    let point = Program {
        name: "nonScalarPoint".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "programs.nonScalarPoint.0".to_owned(),
            table: "items".to_owned(),
            index: "byId".to_owned(),
            key: vec![Expr::Object(BTreeMap::new())],
            provenance: KeyProvenance::Const,
        }))],
    };
    assert_non_indexable_runtime_error(&schema, &point, ProgramKind::Query);

    let prefix =
        uncursored_scan_program("nonScalarPrefix", vec![Expr::Object(BTreeMap::new())], None);
    assert_non_indexable_runtime_error(&schema, &prefix, ProgramKind::Query);

    let range = uncursored_scan_program(
        "nonScalarRange",
        vec![],
        Some(Range {
            gt: Some(Box::new(Expr::Object(BTreeMap::new()))),
            gte: None,
            lt: None,
            lte: None,
        }),
    );
    assert_non_indexable_runtime_error(&schema, &range, ProgramKind::Query);

    let mut write_schema = cursor_schema();
    let table = write_schema.tables.get_mut("items").unwrap();
    table
        .columns
        .insert("payload".to_owned(), ColumnType::Json { max_bytes: 256 });
    table.indexes.insert(
        "byPayload".to_owned(),
        Index {
            components: (vec!["payload".to_owned(), "id".to_owned()])
                .into_iter()
                .map(snapback2_core::search_key::IndexComponent::Column)
                .collect(),
            unique: false,
        },
    );
    let insert = Program {
        name: "nonScalarIndexedWrite".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "items".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), literal_id("row-1")),
                    ("owner".to_owned(), literal_id("owner-1")),
                    ("at".to_owned(), literal_int(1)),
                    (
                        "payload".to_owned(),
                        Expr::Object(BTreeMap::from([("x".to_owned(), literal_int(1))])),
                    ),
                ])),
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    assert_non_indexable_runtime_error(&write_schema, &insert, ProgramKind::Mutation);
}

#[test]
fn pageable_merge_index_must_end_in_intrinsic_id() {
    let mut schema = cursor_schema();
    let index = schema
        .tables
        .get_mut("items")
        .unwrap()
        .indexes
        .get_mut("byAt")
        .unwrap();
    index.components = vec![IndexComponent::Column("at".to_owned())];
    index.unique = true;
    let mut program = uncursored_scan_program("mergeWithoutId", vec![], None);
    let Stmt::Return(Expr::Scan(scan)) = &mut program.body[0] else {
        unreachable!()
    };
    scan.index = "byAt".to_owned();
    scan.merge_site = Some("programs.mergeWithoutId.merge".to_owned());
    let refusal = Checker::new(&schema, Ceilings::default())
        .check_all(&program)
        .unwrap_err()
        .into_iter()
        .find(|error| error.code == "E_ARGS_CURSOR_INDEX")
        .expect("merge id refusal");
    assert!(refusal.message.contains("pageable merge") && refusal.rewrite.contains("[at, id]"));
}

fn assert_non_indexable_runtime_error(schema: &Schema, program: &Program, kind: ProgramKind) {
    let context = match kind {
        ProgramKind::Job => panic!("client cursor corpus contains no jobs"),
        ProgramKind::Query => Context::query(Actor::user("viewer-1").unwrap(), BTreeMap::new()),
        ProgramKind::Mutation => {
            Context::mutation(Actor::user("viewer-1").unwrap(), BTreeMap::new())
        }
    };
    let error = execute_checked(schema, program, context).unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_SCHEMA: row is not an indexable scalar"
    );
}

fn execute_checked(
    schema: &Schema,
    program: &Program,
    context: Context,
) -> Result<Execution, RuntimeError> {
    let certificate = Checker::new(schema, Ceilings::default())
        .check(program)
        .expect("runtime-parity program must certify");
    Engine::memory(schema.clone())?.execute(program, &certificate, context)
}

fn uncursored_scan_program(name: &str, prefix: Vec<Expr>, range: Option<Range>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: format!("programs.{name}.0"),
            table: "items".to_owned(),
            index: "byId".to_owned(),
            prefix: prefix.into_iter().map(IndexKeyExpr::Scalar).collect(),
            order: Order::Asc,
            take: Bound::Literal(2),
            after: None,
            before: None,
            range,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn execute_with_cursor(schema: &Schema, program: &Program) -> Result<Execution, RuntimeError> {
    let mut certifiable = program.clone();
    let Stmt::Return(Expr::Scan(scan)) = &mut certifiable.body[0] else {
        unreachable!("test program is one returned scan")
    };
    scan.after = None;
    scan.before = None;
    // Execution resolves certified reads by site name, and a certificate does not encode
    // the cursor. The cursor-free certificate with the runtime program's plan hash is
    // therefore valid for reaching cursor validation. Revisit this forge if execution
    // ever verifies read-site shapes rather than their certified names.
    let mut certificate = Checker::new(schema, Ceilings::default())
        .check(&certifiable)
        .expect("cursor-free certificate");
    certificate.plan_hash = digest(program);
    Engine::memory(schema.clone())?.execute(
        program,
        &certificate,
        Context::query(Actor::user("viewer-1").unwrap(), BTreeMap::new()),
    )
}

fn execute_with_overlong_prefix(
    schema: &Schema,
    program: &Program,
) -> Result<Execution, RuntimeError> {
    let mut certifiable = program.clone();
    let Stmt::Return(Expr::Scan(scan)) = &mut certifiable.body[0] else {
        unreachable!()
    };
    scan.prefix.truncate(1);
    scan.after = None;
    let mut certificate = Checker::new(schema, Ceilings::default())
        .check(&certifiable)
        .expect("shape-valid scan certificate");
    certificate.plan_hash = digest(program);
    Engine::memory(schema.clone())?.execute(
        program,
        &certificate,
        Context::query(Actor::user("viewer-1").unwrap(), BTreeMap::new()),
    )
}

fn execute_with_overlong_point_key(
    schema: &Schema,
    program: &Program,
) -> Result<Execution, RuntimeError> {
    let mut certifiable = program.clone();
    let Stmt::Return(Expr::Get(read)) = &mut certifiable.body[0] else {
        unreachable!()
    };
    read.key.truncate(1);
    let mut certificate = Checker::new(schema, Ceilings::default())
        .check(&certifiable)
        .expect("arity-valid point certificate");
    certificate.plan_hash = digest(program);
    Engine::memory(schema.clone())?.execute(
        program,
        &certificate,
        Context::query(Actor::user("viewer-1").unwrap(), BTreeMap::new()),
    )
}

fn scan_program(name: &str, index: &str, prefix: Vec<Expr>, after: Expr) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: format!("programs.{name}.0"),
            table: "items".to_owned(),
            index: index.to_owned(),
            prefix: prefix.into_iter().map(IndexKeyExpr::Scalar).collect(),
            order: Order::Asc,
            take: Bound::Literal(2),
            after: Some(Box::new(after)),
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    }
}

fn cursor_schema() -> Schema {
    let public = RuleExpr::Public {
        reason: "cursor regression".to_owned(),
    };
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("owner".to_owned(), ColumnType::Id),
                    ("at".to_owned(), ColumnType::Int),
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
                        "byOwnerAt".to_owned(),
                        Index {
                            components: (vec![
                                "owner".to_owned(),
                                "at".to_owned(),
                                "id".to_owned(),
                            ])
                            .into_iter()
                            .map(snapback2_core::search_key::IndexComponent::Column)
                            .collect(),
                            unique: false,
                        },
                    ),
                ]),
                rules: Rules {
                    read: public.clone(),
                    insert: public.clone(),
                    update: public.clone(),
                    delete: public,
                },
                constraints: vec![],
                retain: Default::default(),
            },
        )]),
        ..Schema::default()
    }
}

fn literal_id(value: &str) -> Expr {
    Expr::Literal(Value::Id(value.to_owned()))
}

fn literal_int(value: i64) -> Expr {
    Expr::Literal(Value::Int(value))
}

fn contains_key_value(value: &serde_json::Value, key: &str, expected: &str) -> bool {
    match value {
        serde_json::Value::Array(values) => values
            .iter()
            .any(|value| contains_key_value(value, key, expected)),
        serde_json::Value::Object(values) => {
            values.get(key).and_then(serde_json::Value::as_str) == Some(expected)
                || values
                    .values()
                    .any(|value| contains_key_value(value, key, expected))
        }
        _ => false,
    }
}
