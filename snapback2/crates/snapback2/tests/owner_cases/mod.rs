use super::owner_support::*;
use super::*;

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

#[cfg(not(feature = "hermes"))]
#[test]
fn successor_rebinds_channel_subscriber_before_g1_publish() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let schema = root.join("snapback/schema.ts");
    let source = fs::read_to_string(&schema).unwrap();
    let allowing = source.replace(
        "subscribe: rule.exists(memberships, \"byConversationPrincipal\", [rule.field(\"conversationId\"), rule.viewer]),",
        "subscribe: rule.allow(),",
    );
    assert_ne!(source, allowing, "chat fixture channel rule changed");
    fs::write(schema, allowing).unwrap();

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
    let generation_g = status(port, secret)["generation"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut retained = Sse::open(
        port,
        "/api/channel/typing/subscribe?args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "bob",
    );
    let mut project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    project["schema"]["channels"]["typing"]["subscribe"] = json!("Deny");
    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", secret)],
        json!({ "project": project }),
    );
    assert_eq!(applied.status, 200, "{}", applied.body);
    assert_ne!(applied.body["to"], generation_g, "{}", applied.body);

    let published = request(
        port,
        "POST",
        "/api/channel/typing/publish",
        &[("X-Snapback-As", "alice")],
        json!({
            "args": { "conversationId": "conversation-1" },
            "payload": { "generation": "g1" },
        }),
    );
    assert_eq!(published.body, json!({ "ok": true }), "{}", published.body);

    let refusal = retained.event();
    assert_eq!(refusal["state"], "refused", "{refusal}");
    assert_eq!(refusal["code"], "E_RULE_CHANNEL_SUBSCRIBE", "{refusal}");
    retained.assert_closed();

    stop_owner(port, secret, &mut owner, "successor channel fence complete");
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
  process.stdout.write(JSON.stringify({ id: request.id, ok: request.op === "probe", protocol: "snapback2/compiler-worker/v1", operations: ["compile", "seed", "journeys"] }) + "\n");
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

