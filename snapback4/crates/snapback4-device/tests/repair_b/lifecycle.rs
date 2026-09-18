//! Full lifecycle regressions; each probe runs on both durable hosts.
use super::*;

fn reset_keys<H: Host>(h: &mut H, mode: &str) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    bump(&mut e, "other", "b", "dev:bob");
    bump(&mut e, "q", "a", "dev:alice");
    let p = next(&mut e, &mut d, 1);
    d.apply(&p, false).unwrap();
    assert!(d.publication_pending().unwrap());
    d.sync_state().unwrap(); // Occupy capture as well as the deferred slot.
    let mut b = if mode.ends_with("keep") { compile(&SOURCE.replace("  n: int", "  n: int\n  added: int default 0")).1 } else { d.backend() };
    b.generation = d.backend().generation + 1;
    if mode.ends_with("drop") { b.schema.tables.clear(); b.programs.clear(); }
    let guard = d.store().meta("device:declaration:published").unwrap();
    match mode {
        "clear" => d.clear_rows().unwrap(),
        "adopt-keep" | "adopt-drop" => d.adopt(b).unwrap(),
        "open-keep" | "open-drop" => { h.close("repair", d); d = h.open("repair", Some(b)).unwrap(); }
        _ => unreachable!(),
    }
    for key in ["device:deferred:cursor", "device:deferred:meta", "device:deferred:acks", "device:declaration:capture", "device:declaration:first-capture"] {
        assert_eq!(d.store().meta(key).unwrap(), None, "{mode}: {key}");
    }
    assert_eq!(d.store().meta("device:declaration:published").unwrap(), if mode.ends_with("keep") { guard } else { None }, "{mode}");
    let state = d.sync_state().unwrap();
    assert_eq!((state.watermark, state.transfer_watermark, state.snapshot_catchup), (0, 0, false));
    assert!(!d.publication_pending().unwrap());
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(d.sync_state().unwrap().transfer_watermark, 0);
    assert!(d.queued().unwrap().iter().any(|q| q.id == "q"));
}
#[test]
fn every_reset_clears_one_publication_state() {
    for mode in ["clear", "adopt-keep", "adopt-drop", "open-keep", "open-drop"] {
        reset_keys(&mut Memory::new(), mode);
        reset_keys(&mut Sqlite::new(mode), mode);
    }
}

fn immutable_capture<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "A", "bump", json!({"k":"a"}));
    let mut first = next(&mut e, &mut d, 100);
    first.pending_through = None; first.pending_complete = None; first.pending_bound = None;
    admit(&mut d, "B", "bump", json!({"k":"b"}));
    let second = d.sync_state().unwrap();
    assert_eq!(second.pending_ids, ["A"], "status/retry must return the in-flight request's declaration");
    assert_eq!((second.pending_through, second.pending_bound), (1, 1));
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(d.sync_state().unwrap().pending_ids, ["A"]);
    d.apply(&first, false).unwrap();
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(1), Some(1)));
    assert_eq!(d.sync_state().unwrap().pending_ids, ["A", "B"]);
}
stores!(un_echoed_response_keeps_its_request_capture_across_poll_and_reopen, immutable_capture);

fn empty_capture<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    let mut first = next(&mut e, &mut d, 100);
    first.pending_through = None; first.pending_complete = None; first.pending_bound = None;
    admit(&mut d, "later", "bump", json!({"k":"a"}));
    assert!(d.sync_state().unwrap().pending_ids.is_empty());
    d.apply(&first, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    assert_eq!(d.sync_state().unwrap().pending_ids, ["later"]);
    d.begin_send().unwrap(); // Its eventual rejection, not the send, consumes this request.
    assert!(d.store().meta("device:declaration:capture").unwrap().is_some());
}
stores!(empty_capture_ends_when_its_response_applies, empty_capture);

