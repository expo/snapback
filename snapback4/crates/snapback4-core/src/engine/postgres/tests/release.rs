use super::super::*;
use crate::{
    activation::ActivationReader,
    engine::release::ReleaseActivation,
    metadata::MetadataReader,
    release_history::{
        self,
        test_cases::{self, Lifecycle},
    },
};

struct Harness {
    engine: PostgresEngine,
    name: String,
    url: String,
}
impl Harness {
    fn new() -> Option<Self> {
        let Ok(url) = std::env::var("SNAPBACK4_EVAL_POSTGRES") else {
            eprintln!(
                "SKIP P1-RL Postgres contract: SNAPBACK4_EVAL_POSTGRES is absent (scripts/test-postgres.sh)"
            );
            return None;
        };
        let name = format!("sb4_eval_release_{:x}", crate::ids::seed());
        let (schema, programs) = test_cases::compile(1);
        let engine = PostgresEngine::create_release(
            Client::connect(&url, postgres::NoTls).unwrap(),
            &name,
            schema,
            programs,
            &ReleaseActivation::new(1, None),
        )
        .unwrap();
        Some(Self { engine, name, url })
    }
    fn client(&self) -> Client {
        Client::connect(&self.url, postgres::NoTls).unwrap()
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.engine
            .store
            .client
            .batch_execute(&format!("DROP SCHEMA \"{}\" CASCADE", self.name))
            .unwrap();
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
            .activate_release(schema, programs, &options, 200)
    }
    fn reopen(&mut self, release: u64) -> Result<(), RuntimeError> {
        self.engine = PostgresEngine::open_selected(self.client(), &self.name, release)?;
        Ok(())
    }
    fn status(&mut self) -> serde_json::Value {
        self.engine.release_status(0, None, None).unwrap()
    }
}

#[test]
fn release_contract_postgres_lifecycle() {
    if let Some(mut h) = Harness::new() {
        test_cases::lifecycle(&mut h);
    }
}

#[test]
fn release_contract_postgres_facts_history_and_terminal_error() {
    let Some(mut h) = Harness::new() else {
        return;
    };
    let store_id;
    {
        let tx = h
            .engine
            .store
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        store_id = tx.store_identity().unwrap();
        test_cases::opening_facts(&tx);
        test_cases::bookkeeping(&tx, |k, v| tx.set_meta(k, v).unwrap());
        let backend = tx.opening_backend().unwrap();
        test_cases::preparation(&activation::Preparation(&tx), &backend);
        test_cases::history(&tx);
        tx.rollback().unwrap();
    }
    let first = h.status();
    {
        let tx = h
            .engine
            .store
            .transaction(Some(WriteMode::Serialized))
            .unwrap();
        test_cases::statement_error(&tx);
        // Never commit after an adapter error (shared terminal-error contract).
    }
    assert_eq!(h.status(), first);
    h.reopen(1).unwrap();
    let tx = h.engine.store.transaction(None).unwrap();
    assert_eq!(tx.store_identity().unwrap(), store_id);
    tx.rollback().unwrap();
}

#[test]
fn release_contract_postgres_streaming_and_retired_names() {
    let Some(mut h) = Harness::new() else {
        return;
    };
    let tx = h
        .engine
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.execute(
        "INSERT INTO r(t,id,data) VALUES ('items','a','\"Null\"'),('items','b','invalid json')",
        &[],
    )
    .unwrap();
    crate::activation::test_cases::streaming_retirement(&tx);
    crate::activation::test_cases::retired_names(&tx);
    tx.rollback().unwrap();
}

#[test]
fn release_contract_postgres_activation_race() {
    use std::sync::Arc;
    for version in [1, 2] {
        let Some(mut h) = Harness::new() else {
            return;
        };
        let mut peer = PostgresEngine::open_selected(h.client(), &h.name, 1).unwrap();
        let race = Arc::new(crate::store::test_race::FenceRace::postgres(
            &mut h.engine.store.client,
            &mut peer.store.client,
            Client::connect(&h.url, postgres::NoTls).unwrap(),
        ));
        let other = race.clone();
        let thread = std::thread::spawn(move || {
            other.arm_activation(false);
            let (schema, programs) = test_cases::compile(3);
            peer.activate_release(schema, programs, &ReleaseActivation::new(3, Some(1)), 300)
        });
        race.arm_activation(true);
        assert_eq!(h.activate(version, 2, 1, 1).unwrap(), version);
        assert_eq!(thread.join().unwrap().unwrap_err().code(), "E_GENERATION");
        assert_eq!(h.status()["release"], 2);
        assert_eq!(h.status()["events"].as_array().unwrap().len(), 2);
    }
}

#[test]
fn release_contract_postgres_refuses_evolution_and_bad_admission_without_writes() {
    let Some(mut h) = Harness::new() else {
        return;
    };
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
                .activate_release(schema.clone(), programs.clone(), &options, 200)
                .is_err()
        );
        assert_eq!(h.status(), before);
    }
    let mut changed = schema;
    changed
        .tables
        .insert("other".into(), changed.tables["items"].clone());
    assert!(
        h.engine
            .activate_release(changed, programs, &ReleaseActivation::new(2, Some(1)), 200)
            .unwrap_err()
            .to_string()
            .contains("evolution family")
    );
    assert_eq!(h.status(), before);
    let tx = h
        .engine
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    tx.execute("UPDATE _release_events SET id=$1", &[&i64::MAX])
        .unwrap();
    test_cases::event_id_exhaustion(&tx);
    tx.set_meta("release_revision", &i64::MAX.to_string())
        .unwrap();
    assert_eq!(
        release_history::record_event(&tx, 0, "activate", None, None, serde_json::json!({}), &[])
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
    assert_eq!(
        tx.meta("release_revision").unwrap().unwrap(),
        i64::MAX.to_string()
    );
    tx.rollback().unwrap();
}

