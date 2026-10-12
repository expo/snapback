//! Round 3: capture/observation authority and interrupted private acquisition.
use super::*;
macro_rules! resumption_stores { ($name:ident, $f:ident) => {
    mod $name {
        use super::*;
        #[test] fn memory() { $f(&mut Memory::new()); }
        #[test] fn sqlite() { $f(&mut Sqlite::new(stringify!($name))); }
    }
} }

fn send_restart<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(7))]))]).unwrap();
    let mut d = h.open("restart", Some(b)).unwrap();
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = Some("store".into()); p.stage_snapshot = true; p.more = true; p.next = Some("continuation".into());
    d.observe_store(&p).unwrap(); d.apply(&p, true).unwrap();
    let interrupted = d.sync_state().unwrap();
    assert!(!interrupted.snapshot_catchup);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    d.begin_send().unwrap();
    let seq = bump(&mut e, "q", "a", "dev:alice");
    d.settle("q", Some(seq)).unwrap();
    for _ in 0..3 {
        let resumed = d.sync_state().unwrap();
        assert!(!resumed.snapshot_catchup, "an invalid snapshot must select a restart");
        assert_eq!(resumed.transfer_watermark, 0);
        assert_eq!(resumed.transfer_store_id.as_deref(), Some("store"));
    }
    assert!(!d.publication_pending().unwrap());
    let state = d.sync_state().unwrap();
    p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = state.transfer_store_id; p.send_revision = Some(state.send_revision);
    p.requested_watermark = Some(state.transfer_watermark); p.captured_watermark = Some(state.watermark);
    d.observe_store(&p).unwrap(); d.apply(&p, !state.snapshot_catchup).unwrap();
    assert_eq!(value(&mut d, "a"), Some(8));
    assert!(d.queued().unwrap().is_empty());
    h.close("restart", d);
    let mut d = h.open("restart", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(8));
    assert!(!d.sync_state().unwrap().snapshot_catchup);
}
resumption_stores!(sending_during_interrupted_snapshot_selects_a_restart, send_restart);

fn private_adoption<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(7))]))]).unwrap();
    let mut d = h.open("adoption", Some(b.clone())).unwrap();
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = Some("store".into()); p.stage_snapshot = true;
    d.observe_store(&p).unwrap(); d.apply(&p, true).unwrap();
    let state = d.sync_state().unwrap();
    assert_eq!(state.store_id, None);
    assert_eq!(state.transfer_store_id.as_deref(), Some("store"));
    let mut backend = b; backend.generation += 1;
    let wrong = snapback4_device::call::call(&mut d, json!({"op":"adopt", "backend":backend,
        "store_id":state.transfer_store_id, "send_revision":state.send_revision}));
    assert!(wrong.get("denied").is_some(), "transfer identity is not the published compare-and-swap: {wrong}");
    let right = snapback4_device::call::call(&mut d, json!({"op":"adopt", "backend":backend,
        "store_id":state.store_id, "send_revision":state.send_revision}));
    assert!(right.get("denied").is_none(), "{right}");
    assert!(!d.publication_pending().unwrap());
    p.generation = Some(backend.generation); p.stage_snapshot = false;
    d.apply(&p, true).unwrap();
    assert_eq!(value(&mut d, "a"), Some(7));
    assert_eq!(d.sync_state().unwrap().store_id.as_deref(), Some("store"));
}
resumption_stores!(generation_adoption_compares_published_identity, private_adoption);

fn private_replacement<H: Host>(h: &mut H) {
    let (_, b) = compile(SOURCE);
    let mut d = h.open("private-replace", Some(b.clone())).unwrap();
    // Unacquired writes queue without a prediction, so this gap-bearing partial
    // page uses a restored predictable outbox entry to exercise private folding.
    let q = Queued { upload: None, id:"q".into(), seq:1, op:"bump".into(), args:json!({"k":"a"}), new_ids:vec![],
        predicted:vec![], viewer:"dev:alice".into(), now:100, predictable:true,
        sent_seq:None, receipt_store:None, observed_seq:None, dispatch: None };
    d.enqueue(&q).unwrap(); d.sync_state().unwrap();
    let p: StreamPage = serde_json::from_value(json!({"snapshot":false,"store_id":"A","watermark":1,"more":true,"images_at":2,"committed_above":{"q":2},
        "events":[{"table":"counters","kind":"put","id":"a","data":{"id":"a","n":7}}]})).unwrap();
    d.observe_store(&p).unwrap(); d.apply(&p, false).unwrap();
    assert!(d.publication_pending().unwrap());
    assert_eq!(d.sync_state().unwrap().store_id, None);
    d.settle("q", Some(2)).unwrap();
    let mut replacement = p.clone(); replacement.store_id = Some("B".into()); replacement.events.clear();
    let observation = d.observe_store(&replacement).unwrap();
    assert!(observation.reset, "a different private transfer is occupied state");
    assert_eq!(observation.retired.get("q"), Some(&2));
    assert!(d.queued().unwrap().is_empty());
    d.adopt(b).unwrap();
    replacement.more = false; replacement.images_at = Some(replacement.watermark); replacement.committed_above.clear();
    d.apply(&replacement, false).unwrap();
    assert_eq!(value(&mut d, "a"), None, "A's private row must never publish under B");
    h.close("private-replace", d);
    let mut d = h.open("private-replace", None).unwrap();
    assert_eq!(value(&mut d, "a"), None);
    assert_eq!(d.sync_state().unwrap().store_id.as_deref(), Some("B"));
}
resumption_stores!(replacement_before_first_publication_discards_private_incarnation, private_replacement);

