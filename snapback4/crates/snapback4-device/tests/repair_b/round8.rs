//! Restore evidence belongs to validated private progress and its incarnation.
use super::*;

macro_rules! both { ($name:ident, $body:ident) => {
    mod $name {
        use super::*;
        #[test] fn memory() { $body(&mut Memory::new()); }
        #[test] fn sqlite() { $body(&mut Sqlite::new(stringify!($name))); }
    }
} }

fn reply<S: DeviceStore>(d: &mut Device<S>, cut: u64, head: Option<u64>) -> StreamPage {
    let capture = d.sync_state().unwrap();
    serde_json::from_value(json!({"snapshot":false,"store_id":"S","generation":1,
        "events":[],"watermark":cut,"images_at":head,"more":head.is_some_and(|h| h > cut),
        "snapshot_catchup":capture.snapshot_catchup,
        "requested_watermark":capture.transfer_watermark,"captured_watermark":capture.watermark,
        "send_revision":capture.send_revision,"pending_through":capture.pending_through,
        "pending_complete":capture.pending_complete,"pending_bound":capture.pending_bound})).unwrap()
}

fn fixture<H: Host>(h: &mut H, name: &str, snapshot: bool) -> Device<H::Store> {
    let (_, backend) = compile(SOURCE);
    let mut d = h.open(name, Some(backend)).unwrap();
    let p = serde_json::from_value(json!({"snapshot":false,"store_id":"S",
        "watermark":5,"more":false,"events":[
            {"table":"counters","kind":"put","id":"a","data":{"id":"a","n":5}},
            {"table":"counters","kind":"put","id":"b","data":{"id":"b","n":0}}]})).unwrap();
    d.apply(&p, false).unwrap();
    admit(&mut d, "q", "bump", json!({"k":"b"}));
    if snapshot {
        let mut p = reply(&mut d, 8, Some(8));
        p.snapshot = true; p.stage_snapshot = true; p.requested_watermark = Some(0);
        assert!(!d.apply_publication(&p, true).unwrap().1);
    }
    let mut p = reply(&mut d, 10, Some(20));
    p.events = serde_json::from_value(json!([{"table":"counters","kind":"put","id":"a","data":{"id":"a","n":99}}])).unwrap();
    p.committed_above.insert("q".into(), 20);
    assert!(!d.apply_publication(&p, false).unwrap().1);
    assert_eq!(value(&mut d, "a"), Some(5), "private images must stay private");
    let state = d.sync_state_read().unwrap();
    assert_eq!((state.watermark, state.transfer_watermark), (5, 10));
    d
}

fn refused<S: DeviceStore>(d: &mut Device<S>, op: &str, page: &StreamPage) {
    let response = snapback4_device::call::call(d, json!({"op":op,"page":page}));
    assert_eq!(response["denied"]["code"], "E_STORE_RESTORE", "{op}: {response}");
    assert_ne!(response["denied"]["retryable"], true);
}

fn halted<S: DeviceStore>(d: &mut Device<S>) {
    let state = d.sync_state_read().unwrap();
    assert_eq!(state.restore_refusal.unwrap().code, "E_STORE_RESTORE");
    assert!(!state.acquired);
    assert_eq!(d.begin_send().unwrap_err().refusal().code, "E_STORE_RESTORE");
    assert_eq!(d.query("one", "dev:alice", &json!({"k":"a"}), 100).unwrap_err().code, "E_STORE_RESTORE");
}

fn cursor_restore<H: Host>(h: &mut H) {
    for snapshot in [false, true] {
        for op in ["observe_store", "apply"] {
            for head in [None, Some(7)] {
                let name = format!("cursor-{snapshot}-{op}-{head:?}");
                let mut d = fixture(h, &name, snapshot);
                let p = reply(&mut d, 7, head);
                refused(&mut d, op, &p);
                assert_eq!(d.state().unwrap().0, 5);
                halted(&mut d);
                h.close(&name, d);
                let mut d = h.open(&name, None).unwrap();
                halted(&mut d);
                for refill in [15, 25] {
                    let p = reply(&mut d, refill, Some(refill));
                    refused(&mut d, "observe_store", &p);
                    refused(&mut d, "apply", &p);
                }
                h.close(&name, d);
                let mut d = h.open(&name, None).unwrap();
                halted(&mut d);
                assert_eq!(d.state().unwrap().0, 5);
            }
        }
    }
}
both!(private_cursor_restore_is_durable_through_refill, cursor_restore);

fn image_restore<H: Host>(h: &mut H) {
    for snapshot in [false, true] {
        for reopen in [false, true] {
            for op in ["observe_store", "apply"] {
                let name = format!("image-{snapshot}-{reopen}-{op}");
                let mut d = fixture(h, &name, snapshot);
                if reopen { h.close(&name, d); d = h.open(&name, None).unwrap(); }
                // No lower cursor was ever observed: 15 exceeds both 5 and 10,
                // but cannot include the images read at 20. Reopened snapshots
                // restart from the published cut, so explicitly probe their
                // still-durable private cut as a preflight response.
                let mut p = reply(&mut d, 15, Some(15));
                if snapshot && reopen { p.requested_watermark = Some(10); }
                refused(&mut d, op, &p);
                h.close(&name, d);
                let mut d = h.open(&name, None).unwrap();
                halted(&mut d);
                let p = reply(&mut d, 25, Some(25));
                refused(&mut d, "apply", &p);
                assert_eq!(d.state().unwrap().0, 5);
            }
        }
    }
}
both!(private_image_head_survives_reopen_before_first_restore_observation, image_restore);

