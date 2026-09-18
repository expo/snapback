//! Round 5: request lifetime, snapshot progress and first identity publication.
use super::*;
macro_rules! both { ($name:ident, $body:ident) => {
    mod $name {
        use super::*;
        #[test] fn memory() { $body(&mut Memory::new()); }
        #[test] fn sqlite() { $body(&mut Sqlite::new(stringify!($name))); }
    }
} }

fn legacy_live<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "unsent", "bump", json!({"k":"a"}));
    for round in 0..3 {
        for i in 0..2 { bump(&mut e, &format!("other-{round}-{i}"), "b", "dev:bob"); }
        let mut p = next(&mut e, &mut d, 1);
        p.images_at = None; p.committed_above.clear();
        assert!(p.more);
        assert!(d.apply_publication(&p, false).unwrap().1, "old-server live tails must publish");
        assert_eq!(d.state().unwrap().0, p.watermark);
        assert!(!d.publication_pending().unwrap());
        assert_eq!(value(&mut d, "a"), Some(1));
    }
}
both!(legacy_live_tail_publishes_with_an_unsent_prediction, legacy_live);

fn terminal_send<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let mut snapshot = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    snapshot.stage_snapshot = true;
    assert!(!d.apply_publication(&snapshot, true).unwrap().1);
    let cut = snapshot.watermark;
    let capture = d.sync_state().unwrap();
    assert!(capture.snapshot_catchup);
    d.begin_send().unwrap();
    let resumed = d.sync_state().unwrap();
    assert!(resumed.snapshot_catchup, "send must preserve terminal snapshot catch-up");
    assert_eq!(resumed.transfer_watermark, cut);
    assert_eq!(resumed.pending_ids, capture.pending_ids);
    bump(&mut e, "other-1", "a", "dev:bob");
    bump(&mut e, "other-2", "b", "dev:bob");
    let seq = bump(&mut e, "q", "a", "dev:alice");
    let mut previous = cut;
    for i in 0..3 {
        let mut p = next(&mut e, &mut d, 1); p.snapshot_catchup = true;
        assert_eq!(p.requested_watermark, Some(previous));
        let published = d.apply_publication(&p, false).unwrap().1;
        assert_eq!(published, i == 2);
        assert_eq!(d.sync_state_read().unwrap().transfer_watermark, p.watermark);
        if !published { assert_eq!(value(&mut d, "a"), Some(1)); }
        previous = p.watermark;
    }
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(2), Some(1)));
    assert_eq!(d.queued().unwrap()[0].observed_seq, Some(seq));
    assert!(!d.publication_pending().unwrap());
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(2));
    d.settle("q", Some(seq)).unwrap();
    assert!(d.queued().unwrap().is_empty());
}
both!(send_after_terminal_snapshot_drains_multiple_catchup_pages, terminal_send);

fn replacement_start<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    assert!(d.state().unwrap().0 > 0);
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.requested_watermark = Some(0);
    assert!(d.apply_publication(&p, true).unwrap().1);
    assert_eq!(value(&mut d, "a"), Some(0));
}
both!(replacement_start_is_not_the_ordinary_cursor, replacement_start);

fn obsolete<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    bump(&mut e, "other", "b", "dev:bob"); bump(&mut e, "q", "a", "dev:alice");
    let p = next(&mut e, &mut d, 1);
    assert!(!d.apply_publication(&p, false).unwrap().1);
    let mut terminal = next(&mut e, &mut d, 100);
    let from = terminal.requested_watermark.take();
    assert!(d.apply(&terminal, false).unwrap_err().to_string().contains("obsolete deferred"));
    assert_eq!(value(&mut d, "a"), Some(1));
    terminal.requested_watermark = from;
    d.apply(&terminal, false).unwrap();
    assert!(!d.publication_pending().unwrap());
}
both!(deferred_continuation_requires_its_request_cursor, obsolete);

