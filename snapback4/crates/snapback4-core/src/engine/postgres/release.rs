//! Database-authoritative release selection/history; no release files or blobs.
// @ref LLP 3000.009.001.000#3.4 — S10d will bind these facts to immutable local source before serving.
use super::{PostgresEngine, WriteMode, activation::Preparation, store::Tx};
use crate::{
    Program, RuntimeError, Schema,
    activation::{self, ActivationPreparation, ActivationReader, ActivationTransaction, Backend},
    engine::release::{ReleaseActivation, ReleaseTransaction},
    release_history::{
        self, DormantItem, Event, ReleaseHistoryReader, ReleaseHistoryTransaction, counter,
    },
    value::canonical_json,
};
use std::collections::BTreeMap;

impl ReleaseTransaction for Tx<'_> {
    fn selected_release(&self) -> Result<Option<String>, RuntimeError> {
        self.meta("release")
    }
    fn release_revision(&self) -> Result<Option<String>, RuntimeError> {
        self.meta("release_revision")
    }
}
impl ReleaseHistoryReader for Tx<'_> {
    fn release_events(&self, after: u64, limit: usize) -> Result<Vec<Event>, RuntimeError> {
        self.query("SELECT id,at,operation,release,previous,generation,revision,summary FROM _release_events WHERE id>$1 ORDER BY id LIMIT $2", &[&counter(after)?, &(limit.min(i64::MAX as usize) as i64)])?.iter().map(|r| {
            Ok(Event { id: r.get::<_, i64>(0) as u64, at: r.get(1), operation: r.get(2), release: r.get::<_, Option<i64>>(3).map(|n| n as u64), previous: r.get::<_, Option<i64>>(4).map(|n| n as u64), generation: r.get::<_, i64>(5) as u64, revision: r.get::<_, i64>(6) as u64, summary: super::store::decode(r.get(7))? })
        }).collect()
    }
    fn release_event_items(
        &self,
        event: u64,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<DormantItem>, RuntimeError> {
        // No stored path can contain NUL in Postgres; a NUL cursor's lexical
        // prefix still has a meaningful order, so compare its UTF-8 bytes.
        self.query("SELECT detail FROM _release_event_items WHERE event=$1 AND ($2::bytea IS NULL OR convert_to(path,'UTF8')>$2) ORDER BY path LIMIT $3", &[&counter(event)?, &after.map(str::as_bytes), &(limit.min(i64::MAX as usize) as i64)])?.iter().map(|r| super::store::decode(r.get(0))).collect()
    }
    fn release_inventory(
        &self,
        _after: Option<&str>,
        _limit: usize,
    ) -> Result<Vec<DormantItem>, RuntimeError> {
        self.activation_inventory()
    }
    fn previous_active_release(&self) -> Result<Option<u64>, RuntimeError> {
        Ok(self.query("SELECT previous FROM _release_events WHERE release IS NOT NULL AND previous != release AND operation != 'prune' ORDER BY id DESC LIMIT 1", &[])?.first().and_then(|r| r.get::<_, Option<i64>>(0)).map(|n| n as u64))
    }
    fn release_workers(&self, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
        Ok(self.query("SELECT key,value FROM _meta WHERE key='worker:status' OR translate(key,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') LIKE 'worker:status:%' ORDER BY key LIMIT $1", &[&(limit.min(i64::MAX as usize) as i64)])?.iter().map(|r| (r.get(0), r.get(1))).collect())
    }
}
impl ReleaseHistoryTransaction for Tx<'_> {
    fn finalize_restorations(&self) -> Result<(), RuntimeError> {
        // The admitted profile has no dormant population. SQLite still records
        // its finalized zero before the activation clears scratch metadata.
        self.set_meta("activation_narrowed_restored", "0")
    }
    fn insert_release_event(
        &self,
        event: &Event,
        items: &[DormantItem],
    ) -> Result<u64, RuntimeError> {
        let held: i64 =
            self.query("SELECT COALESCE(MAX(id),0) FROM _release_events", &[])?[0].get(0);
        let id = release_history::next_event_id(held)?;
        self.set_meta("release_revision", &event.revision.to_string())?;
        self.execute_one("INSERT INTO _release_events(id,at,operation,release,previous,generation,revision,summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", &[&id, &event.at, &event.operation, &event.release.map(counter).transpose()?, &event.previous.map(counter).transpose()?, &counter(event.generation)?, &counter(event.revision)?, &event.summary.to_string()])?;
        for item in items {
            self.execute_one(
                "INSERT INTO _release_event_items(event,path,detail) VALUES ($1,$2,$3)",
                &[&id, &item.key, &canonical_json(item)],
            )?;
        }
        Ok(id as u64)
    }
}

