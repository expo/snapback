//! Black-box F0b lifecycle acceptance through the shipped executable.
//!
//! The test deliberately lets `fork create` exit before checking the detached
//! child, then exercises generated schema/functions, mutation, diff, stop,
//! exact drop, no-manifest readiness, injected-clock reap, and teardown of the
//! fork directory that contains runtime/telemetry residue.

use serde_json::Value;
use snapback::manifest::SchemaManifest;
use snapback::storage::LocalDatabase;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::Duration;

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

fn successful_scalar(mut command: Command, operation: &str) -> String {
    let output = command
        .output()
        .unwrap_or_else(|error| panic!("spawn {operation}: {error}"));
    assert_success(&output, operation);
    String::from_utf8(output.stdout)
        .unwrap_or_else(|error| panic!("{operation} stdout is not UTF-8: {error}"))
        .trim()
        .to_owned()
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

fn wait_until_unhealthy(server_url: &str) {
    for _ in 0..60 {
        if ureq::get(&format!("{}/health", server_url.trim_end_matches('/')))
            .timeout(Duration::from_millis(250))
            .call()
            .is_err()
        {
            // Give the detached process time to complete its post-server
            // cleanup and become provably gone to the next lifecycle sweep.
            std::thread::sleep(Duration::from_millis(500));
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("fork server remained healthy past its finite expiry: {server_url}");
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

    let mut inspect = snapback();
    inspect.args([
        "fork",
        "inspect",
        fork_id(&created),
        "--app-root",
        todo_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let inspected = successful(inspect, "fork inspect");
    let status = &inspected["data"]["status"];
    assert_eq!(status["schemaVersion"], "snapback.fork-status.v1");
    assert_eq!(status["forkId"], fork_id(&created));
    assert_eq!(status["parentIdentityKind"], "recorded-source-provenance");
    assert_eq!(status["forkPointVersion"], 0);
    assert!(status["expiresAtMs"].as_u64().is_some());
    assert_eq!(status["processHealth"]["status"], "responding");
    assert_eq!(status["processHealth"]["responding"], true);
    assert_eq!(
        status["databasePath"],
        data_path(&created, "database").display().to_string()
    );
    assert_eq!(status["readyPath"], ready.display().to_string());
    assert_eq!(status["secretDisposition"], "scrubbed");
    assert_eq!(status["workerPosture"]["cron"], "inert");
    assert_eq!(status["workerPosture"]["jobs"], "inert");
    assert_eq!(status["workerPosture"]["assets"], "inert");
    assert_eq!(status["egressPosture"], "deny-all-v1");
    assert!(
        status["diffSummary"]["attributedRowCount"]
            .as_u64()
            .is_some_and(|count| count > 0)
    );
    assert!(status["diffSummary"].get("rows").is_none());

    for (format, expected) in [
        ("url", server_url.to_owned()),
        ("fork-id", fork_id(&created).to_owned()),
        (
            "database-path",
            data_path(&created, "database").display().to_string(),
        ),
        ("ready-path", ready.display().to_string()),
        ("admin-token-path", token_file.to_owned()),
    ] {
        let mut scalar = snapback();
        scalar.args([
            "fork",
            "inspect",
            fork_id(&created),
            "--app-root",
            todo_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
            "--format",
            format,
        ]);
        assert_eq!(
            successful_scalar(scalar, &format!("fork inspect --format {format}")),
            expected
        );
    }

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
    let expiring = fork_create(&source, &empty_app, &fork_root, "2s", true);
    cleanup.track(fork_id(&expiring));
    assert_eq!(expiring["data"]["secrets"], "copy-requested-source-absent");
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
    let expiring_ready = data_path(&expiring, "readyFile");
    let expiring_log = data_path(&expiring, "runtimeLog");
    let expiring_database = data_path(&expiring, "database");
    wait_until_unhealthy(expiring_url);
    assert!(
        expiring_ready.is_file(),
        "expiry shutdown retains the descriptor so reap can prove the old PID is gone"
    );
    let runtime_log = std::fs::read_to_string(&expiring_log).expect("fork expiry runtime log");
    assert!(
        runtime_log.contains("SNAPBACK_FORK_SERVER_EXPIRED"),
        "{runtime_log}"
    );
    let boot_error = match LocalDatabase::open(&expiring_database) {
        Ok(_) => panic!("an expired derived database must refuse a new boot"),
        Err(error) => error,
    };
    assert_eq!(
        boot_error.diagnostic.code,
        snapback::instance_fork::SERVER_EXPIRED_CODE
    );

    let replacement = fork_create(&source, &empty_app, &fork_root, "5m", false);
    cleanup.track(fork_id(&replacement));
    assert_eq!(
        replacement["data"]["automaticReap"]["reapedForkIds"],
        serde_json::json!([fork_id(&expiring)])
    );
    assert!(
        !expiring_destination.exists(),
        "the next create automatically reaps the expired proven target"
    );

    let expires = replacement["data"]["receipt"]["lineage"]["expiresAtMs"]
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
        serde_json::json!([fork_id(&replacement)])
    );
    assert!(
        !data_path(&replacement, "database")
            .parent()
            .expect("replacement destination")
            .exists(),
        "reap waits for runtime/telemetry teardown before removing the whole fork tree"
    );
    assert!(source.is_file(), "reap never changes the parent database");
}

/// A parent database carrying the Todo demo schema, the minimum a
/// `fork create` source needs (`SNAPBACK_FORK_APP_ID_REQUIRED`).
fn parent_with_schema(directory: &Path) -> PathBuf {
    let source = directory.join("parent.sqlite3");
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(repo.join("demos/todo/snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent = LocalDatabase::open(&source).expect("parent database");
    parent.apply_schema(schema).expect("apply parent schema");
    drop(parent);
    source
}

struct ParentServer {
    child: std::process::Child,
    ready: PathBuf,
    token: String,
    server_url: String,
}

impl ParentServer {
    fn start(database: &Path, directory: &Path) -> Self {
        let ready = directory.join("parent.ready.json");
        let log = File::create(directory.join("parent-runtime.log")).expect("parent log");
        let error_log = log.try_clone().expect("parent log clone");
        let child = snapback()
            .args([
                "start",
                "--db",
                database.to_str().unwrap(),
                "--port",
                "0",
                "--ready-file",
                ready.to_str().unwrap(),
            ])
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(error_log))
            .spawn()
            .expect("spawn parent server");
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while !ready.is_file() {
            assert!(
                std::time::Instant::now() < deadline,
                "parent server never wrote its ready descriptor"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        let descriptor: Value =
            serde_json::from_slice(&std::fs::read(&ready).expect("parent ready file"))
                .expect("parent ready JSON");
        let token = std::fs::read_to_string(
            descriptor["adminTokenFile"]
                .as_str()
                .expect("parent admin token file"),
        )
        .expect("parent admin token")
        .trim()
        .to_owned();
        let server_url = descriptor["serverUrl"]
            .as_str()
            .expect("parent server URL")
            .to_owned();
        assert_eq!(health(&server_url)["ok"], true);
        ParentServer {
            child,
            ready,
            token,
            server_url,
        }
    }

    fn run(&self, function: &str, args: &str, operation: &str) -> Value {
        let mut command = snapback();
        command.args([
            "run",
            "--ready-file",
            self.ready.to_str().unwrap(),
            "--token",
            &self.token,
            function,
            "--args",
            args,
            "--user",
            "acceptance-user",
        ]);
        successful(command, operation)
    }
}

impl Drop for ParentServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn todo_titles(database: &Path) -> Vec<String> {
    let conn = rusqlite::Connection::open(database).expect("open database read-only");
    let mut statement = conn
        .prepare("SELECT title FROM todos ORDER BY title")
        .expect("prepare todo title query");
    let titles = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("query todo titles")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect todo titles");
    titles
}

/// LLP 0185 Phase 3 item 1: writes committed to a live parent after the fork
/// point never appear in the existing fork, and fork-local writes never reach
/// the parent. This is the end-to-end complement to the module-level
/// `parent_commits_after_the_fork_point_are_invisible_to_the_published_fork`.
#[test]
fn live_parent_writes_after_fork_point_never_appear_in_the_fork() {
    let directory = tempfile::tempdir().expect("live-parent fixture");
    let source = directory.path().join("parent.sqlite3");
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let todo_root = repo.join("demos/todo");
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(todo_root.join("snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent_db = LocalDatabase::open(&source).expect("parent database");
    parent_db.apply_schema(schema).expect("apply parent schema");
    drop(parent_db);

    let parent = ParentServer::start(&source, directory.path());
    let mut load = snapback();
    load.args([
        "load",
        "--ready-file",
        parent.ready.to_str().unwrap(),
        "--token",
        &parent.token,
        "--functions",
        todo_root
            .join("snapback/generated/functions.manifest.json")
            .to_str()
            .unwrap(),
    ]);
    successful(load, "load parent functions");
    parent.run(
        "createTodo",
        r#"{"title":"before-fork"}"#,
        "parent pre-fork mutation",
    );

    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: todo_root.clone(),
        fork_ids: Vec::new(),
    };
    // Forking from the ready descriptor exercises the live-parent source
    // path: the copy is taken from a hot database under an active server.
    let created = fork_create(&parent.ready, &todo_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&created));
    let fork_database = data_path(&created, "database");
    let fork_point = created["data"]["receipt"]["lineage"]["forkPointVersion"]
        .as_u64()
        .expect("fork point version");

    parent.run(
        "createTodo",
        r#"{"title":"after-fork"}"#,
        "parent post-fork mutation",
    );
    assert_eq!(
        todo_titles(&source),
        vec!["after-fork".to_owned(), "before-fork".to_owned()],
        "the live parent committed its post-fork write"
    );
    assert_eq!(
        todo_titles(&fork_database),
        vec!["before-fork".to_owned()],
        "a parent write committed after the fork point never appears in the fork"
    );

    let fork_ready = data_path(&created, "readyFile");
    let fork_descriptor: Value =
        serde_json::from_slice(&std::fs::read(&fork_ready).expect("fork ready file"))
            .expect("fork ready JSON");
    let fork_token = std::fs::read_to_string(
        fork_descriptor["adminTokenFile"]
            .as_str()
            .expect("fork admin token file"),
    )
    .expect("fork admin token")
    .trim()
    .to_owned();
    let mut fork_mutation = snapback();
    fork_mutation.args([
        "run",
        "--ready-file",
        fork_ready.to_str().unwrap(),
        "--token",
        &fork_token,
        "createTodo",
        "--args",
        r#"{"title":"fork-local"}"#,
        "--user",
        "acceptance-user",
    ]);
    successful(fork_mutation, "fork-local mutation");
    assert_eq!(
        todo_titles(&fork_database),
        vec!["before-fork".to_owned(), "fork-local".to_owned()],
        "the fork accepts its own writes at its own head"
    );
    assert_eq!(
        todo_titles(&source),
        vec!["after-fork".to_owned(), "before-fork".to_owned()],
        "fork-local writes never reach the parent"
    );

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
    let diff = successful(diff, "fork diff after divergence");
    let receipt = &diff["data"]["receipt"];
    assert_eq!(receipt["forkPointVersion"].as_u64(), Some(fork_point));
    let rows = receipt["rows"].as_array().expect("diff rows");
    assert_eq!(
        rows.len(),
        1,
        "the diff attributes exactly the fork-local write, never post-fork parent progress"
    );
    assert_eq!(rows[0]["table"], "todos");
    assert_eq!(
        rows[0]["postImage"]["title"], "fork-local",
        "diff row is the fork-local todo: {}",
        rows[0]
    );
}

/// LLP 0185 Phase 3 item 5: a registry entry whose fork directory is already
/// gone (partial cleanup) must not wedge list, reap, or create for every
/// other fork — it is completed and reported, deterministically.
#[test]
fn stale_registry_partial_cleanup_never_wedges_list_reap_or_create() {
    let directory = tempfile::tempdir().expect("stale registry fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");
    std::fs::create_dir(&fork_root).unwrap();

    let intact = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-intact"),
        "stale-app",
        "stale-parent",
        1_000,
        61_000,
        false,
    )
    .expect("publish intact fixture");
    let stale = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-stale"),
        "stale-app",
        "stale-parent",
        1_000,
        61_000,
        false,
    )
    .expect("publish soon-stale fixture");
    // Simulate the partial-cleanup shape the 2026-08-03 dogfood run hit:
    // the directory is gone but the advisory registry entry survived.
    std::fs::remove_dir_all(fork_root.join("fork-stale")).unwrap();

    let mut list = snapback();
    list.args([
        "fork",
        "list",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let listed = successful(list, "fork list over a stale entry");
    let forks = listed["data"]["forks"].as_array().expect("bound forks");
    assert_eq!(forks.len(), 1);
    assert_eq!(forks[0]["lineage"]["forkId"], intact.lineage.fork_id);
    let unbound = listed["data"]["unboundRegistry"]
        .as_array()
        .expect("unbound registry entries");
    assert_eq!(unbound.len(), 1);
    assert_eq!(unbound[0]["forkId"], stale.lineage.fork_id);
    assert_eq!(unbound[0]["code"], "SNAPBACK_FORK_REGISTRY_STALE");

    let mut reap = snapback();
    reap.args([
        "fork",
        "reap",
        "--now-ms",
        "61000",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let reaped = successful(reap, "fork reap over a stale entry");
    assert_eq!(
        reaped["data"]["receipt"]["reapedForkIds"],
        serde_json::json!([intact.lineage.fork_id]),
        "the intact expired fork is reaped normally"
    );
    assert_eq!(
        reaped["data"]["clearedStaleRegistryIds"],
        serde_json::json!([stale.lineage.fork_id]),
        "the stale entry is completed, reported separately from real reaps"
    );
    assert!(!fork_root.join("fork-intact").exists());
    assert!(
        snapback::instance_fork::managed_registry_ids(&fork_root)
            .unwrap()
            .is_empty(),
        "no registry residue survives the sweep"
    );

    // The end-to-end wedge check: a fresh stale entry must not refuse the
    // next create; automatic reap completes it and says so.
    let wedge = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-wedge"),
        "stale-app",
        "stale-parent",
        1_000,
        61_000,
        false,
    )
    .expect("publish wedge fixture");
    std::fs::remove_dir_all(fork_root.join("fork-wedge")).unwrap();
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };
    let created = fork_create(&source, &app_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&created));
    assert_eq!(
        created["data"]["automaticReap"]["clearedStaleRegistryIds"],
        serde_json::json!([wedge.lineage.fork_id]),
        "create clears the stale entry instead of refusing forever"
    );
}

/// LLP 0185 Phase 3 item 5: simultaneously running forks bind distinct
/// OS-assigned ports, stay healthy together, and concurrent drops settle
/// without trampling each other's cleanup.
#[test]
fn concurrent_fork_creates_bind_distinct_ports_and_drop_cleanly() {
    let directory = tempfile::tempdir().expect("concurrent fork fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");

    let created: Vec<Value> = std::thread::scope(|scope| {
        let handles = (0..3)
            .map(|_| {
                let source = source.clone();
                let app_root = app_root.clone();
                let fork_root = fork_root.clone();
                scope.spawn(move || fork_create(&source, &app_root, &fork_root, "5m", false))
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("concurrent create"))
            .collect()
    });
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };
    for value in &created {
        cleanup.track(fork_id(value));
    }

    let mut ports = std::collections::BTreeSet::new();
    let mut ids = std::collections::BTreeSet::new();
    for value in &created {
        let url = value["target"]["serverUrl"].as_str().expect("fork URL");
        assert_eq!(health(url)["ok"], true, "every fork is healthy at once");
        let port = url
            .rsplit(':')
            .next()
            .and_then(|port| port.trim_end_matches('/').parse::<u16>().ok())
            .expect("fork port");
        ports.insert(port);
        ids.insert(fork_id(value).to_owned());
    }
    assert_eq!(ports.len(), 3, "simultaneous forks never collide on a port");
    assert_eq!(ids.len(), 3, "every create minted a distinct fork identity");

    let outcomes: Vec<std::process::Output> = std::thread::scope(|scope| {
        let handles = created
            .iter()
            .map(|value| {
                let fork_id = fork_id(value).to_owned();
                let app_root = app_root.clone();
                let fork_root = fork_root.clone();
                scope.spawn(move || {
                    snapback()
                        .args([
                            "fork",
                            "drop",
                            &fork_id,
                            "--app-root",
                            app_root.to_str().unwrap(),
                            "--fork-root",
                            fork_root.to_str().unwrap(),
                        ])
                        .output()
                        .expect("spawn concurrent drop")
                })
            })
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("concurrent drop"))
            .collect()
    });
    for outcome in &outcomes {
        assert_success(outcome, "concurrent fork drop");
    }
    assert!(
        snapback::instance_fork::managed_registry_ids(&fork_root)
            .unwrap()
            .is_empty(),
        "concurrent drops leave no registry residue"
    );
}

/// LLP 0185 Phase 3 item 5: a dead server (SIGKILL) and a deleted ready file
/// each settle into one deterministic, named lifecycle outcome.
#[test]
fn dead_server_and_missing_ready_file_settle_deterministically() {
    let directory = tempfile::tempdir().expect("dead server fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };

    // Case 1: the fork server dies without any cleanup (kill -9).
    let killed = fork_create(&source, &app_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&killed));
    let killed_ready = data_path(&killed, "readyFile");
    let descriptor: Value =
        serde_json::from_slice(&std::fs::read(&killed_ready).expect("ready file"))
            .expect("ready JSON");
    let pid = descriptor["pid"].as_u64().expect("fork pid").to_string();
    assert!(
        Command::new("kill")
            .args(["-9", &pid])
            .status()
            .expect("send SIGKILL")
            .success()
    );
    for _ in 0..100 {
        if !Command::new("kill")
            .args(["-0", &pid])
            .status()
            .expect("probe pid")
            .success()
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let mut inspect = snapback();
    inspect.args([
        "fork",
        "inspect",
        fork_id(&killed),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let inspected = successful(inspect, "inspect killed fork");
    assert_eq!(
        inspected["data"]["status"]["processHealth"]["status"], "stopped",
        "a SIGKILLed server is reported as provably stopped, not unknown"
    );
    assert!(
        inspected["diagnostics"]
            .as_array()
            .expect("inspect diagnostics")
            .iter()
            .any(|diagnostic| diagnostic["code"] == "SNAPBACK_FORK_REGISTRY_STALE"),
        "the surviving ready descriptor is called out as stale"
    );
    let mut drop_killed = snapback();
    drop_killed.args([
        "fork",
        "drop",
        fork_id(&killed),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let dropped = successful(drop_killed, "drop killed fork");
    assert_eq!(dropped["data"]["dropped"], true);
    assert_eq!(
        dropped["data"]["stoppedPid"],
        Value::Null,
        "nothing was left to stop; drop proves absence instead of signalling"
    );

    // Case 2: the ready descriptor is deleted while the server still runs.
    // Absence of the descriptor means process absence cannot be proved, so
    // drop fails closed with one named code and changes nothing.
    let orphan = fork_create(&source, &app_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&orphan));
    let orphan_ready = data_path(&orphan, "readyFile");
    let saved = std::fs::read(&orphan_ready).expect("save ready descriptor");
    std::fs::remove_file(&orphan_ready).expect("delete ready descriptor");
    let refused = snapback()
        .args([
            "fork",
            "drop",
            fork_id(&orphan),
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ])
        .output()
        .expect("run refused drop");
    assert!(!refused.status.success());
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("SNAPBACK_FORK_STOP_UNVERIFIED"),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
    assert!(
        data_path(&orphan, "database").is_file(),
        "a refused drop deletes nothing"
    );
    // Restoring the descriptor restores the provable path end to end.
    std::fs::write(&orphan_ready, saved).expect("restore ready descriptor");
    let mut drop_orphan = snapback();
    drop_orphan.args([
        "fork",
        "drop",
        fork_id(&orphan),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let dropped = successful(drop_orphan, "drop restored fork");
    assert_eq!(dropped["data"]["dropped"], true);
    assert!(dropped["data"]["stoppedPid"].as_u64().is_some());
}

#[test]
fn executable_fork_recover_repairs_one_finite_partial_publication() {
    let directory = tempfile::tempdir().expect("fork recovery fixture");
    let source = directory.path().join("parent.sqlite3");
    let parent = LocalDatabase::open(&source).expect("parent database");
    drop(parent);
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");
    std::fs::create_dir(&fork_root).unwrap();
    let destination = fork_root.join("fork-recover");
    let receipt = snapback::instance_fork::publish_managed(
        &source,
        &destination,
        "recovery-app",
        "recovery-parent",
        1_000,
        61_000,
        false,
    )
    .expect("publish finite fixture");
    File::create(destination.join(snapback::instance_fork::STAGING_SENTINEL))
        .expect("restore simulated S4 sentinel");
    assert_eq!(
        snapback::instance_fork::inspect_boot_at(&destination.join("parent.sqlite3"), 2_000)
            .unwrap_err()
            .diagnostic
            .code,
        "SNAPBACK_FORK_PUBLICATION_PARTIAL"
    );

    let mut recover = snapback();
    recover.args([
        "fork",
        "recover",
        destination.to_str().unwrap(),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let recovered = successful(recover, "fork recover");
    assert_eq!(recovered["operation"], "fork.recover");
    assert_eq!(recovered["data"]["disposition"], "published-recovered");
    assert_eq!(recovered["data"]["forkId"], receipt.lineage.fork_id);
    assert_eq!(
        recovered["data"]["registry"]["state"],
        "published",
        "recovery reconciles advisory registry when it is available"
    );
    assert!(
        snapback::instance_fork::inspect_boot_at(&destination.join("parent.sqlite3"), 2_000)
            .unwrap()
            .is_some()
    );

    let mut drop_command = snapback();
    drop_command.args([
        "fork",
        "drop",
        &receipt.lineage.fork_id,
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let dropped = successful(drop_command, "drop recovered fork");
    assert_eq!(dropped["data"]["dropped"], true);
    assert!(!destination.exists());

    let unbounded = fork_root.join("fork-unbounded");
    snapback::instance_fork::publish(
        &source,
        &unbounded,
        "recovery-app",
        "recovery-parent",
        1_000,
        None,
    )
    .expect("publish library-only unbounded fixture");
    File::create(unbounded.join(snapback::instance_fork::STAGING_SENTINEL))
        .expect("restore unbounded S4 sentinel");
    let mut refused = snapback();
    refused.args([
        "fork",
        "recover",
        unbounded.to_str().unwrap(),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let refused = refused.output().expect("run unbounded recovery");
    assert!(!refused.status.success());
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("SNAPBACK_FORK_TTL_INVALID"),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
}
