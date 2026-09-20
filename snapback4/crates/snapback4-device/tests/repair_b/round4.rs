//! A replacing publisher consumes the slot; an incarnation outlives a generation.
use super::*;
macro_rules! round4_stores { ($name:ident, $f:ident) => {
    mod $name {
        use super::*;
        #[test] fn memory() { $f(&mut Memory::new()); }
        #[test] fn sqlite() { $f(&mut Sqlite::new(stringify!($name))); }
    }
} }

fn replacement_disposes<H: Host>(h: &mut H) {
    for (advanced, staged) in [(false, false), (false, true), (true, false), (true, true)] {
        let (mut e, mut d) = setup(h);
        admit(&mut d, "q", "bump", json!({"k":"a"}));
        admit(&mut d, "later", "bump", json!({"k":"b"}));
        let cut = d.state().unwrap().0;
        d.sync_state().unwrap();
        // Exercise both same-position and advanced private bundles. The receipt
        // is deliberately absent from the replacement, so it must be discarded
        // with the images, never promoted by the common publication tail.
        let p: StreamPage = serde_json::from_value(json!({"snapshot":false,"watermark":cut + u64::from(advanced),
            "images_at":cut+2,"more":true,"committed_above":{"later":cut+2},"acknowledged":{"q":cut},
            "events":[{"table":"counters","kind":"put","id":"a","data":{"id":"a","n":99}}]})).unwrap();
        assert!(!d.apply_publication(&p, false).unwrap().1);
        h.close("repair", d);
        let mut d = h.open("repair", None).unwrap();
        assert!(d.publication_pending().unwrap());
        let mut snapshot = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
        snapshot.stage_snapshot = staged;
        snapshot.watermark = cut + 2;
        assert_eq!(d.apply_publication(&snapshot, true).unwrap().1, !staged);
        if staged {
            assert!(d.publication_pending().unwrap());
            let mut terminal = stream_page(&mut e, "dev:alice", cut);
            terminal.snapshot_catchup = true;
            terminal.watermark = snapshot.watermark;
            terminal.images_at = Some(snapshot.watermark);
            terminal.requested_watermark = Some(snapshot.watermark);
            assert!(d.apply_publication(&terminal, false).unwrap().1);
        }
        assert!(!d.publication_pending().unwrap());
        assert_eq!(value(&mut d, "a"), Some(1), "discarded receipts cannot suppress a live prediction");
        assert_eq!(value(&mut d, "b"), Some(1));
        assert!(d.queued().unwrap().iter().all(|q| q.observed_seq.is_none()));
        h.close("repair", d);
        let mut d = h.open("repair", None).unwrap();
        let mut terminal = stream_page(&mut e, "dev:alice", cut);
        terminal.watermark = snapshot.watermark;
        terminal.images_at = Some(snapshot.watermark);
        terminal.requested_watermark = Some(snapshot.watermark);
        d.apply(&terminal, false).unwrap();
        assert_eq!(value(&mut d, "a"), Some(1), "old private images cannot overwrite the snapshot after reopen");
        d.settle("q", None).unwrap(); d.settle("later", None).unwrap();
        assert_eq!(value(&mut d, "a"), Some(0), "the confirmed base is the replacement, not the discarded 99");
        // The next synthetic case starts from its own server's initial cut.
        d.clear_rows().unwrap();
        h.close("repair", d);
    }
}
round4_stores!(replacement_discards_slot_and_its_receipts, replacement_disposes);