#[test]
fn release_contract_postgres_explicit_columns_and_no_activation_ddl() {
    let Some(mut h) = Harness::new() else {
        return;
    };
    let mut other = PostgresEngine::open(h.client(), &h.name).unwrap();
    {
        let tx = h.engine.store.transaction(None).unwrap();
        use crate::release_history::ReleaseHistoryReader;
        assert_eq!(tx.release_events(0, 16).unwrap().len(), 1); // cache this plan
        tx.rollback().unwrap();
    }
    other
        .store
        .client
        .batch_execute("ALTER TABLE _release_events ADD COLUMN additive TEXT")
        .unwrap();
    assert_eq!(h.status()["events"].as_array().unwrap().len(), 1);
    other
        .store
        .client
        .batch_execute("ALTER TABLE _release_events DROP COLUMN additive")
        .unwrap();
    // Hold a real reader's relation locks while the adapter activates. A DDL
    // writer would conflict; an INSERT/UPDATE activation must finish normally.
    let tx = other.store.transaction(None).unwrap();
    assert_eq!(tx.opening_backend().unwrap().0, 1);
    assert_eq!(h.activate(2, 2, 1, 1).unwrap(), 2);
    assert_eq!(tx.opening_backend().unwrap().0, 1); // repeatable read pins backend
    tx.rollback().unwrap();
}

#[test]
fn release_contract_postgres_timeline_counts() {
    let Some(mut h) = Harness::new() else {
        return;
    };
    let table = h.engine.schema.tables["items"].clone();
    let tx = h
        .engine
        .store
        .transaction(Some(WriteMode::Serialized))
        .unwrap();
    test_cases::timeline_seed(&tx, &table);
    tx.commit().unwrap();
    let view = std::cell::RefCell::new(&mut h.engine.store);
    test_cases::timeline_counts(&view);
}

#[test]
fn release_contract_postgres_attach_refuses_incompatible_shapes() {
    // Each mutation occurs on a freshly owned namespace. An attach refusal
    // rolls back all attempted upgrades; cleanup drops only that namespace.
    for ddl in [
        "ALTER TABLE _generations SET UNLOGGED",
        "ALTER TABLE _generations ADD COLUMN extra TEXT",
        "ALTER TABLE _generations ADD CHECK(generation>0)",
        "ALTER TABLE _generations DROP CONSTRAINT _generations_pkey; ALTER TABLE _generations ADD PRIMARY KEY(generation) DEFERRABLE",
        "CREATE RULE hidden_generation AS ON INSERT TO _generations DO INSTEAD NOTHING",
        "CREATE TABLE inherited_generation () INHERITS (_generations)",
        "CREATE TABLE generation_parent (extra TEXT); ALTER TABLE _generations ADD COLUMN extra TEXT; ALTER TABLE _generations INHERIT generation_parent",
        "ALTER TABLE _release_event_items ALTER COLUMN path TYPE TEXT COLLATE \"default\"",
        "ALTER TABLE _release_events ALTER COLUMN at SET DEFAULT 0",
        "ALTER TABLE _release_events ADD UNIQUE(revision)",
        "ALTER TABLE _release_events ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE _release_events RENAME TO old_events; CREATE TABLE _release_events (LIKE old_events INCLUDING ALL) PARTITION BY RANGE(id)",
        "CREATE FUNCTION release_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER release_trigger BEFORE INSERT ON _release_events FOR EACH ROW EXECUTE FUNCTION release_trigger()",
    ] {
        let Some(mut h) = Harness::new() else {
            return;
        };
        h.engine.store.client.batch_execute(ddl).unwrap();
        let error = PostgresEngine::open(h.client(), &h.name).err().expect(ddl);
        assert!(
            error.to_string().contains("SNAPBACK_ACTIVATION_SCHEMA")
                || error.to_string().contains("SNAPBACK_RELEASE_SCHEMA"),
            "{ddl}: {error}"
        );
    }
}

#[test]
fn release_contract_postgres_restart_closes_all_connections() {
    let Ok(url) = std::env::var("SNAPBACK4_EVAL_POSTGRES") else {
        eprintln!("SKIP P1-RL restart: SNAPBACK4_EVAL_POSTGRES is absent");
        return;
    };
    let name = format!("sb4_eval_release_restart_{:x}", crate::ids::seed());
    let (schema, programs) = test_cases::compile(1);
    let mut engine = PostgresEngine::create_release(
        Client::connect(&url, postgres::NoTls).unwrap(),
        &name,
        schema,
        programs,
        &ReleaseActivation::new(1, None),
    )
    .unwrap();
    let before = engine.release_status(0, None, None).unwrap();
    let identity = {
        let tx = engine.store.transaction(None).unwrap();
        let id = tx.store_identity().unwrap();
        tx.rollback().unwrap();
        id
    };
    drop(engine);
    let mut reopened =
        PostgresEngine::open_selected(Client::connect(&url, postgres::NoTls).unwrap(), &name, 1)
            .unwrap();
    assert_eq!(reopened.release_status(0, None, None).unwrap(), before);
    let tx = reopened.store.transaction(None).unwrap();
    assert_eq!(tx.store_identity().unwrap(), identity);
    tx.rollback().unwrap();
    reopened
        .store
        .client
        .batch_execute(&format!("DROP SCHEMA \"{name}\" CASCADE"))
        .unwrap();
}
