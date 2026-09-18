use super::*;

const OUTBOX_SOURCE: &str = "table notes:\n  body: text <=100\n  read <- allow\n  insert <- allow\n  sync public\nmutation send(body: text <=100):\n  return insert notes {body}\nquery notes():\n  return notes[] first 100 by byId\n";

fn entry(id: &str, viewer: &str, seq: u64) -> Queued {
    serde_json::from_value(json!({
        "id": id, "seq": seq, "op": "send", "args": {"body": format!("private-{viewer}")},
        "viewer": viewer, "new_ids": [format!("row-{id}")], "now": 100
    })).unwrap()
}

fn principal_change<H: RepairHost>(host: &mut H, reopen: bool) {
    let (_, backend) = compile(OUTBOX_SOURCE);
    let mut device = host.open_as("store", Some(backend.clone()), "dev:alice").unwrap();
    let original = device.admit(entry("alice", "dev:alice", 1)).unwrap();
    assert_eq!(device.queued().unwrap(), vec![original.clone()]);
    assert_eq!(device.store().row_count(), 0);
    let mut device = adopt(host, device, backend, "dev:bob", reopen).unwrap();
    assert_eq!(device.store().meta(OWNER).unwrap().as_deref(), Some("dev:bob"));
    assert_eq!(snapback4_device::call::call(&mut device, json!({"op":"queued"}))["ok"], json!([]), "foreign arguments reached the sender");
    assert!(device.sync_state().unwrap().pending_ids.is_empty());
    let revision = device.sync_state().unwrap().send_revision;
    for request in [json!({"op":"begin_send"}), json!({"op":"begin_send","ids":["alice"]})] {
        assert_eq!(snapback4_device::call::call(&mut device, request)["denied"]["code"], "E_INPUT");
        assert_eq!(device.sync_state().unwrap().send_revision, revision);
    }
    // Fencing is non-destructive in the device; native custody stays durable.
    host.close("store", device);
    let mut raw = host.raw("store");
    let tx = raw.read_transaction().unwrap();
    let kept: Queued = serde_json::from_str(&tx.outbox_get("alice").unwrap().unwrap()).unwrap();
    assert_eq!(kept, original);
    tx.rollback().unwrap();
    let mut device = host.open_as("store", None, "dev:bob").unwrap();
    let own = device.admit(entry("bob", "dev:bob", 2)).unwrap();
    assert_eq!(device.queued().unwrap(), vec![own.clone()]);
    assert_eq!(device.sync_state().unwrap().pending_ids, vec!["bob"]);
    assert_eq!(snapback4_device::call::call(&mut device, json!({"op":"begin_send","ids":["bob","alice"]}))["denied"]["code"], "E_INPUT");
    assert_eq!(device.sync_state().unwrap().send_revision, revision, "a refused batch must not advance the fence");
    assert_eq!(snapback4_device::call::call(&mut device, json!({"op":"begin_send","ids":["bob"]}))["ok"]["send_revision"], revision + 1);
    host.close("store", device);
    let mut device = host.open_as("store", None, "dev:bob").unwrap();
    assert_eq!(device.queued().unwrap(), vec![own]);
    assert_eq!(device.sync_state().unwrap().pending_ids, vec!["bob"]);
}
both_paths!(y1_principal_change, principal_change);

fn legacy<H: RepairHost>(host: &mut H, reopen: bool) {
    let (_, backend) = compile(OUTBOX_SOURCE);
    let device = host.open_as("store", Some(backend.clone()), "dev:alice").unwrap();
    host.close("store", device);
    let own = entry("own", "dev:alice", 2);
    let mut raw = host.raw("store");
    let tx = raw.transaction().unwrap();
    for entry in [entry("foreign", "dev:bob", 1), own.clone(), entry("unlabelled", "", 3)] {
        let mut data = serde_json::to_value(&entry).unwrap();
        if entry.viewer.is_empty() { data.as_object_mut().unwrap().remove("viewer"); }
        tx.outbox_insert(entry.seq, &entry.id, &data.to_string()).unwrap();
    }
    tx.commit().unwrap();
    let checked = Checked { inner: raw, fail: Cell::new(false), legacy: Cell::new(reopen), missing_backend: Cell::new(false), edit: Cell::new(None) };
    let mut device = Device::open_store(checked, None, "dev:alice").unwrap();
    if !reopen {
        device.store().legacy.set(true);
        device.adopt(backend, "dev:alice").unwrap();
    }
    assert_eq!(device.queued().unwrap(), vec![own.clone()], "legacy ownership is decided by the device");
    assert_eq!(device.sync_state().unwrap().pending_ids, vec!["own"]);
    assert!(device.begin_send_for(&["own".into()]).is_ok());
    for id in ["foreign", "unlabelled", "missing"] {
        assert_eq!(device.begin_send_for(&[id.into()]).unwrap_err().code(), "E_INPUT");
    }
    device.adopt(device.backend(), "dev:alice").unwrap();
    assert_eq!(device.queued().unwrap(), vec![own]);
}
both_paths!(y1_legacy_projection, legacy);

