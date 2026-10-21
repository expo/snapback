//! Internal Postgres opening/activation for S10c. Namespace selection is a
//! library test seam; public deployment configuration and fencing remain S10d.
// @ref LLP 3000.009.001.000#3.4 — shared builders own semantic activation; the adapter owns physical installation.
use super::{Handle, activation::Preparation, store::{self, Tx}};
use crate::{RuntimeError, Schema, Program, activation::Backend, metadata::MetadataReader,
    store_port::{AnyStore, AnyTx, AnyPreparation, report::AdoptionReport},
    engine::committer::{Committer, Committed, Kind, Pending}};
use std::{cell::RefCell, collections::BTreeMap};

impl AnyStore {
    /// Internal, private-cluster API. No schema is created before Engine admission.
    pub fn create_postgres(connection: &str, namespace: &str) -> Result<Self, RuntimeError> {
        Handle::connect(connection.parse()?, namespace, true).map(Self::Postgres)
    }
    /// Open the persisted generation, using the same connection settings for readers.
    pub fn open_postgres(connection: &str, namespace: &str) -> Result<Self, RuntimeError> {
        Handle::connect(connection.parse()?, namespace, false).map(Self::Postgres)
    }
    pub(crate) fn admit(&self, schema: &Schema, programs: &BTreeMap<String, Program>) -> Result<(), RuntimeError> {
        match self { Self::Sqlite(_) => Ok(()), Self::Postgres(_) => super::profile::admit(schema, programs) }
    }
}
impl AnyTx<'_> {
    pub(crate) fn admit(&self, schema: &Schema, programs: &BTreeMap<String, Program>) -> Result<(), RuntimeError> {
        match self { Self::Sqlite(_) => Ok(()), Self::Postgres(_) => super::profile::admit(schema, programs) }
    }
}

impl Handle {
    pub(super) fn connect(config: postgres::Config, name: &str, fresh: bool) -> Result<Self, RuntimeError> {
        let quoted = store::namespace(name)?;
        let mut client = config.connect(postgres::NoTls)?;
        if fresh {
            if client.query_one("SELECT to_regnamespace($1) IS NOT NULL", &[&name])?.get::<_, bool>(0) {
                return Err(RuntimeError::Store("Postgres namespace already exists".into()));
            }
        }
        client.batch_execute(&format!("SET search_path = {quoted}, pg_catalog; SET statement_timeout = '5s'; SET lock_timeout = '5s'"))?;
        let mut store = store::Store::new(client);
        if !fresh {
            let tx = store.opening_transaction()?;
            let row = tx.query("SELECT version,schema,programs,generation FROM _backend WHERE singleton", &[])?.remove(0);
            if row.get::<_, &str>(0) != store::VERSION { return Err(RuntimeError::StoreUnsupported { family: "opening" }); }
            let schema: Schema = store::decode(row.get(1))?;
            let programs = store::decode(row.get(2))?;
            super::profile::admit(&schema, &programs)?;
            let generation = u64::try_from(row.get::<_, i64>(3)).map_err(|_| RuntimeError::Generation("negative generation".into()))?;
            tx.rollback()?;
            store.generation = generation;

        }
        Ok(Self { store: RefCell::new(store), report: AdoptionReport::default(), connection: (config, name.into()), fresh })
    }

