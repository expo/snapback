//! The Snapback 2 conformance corpus (LLP 2000.000 §5.1), run against the
//! Snapback 4 engine as a server with exactly the rows the twin held.
//! Legacy receipt custody, static pricing, search, shared effect ids and asset-record fixtures
//! have named semantic exclusions. This adapter establishes Rust server
//! conformance only; it makes no TypeScript interpreter or replica claim.

use snapback4_core::{Context, Engine, Program, Schema, Value, WriteState};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    schema: serde_json::Value,
    program: serde_json::Value,
    context: CaseContext,
    certificate: serde_json::Value,
    receipt: Receipt,
    #[serde(default)]
    prelude: Vec<Prelude>,
    #[serde(rename = "replacementReceipt", default)]
    replacement_receipt: Option<serde_json::Value>,
    expected: Expected,
}

#[derive(serde::Deserialize)]
struct Prelude {
    program: serde_json::Value,
    context: CaseContext,
}

#[derive(serde::Deserialize)]
struct CaseContext {
    viewer: String,
    #[serde(default)]
    args: BTreeMap<String, Value>,
    now: Option<i64>,
    #[serde(default)]
    new_ids: Vec<String>,
    read_time: Option<i64>,
}

#[derive(serde::Deserialize)]
struct Receipt {
    #[serde(default)]
    rows: Vec<ReceiptRow>,
    #[serde(default)]
    verdicts: Vec<serde_json::Value>,
}

#[derive(serde::Deserialize)]
struct ReceiptRow {
    table: String,
    row: Value,
}

#[derive(Clone, serde::Deserialize)]
struct Expected {
    #[serde(rename = "errorCode")]
    error_code: Option<String>,
    #[serde(rename = "localState")]
    local_state: LocalState,
    #[serde(rename = "canonicalResult")]
    canonical_result: Option<String>,
    // A missing field is an invalid fixture; explicit null means no cursor.
    #[serde(deserialize_with = "nullable_cursor")]
    next: Option<String>,
    #[serde(rename = "partialSites")]
    partial_sites: Vec<String>,
    #[serde(rename = "rangeStops")]
    range_stops: BTreeMap<String, Vec<String>>,
}

fn nullable_cursor<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    serde::Deserialize::deserialize(deserializer)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
enum LocalState {
    Fresh,
    Predicted,
    Partial,
    Refused,
    Rejected,
    Denied,
    CertificationRefused,
}

#[derive(Debug)]
struct Actual {
    result: Option<Value>,
    error: Option<String>,
    state: LocalState,
    next: Option<String>,
}

fn refused(why: snapback4_core::Refusal, mutation: bool) -> Actual {
    // The source exporter distinguishes application require/check outcomes
    // from engine refusals. The card carries that distinction in the rule
    // field or E_CONFLICT, rather than in a second write-state vocabulary.
    let application = why.rule.is_some() || why.code == "E_CONFLICT";
    let admission = matches!(why.code.as_str(), "E_STRUCTURAL_FANOUT" | "E_UNBOUND_SCAN");
    Actual { result: None, error: Some(format!("{} ({})", why.code, why.message)), state: if admission { LocalState::CertificationRefused } else if application { if mutation { LocalState::Rejected } else { LocalState::Denied } } else { LocalState::Refused }, next: None }
}

#[derive(Debug)]
enum Verdict {
    Pass,
    Skip(String),
    Fail(String),
}

/// Exclusions name a removed mechanism in the input/oracle, never a
/// failure observed while executing it. New schema/IR errors stay failures.
fn exclusion(case: &Case) -> Option<&'static str> {
    // @ref LLP 3000.007#19.1 — the frozen SB2 oracle reserves a row id for emit; named-emit-independent-ids covers the replacement contract.
    if case.name == "named-emit" {
        return Some("shared-effect-id-supply: this frozen oracle spends a row/result id on an effect; SB4 gives effects independent commit/ordinal ids");
    }
    let tables: Vec<_> = case.schema["tables"].as_object().into_iter().flat_map(|tables| tables.values()).collect();
    let search_index = tables.iter().any(|table| {
        table["indexes"].as_object().into_iter().flat_map(|indexes| indexes.values()).any(|index| index["components"].as_array().is_some_and(|components| components.iter().any(|component| component.get("WordPrefixes").is_some())))
    });
    if search_index || has_key(&case.program, &["WordPrefix", "held_search"]) {
        return Some("legacy-word-search: the copied prefix-search IR is outside the SB4 slice");
    }
    if ["deliver", "tombstones", "channels"].iter().any(|key| case.schema.get(key).is_some() || tables.iter().any(|table| table.get(key).is_some())) {
        return Some("legacy-delivery: deliver/tombstone/channel tables were replaced by the partition log");
    }
    if case.replacement_receipt.is_some() {
        return Some("receipt-replacement: this oracle depends on swapping a Snapback 2 closure receipt");
    }
    if !case.receipt.verdicts.is_empty() || case.expected.partial_sites.iter().any(|site| site == "missing-authority") {
        return Some("receipt-authority: this oracle depends on a held or deliberately missing closure verdict");
    }
    if case.expected.local_state == LocalState::Partial
        && case.certificate["completeness"] == "Page"
        && !case.expected.partial_sites.is_empty()
        && (case.certificate["read_sites"].as_array().is_some_and(|sites| !sites.is_empty()) || case.certificate["constraint_checks"].as_array().is_some_and(|checks| !checks.is_empty()))
    {
        return Some("receipt-coverage: Page authority is partial because receipt extents/absences or their post-write halo are missing; a complete server store has no such receipt");
    }
    if case.expected.local_state == LocalState::CertificationRefused && case.expected.error_code.as_deref() == Some("E_BOUND") {
        return Some("static-resource-price: E_BOUND before execution was replaced by runtime metering");
    }
    if case.expected.local_state == LocalState::Refused && case.expected.error_code.as_deref() == Some("E_ASSET_TYPE")
        && case.program["args"].as_object().is_some_and(|args| args.values().any(|kind| has_key(kind, &["Image", "Video"])))
    {
        // @ref LLP 3000#7-decisions-during-execution — SB4 accepts upload references and puts server facts in place; the old closed metadata record is not its argument contract.
        return Some("legacy-asset-record: SB2 requires exact positive metadata and a string-tagged minted s2id; SB4 accepts {id}, uses nominal ids internally, and stamps the server's facts (contract.ts Asset; assets.rs::column_value)");
    }
    if case.expected.local_state == LocalState::Predicted
        && case.program["args"].as_object().is_some_and(|args| args.iter().any(|(name, kind)| case.context.args.get(name).is_some_and(|value| needs_uploaded_asset(kind, value))))
    {
        return Some("legacy-asset-upload: predicted asset writes carry Snapback 2 asset ids but no authoritative SB4 uploaded bytes/facts");
    }
    None
}

