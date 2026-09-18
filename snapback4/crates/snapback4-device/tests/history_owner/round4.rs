// Round-3 reviewer reproductions, with reset and acquisition assertions.
use super::*;
use snapback4_core::Rows;

fn literal_signin<H: RepairHost>(host: &mut H, reopen: bool) {
    for added_table in [false, true] {
        let (mut engine, _, device) = fixture(host, "dev:alice", false);
        let mut source = SOURCE.replace("  body: text", "  flag: bool default false\n  body: text");
        if added_table {
            source.push_str("\ntable extra:\n  read <- allow\n  sync public\n");
        }
        let backend = next(&mut engine, &source);
        let mut device = adopt(host, device, backend.clone(), "dev:alice", reopen).unwrap();
        assert_eq!(device.store().row_count(), 52);
        assert_eq!(device.state().unwrap().0, 0);
        assert_eq!(device.sync_state().unwrap().acquired, !added_table);
        assert_eq!(device.store().meta(GROUPS).unwrap().as_deref(), Some("{}"));
        // A second literal addition must not overwrite the saved classification
        // with the deliberately empty read map. Reopen offline between additions.
        host.close("store", device);
        let device = host.open_as("store", None, "dev:alice").unwrap();
        let backend = next(
            &mut engine,
            &source.replace("  body: text", "  count: int default 0\n  body: text"),
        );
        let device = adopt(host, device, backend.clone(), "dev:alice", reopen).unwrap();
        let result = adopt(host, device, backend, "dev:bob", reopen);
        let mut device = result
            .unwrap_or_else(|e| panic!("held-only literal-default store refused sign-in: {e:?}"));
        assert_eq!(device.store().row_count(), 0);
        assert_eq!(
            device.store().meta(OWNER).unwrap().as_deref(),
            Some("dev:bob")
        );
        assert!(!device.sync_state().unwrap().acquired);
    }
}
both_paths!(held_after_literal, literal_signin);

fn prediction<H: RepairHost>(host: &mut H, reopen: bool) {
    let source = r#"table rooms:
  owner: principal
  read <- exists members[.id, viewer]
  insert <- .owner = viewer
  after insert <- exists members[.id, .owner]
  sync to members[.id]
table members:
  room: rooms
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room
  immutable room, principal
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer] or created rooms[.room]
  sync to members[.room]
table messages:
  room: rooms
  at: time
  body: text <=40
  by byTime: room, at, id
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 25 by byTime
mutation createRoom():
  room = insert rooms {owner: viewer}
  insert members {room: room.id, principal: viewer}
  insert messages {room: room.id, at: now, body: 'not delivered'}
"#;
    let (mut engine, backend) = compile(&source);
    let mut device = host
        .open_as("store", Some(backend.clone()), "dev:alice")
        .unwrap();
    acquire(&mut device, &mut engine, "dev:alice");
    let entry: Queued = serde_json::from_value(json!({"id":"offline-create","seq":1,"op":"createRoom","args":{},"viewer":"dev:alice","now":100,"predictable":true,"new_ids":["room-new","member-new","message-new"]})).unwrap();
    let admitted = device.admit(entry).unwrap();
    assert!(admitted.predictable);
    assert_eq!(device.store().row_count(), 3);
    host.close("store", device);
    let mut raw = host.raw("store");
    let tx = raw.read_transaction().unwrap();
    let bases = tx.base_entries().unwrap();
    assert_eq!(bases.len(), 3);
    assert!(bases.iter().all(|(_, _, image)| image.is_none()));
    tx.rollback().unwrap();
    drop(raw);
    let device = host.open_as("store", None, "dev:alice").unwrap();
    let result = adopt(host, device, backend, "dev:bob", reopen);
    let mut device =
        result.unwrap_or_else(|e| panic!("prediction-only store refused sign-in: {e:?}"));
    assert_eq!(device.store().row_count(), 0);
    assert_eq!(
        device.store().meta(OWNER).unwrap().as_deref(),
        Some("dev:bob")
    );
    assert!(!device.sync_state().unwrap().acquired);
}
both_paths!(prediction_only, prediction);

