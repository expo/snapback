//! Independent heap accounting for Shape's inherited, output-only metadata.
use snapback4_core::{Context, Engine, Value};
use snapback4_core::engine::{QueryOutcome, ReadCut, local};
use snapback4_core::error::MeterKind;
use snapback4_core::ir::{Expr, Program, ProgramKind, Stmt};
use snapback4_core::meter::Ceilings;
use snapback4_core::rows::{MemoryRows, Rows};
use snapback4_core::schema::Schema;
use snapback4_core::value::object;
use std::collections::BTreeMap;

fn metadata(pending: bool) -> Expr {
    let base = if pending { object([("pending", Value::Bool(true))]) }
        else { Value::Row(BTreeMap::new().into()) };
    Expr::Shape { base: Box::new(Expr::Literal(base)), fields: BTreeMap::new() }
}

fn query(rows: &dyn Rows, value: Expr, heap_bytes: u64) -> QueryOutcome {
    query_result(rows, value, heap_bytes).unwrap()
}
fn query_result(rows: &dyn Rows, value: Expr, heap_bytes: u64) -> Result<QueryOutcome, snapback4_core::error::Refusal> {
    let program = Program {
        name: "metadata".into(), kind: ProgramKind::Query, args: BTreeMap::new(),
        body: vec![Stmt::Return(value)], read_time_granularity_ms: None,
        returned_shapes: BTreeMap::new(), native: false,
    };
    local::query(rows, &Schema::default(), &program, Context::new("alice", BTreeMap::new()),
        Ceilings { heap_bytes, ..Ceilings::default() })
}

fn check(rows: &dyn Rows) {
    // The documented value layout charges 40 for the object, 80 for an
    // entry, seven bytes for "pending", and zero for its bool. Literal row
    // clones share their allocation. Do not ask heap_bytes() for this oracle.
    const EMPTY: u64 = 40;
    const PENDING: u64 = 40 + 80 + 7;
    let confirmed = query(rows, metadata(false), EMPTY);
    assert!(confirmed.complete);
    assert!(confirmed.data.as_object().unwrap().is_empty());
    assert_eq!(confirmed.metered.heap_bytes, EMPTY);
    let pending = query(rows, metadata(true), PENDING);
    assert!(pending.complete);
    assert_eq!(pending.data, object([("pending", Value::Bool(true))]));
    assert_eq!(pending.metered.heap_bytes, PENDING);
    assert_eq!(pending.metered.heap_bytes - confirmed.metered.heap_bytes, 87);

    let nested = || Expr::Shape {
        base: Box::new(metadata(true)),
        fields: BTreeMap::from([("title".into(), Expr::Literal(Value::String("later".into())))]),
    };
    // Cut inside the metadata-only base, before even evaluating "later".
    // Return + outer Shape + metadata Shape + literal row = four steps.
    let cut = query(rows, nested(), PENDING - 1);
    assert!(!cut.complete);
    assert_eq!(cut.data, Value::Null);
    assert_eq!(cut.cut, Some(ReadCut::Meter));
    assert_eq!(cut.capped_at, Some((MeterKind::HeapBytes, "metadata:1".into())));
    assert_eq!(cut.metered.heap_bytes, PENDING);
    assert_eq!(cut.metered.steps, 4);
    assert_eq!(cut.metered.examined, 0);
    assert!(cut.next.is_none());

    // At the exact metadata allowance evaluation advances to the text clone.
    let after_metadata = query(rows, nested(), PENDING);
    assert!(!after_metadata.complete);
    assert_eq!(after_metadata.data, Value::Null);
    assert_eq!(after_metadata.metered.heap_bytes, PENDING + 5);
    assert_eq!(after_metadata.metered.steps, 5);

    // Inner metadata + cloned text + final object (title and pending).
    const TOTAL: u64 = PENDING + 5 + (40 + 80 + 5 + 5 + 80 + 7);
    let complete = query(rows, nested(), TOTAL);
    assert!(complete.complete);
    assert_eq!(complete.metered.heap_bytes, TOTAL);
    assert_eq!(complete.data, object([("title", Value::String("later".into())), ("pending", Value::Bool(true))]));
}

