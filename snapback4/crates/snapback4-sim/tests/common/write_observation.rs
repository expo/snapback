//! One paired-world observation boundary, shared by simulator and device acceptance.
//! First/retry bodies are the serializer's bytes, unchanged: no redaction and no actual HTTP transport/status.
//! The package tests exercise /m's HTTP route separately.
#![allow(dead_code)]
#[path = "../../../snapback4-device/tests/common/mod.rs"]
mod hosts;
use hosts::{Host, Memory, Sqlite};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, wire};
use snapback4_core::ir::*;
use snapback4_core::meter::Metered;
use snapback4_device::device::{Backend, Device, Queued, StreamPage};
use std::collections::{BTreeMap, BTreeSet};

type Rows = BTreeMap<String, Vec<Value>>;
#[derive(Debug)]
pub struct Observation {
    pub first_http_body: Vec<u8>,
    pub receipt: String,
    pub retry_http_body: Vec<u8>,
    pub meter: Metered,
    pub before: Rows,
    pub committed: Rows,
    pub changes: Json,
    pub effects: Json,
    pub stream: Json,
    pub snapshot: Json,
    pub devices: [Json; 2],
}
impl Observation {
    pub fn body(&self) -> Json { serde_json::from_slice(&self.first_http_body).unwrap() }
    pub fn assert_same(&self, other: &Self) {
        assert_eq!(self.first_http_body, other.first_http_body, "first /m bytes");
        assert_eq!(self.receipt, other.receipt, "durable receipt");
        assert_eq!(self.retry_http_body, other.retry_http_body, "retry /m bytes");
        assert_eq!(self.meter, other.meter, "all seven meter fields");
        // Retained hidden images intentionally differ; compare the actual committed delta,
        // and retain both full states for rollback/retention assertions within each world.
        assert_eq!(self.changes, other.changes, "committed source and maintain changes");
        assert_eq!(self.effects, other.effects, "effects");
        assert_eq!(self.stream, other.stream, "writer stream page");
        assert_eq!(self.snapshot, other.snapshot, "writer snapshot");
        assert_eq!(self.devices, other.devices, "both device stores, including reopen and settlement");
    }
    pub fn assert_unchanged(&self) {
        assert_eq!(self.before, self.committed, "source rows and maintains rolled back");
        assert_eq!(self.changes, json!({}));
    }
}
fn rows(e: &Engine) -> Rows {
    e.schema().tables.keys().map(|table| (table.clone(), e.store().rows(table).unwrap())).collect()
}
fn delta(before: &Rows, after: &Rows) -> Json {
    let mut changes = serde_json::Map::new();
    for (table, rows) in after {
        let old: BTreeMap<_, _> = before[table].iter().map(|r| (r.field("id").unwrap().as_str().unwrap(), r)).collect();
        // Index the current identities once; keep nominal ids distinct from strings.
        let present: BTreeSet<_> = rows.iter().map(|row| {
            let id = row.field("id").unwrap();
            (id.kind(), id.as_str().unwrap())
        }).collect();
        for row in rows {
            let id = row.field("id").unwrap();
            let fields: serde_json::Map<_, _> = row.as_object().unwrap().iter().filter(|(name, value)| old.get(id.as_str().unwrap()).is_none_or(|r| r.field(name).ok() != Some(value)))
                .map(|(name, value)| (name.clone(), wire::to_json(value))).collect();
            if !fields.is_empty() { changes.insert(format!("{table}/{}", id.as_str().unwrap()), Json::Object(fields)); }
        }
        for row in &before[table] {
            let id = row.field("id").unwrap();
            if !present.contains(&(id.kind(), id.as_str().unwrap())) { changes.insert(format!("{table}/{}", id.as_str().unwrap()), Json::Null); }
        }
    }
    Json::Object(changes)
}