fn literal_left<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut engine, _, device) = fixture(host, "dev:alice", true);
    let backend = next(
        &mut engine,
        &SOURCE.replace("  body: text", "  flag: bool default false\n  body: text"),
    );
    let device = adopt(host, device, backend.clone(), "dev:alice", reopen).unwrap();
    host.close("store", device);
    let device = host.open_as("store", None, "dev:alice").unwrap();
    let before = durable(&mut host.raw("store"));
    let result = adopt(host, device, backend, "dev:bob", reopen);
    assert!(matches!(result, Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"));
    assert_eq!(durable(&mut host.raw("store")), before);
}
both_paths!(literal_left_history_refuses, literal_left);

fn literal_then_leave<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut engine, _, device) = fixture(host, "dev:alice", false);
    let backend = next(
        &mut engine,
        &SOURCE.replace("  body: text", "  flag: bool default false\n  body: text"),
    );
    let mut device = adopt(host, device, backend.clone(), "dev:alice", reopen).unwrap();
    let outcome = engine
        .mutate("leave", Some("leave"), context("dev:alice", &[]).at(100))
        .unwrap();
    assert!(matches!(
        outcome.state,
        snapback4_core::engine::WriteState::Sent { .. }
    ));
    let mut page = stream_page(&mut engine, "dev:alice", device.state().unwrap().0);
    page.store_id = Some("incarnation-a".into());
    device.apply(&page, false).unwrap();
    assert_eq!(
        read(&mut device, "dev:alice")["data"]["left"]
            .as_array()
            .unwrap()
            .len(),
        25
    );
    let result = adopt(host, device, backend, "dev:bob", reopen);
    assert!(
        matches!(result, Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"),
        "current Left must override saved Held"
    );
}
both_paths!(literal_then_leave_refuses, literal_then_leave);

fn literal_reacquire<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut engine, _, device) = fixture(host, "dev:alice", false);
    let backend = next(
        &mut engine,
        &SOURCE.replace("  body: text", "  flag: bool default false\n  body: text"),
    );
    let mut device = adopt(host, device, backend.clone(), "dev:alice", reopen).unwrap();
    assert!(
        device
            .store()
            .meta("device:history:classified-groups")
            .unwrap()
            .is_some()
    );
    acquire(&mut device, &mut engine, "dev:alice");
    assert_eq!(
        device
            .store()
            .meta("device:history:classified-groups")
            .unwrap(),
        None
    );
    let device = adopt(host, device, backend, "dev:bob", reopen).unwrap();
    assert_eq!(device.store().row_count(), 0);
}
both_paths!(literal_reacquisition_replaces_evidence, literal_reacquire);

// Exercise the physical/base overlay directly: prediction may relocate a held
// image to an unknown group or hide the only left image by deleting it.
fn confirmed_overlay<H: RepairHost>(host: &mut H, reopen: bool) {
    for deleted in [false, true] {
        let (_, backend, device) = fixture(host, "dev:alice", deleted);
        host.close("store", device);
        let mut raw = host.raw("store");
        let tx = raw.transaction().unwrap();
        let table = &backend.schema.tables["messages"];
        let id = if deleted { "left-25" } else { "held-25" };
        let row = tx.get("messages", id).unwrap().unwrap();
        tx.clear_rows().unwrap();
        tx.base_remember(
            "messages",
            id,
            Some(&snapback4_core::json_codec::to_text(&row).unwrap()),
        )
        .unwrap();
        if !deleted {
            let predicted = wire::row_from_json(
                table,
                &json!({"id":id,"room":"not-delivered","at":25,"body":"predicted"}),
            )
            .unwrap();
            tx.put("messages", table, &predicted, None).unwrap();
        }
        tx.commit().unwrap();
        // Commit the modified fixture to both host implementations.
        let device = Device::open_store(raw, None, "dev:alice").unwrap();
        host.close("store", device);
        let before = durable(&mut host.raw("store"));
        let device = host.open_as("store", None, "dev:alice").unwrap();
        let result = adopt(host, device, backend, "dev:bob", reopen);
        if deleted {
            assert!(
                matches!(result, Err(ref e) if e.code() == "SNAPBACK_HISTORY_OWNER"),
                "confirmed history beneath a deletion must refuse"
            );
            assert_eq!(durable(&mut host.raw("store")), before);
        } else {
            assert_eq!(
                result.unwrap().store().row_count(),
                0,
                "the confirmed held image, not its prediction, decides reuse"
            );
        }
    }
}
both_paths!(confirmed_bases_override_predictions, confirmed_overlay);