fn needs_uploaded_asset(kind: &serde_json::Value, value: &Value) -> bool {
    if *value == Value::Null {
        return false;
    }
    if kind.get("Image").is_some() || kind.get("Video").is_some() {
        return true;
    }
    if let Some(inner) = kind.get("Optional") {
        return needs_uploaded_asset(inner, value);
    }
    if let (Some(list), Value::Array(values)) = (kind.get("List"), value) {
        return values.iter().any(|value| needs_uploaded_asset(&list["of"], value));
    }
    false
}

fn has_key(value: &serde_json::Value, names: &[&str]) -> bool {
    match value {
        serde_json::Value::Object(fields) => fields.iter().any(|(key, value)| names.contains(&key.as_str()) || has_key(value, names)),
        serde_json::Value::Array(values) => values.iter().any(|value| has_key(value, names)),
        _ => false,
    }
}

fn run(case: &Case) -> Verdict {
    if let Some(reason) = exclusion(case) {
        return Verdict::Skip(reason.to_owned());
    }
    let mut schema: Schema = match serde_json::from_value(case.schema.clone()) {
        Ok(schema) => schema,
        Err(error) => return Verdict::Fail(format!("schema does not load: {error}")),
    };
    let program: Program = match serde_json::from_value(case.program.clone()) {
        Ok(program) => program,
        Err(error) => return Verdict::Fail(format!("program does not load: {error}")),
    };
    legacy_schema_definitions(&mut schema);
    let issues = snapback4_core::schema::validate(&schema);
    if !issues.is_empty() {
        if let Some(actual) = schema_admission(&schema, &issues[0]) {
            return compare(&case.expected, case.expected.local_state, actual);
        }
        return Verdict::Fail(format!("schema validation failed: {}: {}", issues[0].path, issues[0].message));
    }
    let expected = match card_expected(case, &schema, &program) {
        Ok(expected) => expected,
        Err(error) => return Verdict::Fail(format!("oracle translation failed: {error}")),
    };
    let mut preludes = Vec::new();
    for prelude in &case.prelude {
        match serde_json::from_value::<Program>(prelude.program.clone()) {
            Ok(program) => preludes.push((program, &prelude.context)),
            Err(error) => return Verdict::Fail(format!("prelude program does not load: {error}")),
        }
    }
    let mut programs = vec![program.clone()];
    programs.extend(preludes.iter().map(|(p, _)| p.clone()));
    let rows: Vec<_> = case.receipt.rows.iter().map(|row| {
        let mut value = row.row.clone();
        if let Some(table) = schema.table(&row.table)
            && let Value::Row(fields) | Value::Map(fields) = &mut value
        {
            for (name, kind) in &table.columns {
                if let Some(value) = fields.get_mut(name) {
                    legacy_asset_ids(kind, value);
                }
            }
        }
        (row.table.clone(), value)
    }).collect();
    let mut context_args = case.context.args.clone();
    legacy_argument_ids(&program, &mut context_args);
    let mut engine = match Engine::memory(schema, programs) {
        Ok(engine) => engine,
        Err(error) => return Verdict::Fail(format!("engine: {error}")),
    };
    if let Err(error) = engine.load(rows) {
        return Verdict::Fail(format!("load: {error}"));
    }
    for (prelude, prelude_context) in &preludes {
        let mut args = prelude_context.args.clone();
        legacy_argument_ids(prelude, &mut args);
        let mut context = Context::new(prelude_context.viewer.clone(), args).with_ids(prelude_context.new_ids.clone());
        context.now = Some(prelude_context.now.unwrap_or(0));
        match engine.mutate(&prelude.name, None, context) {
            Ok(outcome) => {
                if let WriteState::Failed { why, .. } = outcome.state {
                    return Verdict::Fail(format!("prelude {} refused: {}", prelude.name, why.code));
                }
            }
            Err(error) => return Verdict::Fail(format!("prelude {} failed: {error}", prelude.name)),
        }
    }
    let mut context = Context::new(case.context.viewer.clone(), context_args).with_ids(case.context.new_ids.clone());
    context.now = case.context.now;
    context.read_time = case.context.read_time;
    if context.now.is_none() {
        context.now = Some(0);
    }
    let actual = match program.kind {
        snapback4_core::ProgramKind::Query => match engine.query(&program.name, context) {
            Ok(outcome) => Actual { result: Some(outcome.data), error: None, state: if outcome.complete { LocalState::Fresh } else { LocalState::Partial }, next: outcome.next },
            Err(refusal) => refused(refusal, false),
        },
        _ => match engine.mutate(&program.name, None, context) {
            Ok(outcome) => match outcome.state {
                WriteState::Sent { result, .. } => Actual { result: Some(result), error: None, state: LocalState::Predicted, next: None },
                WriteState::Failed { why, .. } => refused(why, true),
            },
            Err(error) => refused(error.refusal(), true),
        },
    };
    compare(&expected, expected_card_state(&expected, &program), actual)
}

