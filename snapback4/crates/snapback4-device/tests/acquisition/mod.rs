use super::*;

#[test]
fn w5c_sync_state_reports_durable_acquisition_after_snapshot_and_catchup() {
    on_both(|host| {
        let (mut engine, backend) = server();
        let mut device = host.open("acquired", Some(backend)).unwrap();
        assert_eq!(ok(device.call(serde_json::json!({ "op": "sync_state" })))["acquired"], false);
        let pages = snapshot_pages(&mut engine, "dev:alice", 20);
        for (n, page) in pages.iter().enumerate() {
            let mut value = page_json(page);
            value["stage_snapshot"] = true.into();
            ok(device.call(serde_json::json!({ "op": "apply", "page": value, "first": n == 0 })));
            assert_eq!(ok(device.call(serde_json::json!({ "op": "sync_state" })))["acquired"], false);
        }
        let mut catchup = page_json(&stream_page(&mut engine, "dev:alice", pages.last().unwrap().watermark));
        catchup["snapshot_catchup"] = true.into();
        ok(device.call(serde_json::json!({ "op": "apply", "page": catchup })));
        assert_eq!(ok(device.call(serde_json::json!({ "op": "sync_state" })))["acquired"], true);
        device.close();
        let mut reopened = host.open("acquired", None).unwrap();
        assert_eq!(ok(reopened.call(serde_json::json!({ "op": "sync_state" })))["acquired"], true);
        ok(reopened.call(serde_json::json!({ "op": "clear_rows" })));
        assert_eq!(ok(reopened.call(serde_json::json!({ "op": "sync_state" })))["acquired"], false);
    });
}
