use super::*;

#[test]
fn channel_values_expire_without_requests_and_late_subscribers_get_fresh_state() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let schema = root.join("snapback/schema.q");
    let source = fs::read_to_string(&schema)
        .unwrap()
        .replace("ttl 4s", "ttl 1s");
    fs::write(schema, source).unwrap();
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(env!("CARGO_BIN_EXE_snapback2"), &compiler, &root);
    let port = owner
        .ready_line()
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let path =
        "/api/channel/typing/subscribe?args=%7B%22conversationId%22%3A%22conversation-1%22%7D";
    let mut alice = Sse::open(port, path, "alice");
    let initial = alice.event();
    assert_eq!(initial["entries"], json!([]));
    let set = request(
        port,
        "POST",
        "/api/channel/typing/set",
        &[("X-Snapback-As", "alice")],
        json!({"args":{"conversationId":"conversation-1"}, "lease":initial["lease"], "version":1, "value":{"typing":true}}),
    );
    assert_eq!(set.body, json!({"ok":true}));
    assert_eq!(alice.event()["entries"][0]["value"]["typing"], true);
    let mut late = Sse::open(port, path, "bob");
    let first = late.event();
    assert_eq!(first["entries"][0]["key"], initial["key"]);
    assert_eq!(first["entries"][0]["from"], "dev:alice");
    assert!(first["entries"][0].get("lease").is_none());
    assert_ne!(initial["lease"], first["lease"]);
    // No mutation, explicit clock control, heartbeat renewal, or polling drives this expiry.
    let expired = late.event();
    assert_eq!(expired["entries"], json!([]));
    assert_eq!(expired["key"], first["key"]);
    let mut after_expiry = Sse::open(port, path, "alice");
    assert_eq!(after_expiry.event()["entries"], json!([]));
    let set = request(
        port,
        "POST",
        "/api/channel/typing/set",
        &[("X-Snapback-As", "alice")],
        json!({"args":{"conversationId":"conversation-1"}, "lease":initial["lease"], "version":2, "value":{"typing":false}}),
    );
    assert_eq!(set.body, json!({"ok":true}));
    assert_eq!(late.event()["entries"][0]["key"], initial["key"]);
    let removed = request(
        port,
        "POST",
        "/api/channel/typing/publish",
        &[("X-Snapback-As", "alice")],
        json!({"args":{},"payload":{}}),
    );
    assert_eq!(removed.status, 404);
    stop_owner(port, secret, &mut owner, "channel idle expiry complete");
    fs::remove_dir_all(root).unwrap();
}