fn foreign_receipt<H: Host>(h: &mut H, legacy: bool) {
    let (mut e, b) = compile(SOURCE);
    e.seed(["a", "b"].map(|k| ("counters".into(), object([("id", id(k)), ("n", Value::Int(0))])))).unwrap();
    let mut d = h.open("receipt", Some(b.clone())).unwrap();
    let mut initial = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    initial.store_id = Some("old".into());
    d.observe_store(&initial).unwrap(); d.apply(&initial, true).unwrap();
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    bump(&mut e, "other", "b", "dev:bob");
    let receipt = bump(&mut e, "q", "a", "dev:alice");
    let mut p = next(&mut e, &mut d, 1); p.store_id = Some("old".into());
    d.apply(&p, false).unwrap(); d.settle("q", Some(receipt)).unwrap();
    assert_eq!(d.queued().unwrap()[0].receipt_store.as_ref().and_then(|store| store.id.as_deref()), Some("old"));
    if legacy {
        let mut q = d.queued().unwrap().remove(0);
        q.receipt_store = None; // The checkpoint's implicit receipt representation.
        d.dequeue("q").unwrap(); d.enqueue(&q).unwrap();
    }
    let mut replacement = initial.clone(); replacement.store_id = Some("new".into()); replacement.watermark = receipt;
    let observation = d.observe_store(&replacement).unwrap();
    assert!(observation.reset);
    assert_eq!(observation.retired.get("q"), Some(&receipt), "replacement retires all known old-store executions");
    d.adopt(b).unwrap(); d.apply(&replacement, true).unwrap();
    assert_eq!(value(&mut d, "a"), Some(0));
    assert!(d.queued().unwrap().is_empty());
    h.close("receipt", d);
    let mut d = h.open("receipt", None).unwrap();
    assert!(d.queued().unwrap().is_empty());
    let mut third = replacement; third.store_id = Some("third".into());
    assert!(d.observe_store(&third).unwrap().retired.is_empty());
}
fn bound_receipt<H: Host>(h: &mut H) { foreign_receipt(h, false); }
fn legacy_receipt<H: Host>(h: &mut H) { foreign_receipt(h, true); }
stores!(replacement_retires_receipts_of_discarded_private_effects, bound_receipt);
stores!(replacement_binds_checkpoint_receipts_before_reset, legacy_receipt);

fn resume_snapshot<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(7))]))]).unwrap();
    let mut d = h.open("resume", Some(b)).unwrap();
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = Some("store".into()); p.stage_snapshot = true;
    d.observe_store(&p).unwrap(); d.apply(&p, true).unwrap();
    for _ in 0..3 { // Three interrupted rounds build their next request afresh.
        let state = d.sync_state().unwrap();
        assert!(state.snapshot_catchup);
        assert_eq!((state.watermark, state.transfer_watermark), (0, p.watermark));
    }
    let state = d.sync_state().unwrap();
    let mut terminal = stream_page(&mut e, "dev:alice", state.transfer_watermark);
    terminal.store_id = Some("store".into()); terminal.snapshot_catchup = state.snapshot_catchup;
    terminal.requested_watermark = Some(state.transfer_watermark); terminal.captured_watermark = Some(state.watermark);
    terminal.send_revision = Some(state.send_revision);
    d.observe_store(&terminal).unwrap(); d.apply(&terminal, !state.snapshot_catchup).unwrap();
    assert_eq!(value(&mut d, "a"), Some(7));
    assert!(!d.publication_pending().unwrap());
    assert!(!d.sync_state().unwrap().snapshot_catchup);
    h.close("resume", d);
    let mut d = h.open("resume", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(7));
}
stores!(interrupted_snapshot_returns_its_mode_with_its_cursor, resume_snapshot);

fn missing_bound<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    let mut p = stream_page(&mut e, "dev:alice", d.state().unwrap().0);
    p.pending_through = Some(256); p.pending_complete = Some(false); p.pending_bound = None;
    let error = d.apply(&p, false).unwrap_err().to_string();
    assert!(error.contains("incomplete local pending declaration"), "{error}");
}
stores!(incomplete_echo_requires_its_capture_bound, missing_bound);

fn safe_capped<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    for n in 0..257 { admit(&mut d, &format!("q{n}"), "bump", json!({"k":"a"})); }
    bump(&mut e, "other1", "b", "dev:bob"); bump(&mut e, "other2", "b", "dev:bob");
    let p = next(&mut e, &mut d, 1);
    assert!(p.more && p.pending_complete == Some(false) && p.committed_above.is_empty());
    let (_, published) = d.apply_publication(&p, false).unwrap();
    assert!(published, "the undeclared suffix is excluded, not a reason to defer eligible unrelated work");
    assert_eq!(value(&mut d, "a"), Some(256));
    assert_eq!(d.queued().unwrap().len(), 257);
}
stores!(incomplete_declaration_does_not_defer_a_safe_gapped_page, safe_capped);

fn staged_receipt<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
    let mut d = h.open("staged-receipt", Some(b)).unwrap();
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = Some("first".into()); p.stage_snapshot = true;
    d.observe_store(&p).unwrap(); d.apply(&p, true).unwrap();
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    d.begin_send().unwrap();
    let seq = bump(&mut e, "q", "a", "dev:alice");
    d.settle("q", Some(seq)).unwrap();
    assert_eq!(d.queued().unwrap()[0].receipt_store.as_ref().and_then(|store| store.id.as_deref()), Some("first"));
    // Sending invalidated the old snapshot; restart it and publish the effect.
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = Some("first".into());
    d.apply(&p, true).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    assert!(d.queued().unwrap().is_empty());
}
stores!(receipt_during_first_snapshot_binds_its_private_identity, staged_receipt);