#[test]
fn delta_preserves_field_changes_deletions_and_nominal_ids_per_table() {
    let row = |id: Value, amount: i64| Value::Row([("id".into(), id), ("amount".into(), Value::Int(amount))].into_iter().collect());
    let before: Rows = [
        ("items".into(), vec![row(Value::Id("same".into()), 1), row(Value::Id("edited".into()), 2), row(Value::Id("deleted".into()), 3), row(Value::Id("nominal".into()), 4)]),
        ("other".into(), vec![row(Value::Id("deleted".into()), 5), row(Value::Id("same".into()), 6)]),
        ("empty".into(), vec![]),
    ].into();
    let after: Rows = [
        ("items".into(), vec![row(Value::Id("edited".into()), 8), row(Value::Id("added".into()), 9), row(Value::Id("same".into()), 1), row(Value::String("nominal".into()), 4)]),
        ("other".into(), vec![row(Value::Id("deleted".into()), 5)]),
        ("empty".into(), vec![]),
    ].into();
    assert_eq!(delta(&before, &after), json!({
        "items/edited": {"amount": 8},
        "items/added": {"id": "added", "amount": 9},
        "items/deleted": null,
        "items/nominal": null,
        "other/same": null,
    }));
}
fn snapshot(e: &mut Engine, viewer: &str) -> Json {
    let (events, watermark) = e.snapshot_at(viewer, 1000).unwrap();
    json!({"snapshot":true,"events":events.iter().map(|event| json!({"table":event.table,"kind":event.kind.word(),"id":event.id,"data":event.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>(),"watermark":watermark,"more":false,"generation":e.generation()})
}
fn backend(e: &Engine) -> Backend {
    let mut programs: Vec<_> = e.programs().cloned().collect();
    for table in e.schema().tables.keys() {
        programs.push(Program { name: format!("__observation_{table}"), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None, native: false,
            body: vec![Stmt::Return(Expr::Scan(Scan { site: "observation".into(), table: table.clone(), index: "byId".into(), prefix: vec![], order: Order::Asc, take: Bound::Literal(20_000), after: None, before: None, range: None, filter: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }))] });
    }
    Backend { generation: e.generation(), schema: e.schema().clone(), programs }
}
fn query_envelope(result: snapback4_core::QueryOutcome) -> Json {
    let mut envelope = serde_json::to_value(&result).unwrap();
    envelope["data"] = wire::to_json(&result.data);
    envelope
}
fn local<H: Host>(device: &mut Device<H::Store>, viewer: &str, query: &(&str, Json)) -> Json {
    let tables: Vec<_> = device.schema().tables.keys().cloned().collect();
    let rows: BTreeMap<_, _> = tables.iter().map(|table| {
        let result = device.query(&format!("__observation_{table}"), viewer, &json!({}), 1000);
        (table.clone(), match result { Ok(result) => query_envelope(result), Err(why) => json!({"why":why}) })
    }).collect();
    let query = match device.query(query.0, viewer, &query.1, 1000) {
        Ok(result) => query_envelope(result), Err(why) => json!({"why":why}),
    };
    json!({"rows":rows,"query":query,"outbox":device.queued().unwrap()})
}
fn prepare<H: Host>(host: &mut H, backend: &Backend, snapshot: &Json, entry: &Queued, query: &(&str, Json)) -> (Device<H::Store>, Json) {
    let mut device = host.open("paired", Some(backend.clone())).unwrap();
    device.apply(&serde_json::from_value(snapshot.clone()).unwrap(), true).unwrap();
    let initial = local::<H>(&mut device, &entry.viewer, query);
    let admitted = match device.admit(entry.clone()) { Ok(entry) => json!({"queued":entry}), Err(error) => json!({"refusal":error.refusal()}) };
    let pending = local::<H>(&mut device, &entry.viewer, query);
    host.close("paired", device);
    let mut device = host.open("paired", None).unwrap();
    let reopened = local::<H>(&mut device, &entry.viewer, query);
    assert_eq!(pending, reopened, "pending state survives reopen");
    (device, json!({"initial":initial,"admission":admitted,"pending":pending,"reopened":reopened}))
}
fn settle<H: Host>(host: &mut H, mut device: Device<H::Store>, mut observation: Json, result: &MutationOutcome, page: &StreamPage, entry: &Queued, query: &(&str, Json)) -> Json {
    let seq = match result.state { WriteState::Sent { seq, .. } => Some(seq), WriteState::Failed { .. } => None };
    if device.queued().unwrap().iter().any(|queued| queued.id == entry.id) { device.settle(&entry.id, seq).unwrap(); }
    device.apply(page, false).unwrap();
    observation["settled"] = local::<H>(&mut device, &entry.viewer, query);
    assert!(device.queued().unwrap().is_empty(), "settles sent and failed operations");
    host.close("paired", device);
    observation
}

pub fn observe(e: &mut Engine, name: &str, viewer: &str, values: Json, op: &str, query: (&str, Json)) -> (MutationOutcome, Observation) {
    observe_with_intervention(e, name, viewer, values, op, query, |_| {})
}

/// Run a revocation after recording the first body, before retry and both stores' settlement.
pub fn observe_with_intervention(e: &mut Engine, name: &str, viewer: &str, values: Json, op: &str, query: (&str, Json), intervene: impl FnOnce(&mut Engine)) -> (MutationOutcome, Observation) {
    observe_lifecycle(e, name, viewer, values, op, query, |_| None, intervene)
}

/// Plant an explicitly historical raw receipt; compare replay with today's sanitized
/// receipt, while retaining the raw bytes and the complete device lifecycle.
pub fn observe_with_historical_receipt(e: &mut Engine, name: &str, viewer: &str, values: Json, op: &str, query: (&str, Json), historical: impl FnOnce(&MutationOutcome) -> Json, intervene: impl FnOnce(&mut Engine)) -> (MutationOutcome, Observation) {
    observe_lifecycle(e, name, viewer, values, op, query, |result| Some(historical(result)), intervene)
}

fn observe_lifecycle(e: &mut Engine, name: &str, viewer: &str, values: Json, op: &str, query: (&str, Json), historical: impl FnOnce(&MutationOutcome) -> Option<Json>, intervene: impl FnOnce(&mut Engine)) -> (MutationOutcome, Observation) {
    let before = rows(e);
    let initial = snapshot(e, viewer);
    let seq = e.seq().unwrap();
    let backend = backend(e);
    let ids: Vec<String> = (0..2200).map(|n| match n { 0 => "fresh".into(), 1 => "effect".into(), _ => format!("effect{n}") }).collect();
    let entry = Queued { id: op.into(), seq: 1, op: name.into(), args: values.clone(), viewer: viewer.into(), now: 1000, new_ids: ids.clone(), predicted: vec![], predictable: true, sent_seq: None, observed_seq: None };
    let mut sqlite = Sqlite::new("w2-observation");
    let mut memory = Memory::new();
    let (sqlite_device, sqlite_before) = prepare(&mut sqlite, &backend, &initial, &entry, &query);
    let (memory_device, memory_before) = prepare(&mut memory, &backend, &initial, &entry, &query);
    let program = e.programs().find(|p| p.name == name).unwrap();
    let args = values.as_object().unwrap().iter().map(|(k,v)| (k.clone(), wire::from_json(&program.args[k], v).unwrap())).collect();
    let context = Context::new(viewer, args).at(1000).with_ids(ids);
    let result = e.mutate(name, Some(op), context.clone()).unwrap();
    assert!(!result.replayed);
    let first_http_body = serde_json::to_vec(&result.reply(Some(op))).unwrap();
    let expected_replay = result.receipt(Some(op));
    assert_eq!(serde_json::from_str::<Json>(&e.store().applied_outcome(viewer, op).unwrap().unwrap()).unwrap(), expected_replay);
    if let Some(raw) = historical(&result) {
        e.store().conn().execute("UPDATE _ops SET outcome = ?1 WHERE principal = ?2 AND id = ?3", [raw.to_string(), viewer.to_owned(), op.to_owned()]).unwrap();
    }
    let receipt = e.store().applied_outcome(viewer, op).unwrap().unwrap();
    let committed = rows(e);
    let changes = delta(&before, &committed);
    intervene(e);
    let retry = e.mutate(name, Some(op), context).unwrap();
    let retry_http_body = serde_json::to_vec(&retry.reply(Some(op))).unwrap();
    assert_eq!(retry_http_body, serde_json::to_vec(&expected_replay).unwrap());
    assert_eq!(e.replay(viewer, op).unwrap().unwrap().reply(Some(op)), retry.reply(Some(op)));
    let stream_page = e.stream_at(viewer, seq, 20_000, 1000).unwrap();
    let stream = serde_json::to_value(&stream_page).unwrap();
    let page: StreamPage = serde_json::from_value(json!({"snapshot":false,"events":stream_page.events.iter().map(|event| json!({"table":event.table,"kind":event.kind,"id":event.id,"data":event.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>(),"watermark":stream_page.watermark,"more":stream_page.more,"generation":e.generation()})).unwrap();
    let sqlite_after = settle(&mut sqlite, sqlite_device, sqlite_before, &result, &page, &entry, &query);
    let memory_after = settle(&mut memory, memory_device, memory_before, &result, &page, &entry, &query);
    assert_eq!(sqlite_after, memory_after, "SQLite and memory devices agree");
    let observation = Observation { first_http_body, receipt, retry_http_body, meter: result.metered, before, committed, changes,
        effects: serde_json::to_value(e.effects(None, 20_000).unwrap()).unwrap(), stream, snapshot: snapshot(e, viewer), devices: [sqlite_after, memory_after] };
    if matches!(result.state, WriteState::Failed { .. }) { observation.assert_unchanged(); }
    (result, observation)
}
