//! Black-box F0b lifecycle acceptance through the shipped executable.
//!
//! The test deliberately lets `fork create` exit before checking the detached
//! child, then exercises generated schema/functions, mutation, diff, stop,
//! exact drop, no-manifest readiness, injected-clock reap, and teardown of the
//! fork directory that contains runtime/telemetry residue.

use base64::Engine as _;
use serde_json::Value;
use sha2::Digest as _;
use snapback::manifest::SchemaManifest;
use snapback_kernel::storage::LocalDatabase;
use std::fs::File;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::Duration;

const VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV: &str =
    "SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG";
const FORK_DEV_GOVERNANCE_CONFIG: &str = "visibility-governance-dev-target-config.json";

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
    let stderr = String::from_utf8_lossy(&output.stderr);
    let referenced_log = stderr
        .lines()
        .find_map(|line| line.rsplit_once("; see ").map(|(_, path)| path.trim()))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .unwrap_or_default();
    assert!(
        output.status.success(),
        "{operation} failed\nstdout:\n{}\nstderr:\n{}\nreferenced runtime log:\n{}",
        String::from_utf8_lossy(&output.stdout),
        stderr,
        referenced_log,
    );
}

fn assert_refused(mut command: Command, operation: &str, code: &str) {
    let output = command
        .output()
        .unwrap_or_else(|error| panic!("spawn {operation}: {error}"));
    assert!(
        !output.status.success(),
        "{operation} unexpectedly succeeded\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let diagnostic = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        diagnostic.contains(code),
        "{operation} did not emit {code}:\n{diagnostic}"
    );
}

fn fork_create(
    source: &Path,
    app_root: &Path,
    fork_root: &Path,
    ttl: &str,
    with_secrets: bool,
) -> Value {
    fork_create_with_options(source, app_root, fork_root, ttl, with_secrets, false)
}