    pub(crate) fn activate<R>(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, now: i64,
        check: impl Fn(&AnyPreparation<'_, '_>) -> Result<(), RuntimeError>,
        mut build: impl FnMut(&AnyTx<'_>, bool, &mut AdoptionReport) -> Result<(), RuntimeError>,
        finish: impl Fn(&AnyTx<'_>) -> Result<R, RuntimeError>,
    ) -> Result<Committed<(u64, R)>, RuntimeError> {
        let programs = programs.ok_or(RuntimeError::StoreUnsupported { family: "release-activation" })?;
        super::profile::admit(schema, programs)?;
        if reset { return Err(RuntimeError::StoreUnsupported { family: "dev-reset" }); }
        let fresh = self.fresh;
        let quoted = store::namespace(&self.connection.1)?;
        let mut report = AdoptionReport::default();
        let result = Committer::run_committed_with(self.store.get_mut(), |store| Committer::run_solo(Kind::Administrative, |solo| {
            let expected_generation = store.generation;
            let tx = solo.open_solo_with(|| store.opening_transaction())?;
            if fresh {
                tx.batch(&format!("CREATE SCHEMA {quoted}; SET search_path = {quoted}, pg_catalog;"))?;
                tx.batch(store::DDL)?;
                tx.execute_one("INSERT INTO _backend(singleton,version,schema,programs) VALUES (true,$1,$2,$3)", &[&store::VERSION, &crate::value::canonical_json(schema), &crate::value::canonical_json(programs)])?;
                tx.batch("ALTER TABLE _backend ADD COLUMN generation BIGINT NOT NULL DEFAULT 1; ALTER TABLE _backend ADD COLUMN through_shortened TEXT NOT NULL DEFAULT '{}'; ALTER TABLE _backend ADD COLUMN maintained_identity_version TEXT;")?;
            }
            let head = tx.query("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?[0].get::<_, i64>(0) as u64;
            tx.head.set(Some(head)); tx.serialized_head.set(true);
            let held = tx.query("SELECT generation,schema,programs FROM _backend WHERE singleton", &[])?.remove(0);
            let before = Backend(held.get(0), held.get(1), held.get(2));
            if !fresh && before.0 != expected_generation as i64 { return Err(RuntimeError::Generation("another engine activated this store".into())); }
            // This slice has no row-evolution runner. Refuse before preparation writes.
            if !fresh && store::decode::<Schema>(&before.1)?.hash() != schema.hash() { return Err(RuntimeError::StoreUnsupported { family: "release-activation" }); }
            initialize(&tx, schema)?;
            if fresh { tx.set_meta("store_id", &format!("{:016x}{:016x}", crate::ids::seed(), crate::ids::seed()))?; }
            let changed = fresh || before.2 != crate::value::canonical_json(programs);
            let generation = if !fresh && changed { before.0.checked_add(1).ok_or_else(|| RuntimeError::Generation("generation overflow".into()))? } else { before.0 };
            let tx = AnyTx::Postgres(tx);
            if let AnyTx::Postgres(inner) = &tx { check(&AnyPreparation::Postgres(Preparation(inner)))?; }
            build(&tx, changed, &mut report)?;
            if let AnyTx::Postgres(inner) = &tx {
                inner.publish_backend(&Backend(generation, crate::value::canonical_json(schema), crate::value::canonical_json(programs)), now)?;
                inner.set_meta("schema_hash", &schema.hash())?;
                inner.set_meta("activation_hash", &crate::activation::activation_hash(schema, programs, inner.release_native_digest()?.as_deref()))?;
                inner.set_meta("time_audience_publications_v1", "1")?;
            }
            let value = finish(&tx)?;
            solo.commit(tx)?;
            Ok(Pending::new((generation as u64, value), generation as u64))
        }), |store, generation, value| { store.generation = generation; Ok(value) });
        if result.is_ok() { self.fresh = false; self.report = report; }
        result
    }
}

pub(super) fn initialize(tx: &Tx<'_>, schema: &Schema) -> Result<(), RuntimeError> {
    super::activation_schema::verify_core(tx)?;
    super::identity_schema::verify_existing(tx)?;
    super::metadata::initialize(tx)?;
    super::receipts::initialize(tx)?;
    super::change_evidence::initialize(tx)?;
    tx.batch(store::READ_SESSIONS_DDL)?;
    tx.batch(super::identity::DDL)?;
    super::requests::initialize(tx)?;
    super::outbox_schema::install(tx)?;
    super::caps::install(tx, schema)?;
    super::jobs::initialize(tx)?;
    super::assets_schema::initialize(tx)?;
    super::activation_schema::initialize(tx)?;
    super::release_schema::initialize(tx)
}

impl Tx<'_> {
    pub(crate) fn finish_open(self) -> Result<crate::store_port::OpeningMetadata, RuntimeError> {
        // A detached reader never upgrades. A writer retains its head fence and
        // all validated construction facts until the opening transaction commits.
        if self.serialized_head.get() {
            let schema: Schema = store::decode(&crate::activation::ActivationReader::opening_backend(&self)?.1)?;
            initialize(&self, &schema)?;
            let metadata = crate::store_port::OpeningMetadata::read(&self)?;
            self.commit()?;
            Ok(metadata)
        } else {
            let metadata = crate::store_port::OpeningMetadata::read(&self)?;
            self.rollback()?;
            Ok(metadata)
        }
    }
}
