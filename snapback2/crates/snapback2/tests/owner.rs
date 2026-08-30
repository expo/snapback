use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[test]
fn chat_owner_wire_sse_channels_and_successors() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let messages = root.join("snapback/messages.ts");
    let source = fs::read_to_string(&messages).unwrap().replace(
        "import { memberships, messages, profiles } from \"./schema\";",
        "import { memberships, messageCounts, messages, profiles } from \"./schema\";",
    ) + r#"

export const leave = mutation({ membershipId: t.id() }, ({ db, args }) => {
  db.delete(memberships, args.membershipId);
  return null;
});

export const forceCount = mutation({ conversationId: t.id() }, ({ db, ctx, args }) => {
  db.insert(messageCounts, { id: ctx.newId(), conversationId: args.conversationId, value: 999 });
  return null;
});

export const counts = query({ conversationId: t.id() }, ({ db, args }) =>
  db.scan(messageCounts.byConversation, [args.conversationId], { take: 10 }),
);

export const viewerMatches = query({ userId: t.id() }, ({ args, ctx }) =>
  args.userId === ctx.viewer,
);

export const before = query({ boundary: t.time() }, ({ args, ctx }) =>
  ctx.now() < args.boundary ? ["before"] : [],
);
"#;
    fs::write(&messages, source).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();

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
        json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1" } }),
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
            "limit": 10,
            "as": "alice",
        }),
    );
    assert_eq!(inspected.status, 200, "{}", inspected.body);
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
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "bob",
    );
    let first = live.event();
    let first_seq = first["seq"].as_u64().unwrap();
    assert_eq!(first["state"], "complete");

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
        "ID args must compare equal to ctx.viewer"
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
            "args": { "conversationId": "conversation-1", "recipientId": "dev:bob", "body": "hello" },
        }),
    );
    assert_eq!(mutation.body["state"], "committed", "{}", mutation.body);
    let committed_seq = mutation.body["seq"].as_u64().unwrap();
    assert!(committed_seq > first_seq);
    let delivery = live.event();
    assert_eq!(delivery["seq"], committed_seq);
    assert_eq!(delivery["state"], "complete");
    assert_eq!(delivery["data"][0]["body"], "hello");

    let counts = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.counts", "args": { "conversationId": "conversation-1" } }),
    );
    assert_eq!(counts.body["state"], "complete", "{}", counts.body);
    assert_eq!(counts.body["data"][0]["value"], 1);
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
        json!({ "op": "messages.leave", "args": { "membershipId": "membership-2" } }),
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
    source.push_str("\nexport const hotAdded = query({}, () => ({ hot: true }));\n");
    fs::write(&messages, source).unwrap();
    let applied = wait_for(Duration::from_secs(6), || {
        let value = status(port, &secret);
        (value["generation"].as_str() != Some(&old_generation)).then_some(value)
    });
    assert_eq!(applied["status"], "ready");

    let source = fs::read_to_string(&messages).unwrap();
    let source = source
        .split("\nexport const forceCount")
        .next()
        .unwrap()
        .replace(
            "import { memberships, messageCounts, messages, profiles } from \"./schema\";",
            "import { memberships, messages, profiles } from \"./schema\";",
        );
    fs::write(&messages, source).unwrap();
    let schema_path = root.join("snapback/schema.ts");
    let seed_path = root.join("snapback/seed.ts");
    let seed = fs::read_to_string(&seed_path)
        .unwrap()
        .replace("    messageCounts: [],\n", "");
    fs::write(&seed_path, seed).unwrap();
    let mut schema = fs::read_to_string(&schema_path).unwrap();
    let removed_start = schema.find("export const messageCounts").unwrap();
    let removed_end = schema.find("export const notifications").unwrap();
    schema.replace_range(removed_start..removed_end, "");
    let schema = schema
        .replace(
            "tables: { profiles, conversations, memberships, messages, messageCounts, notifications },",
            "tables: { profiles, conversations, memberships, messages, notifications },",
        )
        .replace(
            "maintains: [{ count: \"messages\", by: [\"conversationId\"], into: \"messageCounts\" }],",
            "maintains: [],",
        );
    fs::write(&schema_path, schema).unwrap();
    let refused = wait_for(Duration::from_secs(6), || {
        let value = status(port, &secret);
        (value["status"]["state"] == "refused").then_some(value)
    });
    assert_eq!(
        refused["status"]["refused"][0]["code"],
        "E_SUCCESSOR_DESTRUCTIVE"
    );
    let migration = fs::read_dir(root.join(".snapback"))
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("migration-"))
        })
        .expect("destructive successor migration file");
    let migrated = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .arg("--apply-migration")
        .arg(&migration)
        .arg("--json")
        .output()
        .unwrap();
    assert!(
        migrated.status.success(),
        "{} {}",
        String::from_utf8_lossy(&migrated.stdout),
        String::from_utf8_lossy(&migrated.stderr)
    );
    assert_eq!(status(port, &secret)["status"], "ready");

    let stop = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert!(
        stop.status.success(),
        "{}",
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

#[test]
fn reset_seed_refusal_is_atomic_and_keeps_the_owner_running() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
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
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    let before = request(
        port,
        "POST",
        "/control/data",
        &[("X-Snapback-Control", &secret)],
        json!({
            "table": "profiles",
            "index": "byId",
            "prefix": [],
            "limit": 10,
            "as": "alice",
        }),
    );
    assert_eq!(before.status, 200, "{}", before.body);
    let log_path = root.join(".snapback/log.jsonl");
    let log_start = fs::metadata(&log_path).unwrap().len();
    let seed_path = root.join("snapback/seed.ts");
    let seed = fs::read_to_string(&seed_path)
        .unwrap()
        .replace("handle: \"bob\"", "handle: \"alice\"");
    fs::write(&seed_path, seed).unwrap();
    wait_for(Duration::from_secs(6), || {
        let mut file = fs::File::open(&log_path).ok()?;
        use std::io::{Seek, SeekFrom};
        file.seek(SeekFrom::Start(log_start)).ok()?;
        let mut tail = String::new();
        file.read_to_string(&mut tail).ok()?;
        tail.contains("\"successor\":\"applied\"").then_some(())
    });

    let reset = request(
        port,
        "POST",
        "/control/reset",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(reset.status, 400, "{}", reset.body);
    assert_eq!(reset.body["code"], "E_CONSTRAINT", "{}", reset.body);
    assert_eq!(status(port, &secret)["status"], "ready");
    let after = request(
        port,
        "POST",
        "/control/data",
        &[("X-Snapback-Control", &secret)],
        json!({
            "table": "profiles",
            "index": "byId",
            "prefix": [],
            "limit": 10,
            "as": "alice",
        }),
    );
    assert_eq!(after.status, 200, "{}", after.body);
    assert_eq!(after.body, before.body, "failed reset changed durable rows");

    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", &secret)],
        json!({ "cause": "atomic reset test" }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serve_refuses_personas_before_every_route_dispatch() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let mut owner = ChildGuard::spawn_with(binary, &compiler, &root, true);
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

    for (name, method, path, body, control) in [
        (
            "signup",
            "POST",
            "/api/auth/signup",
            json!({ "email": "alice@example.com", "password": "correct horse" }),
            false,
        ),
        (
            "query",
            "POST",
            "/api/query",
            json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1" } }),
            false,
        ),
        (
            "mutation",
            "POST",
            "/api/mutation",
            json!({ "op": "messages.send", "args": {} }),
            false,
        ),
        (
            "subscribe",
            "GET",
            "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
            json!({}),
            false,
        ),
        (
            "channel",
            "POST",
            "/api/channel/typing/publish",
            json!({ "args": { "conversationId": "conversation-1" }, "payload": {} }),
            false,
        ),
        ("control", "GET", "/control/status", json!({}), true),
    ] {
        let headers = if control {
            vec![("X-Snapback-As", "alice"), ("X-Snapback-Control", secret)]
        } else {
            vec![("X-Snapback-As", "alice")]
        };
        let response = request(port, method, path, &headers, body);
        assert_eq!(response.status, 403, "{name}: {}", response.body);
        assert_eq!(
            response.body["code"], "E_AUTH_PERSONA_NOT_DEV",
            "{name}: {}",
            response.body
        );
    }

    let anonymous = request(
        port,
        "POST",
        "/api/query",
        &[],
        json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1" } }),
    );
    assert_eq!(anonymous.status, 401, "{}", anonymous.body);
    assert_eq!(
        anonymous.body["rewrite"],
        "send Authorization: Bearer <token>"
    );

    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "serve persona test" }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn check_grammar_schema_aggregation_and_numeric_flags_are_strict() {
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));

    let empty_ir = Command::new(binary)
        .args(["check", "--ir", "--json"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(empty_ir.status.code(), Some(2));

    let extra_ir = Command::new(binary)
        .args(["check", "--ir", "/dev/null", "extra"])
        .output()
        .unwrap();
    assert_eq!(extra_ir.status.code(), Some(2));

    let missing_project = Command::new(binary)
        .args(["check", "--project", "--json"])
        .output()
        .unwrap();
    assert_eq!(missing_project.status.code(), Some(2));

    let valid_ir = json!({
        "schemaMode": "spike",
        "programs": [{
            "name": "health",
            "kind": "Query",
            "args": {},
            "read_time_granularity_ms": null,
            "body": [{ "Return": { "Literal": "Null" } }],
        }],
    });
    let human = run_with_stdin(binary, &["check", "--ir"], &valid_ir);
    assert!(human.status.success());
    assert_eq!(String::from_utf8_lossy(&human.stdout), "ok health\n");
    let machine = run_with_stdin(binary, &["check", "--ir", "--json"], &valid_ir);
    assert!(machine.status.success());
    let machine: Value = serde_json::from_slice(&machine.stdout).unwrap();
    assert_eq!(machine["results"][0]["program"], "health");

    let missing_ir = Command::new(binary)
        .args(["check", "--ir"])
        .arg(root.join("missing-project.json"))
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(missing_ir.status.code(), Some(2));
    let missing_envelope: Value = serde_json::from_slice(&missing_ir.stdout).unwrap();
    assert_eq!(
        missing_envelope["results"][0]["error"]["code"],
        "E_CHECK_INPUT"
    );

    let mut explicit_project = Command::new(binary)
        .args(["check", "--project"])
        .arg(&root)
        .arg("--json")
        .env("SNAPBACK2_COMPILER", &compiler)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    explicit_project
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"programs":"stdin must not override --project"}"#)
        .unwrap();
    let explicit_project = explicit_project.wait_with_output().unwrap();
    assert!(explicit_project.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&explicit_project.stdout).unwrap()["ok"],
        true
    );

    let request = json!({
        "schema": { "FutureSchema": {} },
        "programs": [
            {
                "name": "broken",
                "kind": "Future",
                "args": {},
                "read_time_granularity_ms": null,
                "body": []
            },
            {
                "name": "validButBlocked",
                "kind": "Query",
                "args": {},
                "read_time_granularity_ms": null,
                "body": [{ "Return": "Null" }]
            }
        ]
    });
    let mut aggregate = Command::new(binary)
        .args(["check", "--ir", "--json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    aggregate
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&request).unwrap().as_bytes())
        .unwrap();
    let aggregate = aggregate.wait_with_output().unwrap();
    assert_eq!(aggregate.status.code(), Some(1));
    let response: Value = serde_json::from_slice(&aggregate.stdout).unwrap();
    assert_eq!(
        response["results"].as_array().unwrap().len(),
        3,
        "{response}"
    );
    assert_eq!(response["results"][0]["program"], "<schema>");
    assert_eq!(response["results"][1]["program"], "broken");
    assert_eq!(response["results"][2]["program"], "validButBlocked");

    for args in [
        ["logs", "--since", "nope"].as_slice(),
        ["data", "items", "--as", "alice", "--limit", "nope"].as_slice(),
    ] {
        let output = Command::new(binary).args(args).output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains("nope"));
    }

    for limit in ["0", "-1", "501", "4294967297"] {
        let output = Command::new(binary)
            .args(["data", "items", "--as", "alice", "--limit", limit, "--json"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "limit {limit}");
        let refusal: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(refusal["code"], "E_ARGS_LIMIT", "{refusal}");
    }

    for args in [
        vec!["version", "unexpected"],
        vec!["doctor", "unexpected"],
        vec!["check", "--unknown"],
        vec!["dev", "unexpected"],
        vec!["run", "op", "--as", "alice", "--unknown"],
        vec!["data", "items", "--as", "alice", "--unknown"],
        vec!["logs", "unexpected"],
        vec!["persona", "list", "--unknown"],
        vec!["fork", "name", "--unknown"],
        vec!["reset", "--unknown"],
    ] {
        let output = Command::new(binary).args(&args).output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{args:?}");
    }

    for (args, flag) in [
        (vec!["dev", "--port", "--json"], "--port"),
        (vec!["dev", "--project"], "--project"),
        (
            vec!["dev", "--apply-migration", "--status"],
            "--apply-migration",
        ),
        (vec!["run", "messages.thread", "--as", "--json"], "--as"),
        (vec!["data", "messages", "--index", "--json"], "--index"),
        (vec!["logs", "--since", "--json"], "--since"),
        (vec!["persona", "list", "--project", "--json"], "--project"),
        (vec!["fork", "attempt", "--project", "--json"], "--project"),
        (vec!["reset", "--project", "--json"], "--project"),
        (vec!["check", "--project", "--json"], "--project"),
    ] {
        let output = Command::new(binary).args(&args).output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains(flag),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn concurrent_detached_dev_attaches_without_replacing_the_winner() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let launch = || {
        let mut command = Command::new(binary);
        command
            .args(["dev", "--project"])
            .arg(&root)
            .env("SNAPBACK2_COMPILER", &compiler)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.spawn().unwrap()
    };
    let first = launch();
    let second = launch();
    let first = first.wait_with_output().unwrap();
    let second = second.wait_with_output().unwrap();
    assert!(
        first.status.success(),
        "{} {}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    assert!(
        second.status.success(),
        "{} {}",
        String::from_utf8_lossy(&second.stdout),
        String::from_utf8_lossy(&second.stderr)
    );
    let first_url = String::from_utf8_lossy(&first.stdout).trim().to_owned();
    let second_url = String::from_utf8_lossy(&second.stdout).trim().to_owned();
    assert!(first_url.starts_with("SNAPBACK_URL="), "{first_url}");
    assert_eq!(first_url, second_url);
    let owner_path = root.join(".snapback/owner.json");
    let owner: Value = serde_json::from_slice(&fs::read(&owner_path).unwrap()).unwrap();
    let pid = owner["pid"].as_u64().unwrap() as u32;
    let mut guard = DetachedOwnerGuard { pid };

    let stopped = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert!(
        stopped.status.success(),
        "{} {}",
        String::from_utf8_lossy(&stopped.stdout),
        String::from_utf8_lossy(&stopped.stderr)
    );
    assert!(!owner_path.exists());
    assert!(!process_alive(pid));
    guard.pid = 0;
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn detached_stop_removes_owner_state_and_waits_for_the_pid() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let started = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(
        started.status.success(),
        "{} {}",
        String::from_utf8_lossy(&started.stdout),
        String::from_utf8_lossy(&started.stderr)
    );
    let owner: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let pid = owner["pid"].as_u64().unwrap() as u32;
    let mut guard = DetachedOwnerGuard { pid };

    let stop_started = Instant::now();
    let stopped = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert!(
        stopped.status.success(),
        "{} {}",
        String::from_utf8_lossy(&stopped.stdout),
        String::from_utf8_lossy(&stopped.stderr)
    );
    assert!(stop_started.elapsed() <= Duration::from_millis(2200));
    assert!(!root.join(".snapback/owner.json").exists());
    assert!(
        !process_alive(pid),
        "stop returned while pid {pid} was live"
    );
    guard.pid = 0;
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn stop_during_generation_update_is_bounded_and_cannot_recreate_owner_state() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let checked = Command::new(binary)
        .args(["check", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
    let project = root.join(".snapback/build/project.json");
    let slow_worker = write_worker(
        &root,
        "slow-watch-compiler.mjs",
        &format!(
            r#"import {{ readFileSync }} from "node:fs";
import {{ createInterface }} from "node:readline";
const project = JSON.parse(readFileSync({}, "utf8"));
let compiles = 0;
for await (const line of createInterface({{ input: process.stdin, crlfDelay: Infinity }})) {{
  const request = JSON.parse(line);
  if (request.op === "compile" && compiles++ > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = request.op === "compile"
    ? {{ id: request.id, ok: true, project, sources: {{}}, apiDts: "", ms: 0 }}
    : {{ id: request.id, ok: true, seed: {{ personas: [], rows: {{}} }} }};
  process.stdout.write(JSON.stringify(response) + "\n");
}}
"#,
            serde_json::to_string(&project).unwrap()
        ),
    );
    let mut owner = ChildGuard::spawn(binary, &slow_worker, &root);
    owner.ready_line();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let pid = owner_json["pid"].as_u64().unwrap() as u32;
    let port = owner_json["port"].as_u64().unwrap() as u16;
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    // Let the watcher establish its initial fingerprint before changing the source.
    thread::sleep(Duration::from_millis(300));
    let messages = root.join("snapback/messages.ts");
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str("\n");
    fs::write(messages, source).unwrap();
    wait_for(Duration::from_secs(3), || {
        let current = status(port, &secret);
        (current["status"]["state"] == "applying").then_some(())
    });

    let started = Instant::now();
    let stopped = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert!(
        stopped.status.success(),
        "{} {}",
        String::from_utf8_lossy(&stopped.stdout),
        String::from_utf8_lossy(&stopped.stderr)
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    owner.wait();
    assert!(!process_alive(pid));
    assert!(!root.join(".snapback/owner.json").exists());
    thread::sleep(Duration::from_millis(3100));
    assert!(!root.join(".snapback/owner.json").exists());
    assert!(
        fs::read_to_string(root.join(".snapback/log.jsonl"))
            .unwrap()
            .contains("source watcher stop timeout")
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn stop_refuses_when_the_recorded_pid_survives_the_deadline() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    fs::create_dir_all(root.join(".snapback")).unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let server_root = root.canonicalize().unwrap();
    let server = thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            stream.read_to_end(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request);
            let body = if request.starts_with("GET /control/status ") {
                json!({ "project": server_root })
            } else {
                json!({ "ok": true, "exited": "fake owner stays alive" })
            };
            let body = serde_json::to_vec(&body).unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        }
    });
    let owner_path = root.join(".snapback/owner.json");
    fs::write(
        &owner_path,
        serde_json::to_vec(&json!({
            "pid": std::process::id(),
            "port": port,
            "url": format!("http://127.0.0.1:{port}"),
            "secret": "fake-owner-secret",
            "generation": "fake",
            "startedAt": 0,
            "mode": "dev",
            "project": root.canonicalize().unwrap(),
        }))
        .unwrap(),
    )
    .unwrap();

    let started = Instant::now();
    let stopped = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert_eq!(stopped.status.code(), Some(1));
    assert!(
        started.elapsed() >= Duration::from_secs(2),
        "stop returned after {:?}: {} {}",
        started.elapsed(),
        String::from_utf8_lossy(&stopped.stdout),
        String::from_utf8_lossy(&stopped.stderr)
    );
    assert!(started.elapsed() < Duration::from_secs(4));
    let refusal: Value = serde_json::from_slice(&stopped.stdout).unwrap();
    assert_eq!(refusal["code"], "E_OWNER_STOP_TIMEOUT");
    assert_eq!(refusal["pid"], std::process::id());
    assert!(
        refusal["message"]
            .as_str()
            .unwrap()
            .contains(&std::process::id().to_string())
    );
    assert!(owner_path.exists());
    server.join().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn status_never_removes_another_process_owner_file() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    fs::create_dir_all(root.join(".snapback")).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let unreachable_port = listener.local_addr().unwrap().port();
    drop(listener);

    for (pid, port, expected_code) in [
        (2_000_000_000_u32, 9_u16, "E_OWNER_NOT_RUNNING"),
        (std::process::id(), unreachable_port, "E_OWNER_RUNNING"),
    ] {
        let bytes = serde_json::to_vec(&json!({
            "pid": pid,
            "port": port,
            "url": format!("http://127.0.0.1:{port}"),
            "secret": "winner-secret",
            "generation": "winner-generation",
            "startedAt": 0,
            "mode": "dev",
            "project": root.canonicalize().unwrap(),
        }))
        .unwrap();
        fs::write(root.join(".snapback/owner.json"), &bytes).unwrap();
        let output = Command::new(binary)
            .args(["dev", "--project"])
            .arg(&root)
            .args(["--status", "--json"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        let refusal: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(refusal["code"], expected_code);
        assert_eq!(fs::read(root.join(".snapback/owner.json")).unwrap(), bytes);

        if pid == std::process::id() {
            let attach = Command::new(binary)
                .args(["dev", "--project"])
                .arg(&root)
                .arg("--json")
                .output()
                .unwrap();
            assert!(attach.status.success());
            let attached: Value = serde_json::from_slice(&attach.stdout).unwrap();
            assert_eq!(attached["code"], "E_OWNER_RUNNING");
            assert_eq!(attached["url"], format!("http://127.0.0.1:{port}"));
            assert_eq!(fs::read(root.join(".snapback/owner.json")).unwrap(), bytes);
        }
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn doctor_uses_the_lightweight_worker_probe_and_reports_its_latency() {
    let root = temp_root();
    let worker = write_worker(
        &root,
        "slow-compiler.mjs",
        r#"import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = JSON.parse(line);
  await new Promise((resolve) => setTimeout(resolve, 550));
  process.stdout.write(JSON.stringify({ id: request.id, ok: request.op === "journeys", files: [] }) + "\n");
}
"#,
    );
    let output = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["doctor", "--json"])
        .env("SNAPBACK2_COMPILER", worker)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["compiler"]["answered"], true);
    assert!(report["compiler"]["ms"].as_f64().unwrap() >= 500.0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn dev_start_and_control_apply_preserve_every_refusal() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let refusing = write_worker(
        &root,
        "refusing-compiler.mjs",
        r#"import { createInterface } from "node:readline";
const diagnostic = (code) => ({ code, family: "op", message: code, site: "snapback/broken.ts:1:1", rewrite: "fix it", guide: "op/compiler" });
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, ok: false, diagnostics: [diagnostic("E_FIRST"), diagnostic("E_SECOND")] }) + "\n");
}
"#,
    );
    let refused = Command::new(env!("CARGO_BIN_EXE_snapback2"))
        .args(["dev", "--project"])
        .arg(&root)
        .arg("--json")
        .env("SNAPBACK2_COMPILER", refusing)
        .output()
        .unwrap();
    assert_eq!(refused.status.code(), Some(1));
    let output = String::from_utf8_lossy(&refused.stdout);
    assert!(output.contains("E_FIRST"), "{output}");
    assert!(output.contains("E_SECOND"), "{output}");

    let compiler = compiler();
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
    let mut project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    let duplicate = project["programs"][0].clone();
    project["programs"]
        .as_array_mut()
        .unwrap()
        .push(duplicate.clone());
    project["programs"].as_array_mut().unwrap().push(duplicate);
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", secret)],
        json!({ "project": project }),
    );
    assert_eq!(applied.status, 400, "{}", applied.body);
    assert!(
        applied.body["refusals"]
            .as_array()
            .is_some_and(|items| items.len() >= 2),
        "{}",
        applied.body
    );

    fs::write(
        root.join("snapback/watch-broken.ts"),
        r#"import { query } from "snapback2";
export const first = query({}, () => unknownOne);
export const second = query({}, () => unknownTwo);
"#,
    )
    .unwrap();
    let watched = wait_for(Duration::from_secs(6), || {
        let value = status(port, secret);
        value["status"]["refused"]
            .as_array()
            .is_some_and(|refusals| refusals.len() >= 2)
            .then_some(value)
    });
    let status_refusals = watched["status"]["refused"].as_array().unwrap().clone();
    let logged_refusals = fs::read_to_string(root.join(".snapback/log.jsonl"))
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|line| line["successor"] == "refused")
        .map(|line| line["refusal"].clone())
        .collect::<Vec<_>>();
    assert_eq!(status_refusals, logged_refusals);
    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "multi-refusal test" }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn measure_regression_self_test_covers_failed_step_scoring_and_summary() {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/measure.mjs");
    let output = Command::new("node")
        .arg(script)
        .arg("--self-test")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("measure self-test ok"));
}

