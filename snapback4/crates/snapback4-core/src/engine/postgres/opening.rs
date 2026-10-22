//! Postgres opening/activation behind the neutral store handle. Public URL
//! configuration and lease cadence belong to the host configuration boundary.
// @ref LLP 3000.009.001.000#3.4 — shared builders own semantic activation; the adapter owns physical installation.
use super::{Handle, activation::Preparation, store::{self, Tx}};
use crate::{RuntimeError, Schema, Program, activation::Backend, metadata::MetadataReader,
    store_port::{AnyStore, AnyTx, AnyPreparation, report::AdoptionReport},
    engine::committer::{Committer, Committed, Kind, Pending}};
use std::{cell::RefCell, collections::BTreeMap};

impl AnyStore {
    /// Bootstrap only. No schema is created before Engine admission; public serve
    /// must reopen with a positive acquired token through open_postgres_owned.
    pub fn create_postgres(connection: &str, namespace: &str) -> Result<Self, RuntimeError> {
        Handle::connect(connection.parse()?, namespace, true).map(AnyStore::from_postgres)
    }
    /// Public bootstrap uses the identity durably recorded by its host intent.
    pub fn create_postgres_with_id(connection: &str, namespace: &str, store_id: &str) -> Result<Self, RuntimeError> {
        let fence = super::ownership::Fence { store_id: store_id.into(), holder: "0000".into(), token: 0 };
        fence.tag()?;
        let mut handle = Handle::connect(connection.parse()?, namespace, true)?;
        handle.bootstrap_id = Some(fence.store_id);
        Ok(AnyStore::from_postgres(handle))
    }
    /// Open the persisted generation, using the same connection settings for readers.
    pub fn open_postgres(connection: &str, namespace: &str) -> Result<Self, RuntimeError> {
        Handle::connect(connection.parse()?, namespace, false).map(AnyStore::from_postgres)
    }
    pub fn admit(&self, schema: &Schema, programs: &BTreeMap<String, Program>) -> Result<(), RuntimeError> {
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
        Self::connect_inner(config, name, fresh, None)
    }
    pub(super) fn connect_owned(config: postgres::Config, name: &str, fence: Option<super::ownership::Fence>) -> Result<Self, RuntimeError> {
        Self::connect_inner(config, name, false, fence)
    }
    fn connect_inner(config: postgres::Config, name: &str, fresh: bool, fence: Option<super::ownership::Fence>) -> Result<Self, RuntimeError> {
        let quoted = store::namespace(name)?;
        let (mut client, warning) = super::ownership::connect(config.clone())?;
        if fresh {
            if client.query_one("SELECT to_regnamespace($1) IS NOT NULL", &[&name])?.get::<_, bool>(0) {
                return Err(RuntimeError::Store("Postgres namespace already exists".into()));
            }
        }
        #[cfg(any(test, feature = "test-support"))]
        crate::round_trips::postgres(1);
        client.batch_execute(&format!("SET search_path = {quoted}, pg_catalog; SET statement_timeout = '5s'; SET lock_timeout = '5s'"))?;
        let mut store = store::Store::new(client);
        store.unified = true;
        store.commit_warning = warning;
        store.fence = fence;
        if !fresh {
            if store.fence.is_none() {
                #[cfg(any(test, feature = "test-support"))]
                crate::round_trips::postgres(2);
                let id = store.client.query_opt("SELECT value FROM _meta WHERE key='store_id'", &[])?.map(|r| r.get::<_, String>(0));
                if let Some(store_id) = id { store.fence = Some(super::ownership::Fence { store_id, holder: "0000".into(), token: 0 }); }
            }
            if let Some(fence) = &store.fence {
                #[cfg(any(test, feature = "test-support"))]
                crate::round_trips::postgres(2);
                store.client.execute("SELECT set_config('application_name',$1,false)", &[&fence.tag()?])?; }
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
        Ok(Self { store: RefCell::new(store), report: AdoptionReport::default(), connection: (config, name.into()), fresh, bootstrap_id: None })
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
        let bootstrap_fence = fresh.then(|| super::ownership::Fence {
            store_id: self.bootstrap_id.clone().unwrap_or_else(|| format!("{:016x}{:016x}", crate::ids::seed(), crate::ids::seed())), holder: "0000".into(), token: 0,
        });
        let quoted = store::namespace(&self.connection.1)?;
        let mut report = AdoptionReport::default();
        let result = Committer::run_committed_with(self.store.get_mut(), |store| Committer::run_solo(Kind::Administrative, |solo| {
            let expected_generation = store.generation;
            let tx = solo.open_solo_with(|| store.opening_transaction())?;
            if fresh {
                tx.batch(&format!("CREATE SCHEMA {quoted}; SET search_path = {quoted}, pg_catalog;"))?;
                if let Some(fence) = &bootstrap_fence {
                    super::ownership::install(&tx, &fence.store_id)?;
                    tx.query("SELECT token FROM _owner WHERE singleton FOR KEY SHARE", &[])?;
                }
                tx.batch(store::DDL)?;
                tx.execute_one("INSERT INTO _backend(singleton,version,schema,programs) VALUES (true,$1,$2,$3)", &[&store::VERSION, &crate::value::canonical_json(schema), &crate::value::canonical_json(programs)])?;
                tx.batch("ALTER TABLE _backend ADD COLUMN generation BIGINT NOT NULL DEFAULT 1; ALTER TABLE _backend ADD COLUMN through_shortened TEXT NOT NULL DEFAULT '{}'; ALTER TABLE _backend ADD COLUMN maintained_identity_version TEXT;")?;
            }
            let head = tx.query("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?[0].get::<_, i64>(0) as u64;
            tx.head.set(Some(head)); tx.serialized_head.set(true);
            let held = tx.query("SELECT generation,schema,programs FROM _backend WHERE singleton", &[])?.remove(0);
            let before = Backend(held.get(0), held.get(1), held.get(2));
            if !fresh && before.0 != expected_generation as i64 { return Err(RuntimeError::Generation("another engine activated this store".into())); }
            // Admission precedes every preparation write, under the head fence.
            let previous: Schema = store::decode(&before.1)?;
            let schema_changed = !fresh && previous.hash() != schema.hash();
            if schema_changed { super::column_evolution::admit(&previous, schema)?; }
            initialize(&tx, schema)?;
            if let Some(fence) = &bootstrap_fence {
                tx.set_meta("store_id", &fence.store_id)?;
                tx.execute("SELECT set_config('application_name',$1,false)", &[&fence.tag()?])?;
            }
            let store_id = tx.meta("store_id")?.ok_or(RuntimeError::WorkerStoreIdentity)?;
            super::ownership::install(&tx, &store_id)?;
            let changed = fresh || schema_changed || before.2 != crate::value::canonical_json(programs);
            let generation = if !fresh && changed { before.0.checked_add(1).ok_or_else(|| RuntimeError::Generation("generation overflow".into()))? } else { before.0 };
            let tx = AnyTx::from_postgres(tx);
            tx.with_postgres(|inner| check(&AnyPreparation::Postgres(Preparation(inner))))?;
            if schema_changed { tx.with_postgres(|inner| super::column_evolution::project(inner, &previous, schema))?; }
            build(&tx, changed, &mut report)?;
            tx.with_postgres(|inner| {
                inner.publish_backend(&Backend(generation, crate::value::canonical_json(schema), crate::value::canonical_json(programs)), now)?;
                inner.set_meta("schema_hash", &schema.hash())?;
                inner.set_meta("activation_hash", &crate::activation::activation_hash(schema, programs, inner.release_native_digest()?.as_deref()))?;
                inner.set_meta("time_audience_publications_v1", "1")
            })?;
            let value = finish(&tx)?;
            solo.commit(tx)?;
            Ok(Pending::new((generation as u64, value), generation as u64))
        }), |store, generation, value| { store.generation = generation; Ok(value) });
        if result.is_ok() {
            self.fresh = false; self.report = report;
            if let Some(fence) = bootstrap_fence { self.store.get_mut().fence = Some(fence); }
        }
        result
    }
}

pub(super) fn initialize(tx: &Tx<'_>, schema: &Schema) -> Result<(), RuntimeError> {
    super::activation_schema::verify_core(tx)?;
    // Apply the evaluator's portable key bound before accepting an existing
    // generation, as well as on each shared row/index write.
    if let Some(row) = tx.query(
        "SELECT t, ix, COUNT(*) FROM i WHERE octet_length(k) > $1 GROUP BY t, ix ORDER BY t, ix LIMIT 1",
        &[&(crate::rows::MAX_INDEX_KEY_BYTES as i32)],
    )?.first() {
        return Err(crate::rows::index_key_refusal(row.get(0), row.get(1), row.get::<_, i64>(2) as u64));
    }
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
            let id = self.meta("store_id")?.ok_or(RuntimeError::WorkerStoreIdentity)?;
            super::ownership::install(&self, &id)?;
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
