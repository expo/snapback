#![cfg(unix)]

use serde_json::Value;
use snapback::auth::crypto::OsRandom;
use snapback::auth::keyring::AuthKeyringStore;
use snapback::storage::LocalDatabase;
use std::fs;
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

struct ServerGuard {
    child: Child,
}

struct ReplicationEnvGuard;

impl ReplicationEnvGuard {
    fn install(remote: &Path, key_file: &Path) -> Self {
        // This integration-test binary contains only this test, so no peer can
        // observe the process-global environment while the transient Snapback
        // storage connections below are opened.
        unsafe {
            std::env::set_var(
                "SNAPBACK_REPLICATION_TARGET",
                format!("file://{}", remote.display()),
            );
            std::env::set_var("SNAPBACK_REPLICATION_KEY_FILE", key_file);
        }
        Self
    }
}

impl Drop for ReplicationEnvGuard {
    fn drop(&mut self) {
        unsafe {
            std::env::remove_var("SNAPBACK_REPLICATION_TARGET");
            std::env::remove_var("SNAPBACK_REPLICATION_KEY_FILE");
        }
    }
}

impl ServerGuard {
    fn stop_gracefully(&mut self) {
        if self.child.try_wait().expect("inspect server").is_some() {
            return;
        }
        // `snapback start` owns the Tokio Ctrl-C handler on Unix.
        assert_eq!(
            unsafe { libc::kill(self.child.id() as libc::pid_t, libc::SIGINT) },
            0,
            "signal replicated server"
        );
        assert!(
            self.child
                .wait()
                .expect("wait for replicated server")
                .success(),
            "replicated server did not stop cleanly"
        );
    }
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn replication_command(binary: &str, remote: &Path, key_file: &Path) -> Command {
    let mut command = Command::new(binary);
    command
        .env(
            "SNAPBACK_REPLICATION_TARGET",
            format!("file://{}", remote.display()),
        )
        .env("SNAPBACK_REPLICATION_KEY_FILE", key_file)
        .env("SNAPBACK_REPLICATION_INTERVAL_MS", "10");
    command
}

fn require_success(output: Output, operation: &str) -> Output {
    assert!(
        output.status.success(),
        "{operation} failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn status(binary: &str, remote: &Path, key_file: &Path, database: &Path) -> Value {
    let mut command = replication_command(binary, remote, key_file);
    let output = require_success(
        command
            .args(["replicate", "status", "--db"])
            .arg(database)
            .output()
            .expect("run replication status"),
        "replication status",
    );
    serde_json::from_slice(&output.stdout).expect("replication status JSON")
}

fn wait_for_ready(child: &mut Child, ready_file: &Path) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if ready_file.is_file() {
            return;
        }
        if let Some(exit) = child.try_wait().expect("inspect server readiness") {
            panic!("replicated server exited before readiness: {exit}");
        }
        assert!(
            Instant::now() < deadline,
            "replicated server readiness timed out"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// A second Snapback-owned read/write connection used to close/reset the live
/// WAL behind celld-ltx's shadow state. Keep both that churn and external
/// status polling here: together they prove the server-attached write path and
/// cross-process WAL lifetime.
// @ref LLP 0188#2-integration-point-the-whole-instance-database — one durable
// LTX owner covers the whole instance WAL across ordinary operator inspection.
#[test]
fn server_and_external_status_sustain_one_hundred_file_replica_commits() {
    let binary = env!("CARGO_BIN_EXE_snapback");
    let manifest_dir = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let directory = tempfile::tempdir().expect("temporary replication directory");
    let database = directory.path().join("source.sqlite3");
    let remote = directory.path().join("remote");
    let key_file = directory.path().join("replication.key");
    let ready_file = directory.path().join("ready.json");
    let restore = directory.path().join("restore");

    drop(LocalDatabase::open(&database).expect("initialize source database"));
    AuthKeyringStore::file_for_database(&database)
        .load_or_mint_initial(1_000, &OsRandom)
        .expect("initialize source keyring");
    fs::write(&key_file, [0x6b; 32]).expect("write replication key");
    fs::set_permissions(&key_file, fs::Permissions::from_mode(0o600))
        .expect("protect replication key");

    let mut start = replication_command(binary, &remote, &key_file);
    let child = start
        .args(["start", "--port", "0", "--ready-file"])
        .arg(&ready_file)
        .arg("--db")
        .arg(&database)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("start replicated server");
    let mut server = ServerGuard { child };
    wait_for_ready(&mut server.child, &ready_file);
    let _replication_env = ReplicationEnvGuard::install(&remote, &key_file);

    require_success(
        Command::new(binary)
            .args(["load", "--ready-file"])
            .arg(&ready_file)
            .arg("--schema")
            .arg(manifest_dir.join("demos/todo/snapback/generated/schema.manifest.json"))
            .arg("--functions")
            .arg(manifest_dir.join("demos/todo/snapback/generated/functions.manifest.json"))
            .output()
            .expect("load todo artifacts"),
        "artifact load",
    );

    let mut frontier = status(binary, &remote, &key_file, &database)["frontier"]["txid"]
        .as_u64()
        .expect("initial frontier txid");
    let payload = "x".repeat(4096);
    for batch in 0..5_u64 {
        for offset in 0..20_u64 {
            let args = serde_json::json!({
                "title": format!("regression-{batch}-{offset}-{payload}")
            });
            require_success(
                Command::new(binary)
                    .args(["run", "--ready-file"])
                    .arg(&ready_file)
                    .args(["--user", "user_replication_regression", "--args"])
                    .arg(args.to_string())
                    .arg("createTodo")
                    .output()
                    .expect("run server mutation"),
                "server mutation",
            );
        }

        // Exercise a real Snapback storage connection, not raw sqlite3. Its
        // close must not checkpoint or reset the server's replicated WAL.
        drop(LocalDatabase::open(&database).expect("open transient Snapback connection"));

        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let observed = status(binary, &remote, &key_file, &database);
            assert_eq!(
                observed["degraded"],
                Value::Bool(false),
                "replication wedged after batch {batch}: {observed}"
            );
            let next = observed["frontier"]["txid"]
                .as_u64()
                .expect("frontier txid");
            if next > frontier {
                frontier = next;
                break;
            }
            assert!(
                Instant::now() < deadline,
                "frontier did not advance after batch {batch}: {observed}"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let observed = status(binary, &remote, &key_file, &database);
        assert_eq!(observed["degraded"], Value::Bool(false), "{observed}");
        if observed["observedLag"]["sourceVersions"] == 0 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "final frontier did not converge: {observed}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }

    server.stop_gracefully();
    // The replication owner may emit one final LTX/checkpoint record during
    // graceful shutdown, so bind the restore assertion to the committed head
    // observed after that boundary rather than the last load-phase sample.
    frontier = status(binary, &remote, &key_file, &database)["frontier"]["txid"]
        .as_u64()
        .expect("final frontier txid");
    let source = snapback_services::test_support::rusqlite::Connection::open(&database)
        .expect("inspect stopped source");
    let source_version: u64 = source
        .query_row(
            "SELECT version FROM _snapback_version WHERE id=1",
            [],
            |row| row.get(0),
        )
        .expect("read final source version");
    drop(source);

    let mut restore_command = replication_command(binary, &remote, &key_file);
    let restored = require_success(
        restore_command
            .args(["replicate", "restore", "--output"])
            .arg(&restore)
            .output()
            .expect("restore file replica"),
        "replication restore",
    );
    let restored: Value = serde_json::from_slice(&restored.stdout).expect("restore result JSON");
    assert_eq!(restored["position"]["txid"], Value::from(frontier));
    assert_eq!(restored["sourceVersion"], Value::from(source_version));
    let image = snapback_services::test_support::rusqlite::Connection::open(
        restore.join("database.sqlite3"),
    )
    .expect("open restored image");
    assert_eq!(
        image
            .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .expect("check restored image"),
        "ok"
    );
}
