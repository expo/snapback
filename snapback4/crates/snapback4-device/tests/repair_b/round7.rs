//! Request, receipt and snapshot lifetimes at durable boundaries.
use super::*;

#[test]
fn teardown_loses_send_revision_after_durable_admission() {
    for legacy in [false, true] {
        for persist_send in [false, true] {
            let mut h = Memory::new();
            let (mut e, mut d) = setup(&mut h);
            assert!(d.sync_state().unwrap().pending_ids.is_empty());
            admit(&mut d, "q", "bump", json!({"k":"a"}));
            checkpoint(&mut h, "repair", &d); // capture AND admission durable
            let durable_revision = d.sync_state_read().unwrap().send_revision;
            d.begin_send().unwrap();
            let committed = bump(&mut e, "q", "a", "dev:alice");
            if persist_send { checkpoint(&mut h, "repair", &d); }
            drop(d); // no host drain: lose the teardown's revision batch
            let mut d = h.open("repair", None).unwrap();
            let recovered_revision = d.sync_state_read().unwrap().send_revision;
            let mut page = next(&mut e, &mut d, 100);
            assert!(!page.more);
            if legacy { page.images_at = None; page.committed_above.clear(); }
            d.apply(&page, false).unwrap();
            let n = value(&mut d, "a");
            h.close("repair", d);
            let mut d = h.open("repair", None).unwrap();
            let reopened = value(&mut d, "a");
            println!("teardown legacy={legacy} persist_send={persist_send}: server=1 device={n:?} reopened={reopened:?}");
            assert_eq!((n, reopened), (Some(1), Some(1)));
            assert_eq!(page.acknowledged.get("q"), Some(&committed), "recovery must declare the durably admitted write");
            assert_eq!(recovered_revision, durable_revision + u64::from(persist_send) + 1);
        }
    }
}

fn receipt_withdrawal<H: Host>(h: &mut H) {
    for outcome in [None, Some(10)] {
        let (_, mut d) = setup(h);
        admit(&mut d, "q", "bump", json!({"k":"a"}));
        admit(&mut d, "survivor", "bump", json!({"k":"a"}));
        assert_eq!(value(&mut d, "a"), Some(2));
        h.close("repair", d);
        let mut d = h.open("repair", None).unwrap();
        d.settle("q", outcome).unwrap();
        let expected = if outcome.is_some() { 2 } else { 1 };
        assert_eq!(value(&mut d, "a"), Some(expected));
        assert_eq!(d.queued().unwrap().len(), expected as usize);
        h.close("repair", d);
        let mut d = h.open("repair", None).unwrap();
        assert_eq!(value(&mut d, "a"), Some(expected));
        // Undo must still point to the original confirmed value after replay.
        d.dequeue("survivor").unwrap();
        if outcome.is_some() { d.dequeue("q").unwrap(); }
        assert_eq!(value(&mut d, "a"), Some(0));
        h.close("repair", d);
    }
}
stores!(receipt_arms_restore_before_replaying_relative_survivors, receipt_withdrawal);

fn anonymous_receipt<H: Host>(h: &mut H) {
    for old_null_binding in [false, true] {
        let (mut e, b) = compile(SOURCE);
        e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
        let name = if old_null_binding { "old-null" } else { "unbound" };
        let mut d = h.open(name, Some(b)).unwrap();
        let seq = bump(&mut e, "q", "a", "dev:alice");
        // A durable write can settle before the first partition acquisition.
        let mut q: Queued = serde_json::from_value(json!({"id":"q","seq":1,"op":"bump","args":{"k":"a"},"viewer":"dev:alice","predictable":true})).unwrap();
        if old_null_binding {
            q.sent_seq = Some(seq);
            q.receipt_store = Some(snapback4_device::device::ReceiptStore { id: None });
        }
        d.enqueue(&q).unwrap();
        if !old_null_binding {
            d.settle("q", Some(seq)).unwrap();
            assert!(d.queued().unwrap()[0].receipt_store.is_none(), "no identity is an unbound receipt");
        }
        h.close(name, d);
        let mut d = h.open(name, None).unwrap();
        let mut page = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
        page.store_id = Some("S".into());
        page.acknowledged.insert("q".into(), seq);
        d.apply(&page, true).unwrap();
        assert!(d.queued().unwrap().is_empty(), "first real identity must rebind and retire q");
        assert_eq!(value(&mut d, "a"), Some(1));
        h.close(name, d);
        let mut d = h.open(name, None).unwrap();
        assert_eq!(value(&mut d, "a"), Some(1));
        assert_eq!(d.sync_state_read().unwrap().store_id.as_deref(), Some("S"));
    }
}
stores!(receipt_without_identity_rebinds_on_first_real_store, anonymous_receipt);

