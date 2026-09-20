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
        "captured_restore_watermark":capture.restore_watermark,"captured_restore_images_at":capture.restore_images_at,
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
        stale.captured_restore_watermark = Some(5);
        stale.captured_restore_images_at = Some(0);
        assert_eq!(d.observe_store(&stale).unwrap_err().refusal().code, "E_GENERATION", "an obsolete transfer response must not authorize action");
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

// Round 10: requests own their evidence even while another call advances it.
fn captured_private_evidence<H: Host>(h: &mut H) {
    for snapshot in [false, true] {
        for head in [7, 15, 20] {
            let name = format!("captured-{snapshot}-{head}");
            let mut d = fixture(h, &name, snapshot);
            let old = reply(&mut d, head, Some(head));
            let before = d.sync_state_read().unwrap();
            let mut advance = reply(&mut d, 12, Some(if head == 20 { 25 } else { 20 }));
            advance.committed_above.insert("q".into(), 20);
            assert!(!d.apply_publication(&advance, false).unwrap().1);
            let after = d.sync_state_read().unwrap();
            assert_eq!((before.watermark, before.send_revision), (after.watermark, after.send_revision));
            assert_eq!(after.restore_watermark, 12);
            let code = d.observe_store(&old).unwrap_err().refusal().code;
            if head < 20 {
                assert_eq!(code, "E_STORE_RESTORE", "private progress cannot erase captured evidence");
                h.close(&name, d);
                let mut d = h.open(&name, None).unwrap();
                halted(&mut d);
                let refill = reply(&mut d, 25, Some(25));
                refused(&mut d, "apply", &refill);
            } else {
                assert_eq!(code, "E_GENERATION", "new evidence must fence, never condemn, a healthy older reply");
                assert!(d.sync_state_read().unwrap().restore_refusal.is_none());
                let mut refill = reply(&mut d, 25, Some(25));
                refill.acknowledged.insert("q".into(), 20);
                assert!(d.apply_publication(&refill, false).unwrap().1);
                assert_eq!(value(&mut d, "a"), Some(99));
            }
        }
    }
}
both!(round10_request_owns_private_restore_evidence, captured_private_evidence);

fn image_only_evidence<H: Host>(h: &mut H) {
    let mut d = fixture(h, "image-only", false);
    let old = reply(&mut d, 20, Some(20));
    let mut advance = reply(&mut d, 10, Some(25));
    advance.committed_above.insert("q".into(), 20);
    assert!(!d.apply_publication(&advance, false).unwrap().1);
    assert_eq!(d.sync_state_read().unwrap().restore_watermark, 10);
    assert_eq!(d.observe_store(&old).unwrap_err().refusal().code, "E_GENERATION");
    assert!(d.sync_state_read().unwrap().restore_refusal.is_none());
}
both!(round10_image_head_only_advance_fences_without_false_restore, image_only_evidence);

fn adoption_evidence<H: Host>(h: &mut H) {
    for overlap in [false, true] {
        let name = format!("adoption-{overlap}");
        let mut d = fixture(h, &name, false);
        let probe = reply(&mut d, 20, Some(20));
        let capture = d.observe_store(&probe).unwrap();
        if overlap {
            let mut advance = reply(&mut d, 12, Some(20));
            advance.committed_above.insert("q".into(), 20);
            assert!(!d.apply_publication(&advance, false).unwrap().1);
        }
        let (_, mut backend) = compile(SOURCE);
        backend.generation = 2;
        let reply = snapback4_device::call::call(&mut d, json!({"op":"adopt", "backend":backend, "adoption_capture":capture.adoption_capture}));
        if overlap {
            assert!(reply.get("denied").is_some(), "adoption must compare schema-request evidence: {reply}");
            assert_eq!(d.state().unwrap(), (5, 1));
            assert_eq!(d.sync_state_read().unwrap().restore_watermark, 12);
            h.close(&name, d);
            let mut d = h.open(&name, None).unwrap();
            assert_eq!(d.state().unwrap(), (5, 1));
            assert_eq!(d.sync_state_read().unwrap().restore_watermark, 12);
        } else {
            assert!(reply.get("denied").is_none(), "unchanged capture permits adoption: {reply}");
            assert_eq!(d.state().unwrap().1, 2);
        }
    }
}
both!(round10_schema_adoption_compares_request_progress_atomically, adoption_evidence);

fn declaration_overlap<H: Host>(h: &mut H) {
    let mut d = fixture(h, "declaration-overlap", false);
    let old = reply(&mut d, 15, Some(15));
    let mut advance = reply(&mut d, 12, Some(20));
    advance.committed_above.insert("q".into(), 20);
    assert!(!d.apply_publication(&advance, false).unwrap().1);
    admit(&mut d, "later", "bump", json!({"k":"b"}));
    let newer = d.sync_state().unwrap();
    assert_eq!(old.send_revision, Some(newer.send_revision));
    assert_ne!(old.pending_through, Some(newer.pending_through));
    refused(&mut d, "observe_store", &old);
    halted(&mut d);
}
both!(round10_later_declaration_cannot_erase_captured_restore_proof, declaration_overlap);

