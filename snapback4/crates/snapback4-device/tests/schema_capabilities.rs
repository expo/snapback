mod common;
use snapback4_device::{device::{Backend, Device}, memory::MemoryStore, opening::Opening, call};
use snapback4_core::schema::{Schema, ColumnType, Index, public_table};
use serde_json::json;
use std::collections::BTreeMap;
use snapback4_device::store::{DeviceStore, DeviceTx};
use snapback4_core::{error::RuntimeError, rows::Rows, value::{Value, object}};

fn plain() -> Backend {
    Backend { generation: 1, programs: vec![], schema: Schema {
        tables: BTreeMap::from([("t".into(), public_table(
            BTreeMap::from([("id".into(), ColumnType::Id)]),
            BTreeMap::from([("byId".into(), Index::of(&["id"], true))]),
        ))]),
        ..Schema::default()
    } }
}

#[test]
fn future_capability_refuses_initial_install_and_adoption_without_changes() {
    let backend = plain();
    for wire in [serde_json::to_value(&backend).unwrap(), json!({"initial_backend":backend})] {
        Opening::parse(Some(&wire.to_string())).unwrap().open(MemoryStore::new()).unwrap();
    }
    let mut future = serde_json::to_value(&backend).unwrap();
    future["generation"] = json!(2);
    future["schema"]["tables"]["t"]["constraints"] = json!([{"Capabilities":["future-derivation"]}]);
    for wire in [future.clone(), json!({"initial_backend":future.clone()})] {
        let error = match Opening::parse(Some(&wire.to_string())) {
            Err(error) => error,
            Ok(_) => panic!("unsupported initial backend accepted"),
        };
        assert_eq!(error.code(), "E_SCHEMA_CAPABILITY");
        assert_eq!(error.family(), "schema");
    }
    let mut device = Device::open_store(MemoryStore::new(), Some(backend)).unwrap();
    device.store().drain();
    let before = call::call(&mut device, json!({"op":"backend"}));
    let answer = call::call(&mut device, json!({"op":"adopt","backend":future}));
    assert_eq!(answer["denied"]["code"], "E_SCHEMA_CAPABILITY");
    assert!(device.store().drain().is_empty());
    assert_eq!(call::call(&mut device, json!({"op":"backend"})), before);
}

// Borrow the real store so a refused opening leaves it available for inspection.
struct Borrowed<'a, S>(&'a mut S);
impl<S: DeviceStore> DeviceStore for Borrowed<'_, S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.0.install(schema, metadata, reset)
    }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        self.0.install_checked(schema, metadata, reset, expected)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.0.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.0.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { self.0.transaction() }
}

fn refused_reopen_preserves<S: DeviceStore>(store: &mut S) {
    let backend = plain();
    drop(Device::open_store(Borrowed(store), Some(backend.clone())).unwrap());
    let row = object([("id", Value::Id("kept".into()))]);
    let tx = store.transaction().unwrap();
    tx.put("t", &backend.schema.tables["t"], &row, None).unwrap();
    tx.commit().unwrap();
    let mut future = serde_json::to_value(&backend).unwrap();
    future["schema"]["tables"]["t"]["constraints"] = json!([{"Capabilities":["future-derivation"]}]);
    store.set_meta("device:backend", &future.to_string()).unwrap();
    let mut replacement = backend;
    replacement.generation = 2; // Without the fence this resets the held row.
    let before = store.transaction().unwrap().meta_prefix("").unwrap();
    for opening in [Opening::Install(replacement.clone()), Opening::Kept, Opening::Initial(replacement)] {
        let error = match opening.open(Borrowed(store)) {
            Err(error) => error,
            Ok(_) => panic!("unsupported kept backend accepted during reopening"),
        };
        assert_eq!(error.code(), "E_SCHEMA_CAPABILITY");
        let tx = store.transaction().unwrap();
        assert_eq!(tx.meta_prefix("").unwrap(), before, "refusal must preserve all metadata");
        assert_eq!(tx.get("t", "kept").unwrap(), Some(row.clone()), "refusal must preserve rows");
    }
}