fn snapshot_events<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    let mut snapshot = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    snapshot.stage_snapshot = true;
    d.apply(&snapshot, true).unwrap();
    bump(&mut e, "external", "a", "dev:bob");
    e.mutate("replace", Some("external-c"), context("dev:bob", &[("k", id("c")), ("n", Value::Int(7))])).unwrap();
    admit(&mut d, "q", "pair", json!({}));
    d.begin_send().unwrap();
    e.mutate("pair", Some("q"), context("dev:alice", &[])).unwrap();
    let mut page = next(&mut e, &mut d, 2);
    page.snapshot_catchup = true;
    assert!(page.more && page.committed_above.contains_key("q"));
    assert!(!d.apply_publication(&page, false).unwrap().1);
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(1), Some(1)));
    assert_eq!(value(&mut d, "c"), None);
    assert!(d.store().meta("device:deferred:acks").unwrap().is_none(), "snapshot pages use snapshot staging, never the ordinary slot");
    let mut page = next(&mut e, &mut d, 100);
    page.snapshot_catchup = true;
    assert!(!page.more && page.acknowledged.contains_key("q"));
    assert!(page.events.iter().any(|event| event.id == "b"));
    assert!(d.apply_publication(&page, false).unwrap().1);
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(2), Some(1)));
    assert_eq!(value(&mut d, "c"), Some(7), "the intermediate page's distinct row must publish too");
    assert!(!d.publication_pending().unwrap());
    assert!(d.queued().unwrap().iter().all(|q| q.observed_seq.is_some()));
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(2), Some(1)));
    assert_eq!(value(&mut d, "c"), Some(7));
}
stores!(snapshot_catchup_installs_intermediate_and_terminal_events, snapshot_events);

fn slot_disposes_replacement<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    bump(&mut e, "external", "a", "dev:bob");
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let committed = bump(&mut e, "q", "a", "dev:alice");
    let page = next(&mut e, &mut d, 1);
    assert!(!d.apply_publication(&page, false).unwrap().1);
    let before = d.state().unwrap().0;
    let slot = d.store().meta("device:deferred:acks").unwrap();
    let mut pages = snapshot_pages(&mut e, "dev:alice", 1);
    for (i, snapshot) in pages.iter_mut().enumerate() {
        snapshot.stage_snapshot = true;
        snapshot.requested_watermark = Some(0);
        if i == 0 {
            let mut invalid = snapshot.clone();
            invalid.events[0].table = "missing".into();
            assert!(d.apply(&invalid, true).is_err());
            assert_eq!(d.store().meta("device:deferred:acks").unwrap(), slot, "failed replacement preserves the slot");
        }
        assert!(!d.apply_publication(snapshot, i == 0).unwrap().1);
        assert_eq!(d.state().unwrap().0, before);
        assert!(d.store().meta("device:deferred:acks").unwrap().is_none());
        assert!(d.queued().unwrap()[0].observed_seq.is_none());
        assert_eq!(value(&mut d, "a"), Some(1));
    }
    let mut page = next(&mut e, &mut d, 100);
    page.snapshot_catchup = true;
    assert!(d.apply_publication(&page, false).unwrap().1);
    assert_eq!(value(&mut d, "a"), Some(2));
    assert_eq!(d.queued().unwrap()[0].observed_seq, Some(committed));
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(2));
    assert!(!d.publication_pending().unwrap());
}
stores!(snapshot_disposes_an_advanced_ordinary_slot, slot_disposes_replacement);