fn matching_on_change<H: RepairHost>(host: &mut H, reopen: bool) {
    let (_, backend) = compile(OUTBOX_SOURCE);
    let device = host.open_as("store", Some(backend.clone()), "dev:bob").unwrap();
    host.close("store", device);
    let mut raw = host.raw("store");
    let own = entry("old-matching", "dev:alice", 1);
    let tx = raw.transaction().unwrap();
    tx.outbox_insert(own.seq, &own.id, &serde_json::to_string(&own).unwrap()).unwrap();
    tx.commit().unwrap();
    let mut device = if reopen {
        Device::open_store(raw, None, "dev:alice").unwrap()
    } else {
        let mut device = Device::open_store(raw, None, "dev:bob").unwrap();
        device.adopt(backend, "dev:alice").unwrap();
        device
    };
    assert_eq!(device.queued().unwrap(), vec![own.clone()], "a known principal change must preserve writes matching the new opener");
    assert_eq!(device.sync_state().unwrap().pending_ids, vec![own.id.clone()]);
    device.begin_send_for(&[own.id.clone()]).unwrap();
    host.close("store", device);
    assert_eq!(host.open_as("store", None, "dev:alice").unwrap().queued().unwrap(), vec![own]);
}
both_paths!(y1_matching_write_on_principal_change, matching_on_change);

fn prediction<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut engine, backend) = compile(OUTBOX_SOURCE);
    let mut device = host.open_as("store", Some(backend.clone()), "dev:alice").unwrap();
    acquire(&mut device, &mut engine, "dev:alice");
    let mut intent = entry("predicted", "dev:alice", 1);
    intent.predictable = true;
    assert!(device.admit(intent).unwrap().predictable);
    assert_eq!(device.store().row_count(), 1);
    let mut device = adopt(host, device, backend, "dev:bob", reopen).unwrap();
    assert_eq!(device.store().row_count(), 0);
    acquire(&mut device, &mut engine, "dev:bob");
    assert_eq!(device.store().row_count(), 0, "acquisition replayed another principal's private arguments");
    for op in ["admit", "enqueue"] {
        let before = device.store().records();
        assert_eq!(snapback4_device::call::call(&mut device, json!({"op":op,"entry":entry("foreign", "dev:alice", 3)}))["denied"]["code"], "E_INPUT");
        assert_eq!(device.store().records(), before);
    }
    let mut own = entry("own", "dev:bob", 4);
    own.predictable = true;
    device.admit(own).unwrap();
    assert_eq!(device.store().row_count(), 1);
    device.withdraw(&[]).unwrap();
    assert_eq!(device.store().row_count(), 1, "only the matching prediction replays");
}
both_paths!(y1_prediction_and_admission, prediction);

#[test]
fn y1_superseded_native_handle_cannot_expose_queue_or_start_send() {
    let host = Sqlite::new("y1-stale");
    let (_, backend) = compile(OUTBOX_SOURCE);
    let mut alice = Device::open(&host.path("store"), Some(backend.clone()), "dev:alice").unwrap();
    alice.admit(entry("alice", "dev:alice", 1)).unwrap();
    let _bob = Device::open(&host.path("store"), Some(backend), "dev:bob").unwrap();
    for request in [json!({"op":"queued"}), json!({"op":"begin_send"}), json!({"op":"begin_send","ids":["alice"]})] {
        assert_eq!(snapback4_device::call::call(&mut alice, request)["denied"]["code"], "SNAPBACK_HISTORY_OWNER");
    }
    let read = snapback4_device::call::call(&mut alice, json!({"op":"query","name":"notes","args":{},"viewer":"dev:alice","now":100}));
    assert_eq!(read["ok"]["denied"]["code"], "SNAPBACK_HISTORY_OWNER");
    assert_eq!(read["ok"]["unknown"], false, "an owner refusal must not invite server fallback");
}