#[derive(Clone, PartialEq, Eq, serde::Deserialize)]
struct LegacyResultPage {
    site: String,
    table: String,
    index: String,
    order: snapback4_core::ir::Order,
    suffix: Vec<snapback4_core::cursor::CursorColumn>,
    #[serde(default)]
    merge: bool,
}

/// Translate receipt-era cursor policy using only the frozen oracle. Values,
/// cursor descriptors, order, and the last visible row remain exact checks.
fn card_expected(case: &Case, schema: &Schema, program: &Program) -> Result<Expected, String> {
    use snapback4_core::cursor::{CursorPosition, decode_cursor, encode_cursor};
    let mut expected = case.expected.clone();
    let Some(pages) = case.certificate["result_pages"].as_object() else { return Ok(expected) };
    let mut descriptors = Vec::new();
    for descriptor in pages.values() {
        let page: LegacyResultPage = serde_json::from_value(descriptor.clone()).map_err(|error| error.to_string())?;
        if !descriptors.contains(&page) { descriptors.push(page); }
    }
    let Some(canonical) = &expected.canonical_result else { return Ok(expected) };
    if expected.error_code.is_some() { return Ok(expected); }
    let result: Value = serde_json::from_str(canonical).map_err(|error| error.to_string())?;
    if expected.local_state == LocalState::Fresh && case.certificate["completeness"] == "Page"
        && let Some(token) = &expected.next
    {
        let position = decode_cursor(schema, token).map_err(|error| error.to_string())?;
        for page in &descriptors {
            if page.table != position.table || page.index != position.index || page.order != position.order || page.suffix != position.suffix { continue; }
            let scans: Vec<_> = snapback4_core::ir::scans(program).into_iter().filter(|scan| if page.merge { scan.merge_site.as_deref() == Some(page.site.as_str()) } else { scan.site == page.site }).collect();
            let observed: Vec<_> = scans.iter().filter_map(|scan| expected.range_stops.get(&scan.site)).flatten().collect();
            let take = scans.first().and_then(|scan| if let snapback4_core::ir::Bound::Literal(n) = scan.take { Some(n as usize) } else { None });
            if !observed.is_empty() && observed.iter().all(|stop| stop.as_str() == "exhausted")
                && take.is_some_and(|take| largest_array(&result) < take)
            {
                // SB2's global Capped execution state could continue an
                // exhausted result because an unrelated preview hit its
                // bound. SB4's uniform page lookahead ends that result.
                expected.next = None;
                break;
            }
        }
    }
    // @ref LLP 3000#7-decisions-during-execution — a nonuniform capped page continues from its last visible row and ends only on an empty page.
    // SB2 ClientStore::reexecute clears `next` on every receipt Partial.
    // A server has no receipt custody: recover the page's visible position
    // from the golden result and held row, never from the actual execution.
    if expected.local_state == LocalState::Partial && case.certificate["completeness"] == "Capped"
        && expected.next.is_none() && descriptors.len() == 1 && case.prelude.is_empty()
    {
        let page = &descriptors[0];
        let mut ids = Vec::new();
        result_ids(&result, &mut ids);
        let row = ids.into_iter().rev().find_map(|id| case.receipt.rows.iter().find(|row| row.table == page.table && row.row.field("id").ok() == Some(&Value::Id(id.to_owned()))));
        if let Some(row) = row {
            let values = page.suffix.iter().map(|column| row.row.field(&column.name).cloned().map_err(|error| error.to_string())).collect::<Result<_, _>>()?;
            expected.next = Some(encode_cursor(schema, &CursorPosition { table: page.table.clone(), index: page.index.clone(), order: page.order, suffix: page.suffix.clone(), values }).map_err(|error| error.to_string())?);
        }
    }
    Ok(expected)
}

fn largest_array(value: &Value) -> usize {
    match value {
        Value::Array(values) => values.iter().map(largest_array).fold(values.len(), usize::max),
        Value::Row(fields) | Value::Map(fields) => fields.values().map(largest_array).max().unwrap_or(0),
        _ => 0,
    }
}