fn dropped_observation<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    let initial = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let seq = bump(&mut e, "q", "a", "dev:alice");
    let p = next(&mut e, &mut d, 100); d.apply(&p, false).unwrap();
    assert_eq!(d.queued().unwrap()[0].observed_seq, Some(seq));
    d.clear_rows().unwrap();
    assert_eq!(d.queued().unwrap()[0].observed_seq, None);
    assert_eq!(d.queued().unwrap()[0].sent_seq, Some(seq), "execution evidence survives dropping its images");
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    // A fresh acquisition without an acknowledgement must rebuild the pending
    // overlay; the discarded publication is no longer authority to skip it.
    d.apply(&initial, true).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    assert!(d.queued().unwrap()[0].observed_seq.is_none());
    let mut replacement = initial; replacement.store_id = Some("replacement".into());
    let observation = d.observe_store(&replacement).unwrap();
    assert_eq!(observation.retired.get("q"), Some(&seq), "a later replacement cannot resend the known execution");
    assert!(d.queued().unwrap().is_empty());
}
resumption_stores!(dropping_images_invalidates_published_observations, dropped_observation);

fn malformed_terminal<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    bump(&mut e, "other", "b", "dev:bob"); bump(&mut e, "q", "a", "dev:alice");
    let mut p = next(&mut e, &mut d, 1); assert!(p.more);
    p.more = false;
    let before = d.state().unwrap();
    assert!(d.apply(&p, false).unwrap_err().to_string().contains("terminal stream page"));
    assert_eq!(d.state().unwrap(), before);
    assert!(!d.publication_pending().unwrap());
    p.more = true; d.apply(&p, false).unwrap();
    let p = next(&mut e, &mut d, 100); d.apply(&p, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
}
resumption_stores!(malformed_terminal_page_cannot_create_a_permanent_deferral, malformed_terminal);

fn known_receipt_replacement<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
    let mut d = h.open("known-receipt", Some(b.clone())).unwrap();
    let mut initial = snapshot_pages(&mut e,"dev:alice",100).remove(0);
    initial.store_id=Some("A".into()); d.apply(&initial,true).unwrap();
    admit(&mut d,"q","bump",json!({"k":"a"}));
    let mut staged=initial.clone(); staged.stage_snapshot=true; d.apply(&staged,true).unwrap();
    let seq=bump(&mut e,"q","a","dev:alice");
    d.settle("q",Some(seq)).unwrap();
    assert!(d.publication_pending().unwrap());
    assert!(seq>d.state().unwrap().0);
    let mut replacement=initial; replacement.store_id=Some("B".into());
    let observation=d.observe_store(&replacement).unwrap();
    assert_eq!(observation.retired.get("q"),Some(&seq));
    assert!(d.queued().unwrap().is_empty());
    d.adopt(b).unwrap(); d.apply(&replacement,true).unwrap();
    assert_eq!(value(&mut d,"a"),Some(0));
    h.close("known-receipt",d); let mut d=h.open("known-receipt",None).unwrap();
    assert!(d.queued().unwrap().is_empty());
}
resumption_stores!(replacement_retires_known_receipt_above_private_snapshot_cut, known_receipt_replacement);

fn unrelated_receipt<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d,"q","bump",json!({"k":"a"}));
    let mut q=d.queued().unwrap().remove(0);
    q.sent_seq=Some(1);
    q.receipt_store=Some(snapback4_device::device::ReceiptStore{id:Some("unrelated".into()), success_seq: None});
    d.dequeue("q").unwrap(); d.enqueue(&q).unwrap();
    let mut p=snapshot_pages(&mut e,"dev:alice",100).remove(0); p.store_id=Some("replacement".into());
    let observation=d.observe_store(&p).unwrap();
    assert!(observation.retired.is_empty(), "only the discarded incarnation can retire its receipts");
    d.adopt(d.backend()).unwrap(); d.apply(&p,true).unwrap();
    assert_eq!(d.queued().unwrap().len(),1);
    assert_eq!(d.queued().unwrap()[0].receipt_store.as_ref().unwrap().id.as_deref(),Some("unrelated"));
}
resumption_stores!(unrelated_receipt_cannot_be_retired_by_replacement_watermark, unrelated_receipt);