fn run_with_stdin(binary: &str, args: &[&str], input: &Value) -> std::process::Output {
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(input).unwrap().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

struct Response {
    status: u16,
    body: Value,
}

fn request(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: Value) -> Response {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let bytes = if method == "GET" {
        Vec::new()
    } else {
        serde_json::to_vec(&body).unwrap()
    };
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        bytes.len()
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    stream.write_all(b"\r\n").unwrap();
    stream.write_all(&bytes).unwrap();
    stream.flush().unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let head = String::from_utf8_lossy(&bytes[..split]);
    let status = head
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let body = serde_json::from_slice(&bytes[split + 4..]).unwrap();
    Response { status, body }
}

fn status(port: u16, secret: &str) -> Value {
    let response = request(
        port,
        "GET",
        "/control/status",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    response.body
}

struct Sse {
    reader: BufReader<TcpStream>,
    last_id: Option<u64>,
}

impl Sse {
    fn open(port: u16, path: &str, persona: &str) -> Self {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(6)))
            .unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Snapback-As: {persona}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        stream.flush().unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("200"), "{line}");
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        Self {
            reader,
            last_id: None,
        }
    }

    fn event(&mut self) -> Value {
        loop {
            let mut size = String::new();
            self.reader.read_line(&mut size).unwrap();
            let size = usize::from_str_radix(size.trim(), 16).unwrap();
            assert!(size > 0);
            let mut bytes = vec![0; size];
            self.reader.read_exact(&mut bytes).unwrap();
            let mut ending = [0; 2];
            self.reader.read_exact(&mut ending).unwrap();
            let text = String::from_utf8(bytes).unwrap();
            self.last_id = text
                .lines()
                .find_map(|line| line.strip_prefix("id: "))
                .and_then(|value| value.parse().ok());
            if let Some(data) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                return serde_json::from_str(data).unwrap();
            }
        }
    }
}

