//! Abandoned requests and the complete snapshot/identity lifecycle.
use super::*;
macro_rules! both { ($name:ident, $body:ident) => {
    mod $name {
        use super::*;
        #[test] fn memory() { $body(&mut Memory::new()); }
        #[test] fn sqlite() { $body(&mut Sqlite::new(stringify!($name))); }
    }
} }

fn abandoned<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    assert_eq!(bump(&mut e, "external", "a", "dev:bob"), 2);
    admit(&mut d, "q1", "bump", json!({"k":"a"}));
    d.begin_send().unwrap();
    assert_eq!(bump(&mut e, "q1", "a", "dev:alice"), 3);
    d.settle("q1", Some(3)).unwrap();
    let p = next(&mut e, &mut d, 1);
    assert_eq!((p.watermark, p.images_at), (2, Some(3)));
    assert!(!d.apply_publication(&p, false).unwrap().1);
    let abandoned = d.sync_state().unwrap();
    assert_eq!(abandoned.pending_ids, ["q1"]);
    // Fetch fails before returning a page. No response is ever applied/rejected.
    admit(&mut d, "q2", "bump", json!({"k":"a"}));
    d.begin_send().unwrap();
    assert_eq!(bump(&mut e, "q2", "a", "dev:alice"), 4);
    d.settle("q2", Some(4)).unwrap();
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    let p = next(&mut e, &mut d, 1);
    assert_eq!((p.requested_watermark, p.watermark, p.images_at), (Some(2), 3, Some(4)));
    assert_eq!(p.events[0].data.as_ref().unwrap()["n"], 3);
    assert_eq!(p.acknowledged.get("q1"), Some(&3));
    let published = d.apply_publication(&p, false).unwrap().1;
    println!("{} abandoned after deferral: published={published}, device={:?}, above={:?}", h.label(), value(&mut d, "a"), p.committed_above);
    assert!(!published, "q2's confirmed image must stay private instead of replaying to 4");
    assert_eq!(p.committed_above.get("q2"), Some(&4));
    let p = next(&mut e, &mut d, 100);
    assert!(d.apply_publication(&p, false).unwrap().1);
    assert_eq!(value(&mut d, "a"), Some(3));
    assert!(d.queued().unwrap().is_empty());
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    assert_eq!(value(&mut d, "a"), Some(3));
}
both!(abandoned_capture_after_deferral_includes_later_send, abandoned);

fn late_response<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    admit(&mut d, "q", "bump", json!({"k":"a"}));
    let old = next(&mut e, &mut d, 100);
    d.begin_send().unwrap();
    let new = next(&mut e, &mut d, 100);
    assert_ne!(new.send_revision, old.send_revision);
    assert_eq!(new.pending_bound, old.pending_bound);
    let captured = d.store().meta("device:declaration:capture").unwrap();
    assert!(d.apply(&old, false).unwrap_err().to_string().contains("overlapped"));
    assert_eq!(d.store().meta("device:declaration:capture").unwrap(), captured, "an old response cannot erase a new revision with identical bounds");
    d.apply(&new, false).unwrap();
    assert_eq!(value(&mut d, "a"), Some(1));
}
both!(late_response_cannot_erase_new_revision_capture, late_response);