fn result_ids<'a>(value: &'a Value, ids: &mut Vec<&'a str>) {
    match value {
        Value::Row(fields) | Value::Map(fields) => {
            if let Some(Value::Id(id)) = fields.get("id") { ids.push(id); }
            else { fields.values().for_each(|value| result_ids(value, ids)); }
        }
        Value::Array(values) => values.iter().for_each(|value| result_ids(value, ids)),
        _ => {}
    }
}

/// The old store's `(table, id)` primary key needs no declared `byId`, and
/// its aggregate updater addresses groups by a deterministic id. SB4's
/// materialized secondary indexes must spell those same identities out.
/// Existing declarations are never rewritten, including invalid ones.
fn legacy_schema_definitions(schema: &mut Schema) {
    use snapback4_core::schema::{ColumnType, Index, IndexComponent};
    for table in schema.tables.values_mut() {
        if table.columns.get("id") == Some(&ColumnType::Id) {
            table.indexes.entry("byId".into()).or_insert_with(|| Index { components: vec![IndexComponent::Column("id".into())], unique: true });
        }
    }
    for maintain in &schema.maintains {
        let Some(table) = schema.tables.get_mut(&maintain.target) else { continue };
        if !table.indexes.values().any(|index| index.unique && index.columns() == maintain.by)
            && !maintain.by.is_empty() && maintain.by.iter().all(|column| table.columns.contains_key(column))
        {
            let mut name = "$corpusGroup".to_owned();
            while table.indexes.contains_key(&name) {
                name.push('_');
            }
            table.indexes.insert(name, Index { components: maintain.by.iter().cloned().map(IndexComponent::Column).collect(), unique: true });
        }
    }
}

/// The schema validator exposes a path/message instead of SB2's code.
/// Translate only this observed, typed admission category. A schema that
/// unexpectedly starts validating still runs and fails its refusal oracle.
fn schema_admission(schema: &Schema, issue: &snapback4_core::schema::SchemaIssue) -> Option<Actual> {
    let invalid_column = schema.tables.iter().any(|(table_name, table)| table.indexes.iter().any(|(index_name, index)| {
        issue.path == format!("tables.{table_name}.indexes.{index_name}")
            && index.columns().iter().any(|column| table.columns.get(column).is_some_and(|kind| !kind.is_indexable()))
    }));
    invalid_column.then(|| Actual { result: None, error: Some(format!("E_SCHEMA_INDEX_COLUMN ({})", issue.message)), state: LocalState::CertificationRefused, next: None })
}

fn legacy_argument_ids(program: &Program, args: &mut BTreeMap<String, Value>) {
    for (name, kind) in &program.args {
        if let (Some(kind), Some(value)) = (snapback4_core::schema::arg_as_column(kind), args.get_mut(name)) {
            legacy_asset_ids(&kind, value);
        }
    }
}

/// Asset ids were text inside SB2's tagged metadata maps. They are nominal
/// ids inside SB4's typed values; the public JSON spelling is unchanged.
fn legacy_asset_ids(kind: &snapback4_core::schema::ColumnType, value: &mut Value) {
    use snapback4_core::schema::ColumnType;
    match (kind, value) {
        (ColumnType::Optional(inner), value) => legacy_asset_ids(inner, value),
        (ColumnType::List { of, .. }, Value::Array(values)) => values.iter_mut().for_each(|value| legacy_asset_ids(of, value)),
        (ColumnType::Image { .. } | ColumnType::Video { .. }, Value::Map(fields)) => {
            if let Some(id @ Value::String(_)) = fields.get_mut("id")
                && let Value::String(text) = id
            {
                *id = Value::Id(text.clone());
            }
        }
        _ => {}
    }
}

/// Snapback 2's `fresh` means the receipt authorizes local execution, not
/// that a bounded page contains every remaining row. The card's `complete`
/// is false when an outer non-cursor page hit its limit. A nested preview
/// and a merge's lane-discovery bound do not truncate the outer page. The
/// recorded trace is the oracle; no actual result changes the expectation.
fn expected_card_state(expected: &Expected, program: &Program) -> LocalState {
    if expected.local_state == LocalState::Fresh && outer_page_limit(&program.body, expected) {
        LocalState::Partial
    } else {
        expected.local_state
    }
}

fn outer_page_limit(body: &[snapback4_core::ir::Stmt], expected: &Expected) -> bool {
    use snapback4_core::ir::{LoopDomain, Stmt};
    body.iter().any(|stmt| match stmt {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) | Stmt::Emit { payload: value, .. } => expression_page_limit(value, expected),
        Stmt::If { condition, then_body, else_body } => expression_page_limit(condition, expected) || outer_page_limit(then_body, expected) || outer_page_limit(else_body, expected),
        Stmt::For { domain, body, .. } => match domain {
            LoopDomain::Page(scan) => scan_limit(scan, expected),
            LoopDomain::Recurse(recurse) => expression_page_limit(&recurse.seed, expected),
            LoopDomain::DerivedArray { value, .. } => expression_page_limit(value, expected) || outer_page_limit(body, expected),
            LoopDomain::ExpressionRange { start, end_exclusive } => expression_page_limit(start, expected) || expression_page_limit(end_exclusive, expected) || outer_page_limit(body, expected),
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => outer_page_limit(body, expected),
        },
        Stmt::Require { condition, .. } | Stmt::Check { condition, .. } => expression_page_limit(condition, expected),
        Stmt::InsertIfAbsent { row, .. } | Stmt::Insert { row, .. } => expression_page_limit(row, expected),
        Stmt::Update { key, patch, .. } => expression_page_limit(key, expected) || expression_page_limit(patch, expected),
        Stmt::Upsert { key, row, .. } => expression_page_limit(key, expected) || expression_page_limit(row, expected),
        Stmt::WriteTarget { target, patch, condition, .. } => target.key.iter().any(|key| expression_page_limit(key, expected)) || expression_page_limit(patch, expected)
            || condition.as_ref().is_some_and(|c| outer_page_limit(&c.setup, expected) || expression_page_limit(&c.value, expected)),
        Stmt::Delete { key, .. } => expression_page_limit(key, expected),
        Stmt::Break | Stmt::Continue => false,
    })
}