#[test]
fn pending_only_metadata_pays_heap_and_cuts_during_evaluation_on_memory() {
    check(&MemoryRows::new());
}

#[test]
fn pending_only_metadata_pays_heap_and_cuts_during_evaluation_on_sqlite() {
    let mut engine = Engine::memory(Schema::default(), []).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    check(&tx);
}

#[test]
fn a_pending_row_with_ordinary_columns_pays_for_metadata_before_outer_fields() {
    fn check_row(rows: &dyn Rows) {
        // An ordinary pending row, not a metadata-only synthetic base. Its
        // shared literal allocation is free to clone; the projection still
        // allocates 40 + 80 + 7 bytes for its sole pending entry.
        const PENDING: u64 = 127;
        let metadata = || Expr::Shape {
            base: Box::new(Expr::Literal(object([
                ("id", Value::Id("note".into())),
                ("title", Value::String("original".into())),
                ("pending", Value::Bool(true)),
            ]))),
            fields: BTreeMap::new(),
        };
        let complete = query(rows, metadata(), PENDING);
        assert!(complete.complete);
        assert_eq!(complete.data, object([("pending", Value::Bool(true))]));
        assert_eq!(complete.metered.heap_bytes, PENDING);
        let cut = query(rows, Expr::Shape {
            base: Box::new(metadata()),
            fields: [("title".into(), Expr::Literal(Value::String("later".into())))].into(),
        }, PENDING - 1);
        assert!(!cut.complete);
        assert_eq!(cut.data, Value::Null);
        assert_eq!(cut.metered.heap_bytes, PENDING);
        assert_eq!(cut.metered.steps, 4, "outer field must not run");
        assert_eq!(cut.capped_at, Some((MeterKind::HeapBytes, "metadata:1".into())));
    }
    check_row(&MemoryRows::new());
    let mut engine = Engine::memory(Schema::default(), []).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    check_row(&tx);
}

#[test]
fn retained_provenance_is_distinct_from_application_fields_and_survives_shapes() {
    let rows = MemoryRows::new();
    let app = object([("retained", Value::Bool(true))]);
    let shape = |base, fields| Expr::Shape { base: Box::new(Expr::Literal(base)), fields };
    let plain = query(&rows, shape(app.clone(), BTreeMap::new()), 40);
    assert!(plain.complete);
    assert!(plain.data.as_object().unwrap().is_empty(), "ordinary retained is not output metadata");
    let explicit = query(&rows, shape(app, [("retained".into(), Expr::Literal(Value::Bool(false)))].into()), 128);
    assert!(explicit.complete);
    assert_eq!(explicit.data.field("retained").unwrap(), &Value::Bool(false));

    let mut fields = snapback4_core::value::ObjectFields::default();
    fields.mark_retained();
    let retained = Value::Row(fields);
    let inner = shape(retained.clone(), BTreeMap::new());
    let nested = Expr::Shape { base: Box::new(inner), fields: BTreeMap::new() };
    let kept = query(&rows, nested.clone(), 1456);
    assert!(kept.complete);
    assert_eq!(kept.data.field("retained").unwrap(), &Value::Bool(true));
    assert_eq!(kept.metered.heap_bytes, 1456, "two marker projections plus the reserved transport mask");
    assert_eq!(query_result(&rows, nested, 1455).unwrap_err().code, "E_BOUND");

    // Durable/application decoding cannot manufacture the reader's provenance.
    let decoded: Value = serde_json::from_str(&serde_json::to_string(&retained).unwrap()).unwrap();
    let decoded = query(&rows, shape(decoded, BTreeMap::new()), 40);
    assert!(decoded.complete && decoded.data.as_object().unwrap().is_empty());
    let bases = Expr::Array(vec![Expr::Literal(retained), Expr::Literal(object([("pending", Value::Bool(true))]))]);
    let merged = query(&rows, Expr::Shape { base: Box::new(bases), fields: BTreeMap::new() }, 4096);
    assert!(merged.complete);
    assert_eq!(merged.data.field("retained").unwrap(), &Value::Bool(true));
    assert_eq!(merged.data.field("pending").unwrap(), &Value::Bool(true));
}