fn fork_create_with_options(
    source: &Path,
    app_root: &Path,
    fork_root: &Path,
    ttl: &str,
    with_secrets: bool,
    retain_base: bool,
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
    if retain_base {
        command.arg("--retain-base");
    }
    let governance_config = app_root.join(".snapback").join(FORK_DEV_GOVERNANCE_CONFIG);
    if governance_config.is_file() {
        command.env(VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV, governance_config);
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

fn process_is_running(pid: u64) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .expect("probe process")
        .success()
}

fn wait_for_pid_exit(pid: u64, label: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while process_is_running(pid) {
        assert!(
            std::time::Instant::now() < deadline,
            "{label} process {pid} remained live after its server stopped"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn wait_until_unhealthy(server_url: &str, ready_file: &Path) {
    for _ in 0..60 {
        if ureq::get(&format!("{}/health", server_url.trim_end_matches('/')))
            .timeout(Duration::from_millis(250))
            .call()
            .is_err()
        {
            let descriptor: Value = serde_json::from_slice(
                &std::fs::read(ready_file).expect("expired fork ready descriptor"),
            )
            .expect("expired fork ready JSON");
            let pid = descriptor["pid"].as_u64().expect("expired fork pid");
            wait_for_pid_exit(pid, "expired fork");
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

fn fork_admin_token(created: &Value) -> String {
    let ready = data_path(created, "readyFile");
    let descriptor: Value = serde_json::from_slice(
        &std::fs::read(&ready).unwrap_or_else(|error| panic!("read {}: {error}", ready.display())),
    )
    .expect("fork ready descriptor JSON");
    std::fs::read_to_string(
        descriptor["adminTokenFile"]
            .as_str()
            .expect("fork admin token file"),
    )
    .expect("fork admin token")
    .trim()
    .to_owned()
}

fn copy_todo_app_root(destination: &Path) {
    let generated = destination.join("snapback/generated");
    std::fs::create_dir_all(&generated).expect("create copied Todo generated directory");
    let source_backend =
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("demos/todo/snapback");
    let source = source_backend.join("generated");
    for artifact in ["schema.manifest.json", "functions.manifest.json"] {
        std::fs::copy(source.join(artifact), generated.join(artifact))
            .unwrap_or_else(|error| panic!("copy Todo {artifact}: {error}"));
    }
    let repository = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let config_dir = destination.join(".snapback");
    std::fs::create_dir_all(&config_dir).expect("create fork governance config directory");
    let output = Command::new("node")
        .arg(repository.join("scripts/mint-visibility-governance-dev-config.mjs"))
        .arg(source_backend)
        .arg("--out")
        .arg(config_dir.join(FORK_DEV_GOVERNANCE_CONFIG))
        .current_dir(&repository)
        .output()
        .expect("mint fork visibility-governance dev config");
    assert_success(&output, "mint fork visibility-governance dev config");
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
    let todo_root = directory.path().join("todo-app");
    copy_todo_app_root(&todo_root);
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(todo_root.join("snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent = LocalDatabase::open(&source).expect("parent database");
    parent
        .schema_seed()
        .apply_schema(schema)
        .expect("apply parent schema");
    drop(parent);

    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: todo_root.clone(),
        fork_ids: Vec::new(),
    };
    let created = fork_create_with_options(&source, &todo_root, &fork_root, "5m", false, true);
    cleanup.track(fork_id(&created));
    assert_eq!(created["ok"], true);
    assert_eq!(created["data"]["secrets"], "scrubbed");
    let writer_coverage = &created["data"]["writerCoverageReceipt"];
    assert_eq!(
        writer_coverage["schemaVersion"],
        "snapback.fork-app-row-coverage.v1"
    );
    assert_eq!(writer_coverage["profile"], "derived-fork-app-rows-v1");
    assert_eq!(
        writer_coverage["forkPointVersion"],
        created["data"]["receipt"]["lineage"]["forkPointVersion"]
    );
    assert_eq!(
        writer_coverage["activationHeadVersion"],
        writer_coverage["forkPointVersion"]
    );
    assert!(
        writer_coverage["manifestDigest"]
            .as_str()
            .is_some_and(|digest| digest.starts_with("sha256:"))
    );
    assert_eq!(
        writer_coverage["coveredLanes"],
        serde_json::json!([
            "derivedForkHostChildAppRowJournal",
            "derivedForkOrdinaryAppRowJournal"
        ])
    );
    assert!(
        writer_coverage["uncoveredLanes"]
            .as_array()
            .is_some_and(|lanes| !lanes.is_empty())
    );
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
    assert_eq!(
        diff["data"]["receipt"]["schemaVersion"],
        "snapback.fork-journal-diff.v3"
    );
    assert_eq!(diff["data"]["receipt"]["attribution"], "absent-v1");
    assert_eq!(
        diff["data"]["receipt"]["base"]["versionBoundary"],
        "exclusive"
    );
    assert_eq!(
        diff["data"]["receipt"]["head"]["versionBoundary"],
        "inclusive"
    );
    assert!(
        diff["data"]["receipt"]["receiptDigest"]
            .as_str()
            .is_some_and(|digest| digest.starts_with("sha256:"))
    );
    assert!(
        diff["data"]["receipt"]["rows"]
            .as_array()
            .is_some_and(|rows| !rows.is_empty()),
        "mutation is visible in the fork journal diff"
    );

    let mut net_diff = snapback();
    net_diff.args([
        "fork",
        "diff",
        fork_id(&created),
        "--net",
        "--app-root",
        todo_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let net_diff = successful(net_diff, "authorizer-backed fork net diff");
    let net_receipt = &net_diff["data"]["receipt"];
    assert_eq!(net_receipt["schemaVersion"], "snapback.fork-net-diff.v3");
    assert_eq!(net_receipt["base"]["versionBoundary"], "exclusive");
    assert_eq!(net_receipt["head"]["versionBoundary"], "inclusive");
    assert!(
        net_receipt["receiptDigest"]
            .as_str()
            .is_some_and(|digest| digest.starts_with("sha256:"))
    );
    assert_eq!(
        net_receipt["completeness"],
        "registered-connection-defensive-app-rows-v1"
    );
    assert_eq!(net_receipt["attribution"], "absent-v1");
    assert_eq!(
        net_receipt["writerCoverage"]["coverageWindow"],
        "fork-point-to-observed-head-verified"
    );
    assert_eq!(
        net_receipt["writerCoverage"]["coveredLanes"],
        writer_coverage["coveredLanes"]
    );
    assert_eq!(
        net_receipt["rows"][0]["postImage"]["completed"], false,
        "the independent oracle emits the schema-decoded logical row"
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
        status["diffSummary"]["journalRowCount"]
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
    wait_until_unhealthy(expiring_url, &expiring_ready);
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

/// The explicit fork root is a storage location, never an authority boundary.
/// Two independent app roots with the same logical app id may share it, but
/// every projection, credential disclosure, mutation, and cleanup command is
/// bound to the invoking canonical app root.
#[test]
fn same_app_id_app_roots_cannot_cross_select_a_shared_fork_root() {
    let directory = tempfile::tempdir().expect("shared fork-root fixture");
    let app_a = directory.path().join("app-a");
    let app_b = directory.path().join("app-b");
    copy_todo_app_root(&app_a);
    copy_todo_app_root(&app_b);
    let data_a = directory.path().join("data-a");
    let data_b = directory.path().join("data-b");
    std::fs::create_dir_all(&data_a).unwrap();
    std::fs::create_dir_all(&data_b).unwrap();
    let source_a = parent_with_schema(&data_a);
    let source_b = parent_with_schema(&data_b);
    let fork_root = directory.path().join("shared-forks");
    let created_a = fork_create(&source_a, &app_a, &fork_root, "5m", false);
    let created_b = fork_create(&source_b, &app_b, &fork_root, "5m", false);
    let id_a = fork_id(&created_a).to_owned();
    let id_b = fork_id(&created_b).to_owned();
    let destination_a = data_path(&created_a, "database")
        .parent()
        .expect("fork A destination")
        .to_path_buf();
    let destination_b = data_path(&created_b, "database")
        .parent()
        .expect("fork B destination")
        .to_path_buf();
    let mut cleanup_a = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_a.clone(),
        fork_ids: vec![id_a.clone()],
    };
    let mut cleanup_b = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_b.clone(),
        fork_ids: vec![id_b.clone()],
    };

    for (app_root, own_id, hidden_id) in [(&app_a, &id_a, &id_b), (&app_b, &id_b, &id_a)] {
        let listed = successful(
            {
                let mut command = snapback();
                command.args([
                    "fork",
                    "list",
                    "--app-root",
                    app_root.to_str().unwrap(),
                    "--fork-root",
                    fork_root.to_str().unwrap(),
                ]);
                command
            },
            "root-bound fork list",
        );
        let ids = listed["data"]["forks"]
            .as_array()
            .expect("fork list")
            .iter()
            .map(|entry| entry["lineage"]["forkId"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec![own_id.as_str()]);
        assert!(!ids.contains(&hidden_id.as_str()));
    }

    for (verb, trailing) in [
        ("inspect", Vec::<&str>::new()),
        ("inspect", vec!["--format", "admin-token-path"]),
        ("diff", Vec::<&str>::new()),
        ("renew", vec!["--ttl", "10m"]),
        ("drop", Vec::<&str>::new()),
    ] {
        let mut command = snapback();
        command.args(["fork", verb, &id_b]);
        command.args(trailing);
        command.args([
            "--app-root",
            app_a.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ]);
        assert_refused(
            command,
            &format!("app A {verb} of app B fork"),
            snapback::instance_fork::APP_BINDING_MISMATCH_CODE,
        );
    }
    let mut recover = snapback();
    recover.args([
        "fork",
        "recover",
        destination_b.to_str().unwrap(),
        "--app-root",
        app_a.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    assert_refused(
        recover,
        "app A recovery of app B fork",
        snapback::instance_fork::APP_BINDING_MISMATCH_CODE,
    );
    assert!(destination_a.is_dir() && destination_b.is_dir());

    let ready_a = data_path(&created_a, "readyFile");
    let ready_b = data_path(&created_b, "readyFile");
    let token_a = fork_admin_token(&created_a);
    let token_b = fork_admin_token(&created_b);
    for (ready, wrong_token, label) in [
        (&ready_a, &token_b, "app B credential against app A fork"),
        (&ready_b, &token_a, "app A credential against app B fork"),
    ] {
        let output = snapback()
            .args([
                "run",
                "--ready-file",
                ready.to_str().unwrap(),
                "--token",
                wrong_token,
                "createTodo",
                "--args",
                r#"{"title":"cross-root"}"#,
                "--user",
                "acceptance-user",
            ])
            .output()
            .unwrap_or_else(|error| panic!("spawn {label}: {error}"));
        assert!(!output.status.success(), "{label} must be refused");
    }
    for (ready, token, title, label) in [
        (&ready_a, &token_a, "only-a", "app A own mutation"),
        (&ready_b, &token_b, "only-b", "app B own mutation"),
    ] {
        let mut command = snapback();
        command.args([
            "run",
            "--ready-file",
            ready.to_str().unwrap(),
            "--token",
            token,
            "createTodo",
            "--args",
            &format!(r#"{{"title":"{title}"}}"#),
            "--user",
            "acceptance-user",
        ]);
        successful(command, label);
    }
    assert_eq!(
        todo_titles(&data_path(&created_a, "database")),
        vec!["only-a"]
    );
    assert_eq!(
        todo_titles(&data_path(&created_b, "database")),
        vec!["only-b"]
    );

    let expires_b = created_b["data"]["receipt"]["lineage"]["expiresAtMs"]
        .as_u64()
        .expect("fork B expiry");
    let reaped = successful(
        {
            let mut command = snapback();
            command.args([
                "fork",
                "reap",
                "--now-ms",
                &expires_b.to_string(),
                "--app-root",
                app_b.to_str().unwrap(),
                "--fork-root",
                fork_root.to_str().unwrap(),
            ]);
            command
        },
        "app B root-bound reap",
    );
    assert_eq!(
        reaped["data"]["receipt"]["reapedForkIds"],
        serde_json::json!([id_b])
    );
    assert!(
        destination_a.is_dir(),
        "app B reap cannot delete app A fork"
    );
    assert!(!destination_b.exists(), "app B reap deletes its own fork");
    cleanup_b.fork_ids.clear();

    let dropped_a = successful(
        {
            let mut command = snapback();
            command.args([
                "fork",
                "drop",
                &id_a,
                "--app-root",
                app_a.to_str().unwrap(),
                "--fork-root",
                fork_root.to_str().unwrap(),
            ]);
            command
        },
        "app A own drop",
    );
    assert_eq!(dropped_a["data"]["dropped"], true);
    assert!(!destination_a.exists());
    cleanup_a.fork_ids.clear();
}

/// Regression for the mint-vs-launch binding gap: lifecycle authority is
/// durable fork evidence, so diff must work before any ready descriptor or
/// server process exists while a sibling app root remains unable to select it.
#[test]
fn library_minted_never_launched_fork_diffs_only_for_its_owning_app_root() {
    let directory = tempfile::tempdir().expect("never-launched fork fixture");
    let source = parent_with_schema(directory.path());
    let owning_app = directory.path().join("owning-app");
    let sibling_app = directory.path().join("sibling-app");
    std::fs::create_dir(&owning_app).unwrap();
    std::fs::create_dir(&sibling_app).unwrap();
    let expected = snapback::instance_fork::ensure_expected_app(&owning_app, "todo")
        .expect("establish owning app identity");
    snapback::instance_fork::ensure_expected_app(&sibling_app, "todo")
        .expect("establish same-app-id sibling identity");
    let fork_root = directory.path().join("shared-forks");
    std::fs::create_dir(&fork_root).unwrap();
    let destination = fork_root.join("never-launched");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("wall clock")
        .as_millis() as u64;
    let mint = snapback::instance_fork::publish_managed_with_base(
        &source,
        &destination,
        &expected,
        "never-launched-parent",
        now_ms,
        now_ms + 3_600_000,
        false,
        true,
    )
    .expect("mint bound fork without launch");
    assert!(
        destination
            .join(snapback::instance_fork::APP_BINDING_RECEIPT_FILE)
            .is_file(),
        "mint publishes fork-local app binding before any launch"
    );
    assert!(
        std::fs::read_dir(&destination).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".ready.json")),
        "the fixture never publishes runtime readiness"
    );

    let database = destination.join("parent.sqlite3");
    let conn = rusqlite::Connection::open(&database).expect("open never-launched fork");
    conn.execute_batch(
        "BEGIN IMMEDIATE;
         INSERT INTO todos(_id,_version,_createdAt,_updatedAt,title,completed,userId)
         VALUES('never-launched-row',1,100,100,'mint-time binding',0,'user_bound');
         UPDATE _snapback_version SET version=1 WHERE id=1;
         INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
         VALUES(1,'todos','never-launched-row','insert','{}',100);
         COMMIT;",
    )
    .expect("write never-launched fork workload");
    drop(conn);

    for (extra, schema, operation) in [
        (
            Vec::<&str>::new(),
            "snapback.fork-journal-diff.v3",
            "attributed diff",
        ),
        (vec!["--net"], "snapback.fork-net-diff.v3", "net diff"),
    ] {
        let mut command = snapback();
        command.args(["fork", "diff", &mint.lineage.fork_id]);
        command.args(extra);
        command.args([
            "--app-root",
            owning_app.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ]);
        let envelope = successful(command, &format!("owning app {operation}"));
        assert_eq!(envelope["data"]["receipt"]["schemaVersion"], schema);
        assert_eq!(
            envelope["data"]["receipt"]["rows"]
                .as_array()
                .expect("diff rows")
                .len(),
            1
        );
    }

    for (extra, operation) in [
        (Vec::<&str>::new(), "attributed diff"),
        (vec!["--net"], "net diff"),
    ] {
        let mut command = snapback();
        command.args(["fork", "diff", &mint.lineage.fork_id]);
        command.args(extra);
        command.args([
            "--app-root",
            sibling_app.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ]);
        assert_refused(
            command,
            &format!("sibling app {operation}"),
            snapback::instance_fork::APP_BINDING_MISMATCH_CODE,
        );
    }

    let mut drop_command = snapback();
    drop_command.args([
        "fork",
        "drop",
        &mint.lineage.fork_id,
        "--app-root",
        owning_app.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    successful(drop_command, "drop never-launched fork");
    assert!(!destination.exists());
}

/// A parent database carrying the Todo demo schema, the minimum a
/// `fork create` source needs (`SNAPBACK_FORK_APP_ID_REQUIRED`).
fn parent_with_schema(directory: &Path) -> PathBuf {
    let source = directory.join("parent.sqlite3");
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(repo.join("demos/todo/snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent = LocalDatabase::open(&source).expect("parent database");
    parent
        .schema_seed()
        .apply_schema(schema)
        .expect("apply parent schema");
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
        Self::start_with_artifacts(database, directory, None)
    }

    fn start_with_artifacts(
        database: &Path,
        directory: &Path,
        startup_artifacts: Option<&Path>,
    ) -> Self {
        let ready = directory.join("parent.ready.json");
        let log = File::create(directory.join("parent-runtime.log")).expect("parent log");
        let error_log = log.try_clone().expect("parent log clone");
        let mut command = snapback();
        command.args([
            "start",
            "--db",
            database.to_str().unwrap(),
            "--port",
            "0",
            "--ready-file",
            ready.to_str().unwrap(),
        ]);
        if let Some(carrier) = startup_artifacts {
            command.args(["--startup-artifacts", carrier.to_str().unwrap()]);
        }
        let child = command
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

#[derive(Clone, Debug)]
struct UploadIntent {
    name: String,
    policy_hash: String,
    implementation_hash: String,
}

fn upload_intent(functions: &Value, exported_name: &str) -> UploadIntent {
    let intent = functions["assetUploadIntents"]
        .as_array()
        .expect("generated asset upload intents")
        .iter()
        .find(|intent| intent["exportedName"] == exported_name)
        .unwrap_or_else(|| panic!("generated upload intent {exported_name}"));
    UploadIntent {
        name: intent["exportedName"]
            .as_str()
            .expect("upload intent exported name")
            .to_owned(),
        policy_hash: intent["intentPolicyHash"]
            .as_str()
            .expect("upload intent policy hash")
            .to_owned(),
        implementation_hash: intent["implementationHash"]
            .as_str()
            .expect("upload intent implementation hash")
            .to_owned(),
    }
}

fn session_request(method: &str, url: &str, bearer: &str) -> ureq::Request {
    ureq::request(method, url)
        .set("authorization", &format!("Bearer {bearer}"))
        .set("x-snapback-auth-client-protocol", "1")
}

fn json_response(response: Result<ureq::Response, ureq::Error>, operation: &str) -> Value {
    match response {
        Ok(response) => response
            .into_json()
            .unwrap_or_else(|error| panic!("{operation} response JSON: {error}")),
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_else(|error| format!("<unreadable: {error}>"));
            panic!("{operation} failed with HTTP {status}: {body}");
        }
        Err(error) => panic!("{operation} transport failed: {error}"),
    }
}

fn response_status(response: Result<ureq::Response, ureq::Error>, operation: &str) -> u16 {
    match response {
        Ok(response) => response.status(),
        Err(ureq::Error::Status(status, _)) => status,
        Err(error) => panic!("{operation} transport failed: {error}"),
    }
}

fn minted_session(ready: &Path, token: &str, email: &str) -> Value {
    let mut command = snapback();
    command.args([
        "session",
        "mint",
        "--email",
        email,
        "--ready-file",
        ready.to_str().unwrap(),
        "--token",
        token,
    ]);
    let minted = successful(command, "mint ordinary asset session");
    assert_eq!(minted["ok"], true);
    assert!(minted["data"]["token"].as_str().is_some());
    assert!(minted["data"]["session"]["userId"].as_str().is_some());
    minted["data"].clone()
}

/// The full client-facing production path: generated intent identity,
/// reservation, checksummed TUS transfer, and digest-declared finalization.
fn upload_over_asset_routes(
    server_url: &str,
    bearer: &str,
    intent: &UploadIntent,
    bytes: &[u8],
    file_name: &str,
    content_type: &str,
) -> String {
    let created = json_response(
        session_request(
            "POST",
            &format!("{}/assets/attempts", server_url.trim_end_matches('/')),
            bearer,
        )
        .send_json(serde_json::json!({
            "intentId": intent.name,
            "intentPolicyHash": intent.policy_hash,
            "implementationHash": intent.implementation_hash,
            "args": {},
            "declaredFilename": file_name,
            "declaredLength": bytes.len(),
            "declaredContentType": content_type,
        })),
        "create asset attempt",
    );
    let asset_id = created["task"]["assetId"]
        .as_str()
        .expect("created asset id")
        .to_owned();
    let attempt_id = created["task"]["attemptId"]
        .as_str()
        .expect("created attempt id")
        .to_owned();
    let upload_url = created["transfer"]["uploadUrl"]
        .as_str()
        .expect("TUS upload URL");
    let checksum = base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(bytes));
    let patched = session_request(
        "PATCH",
        &format!("{}{}", server_url.trim_end_matches('/'), upload_url),
        bearer,
    )
    .set("tus-resumable", "1.0.0")
    .set("content-type", "application/offset+octet-stream")
    .set("upload-offset", "0")
    .set("upload-checksum", &format!("sha256 {checksum}"))
    .send_bytes(bytes);
    match patched {
        Ok(response) => assert_eq!(response.status(), 204, "TUS PATCH status"),
        Err(ureq::Error::Status(status, response)) => panic!(
            "TUS PATCH failed with HTTP {status}: {}",
            response.into_string().unwrap_or_default()
        ),
        Err(error) => panic!("TUS PATCH transport failed: {error}"),
    }
    let digest = format!("{:x}", sha2::Sha256::digest(bytes));
    let finalized = json_response(
        session_request(
            "POST",
            &format!(
                "{}/assets/attempts/{}/finalize",
                server_url.trim_end_matches('/'),
                attempt_id
            ),
            bearer,
        )
        .send_json(serde_json::json!({
            "attemptId": attempt_id,
            "lifecycleGeneration": 1,
            "declaredDigest": digest,
        })),
        "finalize asset attempt",
    );
    assert_eq!(finalized["task"]["assetId"], asset_id);
    assert_eq!(finalized["task"]["availability"], "ready");
    assert_eq!(finalized["task"]["integrityGrade"], "end-to-end-verified");
    asset_id
}

fn issue_signed_url(server_url: &str, bearer: &str, asset_id: &str) -> String {
    let response = json_response(
        session_request(
            "POST",
            &format!(
                "{}/assets/records/{}/signed-url",
                server_url.trim_end_matches('/'),
                asset_id
            ),
            bearer,
        )
        .send_json(serde_json::json!({ "variant": "primary" })),
        "issue private-signed asset URL",
    );
    response["url"]
        .as_str()
        .expect("origin-relative signed URL")
        .to_owned()
}

fn signed_bytes(server_url: &str, signed_url: &str) -> Vec<u8> {
    let response = ureq::get(&format!(
        "{}{}",
        server_url.trim_end_matches('/'),
        signed_url
    ))
    .call()
    .unwrap_or_else(|error| panic!("signed asset delivery failed: {error}"));
    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .expect("read signed asset bytes");
    assert!(!bytes.is_empty(), "signed delivery returns canonical bytes");
    bytes
}

fn signed_status(server_url: &str, signed_url: &str) -> u16 {
    response_status(
        ureq::get(&format!(
            "{}{}",
            server_url.trim_end_matches('/'),
            signed_url
        ))
        .call(),
        "signed asset delivery",
    )
}

fn delete_asset(server_url: &str, bearer: &str, asset_id: &str) {
    let response = session_request(
        "DELETE",
        &format!(
            "{}/assets/records/{}",
            server_url.trim_end_matches('/'),
            asset_id
        ),
        bearer,
    )
    .call();
    let deleted = json_response(response, "delete asset");
    assert_eq!(deleted["assetId"], asset_id);
    assert_eq!(deleted["availability"], "deleted");
}

fn signed_issue_status(server_url: &str, bearer: &str, asset_id: &str) -> u16 {
    response_status(
        session_request(
            "POST",
            &format!(
                "{}/assets/records/{}/signed-url",
                server_url.trim_end_matches('/'),
                asset_id
            ),
            bearer,
        )
        .send_json(serde_json::json!({ "variant": "primary" })),
        "issue private-signed asset URL",
    )
}

fn primary_blob_path(database: &Path, asset_id: &str) -> PathBuf {
    let conn =
        rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open asset database read-only");
    let physical_key: String = conn
        .query_row(
            "SELECT b.physical_key
             FROM _snapback_asset_renditions_v1 r
             JOIN _snapback_asset_blobs_v1 b ON b.blob_id = r.blob_id
             WHERE r.asset_id = ?1 AND r.variant_key = 'primary'",
            [asset_id],
            |row| row.get(0),
        )
        .expect("asset primary blob key");
    database
        .parent()
        .expect("database parent")
        .join("assets/blobs")
        .join(physical_key)
}

fn distinct_png(rgb: [u8; 3]) -> Vec<u8> {
    let image = image::RgbImage::from_pixel(8, 8, image::Rgb(rgb));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .expect("encode PNG fixture");
    bytes.into_inner()
}

fn asset_gc_sweep(ready: &Path, token: &str, now_ms: u64, operation: &str) -> Value {
    let mut command = snapback();
    command.args([
        "assets",
        "gc-sweep",
        "--now-ms",
        &now_ms.to_string(),
        "--ready-file",
        ready.to_str().unwrap(),
        "--token",
        token,
    ]);
    successful(command, operation)
}

fn todo_titles(database: &Path) -> Vec<String> {
    let conn =
        rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open database read-only");
    let mut statement = conn
        .prepare("SELECT title FROM todos ORDER BY title")
        .expect("prepare todo title query");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("query todo titles")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect todo titles")
}

/// LLP 0185 Phase 3 item 1: writes committed to a live parent after the fork
/// point never appear in the existing fork, and fork-local writes never reach
/// the parent. This is the end-to-end complement to the module-level
/// `parent_commits_after_the_fork_point_are_invisible_to_the_published_fork`.
#[test]
fn live_parent_writes_after_fork_point_never_appear_in_the_fork() {
    let directory = tempfile::tempdir().expect("live-parent fixture");
    let source = directory.path().join("parent.sqlite3");
    let todo_root = directory.path().join("todo-app");
    copy_todo_app_root(&todo_root);
    let schema: SchemaManifest = serde_json::from_slice(
        &std::fs::read(todo_root.join("snapback/generated/schema.manifest.json"))
            .expect("generated Todo schema"),
    )
    .expect("Todo schema manifest");
    let mut parent_db = LocalDatabase::open(&source).expect("parent database");
    parent_db
        .schema_seed()
        .apply_schema(schema)
        .expect("apply parent schema");
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
    // LLP 0185 Phase 3 item 2, over live HTTP: the parent's admin bearer is
    // stale pre-fork authority for the fork and must be refused; the fork's
    // freshly minted bearer must equally never work against the parent.
    let cross = |ready: &Path, token: &str, label: &str| {
        let output = snapback()
            .args([
                "run",
                "--ready-file",
                ready.to_str().unwrap(),
                "--token",
                token,
                "createTodo",
                "--args",
                r#"{"title":"must-never-commit"}"#,
                "--user",
                "acceptance-user",
            ])
            .output()
            .unwrap_or_else(|error| panic!("spawn {label}: {error}"));
        assert!(!output.status.success(), "{label} must be refused");
    };
    cross(
        &fork_ready,
        &parent.token,
        "parent bearer against the fork server",
    );
    cross(
        &parent.ready,
        &fork_token,
        "fork bearer against the parent server",
    );

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

/// @ref LLP 0158#open-questions — OQ5's local ruling requires a same-cut,
/// fork-private tree whose live upload, delivery/signing, deletion, GC, and
/// exact instance cleanup remain independent in both directions.
#[test]
fn live_fork_asset_lifecycle_is_private_gc_safe_and_exactly_reaped() {
    let directory = tempfile::tempdir().expect("live fork asset fixture");
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let fixture_generated = repo.join("tests/acceptance/fixtures/asset-conformance/generated");
    let schema: Value = serde_json::from_slice(
        &std::fs::read(fixture_generated.join("schema.manifest.json"))
            .expect("asset fixture schema"),
    )
    .expect("asset schema JSON");
    let functions: Value = serde_json::from_slice(
        &std::fs::read(fixture_generated.join("functions.manifest.json"))
            .expect("asset fixture functions"),
    )
    .expect("asset functions JSON");
    let share_upload = upload_intent(&functions, "shareUpload");

    // `fork create --app-root` consumes the normal generated layout. Keep a
    // private scratch app root so this test never mutates the shared fixture.
    let app_root = directory.path().join("asset-app");
    let generated = app_root.join("snapback/generated");
    std::fs::create_dir_all(&generated).expect("scratch generated directory");
    std::fs::copy(
        fixture_generated.join("schema.manifest.json"),
        generated.join("schema.manifest.json"),
    )
    .expect("copy asset schema");
    std::fs::copy(
        fixture_generated.join("functions.manifest.json"),
        generated.join("functions.manifest.json"),
    )
    .expect("copy asset functions");

    let parent_carrier = directory.path().join("parent-startup-artifacts.json");
    std::fs::write(
        &parent_carrier,
        serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "schema": schema,
            "functions": functions,
        }))
        .expect("serialize startup carrier"),
    )
    .expect("write startup carrier");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&parent_carrier, std::fs::Permissions::from_mode(0o600))
            .expect("startup carrier owner-only mode");
    }

    let source = directory.path().join("parent.sqlite3");
    let parent =
        ParentServer::start_with_artifacts(&source, directory.path(), Some(&parent_carrier));
    let parent_session = minted_session(&parent.ready, &parent.token, "fork-assets@example.test");
    let parent_bearer = parent_session["token"].as_str().expect("parent bearer");
    let parent_user = parent_session["session"]["userId"]
        .as_str()
        .expect("parent user id");

    // Distinct canonical pixels prevent app-local dedup from collapsing the
    // two ancestry blobs whose opposite-direction cleanup we prove.
    let parent_asset_a = upload_over_asset_routes(
        &parent.server_url,
        parent_bearer,
        &share_upload,
        &distinct_png([210, 20, 20]),
        "ancestry-a.png",
        "image/png",
    );
    let parent_asset_b = upload_over_asset_routes(
        &parent.server_url,
        parent_bearer,
        &share_upload,
        &distinct_png([20, 40, 210]),
        "ancestry-b.png",
        "image/png",
    );
    let parent_a_signed = issue_signed_url(&parent.server_url, parent_bearer, &parent_asset_a);
    let parent_b_signed = issue_signed_url(&parent.server_url, parent_bearer, &parent_asset_b);
    let parent_a_bytes = signed_bytes(&parent.server_url, &parent_a_signed);
    let parent_b_bytes = signed_bytes(&parent.server_url, &parent_b_signed);
    let parent_a_blob = primary_blob_path(&source, &parent_asset_a);
    let parent_b_blob = primary_blob_path(&source, &parent_asset_b);
    assert!(parent_a_blob.is_file() && parent_b_blob.is_file());
    assert_ne!(
        parent_a_blob, parent_b_blob,
        "fixtures stay physically distinct"
    );

    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };
    let created = fork_create(&parent.ready, &app_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&created));
    assert_eq!(created["data"]["assetCustody"], "fork-private-same-cut");
    let fork_database = data_path(&created, "database");
    let fork_destination = fork_database
        .parent()
        .expect("fork destination")
        .to_path_buf();
    let fork_startup_carrier = fork_destination.join("fork-startup-artifacts.json");
    assert!(
        fork_startup_carrier.is_file(),
        "the complete generated pair is retained for settled Sessions restarts"
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
    let fork_url = created["target"]["serverUrl"]
        .as_str()
        .expect("fork server URL");
    let fork_session = minted_session(&fork_ready, &fork_token, "fork-assets@example.test");
    let fork_bearer = fork_session["token"].as_str().expect("fork bearer");
    assert_eq!(
        fork_session["session"]["userId"], parent_user,
        "copied principal identity can reacquire fresh fork-local session custody"
    );

    let fork_a_blob = primary_blob_path(&fork_database, &parent_asset_a);
    let fork_b_blob = primary_blob_path(&fork_database, &parent_asset_b);
    assert!(fork_a_blob.is_file() && fork_b_blob.is_file());
    assert_ne!(
        fork_a_blob, parent_a_blob,
        "same physical key resolves under a different instance-private root"
    );
    assert_eq!(
        std::fs::read(&fork_a_blob).unwrap(),
        std::fs::read(&parent_a_blob).unwrap()
    );

    // The parent URL was minted before the cut. The copied asset exists, so
    // this 403 specifically witnesses fork signing-key rotation rather than
    // an absent record. Fresh fork URLs serve both copied assets.
    assert_eq!(signed_status(fork_url, &parent_a_signed), 403);
    let fork_a_signed = issue_signed_url(fork_url, fork_bearer, &parent_asset_a);
    let fork_b_signed = issue_signed_url(fork_url, fork_bearer, &parent_asset_b);
    assert_eq!(signed_bytes(fork_url, &fork_a_signed), parent_a_bytes);
    assert_eq!(signed_bytes(fork_url, &fork_b_signed), parent_b_bytes);

    // Upload a brand-new asset inside the live fork through the exact route
    // sequence the product client owns, not through host-ops or blob writes.
    let fork_uploaded = upload_over_asset_routes(
        fork_url,
        fork_bearer,
        &share_upload,
        &distinct_png([20, 190, 80]),
        "fork-only.png",
        "image/png",
    );
    let fork_uploaded_blob = primary_blob_path(&fork_database, &fork_uploaded);
    assert!(fork_uploaded_blob.is_file());
    let fork_uploaded_signed = issue_signed_url(fork_url, fork_bearer, &fork_uploaded);
    assert_eq!(
        signed_bytes(fork_url, &fork_uploaded_signed),
        std::fs::read(&fork_uploaded_blob).expect("read fork-uploaded canonical blob"),
        "fork signed delivery serves the canonical fork-private bytes"
    );
    assert!(
        signed_issue_status(&parent.server_url, parent_bearer, &fork_uploaded) >= 400,
        "the parent cannot discover or sign the fork-only asset"
    );
    assert!(
        signed_status(&parent.server_url, &fork_uploaded_signed) >= 400,
        "the parent cannot serve a URL issued for the fork-only asset"
    );
    let parent_fork_key = parent_a_blob
        .parent()
        .expect("parent blob root")
        .join(fork_uploaded_blob.file_name().expect("fork physical key"));
    assert!(
        !parent_fork_key.exists(),
        "fork upload never writes its object into the parent blob tree"
    );

    // Fork-side delete + GC owns only fork-private A. The same-ancestry A in
    // the parent remains signed, served, and physically present.
    delete_asset(fork_url, fork_bearer, &parent_asset_a);
    assert!(
        fork_a_blob.is_file(),
        "delete is logical until blob retention passes"
    );
    assert!(signed_status(fork_url, &fork_a_signed) >= 400);
    let gc_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("portable clock")
        .as_millis() as u64
        + snapback::assets::ASSET_BLOB_RETENTION_MS
        + 1_000;
    let fork_gc = asset_gc_sweep(&fork_ready, &fork_token, gc_now, "fork asset GC");
    assert!(
        fork_gc["data"]["report"]["blobObjectsDeleted"]
            .as_u64()
            .is_some_and(|count| count >= 1),
        "fork GC reports physical reclamation: {fork_gc}"
    );
    assert!(
        !fork_a_blob.exists(),
        "fork GC removes only fork-private A bytes"
    );
    assert!(
        parent_a_blob.is_file(),
        "fork GC never reaches the parent tree"
    );
    assert_eq!(
        signed_bytes(&parent.server_url, &parent_a_signed),
        parent_a_bytes
    );
    assert!(fork_b_blob.is_file() && fork_uploaded_blob.is_file());

    // The reverse direction: parent delete + GC owns only parent-private B;
    // the already-issued fork URL and fork-private bytes stay valid.
    delete_asset(&parent.server_url, parent_bearer, &parent_asset_b);
    let parent_gc = asset_gc_sweep(&parent.ready, &parent.token, gc_now, "parent asset GC");
    assert!(
        parent_gc["data"]["report"]["blobObjectsDeleted"]
            .as_u64()
            .is_some_and(|count| count >= 1),
        "parent GC reports physical reclamation: {parent_gc}"
    );
    assert!(
        !parent_b_blob.exists(),
        "parent GC removes parent-private B bytes"
    );
    assert!(
        fork_b_blob.is_file(),
        "parent GC never reaches the fork tree"
    );
    assert_eq!(signed_bytes(fork_url, &fork_b_signed), parent_b_bytes);

    // Exact drop removes the complete asset-bearing fork tree—including its
    // cold-start carrier and fork-only upload—without touching the parent.
    let mut drop_command = snapback();
    drop_command.args([
        "fork",
        "drop",
        fork_id(&created),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let dropped = successful(drop_command, "drop asset-bearing fork");
    assert_eq!(dropped["data"]["dropped"], true);
    assert!(!fork_destination.exists());
    assert!(!fork_startup_carrier.exists());
    assert!(
        !fork_uploaded_blob.exists(),
        "no fork-uploaded orphan survives drop"
    );
    assert!(parent_a_blob.is_file());
    assert_eq!(
        signed_bytes(&parent.server_url, &parent_a_signed),
        parent_a_bytes
    );

    // A second asset-bearing fork takes the deterministic reap path, proving
    // both exact cleanup verbs rather than treating drop as a proxy for reap.
    let reaped_fork = fork_create(&parent.ready, &app_root, &fork_root, "5m", false);
    cleanup.track(fork_id(&reaped_fork));
    let reaped_database = data_path(&reaped_fork, "database");
    let reaped_destination = reaped_database
        .parent()
        .expect("reaped destination")
        .to_path_buf();
    let reaped_blob = primary_blob_path(&reaped_database, &parent_asset_a);
    assert!(
        reaped_blob.is_file(),
        "reap fixture carries a copied asset blob"
    );
    let expires_at = reaped_fork["data"]["receipt"]["lineage"]["expiresAtMs"]
        .as_u64()
        .expect("reap fixture expiry");
    let mut reap = snapback();
    reap.args([
        "fork",
        "reap",
        "--now-ms",
        &expires_at.to_string(),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let reaped = successful(reap, "reap asset-bearing fork");
    assert_eq!(
        reaped["data"]["receipt"]["reapedForkIds"],
        serde_json::json!([fork_id(&reaped_fork)])
    );
    assert!(!reaped_destination.exists());
    assert!(!reaped_blob.exists(), "no copied fork blob survives reap");
    assert!(
        parent_a_blob.is_file(),
        "reap never touches the parent blob"
    );
    assert_eq!(health(&parent.server_url)["ok"], true);
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
    let expected = snapback::instance_fork::ensure_expected_app(&app_root, "todo")
        .expect("bind stale fixture to invoking app root");

    let intact = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-intact"),
        &expected,
        "stale-parent",
        1_000,
        61_000,
        false,
    )
    .expect("publish intact fixture");
    let stale = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-stale"),
        &expected,
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
        &expected,
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

#[cfg(unix)]
#[test]
fn detached_fork_server_closes_unrelated_inherited_descriptors_on_exec() {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::fs::OpenOptionsExt as _;
    use std::os::unix::process::CommandExt as _;

    let directory = tempfile::tempdir().expect("descriptor inheritance fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");

    // Open with O_CLOEXEC in the creating syscall. libc::pipe followed by
    // F_SETFD has a process-wide fork race: another parallel test can inherit
    // the writer during that gap and make this test blame the target server
    // for a descriptor held by an unrelated process.
    let caller_lease = std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(directory.path().join("unrelated-caller-descriptor.lock"))
        .expect("open caller descriptor lease");
    assert_eq!(
        unsafe { libc::flock(caller_lease.as_raw_fd(), libc::LOCK_EX) },
        0,
        "hold the caller-only descriptor lease"
    );
    let caller_lease_fd = caller_lease.as_raw_fd();
    const INHERITED_CALLER_FD: i32 = 198;

    let mut command = snapback();
    command.args([
        "fork",
        "create",
        "--from",
        source.to_str().unwrap(),
        "--ttl",
        "5m",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(caller_lease_fd, INHERITED_CALLER_FD) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = command
        .spawn()
        .expect("spawn fork create with inherited descriptor");
    drop(caller_lease);
    let output = child
        .wait_with_output()
        .expect("fork create exits after detached readiness");
    assert_success(&output, "fork create with inherited caller descriptor");
    let created: Value = serde_json::from_slice(&output.stdout).expect("fork create JSON");
    let mut cleanup = ForkCleanup {
        fork_root,
        app_root,
        fork_ids: vec![fork_id(&created).to_owned()],
    };

    let probe = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(directory.path().join("unrelated-caller-descriptor.lock"))
        .expect("open caller descriptor probe");
    let probe_result = unsafe { libc::flock(probe.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    let retained_by_server = if probe_result == 0 {
        assert_eq!(unsafe { libc::flock(probe.as_raw_fd(), libc::LOCK_UN) }, 0);
        false
    } else {
        let error = std::io::Error::last_os_error();
        assert_eq!(
            error.kind(),
            std::io::ErrorKind::WouldBlock,
            "descriptor probe failed for an unexpected reason: {error}"
        );
        true
    };

    let fork_id = cleanup.fork_ids.pop().unwrap();
    let output = snapback()
        .args([
            "fork",
            "drop",
            &fork_id,
            "--app-root",
            cleanup.app_root.to_str().unwrap(),
            "--fork-root",
            cleanup.fork_root.to_str().unwrap(),
        ])
        .output()
        .expect("drop descriptor inheritance fixture");
    assert_success(&output, "drop descriptor inheritance fixture");
    assert!(
        !retained_by_server,
        "the detached server retained an unrelated caller descriptor after the create CLI exited"
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
    let pid = descriptor["pid"].as_u64().expect("fork pid");
    assert!(
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .expect("send SIGKILL")
            .success()
    );
    wait_for_pid_exit(pid, "SIGKILLed fork");

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

/// LLP 0185 Phase 3 item 6: `fork renew` extends a live fork's finite expiry
/// end to end — the running server honors the moved expiry instead of dying
/// on its boot-time schedule — while shortening, exceeding the configured
/// maximum lifetime, and renewing unknown forks all refuse deterministically.
#[test]
fn executable_fork_renew_extends_a_live_fork_within_the_maximum() {
    let directory = tempfile::tempdir().expect("renew fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    copy_todo_app_root(&app_root);
    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };

    let created = fork_create(&source, &app_root, &fork_root, "5s", false);
    cleanup.track(fork_id(&created));
    assert_eq!(
        created["data"]["writerCoverageReceipt"]["schemaVersion"],
        "snapback.fork-app-row-coverage.v1",
        "renewal acceptance must exercise an armed complete-pair fork"
    );
    let original_expiry = created["data"]["receipt"]["lineage"]["expiresAtMs"]
        .as_u64()
        .expect("original expiry");
    let server_url = created["target"]["serverUrl"]
        .as_str()
        .expect("fork server URL")
        .to_owned();

    let mut renew = snapback();
    renew.args([
        "fork",
        "renew",
        fork_id(&created),
        "--ttl",
        "5m",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let renewed = successful(renew, "fork renew");
    let receipt = &renewed["data"]["receipt"];
    assert_eq!(receipt["schemaVersion"], "snapback.fork-renew.v1");
    assert_eq!(
        receipt["previousExpiresAtMs"].as_u64(),
        Some(original_expiry)
    );
    let new_expiry = receipt["expiresAtMs"].as_u64().expect("renewed expiry");
    assert!(new_expiry > original_expiry);
    assert_eq!(
        renewed["data"]["registry"]["lineage"]["expiresAtMs"].as_u64(),
        Some(new_expiry),
        "the registry carrier moved with the renewal"
    );

    // Refusals are deterministic and change nothing.
    let shorten = snapback()
        .args([
            "fork",
            "renew",
            fork_id(&created),
            "--ttl",
            "1ms",
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ])
        .output()
        .expect("run shortening renew");
    assert!(!shorten.status.success());
    assert!(
        String::from_utf8_lossy(&shorten.stderr).contains("SNAPBACK_FORK_TTL_INVALID"),
        "{}",
        String::from_utf8_lossy(&shorten.stderr)
    );
    let over_limit = snapback()
        .args([
            "fork",
            "renew",
            fork_id(&created),
            "--ttl",
            "30d",
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ])
        .output()
        .expect("run over-limit renew");
    assert!(!over_limit.status.success());
    assert!(
        String::from_utf8_lossy(&over_limit.stderr)
            .contains("SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED"),
        "{}",
        String::from_utf8_lossy(&over_limit.stderr)
    );

    // The live server outlives its boot-time expiry because renewal moved
    // the database lineage, which the expiry watchdog re-reads. Wait for the
    // watchdog's causal receipt instead of guessing at its scheduler margin.
    let runtime_log = data_path(&created, "runtimeLog");
    let observation_deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let output = std::fs::read_to_string(&runtime_log).unwrap_or_default();
        if output.contains("SNAPBACK_FORK_SERVER_RENEWAL_OBSERVED") {
            break;
        }
        assert!(
            std::time::Instant::now() < observation_deadline,
            "fork server never reported observing the renewed expiry; log:\n{output}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(
        health(&server_url)["ok"],
        true,
        "a renewed fork server keeps serving past its boot-time expiry"
    );

    // Reap at the superseded expiry finds nothing to do.
    let mut reap = snapback();
    reap.args([
        "fork",
        "reap",
        "--now-ms",
        &original_expiry.to_string(),
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let reaped = successful(reap, "reap at superseded expiry");
    assert_eq!(
        reaped["data"]["receipt"]["reapedForkIds"],
        serde_json::json!([]),
        "the renewed fork is not reap-eligible at its superseded expiry"
    );
}

#[test]
fn executable_fork_recover_completes_interrupted_renewal_on_an_armed_fork() {
    let directory = tempfile::tempdir().expect("armed renewal recovery fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    copy_todo_app_root(&app_root);
    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };
    let created = fork_create_with_options(&source, &app_root, &fork_root, "5m", false, true);
    cleanup.track(fork_id(&created));
    assert_eq!(
        created["data"]["writerCoverageReceipt"]["schemaVersion"],
        "snapback.fork-app-row-coverage.v1"
    );

    let ready = data_path(&created, "readyFile");
    let descriptor: Value = serde_json::from_slice(&std::fs::read(&ready).expect("ready file"))
        .expect("ready descriptor");
    let pid = descriptor["pid"].as_u64().expect("fork pid");
    assert!(
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .expect("stop armed fork before crash-cut renewal")
            .success()
    );
    wait_for_pid_exit(pid, "crash-cut fork");

    let expected = snapback::instance_fork::load_expected_app(&app_root)
        .expect("load armed fork app identity");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("wall clock")
        .as_millis() as u64;
    let cut = snapback::instance_fork::renew_managed_with_crash_cut_for_test(
        &fork_root,
        fork_id(&created),
        &expected,
        now_ms,
        10 * 60_000,
        snapback::instance_fork::RenewCut::AfterDatabaseUpdate,
    )
    .expect_err("inject renewal crash after the armed database update");
    assert_eq!(cut.diagnostic.code, "SNAPBACK_FORK_TEST_CRASH_CUT");
    let destination = data_path(&created, "database")
        .parent()
        .expect("fork destination")
        .to_path_buf();
    assert!(
        destination
            .join(snapback::instance_fork::STAGING_SENTINEL)
            .is_file()
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
    let recovered = successful(recover, "recover interrupted armed renewal");
    assert_eq!(recovered["data"]["disposition"], "published-recovered");
    assert!(
        !destination
            .join(snapback::instance_fork::STAGING_SENTINEL)
            .exists()
    );
    assert!(
        snapback::instance_fork::verified_derived_fork_app_row_coverage(&data_path(
            &created, "database"
        ))
        .expect("verify recovered armed coverage")
        .is_some()
    );

    let mut diff = snapback();
    diff.args([
        "fork",
        "diff",
        fork_id(&created),
        "--net",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let diff = successful(diff, "net diff after armed renewal recovery");
    assert_eq!(
        diff["data"]["receipt"]["completeness"],
        "registered-connection-defensive-app-rows-v1"
    );
}

/// LLP 0185 Phase 3 items 7/8: fork-count, byte, and diff-work limits refuse
/// deterministically through the executable, with the observed usage in the
/// diagnostic, and a refusal never deletes or half-creates anything.
#[test]
fn resource_limits_refuse_create_and_diff_without_residue() {
    let directory = tempfile::tempdir().expect("resource limit fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");
    std::fs::create_dir(&fork_root).unwrap();
    // A real future expiry: create's automatic sweep runs on the wall clock
    // and must not reap this fixture out from under the count check.
    let wall_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("wall clock")
        .as_millis() as u64;
    let expected = snapback::instance_fork::ensure_expected_app(&app_root, "todo")
        .expect("bind limits fixture to invoking app root");
    let existing = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-existing"),
        &expected,
        "limits-parent",
        wall_now,
        wall_now + 3_600_000,
        false,
    )
    .expect("publish existing fixture");

    let entries_before = std::fs::read_dir(&fork_root)
        .expect("scan fork root")
        .count();
    let refused_create = |extra: &[&str], expected_resource: &str| {
        let mut args = vec![
            "fork",
            "create",
            "--from",
            source.to_str().unwrap(),
            "--ttl",
            "5m",
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ];
        args.extend_from_slice(extra);
        let output = snapback()
            .args(&args)
            .output()
            .expect("run limited fork create");
        assert!(
            !output.status.success(),
            "create must refuse under {expected_resource}"
        );
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        assert!(
            stderr.contains("SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED")
                && stderr.contains(expected_resource),
            "expected {expected_resource} refusal, got:\n{stderr}"
        );
    };
    refused_create(&["--max-forks", "1"], "fork-count limit");
    refused_create(&["--max-fork-bytes", "1"], "per-fork byte limit");
    refused_create(&["--max-total-bytes", "1"], "total byte budget");
    assert_eq!(
        std::fs::read_dir(&fork_root)
            .expect("rescan fork root")
            .count(),
        entries_before,
        "a refused create leaves no staging or registry residue"
    );

    // Retained-history exhaustion through the executable diff surface.
    let database = fork_root.join("fork-existing/parent.sqlite3");
    let conn = rusqlite::Connection::open(&database).expect("open fork database");
    conn.execute("UPDATE _snapback_version SET version=3 WHERE id=1", [])
        .unwrap();
    for index in 1..=3 {
        conn.execute(
            "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
             VALUES(?1,'todos',?2,'insert','{}',100)",
            rusqlite::params![index, format!("todo-{index}")],
        )
        .unwrap();
    }
    drop(conn);
    let refused_diff = snapback()
        .args([
            "fork",
            "diff",
            &existing.lineage.fork_id,
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
            "--max-rows",
            "2",
        ])
        .output()
        .expect("run limited fork diff");
    assert!(!refused_diff.status.success());
    let stderr = String::from_utf8_lossy(&refused_diff.stderr).to_string();
    assert!(
        stderr.contains("SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED") && stderr.contains("diff-work"),
        "{stderr}"
    );
    let mut allowed_diff = snapback();
    allowed_diff.args([
        "fork",
        "diff",
        &existing.lineage.fork_id,
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
        "--max-rows",
        "3",
    ]);
    let receipt = successful(allowed_diff, "fork diff at the bound");
    assert_eq!(
        receipt["data"]["receipt"]["rows"]
            .as_array()
            .expect("diff rows")
            .len(),
        3
    );

    // Inspection: list reports usage against the default limits.
    let mut list = snapback();
    list.args([
        "fork",
        "list",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let listed = successful(list, "fork list usage projection");
    let usage = &listed["data"]["resourceUsage"];
    assert_eq!(usage["forkCount"], 1);
    assert!(usage["totalBytes"].as_u64().unwrap() > 0);
    assert!(usage["defaultLimits"]["maxForks"].as_u64().unwrap() >= 1);
}

/// A partial dev-manifest layout still uses the historical post-bind loader.
/// Because its schema is not active at the fork point, it must never inherit
/// the complete-pair path's authorizer-backed whole-window claim.
#[test]
fn partial_generated_layout_stays_journal_enumerated() {
    let directory = tempfile::tempdir().expect("partial generated-layout fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("partial-app");
    let generated = app_root.join("snapback/generated");
    std::fs::create_dir_all(&generated).expect("partial generated directory");
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    std::fs::copy(
        repo.join("demos/todo/snapback/generated/schema.manifest.json"),
        generated.join("schema.manifest.json"),
    )
    .expect("copy only the generated schema");

    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };
    let created = fork_create_with_options(&source, &app_root, &fork_root, "5m", false, true);
    cleanup.track(fork_id(&created));
    assert_eq!(created["data"]["writerCoverageReceipt"], Value::Null);
    assert!(
        health(
            created["target"]["serverUrl"]
                .as_str()
                .expect("partial fork URL")
        )["ok"]
            .as_bool()
            .unwrap_or(false)
    );
    assert!(
        !data_path(&created, "database")
            .with_file_name(snapback::instance_fork::APP_ROW_COVERAGE_RECEIPT_FILE)
            .exists(),
        "the partial path must not write fork-point coverage evidence"
    );

    let mut net = snapback();
    net.args([
        "fork",
        "diff",
        fork_id(&created),
        "--net",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let receipt = successful(net, "partial-layout fork diff --net");
    assert_eq!(
        receipt["data"]["receipt"]["completeness"],
        "journal-enumerated-v1"
    );
    assert_eq!(
        receipt["data"]["receipt"]["writerCoverage"]["coverageWindow"],
        "unverified"
    );
}

/// LLP 0185 Phase 4: the exact net receipt through the executable — named
/// substrate and completeness, oracle-verified journal consistency, and a
/// deterministic refusal when the fork has no retained base.
#[test]
fn executable_net_diff_names_its_substrate_and_requires_a_retained_base() {
    let directory = tempfile::tempdir().expect("net diff fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");
    std::fs::create_dir(&fork_root).unwrap();
    let wall_now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("wall clock")
        .as_millis() as u64;
    let expected = snapback::instance_fork::ensure_expected_app(&app_root, "todo")
        .expect("bind net-diff fixture to invoking app root");

    let based = snapback::instance_fork::publish_managed_with_base(
        &source,
        &fork_root.join("fork-based"),
        &expected,
        "net-parent",
        wall_now,
        wall_now + 3_600_000,
        false,
        true,
    )
    .expect("publish base-bearing fork");
    let database = fork_root.join("fork-based/parent.sqlite3");
    let conn = rusqlite::Connection::open(&database).expect("open fork database");
    conn.execute_batch(
        "INSERT INTO todos(_id,_version,_createdAt,_updatedAt,title,completed,userId)
         VALUES('todo-net',1,100,100,'net diff row',0,'user_net');
         UPDATE _snapback_version SET version=1 WHERE id=1;
         INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
         VALUES(1,'todos','todo-net','insert','{}',100);",
    )
    .expect("fork workload");
    drop(conn);

    let mut net = snapback();
    net.args([
        "fork",
        "diff",
        &based.lineage.fork_id,
        "--net",
        "--app-root",
        app_root.to_str().unwrap(),
        "--fork-root",
        fork_root.to_str().unwrap(),
    ]);
    let envelope = successful(net, "fork diff --net");
    let receipt = &envelope["data"]["receipt"];
    assert_eq!(receipt["schemaVersion"], "snapback.fork-net-diff.v3");
    assert_eq!(receipt["substrate"], "retained-base-v1");
    assert_eq!(receipt["completeness"], "journal-enumerated-v1");
    assert_eq!(
        receipt["journalConsistency"],
        "journal-cross-check-verified"
    );
    assert_eq!(receipt["attribution"], "absent-v1");
    assert_eq!(receipt["writerCoverage"]["coverageWindow"], "unverified");
    assert_eq!(receipt["writerCoverage"]["manifestDigest"], Value::Null);
    assert_eq!(
        receipt["writerCoverage"]["coveredLanes"],
        serde_json::json!([])
    );
    assert_eq!(
        receipt["writerCoverage"]["uncoveredLanes"],
        serde_json::json!([
            "derivedForkHostChildAppRowJournal",
            "derivedForkOrdinaryAppRowJournal",
            "membershipTransition",
            "migration",
            "projectionRebuild",
            "resetAndSeed",
            "schemaActivation",
            "standaloneSeed",
            "strictPromotionReexecution"
        ])
    );
    let rows = receipt["rows"].as_array().expect("net rows");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["operation"], "insert");
    assert_eq!(rows[0]["postImage"]["title"], "net diff row");
    assert!(
        rows[0].get("preImage").is_none(),
        "an insert has no pre-image"
    );
    assert_eq!(receipt["domains"]["appRows"], "net-covered");

    let bare = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-bare"),
        &expected,
        "net-parent",
        wall_now,
        wall_now + 3_600_000,
        false,
    )
    .expect("publish bare fork");
    let refused = snapback()
        .args([
            "fork",
            "diff",
            &bare.lineage.fork_id,
            "--net",
            "--app-root",
            app_root.to_str().unwrap(),
            "--fork-root",
            fork_root.to_str().unwrap(),
        ])
        .output()
        .expect("run bare net diff");
    assert!(!refused.status.success());
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("SNAPBACK_FORK_NET_DIFF_UNAVAILABLE"),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
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
    let expected = snapback::instance_fork::ensure_expected_app(&app_root, "recovery-app")
        .expect("bind recovery fixture to invoking app root");
    let receipt = snapback::instance_fork::publish_managed(
        &source,
        &destination,
        &expected,
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
        recovered["data"]["registry"]["state"], "published",
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
        String::from_utf8_lossy(&refused.stderr).contains("SNAPBACK_FORK_APP_BINDING_REQUIRED"),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
}
