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
