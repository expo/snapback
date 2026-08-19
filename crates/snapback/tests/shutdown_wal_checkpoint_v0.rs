#![cfg(unix)]

use rusqlite::{self, Connection, OpenFlags};
use serde_json::{Value, json};
use snapback::manifest::{
    FieldManifest, FieldType, HandlerInput, MutationPlan, MutationStep, SchemaManifest,
    TableManifest, ValueExpr,
};
use snapback_kernel::storage::LocalDatabase;
use std::collections::BTreeMap;
use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn test_schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("shutdown-checkpoint-v0".to_owned()),
        tables: vec![TableManifest {
            name: "notes".to_owned(),
            fields: vec![FieldManifest {
                name: "body".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

#[test]
fn pooled_readers_no_longer_strand_the_wal_on_shutdown() {
    let directory = tempfile::tempdir().expect("temporary database directory");
    let path = directory.path().join("app.sqlite3");
    let wal = sidecar(&path, "-wal");
    let shm = sidecar(&path, "-shm");
    let mut db = LocalDatabase::open(&path).expect("open file-backed database");
    db.schema_seed()
        .apply_schema(test_schema())
        .expect("apply test schema");
    db.mutation_writes()
        .execute_mutation(
            &MutationPlan {
                owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Insert {
                    table: "notes".to_owned(),
                    values: BTreeMap::from([(
                        "body".to_owned(),
                        ValueExpr::Literal(Value::String("checkpoint me".to_owned())),
                    )]),
                    bind_id_as: None,
                }],
                return_value: None,
            },
            &HandlerInput::default(),
        )
        .expect("commit a WAL-backed application write");
    assert!(
        std::fs::metadata(&wal).expect("WAL before shutdown").len() > 0,
        "the regression needs a non-empty WAL"
    );

    // Retain an idle pooled reader that has read a real page, so it holds the
    // WAL-mode SHARED lock that defeats the writer's close-time checkpoint.
    let pool = db.reader_pool().expect("file-backed reader pool");
    assert_eq!(
        pool.with_pinned_read(db.schema(), |reader| {
            reader.table_row_count_for_test("notes")
        })
        .expect("pooled reader query"),
        1
    );

    let report = db.shutdown_checkpoint(Duration::from_secs(30));
    assert!(report.applicable, "{}", report.summary());
    assert!(report.complete, "{}", report.summary());
    assert!(!wal.exists(), "WAL survived: {}", report.summary());
    assert!(!shm.exists(), "SHM survived: {}", report.summary());
    assert!(path.is_file(), "the main database must remain");
    let verification = Connection::open(&path).expect("main database remains openable");
    assert_eq!(
        verification
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get::<_, i64>(0))
            .expect("read checkpointed row"),
        1
    );
    drop(verification);

    let reopened = LocalDatabase::open(&path).expect("reopen checkpointed database");
    let reopened_pool = reopened.reader_pool().expect("reopened reader pool");
    let mode = reopened_pool
        .with_pinned_read(reopened.schema(), |reader| reader.journal_mode_for_test())
        .expect("inspect reopened journal mode");
    assert_eq!(mode.to_ascii_lowercase(), "wal");
    let reopened_report = reopened.shutdown_checkpoint(Duration::from_secs(30));
    assert!(reopened_report.complete, "{}", reopened_report.summary());
    drop(reopened);

    drop(db);
    assert!(!wal.exists(), "WAL reappeared after LocalDatabase drop");
    assert!(!shm.exists(), "SHM reappeared after LocalDatabase drop");
}

/// The mechanism the shutdown checkpoint exists for, witnessed directly.
/// `LocalDatabase` declares its writable `conn` before `reader_pool`, so Rust
/// drops the writer while the retained read-only pooled connections are still
/// open. A WAL-mode connection that has actually read a page holds a SHARED
/// lock on the database file until it closes, so the closing writer cannot take
/// the EXCLUSIVE lock its close-time checkpoint needs: it skips the checkpoint
/// and leaves `-wal`/`-shm` behind. The `query_only` readers that close last
/// can neither checkpoint nor unlink them. A server that never served a read
/// has an empty pool and closes clean — exactly the small-store/large-store
/// contrast in the originating ticket.
///
/// The read below must touch a real page: `SELECT 1` never reaches the pager,
/// so that connection takes no lock and this strand does not reproduce.
#[test]
fn plain_drop_strands_the_wal_only_once_the_reader_pool_is_warm() {
    let directory = tempfile::tempdir().expect("temporary database directory");

    let cold = directory.path().join("cold.sqlite3");
    let cold_db = LocalDatabase::open(&cold).expect("open never-queried database");
    assert!(
        std::fs::metadata(sidecar(&cold, "-wal"))
            .expect("cold WAL before drop")
            .len()
            > 0
    );
    drop(cold_db);
    assert!(
        !sidecar(&cold, "-wal").exists(),
        "an empty reader pool lets the writable connection close last and unlink the WAL"
    );

    let warm = directory.path().join("warm.sqlite3");
    let warm_db = LocalDatabase::open(&warm).expect("open queried database");
    let pool = warm_db.reader_pool().expect("file-backed reader pool");
    pool.with_pinned_read(warm_db.schema(), |reader| {
        reader.current_version().map(|_| ())
    })
    .expect("pooled reader database query");
    drop(warm_db);
    assert!(
        sidecar(&warm, "-wal").exists(),
        "this test records why shutdown_checkpoint exists: if plain drop now \
         unlinks the WAL behind a warm reader pool, re-examine the shutdown \
         contract in LLP 0003 rather than deleting this assertion"
    );
}

struct ChildGuard {
    child: Child,
}

impl ChildGuard {
    fn signal(&mut self, signal: libc::c_int) {
        // SAFETY: this guard exclusively owns the live child PID.
        assert_eq!(
            unsafe { libc::kill(self.child.id() as libc::pid_t, signal) },
            0,
            "signal child"
        );
    }

    fn wait(&mut self, timeout: Duration) -> ExitStatus {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait().expect("poll server child") {
                return status;
            }
            assert!(Instant::now() < deadline, "server shutdown timed out");
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn stderr(&mut self) -> String {
        let mut value = String::new();
        self.child
            .stderr
            .take()
            .expect("captured child stderr")
            .read_to_string(&mut value)
            .expect("read child stderr");
        value
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_server(directory: &Path, timeout_ms: Option<u64>) -> (ChildGuard, Value) {
    let database = directory.join("app.sqlite3");
    let ready = directory.join("ready.json");
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback"));
    command
        .args(["start", "--port", "0", "--db"])
        .arg(&database)
        .arg("--ready-file")
        .arg(&ready)
        .env_remove("SNAPBACK_ADMIN_TOKEN")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(timeout_ms) = timeout_ms {
        command.env(
            "SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS",
            timeout_ms.to_string(),
        );
    }
    let mut server = ChildGuard {
        child: command.spawn().expect("spawn snapback server"),
    };
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(bytes) = std::fs::read(&ready)
            && let Ok(descriptor) = serde_json::from_slice::<Value>(&bytes)
            && descriptor["ready"] == true
        {
            assert_eq!(
                descriptor["pid"].as_u64(),
                Some(server.child.id() as u64),
                "ready descriptor PID"
            );
            return (server, descriptor);
        }
        if let Some(status) = server.child.try_wait().expect("poll startup") {
            let stderr = server.stderr();
            panic!("snapback exited before readiness: {status}\n{stderr}");
        }
        assert!(Instant::now() < deadline, "server readiness timed out");
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// `/health` is served off the lock-free read lane (`ReadLane::health` checks
/// out a pooled reader and reads `_snapback_version`), so one request is enough
/// to leave the server in the retained-warm-reader state that strands the WAL.
/// Without it this test would pass even with the shutdown checkpoint removed.
fn request_health(descriptor: &Value) {
    let port = descriptor["port"].as_u64().expect("ready descriptor port") as u16;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect health route");
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write health request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read health response");
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
}

#[test]
fn sigterm_leaves_a_single_file_store() {
    let directory = tempfile::tempdir().expect("temporary server directory");
    let database = directory.path().join("app.sqlite3");
    let (mut server, descriptor) = start_server(directory.path(), None);
    request_health(&descriptor);

    server.signal(libc::SIGTERM);
    let status = server.wait(Duration::from_secs(60));
    assert!(status.success(), "SIGTERM exit status: {status}");
    assert!(database.is_file(), "main database must remain");
    assert!(!sidecar(&database, "-wal").exists(), "WAL survived SIGTERM");
    assert!(!sidecar(&database, "-shm").exists(), "SHM survived SIGTERM");
}

#[test]
fn a_blocked_checkpoint_reports_on_stderr() {
    let directory = tempfile::tempdir().expect("temporary server directory");
    let database = directory.path().join("app.sqlite3");
    let (mut server, _descriptor) = start_server(directory.path(), Some(500));

    let reader = Connection::open_with_flags(
        &database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("open external read-only connection");
    reader.execute_batch("BEGIN").expect("begin pinned read");
    reader
        .query_row(
            "SELECT version FROM _snapback_version WHERE id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .expect("pin external read snapshot");

    // Put a frame beyond the reader's pinned end mark. The open read
    // transaction then prevents TRUNCATE from completing; this is a real
    // SQLite busy condition, not a synthetic shutdown fault.
    let writer = Connection::open(&database).expect("open external test writer");
    writer
        .busy_timeout(Duration::from_secs(5))
        .expect("external writer timeout");
    writer
        .execute(
            "INSERT OR REPLACE INTO _snapback_meta(key, value) VALUES (?1, ?2)",
            rusqlite::params!["shutdown-blocker", json!({"active": true}).to_string()],
        )
        .expect("append frame beyond pinned read snapshot");
    drop(writer);

    server.signal(libc::SIGTERM);
    let status = server.wait(Duration::from_secs(60));
    let stderr = server.stderr();
    assert!(
        status.success(),
        "blocked checkpoint exit status: {status}\n{stderr}"
    );
    assert!(
        stderr.contains("SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE"),
        "shutdown did not report its residual WAL:\n{stderr}"
    );

    reader
        .execute_batch("ROLLBACK")
        .expect("release pinned read");
    drop(reader);
}