fn scan_limit(scan: &snapback4_core::ir::Scan, expected: &Expected) -> bool {
    (!scan.opaque_cursor && expected.range_stops.get(&scan.site).is_some_and(|stops| stops.iter().any(|stop| stop == "limit")))
        || scan.prefix.iter().filter_map(|key| key.scalar()).any(|value| expression_page_limit(value, expected))
        || [scan.after.as_deref(), scan.before.as_deref()].into_iter().flatten().any(|value| expression_page_limit(value, expected))
        || scan.range.as_ref().is_some_and(|range| [range.gt.as_deref(), range.gte.as_deref(), range.lt.as_deref(), range.lte.as_deref()].into_iter().flatten().any(|value| expression_page_limit(value, expected)))
        || scan.filter.as_ref().is_some_and(|value| expression_page_limit(value, expected))
}

fn expression_page_limit(expr: &snapback4_core::ir::Expr, expected: &Expected) -> bool {
    use snapback4_core::ir::Expr;
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => false,
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => expression_page_limit(base, expected),
        Expr::Array(values) | Expr::Builtin { args: values, .. } => values.iter().any(|value| expression_page_limit(value, expected)),
        Expr::Object(fields) => fields.values().any(|value| expression_page_limit(value, expected)),
        Expr::Shape { base, fields } => expression_page_limit(base, expected) || fields.values().any(|value| expression_page_limit(value, expected)),
        Expr::Block { body, value } => outer_page_limit(body, expected) || expression_page_limit(value, expected),
        Expr::Binary { left, right, .. } => expression_page_limit(left, expected) || expression_page_limit(right, expected),
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().any(|value| expression_page_limit(value, expected)),
        Expr::Scan(scan) => scan_limit(scan, expected),
        // Lane stops describe the emitted union's cut; source stops describe
        // the bounded set of lanes the author explicitly selected.
        Expr::Merge(merge) => merge.lanes.iter().any(|lane| outer_page_limit(&lane.setup, expected) || scan_limit(&lane.scan, expected)),
    }
}

fn compare(expected: &Expected, expected_state: LocalState, actual: Actual) -> Verdict {
    let mut failures = Vec::new();
    if actual.state != expected_state {
        failures.push(format!("expected card state {expected_state:?} (corpus {:?}), got {:?}", expected.local_state, actual.state));
    }
    if actual.next != expected.next {
        failures.push(format!("expected next {:?}, got {:?}", expected.next, actual.next));
    }
    match (&expected.error_code, actual.error) {
        (Some(expected), Some(actual)) => {
            let code = actual.split(' ').next().unwrap_or(&actual);
            if expected != code {
                failures.push(format!("expected refusal {expected}, got {actual}"));
            }
        }
        (Some(expected), None) => failures.push(format!("expected refusal {expected}, got a result {}", actual.result.map(|v| snapback4_core::value::canonical_json(&v)).unwrap_or_default())),
        (None, Some(actual)) => failures.push(format!("expected a result, got refusal {actual}")),
        (None, None) => {
            let actual = snapback4_core::value::canonical_json(&actual.result.unwrap_or(Value::Null));
            let expected = expected.canonical_result.clone().unwrap_or_default();
            if actual != expected {
                failures.push(format!("result differs\n    expected {expected}\n    actual   {actual}"));
            }
        }
    }
    if failures.is_empty() { Verdict::Pass } else { Verdict::Fail(failures.join("; ")) }
}

#[test]
fn corpus() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../corpus");
    let mut passed = 0;
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(&dir).expect("corpus dir").flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.ends_with(".json") || name == "manifest.json" || name == "ir-contract.json" {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let case: Case = match serde_json::from_str(&text) {
            Ok(case) => case,
            Err(error) => {
                failed.push((name, format!("case does not parse: {error}")));
                continue;
            }
        };
        match run(&case) {
            Verdict::Pass => passed += 1,
            Verdict::Skip(why) => skipped.push((case.name.clone(), why)),
            Verdict::Fail(why) => failed.push((case.name.clone(), why)),
        }
    }
    println!("corpus (Rust server only; no TypeScript/replica conformance claim): {passed} passed, {} skipped, {} failed", skipped.len(), failed.len());
    let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
    for (_, why) in &skipped {
        *reasons.entry(why.split(':').next().unwrap_or(why).to_owned()).or_default() += 1;
    }
    for (why, count) in &reasons {
        println!("  skipped {count}: {why}");
    }
    for (name, why) in &failed {
        println!("  FAIL {name}: {why}");
    }
    assert!(failed.is_empty(), "{} corpus cases failed", failed.len());
}

#[cfg(test)]
mod adapter {
    use super::*;
    use serde_json::json;

