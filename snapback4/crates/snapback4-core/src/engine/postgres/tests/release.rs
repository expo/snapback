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
        let (schema, programs) = test_cases::compile(1);
        Self::with_backend(schema, programs)
    }
    fn with_backend(schema: Schema, programs: Vec<Program>) -> Option<Self> {
        let Ok(url) = std::env::var("SNAPBACK4_EVAL_POSTGRES") else {
            eprintln!(
                "SKIP P1-RL Postgres contract: SNAPBACK4_EVAL_POSTGRES is absent (scripts/test-postgres.sh)"
            );
            return None;
        };
        let name = format!("sb4_eval_release_{:x}", crate::ids::seed());
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
    fn activation_ledgers(&mut self) -> Vec<Vec<String>> {
        [
            "_backend",
            "_generations",
            "_catalog",
            "_meta",
            "_release_events",
            "_release_event_items",
            "_head",
        ]
        .into_iter()
        .map(|table| {
            self.engine
                .store
                .client
                .query(
                    &format!("SELECT row_to_json(t)::text FROM {table} t ORDER BY 1"),
                    &[],
                )
                .unwrap()
                .into_iter()
                .map(|row| row.get(0))
                .collect()
        })
        .collect()
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

#[test]
fn retained_column_admission_precedes_preparation_writes() {
    let Ok(url) = std::env::var("SNAPBACK4_EVAL_POSTGRES") else {
        return;
    };
    let compile = |declaration: Option<&str>| -> (Schema, Vec<Program>) {
        let source = format!(
            "table parents:\n  n: int\n  public\n  online only\ntable children:\n{}  public\n  online only\n",
            declaration.map_or(String::new(), |d| format!("  item: {d}\n"))
        );
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        (
            serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap(),
            b.programs
                .into_iter()
                .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
                .collect(),
        )
    };
    for (before, after, family) in [
        (
            "parents ? on delete restrict",
            "parents ? on delete keep",
            Some("evolution-authority"),
        ),
        (
            "parents ? on delete cascade",
            "parents ?",
            Some("evolution-authority"),
        ),
        (
            "text <=100",
            "text <=100 format email",
            None,
        ),
        ("text <=100", "text 8..100", None),
        ("int default 7", "int default 8", None),
        ("int ?", "int", None),
    ] {
        let name = format!("sb4_ev1_preparation_{:x}", crate::ids::seed());
        let store = crate::store_port::AnyStore::create_postgres(&url, &name).unwrap();
        let (s, p) = compile(Some(before));
        let mut e = crate::Engine::new_release(store, s, p, 1, None).unwrap();
        let (s, p) = compile(None);
        e.adopt_release_at(s, p, &ReleaseActivation::new(2, Some(1)), false, 1000)
            .unwrap();
        let mut client = Client::connect(&url, postgres::NoTls).unwrap();
        client
            .batch_execute(&format!("SET search_path = \"{name}\", pg_catalog"))
            .unwrap();
        // Sequence advancement survives rollback. This observes attempted writes,
        // unlike a post-error comparison of transactional state alone. The cap
        // initializer issues DDL before release preparation. Use a schema-scoped
        // database event trigger: relation triggers correctly fail shape checks.
        client.batch_execute(&format!("CREATE SEQUENCE preparation_writes; CREATE FUNCTION mark_preparation() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF current_schema() = '{name}' THEN PERFORM nextval('{name}.preparation_writes'); END IF; END $$; CREATE EVENT TRIGGER {name} ON ddl_command_start EXECUTE FUNCTION mark_preparation();")).unwrap();
        let (s, p) = compile(Some(after));
        let mut options = ReleaseActivation::new(3, Some(2));
        options.restore_dormant = true;
        let result = e.adopt_release_at(s, p, &options, false, 1000);
        if family.is_none() {
            result.unwrap();
            assert!(client.query_one("SELECT is_called FROM preparation_writes",&[]).unwrap().get::<_,bool>(0));
            drop(e);
            client.batch_execute(&format!("DROP SCHEMA \"{name}\" CASCADE")).unwrap();
            continue;
        }
        assert!(
            !client
                .query_one("SELECT is_called FROM preparation_writes", &[])
                .unwrap()
                .get::<_, bool>(0),
            "preparation wrote before {result:?}"
        );
        assert!(
            matches!(result,Err(RuntimeError::StoreUnsupported {family: f}) if Some(f)==family),
            "{before} -> {after}: {result:?}"
        );
        assert_eq!(e.generation(), 2);
        // Positive control: an identical restoration reaches preparation and
        // advances the same nontransactional marker.
        let (s, p) = compile(Some(before));
        e.adopt_release_at(s, p, &options, false, 1000).unwrap();
        assert!(
            client
                .query_one("SELECT is_called FROM preparation_writes", &[])
                .unwrap()
                .get::<_, bool>(0)
        );
        drop(e);
        client
            .batch_execute(&format!("DROP SCHEMA \"{name}\" CASCADE"))
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
        test_cases::bookkeeping(
            &tx,
            |k, v| tx.set_meta(k, v).unwrap(),
            |k| tx.meta(k).unwrap(),
        );
        test_cases::malformed_generation(&tx, |k, v| tx.set_meta(k, v).unwrap());
        test_cases::worker_history(&tx, |k, v| tx.set_meta(k, v).unwrap());
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
fn release_contract_postgres_activation_rechecks_ledgers_after_open() {
    for (table, event) in [
        ("_backend", "UPDATE"),
        ("_generations", "INSERT"),
        ("_meta", "UPDATE"),
    ] {
        let Some(mut h) = Harness::new() else {
            return;
        };
        let before = h.activation_ledgers();
        let mut owner = h.client();
        owner
            .batch_execute(&format!(
                "SET search_path = {}, pg_catalog;
                 CREATE FUNCTION preserve_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$;
                 CREATE TRIGGER preserve_ledger BEFORE {event} ON {table} FOR EACH ROW EXECUTE FUNCTION preserve_ledger()",
                h.name
            ))
            .unwrap();
        let error = h.activate(2, 2, 1, 1).unwrap_err();
        assert!(
            error.to_string().contains("SNAPBACK_MANAGED_RELATION_INTERCEPTION"),
            "{table}: {error}"
        );
        assert!(error.to_string().contains(table), "{error}");
        assert_eq!(h.activation_ledgers(), before);
        assert_eq!(h.generation(), 1);
        owner
            .batch_execute(&format!("DROP TRIGGER preserve_ledger ON {table}"))
            .unwrap();
        h.reopen(1).unwrap();
        assert_eq!(h.executed_version(), Value::Int(1));
        assert_eq!(h.activate(2, 2, 1, 1).unwrap(), 2);
        h.reopen(2).unwrap();
        assert_eq!(h.executed_version(), Value::Int(2));
    }
}

#[test]
fn release_contract_postgres_backend_publication_checks_returned_image() {
    use crate::{activation::Backend, value::canonical_json};
    // Exercise the write's own guard independently of activation preflight.
    for body in [
        "RETURN OLD;",
        "RETURN NULL;",
        "NEW.schema := OLD.schema; RETURN NEW;",
        "NEW.programs := OLD.programs; RETURN NEW;",
    ] {
        let Some(mut h) = Harness::new() else {
            return;
        };
        let before = h.activation_ledgers();
        h.engine.store.client.batch_execute(&format!(
            "CREATE FUNCTION alter_backend() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN {body} END $$;
             CREATE TRIGGER alter_backend BEFORE UPDATE ON _backend FOR EACH ROW EXECUTE FUNCTION alter_backend()"
        )).unwrap();
        let (schema, programs) = test_cases::compile(2);
        let programs: BTreeMap<_, _> = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        {
            let tx = h
                .engine
                .store
                .transaction(Some(WriteMode::Serialized))
                .unwrap();
            let error = tx
                .publish_backend(
                    &Backend(
                        2,
                        format!("{} ", canonical_json(&schema)),
                        canonical_json(&programs),
                    ),
                    200,
                )
                .unwrap_err();
            assert!(
                error.to_string().contains("SNAPBACK_ACTIVATION_SCHEMA"),
                "{body}: {error}"
            );
            // Dropping the refused transaction must also roll back generation 2.
        }
        assert_eq!(h.activation_ledgers(), before, "{body}");
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
    let error = h
        .engine
        .activate_release(changed, programs, &ReleaseActivation::new(2, Some(1)), 200)
        .unwrap_err();
    assert_eq!(error.code(), "E_STORE_UNSUPPORTED");
    assert_eq!(error.family(), "evolution");
    assert_eq!(error.refusal().family, "evolution");
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
    tx.execute(
        "INSERT INTO r(t,id,data) VALUES ('items','invalid','invalid json')",
        &[],
    )
    .unwrap();
    tx.commit().unwrap();
    let view = std::cell::RefCell::new(&mut h.engine.store);
    test_cases::timeline_counts(&view);
}

#[test]
fn release_contract_postgres_attach_refuses_incompatible_shapes() {
    // Each mutation occurs on a freshly owned namespace. An attach refusal
    // rolls back all attempted upgrades; cleanup drops only that namespace.
    for ddl in [
        "ALTER TABLE _backend SET UNLOGGED",
        "ALTER TABLE _head SET UNLOGGED",
        "ALTER TABLE r SET UNLOGGED",
        "ALTER TABLE _cap_counts SET UNLOGGED",
        "ALTER TABLE _head DROP CONSTRAINT _head_pkey; ALTER TABLE _head ADD PRIMARY KEY(singleton) DEFERRABLE",
        "CREATE FUNCTION preserve_backend() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$; CREATE TRIGGER preserve_backend BEFORE UPDATE ON _backend FOR EACH ROW EXECUTE FUNCTION preserve_backend()",
        "CREATE FUNCTION preserve_head() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$; CREATE TRIGGER preserve_head BEFORE UPDATE ON _head FOR EACH ROW EXECUTE FUNCTION preserve_head()",
        "ALTER TABLE _catalog DROP CONSTRAINT _catalog_num_key",
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
        if ["CREATE TRIGGER", "CREATE RULE", "ENABLE ROW LEVEL SECURITY"].iter().any(|kind|ddl.contains(kind)) {
            assert!(error.to_string().contains("SNAPBACK_MANAGED_RELATION_INTERCEPTION"),"{ddl}: {error}");
        } else {
            assert!(error.to_string().contains("SNAPBACK_ACTIVATION_SCHEMA")
                || error.to_string().contains("SNAPBACK_RELEASE_SCHEMA"), "{ddl}: {error}");
        }
    }
    // Creating another private namespace must inspect its target, regardless
    // of interception in the caller's previously selected namespace.
    let Some(h) = Harness::new() else { return; };
    let mut client = h.client();
    client.batch_execute(&format!("SET search_path={},pg_catalog; CREATE FUNCTION suppress_previous() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER suppress_previous BEFORE DELETE ON r FOR EACH ROW EXECUTE FUNCTION suppress_previous()",h.name)).unwrap();
    let name=format!("sb4_eval_fresh_scope_{:x}",crate::ids::seed());
    let (schema,programs)=test_cases::compile(1);
    let mut created=PostgresEngine::create(client,&name,schema,programs).unwrap();
    created.store.client.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();

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
        self.engine.store.client.batch_execute(if live_sum {
            "DELETE FROM r WHERE t='totals'; DELETE FROM i WHERE t='totals'; DELETE FROM _meta WHERE key='live_sum_candidates';"
        } else { "DELETE FROM _cap_counts; DELETE FROM _meta WHERE key='cap_counts_schema';" }).unwrap();
    }
    fn population(&mut self, table: &str) -> usize {
        self.engine
            .store
            .client
            .query_one("SELECT count(*) FROM r WHERE t=$1", &[&table])
            .unwrap()
            .get::<_, i64>(0) as usize
    }
    fn marker(&mut self, marker: crate::metadata::SchemaMarker) -> Option<String> {
        let tx = self.engine.store.transaction(None).unwrap();
        let value = tx.schema_marker(marker).unwrap();
        tx.rollback().unwrap();
        value
    }
}

#[test]
fn release_contract_postgres_reopening_live_sums() {
    let (schema, programs) = test_cases::repair_backend();
    if let Some(mut h) = Harness::with_backend(schema, programs) {
        test_cases::live_sum_reopening(&mut h);
    }
}

#[test]
fn release_contract_postgres_reopening_cap_counts() {
    let (schema, programs) = test_cases::repair_backend();
    if let Some(mut h) = Harness::with_backend(schema, programs) {
        test_cases::cap_reopening(&mut h);
    }
}