#[test]
fn explicit_backend_reopening_checks_kept_capabilities_memory() {
    let mut store = MemoryStore::new();
    refused_reopen_preserves(&mut store);
    // Setup is the only source of writes; refused openings cannot delete anything.
    assert!(store.drain().iter().all(|change| change.v.is_some()));
}

#[test]
fn explicit_backend_reopening_checks_kept_capabilities_sqlite() {
    let host = common::Sqlite::new("capability-fence");
    let path = host.path("device");
    drop(snapback4_device::native::Device::open(&path, Some(plain())).unwrap());
    let mut store = snapback4_core::store::Store::open(&path).unwrap();
    refused_reopen_preserves(&mut store);
}

// Linux counterpart of schema-capabilities.test.mjs's published-engine fence.
// Include DDL (indexes/triggers/columns), every table and every stored value.
// The refusal contract covers schema/rows, integrity and freelist count.
// WAL identity is asserted for the small no-spill cases below; a large rolled
// back migration may change free-page contents or retain uncommitted frames
// (LLP 3000.033 §1.3).
fn sqlite_dump(path: &std::path::Path) -> Vec<(String, Vec<String>)> {
    let db = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut tables = vec!["sqlite_schema".to_string()];
    tables.extend(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap));
    let mut snapshot = tables.into_iter().map(|name| {
        let mut stmt = db.prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\""))).unwrap();
        let columns = stmt.column_count();
        let mut rows = stmt.query_map([], |r| (0..columns).map(|i| r.get::<_, rusqlite::types::Value>(i)).collect::<rusqlite::Result<Vec<_>>>())
            .unwrap().map(|r| format!("{:?}", r.unwrap())).collect::<Vec<_>>();
        rows.sort();
        (name, rows)
    }).collect::<Vec<_>>();
    let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    let free: i64 = db.query_row("PRAGMA freelist_count", [], |r| r.get(0)).unwrap();
    snapshot.push(("PRAGMA integrity_check/freelist_count".into(), vec![integrity, free.to_string()]));
    snapshot
}

fn legacy_device(path: &std::path::Path, mode: &str) {
    drop(snapback4_device::native::Device::open(path, Some(plain())).unwrap());
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute("INSERT INTO r(t,id,data) SELECT num,'kept',?1 FROM _catalog WHERE name = 't'",
        [serde_json::to_string(&object([("id", Value::Id("kept".into()))])).unwrap()]).unwrap();
    db.execute_batch("DROP TABLE IF EXISTS _read_sessions;").unwrap();
    let has_scope: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_session_mint_bindings') WHERE name = 'scope')", [], |r| r.get(0)).unwrap();
    if has_scope { db.execute_batch("ALTER TABLE _session_mint_bindings DROP COLUMN scope;").unwrap(); }
    db.execute_batch(&format!("PRAGMA journal_mode = {mode};")).unwrap();
}

fn future_backend() -> Backend {
    let mut future = plain();
    future.generation = 2;
    future.schema.tables.get_mut("t").unwrap().constraints.push(
        snapback4_core::schema::Constraint::Capabilities(["future-derivation".into()].into()));
    future
}

#[test]
fn legacy_native_open_and_refused_adoption_preserve_complete_store() {
    for mode in ["WAL", "DELETE"] {
        let host = common::Sqlite::new("refused-legacy-adoption");
        let path = host.path(mode);
        legacy_device(&path, mode);
        let before = sqlite_dump(&path);
        let mut device = snapback4_device::native::Device::open(&path, None).unwrap();
        let answer = call::call(&mut device, json!({"op":"adopt", "backend":future_backend()}));
        assert_eq!(answer["denied"]["code"], "E_SCHEMA_CAPABILITY");
        drop(device);
        assert_eq!(sqlite_dump(&path), before, "opening then refusing adoption must not add auth storage");
    }
}

