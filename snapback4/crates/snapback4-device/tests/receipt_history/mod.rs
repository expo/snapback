//! The receipt window is shared by owners and older adopted windows fill spare capacity.
use super::*;
use serde_json::{json, Value as Json};

fn receipt(id: &str, seq: usize) -> Json { json!({ "state": "sent", "id": id, "seq": seq, "replayed": true }) }
fn keep(device: &mut dyn AnyDevice, value: &Json) {
    let reply = device.call(json!({ "op": "keep_write", "value": value.to_string() }));
    assert!(reply.get("denied").is_none(), "{reply}");
}
fn history(device: &mut dyn AnyDevice) -> Vec<Json> {
    let reply = device.call(json!({ "op": "meta", "key": "write-history" }));
    serde_json::from_str(reply["ok"].as_str().unwrap()).unwrap()
}

#[test]
fn receipt_history_adoption_fills_only_spare_capacity_on_both_stores() {
    on_both(|host| {
        let (_, backend) = compile(CHAT);
        for size in [0, 128, 256] {
            let name = format!("receipts-{size}");
            let mut device = host.open(&name, Some(backend.clone())).unwrap();
            let own: Vec<_> = (0..size).map(|n| receipt(&format!("A{n}"), n)).collect();
            for write in &own { keep(&mut *device, write); }
            let mut older: Vec<_> = (0..256).map(|n| receipt(&format!("B{n}"), n)).collect();
            if size > 0 { older.push(receipt("A0", 9999)); }
            keep(&mut *device, &json!(older));
            let expected: Vec<_> = (size..256).map(|n| receipt(&format!("B{n}"), n)).chain(own.clone()).collect();
            assert_eq!(history(&mut *device), expected, "destination size={size}");
            // Re-adoption is idempotent and does not refresh an old id's position.
            keep(&mut *device, &json!(older));
            assert_eq!(history(&mut *device), expected);
            keep(&mut *device, &receipt("newest", 300));
            let mut advanced = expected[1..].to_vec(); advanced.push(receipt("newest", 300));
            assert_eq!(history(&mut *device), advanced);
            device.close();
            let mut reopened = host.open(&name, None).unwrap();
            assert_eq!(history(&mut *reopened), advanced);
        }
    });
}

#[test]
fn caller_id_admission_compares_before_prediction_on_both_stores() {
    on_both(|host| {
        let (mut engine, backend) = server();
        let mut device = host.open("write-identity", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let entry = json!({ "id":"01ARZ3NDEKTSV4RRFFQ69G5FAV", "seq":1, "op":"send", "args":{"conversationId":"c1", "body":"first"},
            "viewer":"dev:alice", "now":2000, "new_ids":["original-row"], "predicted":[], "predictable":true });
        let original = ok(device.call(json!({ "op":"admit", "entry":entry })));
        ok(device.call(json!({ "op":"begin_send" })));
        let before = ok(device.call(json!({ "op":"sync_state" })));
        let mut retry = entry.clone(); retry["seq"] = json!(99); retry["new_ids"] = json!(["replacement-row"]); retry["now"] = json!(3000);
        assert_eq!(ok(device.call(json!({ "op":"admit", "entry":retry }))), original);
        for (field, value) in [("args", json!({"conversationId":"c1", "body":"wrong"})), ("viewer", json!("dev:bob")), ("op", json!("missing"))] {
            let mut conflict = retry.clone(); conflict[field] = value;
            let denied = device.call(json!({ "op":"admit", "entry":conflict }));
            assert_eq!(denied["denied"]["code"], "E_WRITE_ID_REUSE", "{denied}");
            assert_eq!(denied["denied"]["family"], "input");
            assert_eq!(denied["denied"]["guide"], "writes");
        }
        assert_eq!(ok(device.call(json!({ "op":"queued" }))), json!([original]));
        assert_eq!(ok(device.call(json!({ "op":"sync_state" }))), before);
        assert_eq!(ok(device.call(json!({ "op":"next_submission" }))), 2);
        let read = query(&mut *device, "thread", "dev:alice", json!({"conversationId":"c1"}), 3000);
        assert_eq!(rows(&read).iter().filter(|row| row["pending"] == true).count(), 1);
    });
}

#[test]
fn caller_id_replay_candidate_rolls_back_partial_predictions_on_both_stores() {
    on_both(|host| {
        let (mut engine, backend) = compile("table records:\n  n: int\n  public 'admission rollback'\n  insert <- allow\n  sync public\nmutation record(allowed: bool):\n  insert records { n: 1 }\n  require allowed else LOCKED\nquery records():\n  return records[] first 10 by byId\n");
        let mut device = host.open("replay-rollback", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 4000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let mut entry = json!({"id":"replay", "seq":1, "op":"record", "args":{"allowed":false}, "viewer":"alice", "now":1,
            "new_ids":["rolled-back"], "predictable":true, "predicted":[]});
        assert_eq!(device.call(json!({"op":"admit", "entry":entry}))["denied"]["code"], "LOCKED");
        entry["replay_candidate"] = json!(true);
        let candidate = ok(device.call(json!({"op":"admit", "entry":entry})));
        assert_eq!(candidate["predictable"], false);
        assert_eq!(candidate["predicted"], json!([]));
        assert_eq!(candidate["new_ids"], entry["new_ids"]);
        assert!(rows(&query(&mut *device, "records", "alice", json!({}), 1)).is_empty());
        // Another already-open owner's stale submission number allocates next.
        entry["id"] = json!("fresh"); entry["args"] = json!({"allowed":true}); entry["new_ids"] = json!(["fresh-row"]);
        let fresh = ok(device.call(json!({"op":"admit", "entry":entry})));
        assert_eq!(fresh["seq"], 2); assert_eq!(fresh["predictable"], true);
        assert_eq!(rows(&query(&mut *device, "records", "alice", json!({}), 1)).len(), 1);
        ok(device.call(json!({"op":"settle", "id":"fresh"})));
        assert!(rows(&query(&mut *device, "records", "alice", json!({}), 1)).is_empty());
        assert_eq!(ok(device.call(json!({"op":"queued"}))), json!([candidate]));
    });
}