pub(super) fn finish(
    tx: &Tx<'_>,
    options: &ReleaseActivation,
    now: i64,
) -> Result<(), RuntimeError> {
    tx.finalize_restorations()?;
    tx.set_active_release(options.release)?;
    release_history::record_event(
        tx,
        now,
        &options.operation,
        Some(options.release),
        options.expected_previous,
        serde_json::json!({"dormant_items":0,"restored_items":0,"native_digest":options.native_digest,"narrowed_retained":0,"narrowed_restored":0}),
        &[],
    )?;
    tx.clear_activation_metadata()
}

impl PostgresEngine {
    /// Minimal evaluator deployment: first generation, selection and audit
    /// commit together. The host still owns immutable source/metadata binding.
    pub fn create_release(
        client: postgres::Client,
        name: &str,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation,
    ) -> Result<Self, RuntimeError> {
        options.validate()?;
        let name = super::evaluation_namespace(name)?;
        super::refuse_maintained_columns(&schema)?;
        super::super::columns::validate_before_prepare(&schema)?;
        schema.prepare_contribution_indexes();
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        super::supported(&schema, &programs)?;
        Self::attach(client, schema, programs, Some(&name), Some(options), None)
    }

    /// A program-only release can switch the semantic generation without row
    /// evolution. Unsupported schema changes refuse before preparation writes.
    pub fn activate_release(
        &mut self,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        options.validate()?;
        super::super::columns::validate_before_prepare(&schema)?;
        schema.prepare_contribution_indexes();
        schema.prepare_delivery_lookup();
        let programs: BTreeMap<_, _> = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        super::supported(&schema, &programs)?;
        let tx = self.store.transaction(Some(WriteMode::Serialized))?;
        super::activation_schema::verify_activation(&tx)?;
        let prep = Preparation(&tx);
        options.check(&prep)?;
        let previous = tx.opening_backend()?;
        // Like SQLite, audit/adoption timestamps use wall time independently
        // of the caller's application clock. This profile rewrites no rows.
        let _clock = now.max(tx.time_audience_clock()?);
        let at = crate::now_ms();
        let held: Schema = super::store::decode(&previous.1)?;
        if schema.hash() != held.hash() {
            return Err(RuntimeError::StoreUnsupported {
                family: "evolution",
            });
        }
        prep.check_backend(&previous)?;
        prep.enable_dormant()?;
        prep.prepare_release_metadata(
            options.native_digest.as_deref().unwrap_or(""),
            options.restore_dormant,
            options.visibility.as_ref(),
        )?;
        let hash = activation::activation_hash(
            &schema,
            &programs,
            tx.meta("release_native_digest")?.as_deref(),
        );
        let changed = tx.meta("activation_hash")?.as_deref() != Some(&hash);
        let generation = activation::next_generation(previous.0 as u64, changed)?;
        tx.publish_backend(
            &Backend(
                counter(generation)?,
                canonical_json(&schema),
                canonical_json(&programs),
            ),
            at,
        )?;
        tx.set_meta("activation_hash", &hash)?;
        finish(&tx, options, at)?;
        tx.commit()?;
        self.store.generation = generation;
        self.schema = schema;
        self.programs = programs;
        self.expiry_after.clear();
        Ok(generation)
    }

    pub fn release_status(
        &mut self,
        after: u64,
        items_after: Option<&str>,
        event: Option<u64>,
    ) -> Result<serde_json::Value, RuntimeError> {
        let tx = self.store.transaction(None)?;
        let status = release_history::status(&tx, after, items_after, event)?;
        tx.rollback()?;
        Ok(status)
    }

    pub fn open_selected(
        client: postgres::Client,
        name: &str,
        expected_release: u64,
    ) -> Result<Self, RuntimeError> {
        Self::open_with_expected(client, name, Some(expected_release))
    }
}
