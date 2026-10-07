//! Acceptance includes lock-protected admission and every construction read.
// @ref LLP 3000.033#1.3 — compare logical state and main-file bytes on refusal.
use rusqlite::{Connection, config::DbConfig, types::Value};
use snapback4_core::{Engine, Store, error::RuntimeError, schema::Schema};
use std::{path::{Path, PathBuf}, sync::atomic::{AtomicBool, AtomicUsize, Ordering}, time::{Duration, Instant}};

struct Fixture(PathBuf);
impl Fixture {
    fn new(mode: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("sb4-sg-open-{}-{}-{}", std::process::id(), snapback4_core::now_ms(), NEXT.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&dir).unwrap();
        let fixture = Self(dir);
        drop(Engine::new(Store::open(&fixture.path()).unwrap(), Schema::default(), []).unwrap());
        let db = fixture.db();
        db.execute_batch(&format!("PRAGMA journal_mode={mode}; DROP TABLE _effect_steps;
            INSERT INTO _meta VALUES ('sg:sentinel','keep this row');")).unwrap();
        fixture
    }
    fn path(&self) -> PathBuf { self.0.join("store.sqlite") }
    fn db(&self) -> Connection { Connection::open(self.path()).unwrap() }
    fn bytes(&self) -> Vec<u8> { std::fs::read(self.path()).unwrap() }
    fn wal(&self) -> Option<Vec<u8>> { std::fs::read(self.0.join("store.sqlite-wal")).ok() }
}
impl Drop for Fixture {
    fn drop(&mut self) { std::fs::remove_dir_all(&self.0).unwrap(); }
}

fn dump(db: &Connection) -> Vec<(String, Vec<String>)> {
    let mut tables = vec!["sqlite_schema".to_owned()];
    tables.extend(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap));
    tables.into_iter().map(|name| {
        let mut statement = db.prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\""))).unwrap();
        let columns = statement.column_count();
        let mut rows = statement.query_map([], |r| (0..columns).map(|n| r.get::<_, Value>(n)).collect::<rusqlite::Result<Vec<_>>>())
            .unwrap().map(|r| format!("{:?}", r.unwrap())).collect::<Vec<_>>();
        rows.sort();
        (name, rows)
    }).collect()
}

fn open(store: Store, entry: &str, previous: Option<u64>) -> Result<Engine, RuntimeError> {
    match entry {
        "open" | "repair" => Engine::open(store),
        "new" => Engine::new(store, Schema::default(), []),
        "release" => Engine::new_release(store, Schema::default(), [], 1, previous),
        _ => unreachable!(),
    }
}

fn read_dump(path: &Path) -> Vec<(String, Vec<String>)> {
    dump(&Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap())
}

#[test]
fn malformed_construction_metadata_never_commits_upgrades_or_release() {
    for mode in ["WAL", "DELETE"] {
        for entry in ["open", "repair", "new", "release"] {
            for key in ["store_id", "release"] {
                for previous in [None, Some(0)] {
                    let fixture = Fixture::new(mode);
                    let db = fixture.db();
                    if mode == "WAL" {
                        db.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).unwrap();
                        db.execute_batch("PRAGMA wal_autocheckpoint=0").unwrap();
                    }
                    if let Some(previous) = previous {
                        db.execute("INSERT INTO _meta VALUES ('release',?1)", [previous.to_string()]).unwrap();
                    }
                    db.execute("INSERT OR REPLACE INTO _meta VALUES (?1, X'80')", [key]).unwrap();
                    if entry == "repair" { db.execute("DELETE FROM _meta WHERE key='live_sum_candidates'", []).unwrap(); }
                    drop(db);
                    let before = read_dump(&fixture.path());
                    let bytes = fixture.bytes();
                    let wal = fixture.wal();
                    if mode == "WAL" { assert!(wal.as_ref().is_some_and(|w| w.len() > 32)); }
                    let error = open(Store::open(&fixture.path()).unwrap(), entry, previous).err().expect("malformed metadata must refuse");
                    assert!(matches!(error, RuntimeError::Sql(rusqlite::Error::InvalidColumnType(..))), "{mode}/{entry}/{key}: {error:?}");
                    assert_eq!(read_dump(&fixture.path()), before, "{mode}/{entry}/{key}/{previous:?}: includes the release pointer");
                    assert_eq!(fixture.bytes(), bytes, "main-file bytes");
                    // This small migration does not spill. Keep RS's stronger
                    // retained-WAL witness; the spill-sized case has its own test.
                    assert_eq!(fixture.wal(), wal, "small refusal retains WAL bytes");
                }
            }
        }
    }
}

