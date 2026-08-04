//! Black-box F0b lifecycle acceptance through the shipped executable.
//!
//! The test deliberately lets `fork create` exit before checking the detached
//! child, then exercises generated schema/functions, mutation, diff, stop,
//! exact drop, no-manifest readiness, injected-clock reap, and teardown of the
//! fork directory that contains runtime/telemetry residue.

use serde_json::Value;
use snapback::manifest::SchemaManifest;
use snapback::storage::LocalDatabase;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn snapback() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback"));
    command
        .stdin(Stdio::null())
        .env_remove("SNAPBACK_ADMIN_TOKEN");
    command
}

fn successful(mut command: Command, operation: &str) -> Value {
    let output = command
        .output()
        .unwrap_or_else(|error| panic!("spawn {operation}: {error}"));
    assert_success(&output, operation);
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{operation} stdout is not JSON: {error}"))
}

fn assert_success(output: &Output, operation: &str) {
    assert!(
        output.status.success(),
        "{operation} failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn fork_create(
    source: &Path,
    app_root: &Path,
    fork_root: &Path,
    ttl: &str,
    with_secrets: bool,
) -> Value {
    let mut command = snapback();
    command.args([
        "fork",
        "create",
        "--from",
        source.to_str().unwrap(),
        "--ttl",
        ttl,
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    if with_secrets {
        command.arg("--with-secrets");
    }
    successful(command, "fork create")
}

fn health(server_url: &str) -> Value {
    ureq::get(&format!("{}/health", server_url.trim_end_matches('/')))
        .call()
        .expect("detached fork child remains healthy after create exits")
        .into_json()
        .expect("fork health JSON")
}

fn fork_id(created: &Value) -> &str {
    created["data"]["receipt"]["lineage"]["forkId"]
        .as_str()
        .expect("fork id")
}

fn data_path(created: &Value, key: &str) -> PathBuf {
    PathBuf::from(
        created["data"][key]
            .as_str()
            .unwrap_or_else(|| panic!("fork create data.{key}")),
    )
}

struct ForkCleanup {
    fork_root: PathBuf,
    app_root: PathBuf,
    fork_ids: Vec<String>,
}

impl ForkCleanup {
    fn track(&mut self, fork_id: &str) {
        self.fork_ids.push(fork_id.to_owned());
    }
}

impl Drop for ForkCleanup {
    fn drop(&mut self) {
        for fork_id in &self.fork_ids {
            let _ = snapback()
                .args([
                    "fork",
                    "drop",
                    fork_id,
                    "--app-root",
                    self.app_root.to_str().unwrap(),
                    "--fork-root",
                    self.fork_root.to_str().unwrap(),
                ])
                .output();
        }
    }
}

#[test]
fn executable_fork_lifecycle_is_detached_exact_and_reap_safe() {
    let directory = tempfile::tempdir().expect("fork CLI fixture");
    let source = directory.path().join("parent.sqlite3");
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let todo_root = repo.join("demos/todo");
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(todo_root.join("snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent = LocalDatabase::open(&source).expect("parent database");
    parent.apply_schema(schema).expect("apply parent schema");
    drop(parent);

    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: todo_root.clone(),
        fork_ids: Vec::new(),
    };
    let created = fork_create(&source, &todo_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&created));
    assert_eq!(created["ok"], true);
    assert_eq!(created["data"]["secrets"], "scrubbed");
    let mut list = snapback();
    list.args([
        "fork",
        "list",
        "--app-root",
        todo_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let listed = successful(list, "fork list");
    let listed_forks = listed["data"]["forks"].as_array().expect("listed forks");
    assert_eq!(listed_forks.len(), 1);
    assert_eq!(
        listed_forks[0]["lineage"]["forkId"],
        fork_id(&created),
        "list returns the receipt-bound fork identity"
    );
    let destination = data_path(&created, "database")
        .parent()
        .expect("fork database parent")
        .to_path_buf();
    let ready = data_path(&created, "readyFile");
    let server_url = created["target"]["serverUrl"]
        .as_str()
        .expect("fork server URL");
    assert_eq!(health(server_url)["ok"], true);

    let descriptor: Value =
        serde_json::from_slice(&std::fs::read(&ready).expect("fork ready file"))
            .expect("ready JSON");
    let token_file = descriptor["adminTokenFile"]
        .as_str()
        .expect("fork admin token file");
    let token = std::fs::read_to_string(token_file)
        .expect("fork admin token")
        .trim()
        .to_owned();
    let mut run = snapback();
    run.args([
        "run",
        "--ready-file",
        ready.to_str().unwrap(),
        "--token",
        &token,
        "createTodo",
        "--args",
        r#"{"title":"fork lifecycle acceptance"}"#,
        "--user",
        "acceptance-user",
    ]);
    let mutation = successful(run, "fork mutation");
    assert_eq!(mutation["ok"], true);

    let mut diff = snapback();
    diff.args([
        "fork",
        "diff",
        fork_id(&created),
        "--app-root",
        todo_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let diff = successful(diff, "fork diff");
    assert!(
        diff["data"]["receipt"]["rows"]
            .as_array()
            .is_some_and(|rows| !rows.is_empty()),
        "mutation is visible in the attributed fork diff"
    );

    let mut drop_command = snapback();
    drop_command.args([
        "fork",
        "drop",
        fork_id(&created),
        "--app-root",
        todo_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let dropped = successful(drop_command, "fork drop");
    assert_eq!(dropped["data"]["dropped"], true);
    assert!(!destination.exists(), "drop removes exactly the fork tree");
    assert!(source.is_file(), "drop never changes the parent database");

    let empty_app = directory.path().join("empty-app");
    std::fs::create_dir(&empty_app).expect("empty app root");
    let expiring = fork_create(&source, &empty_app, &fork_root, "1s", true);
    cleanup.track(fork_id(&expiring));
    assert_eq!(
        expiring["data"]["secrets"],
        "copy-requested-source-absent"
    );
    let expiring_destination = data_path(&expiring, "database")
        .parent()
        .expect("expiring database parent")
        .to_path_buf();
    let expiring_url = expiring["target"]["serverUrl"]
        .as_str()
        .expect("expiring fork URL");
    assert_eq!(
        health(expiring_url)["ok"],
        true,
        "create re-verifies live identity even with no generated manifests"
    );
    let expires = expiring["data"]["receipt"]["lineage"]["expiresAtMs"]
        .as_u64()
        .expect("finite expiry");
    let mut reap = snapback();
    reap.args([
        "fork",
        "reap",
        "--now-ms",
        &expires.to_string(),
        "--app-root",
        empty_app.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let reaped = successful(reap, "fork reap");
    assert_eq!(
        reaped["data"]["receipt"]["reapedForkIds"],
        serde_json::json!([fork_id(&expiring)])
    );
    assert!(
        !expiring_destination.exists(),
        "reap waits for runtime/telemetry teardown before removing the whole fork tree"
    );
    assert!(source.is_file(), "reap never changes the parent database");
}
