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

mod common;
#[cfg(not(feature = "hermes"))]
mod owner_auth;
mod owner_cases;
mod owner_support;
mod owner_wire;
use owner_support::*;
#[cfg(not(feature = "hermes"))]
use owner_wire::Sse;
use owner_wire::{request, status};

#[test]
fn reset_seed_refusal_is_atomic_and_keeps_the_owner_running() {
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
fn dev_refuses_ambiguous_persona_and_bearer_before_dispatch() {
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

    let response = request(
        port,
        "GET",
        "/",
        &[
            ("X-Snapback-As", "alice"),
            ("Authorization", "Bearer session-token"),
        ],
        json!({}),
    );
    assert_eq!(response.status, 400, "{}", response.body);
    assert_eq!(response.body["code"], "E_AUTH_AMBIGUOUS");

    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": "ambiguous authority test" }),
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
    let compiler = compiler(&root);
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
            json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1", "c": null } }),
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
            "/api/subscribe?op=messages.thread&args=%7B%22conversationId%22%3A%22conversation-1%22%2C%22c%22%3Anull%7D",
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
        json!({ "op": "messages.thread", "args": { "conversationId": "conversation-1", "c": null } }),
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
    let root = temp_root();
    let compiler = compiler(&root);
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

    let scan = |site: &str| {
        json!({ "Scan": {
            "site": site, "table": "docs", "index": "byScope",
            "prefix": [{ "Variable": "scope" }], "order": "Asc",
            "take": { "Literal": 8 }, "after": null, "before": null,
            "range": null, "provenance": "Arg"
        }})
    };
    let sink = |site: &str, id: &str| {
        json!({ "Insert": {
            "table": "counts", "row": { "Object": {
                "id": { "Literal": { "Id": id } },
                "value": { "Builtin": { "builtin": "Len", "args": [scan(site)] } }
            }}
        }})
    };
    let two_sinks = json!({
        "schema": { "tables": {
            "docs": {
                "columns": { "id": "Id", "group": "Id", "owner": "Principal", "order": "Int" },
                "indexes": { "byId": { "columns": ["id"], "unique": true }, "byScope": { "columns": ["group", "order", "id"], "unique": false } },
                "rules": { "read": { "Eq": [{ "Field": "owner" }, "Viewer"] }, "insert": "Allow", "update": "Allow", "delete": "Allow" }, "constraints": []
            },
            "counts": {
                "columns": { "id": "Id", "value": "Int" },
                "indexes": { "byId": { "columns": ["id"], "unique": true } },
                "rules": { "read": "Allow", "insert": "Allow", "update": "Allow", "delete": "Allow" }, "constraints": []
            }
        }, "maintains": [], "channels": {}, "auth": { "password": false, "guests": false }, "effects": [] },
        "programs": [{
            "name": "docs.twoSinks", "kind": "Mutation", "args": { "scope": "Scalar" },
            "read_time_granularity_ms": null,
            "body": [sink("docs.first", "first"), sink("docs.second", "second"), { "Return": { "Literal": "Null" } }]
        }]
    });
    let two_sinks = run_with_stdin(binary, &["check", "--ir", "--json"], &two_sinks);
    assert_eq!(two_sinks.status.code(), Some(1));
    let two_sinks: Value = serde_json::from_slice(&two_sinks.stdout).unwrap();
    let errors = two_sinks["results"].as_array().unwrap();
    assert_eq!(errors.len(), 2, "{two_sinks}");
    assert!(
        errors
            .iter()
            .all(|item| item["error"]["code"] == "E_STRUCTURAL_COUNT")
    );
    assert!(errors.iter().any(|item| {
        item["error"]["message"]
            .as_str()
            .unwrap()
            .contains("docs.first")
    }));
    assert!(errors.iter().any(|item| {
        item["error"]["message"]
            .as_str()
            .unwrap()
            .contains("docs.second")
    }));

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
    let compiler = compiler(&root);
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
    let compiler = compiler(&root);
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
    let compiler = compiler(&root);
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
            r#"import {{ readFileSync, writeFileSync }} from "node:fs";
import {{ createInterface }} from "node:readline";
const project = JSON.parse(readFileSync({}, "utf8"));
writeFileSync({}, String(process.pid));
let compiles = 0;
for await (const line of createInterface({{ input: process.stdin, crlfDelay: Infinity }})) {{
  const request = JSON.parse(line);
  if (request.op === "compile" && compiles++ > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = request.op === "compile"
    ? {{ id: request.id, ok: true, project, sources: {{}}, apiDts: "", quarry: [], ms: 0 }}
    : {{ id: request.id, ok: true, seed: {{ personas: [], rows: {{}} }} }};
  process.stdout.write(JSON.stringify(response) + "\n");
}}
"#,
            serde_json::to_string(&project).unwrap(),
            serde_json::to_string(&root.join("compiler.pid")).unwrap()
        ),
    );
    let mut owner = ChildGuard::spawn(binary, &slow_worker, &root);
    owner.ready_line();
    let owner_json: Value =
        serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
    let pid = owner_json["pid"].as_u64().unwrap() as u32;
    let port = owner_json["port"].as_u64().unwrap() as u16;
    let secret = owner_json["secret"].as_str().unwrap().to_owned();
    let compiler_pid = fs::read_to_string(root.join("compiler.pid"))
        .unwrap()
        .parse::<u32>()
        .unwrap();
    // Let the watcher establish its initial fingerprint before changing the source.
    thread::sleep(Duration::from_millis(300));
    let messages = root.join("snapback/messages.q");
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
    wait_for(Duration::from_secs(2), || {
        (!process_alive(compiler_pid)).then_some(())
    });
    assert!(!root.join(".snapback/owner.json").exists());
    let log = fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
    assert!(log.contains("cancelled during owner shutdown"), "{log}");
    assert!(!log.contains("source watcher stop timeout"), "{log}");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn stop_refuses_when_the_recorded_pid_survives_the_deadline() {
    use std::os::unix::fs::PermissionsExt;

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
    fs::set_permissions(&owner_path, fs::Permissions::from_mode(0o600)).unwrap();

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
    use std::os::unix::fs::PermissionsExt;
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
        let owner_path = root.join(".snapback/owner.json");
        fs::write(&owner_path, &bytes).unwrap();
        fs::set_permissions(&owner_path, fs::Permissions::from_mode(0o600)).unwrap();
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
    }
    fs::remove_dir_all(root).unwrap();
}