fn replacement_restore_evidence<H: Host>(h: &mut H) {
    let mut d = fixture(h, "replacement-head", false);
    for _ in 0..2 {
        let mut page = reply(&mut d, 15, None);
        page.snapshot = true; page.stage_snapshot = true;
        page.requested_watermark = Some(0); page.more = true;
        page.next = Some("continuation".into());
        assert!(!d.apply_publication(&page, true).unwrap().1);
        assert!(d.store().meta("device:deferred:acks").unwrap().is_none());
        assert_eq!(d.sync_state_read().unwrap().restore_images_at, 20);
        assert_eq!(value(&mut d, "b"), Some(1));
        h.close("replacement-head", d);
        d = h.open("replacement-head", None).unwrap();
    }
    // Restarting a snapshot cannot erase the head known before disposal.
    let page = reply(&mut d, 15, Some(15));
    refused(&mut d, "observe_store", &page);
    halted(&mut d);
}
both!(replacement_and_reopen_preserve_disposed_image_head, replacement_restore_evidence);

// Trusted-server evidence fixture; the HTTP suite measures the real byte overflow.
fn recovery_metadata<S: DeviceStore>(d: &mut Device<S>, head: u64) -> serde_json::Value {
    let s = d.sync_state().unwrap();
    json!({"op":"sync_metadata","capture":{
        "store_id":s.transfer_store_id,"generation":s.generation,"send_revision":s.send_revision,
        "captured_watermark":s.transfer_watermark,"published_watermark":s.watermark,
        "captured_restore_watermark":s.restore_watermark,"captured_restore_images_at":s.restore_images_at,
        "from":s.transfer_watermark,"stream":true,"recover":true,"limit":1
    },"metadata":{"metadata":true,"store_id":"S","generation":1,"watermark":head,
        "recovery":{"from":s.transfer_watermark,"snapshot":true,"store_id":"S","generation":1,
            "limit":1,"stream":true,"send_revision":s.send_revision,"single_commit":true,
            "commit":s.transfer_watermark + 1,"measured_head":head}}})
}

fn measured_deferred_recovery<H: Host>(h: &mut H) {
    let mut d = fixture(h, "measured-deferred", false);
    d.settle("q", Some(20)).unwrap();
    let request = recovery_metadata(&mut d, 20);
    for field in ["from", "captured_watermark", "published_watermark", "limit", "captured_restore_images_at"] {
        let mut bad = request.clone();
        bad["capture"][field] = json!(if field == "captured_restore_images_at" { 0 } else { 999 });
        assert_eq!(snapback4_device::call::call(&mut d, bad)["denied"]["code"], "E_GENERATION", "{field}");
        assert_eq!(d.state().unwrap().0, 5);
        assert_eq!(value(&mut d, "a"), Some(5));
        assert_eq!(value(&mut d, "b"), Some(1));
    }
    let accepted = snapback4_device::call::call(&mut d, request.clone());
    assert_eq!(accepted["ok"]["snapshot"], true, "{accepted}");
    assert_eq!(d.predict("bump", "dev:alice", &json!({"k":"b"}), 100, vec![], 1).unwrap_err().refusal().code, "E_PREDICT");
    d.settle("q", Some(20)).unwrap(); // Receipt arrival must still replay the existing overlay.
    assert_eq!(d.queued().unwrap().len(), 1, "a live prediction's known receipt cannot retire before its image");
    assert_eq!(value(&mut d, "a"), Some(5));
    assert_eq!(value(&mut d, "b"), Some(1));
    assert_eq!(d.sync_state_read().unwrap().transfer_watermark, 10, "grant alone does not dispose private effects");
    assert_eq!(snapback4_device::call::call(&mut d, request)["denied"]["code"], "E_GENERATION");
    h.close("measured-deferred", d);
    let mut d = h.open("measured-deferred", None).unwrap();
    assert_eq!(d.sync_state_read().unwrap().snapshot_required, Some(true));
    assert_eq!(d.queued().unwrap().len(), 1);
    assert_eq!(value(&mut d, "b"), Some(1));
}
both!(measured_recovery_fences_private_and_published_cuts_without_retiring_predictions, measured_deferred_recovery);

fn metadata_restore<H: Host>(h: &mut H) {
    let mut d = fixture(h, "metadata-restore", false);
    let request = recovery_metadata(&mut d, 15); // Above both cursors, below the retained image head.
    assert_eq!(snapback4_device::call::call(&mut d, request)["denied"]["code"], "E_STORE_RESTORE");
    halted(&mut d);
    h.close("metadata-restore", d);
    let mut d = h.open("metadata-restore", None).unwrap();
    halted(&mut d);
}
both!(measured_metadata_retains_repair_b_restore_evidence, metadata_restore);