#[cfg(not(feature = "hermes"))]
#[test]
fn policy_only_successor_readmits_existing_channel_subscribers() {
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
    let mut typing = Sse::open(
        port,
        "/api/channel/typing/subscribe?args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "alice",
    );
    let mut project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    project["schema"]["channels"]["typing"]["subscribe"] = json!("Deny");

    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", secret)],
        json!({ "project": project }),
    );
    assert_eq!(applied.status, 200, "{}", applied.body);
    let refused = typing.event();
    assert_eq!(refused["state"], "refused", "{refused}");
    assert_eq!(refused["code"], "E_RULE_CHANNEL_SUBSCRIBE");

    stop_owner(port, secret, &mut owner, "policy successor test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn owner_state_publication_failure_finishes_rebind_then_stops() {
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
    let owner_path = root.join(".snapback/owner.json");
    let owner_json: Value = serde_json::from_slice(&fs::read(&owner_path).unwrap()).unwrap();
    let secret = owner_json["secret"].as_str().unwrap();
    let mut live = Sse::open(
        port,
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "alice",
    );
    let _initial = live.event();
    let project: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    fs::remove_file(&owner_path).unwrap();
    fs::create_dir(&owner_path).unwrap();

    let applied = request(
        port,
        "POST",
        "/control/apply",
        &[("X-Snapback-Control", secret)],
        json!({ "project": project }),
    );
    assert_eq!(applied.status, 400, "{}", applied.body);
    assert_eq!(applied.body["code"], "E_OWNER_STATE");
    assert_eq!(applied.body["applied"], true);
    assert!(applied.body["activeGeneration"].as_str().is_some());
    assert!(live.event()["state"].as_str().is_some());
    owner.wait();

    fs::remove_dir(&owner_path).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn stale_reused_pid_is_reclaimed_only_by_a_new_store_owner() {
    use std::os::unix::fs::PermissionsExt;

    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    fs::create_dir_all(root.join(".snapback")).unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let owner_path = root.join(".snapback/owner.json");
    fs::write(
        &owner_path,
        serde_json::to_vec(&json!({
            "pid": std::process::id(),
            "port": port,
            "url": format!("http://127.0.0.1:{port}"),
            "secret": "stale-secret",
            "generation": "stale-generation",
            "startedAt": 0,
            "mode": "dev",
            "project": root.canonicalize().unwrap(),
        }))
        .unwrap(),
    )
    .unwrap();
    fs::set_permissions(&owner_path, fs::Permissions::from_mode(0o600)).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let started = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .arg("--json")
        .env("SNAPBACK2_COMPILER", compiler(&root))
        .output()
        .unwrap();
    assert!(
        started.status.success(),
        "{} {}",
        String::from_utf8_lossy(&started.stdout),
        String::from_utf8_lossy(&started.stderr)
    );
    let active: Value = serde_json::from_slice(&fs::read(&owner_path).unwrap()).unwrap();
    let pid = active["pid"].as_u64().unwrap() as u32;
    assert_ne!(pid, std::process::id());
    let mut guard = DetachedOwnerGuard { pid };
    let stopped = Command::new(binary)
        .args(["dev", "--project"])
        .arg(&root)
        .args(["--stop", "--json"])
        .output()
        .unwrap();
    assert!(stopped.status.success());
    guard.pid = 0;
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn doctor_refuses_an_incompatible_compiler_worker_protocol() {
    for (name, response) in [
        (
            "wrong-id",
            r#"{ id: request.id + 1, ok: true, protocol: "snapback2/compiler-worker/v1", operations: ["compile", "seed", "journeys"] }"#,
        ),
        (
            "wrong-protocol",
            r#"{ id: request.id, ok: true, protocol: "snapback2/compiler-worker/v0", operations: ["compile", "seed", "journeys"] }"#,
        ),
        (
            "missing-operations",
            r#"{ id: request.id, ok: true, protocol: "snapback2/compiler-worker/v1" }"#,
        ),
        (
            "wrong-operations",
            r#"{ id: request.id, ok: true, protocol: "snapback2/compiler-worker/v1", operations: ["compile", "seed"] }"#,
        ),
    ] {
        let root = temp_root();
        let source = format!(
            r#"import {{ createInterface }} from "node:readline";
for await (const line of createInterface({{ input: process.stdin, crlfDelay: Infinity }})) {{
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({response}) + "\n");
}}
"#
        );
        let worker = write_worker(&root, &format!("{name}-compiler.mjs"), &source);
        let output = Command::new(env!("CARGO_BIN_EXE_snapback2"))
            .args(["doctor", "--json"])
            .env("SNAPBACK2_COMPILER", worker)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{name}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["compiler"]["answered"], false, "{name}");
        assert!(
            report["compiler"]["error"]
                .as_str()
                .unwrap()
                .contains("E_OWNER_COMPILER_PROTOCOL"),
            "{name}"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn doctor_refuses_missing_compiler_worker_dependencies() {
    for dependency in ["compiler-core.mjs", "typescript"] {
        let root = temp_root();
        let worker = compiler(&root);
        let missing = if dependency == "compiler-core.mjs" {
            worker.with_file_name(dependency)
        } else {
            worker
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("node_modules/typescript")
        };
        let metadata = fs::symlink_metadata(&missing).unwrap();
        if metadata.file_type().is_symlink() || metadata.is_file() {
            fs::remove_file(&missing).unwrap();
        } else {
            fs::remove_dir_all(&missing).unwrap();
        }
        let output = Command::new(env!("CARGO_BIN_EXE_snapback2"))
            .args(["doctor", "--json"])
            .env("SNAPBACK2_COMPILER", worker)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{dependency}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        let error = report["compiler"]["error"].as_str().unwrap();
        assert!(error.contains("E_OWNER_NO_COMPILER"), "{error}");
        assert!(error.contains(dependency), "{error}");
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn refused_destructive_successor_keeps_the_active_build_cache() {
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
    let build = root.join(".snapback/build");
    let before = ["project.json", "certificates.json", "api.d.ts"]
        .map(|name| fs::read(build.join(name)).unwrap());
    thread::sleep(Duration::from_millis(300));
    let schema = root.join("snapback/schema.ts");
    let source = fs::read_to_string(&schema)
        .unwrap()
        .replace("name: t.text(80)", "name: t.text(81)");
    fs::write(schema, source).unwrap();

    wait_for(Duration::from_secs(6), || {
        let current = status(port, secret);
        current["status"]["state"].eq("refused").then_some(())
    });
    let after = ["project.json", "certificates.json", "api.d.ts"]
        .map(|name| fs::read(build.join(name)).unwrap());
    assert_eq!(after, before);

    stop_owner(port, secret, &mut owner, "refused cache test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn reset_removes_writer_and_core_live_subscriptions() {
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
    let mut live = Sse::open(
        port,
        "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%7D",
        "alice",
    );
    let _ = live.event();
    let before = request(
        port,
        "GET",
        "/control/subscriptions",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(before.body.as_array().unwrap().len(), 1);

    let reset = request(
        port,
        "POST",
        "/control/reset",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(reset.status, 200, "{}", reset.body);
    let after = request(
        port,
        "GET",
        "/control/subscriptions",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(after.body, json!([]));

    drop(live);
    stop_owner(port, secret, &mut owner, "reset subscription test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn run_exit_codes_distinguish_rejected_mutations_from_typed_queries() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    let messages = root.join("snapback/messages.ts");
    let mut source = fs::read_to_string(&messages).unwrap();
    source.push_str(
        r#"
export const denied = query({}, ({ db }) => {
  db.require(false, "DENIED_QUERY");
  return null;
});
"#,
    );
    fs::write(messages, source).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let _ = owner.ready_line();
    let run = |op: &str, args: &str, persona: &str| {
        Command::new(binary)
            .args(["run", op, args, "--as", persona, "--json", "--project"])
            .arg(&root)
            .output()
            .unwrap()
    };
    let mutation_args =
        r#"{"conversationId":"conversation-1","recipientId":"dev:bob","body":"hello"}"#;
    let committed = run("messages.send", mutation_args, "alice");
    assert!(
        committed.status.success(),
        "{}",
        String::from_utf8_lossy(&committed.stdout)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&committed.stdout).unwrap()["state"],
        "committed"
    );
    let rejected = run("messages.send", mutation_args, "charlie");
    assert_eq!(rejected.status.code(), Some(1));
    assert_eq!(
        serde_json::from_slice::<Value>(&rejected.stdout).unwrap()["state"],
        "rejected"
    );
    let denied = run("messages.denied", "{}", "alice");
    assert!(denied.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&denied.stdout).unwrap()["state"],
        "denied"
    );

    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    stop_owner(
        owner_json["port"].as_u64().unwrap() as u16,
        owner_json["secret"].as_str().unwrap(),
        &mut owner,
        "run exit test",
    );
    assert_eq!(
        run(
            "messages.thread",
            r#"{"conversationId":"conversation-1"}"#,
            "alice"
        )
        .status
        .code(),
        Some(1)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unauthenticated_control_requests_are_refused_without_reading_slow_bodies() {
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
    let mut clients = Vec::new();
    for _ in 0..32 {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .write_all(
                format!(
                    "POST /control/reset HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .unwrap();
        clients.push(stream);
    }
    for mut stream in clients {
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        assert!(
            String::from_utf8_lossy(&response).starts_with("HTTP/1.1 403"),
            "{}",
            String::from_utf8_lossy(&response)
        );
    }
    assert_eq!(status(port, secret)["status"], "ready");
    stop_owner(port, secret, &mut owner, "slow unauthenticated body test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(not(feature = "hermes"))]
#[test]
fn slow_sse_writers_do_not_consume_json_or_control_worker_capacity() {
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
    let path =
        "/api/channel/typing/subscribe?args=%7B%22conversationId%22%3A%22conversation-1%22%7D";
    let mut clients = Vec::new();
    for _ in 0..63 {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Snapback-As: alice\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        stream.flush().unwrap();
        clients.push(stream);
    }
    thread::sleep(Duration::from_millis(300));
    let publish = request(
        port,
        "POST",
        "/api/channel/typing/publish",
        &[("X-Snapback-As", "alice")],
        json!({
            "args": { "conversationId": "conversation-1" },
            "payload": { "body": "x".repeat(900_000) },
        }),
    );
    assert_eq!(publish.status, 200, "{}", publish.body);
    let mut last = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(
        last,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Snapback-As: alice\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    last.flush().unwrap();
    clients.push(last);
    thread::sleep(Duration::from_millis(300));

    let query = request(
        port,
        "POST",
        "/api/query",
        &[("X-Snapback-As", "alice")],
        json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1" } }),
    );
    assert_eq!(query.status, 200, "{}", query.body);
    assert_eq!(status(port, secret)["status"], "ready");
    drop(clients);
    stop_owner(port, secret, &mut owner, "slow SSE writer capacity test");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn successful_hot_apply_never_pairs_successor_trace_with_predecessor_certificate() {
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
    let project_cache = root.join(".snapback/build/project.json");
    fs::remove_file(&project_cache).unwrap();
    assert!(
        Command::new("mkfifo")
            .arg(&project_cache)
            .status()
            .unwrap()
            .success()
    );
    thread::sleep(Duration::from_millis(300));

    let messages = root.join("snapback/messages.ts");
    let successor = fs::read_to_string(&messages)
        .unwrap()
        .replace("order: \"desc\", take: 50", "order: \"desc\", take: 49");
    fs::write(messages, successor).unwrap();
    wait_for(Duration::from_secs(6), || {
        let response = request(
            port,
            "POST",
            "/control/why",
            &[("X-Snapback-Control", secret)],
            json!({
                "op": "messages.thread",
                "args": { "conversationId": "conversation-1" },
                "as": "alice",
            }),
        );
        (response.status == 200 && response.body["trace"]["ranges"][0]["take"] == 49).then_some(())
    });

    let why = Command::new(binary)
        .args([
            "why",
            "messages.thread",
            r#"{"conversationId":"conversation-1"}"#,
            "--as",
            "alice",
            "--json",
            "--project",
        ])
        .arg(&root)
        .output()
        .unwrap();
    assert!(
        why.status.success(),
        "{}",
        String::from_utf8_lossy(&why.stdout)
    );
    let explanation: Value = serde_json::from_slice(&why.stdout).unwrap();
    assert_eq!(
        explanation["readSites"][0]["take"], explanation["authoritativeTrace"]["ranges"][0]["take"],
        "why combined a predecessor certificate with a successor trace: {explanation}"
    );

    let mut reader = fs::File::open(&project_cache).unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    stop_owner(port, secret, &mut owner, "successful cache promotion test");
    fs::remove_dir_all(root).unwrap();
}