fn incarnation_lifetime_case<H: Host>(h: &mut H, clear: bool) {
    for mode in ["adopt-keep", "adopt-drop", "open-keep", "open-drop"] {
        let name = format!("identity-{mode}");
        let (mut e, b) = compile(&format!("{SOURCE}\nquery stamp():\n  return 'A1'\n"));
        e.seed([("counters".into(), object([("id", id("a")), ("n", Value::Int(0))]))]).unwrap();
        let mut d = h.open(&name, Some(b)).unwrap();
        let mut p = snapshot_pages(&mut e, "dev:alice", 100).remove(0);
        p.store_id = Some("A".into()); p.stage_snapshot = true;
        d.observe_store(&p).unwrap(); d.apply(&p, true).unwrap();
        admit(&mut d, "q", "bump", json!({"k":"a"})); d.begin_send().unwrap();
        let receipt = bump(&mut e, "q", "a", "dev:alice"); d.settle("q", Some(receipt)).unwrap();
        assert_eq!(d.queued().unwrap()[0].receipt_store.as_ref().unwrap().id.as_deref(), Some("A"));
        let source = if mode.ends_with("drop") { SOURCE.replace("byN", "byOther") }
            else { SOURCE.replace("  n: int\n", "  n: int\n  added: int default 0\n") };
        let mut a2 = compile(&format!("{source}\nquery stamp():\n  return 'A2'\n")).1;
        a2.generation = d.backend().generation + 1;
        assert_eq!(snapback4_core::successor::keeps_literal_default_images(&d.backend().schema, &a2.schema), mode.ends_with("keep"));
        if mode.starts_with("adopt") {
            let state = d.sync_state().unwrap();
            let response = snapback4_device::call::call(&mut d, json!({"op":"adopt","backend":a2,
                "store_id":state.store_id,"send_revision":state.send_revision}));
            assert!(response.get("denied").is_none(), "{response}");
        } else { h.close(&name, d); d = h.open(&name, Some(a2.clone())).unwrap(); }
        if clear {
            let response = snapback4_device::call::call(&mut d, json!({"op":"clear_rows"}));
            assert!(response.get("denied").is_none(), "{response}");
        }
        assert!(!d.publication_pending().unwrap(), "identity alone is not unpublished effects");
        h.close(&name, d);
        let mut d = h.open(&name, None).unwrap();
        let state = d.sync_state().unwrap();
        assert_eq!(state.store_id, None);
        assert_eq!(state.transfer_store_id.as_deref(), Some("A"), "{mode}: knowledge survives generation and reopen");
        assert_eq!(state.transfer_watermark, 0);
        p.store_id = Some("B".into()); p.generation = Some(a2.generation); p.stage_snapshot = false;
        let response = snapback4_device::call::call(&mut d, json!({"op":"observe_store","page":p}));
        assert_eq!(response["ok"]["reset"], true, "{mode}: {response}");
        assert_eq!(response["ok"]["backend_required"], true, "{response}");
        assert_eq!(response["ok"]["retired"]["q"], receipt, "{response}");
        assert!(d.queued().unwrap().is_empty());
        let response = snapback4_device::call::call(&mut d, json!({"op":"apply","page":p,"first":true}));
        assert!(response.get("denied").is_some(), "B cannot publish using A2: {response}");
        let mut b = compile(&format!("{SOURCE}\nquery stamp():\n  return 'B'\n")).1;
        b.generation = a2.generation;
        d.adopt(b).unwrap(); d.apply(&p, true).unwrap();
        for _ in 0..2 {
            h.close(&name, d); d = h.open(&name, None).unwrap();
            assert!(d.queued().unwrap().is_empty());
            assert_eq!(d.query("stamp", "dev:alice", &json!({}), 100).unwrap().data, Value::String("B".into()));
            let state = d.sync_state().unwrap();
            assert_eq!(state.store_id.as_deref(), Some("B")); assert!(state.acquired);
        }
    }
}
round4_stores!(private_incarnation_survives_generation_and_retires_its_receipts, incarnation_lifetime);

fn observed_identity<H: Host>(h: &mut H) {
    let (_, b) = compile(SOURCE);
    let mut d = h.open("observed", Some(b.clone())).unwrap();
    let p: StreamPage = serde_json::from_value(json!({"snapshot":true,"store_id":"A","watermark":1,"more":false,"events":[]})).unwrap();
    d.observe_store(&p).unwrap(); // Generation mismatch: transport adopts before applying.
    let mut a2 = b; a2.generation += 1; d.adopt(a2).unwrap();
    h.close("observed", d);
    let mut d = h.open("observed", None).unwrap();
    let mut p = p; p.store_id = Some("B".into());
    let observed = d.observe_store(&p).unwrap();
    assert!(observed.reset && observed.backend_required, "an authenticated identity is known even before staging");
}
round4_stores!(observed_incarnation_is_known_before_first_apply, observed_identity);

fn incarnation_lifetime<H: Host>(h: &mut H) { incarnation_lifetime_case(h, false); }
fn row_reset_lifetime<H: Host>(h: &mut H) { incarnation_lifetime_case(h, true); }
round4_stores!(row_reset_preserves_incarnation_and_retires_its_receipts, row_reset_lifetime);
