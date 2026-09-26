use super::*;
use crate::{Context, meter::{Ceilings, Cut, Meter}, rows::{MemoryRows, Rows}};

fn fixture() -> (crate::Schema, MemoryRows, Value) {
    fixture_source(include_str!("../../../../snapback4-device/tests/unread_range/schema.q"))
}
fn fixture_source(source: &str) -> (crate::Schema, MemoryRows, Value) {
    let b = snapback4_lang::compile(&[("range.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: crate::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let rows = MemoryRows::new();
    let member = object([("id",Value::Id("b".into())),("principal",Value::Id("bob".into())),("conversationId",Value::Id("c".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]);
    rows.put("members",&schema.tables["members"],&member,None).unwrap();
    let view = object([("id",Value::Id("b".into())),("member",Value::Id("b".into())),("principal",Value::Id("bob".into())),("value",Value::Int(0)),("recountPending",Value::Bool(false))]);
    rows.put("unread",&schema.tables["unread"],&view,None).unwrap();
    (schema,rows,member)
}
#[test]
fn pending_value_never_decides_a_probe_and_abort_keeps_its_host_policy() {
    let (schema, rows, _) = fixture();
    for device in [false,true] {
        let mut r = Runner::new(&rows,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings::default(),Cut::Abort),0);
        r.device=device;
        let error=r.pending_view_read().unwrap_err();
        assert!(if device {matches!(error,RuntimeError::Prediction(_))}else{matches!(error,RuntimeError::Structural{code:"E_VIEW_KEY",..})});
    }
    let mut r=Runner::new(&rows,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings::default(),Cut::Cap),0);
    r.device=true;
    r.provisional_rows.insert(("members".into(),"b".into()));
    let result=r.authorized_scratch(1<<20,&[],|r,scope| r.probe_witness(scope,"unread","byId",&[Value::Id("b".into())],&[("value".into(),Value::Int(0))],false));
    // Witness evaluation uses an aborting authorization scope on a device.
    assert!(matches!(result,Err(RuntimeError::Prediction(_))),"{result:?}");
}
#[test]
fn a_nonuniform_source_stays_pending_even_if_a_synthetic_image_would_pass() {
    let (mut schema,rows,member)=fixture();
    // Admission rejects this rule; retain the runtime guard for raw IR callers.
    let b=snapback4_lang::compile(&[("rule.q".into(),"table t:\n  senderId: principal ?\n  read <- .senderId != viewer\n".into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    schema.tables.get_mut("messages").unwrap().rules.read=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema.tables["t"].rules.read).unwrap()).unwrap();
    let mut r=Runner::new(&rows,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings::default(),Cut::Cap),0);
    r.device=true;
    r.provisional_rows.insert(("members".into(),"b".into()));
    assert!(!r.row_view_source_readable(&schema.maintains[0],&member).unwrap());
}

struct CoveredRows(MemoryRows);
impl Rows for CoveredRows {
    fn current_row(&self, _: &str, _: &Value) -> Result<bool, RuntimeError> { Ok(true) }
    fn acquired_boundary(&self, _: &str, _: &str, prefix: &[Value]) -> Result<Option<crate::rows::AcquiredBoundary>, RuntimeError> {
        let mut floor = prefix.to_vec();
        floor.extend([Value::Int(0), Value::Id("floor".into())]);
        Ok(Some(crate::rows::AcquiredBoundary::Key(crate::key::encode(&floor))))
    }
    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.0.get(t, id) }
    fn lookup(&self, t: &str, n: &str, i: &crate::schema::Index, k: &[Value]) -> Result<Option<Value>, RuntimeError> { self.0.lookup(t, n, i, k) }
    fn scan(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, n: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.0.scan(t, i, p, b, d, n) }
    fn index_head(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir) -> Result<Option<Vec<Value>>, RuntimeError> { self.0.index_head(t, i, p, b, d) }
    fn scan_metered(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, n: usize, scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.0.scan_metered(t, i, p, b, d, n, scope, meter) }
    fn count_prefix(&self, t: &str, i: &str, p: &[Value], n: u64) -> Result<u64, RuntimeError> { self.0.count_prefix(t, i, p, n) }
    fn put(&self, t: &str, s: &crate::schema::Table, r: &Value, o: Option<&Value>) -> Result<u64, RuntimeError> { self.0.put(t, s, r, o) }
    fn delete(&self, t: &str, s: &crate::schema::Table, r: &Value) -> Result<u64, RuntimeError> { self.0.delete(t, s, r) }
}

#[test]
fn exhausted_provisional_rule_admission_keeps_a_covered_range_unknown() {
    // This badge counts own sends, so an admitted provisional insert is a match.
    let source = include_str!("../../../../snapback4-device/tests/unread_range/schema.q")
        .replace(".senderId != m.principal and ", "");
    let (schema, rows, member) = fixture_source(&source);
    let rows = CoveredRows(rows);
    for (id, ordinal, until) in [("settled", 1, Value::Null), ("pending", 2, Value::Null), ("expired", 3, Value::Int(1))] {
        let row = object([("id", Value::Id(id.into())), ("conversationId", Value::Id("c".into())),
            ("ordinal", Value::Int(ordinal)), ("at", Value::Int(ordinal)), ("senderId", Value::Id("bob".into())),
            ("tombstone", Value::Bool(false)), ("until", until)]);
        rows.put("messages", &schema.tables["messages"], &row, None).unwrap();
    }
    for cut in [Cut::Cap, Cut::Abort] {
        let mut r = Runner::new(&rows, &schema, Context::new("bob", Default::default()).at(1), Meter::new(Ceilings::default(), cut), 0);
        r.device = true;
        if cut == Cut::Abort { r.device_allowance = Some(Meter::new(Ceilings::default(), Cut::Abort)); }
        r.provisional_rows.insert(("messages".into(), "pending".into()));
        let m = &schema.maintains[0];
        assert!(r.row_view_source_readable(m, &member).unwrap());
        // With room, the provisional match counts and the expired image does not.
        assert_eq!(r.device_live_count(m, &member).unwrap(), (2, true));
        assert!(!r.beyond_horizon);
        r.meter.used.rule_probes = r.meter.ceilings.rule_probes;
        let result = r.device_live_count(m, &member);
        if cut == Cut::Cap {
            assert_eq!(result.unwrap(), (1, false), "unresolved row is not absent");
        } else {
            // The aborting meter still rejects its attempted probe charge;
            // local::predict turns a bound with this missing fact into queued intent.
            assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::RuleProbes, .. })));
        }
        assert!(r.beyond_horizon && r.missing_fact.as_ref().is_some_and(|s| s.contains("messages") && s.contains("source rule admission")));
        assert!(!r.components.provenance().speculative);
        if cut == Cut::Abort { assert!(matches!(r.pending_view_read(), Err(RuntimeError::Prediction(_)))); }
    }
}
