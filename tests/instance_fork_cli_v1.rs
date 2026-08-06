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
use snapback::storage::LocalDatabase;
use std::fs::File;
use std::io::Read as _;
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
    let conn = rusqlite::Connection::open(database).expect("open asset database");
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
    let conn = rusqlite::Connection::open(database).expect("open database read-only");
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
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
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

/// LLP 0185 Phase 3 item 6: `fork renew` extends a live fork's finite expiry
/// end to end — the running server honors the moved expiry instead of dying
/// on its boot-time schedule — while shortening, exceeding the configured
/// maximum lifetime, and renewing unknown forks all refuse deterministically.
#[test]
fn executable_fork_renew_extends_a_live_fork_within_the_maximum() {
    let directory = tempfile::tempdir().expect("renew fixture");
    let source = parent_with_schema(directory.path());
    let app_root = directory.path().join("app");
    std::fs::create_dir(&app_root).unwrap();
    let fork_root = directory.path().join("forks");
    let mut cleanup = ForkCleanup {
        fork_root: fork_root.clone(),
        app_root: app_root.clone(),
        fork_ids: Vec::new(),
    };

    let created = fork_create(&source, &app_root, &fork_root, "5s", false);
    cleanup.track(fork_id(&created));
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
    // the database lineage, which the expiry watchdog re-reads.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("wall clock")
        .as_millis() as u64;
    if original_expiry.saturating_add(1_500) > now {
        std::thread::sleep(Duration::from_millis(
            original_expiry.saturating_add(1_500) - now,
        ));
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
    let existing = snapback::instance_fork::publish_managed(
        &source,
        &fork_root.join("fork-existing"),
        "todo",
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

    let based = snapback::instance_fork::publish_managed_with_base(
        &source,
        &fork_root.join("fork-based"),
        "todo",
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
    assert_eq!(receipt["schemaVersion"], "snapback.fork-net-diff.v1");
    assert_eq!(receipt["substrate"], "retained-base-v1");
    assert_eq!(receipt["completeness"], "journal-enumerated-v1");
    assert_eq!(
        receipt["journalConsistency"],
        "journal-cross-check-verified"
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
        "todo",
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
        String::from_utf8_lossy(&refused.stderr).contains("SNAPBACK_FORK_TTL_INVALID"),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
}
