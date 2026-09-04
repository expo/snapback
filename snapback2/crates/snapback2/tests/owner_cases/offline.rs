use super::*;

#[test]
fn offline_query_program_and_subscribe_wire_contract() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
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
    let query_body = json!({
        "op": "messages.thread",
        "args": { "conversationId": "conversation-1", "c": null },
    });

    let ordinary = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        query_body.clone(),
    );
    let explicit_default = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "receipt": false,
            "validator": "ignored-without-receipt",
        }),
    );
    assert_eq!(ordinary.status, 200, "{}", ordinary.body);
    assert_eq!(
        ordinary.body_bytes, explicit_default.body_bytes,
        "default query bytes changed"
    );
    assert!(ordinary.body.get("protocol").is_none());

    let receipt = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "receipt": true,
        }),
    );
    assert_eq!(receipt.status, 200, "{}", receipt.body);
    assert_eq!(receipt.body["protocol"], 1);
    assert_eq!(receipt.body["state"], ordinary.body["state"]);
    assert!(
        receipt.body["rows"]
            .as_array()
            .is_some_and(|rows| !rows.is_empty())
    );
    assert!(receipt.body["validator"].as_str().is_some());
    let validator = receipt.body["validator"].as_str().unwrap();
    let unchanged = request(
        port,
        "POST",
        "/api/query?receipt=1",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "validator": validator,
        }),
    );
    assert_eq!(
        unchanged.body,
        json!({ "state": "unchanged", "seq": receipt.body["seq"], "validator": validator })
    );

    let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
    let program_generation = manifest.body["programGeneration"].as_str().unwrap();
    assert_ne!(
        manifest.body["generation"],
        manifest.body["programGeneration"]
    );
    let program = request(
        port,
        "GET",
        &format!("/api/program?generation={program_generation}"),
        &[],
        json!({}),
    );
    assert_eq!(program.status, 200, "{}", program.body);
    assert!(
        program
            .headers
            .lines()
            .any(|line| line.eq_ignore_ascii_case("Cache-Control: public, immutable"))
    );
    assert_eq!(
        program.body["generation"],
        manifest.body["programGeneration"]
    );
    assert_eq!(program.body["schemaHash"], manifest.body["generation"]);
    assert!(program.body["schema"]["tables"].is_object());
    let served_schema: snapback2_core::Schema =
        serde_json::from_value(program.body["schema"].clone()).unwrap();
    assert_eq!(served_schema.hash(), program.body["schemaHash"]);
    for (name, item) in program.body["programs"].as_object().unwrap() {
        assert_eq!(item["planHash"], manifest.body["ops"][name]["planHash"]);
        assert!(item.get("ir").is_some() && item.get("certificate").is_some());
    }
    let missing_program = request(
        port,
        "GET",
        &format!("/api/program?generation={}", "0".repeat(64)),
        &[],
        json!({}),
    );
    assert_eq!(missing_program.status, 404);
    for field in ["code", "family", "message", "rewrite", "guide"] {
        assert!(
            missing_program.body[field]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
    }
    let no_generation = request(port, "GET", "/api/program", &[], json!({}));
    assert_eq!(no_generation.status, 400);
    assert!(
        no_generation.body["message"]
            .as_str()
            .is_some_and(|message| message.contains("requires the generation query parameter"))
    );

    let mutation_subscribe = "/api/subscribe?op=messages.send&args=%7B%7D";
    let mutation_without_receipt = request(
        port,
        "GET",
        mutation_subscribe,
        &[("X-Snapback-As", "alice")],
        json!({}),
    );
    let mutation_with_receipt = request(
        port,
        "GET",
        &format!("{mutation_subscribe}&receipt=1"),
        &[("X-Snapback-As", "alice")],
        json!({}),
    );
    assert_eq!(
        mutation_with_receipt.status,
        mutation_without_receipt.status
    );
    assert_eq!(mutation_with_receipt.body, mutation_without_receipt.body);

    let subscribe_path = "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%2C%22c%22%3Anull%7D";
    let mut ordinary_sub = Sse::open(port, subscribe_path, "alice");
    let ordinary_frame_bytes = ordinary_sub.event_text();
    let ordinary_frame: Value = serde_json::from_str(&ordinary_frame_bytes).unwrap();
    let mut explicit_default_sub = Sse::open(port, &format!("{subscribe_path}&receipt=0"), "alice");
    assert_eq!(
        ordinary_frame_bytes,
        explicit_default_sub.event_text(),
        "default subscribe bytes changed"
    );
    assert!(ordinary_frame.get("validator").is_none());
    drop(ordinary_sub);
    drop(explicit_default_sub);

    let mut conditional = Sse::open(
        port,
        &format!("{subscribe_path}&receipt=1&validator={validator}"),
        "alice",
    );
    assert_eq!(conditional.event()["state"], "unchanged");
    let committed = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.send",
            "args": {
                "conversationId": "conversation-1",
                "recipientId": "profile-bob",
                "body": "offline envelope changed",
            },
        }),
    );
    assert_eq!(committed.body["state"], "committed", "{}", committed.body);
    let changed_frame = conditional.event();
    assert_eq!(changed_frame["protocol"], 1);
    assert_ne!(changed_frame["validator"], validator);
    let changed_query = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "receipt": true,
            "validator": validator,
        }),
    );
    assert_eq!(changed_query.body["protocol"], 1);
    assert_ne!(changed_query.body["validator"], validator);

    let signup = request(
        port,
        "POST",
        "/api/auth/signup",
        &[],
        json!({ "email": "offline@example.com", "password": "correct horse" }),
    );
    let first_token = signup.body["token"].as_str().unwrap();
    let first_authorization = format!("Bearer {first_token}");
    let first_epoch = request(
        port,
        "POST",
        "/api/query",
        &[("Authorization", &first_authorization)],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "receipt": true,
        }),
    );
    let login = request(
        port,
        "POST",
        "/api/auth/login",
        &[],
        json!({ "email": "offline@example.com", "password": "correct horse" }),
    );
    let second_token = login.body["token"].as_str().unwrap();
    let second_authorization = format!("Bearer {second_token}");
    let after_login = request(
        port,
        "POST",
        "/api/query",
        &[("Authorization", &second_authorization)],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "receipt": true,
            "validator": first_epoch.body["validator"],
        }),
    );
    assert_ne!(after_login.body["state"], "unchanged");
    assert_eq!(
        after_login.body["authority"]["principal"],
        first_epoch.body["authority"]["principal"]
    );
    assert_ne!(
        after_login.body["authority"]["authEpoch"],
        first_epoch.body["authority"]["authEpoch"]
    );
    let auth_sub_path = format!(
        "{subscribe_path}&receipt=1&validator={}",
        first_epoch.body["validator"].as_str().unwrap(),
    );
    let mut after_login_sub = Sse::open_bearer(port, &auth_sub_path, second_token);
    assert_ne!(after_login_sub.event()["state"], "unchanged");

    stop_owner(port, secret, &mut owner, "offline wire contract complete");
    fs::remove_dir_all(root).unwrap();
}
