//! Transaction and recovery witnesses beside publication_round*.rs.
use super::*;
use crate::memory::MemoryStore;
use serde_json::json;

fn backend() -> Backend {
    let b = snapback4_lang::compile(&[("schema.q".into(), r#"
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
query one():
  return counters['a']
mutation bump():
  c = counters['a'] ! else NOT_FOUND
  update counters['a'] {n: c.n + 1}
table history:
  n: int
  public 'test'
  sync public last 2 by .n, .id
query page():
  return history last 2 by .n, .id
"#.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Backend { generation: 1, schema: b.schema, programs: b.programs.into_iter().map(|p|p.program).collect() }
}
fn pages(b: &Backend) -> Vec<StreamPage> {
    let index = b.schema.tables["history"].sync.as_ref().unwrap().horizon.as_ref().unwrap().by.clone();
    [json!({"snapshot":false,"watermark":0,"images_at":0,"more":false,
        "events":[{"table":"counters","id":"a","kind":"put","data":{"id":"a","n":0}}],
        "acquire":{"unit":{"tier":1,"table":"counters"},"cursor":"walk","exhausted":false,"whole_tables":["counters"]}}),
     json!({"snapshot":false,"watermark":0,"images_at":0,"more":false,
        "events":[{"table":"history","id":"h","kind":"put","data":{"id":"h","n":0}}],
        "acquisitions":[{"at":0,"table":"history","index":index,"group":[]}, {"at":1,"table":"history","index":index,"group":[],"floor":"whole"}],
        "acquire":{"unit":{"tier":2,"table":"history","group":[]},"cursor":null,"exhausted":true,"whole_tables":[]}})]
        .into_iter().map(|v|decoded(&v.to_string()).unwrap()).collect()
}
fn reopen(d: Device<MemoryStore>) -> Device<MemoryStore> {
    let mut store = MemoryStore::new(); store.load(d.store.export()).unwrap();
    Device::open_store(store, None).unwrap()
}
fn evidence(d: &mut Device<MemoryStore>) -> (serde_json::Value, Vec<crate::memory::Change>) {
    let s = d.sync_state_read().unwrap();
    let state = json!({"cursor":s.acquisition_cursor,"tables":s.acquired_tables,"floors":s.floored_groups,"acquired":s.acquired,"watermark":s.watermark});
    (state, d.store.export())
}

#[test]
fn progressive_commit_failure_and_host_persistence_before_after_every_unit() {
    let b = backend(); let mut d = Device::open_store(MemoryStore::new(), Some(b.clone())).unwrap();
    for (i, mut page) in pages(&b).into_iter().enumerate() {
        page.watermark = 7; page.images_at = Some(7);
        page.acquire.as_mut().unwrap().pinned = i == 0;
        let before = evidence(&mut d);
        crate::memory::FAIL_COMMIT.with(|fail| fail.set(true));
        let failure = d.apply(&page, false).unwrap_err();
        assert!(failure.to_string().contains("injected commit failure"));
        assert_eq!(evidence(&mut d), before, "no rows, floor, cursor, fact or format envelope escaped rollback");
        d = reopen(d); assert_eq!(evidence(&mut d).0, before.0);
        // Host failure after memory commit but before durable persistence:
        // discard that call's entire changes, as the IndexedDB owner must.
        let durable_before = d.store.export();
        d.apply(&page, false).unwrap();
        let published = evidence(&mut d).0;
        let mut failed_host = MemoryStore::new(); failed_host.load(durable_before).unwrap();
        let mut recovered = Device::open_store(failed_host, None).unwrap();
        assert_eq!(evidence(&mut recovered).0, before.0);
        recovered.apply(&page, false).unwrap(); assert_eq!(evidence(&mut recovered).0, published);
        d = reopen(recovered); assert_eq!(evidence(&mut d).0, published);
        assert_eq!(d.sync_state_read().unwrap().watermark, 7);
    }
    assert!(d.sync_state_read().unwrap().acquired);
}

fn pinned_unit<S: DeviceStore>(store: S) {
    let b = backend(); let mut d = Device::open_store(store, Some(b.clone())).unwrap();
    let mut page = pages(&b).remove(0);
    page.watermark = 7; page.images_at = Some(7); page.requested_watermark = Some(0);
    page.acquire.as_mut().unwrap().pinned = true;
    // The split remains relative to the requested cut, not the adopted pin.
    page.committed_above.insert("own".into(), 7);
    let (_, published) = d.apply_publication(&page, false).unwrap();
    assert!(published && !d.publication_pending().unwrap());
    let s = d.sync_state_read().unwrap();
    assert_eq!(s.watermark, 7); assert_eq!(s.transfer_watermark, 7);
    assert_eq!(s.acquired_tables, ["counters"]); assert!(!s.acquired);
    assert_eq!(d.query("one", "alice", &json!({}), 100).unwrap().data.field("n").unwrap(), &Value::Int(0));
    assert!(d.store.meta(SNAPSHOT_OWNER).unwrap().is_none());
    let before = d.sync_state_read().unwrap();
    assert_eq!(d.apply(&page, false).unwrap_err().code(), "E_GENERATION");
    let after = d.sync_state_read().unwrap();
    assert_eq!(after.watermark, before.watermark); assert_eq!(after.acquisition_cursor, before.acquisition_cursor);
}
#[test]
fn cold_pin_publishes_watermark_rows_and_facts_on_both_stores() {
    pinned_unit(MemoryStore::new());
    #[cfg(feature = "native")]
    publication_tests::with_sqlite(pinned_unit);
}

fn reject_pin<S: DeviceStore>(store: S) {
    let b = backend(); let mut d = Device::open_store(store, Some(b.clone())).unwrap();
    let mut page = pages(&b).remove(0);
    page.watermark = 7; page.images_at = Some(7); page.acquire.as_mut().unwrap().pinned = true;
    for prior in ["watermark", "rows", "boundary", "table", "cursor"] {
        let tx = d.store.transaction().unwrap();
        match prior {
            "watermark" => tx.set_meta(WATERMARK, "1").unwrap(),
            "rows" => { tx.put("counters", &b.schema.tables["counters"], &wire::row_from_json(&b.schema.tables["counters"], &json!({"id":"a","n":99})).unwrap(), None).unwrap(); },
            "boundary" => tx.set_meta(&format!("{}kept", boundary::BOUNDARIES), "whole").unwrap(),
            "table" => tx.set_meta("device:acquired-table:counters", "0").unwrap(),
            "cursor" => tx.set_meta(acquisition::CURSOR, "prior").unwrap(),
            _ => unreachable!(),
        }
        tx.commit().unwrap();
        assert_eq!(d.apply(&page, false).unwrap_err().code(), "E_GENERATION", "{prior}");
        assert!(d.store.meta("device:progressive-format").unwrap().is_none(), "no partial upgrade on refusal");
        let tx = d.store.transaction().unwrap();
        assert_eq!(meta_u64(&tx, WATERMARK).unwrap(), if prior == "watermark" { 1 } else { 0 });
        if prior == "rows" { assert_eq!(tx.get("counters", "a").unwrap().unwrap().field("n").unwrap(), &Value::Int(99)); }
        tx.clear_rows().unwrap(); tx.delete_meta(&[WATERMARK, boundary::BOUNDARIES, "device:acquired-table:", acquisition::CURSOR]).unwrap();
        tx.commit().unwrap();
    }
}
#[test]
fn a_pin_refuses_any_existing_watermark_rows_or_coverage() {
    reject_pin(MemoryStore::new());
    #[cfg(feature = "native")]
    publication_tests::with_sqlite(reject_pin);
}

#[test]
fn progressive_format_refuses_old_backend_decoder_and_survives_adoption() {
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct OldBackend { generation: u64, schema: Schema, programs: Vec<Program> }
    let b = backend(); let mut d = Device::open_store(MemoryStore::new(), Some(b.clone())).unwrap();
    d.apply(&pages(&b)[0], false).unwrap();
    for pass in 0..3 {
        let text = d.store.meta(BACKEND).unwrap().unwrap();
        let saved: serde_json::Value = decoded(&text).unwrap();
        assert_eq!(saved["schema"], serde_json::to_value(&b.schema).unwrap(), "host residency keeps its schema path");
        assert!(snapback4_core::json_codec::from_text::<OldBackend>(&text).is_err());
        assert!(decoded::<Backend>(&text).is_ok());
        if pass == 0 { d = reopen(d); } else { d.adopt(b.clone()).unwrap(); }
    }
}

#[test]
fn progressive_does_not_bypass_an_existing_media_upgrade() {
    let b = backend(); let mut d = Device::open_store(MemoryStore::new(), Some(b.clone())).unwrap();
    d.store.set_meta(media::FORMAT, "old").unwrap();
    assert!(d.sync_state_read().unwrap().replacement_required);
    assert_eq!(d.apply(&pages(&b)[0], false).unwrap_err().code(), "E_GENERATION");
    assert!(d.store.meta(acquisition::CURSOR).unwrap().is_none());
}

fn deferred_acquisition<S: DeviceStore>(store: S) {
    let b = backend(); let mut d = Device::open_store(store, Some(b.clone())).unwrap();
    let first = pages(&b).remove(0); d.apply(&first, false).unwrap();
    // Existing pending custody imported from a previously predicting owner.
    // New prediction admission before ACQUIRED is separately refused.
    let q: Queued = decoded(r#"{"id":"own","seq":1,"op":"bump","args":{},"viewer":"alice","now":100,"predictable":true}"#).unwrap();
    let tx = d.store.transaction().unwrap(); predictions::enqueue(&tx, &q).unwrap(); tx.commit().unwrap();
    let capture = d.sync_state().unwrap();
    let mut page = pages(&b).remove(1);
    page.images_at = Some(1); page.more = true; page.committed_above.insert("own".into(), 1);
    page.pending_through = Some(capture.pending_through); page.pending_complete = Some(capture.pending_complete); page.pending_bound = Some(capture.pending_bound);
    let before = d.sync_state_read().unwrap();
    assert_eq!(d.apply_publication(&page, false).unwrap(), (vec![], false));
    let after = d.sync_state_read().unwrap();
    assert_eq!(after.acquisition_cursor, before.acquisition_cursor); assert_eq!(after.floored_groups, 0);
    assert!(!after.acquisition_exhausted && !after.acquired); assert!(d.publication_pending().unwrap());
    let tx = d.store.read_transaction().unwrap(); assert!(tx.get("history", "h").unwrap().is_none()); tx.rollback().unwrap();
    let catchup: StreamPage = decoded(&json!({"snapshot":false,"watermark":1,"requested_watermark":0,"images_at":1,"more":false,
        "events":[{"table":"counters","id":"a","kind":"put","data":{"id":"a","n":1}}],
        "acknowledged":{"own":1},"sent":{"own":1}}).to_string()).unwrap();
    d.apply(&catchup, false).unwrap();
    let s = d.sync_state_read().unwrap(); assert!(s.acquired && s.acquisition_exhausted); assert_eq!(s.floored_groups, 1);
    assert_eq!(d.query("one", "alice", &json!({}), 100).unwrap().data.field("n").unwrap(), &Value::Int(1));
    assert!(d.query("page", "alice", &json!({}), 100).unwrap().complete);
    assert!(!d.publication_pending().unwrap());
}
#[test]
fn acquisition_reuses_own_write_deferral_for_rows_cursor_floor_and_completion() {
    deferred_acquisition(MemoryStore::new());
    #[cfg(feature = "native")]
    publication_tests::with_sqlite(deferred_acquisition);
}

fn deferred_pin<S: DeviceStore>(store: S) {
    let b = backend(); let mut d = Device::open_store(store, Some(b.clone())).unwrap();
    // Recovered custody can predate this cold replica. The pin must preserve
    // Repair B even though the requested receipt cut differs from its watermark.
    let q: Queued = decoded(r#"{"id":"own","seq":1,"op":"bump","args":{},"viewer":"alice","now":100,"predictable":true}"#).unwrap();
    let tx = d.store.transaction().unwrap(); predictions::enqueue(&tx, &q).unwrap(); tx.commit().unwrap();
    let capture = d.sync_state().unwrap();
    let mut page = pages(&b).remove(0);
    page.watermark = 7; page.images_at = Some(7); page.requested_watermark = Some(0);
    page.acquire.as_mut().unwrap().pinned = true; page.committed_above.insert("own".into(), 7);
    page.pending_through = Some(capture.pending_through); page.pending_complete = Some(capture.pending_complete); page.pending_bound = Some(capture.pending_bound);
    assert_eq!(d.apply_publication(&page, false).unwrap(), (vec![], false));
    let s = d.sync_state_read().unwrap();
    assert_eq!(s.watermark, 0); assert_eq!(s.transfer_watermark, 7);
    assert!(s.acquired_tables.is_empty() && s.acquisition_cursor.is_none() && !s.acquired);
    let tx = d.store.read_transaction().unwrap(); assert!(tx.get("counters", "a").unwrap().is_none()); tx.rollback().unwrap();
    let catchup: StreamPage = decoded(r#"{"snapshot":false,"watermark":7,"images_at":7,"requested_watermark":7,"more":false,"events":[],"acknowledged":{"own":7},"sent":{"own":7}}"#).unwrap();
    d.apply(&catchup, false).unwrap();
    let s = d.sync_state_read().unwrap(); assert_eq!(s.watermark, 7);
    assert_eq!(s.acquired_tables, ["counters"]); assert!(!s.acquired);
    assert_eq!(d.query("one", "alice", &json!({}), 100).unwrap().data.field("n").unwrap(), &Value::Int(0));
}
#[test]
fn a_cold_pin_keeps_own_write_deferral_on_both_stores() {
    deferred_pin(MemoryStore::new());
    #[cfg(feature = "native")]
    publication_tests::with_sqlite(deferred_pin);
}
