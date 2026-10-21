use super::*;
use crate::{
    Engine,
    activation::ActivationReader,
    engine::release::ReleaseActivation,
    release_history::{
        self,
        test_cases::{self, Lifecycle},
    },
};

struct Harness {
    engine: Engine,
    path: PathBuf,
}
impl Harness {
    fn new() -> Self {
        let (schema, programs) = test_cases::compile(1);
        Self::with_backend(schema, programs)
    }
    fn with_backend(schema: Schema, programs: Vec<crate::Program>) -> Self {
        let directory =
            std::env::temp_dir().join(format!("sb4-release-contract-{:x}", crate::ids::seed()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("store.sqlite");
        let engine = Engine::new_release_prepared_at(
            Store::open(&path).unwrap(),
            schema,
            programs,
            &ReleaseActivation::new(1, None),
            false,
            100,
        )
        .unwrap();
        Self { engine, path }
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.path.parent().unwrap());
    }
}
impl Lifecycle for Harness {
    fn executed_version(&mut self) -> crate::Value {
        self.engine
            .query("version", crate::Context::system())
            .unwrap()
            .data
    }
    fn generation(&self) -> u64 {
        self.engine.generation()
    }
    fn activate(
        &mut self,
        version: u64,
        release: u64,
        previous: u64,
        revision: u64,
    ) -> Result<u64, RuntimeError> {
        let (schema, programs) = test_cases::compile(version);
        let mut options = ReleaseActivation::new(release, Some(previous));
        options.expected_revision = Some(revision);
        self.engine
            .adopt_release_at(schema, programs, &options, false, 200)
    }
    fn reopen(&mut self, release: u64) -> Result<(), RuntimeError> {
        let engine = Engine::attach_release_at(Store::open(&self.path)?, release, 200)?;
        self.engine = engine;
        Ok(())
    }
    fn status(&mut self) -> serde_json::Value {
        self.engine
            .store_mut()
            .release_status(0, None, None)
            .unwrap()
    }
}

#[test]
fn release_contract_sqlite_lifecycle() {
    test_cases::lifecycle(&mut Harness::new());
}

#[test]
fn release_contract_sqlite_facts_history_and_terminal_error() {
    let mut h = Harness::new();
    let store_id = h.engine.store().store_identity().unwrap();
    {
        let tx = h.engine.store_mut().transaction().unwrap();
        test_cases::opening_facts(&tx);
        test_cases::bookkeeping(
            &tx,
            |k, v| (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).set_meta(k, v).unwrap(),
            |k| (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).meta(k).unwrap(),
        );
        test_cases::malformed_generation(&tx, |k, v| (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).set_meta(k, v).unwrap());
        test_cases::worker_history(&tx, |k, v| (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).set_meta(k, v).unwrap());
        let backend = tx.opening_backend().unwrap();
        test_cases::preparation(&super::release::ReleaseCheck((match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).conn()), &backend);
        test_cases::history(&tx);
        tx.rollback().unwrap();
    }
    let first = h.status();
    {
        let tx = h.engine.store_mut().transaction().unwrap();
        test_cases::statement_error(&tx);
        // A statement error is terminal by contract; drop rolls back the event,
        // its revision and the first item inserted before the duplicate failed.
    }
    assert_eq!(h.status(), first);
    h.reopen(1).unwrap();
    assert_eq!(h.engine.store().store_identity().unwrap(), store_id);
}

#[test]
fn release_contract_sqlite_activation_race() {
    use std::sync::Arc;
    for version in [1, 2] {
        let mut h = Harness::new();
        let mut peer = Engine::attach_release(Store::open(&h.path).unwrap(), 1).unwrap();
        let race = Arc::new(test_race::FenceRace::sqlite());
        let other = race.clone();
        let thread = std::thread::spawn(move || {
            other.install_sqlite_busy_handler((match &peer.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn());
            other.arm_activation(false);
            let (schema, programs) = test_cases::compile(3);
            peer.adopt_release_at(
                schema,
                programs,
                &ReleaseActivation::new(3, Some(1)),
                false,
                300,
            )
        });
        race.arm_activation(true);
        assert_eq!(h.activate(version, 2, 1, 1).unwrap(), version);
        assert_eq!(thread.join().unwrap().unwrap_err().code(), "E_GENERATION");
        assert_eq!(h.status()["release"], 2);
        assert_eq!(h.status()["events"].as_array().unwrap().len(), 2);
    }
}

#[test]
fn release_contract_sqlite_admission_and_exhaustion() {
    let mut h = Harness::new();
    let before = h.status();
    let (schema, programs) = test_cases::compile(2);
    for n in 0..3 {
        let mut options = ReleaseActivation::new(if n == 0 { u64::MAX } else { 2 }, Some(1));
        if n == 1 {
            options.operation = "bad\0operation".into();
        }
        if n == 2 {
            options.native_digest = Some("bad\0digest".into());
        }
        assert!(
            h.engine
                .adopt_release_at(schema.clone(), programs.clone(), &options, false, 200)
                .is_err()
        );
        assert_eq!(h.status(), before);
    }
    let tx = h.engine.store_mut().transaction().unwrap();
    (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).conn()
        .execute("UPDATE _release_events SET id=?1", [i64::MAX])
        .unwrap();
    test_cases::event_id_exhaustion(&tx);
    (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).set_meta("release_revision", &i64::MAX.to_string())
        .unwrap();
    assert_eq!(
        release_history::record_event(&tx, 0, "activate", None, None, serde_json::json!({}), &[])
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
    assert_eq!(
        (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).meta("release_revision").unwrap().unwrap(),
        i64::MAX.to_string()
    );
    tx.rollback().unwrap();
}

#[test]
fn release_contract_sqlite_timeline_counts() {
    let mut h = Harness::new();
    let table = h.engine.schema().tables["items"].clone();
    let tx = h.engine.store_mut().transaction().unwrap();
    test_cases::timeline_seed(&tx, &table);
    let num = (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).num("items").unwrap();
    (match &tx { snapback4_core::store_port::AnyTx::Sqlite(inner) => inner }).conn()
        .execute(
            "INSERT INTO r(t,id,data) VALUES (?1,'invalid','invalid json')",
            [num],
        )
        .unwrap();
    tx.commit().unwrap();
    test_cases::timeline_counts(h.engine.store());
}

#[test]
fn release_contract_sqlite_restart_closes_all_connections() {
    let directory =
        std::env::temp_dir().join(format!("sb4-release-restart-{:x}", crate::ids::seed()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("store.sqlite");
    let (schema, programs) = test_cases::compile(1);
    let mut engine =
        Engine::new_release(Store::open(&path).unwrap(), schema, programs, 1, None).unwrap();
    let before = engine.store_mut().release_status(0, None, None).unwrap();
    let identity = engine.store().store_identity().unwrap();
    drop(engine);
    let mut reopened = Engine::attach_release(Store::open(&path).unwrap(), 1).unwrap();
    assert_eq!(reopened.store().store_identity().unwrap(), identity);
    assert_eq!(
        reopened.store_mut().release_status(0, None, None).unwrap(),
        before
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

impl test_cases::OpeningRepairs for Harness {
    fn add(&mut self, id: &str) -> crate::engine::MutationOutcome {
        self.engine
            .mutate(
                "add",
                None,
                crate::Context::new(
                    "alice",
                    BTreeMap::from([
                        ("id".into(), Value::Id(id.into())),
                        ("n".into(), Value::Int(0)),
                    ]),
                )
                .at(100),
            )
            .unwrap()
    }
    fn reopen_repaired(&mut self) {
        self.reopen(1).unwrap();
    }

    fn damage(&mut self, live_sum: bool) {
        (match &self.engine.store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).conn().execute_batch(if live_sum {
            "DELETE FROM r WHERE t=(SELECT num FROM _catalog WHERE name='totals'); DELETE FROM i WHERE ti IN (SELECT num FROM _catalog WHERE name LIKE 'totals.%'); DELETE FROM _meta WHERE key='live_sum_candidates';"
        } else { "DELETE FROM _cap_counts; DELETE FROM _meta WHERE key='cap_counts_schema';" }).unwrap();
    }
    fn population(&mut self, table: &str) -> usize {
        self.engine.store().rows(table).unwrap().len()
    }
    fn marker(&mut self, marker: crate::metadata::SchemaMarker) -> Option<String> {
        self.engine.store().schema_marker(marker).unwrap()
    }
}

#[test]
fn release_contract_sqlite_reopening_live_sums() {
    let (schema, programs) = test_cases::repair_backend();
    test_cases::live_sum_reopening(&mut Harness::with_backend(schema, programs));
}

#[test]
fn release_contract_sqlite_reopening_cap_counts() {
    let (schema, programs) = test_cases::repair_backend();
    test_cases::cap_reopening(&mut Harness::with_backend(schema, programs));
}
