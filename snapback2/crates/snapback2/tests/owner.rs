use serde_json::{Value, json};
#[cfg(not(feature = "hermes"))]
use snapback2_core::{
    Ceilings, Context as CoreContext, Expr, Generation, Program, ProgramKind, ProjectJson, Runtime,
    Stmt, Store,
};
#[cfg(not(feature = "hermes"))]
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

mod owner_cases;
mod owner_support;
mod owner_wire;
use owner_support::*;
#[cfg(not(feature = "hermes"))]
use owner_wire::Sse;
use owner_wire::{request, status};

#[cfg(not(feature = "hermes"))]
#[test]
fn chat_owner_wire_sse_channels_and_successors() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let messages = root.join("snapback/messages.ts");
    let source = fs::read_to_string(&messages).unwrap().replace(
        "import { conversations, memberships, messages, profiles } from \"./schema\";",
        "import { conversations, memberships, messageCounts, messages, profiles } from \"./schema\";",
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
        let manifest = request(port, "GET", "/api/manifest", &[], json!({}));
        manifest.body["ops"]
            .get("messages.hotAdded")
            .is_some()
            .then_some(value)
    });
    assert_eq!(applied["status"], "ready");
    assert_eq!(applied["generation"], old_generation);

    let source = fs::read_to_string(&messages).unwrap();
    let source = source
        .split("\nexport const forceCount")
        .next()
        .unwrap()
        .replace(
            "import { conversations, memberships, messageCounts, messages, profiles } from \"./schema\";",
            "import { conversations, memberships, messages, profiles } from \"./schema\";",
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

#[cfg(not(feature = "hermes"))]
#[test]
fn default_owner_replays_then_pending_without_an_engine() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let seq = seed_effect_row(
        &root,
        binary,
        &compiler,
        Some(json!({ "providerId": "replayed-provider" })),
    );

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
    let settled = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(settled["effects"]["engine"], "none");
    assert_eq!(settled["effects"]["thenPending"], 0);
    assert_eq!(settled["seq"], 2, "then mutation committed");
    let trace = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(trace.body["outbox"]["rows"][0]["state"], "sent");
    assert_eq!(trace.body["outbox"]["rows"][0]["lastError"], Value::Null);

    stop_owner(port, &secret, &mut owner, "default runner replay complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn rule_denied_then_settles_sent_with_the_rejection_visible_in_trace() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let schema = root.join("snapback/schema.ts");
    let source = fs::read_to_string(&schema)
        .unwrap()
        .replace("rule.system()", "rule.deny()");
    fs::write(schema, source).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let seq = seed_effect_row(
        &root,
        binary,
        &compiler,
        Some(json!({ "providerId": "denied-provider" })),
    );

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
    let settled = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(settled["seq"], 1, "rule-rejected then writes no commit");
    let trace = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(trace.body["outbox"]["rows"][0]["state"], "sent");
    assert!(
        trace.body["outbox"]["rows"][0]["lastError"]
            .as_str()
            .is_some_and(|error| error.contains("rule")),
        "{}",
        trace.body
    );

    stop_owner(port, &secret, &mut owner, "rule-denied then complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn fractional_effect_result_rejects_then_and_still_settles_sent() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    let seq = seed_effect_row(&root, binary, &compiler, Some(json!({ "ratio": 1.5 })));

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
    let settled = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(settled["effects"]["running"], 0);
    assert_eq!(settled["effects"]["thenPending"], 0);
    assert_eq!(settled["seq"], 1, "rejected then writes no commit");
    let trace = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(trace.body["outbox"]["rows"][0]["state"], "sent");
    assert!(
        trace.body["outbox"]["rows"][0]["lastError"]
            .as_str()
            .is_some_and(|error| error.contains("E_INPUT")),
        "{}",
        trace.body
    );

    stop_owner(port, &secret, &mut owner, "fractional result complete");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn doctor_counts_queued_rows_from_store_without_an_owner() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler();
    seed_effect_row(&root, binary, &compiler, None);

    let doctor = Command::new(binary)
        .arg("doctor")
        .current_dir(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(doctor.status.success());
    assert!(
        String::from_utf8_lossy(&doctor.stdout)
            .contains("effects: no engine in this build — 1 queued"),
        "{}",
        String::from_utf8_lossy(&doctor.stdout)
    );
    let store = Store::open(&root.join(".snapback/store.sqlite")).unwrap();
    assert_eq!(store.outbox_counts().unwrap().queued, 1);
    drop(store);
    fs::remove_dir_all(root).unwrap();
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

    let missing_id_ir = json!({
        "schema": {
            "tables": {
                "messages": {
                    "columns": {},
                    "indexes": { "byId": { "columns": ["id"], "unique": true } },
                    "rules": {
                        "read": "Allow",
                        "insert": "Allow",
                        "update": "Allow",
                        "delete": "Allow"
                    },
                    "constraints": []
                }
            },
            "maintains": []
        },
        "programs": [{
            "name": "messages.health",
            "kind": "Query",
            "args": {},
            "read_time_granularity_ms": null,
            "body": [{ "Return": { "Literal": "Null" } }]
        }]
    });
    let missing_id = run_with_stdin(binary, &["check", "--ir", "--json"], &missing_id_ir);
    assert_eq!(missing_id.status.code(), Some(1));
    let missing_id: Value = serde_json::from_slice(&missing_id.stdout).unwrap();
    assert_eq!(missing_id["results"][0]["error"]["code"], "E_SCHEMA");
    assert!(
        missing_id["results"][0]["error"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("implicit id column")),
        "{missing_id}"
    );

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
  process.stdout.write(JSON.stringify({ id: request.id, ok: request.op === "seed", seed: { personas: [], rows: {} } }) + "\n");
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