fn halt_lifetime<H: Host>(h: &mut H) {
    let name = "halt-lifetime";
    let mut d = fixture(h, name, false);
    let p = reply(&mut d, 7, Some(7));
    refused(&mut d, "observe_store", &p);
    let mut omitted = reply(&mut d, 1, Some(1));
    omitted.store_id = None;
    refused(&mut d, "observe_store", &omitted);
    refused(&mut d, "apply", &omitted);
    d.clear_rows().unwrap();
    let (_, backend) = compile(SOURCE);
    d.adopt(backend.clone()).unwrap();
    h.close(name, d);
    let mut d = h.open(name, Some(backend.clone())).unwrap();
    halted(&mut d);
    let mut replacement = reply(&mut d, 1, Some(1));
    replacement.store_id = Some("T".into());
    assert!(d.observe_store(&replacement).unwrap().reset);
    assert!(d.sync_state_read().unwrap().restore_refusal.is_none());
    d.adopt(backend).unwrap();
    let mut replacement = reply(&mut d, 1, Some(1));
    replacement.store_id = Some("T".into());
    assert!(d.apply_publication(&replacement, false).unwrap().1);
    assert!(d.begin_send().is_ok());
}
both!(only_an_explicit_new_incarnation_releases_the_restore_halt, halt_lifetime);

fn healthy_and_stale<H: Host>(h: &mut H) {
    for snapshot in [false, true] {
        let name = format!("healthy-{snapshot}");
        let mut d = fixture(h, &name, snapshot);
        let mut stale = reply(&mut d, 7, Some(7));
        stale.requested_watermark = Some(5);
        assert!(d.observe_store(&stale).is_ok(), "an obsolete transfer response is not restore evidence");
        assert_eq!(d.apply(&stale, false).unwrap_err().refusal().code, "E_GENERATION");
        assert!(d.sync_state_read().unwrap().restore_refusal.is_none());
        let mut p = reply(&mut d, 12, Some(20));
        p.committed_above.insert("q".into(), 20);
        assert!(!d.apply_publication(&p, false).unwrap().1, "a truncated cut below the old head is healthy");
        let mut p = reply(&mut d, 20, Some(20));
        p.acknowledged.insert("q".into(), 20);
        assert!(d.apply_publication(&p, false).unwrap().1);
        assert_eq!(value(&mut d, "a"), Some(99));
        assert_eq!(d.state().unwrap().0, 20);
        for key in ["device:deferred:images_at", "device:snapshot:images_at"] { assert!(d.store().meta(key).unwrap().is_none(), "publication consumes {key}"); }
        h.close(&name, d);
        let mut d = h.open(&name, None).unwrap();
        assert!(d.sync_state_read().unwrap().restore_refusal.is_none());
        assert_eq!(value(&mut d, "a"), Some(99));
    }
}
both!(healthy_pagination_and_stale_responses_do_not_report_restore, healthy_and_stale);

fn capped_dequeue<H: Host>(h: &mut H) {
    let (_, mut d) = setup(h);
    for i in 0..257 { admit(&mut d, &format!("w{i}"), "bump", json!({"k":if i == 256 { "a" } else { "b" }})); }
    let mut p = reply(&mut d, 6, Some(6));
    p.store_id = None;
    assert_eq!((p.pending_through, p.pending_complete, p.pending_bound), (Some(256), Some(false), Some(257)));
    p.events = serde_json::from_value(json!([{"table":"counters","kind":"put","id":"a","data":{"id":"a","n":3}}])).unwrap();
    d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(3));
    d.dequeue("w256").unwrap();
    assert_eq!(value(&mut d, "a"), Some(3), "withdrawing an excluded write must keep its published image");
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(3));
}
both!(capped_dequeue_keeps_the_published_image, capped_dequeue);

fn first_private_identity<H: Host>(h: &mut H) {
    let (_, backend) = compile(SOURCE);
    let mut d = h.open("first-private", Some(backend)).unwrap();
    let mut p = reply(&mut d, 10, Some(10));
    p.snapshot = true; p.stage_snapshot = true;
    assert!(!d.apply_publication(&p, true).unwrap().1);
    assert!(d.sync_state_read().unwrap().store_id.is_none());
    let p = reply(&mut d, 7, Some(7));
    refused(&mut d, "observe_store", &p);
    h.close("first-private", d);
    let mut d = h.open("first-private", None).unwrap();
    halted(&mut d);
}
both!(first_private_identity_already_owns_its_restore_evidence, first_private_identity);

fn invalid_progress<H: Host>(h: &mut H) {
    let mut d = fixture(h, "invalid-progress", false);
    let mut invalid = reply(&mut d, 11, Some(200));
    invalid.committed_above.insert("q".into(), 200);
    invalid.events = serde_json::from_value(json!([{"table":"counters","kind":"put","id":"a","data":{"id":"different","n":99}}])).unwrap();
    d.observe_store(&invalid).unwrap();
    assert!(d.apply(&invalid, false).is_err());
    assert_eq!(d.sync_state_read().unwrap().transfer_watermark, 10);
    let mut healthy = reply(&mut d, 20, Some(20));
    healthy.acknowledged.insert("q".into(), 20);
    assert!(d.apply_publication(&healthy, false).unwrap().1, "a refused page cannot raise durable restore evidence to 200");
    h.close("invalid-progress", d);
    let mut d = h.open("invalid-progress", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(99));
    assert!(d.sync_state_read().unwrap().restore_refusal.is_none());
}
both!(only_validated_pages_advance_private_restore_evidence, invalid_progress);
