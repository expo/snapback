use super::*;

#[path = "../../../snapback4-sim/tests/common/membership.rs"]
mod fixture;

#[test]
fn self_witness_membership_keeps_online_coverage_unknown_on_both_stores() {
    on_both(|host| {
        let label = host.label();
        for (variant, source) in [("self", fixture::SOURCE.to_owned()), ("literal", fixture::literal_source()), ("other", fixture::other_table_source())] {
            let (mut engine, backend) = compile(&source);
            engine.seed(fixture::rows()).unwrap();
            let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
            for viewer in ["dev:alice", "dev:bob", "dev:carol", "dev:mallory", "dev:nobody"] {
                let mut device = host.open(&format!("{variant}-{viewer}"), Some(backend.clone())).unwrap();
                let unheld = query(&mut *device, "roster", viewer, serde_json::json!({"chatKey":"alpha"}), 1);
                assert!(rows(&unheld).is_empty() && unheld["complete"] == false, "{label}: {unheld}");
                // Online-only rows are never synced. Deliberately install all
                // candidates, including hidden rows, to exercise the device's
                // rule path rather than the trusted synced-partition bypass.
                let events: Vec<_> = fixture::rows().iter().map(|(table, row)| serde_json::json!({
                    "table": table, "kind": "put", "id": row.field("id").unwrap().as_str().unwrap(),
                    "data": snapback4_core::wire::to_json(row),
                })).collect();
                let page: snapback4_device::device::StreamPage = serde_json::from_value(serde_json::json!({
                    "snapshot": false, "events": events, "watermark": 1, "more": false, "generation": backend.generation,
                })).unwrap();
                ok(apply(&mut *device, &page, false));
                for name in ["roster", "directory", "receipt"] {
                    let args = match name { "roster" => serde_json::json!({"chatKey":"alpha"}), "receipt" => serde_json::json!({"messageId":"msg"}), _ => serde_json::json!({}) };
                    let typed = match name { "roster" => common::args(&[("chatKey", fixture::text("alpha"))]), "receipt" => common::args(&[("messageId", id("msg"))]), _ => common::args(&[]) };
                    let server = engine.query(name, snapback4_core::Context::new(viewer, typed).at(1)).unwrap();
                    let local = query(&mut *device, name, viewer, args, 1);
                    assert_eq!(local["data"], snapback4_core::wire::to_json(&server.data), "{label}, {variant}, {viewer}, {name}");
                    assert_eq!(local["complete"], false, "{label}: uniformity cannot supply an online-only fact: {local}");
                    assert_eq!(local["next"], serde_json::Value::Null, "{label}: {local}");
                }
                device.close();
            }
        }
    });
}
