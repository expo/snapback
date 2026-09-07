use super::*;

#[cfg(not(feature = "hermes"))]
#[test]
fn chat_owner_wire_sse_channels_and_successors() {
    let original_root = temp_root();
    let root = original_root.with_extension("quoted 'project'");
    fs::rename(original_root, &root).unwrap();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let messages = root.join("snapback/messages.q");
    let source = fs::read_to_string(&messages).unwrap()
        + r#"

mutation forceCount(conversationId: id):
  insert messageCounts { conversationId, value: 999 }
  return null

query counts(conversationId: id):
  return messageCounts[conversationId] first 10 by byConversation

query viewerMatches(userId: principal):
  return userId = viewer

query before(boundary: time):
  if now < boundary:
    return ['before']
  return []
"#;
    fs::write(&messages, source).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);

    let check = Command::new(binary)
        .args(["check", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(
        check.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&check.stdout),
        String::from_utf8_lossy(&check.stderr),
    );
    assert!(String::from_utf8_lossy(&check.stdout).starts_with("ok "));

    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let line = owner.ready_line();
    let port: u16 = line
        .trim()
        .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
        .expect("owner ready line")
        .parse()
        .unwrap();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap().to_owned();

    let missing_requeue = request(
        port,
        "POST",
        "/control/outbox/missing/requeue",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(missing_requeue.status, 404, "{}", missing_requeue.body);
    assert_eq!(missing_requeue.body["code"], "E_EFFECT_NOT_FOUND");

    for email in ["alice@example.com", "bob@example.com"] {
        let response = request(
            port,
            "POST",
            "/api/auth/signup",
            &[],
            json!({
                "email": email,
                "password": "correct horse",
            }),
        );
        assert_eq!(response.status, 200, "{}", response.body);
        assert!(response.body["token"].as_str().is_some());
    }

    let initial = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1", "c": null } }),
    );
    assert_eq!(initial.status, 200);
    assert_eq!(initial.body["state"], "complete");

    let inspected = request(
        port,
        "POST",
        "/control/data",
        &[("X-Snapback-Control", &secret)],
        json!({
            "table": "messages",
            "index": "byConvTime",
            "prefix": ["conversation-1"],
            "limit": 500,
            "as": "alice",
        }),
    );
    assert_eq!(
        inspected.status, 200,
        "the owner data verb must cap chat's t.text(4000) rows to a certifiable page: {}",
        inspected.body
    );
    assert!(
        inspected.body.get("next").is_some(),
        "data omitted next: {}",
        inspected.body
    );
    let data_first = request(
        port,
        "POST",
        "/control/data",
        &[("X-Snapback-Control", &secret)],
        json!({
            "table": "messages",
            "index": "byId",
            "prefix": [],
            "limit": 1,
            "as": "alice",
        }),
    );
    assert_eq!(data_first.body["state"], "capped", "{}", data_first.body);
    let data_next = data_first.body["next"]
        .as_str()
        .expect("capped data page token");
    let cli_page = Command::new(binary)
        .args([
            "data",
            "messages",
            "--index",
            "byId",
            "--prefix",
            "[]",
            "--after",
            data_next,
            "--limit",
            "1",
            "--as",
            "alice",
            "--json",
            "--project",
        ])
        .arg(&root)
        .output()
        .unwrap();
    assert!(
        cli_page.status.success(),
        "{}",
        String::from_utf8_lossy(&cli_page.stderr)
    );
    let data_second: Value = serde_json::from_slice(&cli_page.stdout).unwrap();
    assert_ne!(data_first.body["data"], data_second["data"]);
    assert_eq!(data_second["state"], "capped", "{data_second}");
    let second_next = data_second["next"]
        .as_str()
        .expect("second capped data page token");
    let terminal_page = Command::new(binary)
        .args([
            "data",
            "messages",
            "--index",
            "byId",
            "--prefix",
            "[]",
            "--after",
            second_next,
            "--limit",
            "1",
            "--as",
            "alice",
            "--json",
            "--project",
        ])
        .arg(&root)
        .output()
        .unwrap();
    assert!(
        terminal_page.status.success(),
        "{}",
        String::from_utf8_lossy(&terminal_page.stderr)
    );
    let data_terminal: Value = serde_json::from_slice(&terminal_page.stdout).unwrap();
    assert_eq!(data_terminal["state"], "capped", "{data_terminal}");
    assert_eq!(data_terminal["data"], json!([]), "{data_terminal}");
    assert_eq!(data_terminal["next"], Value::Null, "{data_terminal}");
    let human_page = Command::new(binary)
        .args([
            "data",
            "messages",
            "--index",
            "byId",
            "--prefix",
            "[]",
            "--after",
            second_next,
            "--limit",
            "1",
            "--as",
            "alice",
            "--project",
        ])
        .arg(&root)
        .output()
        .unwrap();
    assert!(human_page.status.success());
    assert!(String::from_utf8_lossy(&human_page.stdout).contains("\"next\": null"));
    let synthetic = request(
        port,
        "POST",
        "/control/why",
        &[("X-Snapback-Control", &secret)],
        json!({ "op": "__owner.data.messages", "args": {}, "as": "alice" }),
    );
    assert_eq!(synthetic.status, 400, "{}", synthetic.body);
    assert_eq!(synthetic.body["code"], "E_OP_UNKNOWN");

    let mut live = Sse::open(
        port,
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%2C%22c%22%3Anull%7D",
        "bob",
    );
    let first = live.event();
    let first_seq = first["seq"].as_u64().unwrap();
    assert_eq!(first["state"], "complete");
    let subscriptions_before = request(
        port,
        "GET",
        "/control/subscriptions",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    )
    .body;
    let verdicts = request(
        port,
        "POST",
        "/control/verdicts",
        &[("X-Snapback-Control", &secret)],
        json!({
            "table": "memberships",
            "as": "bob",
            "rows": [{ "id": "membership-2" }],
        }),
    );
    assert_eq!(verdicts.status, 200, "{}", verdicts.body);
    live.assert_silent(Duration::from_millis(300));
    let subscriptions_after = request(
        port,
        "GET",
        "/control/subscriptions",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    )
    .body;
    assert_eq!(
        subscriptions_after, subscriptions_before,
        "verdict probes must not rebind the live generation"
    );

    let direct_maintained_write = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.forceCount", "args": { "conversationId": "conversation-1" } }),
    );
    assert_eq!(direct_maintained_write.status, 200);
    assert_eq!(
        direct_maintained_write.body["state"], "rejected",
        "{}",
        direct_maintained_write.body
    );

    let equality = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.viewerMatches", "args": { "userId": "dev:alice" } }),
    );
    assert_eq!(equality.body["state"], "complete", "{}", equality.body);
    assert_eq!(
        equality.body["data"], true,
        "principal args must compare equal to viewer"
    );

    let boundary = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        + 60_000;
    let clock_path =
        format!("/api/subscribe?op=messages.before&args=%7B%22boundary%22%3A{boundary}%7D");
    let mut clocked = Sse::open(port, &clock_path, "alice");
    assert_eq!(clocked.event()["data"], json!(["before"]));
    let advanced = request(
        port,
        "POST",
        "/control/clock",
        &[("X-Snapback-Control", &secret)],
        json!({ "advanceMs": 120_000 }),
    );
    assert_eq!(advanced.status, 200, "{}", advanced.body);
    assert_eq!(clocked.event()["data"], json!([]));

    let mutation = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.send",
            "args": { "conversationId": "conversation-1", "recipientId": "profile-bob", "body": "hello" },
        }),
    );
    assert_eq!(mutation.body["state"], "committed", "{}", mutation.body);
    let committed_seq = mutation.body["seq"].as_u64().unwrap();
    assert!(committed_seq > first_seq);
    let delivery = live.event();
    assert_eq!(delivery["seq"], committed_seq);
    assert_eq!(delivery["state"], "complete");
    assert_eq!(delivery["data"][0]["body"], "hello");
    let traced_commit = request(
        port,
        "GET",
        &format!("/control/trace?seq={committed_seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    )
    .body;
    assert_eq!(traced_commit["invalidated"].as_array().unwrap().len(), 1);
    assert_eq!(traced_commit["deliveries"][0]["seq"], committed_seq);

    let mut later_alice = Sse::open(
        port,
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%2C%22c%22%3Anull%7D",
        "alice",
    );
    assert_eq!(later_alice.event()["state"], "complete");
    let mut other_args = Sse::open(
        port,
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-other%22%2C%22c%22%3Anull%7D",
        "bob",
    );
    assert_eq!(other_args.event()["state"], "denied");
    let trace_after_subscribe = request(
        port,
        "GET",
        &format!("/control/trace?seq={committed_seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    )
    .body;
    assert_eq!(
        trace_after_subscribe["invalidated"],
        traced_commit["invalidated"]
    );
    assert_eq!(
        trace_after_subscribe["deliveries"],
        traced_commit["deliveries"]
    );

    let explained = request(
        port,
        "POST",
        "/control/why",
        &[("X-Snapback-Control", &secret)],
        json!({
            "op": "messages.thread",
            "args": { "conversationId": "conversation-1", "c": null },
            "as": "bob",
        }),
    );
    assert_eq!(explained.status, 200, "{}", explained.body);
    assert_eq!(explained.body["subscriptions"].as_array().unwrap().len(), 1);
    assert_eq!(explained.body["subscriptions"][0]["principal"], "dev:bob");

    let counts = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.counts", "args": { "conversationId": "conversation-1" } }),
    );
    assert_eq!(counts.body["state"], "complete", "{}", counts.body);
    assert_eq!(counts.body["data"][0]["value"], 2);
    let effects = status(port, &secret)["effects"].clone();
    assert_eq!(
        effects,
        json!({
            "engine": "none",
            "queued": 1,
            "running": 0,
            "thenPending": 0,
            "sent": 0,
            "failed": 0,
            "sentUnknown": 0,
        })
    );
    let doctor = Command::new(binary)
        .arg("doctor")
        .current_dir(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(doctor.status.success());
    assert!(
        String::from_utf8_lossy(&doctor.stdout)
            .contains("effects: no engine in this build — 1 queued")
    );

    let mut typing = Sse::open(
        port,
        "/api/channel/typing/subscribe?args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "bob",
    );
    let publish = request(
        port,
        "POST",
        "/api/channel/typing/publish",
        &[("X-Snapback-As", "alice")],
        json!({ "args": { "conversationId": "conversation-1" }, "payload": { "typing": true } }),
    );
    assert_eq!(publish.body, json!({ "ok": true }));
    let typing_event = typing.event();
    assert_eq!(typing.last_id, Some(committed_seq));
    assert_eq!(typing_event["from"], "dev:alice");
    assert_eq!(typing_event["payload"]["typing"], true);

    let left = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "bob")],
        json!({ "op": "groups.memberLeave", "args": {
            "conversationId": "conversation-1",
            "membershipId": "membership-2",
        } }),
    );
    assert_eq!(left.body["state"], "committed", "{}", left.body);
    let channel_refusal = typing.event();
    assert_eq!(typing.last_id, left.body["seq"].as_u64());
    assert_eq!(channel_refusal["state"], "refused", "{channel_refusal}");
    assert_eq!(channel_refusal["code"], "E_RULE_CHANNEL_SUBSCRIBE");
    assert_eq!(channel_refusal["family"], "rule");
    assert!(
        channel_refusal["message"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );
    assert!(
        channel_refusal["rewrite"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );
    assert_eq!(channel_refusal["guide"], "rule/channels");

    let before = status(port, &secret);
    let old_generation = before["generation"].as_str().unwrap().to_owned();
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str("\nquery hotAdded():\n  return { hot: true }\n");
    fs::write(&messages, source).unwrap();
    let applied = wait_for(Duration::from_secs(6), || {
        let value = status(port, &secret);
        let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
        manifest.body["ops"]
            .get("messages.hotAdded")
            .is_some()
            .then_some(value)
    });
    assert_eq!(applied["status"], "ready");
    assert_eq!(applied["generation"], old_generation);

    let source = fs::read_to_string(&messages).unwrap();
    let mut source = source
        .split("\nmutation forceCount")
        .next()
        .unwrap()
        .to_owned();
    source = source.replace(
        "messageCount: messageCounts[conversationId]",
        "messageCount: { value: 0 }",
    );
    fs::write(&messages, source).unwrap();
    let deliveries = root.join("snapback/deliveries.q");
    let delivery_source = fs::read_to_string(&deliveries).unwrap();
    let without_count =
        delivery_source.replace("count: #messageCounts[conversationId]", "count: 0");
    assert_ne!(
        delivery_source, without_count,
        "the chat composite query no longer reads the maintained count"
    );
    fs::write(&deliveries, without_count).unwrap();
    let schema_path = root.join("snapback/schema.q");
    let seed_path = root.join("snapback/seed.ts");
    let seed = fs::read_to_string(&seed_path)
        .unwrap()
        .replace("    messageCounts: [],\n", "");
    fs::write(&seed_path, seed).unwrap();
    let mut schema = fs::read_to_string(&schema_path).unwrap();
    let removed_start = schema.find("maintain messageCounts").unwrap();
    let removed_end = schema.find("channel typing").unwrap();
    schema.replace_range(removed_start..removed_end, "");
    fs::write(&schema_path, schema).unwrap();
    let refused = wait_for(Duration::from_secs(6), || {
        let value = status(port, &secret);
        (value["status"]["state"] == "refused"
            && value["status"]["refused"][0]["applyCommand"].is_string())
        .then_some(value)
    });
    assert_eq!(
        refused["status"]["refused"][0]["code"], "E_SUCCESSOR_DESTRUCTIVE",
        "{refused}"
    );
    let refusal = &refused["status"]["refused"][0];
    let migration = std::path::PathBuf::from(refusal["migrationFile"].as_str().unwrap());
    let plan: Value = serde_json::from_slice(&fs::read(&migration).unwrap()).unwrap();
    assert_eq!(refusal["guide"], "E_SUCCESSOR_DESTRUCTIVE");
    assert!(
        refusal["rewrite"]
            .as_str()
            .unwrap()
            .contains("previous generation")
    );
    let checked = Command::new(binary)
        .args(["check", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .arg("--json")
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stdout)
    );
    let checked: Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(checked["generation"], plan["generation"]);
    assert_ne!(checked["generation"], old_generation);
    assert_eq!(status(port, &secret)["generation"], old_generation);
    let apply_command = refusal["applyCommand"].as_str().unwrap();
    let mut search_path = vec![std::path::Path::new(binary).parent().unwrap().to_path_buf()];
    search_path.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    // Run the exact emitted command from outside the project, including its shell quoting.
    let migrated = Command::new("sh")
        .args(["-c", apply_command])
        .current_dir(std::env::temp_dir())
        .env("PATH", std::env::join_paths(search_path).unwrap())
        .output()
        .unwrap();
    assert!(
        migrated.status.success(),
        "{} {}",
        String::from_utf8_lossy(&migrated.stdout),
        String::from_utf8_lossy(&migrated.stderr)
    );
    assert_eq!(status(port, &secret)["status"], "ready");
    assert_eq!(status(port, &secret)["generation"], plan["generation"]);

    let stop = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert!(
        stop.status.success(),
        "{} {}",
        String::from_utf8_lossy(&stop.stdout),
        String::from_utf8_lossy(&stop.stderr)
    );
    assert!(
        !root.join(".snapback/owner.json").exists(),
        "stop must remove owner.json before replying"
    );
    owner.wait();
    assert!(!root.join(".snapback/owner.json").exists());
    assert!(
        !fs::read_to_string(root.join(".snapback/log.jsonl"))
            .unwrap()
            .contains(&secret)
    );
    if let Err(error) = fs::remove_dir_all(root) {
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }
}
