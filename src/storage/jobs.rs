use super::{
    ChangeOp, ChangedRow, LocalDatabase, META_CRON_STATE, SnapbackError, SnapbackResult,
    WithDetail, job_status_changed_row, new_id_source,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::Value;

impl LocalDatabase {
    pub(super) fn load_cron_state(&self) -> SnapbackResult<Option<Value>> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_CRON_STATE],
                |row| row.get(0),
            )
            .optional()?;

        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_CRON_STATE_PARSE_FAILED",
                        "cron",
                        "stored cron runtime state could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            })
            .transpose()
    }

    pub(super) fn save_cron_state(&mut self, value: &Value) -> SnapbackResult<()> {
        let state_json = serde_json::to_string(value).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
                "cron",
                "cron runtime state could not be serialized",
            )
            .with_detail("error", error.to_string())
        })?;
        self.conn.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_CRON_STATE, state_json],
        )?;
        Ok(())
    }

    /// Set-based injected-clock claim over the durable job table (LLP 0070's
    /// first slice; the deterministic drain seam of LLP 0115 CV-9). One
    /// SQLite transaction claims every due job up to `limit`; the returned
    /// ChangedRows feed the live matcher for the declared job-status query.
    pub(super) fn claim_due_jobs(
        &mut self,
        now_ms: u64,
        limit: usize,
        drive: &str,
    ) -> SnapbackResult<(Vec<crate::jobs::ClaimedJob>, Vec<ChangedRow>)> {
        crate::manifest::validate_portable_timestamp_millis(now_ms)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let reaped_job_ids = crate::jobs::reap_terminal_jobs_in_tx(
            &tx,
            now_ms,
            crate::jobs::JOBS_RETENTION_SWEEP_LIMIT,
        )?;
        let mut claim_ids = new_id_source();
        let claims = crate::jobs::claim_due_jobs_in_tx(&tx, now_ms, limit, drive, &mut claim_ids)?;
        let mut job_changes = Vec::with_capacity(reaped_job_ids.len() + claims.len());
        job_changes.extend(reaped_job_ids.into_iter().map(|job_id| ChangedRow {
            table: crate::jobs::JOBS_STATUS_TABLE.to_owned(),
            id: job_id,
            op: ChangeOp::Delete,
            row: None,
            changed_fields: Vec::new(),
        }));
        for claim in &claims {
            if let Some(row) = crate::jobs::job_status_row(&tx, &claim.job_id)? {
                job_changes.push(job_status_changed_row(&row));
            }
        }
        tx.commit()?;
        Ok((claims, job_changes))
    }

    /// Atomic terminal publication for one claimed job attempt. Returns the
    /// disposition plus the job's post-transition ChangedRow (None only when
    /// the publication was stale AND the row vanished, which v1 never does).
    pub(super) fn finish_job(
        &mut self,
        claim: &crate::jobs::ClaimedJob,
        outcome: &crate::jobs::JobAttemptOutcome,
        now_ms: u64,
    ) -> SnapbackResult<(crate::jobs::JobFinishDisposition, Option<ChangedRow>)> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let disposition = crate::jobs::finish_job_in_tx(&tx, claim, outcome, now_ms)?;
        let row = crate::jobs::job_status_row(&tx, &claim.job_id)?;
        tx.commit()?;
        Ok((disposition, row.as_ref().map(job_status_changed_row)))
    }

    pub(super) fn job_status(
        &self,
        job_id: &str,
    ) -> SnapbackResult<Option<crate::jobs::JobStatusRow>> {
        crate::jobs::job_status_row(&self.conn, job_id)
    }

    pub(super) fn job_attempt_records(
        &self,
        job_id: &str,
    ) -> SnapbackResult<Vec<crate::jobs::JobAttemptRecord>> {
        crate::jobs::job_attempts(&self.conn, job_id)
    }

    pub(super) fn list_job_status_rows(
        &self,
        limit: usize,
    ) -> SnapbackResult<Vec<crate::jobs::JobStatusRow>> {
        crate::jobs::list_job_status_rows(&self.conn, limit)
    }

    pub(super) fn pending_job_count(&self) -> SnapbackResult<u64> {
        crate::jobs::pending_job_count(&self.conn)
    }
}

/// Narrow typed access to the jobs/cron storage operations.
///
/// @ref LLP 0225#1-ownership-map — storage callers enter the kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct JobsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> JobsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn load_cron_state(&self) -> SnapbackResult<Option<Value>> {
        self.db.load_cron_state()
    }

    pub fn save_cron_state(&mut self, value: &Value) -> SnapbackResult<()> {
        self.db.save_cron_state(value)
    }

    pub fn claim_due_jobs(
        &mut self,
        now_ms: u64,
        limit: usize,
        drive: &str,
    ) -> SnapbackResult<(Vec<crate::jobs::ClaimedJob>, Vec<ChangedRow>)> {
        self.db.claim_due_jobs(now_ms, limit, drive)
    }

    pub fn finish_job(
        &mut self,
        claim: &crate::jobs::ClaimedJob,
        outcome: &crate::jobs::JobAttemptOutcome,
        now_ms: u64,
    ) -> SnapbackResult<(crate::jobs::JobFinishDisposition, Option<ChangedRow>)> {
        self.db.finish_job(claim, outcome, now_ms)
    }

    pub fn job_status(&self, job_id: &str) -> SnapbackResult<Option<crate::jobs::JobStatusRow>> {
        self.db.job_status(job_id)
    }

    pub fn job_attempt_records(
        &self,
        job_id: &str,
    ) -> SnapbackResult<Vec<crate::jobs::JobAttemptRecord>> {
        self.db.job_attempt_records(job_id)
    }

    pub fn list_job_status_rows(
        &self,
        limit: usize,
    ) -> SnapbackResult<Vec<crate::jobs::JobStatusRow>> {
        self.db.list_job_status_rows(limit)
    }

    pub fn pending_job_count(&self) -> SnapbackResult<u64> {
        self.db.pending_job_count()
    }
}

/// Read-only jobs/cron operations for callers that hold `&LocalDatabase`.
pub struct JobsReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> JobsReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn load_cron_state(&self) -> SnapbackResult<Option<Value>> {
        self.db.load_cron_state()
    }

    pub fn job_status(&self, job_id: &str) -> SnapbackResult<Option<crate::jobs::JobStatusRow>> {
        self.db.job_status(job_id)
    }

    pub fn job_attempt_records(
        &self,
        job_id: &str,
    ) -> SnapbackResult<Vec<crate::jobs::JobAttemptRecord>> {
        self.db.job_attempt_records(job_id)
    }

    pub fn list_job_status_rows(
        &self,
        limit: usize,
    ) -> SnapbackResult<Vec<crate::jobs::JobStatusRow>> {
        self.db.list_job_status_rows(limit)
    }

    pub fn pending_job_count(&self) -> SnapbackResult<u64> {
        self.db.pending_job_count()
    }
}
