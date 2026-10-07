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
fn sqlite_dump(path: &std::path::Path) -> Vec<(String, Vec<String>)> {
    let db = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut tables = vec!["sqlite_schema".to_string()];
    tables.extend(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").unwrap()
        .query_map([], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap));
    tables.into_iter().map(|name| {
        let mut stmt = db.prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\""))).unwrap();
        let columns = stmt.column_count();
        let mut rows = stmt.query_map([], |r| (0..columns).map(|i| r.get::<_, rusqlite::types::Value>(i)).collect::<rusqlite::Result<Vec<_>>>())
            .unwrap().map(|r| format!("{:?}", r.unwrap())).collect::<Vec<_>>();
        rows.sort();
        (name, rows)
    }).collect()
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
        let bytes = std::fs::read(&path).unwrap();
        let mut device = snapback4_device::native::Device::open(&path, None).unwrap();
        let answer = call::call(&mut device, json!({"op":"adopt", "backend":future_backend()}));
        assert_eq!(answer["denied"]["code"], "E_SCHEMA_CAPABILITY");
        drop(device);
        assert_eq!(sqlite_dump(&path), before, "opening then refusing adoption must not add auth storage");
        assert_eq!(std::fs::read(&path).unwrap(), bytes, "every database byte survives");
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
        let bytes = std::fs::read(&path).unwrap();
        for opening in [Opening::Kept, Opening::Install(plain()), Opening::Initial(plain())] {
            let error = snapback4_device::native::Device::open_with(&path, opening).err().expect("refused open");
            assert_eq!(error.code(), "E_SCHEMA_CAPABILITY");
            assert_eq!(sqlite_dump(&path), before);
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
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
        let bytes = std::fs::read(&path).unwrap();
        // Selecting an obsolete release must refuse before attachment upgrades.
        assert_eq!(Engine::attach_release(Store::open(&path).unwrap(), 999).err().expect("refused attachment").code(), "E_GENERATION");
        assert_eq!(sqlite_dump(&path), before);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        // The release mismatch refuses from inside activation, after DDL work.
        let error = Engine::new_release(Store::open(&path).unwrap(), schema, programs, 2, Some(999)).err().expect("refused adoption");
        assert_eq!(error.code(), "E_GENERATION");
        assert_eq!(sqlite_dump(&path), before);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE _generations SET schema = 'invalid json'", []).unwrap();
        drop(db);
        let before = sqlite_dump(&path);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(Engine::open(Store::open(&path).unwrap()).err().expect("refused stored schema").code(), "E_STORE");
        assert_eq!(sqlite_dump(&path), before);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE _meta SET value = 'future-store' WHERE key = 'version'", []).unwrap();
        drop(db);
        let before = sqlite_dump(&path);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(Store::open(&path).err().expect("refused store version").code(), "E_STORE");
        assert_eq!(sqlite_dump(&path), before);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}
