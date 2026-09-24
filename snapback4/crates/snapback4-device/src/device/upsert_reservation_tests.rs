//! An upsert's insert arm must use the authorization allowance already reserved.
use super::*;
use snapback4_core::{Engine, WriteState, value::object};
use serde_json::json;

const SOURCE: &str = r#"
table grants:
  record: id
  principal: principal
  unique record, principal
  by byPrincipal: principal, record
  public
  sync public
table records:
  amount: int
  until: time ?
  expire at .until
  read <- exists grants[.id, viewer]
  insert <- allow
  update <- allow
  sync to grants[.id] by .principal
mutation put(work: int):
  for i in range(0, work):
    ignored = records['existing']
  upsert records['target'] { amount: 1, until: null }
  return null
query warm(work: int):
  for i in range(0, work):
    ignored = records['existing']
  return null
"#;

fn context(work: i64) -> Context {
    Context::new("alice", BTreeMap::from([("work".into(), Value::Int(work))])).at(100)
}

fn matches_server(rows: &impl Rows, engine: &mut Engine) {
    let Some(Value::Row(mut predicted)) = rows.get("records", "target").unwrap() else { panic!("missing prediction") };
    assert_eq!(predicted.remove("pending"), Some(Value::Bool(true)));
    assert_eq!(Some(Value::Row(predicted)), engine.store_mut().transaction().unwrap().get("records", "target").unwrap());
}

fn fixture<S: DeviceStore>(store: S) -> (Engine, Device<S>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    let id = |value: &str| Value::Id(value.into());
    engine.seed([
        ("records".into(), object([("id", id("existing")), ("amount", Value::Int(0)), ("until", Value::Null)])),
        ("grants".into(), object([("id", id("existing-grant")), ("record", id("existing")), ("principal", id("alice"))])),
        ("grants".into(), object([("id", id("target-grant")), ("record", id("target")), ("principal", id("alice"))])),
    ]).unwrap();
    let backend = Backend { generation: engine.generation(), schema: b.schema, programs: b.programs.into_iter().map(|p| p.program).collect() };
    let mut device = Device::open_store(store, Some(backend)).unwrap();
    let page = engine.snapshot_acquisition_page_at("alice", None, 100, 100).unwrap();
    assert!(page.next.is_none());
    let page: StreamPage = decoded(&json!({"snapshot":true, "watermark":page.watermark,
        "more":false, "generation":engine.generation(), "held":page.held, "acquisitions":page.acquisitions,
        "events":page.events.iter().map(|e| json!({"table":e.table, "kind":e.kind, "id":e.id,
            "data":e.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>() }).to_string()).unwrap();
    device.apply(&page, true).unwrap();
    (engine, device)
}

fn after_8190<S: DeviceStore>(store: S) {
    let (mut engine, mut device) = fixture(store);
    // Both preludes really spend 8,190 probes, leaving exactly 2R + U + 2I = 2.
    let server_warm = engine.query("warm", context(8_190)).unwrap();
    assert_eq!(server_warm.metered.rule_probes, 8_190);
    let tx = device.store.transaction().unwrap();
    let predicting = Predicting { tx: &tx, schema: &device.schema, groups: history::load(&tx, history::GROUPS).unwrap(),
        boundaries: boundary::Boundaries::load(&tx, false).unwrap(), written: RefCell::new(Vec::new()) };
    for allowance in [8_189, 8_190] {
        let warm = local::predict(&predicting, &device.schema, &device.programs["warm"], context(8_190), Ceilings { rule_probes: allowance, ..Ceilings::default() });
        if allowance == 8_190 { assert!(warm.is_ok(), "{warm:?}"); }
        else { assert!(matches!(warm, Err(RuntimeError::Bound { kind: snapback4_core::error::MeterKind::RuleProbes, actual: 8_190, ceiling: 8_189, .. })), "{warm:?}"); }
    }
    drop(predicting);
    tx.rollback().unwrap();
    let server = engine.mutate("put", Some("put"), context(8_190)).unwrap();
    assert!(matches!(server.state, WriteState::Sent { .. }), "{server:?}");
    assert_eq!(server.metered.rule_probes, 8_190);
    let reply = crate::call::call(&mut device, json!({"op":"admit", "entry":{
        "id":"put", "seq":1, "op":"put", "viewer":"alice", "now":100, "args":{"work":8190}, "predictable":true
    }}));
    let queued: Queued = decoded(&reply["ok"].to_string()).expect(&reply.to_string());
    assert!(queued.predictable, "{queued:?}");
    assert_eq!(queued.predicted, ["records/target"]);
    assert_eq!(device.queued().unwrap().len(), 1, "admission keeps the write for server delivery");
    let tx = device.store.transaction().unwrap();
    matches_server(&tx, &mut engine);
    tx.rollback().unwrap();
}

fn preflight_ceiling<S: DeviceStore>(store: S, allowance: u64) {
    let (mut engine, mut device) = fixture(store);
    let ceilings = Ceilings { rule_probes: allowance, ..Ceilings::default() };
    engine.set_ceilings(ceilings);
    let server = engine.mutate("put", None, context(0)).unwrap();
    let tx = device.store.transaction().unwrap();
    let predicting = Predicting { tx: &tx, schema: &device.schema, groups: history::load(&tx, history::GROUPS).unwrap(),
        boundaries: boundary::Boundaries::load(&tx, false).unwrap(), written: RefCell::new(Vec::new()) };
    // Device admission fixes production ceilings. Exercise that same adapter
    // and interpreter directly for the smaller, exactly-preflight ceiling.
    let predicted = local::predict(&predicting, &device.schema, &device.programs["put"], context(0), ceilings);
    if allowance == 2 {
        assert!(matches!(server.state, WriteState::Sent { .. }), "{server:?}");
        assert!(predicted.is_ok(), "{predicted:?}");
        assert_eq!(predicting.written.borrow().as_slice(), ["records/target"]);
        matches_server(&tx, &mut engine);
    } else {
        let WriteState::Failed { why, .. } = server.state else { panic!("{server:?}") };
        assert_eq!(why.code, "E_BOUND");
        let error = predicted.unwrap_err().refusal();
        assert_eq!(error.code, why.code);
        assert_eq!(error.message, why.message);
        assert!(tx.get("records", "target").unwrap().is_none(), "preflight still reserves before lookup");
    }
    drop(predicting);
    tx.rollback().unwrap();
}

#[test]
fn upsert_insert_reserves_once_after_8190_probes_memory() { after_8190(crate::memory::MemoryStore::new()); }
#[test]
fn upsert_insert_reserves_once_after_8190_probes_sqlite() { publication_tests::with_sqlite(after_8190); }
#[test]
fn upsert_insert_at_preflight_ceiling_memory() {
    for ceiling in [1, 2] { preflight_ceiling(crate::memory::MemoryStore::new(), ceiling); }
}
#[test]
fn upsert_insert_at_preflight_ceiling_sqlite() {
    for ceiling in [1, 2] { publication_tests::with_sqlite(|store| preflight_ceiling(store, ceiling)); }
}
