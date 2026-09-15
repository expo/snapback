use super::*;
mod point_read_cut;

#[test]
fn defaults_predict_on_both_stores_with_the_explicit_write_clock() {
    on_both(|host| {
        let (mut engine, backend) = compile("table notes:\n  owner: principal default viewer\n  at: time default now\n  count: int default 0\n  by byOwner: owner, id\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nmutation add():\n  return insert notes {}\nquery get(note: notes):\n  return notes[note]\n");
        let label = host.label();
        let mut device = host.open("defaults", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        ok(device.call(serde_json::json!({ "op": "admit", "entry": Queued { id: "default-write".into(), seq: 1, op: "add".into(), args: serde_json::json!({}), new_ids: vec!["note".into()], predicted: vec![], viewer: "dev:alice".into(), now: 1234, predictable: true, sent_seq: None, observed_seq: None } })));
        let predicted = query(&mut *device, "get", "dev:alice", serde_json::json!({"note":"note"}), 2000);
        assert_eq!(predicted["data"]["pending"], true, "{label}");
        assert_eq!(predicted["data"]["at"], 1234, "{label}");
        assert_eq!(predicted["data"]["owner"], "dev:alice", "{label}");
        assert_eq!(predicted["data"]["count"], 0, "{label}");
        let sent = engine.mutate("add", Some("default-write"), context("dev:alice", &[]).at(1234).with_ids(["note".into()])).unwrap();
        let WriteState::Sent { seq, result } = sent.state else { panic!("{:?}", sent.state) };
        let mut expected = predicted["data"].clone();
        expected.as_object_mut().unwrap().remove("pending");
        assert_eq!(expected, snapback4_core::wire::to_json(&result), "{label}");
        ok(device.call(serde_json::json!({"op":"settle", "id":"default-write", "seq":seq})));
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", 0), false));
        let confirmed = query(&mut *device, "get", "dev:alice", serde_json::json!({"note":"note"}), 2000);
        assert_ne!(confirmed["data"]["pending"], true, "{label}");
        device.close();
    });
}

#[test]
fn shapes_preserve_pending_through_spreads_and_projection_on_both_stores() {
    let source = "table notes:\n  owner: principal default viewer\n  body: text <=20\n  by byOwner: owner, id\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nshape card = { *, label: 'card' }\nmutation add():\n  return insert notes { body: 'offline' }\nquery shaped(note: notes):\n  row = notes[note]\n  return { raw: row, spread: row { * }, named: row card, twice: (row card) { * }, projected: row { body }, extended: row { ...card, extra: true } }\nquery page(c: cursor ?):\n  return notes[viewer] after c first 10 by byOwner card\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let emitted = snapback4_lang::emit::typescript(&bound);
    assert!(emitted.contains("body: string; pending?: boolean"), "{emitted}");
    assert!(!emitted.contains("pending: boolean | null"));
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = compile(source);
        let mut device = host.open("shapes", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        ok(device.call(serde_json::json!({ "op": "admit", "entry": Queued { id: "shape-write".into(), seq: 1, op: "add".into(), args: serde_json::json!({}), new_ids: vec!["note".into()], predicted: vec![], viewer: "dev:alice".into(), now: 100, predictable: true, sent_seq: None, observed_seq: None } })));
        let check = |device: &mut dyn AnyDevice, pending: bool| {
            let shaped = query(device, "shaped", "dev:alice", serde_json::json!({"note":"note"}), 200);
            for key in ["raw", "spread", "named", "twice", "projected", "extended"] {
                assert_eq!(shaped["data"][key]["pending"] == true, pending, "{label} {key}: {shaped}");
                assert_eq!(shaped["data"][key]["body"], "offline");
            }
            assert!(shaped["data"].get("pending").is_none(), "metadata belongs to the projected rows, not the containing record");
            let page = query(device, "page", "dev:alice", serde_json::json!({}), 200);
            assert_eq!(page["data"][0]["pending"] == true, pending, "{label}: {page}");
        };
        check(&mut *device, true);
        device.close();
        let mut device = host.open("shapes", None).unwrap();
        check(&mut *device, true);
        let sent = engine.mutate("add", Some("shape-write"), context("dev:alice", &[]).at(100).with_ids(["note".into()])).unwrap();
        let WriteState::Sent { seq, .. } = sent.state else { panic!("{:?}", sent.state) };
        ok(device.call(serde_json::json!({"op":"settle", "id":"shape-write", "seq":seq})));
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", 0), false));
        check(&mut *device, false);
        device.close();
    });
}