struct ChildGuard {
    child: Child,
    stdout: BufReader<std::process::ChildStdout>,
}

impl ChildGuard {
    fn spawn(binary: &str, compiler: &Path, root: &Path) -> Self {
        Self::spawn_with(binary, compiler, root, false)
    }

    fn spawn_with(binary: &str, compiler: &Path, root: &Path, serve: bool) -> Self {
        let mut command = Command::new(binary);
        command
            .args(["dev", "--project"])
            .arg(root)
            .arg("--foreground")
            .env("SNAPBACK2_COMPILER", compiler)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if serve {
            command.arg("--serve");
        }
        let mut child = command.spawn().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdout }
    }

    fn ready_line(&mut self) -> String {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        line
    }

    fn wait(&mut self) {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(5) {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "owner exited {status}");
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        panic!("owner did not stop");
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(unix)]
struct DetachedOwnerGuard {
    pid: u32,
}

#[cfg(unix)]
impl Drop for DetachedOwnerGuard {
    fn drop(&mut self) {
        if self.pid != 0 && process_alive(self.pid) {
            let _ = Command::new("kill").arg(self.pid.to_string()).status();
        }
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    // SAFETY: signal 0 performs a liveness check and does not deliver a signal.
    unsafe { kill(pid as i32, 0) == 0 }
}

fn wait_for<T>(timeout: Duration, mut check: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(value) = check() {
            return value;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("condition did not become true in {timeout:?}");
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/compiler/fixtures/chat")
}

fn compiler() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/dist/compiler.mjs")
}

fn write_worker(root: &Path, name: &str, source: &str) -> PathBuf {
    let path = root.join(name);
    fs::write(&path, source).unwrap();
    path
}

fn temp_root() -> PathBuf {
    static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "snapback2-owner-test-{}-{}-{}",
        std::process::id(),
        NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        let destination = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}