fn terminal_refusal<H: Host>(h: &mut H) {
    for mode in 0..4 {
        let (mut e, mut d) = setup(h);
        admit(&mut d, "q", "bump", json!({"k":"a"}));
        let cut = d.state().unwrap().0;
        if mode == 3 {
            let mut snapshot = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
            snapshot.stage_snapshot = true;
            d.apply(&snapshot, true).unwrap();
        }
        let mut page = next(&mut e, &mut d, 100);
        page.snapshot = mode == 1 || mode == 2;
        page.stage_snapshot = mode == 2;
        page.snapshot_catchup = mode == 3;
        page.images_at = Some(cut + 1);
        page.committed_above.insert("q".into(), cut + 1);
        page.events = serde_json::from_value(json!([{"table":"counters","id":"a","kind":"put","data":{"id":"a","n":2}}])).unwrap();
        assert!(d.apply_publication(&page, page.snapshot).unwrap_err().to_string().contains("terminal stream page"), "mode {mode}");
        assert_eq!(d.state().unwrap().0, cut);
        assert_eq!(value(&mut d, "a"), Some(1));
        assert_eq!(d.publication_pending().unwrap(), mode == 3);
        h.close("repair", d);
        let mut d = h.open("repair", None).unwrap();
        assert_eq!(value(&mut d, "a"), Some(1));
        d.clear_rows().unwrap();
        // Each mode owns a fresh partition, including an empty outbox.
        d.dequeue("q").unwrap();
        h.close("repair", d);
    }
}
both!(terminal_gap_refuses_ordinary_snapshot_and_catchup, terminal_refusal);

fn snapshot_lifetime<H: Host>(h: &mut H) {
    let (mut e, mut d) = setup(h);
    let mut snapshot = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
    snapshot.stage_snapshot = true;
    d.apply(&snapshot, true).unwrap();
    let cut = snapshot.watermark;
    let staged = d.sync_state_read().unwrap();
    assert_eq!(staged.watermark, cut);
    assert!(staged.snapshot_catchup, "equal cuts still require catch-up before publication");
    bump(&mut e, "other", "a", "dev:bob");
    let mut page = next(&mut e, &mut d, 100);
    page.snapshot_catchup = true;
    assert!(page.watermark > cut);
    assert!(d.apply_publication(&page, false).unwrap().1);
    for key in ["owner", "next", "through", "watermark", "send_revision", "acks", "groups", "boundaries:"] {
        assert!(d.store().meta(&format!("device:snapshot:{key}")).unwrap().is_none(), "{key} survived publication");
    }
    let live = d.sync_state_read().unwrap();
    assert!(!live.snapshot_catchup);
    assert_eq!((live.watermark, live.transfer_watermark), (page.watermark, page.watermark));
    bump(&mut e, "live", "a", "dev:bob");
    let page = next(&mut e, &mut d, 100);
    assert!(d.apply_publication(&page, false).unwrap().1);
    h.close("repair", d);
    let mut d = h.open("repair", None).unwrap();
    let reopened = d.sync_state_read().unwrap();
    assert!(!reopened.snapshot_catchup);
    assert_eq!((reopened.watermark, reopened.transfer_watermark), (page.watermark, page.watermark));
    assert_eq!(value(&mut d, "a"), Some(2));
}
both!(snapshot_cut_is_consumed_before_live_requests, snapshot_lifetime);

fn first_identity<H: Host>(h: &mut H) {
    for staged in [false, true] {
        let (mut e, b) = compile(SOURCE);
        e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
        let name = if staged { "first-staged" } else { "first-direct" };
        let mut d = h.open(name, Some(b)).unwrap();
        let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
        p.store_id = Some("S".into()); p.stage_snapshot = staged;
        assert_eq!(d.apply_publication(&p, true).unwrap().1, !staged);
        let s = d.sync_state_read().unwrap();
        assert_eq!(s.transfer_store_id.as_deref(), Some("S"));
        assert_eq!(s.store_id.as_deref(), if staged { None } else { Some("S") });
        assert_eq!(s.send_revision, if staged { 0 } else { 1 });
        // Same generation, different authenticated incarnation must reset and
        // require backend adoption, whether S is still private or published.
        p.store_id = Some("T".into()); p.stage_snapshot = false;
        assert!(d.apply(&p, true).unwrap_err().to_string().contains("replaced"));
        let s = d.sync_state_read().unwrap();
        assert!(s.backend_required);
        assert_eq!(s.store_id.as_deref(), Some("T"));
        assert!(d.apply(&p, true).unwrap_err().to_string().contains("backend adoption"));
        h.close(name, d);
        let mut d = h.open(name, None).unwrap();
        assert!(d.sync_state_read().unwrap().backend_required);
    }
}
both!(first_page_identity_is_bound_before_replacement, first_identity);