fn catchup_floor<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    let old = d.state().unwrap().0;
    bump(&mut e, "other", "b", "dev:bob");
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0); p.stage_snapshot = true;
    d.apply(&p, true).unwrap();
    let through = p.watermark; assert!(through > old);
    let mut p = next(&mut e, &mut d, 100); p.snapshot_catchup = true;
    p.watermark = old; p.images_at = Some(old);
    let error = d.apply(&p, false).unwrap_err();
    assert!(error.to_string().contains("obsolete deferred transfer page"), "{error}");
    let mut p = next(&mut e, &mut d, 100); p.snapshot_catchup = true;
    p.requested_watermark = None;
    assert!(d.apply_publication(&p, false).unwrap().1);
}
both!(snapshot_catchup_uses_its_own_request_floor, catchup_floor);

fn terminal_gap<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.images_at = Some(p.watermark + 1); p.committed_above.insert("q".into(), p.watermark + 1);
    assert!(d.apply(&p, true).unwrap_err().to_string().contains("terminal stream page"));
    assert!(!d.publication_pending().unwrap());
    assert_eq!(value(&mut d, "a"), Some(1));
}
both!(terminal_snapshot_gap_is_rejected, terminal_gap);

fn omitted_identity<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
    let mut d = h.open("identity", Some(b)).unwrap();
    let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    p.store_id = Some("A".into()); p.stage_snapshot = true;
    let revision = d.sync_state_read().unwrap().send_revision;
    d.apply(&p, true).unwrap();
    let private = d.sync_state_read().unwrap();
    assert_eq!(private.store_id, None);
    assert_eq!(private.send_revision, revision, "a held page cannot publish identity revision");
    let mut terminal = next(&mut e, &mut d, 100); terminal.snapshot_catchup = true;
    assert!(terminal.store_id.is_none());
    d.observe_store(&terminal).unwrap();
    assert_eq!(d.sync_state_read().unwrap().transfer_store_id.as_deref(), Some("A"));
    d.apply(&terminal, false).unwrap();
    assert_eq!(d.sync_state_read().unwrap().store_id.as_deref(), Some("A"));
    p.stage_snapshot = false;
    assert!(!d.observe_store(&p).unwrap().reset, "returning A must not replace itself");
    h.close("identity", d);
    let mut d = h.open("identity", None).unwrap();
    assert_eq!(d.sync_state_read().unwrap().store_id.as_deref(), Some("A"));
    assert_eq!(value(&mut d, "a"), Some(0));
}
both!(publishing_an_omitted_identity_uses_the_staged_identity, omitted_identity);

fn capture_lifetime<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let p = next(&mut e, &mut d, 100);
    let captured = d.store().meta("device:declaration:capture").unwrap();
    admit(&mut d, "later", "bump", json!({"k":"b"}));
    assert_eq!(d.sync_state().unwrap().pending_ids, vec!["q"], "same-revision requests reuse their declaration");
    d.begin_send().unwrap();
    assert_eq!(d.store().meta("device:declaration:capture").unwrap(), captured, "send cannot erase an in-flight declaration");
    assert_eq!(d.sync_state_read().unwrap().pending_ids, vec!["q", "later"]);
    assert_eq!(d.store().meta("device:declaration:capture").unwrap(), captured, "inspection does not replace an old capture");
    assert!(d.apply(&p, false).unwrap_err().to_string().contains("overlapped"));
    assert!(d.store().meta("device:declaration:capture").unwrap().is_none(), "rejection consumes that request capture");
    assert_eq!(d.sync_state_read().unwrap().pending_ids, vec!["q", "later"]);
    assert!(d.store().meta("device:declaration:capture").unwrap().is_none(), "state inspection is read-only");
    let p = next(&mut e, &mut d, 100);
    d.apply(&p, false).unwrap();
    assert_eq!((value(&mut d, "a"), value(&mut d, "b")), (Some(1), Some(1)));
}
both!(capture_survives_send_and_inspection_until_its_reply_is_rejected, capture_lifetime);

fn dequeue_rebase<H: Host>(h: &mut H) {
    let (_, mut d) = setup(h);
    admit(&mut d, "a", "bump", json!({"k":"a"}));
    admit(&mut d, "b", "bump", json!({"k":"a"}));
    assert_eq!(value(&mut d, "a"), Some(2));
    d.dequeue("a").unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
    d.dequeue("b").unwrap();
    assert_eq!(value(&mut d, "a"), Some(0));
}
both!(dequeue_rebases_surviving_predictions, dequeue_rebase);