    fn fixture() -> serde_json::Value {
        json!({
            "name": "adapter", "schema": { "tables": {} },
            "program": { "name": "adapter", "kind": "Query", "args": {}, "body": [{ "Return": { "Literal": { "Int": 42 } } }] },
            "certificate": { "completeness": "Page", "read_sites": [] },
            "context": { "viewer": "alice", "args": {} }, "receipt": { "rows": [] },
            "expected": { "errorCode": null, "localState": "fresh", "canonicalResult": "{\"Int\":42}", "next": null, "partialSites": [], "rangeStops": {} }
        })
    }
    fn case() -> Case {
        serde_json::from_value(fixture()).unwrap()
    }

    #[test]
    fn independent_effect_ids_replace_only_the_frozen_shared_supply_oracle() {
        let legacy: Case = serde_json::from_str(include_str!("../../../corpus/named-emit.json")).unwrap();
        assert!(matches!(exclusion(&legacy), Some(reason) if reason.starts_with("shared-effect-id-supply:")));
        let independent: Case = serde_json::from_str(include_str!("../../../corpus/named-emit-independent-ids.json")).unwrap();
        assert_eq!(exclusion(&independent), None);
        assert!(matches!(run(&independent), Verdict::Pass));
    }

    #[test]
    fn state_and_next_are_checked_even_when_the_result_matches() {
        let mut c = case();
        assert!(matches!(run(&c), Verdict::Pass));
        c.expected.local_state = LocalState::Partial;
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.contains("expected card state Partial (corpus Partial), got Fresh")));
        c.expected.local_state = LocalState::Predicted;
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.contains("expected card state Predicted (corpus Predicted), got Fresh")));
        c.expected.local_state = LocalState::Fresh;
        c.expected.next = Some("expected-cursor".into());
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.contains("expected next")));
        c.expected.next = None;
        let actual = Actual { result: Some(Value::Int(42)), error: None, state: LocalState::Fresh, next: Some("unexpected-cursor".into()) };
        assert!(matches!(compare(&c.expected, c.expected.local_state, actual), Verdict::Fail(reason) if reason.contains("expected next")));
    }

    #[test]
    fn a_capped_partial_query_is_executed_and_static_prices_are_distinct_from_structure() {
        let mut c = case();
        c.expected.local_state = LocalState::Partial;
        c.expected.partial_sites = vec!["page".into()];
        c.certificate = json!({ "completeness": "Capped", "read_sites": [{ "site": "page" }] });
        assert_eq!(exclusion(&c), None);
        assert!(matches!(run(&c), Verdict::Fail(_)), "an unconditionally complete program cannot satisfy a capped oracle");
        c.expected.local_state = LocalState::CertificationRefused;
        c.expected.error_code = Some("E_BOUND".into());
        assert!(matches!(exclusion(&c), Some(reason) if reason.starts_with("static-resource-price:")));
        c.expected.error_code = Some("E_STRUCTURAL_FANOUT".into());
        assert_eq!(exclusion(&c), None);
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.contains("expected refusal E_STRUCTURAL_FANOUT")));
    }

    #[test]
    fn receipt_freshness_does_not_claim_an_unpaginated_limit_is_complete() {
        let mut c = case();
        c.expected.range_stops.insert("page".into(), vec!["limit".into()]);
        c.program["body"] = json!([{ "Return": { "Scan": {
            "site": "page", "table": "items", "index": "byId", "prefix": [],
            "order": "Asc", "take": { "Literal": 2 }, "provenance": "Const"
        } } }]);
        let program: Program = serde_json::from_value(c.program.clone()).unwrap();
        assert_eq!(expected_card_state(&c.expected, &program), LocalState::Partial);
        c.program["body"][0]["Return"]["Scan"]["opaque_cursor"] = json!(true);
        let program: Program = serde_json::from_value(c.program).unwrap();
        assert_eq!(expected_card_state(&c.expected, &program), LocalState::Fresh);
    }

    #[test]
    fn auxiliary_preview_and_lane_discovery_limits_do_not_truncate_the_outer_page() {
        let mut c = case();
        c.expected.range_stops.insert("preview".into(), vec!["limit".into()]);
        let scan = json!({
            "site": "preview", "table": "items", "index": "byId", "prefix": [],
            "order": "Asc", "take": { "Literal": 1 }, "provenance": "Const"
        });
        let mut outer = scan.clone();
        outer["site"] = json!("outer");
        c.expected.range_stops.insert("outer".into(), vec!["exhausted".into()]);
        c.program["body"] = json!([{ "For": {
            "binding": "row", "domain": { "Page": outer },
            "body": [{ "Return": { "Scan": scan } }]
        } }]);
        let program: Program = serde_json::from_value(c.program.clone()).unwrap();
        assert_eq!(expected_card_state(&c.expected, &program), LocalState::Fresh);
        c.expected.range_stops.insert("outer".into(), vec!["limit".into()]);
        assert_eq!(expected_card_state(&c.expected, &program), LocalState::Partial);
        c.expected.range_stops.insert("outer".into(), vec!["exhausted".into()]);
        c.program["body"] = json!([{ "Return": { "Merge": {
            "site": "merged", "lanes": [{ "scan": outer, "source": scan, "binding": "row" }]
        } } }]);
        let program: Program = serde_json::from_value(c.program).unwrap();
        assert_eq!(expected_card_state(&c.expected, &program), LocalState::Fresh);
        c.expected.range_stops.insert("outer".into(), vec!["limit".into()]);
        assert_eq!(expected_card_state(&c.expected, &program), LocalState::Partial);
    }

    #[test]
    fn schema_and_program_regressions_cannot_turn_into_skips() {
        let mut c = case();
        c.schema = json!({ "tables": { "bad": {
            "columns": { "id": "Int" },
            "indexes": { "byId": { "components": [{ "Column": "id" }], "unique": true } },
            "rules": { "read": "Allow", "insert": "Allow", "update": "Allow", "delete": "Allow" }
        } } });
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.starts_with("schema validation failed:")));
        c = case();
        c.program["body"] = json!([{ "UnsupportedFutureInstruction": {} }]);
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.starts_with("program does not load:")));
    }

    #[test]
    fn receipt_specific_oracles_have_named_exclusions() {
        let mut c = case();
        c.expected.local_state = LocalState::Partial;
        c.expected.partial_sites = vec!["point".into()];
        c.certificate = json!({ "completeness": "Page", "read_sites": [{ "site": "point" }] });
        assert!(matches!(exclusion(&c), Some(reason) if reason.starts_with("receipt-coverage:")));
        c.expected.partial_sites = vec!["missing-authority".into()];
        assert!(matches!(exclusion(&c), Some(reason) if reason.starts_with("receipt-authority:")));
        c = case();
        c.replacement_receipt = Some(json!({ "rows": [] }));
        assert!(matches!(exclusion(&c), Some(reason) if reason.starts_with("receipt-replacement:")));
    }

    #[test]
    fn asset_exclusion_requires_an_argument_that_needs_uploaded_facts() {
        let mut c = case();
        c.expected.local_state = LocalState::Predicted;
        c.program["args"]["photo"] = json!({ "Optional": { "Image": { "max": 1000 } } });
        c.context.args.insert("photo".into(), Value::Null);
        assert_eq!(exclusion(&c), None, "clearing an asset does not require uploaded bytes");
        c.context.args.insert("photo".into(), Value::String("legacy-id".into()));
        assert!(matches!(exclusion(&c), Some(reason) if reason.starts_with("legacy-asset-upload:")));
        c.context.args.clear();
        assert_eq!(exclusion(&c), None, "a missing argument must fail instead of becoming a skip");
        c.program["args"] = json!({});
        c.schema = json!({ "tables": { "media": { "columns": { "photo": { "Image": { "max": 1000 } } } } } });
        assert_eq!(exclusion(&c), None, "an unrelated asset column must not disable coverage");
    }

    fn corpus_case(name: &str) -> Case {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../corpus").join(format!("{name}.json"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn implicit_old_store_keys_are_executed_through_explicit_sb4_indexes() {
        for name in ["named-text-control-refusal", "named-maintained-deny-target"] {
            let c = corpus_case(name);
            assert_eq!(exclusion(&c), None);
            assert!(matches!(run(&c), Verdict::Pass), "{name}: {:?}", run(&c));
        }
        let mut schema: Schema = serde_json::from_value(corpus_case("named-text-control-refusal").schema).unwrap();
        schema.tables.get_mut("notes").unwrap().indexes.insert("byId".into(), snapback4_core::schema::Index::of(&["body"], false));
        legacy_schema_definitions(&mut schema);
        assert!(!schema.tables["notes"].indexes["byId"].unique, "an invalid existing index must never be silently repaired");
        assert!(!snapback4_core::schema::validate(&schema).is_empty());
    }

    #[test]
    fn typed_schema_admission_is_compared_with_the_refusal_oracle() {
        for name in ["asset-index-list-refused", "asset-index-optional-refused"] {
            let c = corpus_case(name);
            assert_eq!(exclusion(&c), None);
            assert!(matches!(run(&c), Verdict::Pass));
        }
        let mut c = corpus_case("asset-index-optional-refused");
        c.schema["tables"]["media"]["indexes"].as_object_mut().unwrap().remove("byPhoto");
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.contains("expected refusal E_SCHEMA_INDEX_COLUMN")), "an unexpected admission cannot pass");
        let mut c = corpus_case("asset-index-optional-refused");
        c.expected.local_state = LocalState::Fresh;
        c.expected.error_code = None;
        assert!(matches!(run(&c), Verdict::Fail(reason) if reason.contains("got CertificationRefused")), "an unexpected refusal cannot pass");
    }

    #[test]
    fn translated_asset_clearing_deletion_and_metadata_reads_still_execute() {
        for name in ["asset-optional-clear", "asset-row-delete-mutation", "asset-video-duration-member"] {
            let c = corpus_case(name);
            assert_eq!(exclusion(&c), None);
            let result = run(&c);
            assert!(matches!(result, Verdict::Pass), "{name}: {result:?}");
        }
        let mut c = corpus_case("asset-video-duration-member");
        let program: Program = serde_json::from_value(c.program).unwrap();
        let wire_before = snapback4_core::wire::map_to_json(&c.context.args);
        legacy_argument_ids(&program, &mut c.context.args);
        assert_eq!(snapback4_core::wire::map_to_json(&c.context.args), wire_before);
        assert!(matches!(c.context.args["clip"].field("id"), Ok(Value::Id(_))));
        let mut untyped: Value = serde_json::from_value(json!({ "Map": { "id": { "String": "text-id" } } })).unwrap();
        legacy_asset_ids(&snapback4_core::schema::ColumnType::Json { max_bytes: 1000 }, &mut untyped);
        assert_eq!(untyped.field("id").unwrap(), &Value::String("text-id".into()));
    }

    #[test]
    fn current_sb4_asset_references_use_server_metadata_before_mutation_evaluation() {
        use snapback4_core::ir::{ArgType, Expr, ProgramKind};
        let schema: Schema = serde_json::from_value(corpus_case("asset-optional-clear").schema).unwrap();
        let program = Program {
            name: "asset.metadata".into(), kind: ProgramKind::Mutation,
            args: BTreeMap::from([("photo".into(), ArgType::Image { max: 5_000_000 })]),
            read_time_granularity_ms: None, native: false,
            body: vec![snapback4_core::ir::Stmt::Return(Expr::Object(["width", "height", "duration", "bytes"].into_iter().map(|name| (name.to_owned(), snapback4_core::ir::field(snapback4_core::ir::var("photo"), name))).collect()))],
        };
        let mut engine = Engine::memory(schema, vec![program]).unwrap();
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&640u32.to_be_bytes());
        png.extend_from_slice(&480u32.to_be_bytes());
        let upload = engine.store_asset("alice", &png, 0).unwrap();
        let reference = snapback4_core::wire::from_json(&ArgType::Image { max: 5_000_000 }, &json!({ "id": upload.id })).unwrap();
        let outcome = engine.mutate("asset.metadata", None, Context::new("alice", BTreeMap::from([("photo".into(), reference)]))).unwrap();
        let WriteState::Sent { result, .. } = outcome.state else { panic!("metadata mutation refused") };
        assert_eq!(result.field("width").unwrap(), &Value::Int(640));
        assert_eq!(result.field("height").unwrap(), &Value::Int(480));
        assert_eq!(result.field("duration").unwrap(), &Value::Null);
        assert_eq!(result.field("bytes").unwrap(), &Value::Int(png.len() as i64));
    }

    #[test]
    fn capped_cursor_oracles_continue_from_the_golden_last_visible_row() {
        for (name, last) in [
            ("composite-hidden-page-1", "i1"), ("composite-hidden-page-2", "i2"),
            ("conditional-enriched-hidden-page-1", "i1"), ("conditional-enriched-hidden-page-2", "i2"),
            ("merge-hidden-candidates-capped", "b"),
        ] {
            let c = corpus_case(name);
            let schema: Schema = serde_json::from_value(c.schema.clone()).unwrap();
            let program: Program = serde_json::from_value(c.program.clone()).unwrap();
            assert_eq!(c.expected.next, None, "the old client cleared partial receipt continuations");
            let translated = card_expected(&c, &schema, &program).unwrap();
            let token = translated.next.unwrap();
            let position = snapback4_core::cursor::decode_cursor(&schema, &token).unwrap();
            assert_eq!(position.values.last(), Some(&Value::Id(last.into())), "{name}");
            assert_eq!(translated.local_state, LocalState::Partial);
            assert_eq!(translated.canonical_result, c.expected.canonical_result);
            let mut empty = c;
            empty.expected.canonical_result = Some("{\"Array\":[]}".into());
            assert_eq!(card_expected(&empty, &schema, &program).unwrap().next, None, "empty capped pages terminate");
        }
    }

    #[test]
    fn exhausted_underfilled_result_pages_end_despite_a_limited_preview() {
        for (name, site) in [("composite-range-page-3", "feed.global"), ("composite-merge-page-3", "feed.following.lane")] {
            let mut c = corpus_case(name);
            let schema: Schema = serde_json::from_value(c.schema.clone()).unwrap();
            let program: Program = serde_json::from_value(c.program.clone()).unwrap();
            assert!(c.expected.next.is_some());
            let translated = card_expected(&c, &schema, &program).unwrap();
            assert_eq!(translated.next, None, "{name}");
            assert_eq!(translated.canonical_result, c.expected.canonical_result);
            c.expected.range_stops.insert(site.into(), vec!["limit".into()]);
            assert_eq!(card_expected(&c, &schema, &program).unwrap().next, c.expected.next, "a page that has not exhausted still continues");
        }
    }

    #[test]
    fn refusal_state_mapping_preserves_application_rejection_and_engine_refusal() {
        let application = snapback4_core::RuntimeError::Require { code: "MISSING".into(), site: None }.refusal();
        assert_eq!(refused(application.clone(), false).state, LocalState::Denied);
        assert_eq!(refused(application, true).state, LocalState::Rejected);
        let engine = snapback4_core::RuntimeError::Constraint("full".into()).refusal();
        assert_eq!(refused(engine, true).state, LocalState::Refused);
        let structural = snapback4_core::RuntimeError::Structural { code: "E_STRUCTURAL_FANOUT", message: "incomplete group".into() }.refusal();
        assert_eq!(refused(structural, true).state, LocalState::CertificationRefused);
    }

    #[test]
    fn expected_cursor_and_state_are_required_contract_fields() {
        let mut input = fixture();
        input["expected"].as_object_mut().unwrap().remove("next");
        assert!(serde_json::from_value::<Case>(input).is_err());
        let mut input = fixture();
        input["expected"]["localState"] = json!("unknown-success-word");
        assert!(serde_json::from_value::<Case>(input).is_err());
    }
}
