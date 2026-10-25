//! The committer's internal order, persisted under its existing head lock.
// @ref LLP 3000.009.001.000.000#3.3 — members take revisions even when they publish no public sequence.
use super::store::Tx;
use crate::RuntimeError;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    let exists = tx.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='_head'::regclass AND attname='revision' AND NOT attisdropped)", &[])?[0].get::<_, bool>(0);
    if !exists {
        tx.batch(
            "ALTER TABLE _head ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK(revision >= 0)",
        )?;
    }
    // Refuse an incompatible pre-existing column, including a generated value.
    let rows = tx.query("SELECT atttypid='pg_catalog.int8'::regtype,attnotnull,attgenerated::text FROM pg_attribute WHERE attrelid='_head'::regclass AND attname='revision' AND NOT attisdropped", &[])?;
    if rows.len() != 1
        || !rows[0].get::<_, bool>(0)
        || !rows[0].get::<_, bool>(1)
        || !rows[0].get::<_, &str>(2).is_empty()
    {
        return Err(RuntimeError::Store(
            "SNAPBACK_ACTIVATION_SCHEMA: incompatible durable revision".into(),
        ));
    }
    if tx.query("SELECT revision FROM _head WHERE singleton", &[])?[0].get::<_, i64>(0) < 0 {
        return Err(RuntimeError::Store("negative durable revision".into()));
    }
    super::group_commit::initialize(tx)
}

impl Tx<'_> {
    // @ref LLP 3000.009.001.000.002#4.1 — tail RETURNING sees the updated head; a sibling SELECT of _head would see its old statement snapshot.
    pub(super) fn capture_tail_publication(&self, row: &super::flight::Row, offset: usize) -> Result<(), RuntimeError> {
        if self.publication_enabled() {
            *self.publication.borrow_mut() = Some(super::read_grant::Published::row_at(row, offset)?);
        }
        Ok(())
    }
    // @ref LLP 3000.009.001.000.002#4.2 — one statement snapshot carries revision, identity, code and current authority; Rust decides reuse.
    pub(super) fn result_validation(
        &self,
        digest: &str,
    ) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        let sql = format!(
            "SELECT facts.*,pg_catalog.current_setting('client_encoding') FROM ({}) AS facts",
            super::authority::session_facts_sql(self.read_sessions.get())
        );
        let pipeline = {
            let inner = self.inner.borrow();
            inner.client.is_reader() && !inner.started
        };
        let rows = if pipeline {
            super::literal::parameter(&digest, &postgres::types::Type::TEXT)?;
            self.calls.set(self.calls.get() + 1);
            // Parse/Bind/Execute share one Sync even on the first hit. A named
            // statement's cold PREPARE would add a second request flight.
            let rows = self
                .inner
                .borrow()
                .client
                .independent(&sql, &[(&digest, postgres::types::Type::TEXT)])?;
            self.inner.borrow_mut().pending.clear();
            self.finish_read_flight();
            rows
        } else {
            let rows = self
                .flight(&[(&sql, &[&digest])], "ROLLBACK")?
                .remove(0)
                .rows;
            self.finish_read_flight();
            rows
        };
        if rows.first().and_then(|r| r.try_get::<_, &str>(20).ok()) != Some("UTF8") {
            return Err(RuntimeError::Store(
                "Postgres result validation requires UTF8 client encoding".into(),
            ));
        }
        let facts = super::authority::session_facts_rows(rows);
        if self.needs_complete_facts(&facts) {
            return self.complete_request_facts(digest);
        }
        Ok(facts)
    }

    // Only engine-generated counts and numeric attempt pairs are interpolated.
    // Queue the checked update before the separate physical COMMIT.
    // Rollback restores both this SQL update and the member checkpoint count.
    pub(super) fn defer_revision(&self, count: usize) -> Result<(), RuntimeError> {
        if count == 0 {
            return Ok(());
        }
        if self.batch_ticket.is_some() {
            return Err(RuntimeError::Store("ticket batch revision must advance in the exact head CAS".into()));
        }
        self.publication.borrow_mut().take();
        self.require_serialized_head_fence("advance durable revision")?;
        let count = u64::try_from(count)
            .map_err(|_| RuntimeError::Store("revision count overflow".into()))?;
        let next = self
            .revisions
            .get()
            .checked_add(count)
            .filter(|n| *n <= i64::MAX as u64)
            .ok_or_else(|| RuntimeError::Store("revision count overflow".into()))?;
        self.ensure_active()?;
        let mut inner = self.inner.borrow_mut();
        let command = inner.pending.bytes().filter(|b| *b == b';').count();
        inner.checks.push((command, 1));
        inner.pending.push_str(&format!(
            "UPDATE _head SET revision=revision+{count},attempt='{}' WHERE singleton;", self.attempt.borrow()
        ));
        self.revisions.set(next);
        Ok(())
    }
}
