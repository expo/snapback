use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(not(feature = "hermes"))]
#[test]
fn chat_owner_wire_sse_channels_and_successors() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let messages = root.join("snapback/messages.ts");
    let source = fs::read_to_string(&messages).unwrap().replace(
        "import { memberships, messages, profiles } from \"./schema\";",
        "import { memberships, messageCounts, messages, profiles } from \"./schema\";",
    ) + r#"

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
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "alice",
    );
    assert_eq!(later_alice.event()["state"], "complete");
    let mut other_args = Sse::open(
        port,
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-other%22%7D",
        "bob",
    );
    assert_eq!(other_args.event()["state"], "complete");
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
            "args": { "conversationId": "conversation-1" },
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
        refused["status"]["refusal"]["code"],
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

    let response = request(
        port,
        "POST",
        "/api/auth/signup",
        &[("X-Snapback-As", "alice")],
        json!({ "email": "alice@example.com", "password": "correct horse" }),
    );
    assert_eq!(response.status, 403, "{}", response.body);
    assert_eq!(response.body["code"], "E_AUTH_PERSONA_NOT_DEV");

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
        .args(["check", "--ir"])
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
fn status_removes_dead_and_unreachable_owner_files_with_an_explicit_refusal() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    fs::create_dir_all(root.join(".snapback")).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let unreachable_port = listener.local_addr().unwrap().port();
    drop(listener);

    for (pid, port) in [
        (2_000_000_000_u32, 9_u16),
        (std::process::id(), unreachable_port),
    ] {
        fs::write(
            root.join(".snapback/owner.json"),
            serde_json::to_vec(&json!({
                "pid": pid,
                "port": port,
                "url": format!("http://127.0.0.1:{port}"),
                "secret": "stale",
                "generation": "stale",
                "startedAt": 0,
                "mode": "dev",
                "project": root,
            }))
            .unwrap(),
        )
        .unwrap();
        let output = Command::new(binary)
            .args(["dev", "--project"])
            .arg(&root)
            .args(["--status", "--json"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        let refusal: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(refusal["code"], "E_OWNER_NOT_RUNNING");
        assert!(
            refusal["message"]
                .as_str()
                .unwrap_or_default()
                .contains("stale owner.json removed"),
            "{refusal}"
        );
        assert!(!root.join(".snapback/owner.json").exists());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn doctor_accepts_a_correct_slow_compiler_and_reports_its_latency() {
    let root = temp_root();
    let worker = write_worker(
        &root,
        "slow-compiler.mjs",
        r#"import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = JSON.parse(line);
  await new Promise((resolve) => setTimeout(resolve, 550));
  process.stdout.write(JSON.stringify({ id: request.id, ok: true }) + "\n");
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

#[cfg(not(feature = "hermes"))]
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

#[cfg(not(feature = "hermes"))]
struct Sse {
    reader: BufReader<TcpStream>,
    last_id: Option<u64>,
}

#[cfg(not(feature = "hermes"))]
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

    fn assert_silent(&mut self, timeout: Duration) {
        self.reader
            .get_mut()
            .set_read_timeout(Some(timeout))
            .unwrap();
        let mut size = String::new();
        match self.reader.read_line(&mut size) {
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Ok(0) => panic!("subscription closed while silence was expected"),
            Ok(_) => panic!("subscription delivered while silence was expected: {size:?}"),
            Err(error) => panic!("subscription silence probe failed: {error}"),
        }
        self.reader
            .get_mut()
            .set_read_timeout(Some(Duration::from_secs(6)))
            .unwrap();
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

#[cfg(not(feature = "hermes"))]
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