#[test]
fn accepted_legacy_open_carries_the_new_identity_and_release_out_of_commit() {
    for mode in ["WAL", "DELETE"] {
        for entry in ["open", "repair", "new", "release"] {
            let fixture = Fixture::new(mode);
            let db = fixture.db();
            db.execute("DELETE FROM _meta WHERE key='store_id'", []).unwrap();
            if entry == "repair" { db.execute("DELETE FROM _meta WHERE key='live_sum_candidates'", []).unwrap(); }
            drop(db);
            let engine = open(Store::open(&fixture.path()).unwrap(), entry, None).unwrap();
            let identity = engine.store().meta("store_id").unwrap().unwrap();
            assert_eq!(identity.len(), 32);
            assert_eq!(engine.ephemeral_hub().snapshot().unwrap().identity, identity);
            assert_eq!(engine.store().meta("release").unwrap(), (entry == "release").then(|| "1".to_string()));
            assert!(engine.store().conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_effect_steps')", [], |r| r.get::<_, bool>(0)).unwrap());
            drop(engine);
            let reopened = Engine::open(Store::open(&fixture.path()).unwrap()).unwrap();
            assert_eq!(reopened.store().meta("store_id").unwrap().as_deref(), Some(identity.as_str()));
        }
    }
}

static WAITING: AtomicUsize = AtomicUsize::new(0);
static RELEASE: AtomicBool = AtomicBool::new(false);
fn busy(count: i32) -> bool {
    if count == 0 { WAITING.fetch_add(1, Ordering::SeqCst); }
    let deadline = Instant::now() + Duration::from_secs(30);
    while !RELEASE.load(Ordering::SeqCst) && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(1)); }
    std::thread::sleep(Duration::from_millis(2));
    RELEASE.load(Ordering::SeqCst) && count < 15_000
}

#[test]
fn concurrent_openers_recheck_version_and_backend_after_the_writer_wait() {
    for mode in ["WAL", "DELETE"] {
        for entry in ["open", "repair", "new", "release", "device"] {
            for change in ["version", "schema", "programs", "catalog", "store_id", "release", "none"] {
                // New/source and device activation replace their backend and
                // reread their catalog. Only attaching uses the stored backend.
                if entry == "device" && change != "version" { continue; }
                if ["new", "release"].contains(&entry) && !["version", "store_id", "release"].contains(&change) { continue; }
                let fixture = Fixture::new(mode);
                let db = fixture.db();
                db.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).unwrap();
                if entry == "repair" { db.execute("DELETE FROM _meta WHERE key='live_sum_candidates'", []).unwrap(); }
                let stores: Vec<_> = (0..8).map(|_| {
                    let store = Store::open(&fixture.path()).unwrap();
                    store.conn().busy_handler(Some(busy)).unwrap();
                    store
                }).collect();
                db.execute_batch("BEGIN IMMEDIATE").unwrap();
                WAITING.store(0, Ordering::SeqCst);
                RELEASE.store(false, Ordering::SeqCst);
                let threads: Vec<_> = stores.into_iter().map(|mut store| std::thread::spawn(move || {
                    if entry == "device" { store.install(&Schema::default()) }
                    else { open(store, entry, None).map(|_| ()) }
                })).collect();
                let deadline = Instant::now() + Duration::from_secs(20);
                while WAITING.load(Ordering::SeqCst) != threads.len() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(1)); }
                let waiting = WAITING.load(Ordering::SeqCst);
                let sql = match change {
                    "version" => "UPDATE _meta SET value='future-store' WHERE key='version'",
                    "schema" => "UPDATE _generations SET schema='invalid schema'",
                    "programs" => "UPDATE _generations SET programs='invalid programs'",
                    "catalog" => "INSERT INTO _catalog VALUES ('unexpected',100)",
                    "store_id" => "UPDATE _meta SET value=X'80' WHERE key='store_id'",
                    "release" => "INSERT OR REPLACE INTO _meta VALUES ('release',X'80')",
                    _ => "SELECT 1",
                };
                db.execute_batch(sql).unwrap();
                let before = dump(&db);
                db.execute_batch("COMMIT").unwrap();
                let bytes = fixture.bytes();
                let wal = fixture.wal();
                RELEASE.store(true, Ordering::SeqCst);
                let outcomes: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
                assert_eq!(waiting, 8, "every attacher must reach the writer lock");
                for outcome in outcomes {
                    if change == "none" { outcome.unwrap(); }
                    else {
                        let error = outcome.err().expect("waiting opener must refuse");
                        if change == "version" { assert!(error.to_string().contains("future-store"), "{entry}: {error}"); }
                    }
                }
                if change != "none" {
                    assert_eq!(dump(&db), before, "{mode}/{entry}/{change}: refusal changed schema/rows");
                    assert_eq!(fixture.bytes(), bytes, "main file");
                    assert_eq!(fixture.wal(), wal, "small refusal WAL");
                } else {
                    assert!(db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_effect_steps')", [], |r| r.get::<_, bool>(0)).unwrap());
                }
            }
        }
    }
}