#[test]
fn refused_native_open_preserves_missing_tables_indexes_columns_and_meta() {
    for mode in ["WAL", "DELETE"] {
        let host = common::Sqlite::new("refused-legacy-open");
        let path = host.path(mode);
        legacy_device(&path, mode);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE _meta SET value = ?1 WHERE key = 'device:backend'", [serde_json::to_string(&future_backend()).unwrap()]).unwrap();
        // Exercise the older migrations too, not just _read_sessions.
        db.execute_batch("DROP TABLE _effect_steps; DROP TABLE _device_snapshot; DROP INDEX _sessions_expiry;
            ALTER TABLE _jobs DROP COLUMN domain; DELETE FROM _meta WHERE key = 'store_id';
            CREATE INDEX _log_row_seq ON _log(seq);").unwrap();
        drop(db);
        let before = sqlite_dump(&path);
        for opening in [Opening::Kept, Opening::Install(plain()), Opening::Initial(plain())] {
            let error = snapback4_device::native::Device::open_with(&path, opening).err().expect("refused open");
            assert_eq!(error.code(), "E_SCHEMA_CAPABILITY");
            assert_eq!(sqlite_dump(&path), before);
        }
    }
}

#[test]
fn refused_store_version_and_server_adoption_preserve_complete_store() {
    use snapback4_core::{Engine, Store};
    for mode in ["WAL", "DELETE"] {
        let host = common::Sqlite::new("refused-server-open");
        let path = host.path(mode);
        let (schema, programs) = (plain().schema, plain().programs);
        drop(Engine::new(Store::open(&path).unwrap(), schema.clone(), programs.clone()).unwrap());
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch(&format!("DROP TABLE IF EXISTS _read_sessions; DROP TABLE _change_evidence;
            DROP TABLE _effect_steps; DROP INDEX _sessions_expiry; CREATE INDEX _log_row_seq ON _log(seq);
            INSERT INTO _meta VALUES ('release','1');
            ALTER TABLE _jobs DROP COLUMN domain; DELETE FROM _meta WHERE key = 'store_id'; PRAGMA journal_mode = {mode};")).unwrap();
        drop(db);
        let before = sqlite_dump(&path);
        // Selecting an obsolete release must refuse before attachment upgrades.
        assert_eq!(Engine::attach_release(Store::open(&path).unwrap(), 999).err().expect("refused attachment").code(), "E_GENERATION");
        assert_eq!(sqlite_dump(&path), before);
        // The release mismatch refuses from inside activation, after DDL work.
        let error = Engine::new_release(Store::open(&path).unwrap(), schema, programs, 2, Some(999)).err().expect("refused adoption");
        assert_eq!(error.code(), "E_GENERATION");
        assert_eq!(sqlite_dump(&path), before);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE _generations SET schema = 'invalid json'", []).unwrap();
        drop(db);
        let before = sqlite_dump(&path);
        assert_eq!(Engine::open(Store::open(&path).unwrap()).err().expect("refused stored schema").code(), "E_STORE");
        assert_eq!(sqlite_dump(&path), before);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE _meta SET value = 'future-store' WHERE key = 'version'", []).unwrap();
        drop(db);
        let before = sqlite_dump(&path);
        assert_eq!(Store::open(&path).err().expect("refused store version").code(), "E_STORE");
        assert_eq!(sqlite_dump(&path), before);
    }
}

#[test]
fn refused_open_preserves_uncheckpointed_database_and_wal() {
    let host = common::Sqlite::new("refused-surviving-wal");
    let path = host.path("store");
    legacy_device(&path, "WAL");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).unwrap();
    db.execute_batch("PRAGMA wal_autocheckpoint=0; UPDATE _meta SET value='future-store' WHERE key='version';").unwrap();
    drop(db); // Deliberately retain committed frames with no live connection.
    let wal = std::path::PathBuf::from(format!("{}-wal", path.display()));
    let before = (std::fs::read(&path).unwrap(), std::fs::read(&wal).unwrap());
    assert!(before.1.len() > 32, "fixture must retain committed WAL frames");
    let error = snapback4_core::Store::open(&path).err().expect("unsupported store");
    assert!(error.to_string().contains("future-store"));
    assert_eq!(std::fs::read(&path).unwrap(), before.0, "refused connection must not checkpoint");
    assert_eq!(std::fs::read(&wal).unwrap(), before.1, "refused connection must retain WAL bytes");
}

#[test]
fn native_open_recovery_refusals_roll_back_installation() {
    for mode in ["WAL", "DELETE"] {
        for refusal in ["overflow", "malformed", "native_cleanup"] {
            let host = common::Sqlite::new("refused-open-recovery");
            let path = host.path(refusal);
            legacy_device(&path, mode);
            let db = rusqlite::Connection::open(&path).unwrap();
            if mode == "WAL" {
                db.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).unwrap();
                db.execute_batch("PRAGMA wal_autocheckpoint=0").unwrap();
            }
            db.execute_batch("DROP TABLE _effect_steps;").unwrap();
            if refusal == "native_cleanup" {
                db.execute_batch("INSERT INTO _meta VALUES ('device:native','invalid');
                    CREATE TRIGGER refuse_native_cleanup BEFORE DELETE ON _meta WHEN old.key = 'device:native'
                    BEGIN SELECT RAISE(ABORT, 'native cleanup refused'); END;").unwrap();
            } else {
                db.execute_batch("INSERT INTO _meta VALUES ('device:declaration:capture','{}');").unwrap();
                db.execute("INSERT OR REPLACE INTO _meta VALUES ('device:send_revision',?1)",
                    [if refusal == "overflow" { "9007199254740991" } else { "invalid" }]).unwrap();
            }
            drop(db);
            let before = sqlite_dump(&path);
            let wal_path = std::path::PathBuf::from(format!("{}-wal", path.display()));
            let wal = std::fs::read(&wal_path).ok();
            if mode == "WAL" { assert!(wal.as_ref().is_some_and(|w| w.len() > 32)); }
            let error = snapback4_device::native::Device::open(&path, None).err().expect("recovery must refuse");
            assert_eq!(error.code(), "E_STORE", "{refusal}: {error}");
            assert_eq!(sqlite_dump(&path), before, "{mode}/{refusal}: no installed upgrades or metadata changes");
            assert_eq!(std::fs::read(&wal_path).ok(), wal, "{mode}/{refusal}: unchanged WAL bytes");
        }
    }
}

#[test]
fn spill_sized_native_refusal_preserves_committed_state_with_free_pages() {
    for mode in ["WAL", "DELETE"] {
        let host = common::Sqlite::new("refused-migration-spill");
        let path = host.path(mode);
        legacy_device(&path, mode);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("ALTER TABLE _ops ADD COLUMN args TEXT; BEGIN IMMEDIATE;").unwrap();
        let payload = format!("\"{}\"", "x".repeat(8192));
        for n in 0..1500 {
            db.execute("INSERT INTO _ops(principal,id,seq,outcome,args) VALUES ('bob',?1,1,?2,'legacy')",
                rusqlite::params![n.to_string(), payload]).unwrap();
        }
        db.execute_batch("DROP TABLE _effect_steps;
            INSERT INTO _meta VALUES ('device:declaration:capture','{}');
            INSERT OR REPLACE INTO _meta VALUES ('device:send_revision','9007199254740991'); COMMIT;
            CREATE TABLE free_page_fixture(data BLOB);
            INSERT INTO free_page_fixture VALUES (zeroblob(4194304));
            DROP TABLE free_page_fixture;").unwrap();
        drop(db); // Checkpoint the large fixture before retaining a small WAL.
        if mode == "WAL" {
            let db = rusqlite::Connection::open(&path).unwrap();
            db.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).unwrap();
            db.execute_batch("PRAGMA wal_autocheckpoint=0; INSERT INTO _meta VALUES ('sg:sentinel','retained committed WAL');").unwrap();
        }
        let before = sqlite_dump(&path);
        let bytes = std::fs::read(&path).unwrap();
        let wal_path = std::path::PathBuf::from(format!("{}-wal", path.display()));
        let wal = std::fs::read(&wal_path).ok();
        let error = snapback4_device::native::Device::open(&path, None).err().expect("late recovery refusal");
        assert!(error.to_string().contains("send revision overflow"), "{error}");
        let after_bytes = std::fs::read(&path).unwrap();
        assert_eq!(after_bytes.len(), bytes.len());
        // SQLite deliberately omits freelist leaves from rollback journals.
        // Enforce the precise exception: only pre-existing free leaves may differ.
        let free = freelist_leaves(&bytes);
        assert!(free.len() > 1000, "fixture must have committed free pages");
        let page_size = u16::from_be_bytes([bytes[16], bytes[17]]) as usize;
        let changed = bytes.chunks(page_size).zip(after_bytes.chunks(page_size)).enumerate()
            .filter_map(|(n, (before, after))| (before != after).then_some(n as u32 + 1)).collect::<Vec<_>>();
        assert!(changed.iter().all(|page| free.contains(page)), "{mode}: allocated pages changed: {changed:?}");
        if mode == "DELETE" { assert!(!changed.is_empty(), "exercise freelist leaf reuse and spill"); }
        else { assert!(changed.is_empty(), "WAL spill does not write the main file"); }
        eprintln!("{mode}: {} free leaves; {} changed free pages; schema/rows, integrity and freelist count unchanged", free.len(), changed.len());
        assert_eq!(sqlite_dump(&path), before, "{mode}: every schema entry and value survives, including legacy args and missing _effect_steps");
        if let Some(wal) = wal {
            assert!(wal.len() > 32 && wal.len() < 64 * 1024, "start with a small committed WAL");
            let after = std::fs::read(&wal_path).unwrap();
            assert!(after.len() > 8 * 1024 * 1024, "fixture must actually spill beyond the native cache: {} bytes", after.len());
            assert!(after.starts_with(&wal), "committed uncheckpointed frames survive; only uncommitted frames are appended");
            eprintln!("refused legacy migration: main {} bytes identical; WAL {} -> {} bytes; full logical dump identical", bytes.len(), wal.len(), after.len());
        } else {
            assert_eq!(mode, "DELETE");
        }
        // A later accepting open still performs the real migration and capture
        // recovery. Rollback must not leave an unrecoverable physical store.
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE _meta SET value='0' WHERE key='device:send_revision'", []).unwrap();
        drop(db);
        drop(snapback4_device::native::Device::open(&path, None).unwrap());
        let db = rusqlite::Connection::open(&path).unwrap();
        assert_eq!(db.query_row("SELECT COUNT(*) FROM _ops", [], |r| r.get::<_, i64>(0)).unwrap(), 1500);
        assert!(!db.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_ops') WHERE name='args')", [], |r| r.get::<_, bool>(0)).unwrap());
        assert!(db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_effect_steps')", [], |r| r.get::<_, bool>(0)).unwrap());
        assert_eq!(db.query_row("SELECT value FROM _meta WHERE key='device:send_revision'", [], |r| r.get::<_, String>(0)).unwrap(), "1");
    }
}

fn freelist_leaves(bytes: &[u8]) -> std::collections::BTreeSet<u32> {
    let word = |offset| u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let size = u16::from_be_bytes([bytes[16], bytes[17]]) as usize;
    let mut trunk = word(32);
    let mut leaves = std::collections::BTreeSet::new();
    while trunk != 0 {
        let offset = (trunk as usize - 1) * size;
        for n in 0..word(offset + 4) as usize { assert!(leaves.insert(word(offset + 8 + n * 4))); }
        trunk = word(offset);
    }
    leaves
}