#[test]
fn repair_rechecks_the_backend_after_releasing_its_validated_snapshot() {
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization, TransactionOperation};
    use std::sync::mpsc;
    for mode in ["WAL", "DELETE"] {
        for change in ["version", "schema", "programs", "release"] {
            let fixture = Fixture::new(mode);
            let db = fixture.db();
            db.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).unwrap();
            db.execute_batch("DELETE FROM _meta WHERE key='live_sum_candidates'; INSERT INTO _meta VALUES ('release','1')").unwrap();
            let store = Store::open(&fixture.path()).unwrap();
            let (ready, gate) = mpsc::sync_channel(1);
            let (release, proceed) = mpsc::sync_channel(1);
            let mut begins = 0;
            store.conn().authorizer(Some(move |context: AuthContext<'_>| {
                if matches!(context.action, AuthAction::Transaction { operation: TransactionOperation::Begin }) {
                    begins += 1;
                    // The initial validation has rolled back before the next
                    // transaction can start. Hold that exact boundary, without
                    // a sleep or a production hook, while the controller writes.
                    if begins == 2 {
                        if ready.send(()).is_err() || proceed.recv_timeout(Duration::from_secs(30)).is_err() { return Authorization::Deny; }
                    }
                }
                Authorization::Allow
            })).unwrap();
            let thread = std::thread::spawn(move || Engine::attach_release(store, 1).map(|_| ()));
            gate.recv_timeout(Duration::from_secs(20)).expect("repair must leave its initial snapshot");
            db.execute_batch(match change {
                "version" => "UPDATE _meta SET value='future-store' WHERE key='version'",
                // Keep these valid and semantically identical so the advice
                // reads pass; the protected captured-backend recheck must refuse.
                "schema" => "UPDATE _generations SET schema=schema || ' '",
                "programs" => "UPDATE _generations SET programs=programs || ' '",
                "release" => "UPDATE _meta SET value='2' WHERE key='release'",
                _ => unreachable!(),
            }).unwrap();
            let before = dump(&db);
            let bytes = fixture.bytes();
            let wal = fixture.wal();
            release.send(()).unwrap();
            let error = thread.join().unwrap().err().expect("repair must reject the changed admission inputs");
            assert_eq!(error.code(), if change == "version" { "E_STORE" } else { "E_GENERATION" }, "{error}");
            assert_eq!(dump(&db), before, "{mode}/{change}: no upgrade after stale validation");
            assert_eq!(fixture.bytes(), bytes);
            assert_eq!(fixture.wal(), wal);
        }
    }
}

#[test]
fn in_place_adoption_refuses_bad_metadata_or_a_poisoned_hub_before_commit() {
    for refusal in ["store_id", "release", "hub"] {
        let fixture = Fixture::new("DELETE");
        let mut engine = Engine::open(Store::open(&fixture.path()).unwrap()).unwrap();
        engine.store().conn().execute_batch("DROP TABLE _effect_steps").unwrap();
        if refusal == "hub" {
            let hub = engine.ephemeral_hub();
            assert!(std::thread::spawn(move || { let _held = hub.lock().unwrap(); panic!("test hub poison"); }).join().is_err());
        } else {
            engine.store().conn().execute("INSERT OR REPLACE INTO _meta VALUES (?1,X'80')", [refusal]).unwrap();
        }
        let before = dump(engine.store().conn());
        let bytes = fixture.bytes();
        assert!(engine.adopt(Schema::default(), []).is_err());
        assert_eq!(dump(engine.store().conn()), before);
        assert_eq!(fixture.bytes(), bytes);
    }
}
