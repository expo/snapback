//! SQLite job and schedule access; chunking and firing policy stay in engine/job.
// @ref LLP 3000.009.001.000#3.3 — extract access without changing transactions or statements.
use super::{Store, Tx};
use crate::engine::job::{
    Head, JobChunkUpdate, JobRun, JobState, JobStore, JobSummary, JobTransaction,
};
use crate::value::{canonical_json, decode_bytes_hex, encode_bytes_hex};
use crate::{RuntimeError, Value};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeMap;

const COLUMNS: &str = "id, name, args, program_hash, state, sweep, cursor, upper, chunks, rows_written, created_at, updated_at, error, chunk_size, retries, heap_peak, domain";

fn read_head(row: &rusqlite::Row<'_>) -> rusqlite::Result<Head> {
    let state: String = row.get(4)?;
    let args: Value =
        serde_json::from_str::<Value>(&row.get::<_, String>(2)?).unwrap_or(Value::Null);
    Ok(Head {
        run: JobRun {
            id: row.get(0)?,
            name: row.get(1)?,
            state: match state.as_str() {
                "queued" => JobState::Queued,
                "running" => JobState::Running,
                "done" => JobState::Done,
                _ => JobState::Parked,
            },
            sweep: row.get::<_, i64>(5)? as u32,
            chunks: row.get::<_, i64>(8)? as u64,
            rows_written: row.get::<_, i64>(9)? as u64,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
            error: row.get(12)?,
            chunk_size: row.get::<_, i64>(13)? as u32,
            retries: row.get::<_, i64>(14)? as u64,
            heap_peak: row.get::<_, i64>(15)? as u64,
        },
        args: args
            .as_object()
            .map(|fields| fields.clone())
            .unwrap_or_default(),
        program_hash: row.get(3)?,
        cursor: row
            .get::<_, Option<String>>(6)?
            .and_then(|hex| decode_bytes_hex(&hex)),
        upper: row
            .get::<_, Option<String>>(7)?
            .and_then(|hex| decode_bytes_hex(&hex)),
        domain: row
            .get::<_, Option<String>>(16)?
            .map(|json| {
                serde_json::from_str(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        16,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })
            })
            .transpose()?,
    })
}

fn insert_job(
    conn: &Connection,
    id: &str,
    name: &str,
    args: &BTreeMap<String, Value>,
    program_hash: &str,
    now: i64,
) -> Result<(), RuntimeError> {
    conn.execute(
        "INSERT INTO _jobs(id, name, args, program_hash, state, sweep, cursor, upper, chunks, rows_written, created_at, updated_at, error) VALUES (?1, ?2, ?3, ?4, 'queued', 0, NULL, NULL, 0, 0, ?5, ?5, NULL)",
        params![id, name, canonical_json(&Value::Map(args.clone().into())), program_hash, now],
    )?;
    Ok(())
}

impl JobTransaction for Tx<'_> {
    fn insert_job(
        &self,
        id: &str,
        name: &str,
        args: &BTreeMap<String, Value>,
        program_hash: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        insert_job(self.conn(), id, name, args, program_hash, now)
    }

    fn head_job(&self) -> Result<Option<Head>, RuntimeError> {
        Ok(self.conn().query_row(&format!("SELECT {COLUMNS} FROM _jobs WHERE state IN ('queued', 'running') ORDER BY created_at, id LIMIT 1"), [], read_head).optional()?)
    }

    fn park_job(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute(
            "UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, error, now],
        )?;
        Ok(())
    }

    fn finish_job_sweeps(&self, id: &str, sweeps: usize, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _jobs SET state = 'done', sweep = ?2, cursor = NULL, upper = NULL, updated_at = ?3 WHERE id = ?1", params![id, sweeps as i64, now])?;
        Ok(())
    }

    fn record_job_chunk(&self, chunk: JobChunkUpdate<'_>) -> Result<(), RuntimeError> {
        self.conn().execute(
            "UPDATE _jobs SET state = ?2, sweep = ?3, cursor = ?4, upper = ?5, chunks = chunks + 1, rows_written = rows_written + ?6, updated_at = ?7, chunk_size = ?8, retries = ?9, heap_peak = ?10, domain = ?11 WHERE id = ?1",
            params![chunk.id, chunk.state.word(), chunk.sweep as i64, chunk.cursor.map(encode_bytes_hex), chunk.upper.map(encode_bytes_hex), chunk.rows_written as i64, chunk.now, chunk.size, chunk.retries as i64, chunk.heap_peak as i64, chunk.domain.map(canonical_json)],
        )?;
        Ok(())
    }

    fn park_job_chunk(
        &self,
        id: &str,
        error: &str,
        now: i64,
        size: u32,
        retries: u64,
        heap_peak: u64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3, chunk_size = ?4, retries = ?5, heap_peak = ?6 WHERE id = ?1", params![id, error, now, size, retries as i64, heap_peak as i64])?;
        Ok(())
    }

    #[cfg(feature = "native")]
    fn record_native_job_chunk(
        &self,
        id: &str,
        state: JobState,
        cursor: Option<&[u8]>,
        rows_written: u64,
        now: i64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute(
            "UPDATE _jobs SET state = ?2, cursor = ?3, chunks = chunks + 1, rows_written = rows_written + ?4, updated_at = ?5 WHERE id = ?1",
            params![id, state.word(), cursor.map(encode_bytes_hex), rows_written as i64, now],
        )?;
        Ok(())
    }

    fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT value FROM _meta WHERE key = ?1",
                [format!("schedule-shape:{name}")],
                |row| row.get(0),
            )
            .optional()?)
    }

    fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT value FROM _meta WHERE key = ?1",
                [format!("schedule:{name}")],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| value.parse().ok()))
    }

    fn set_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> {
        self.set_meta(&format!("schedule-shape:{name}"), shape)
    }

    fn set_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> {
        self.set_meta(&format!("schedule:{name}"), &boundary.to_string())
    }
}

impl JobStore for Store {
    fn job(&self, id: &str) -> Result<Option<JobRun>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                &format!("SELECT {COLUMNS} FROM _jobs WHERE id = ?1"),
                [id],
                read_head,
            )
            .optional()?
            .map(|head| head.run))
    }

    fn jobs(&self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> {
        let mut statement = self.conn().prepare(&format!(
            "SELECT {COLUMNS} FROM _jobs ORDER BY created_at DESC LIMIT ?1"
        ))?;
        let rows = statement.query_map([limit as i64], read_head)?;
        Ok(rows
            .map(|head| head.map(|head| head.run))
            .collect::<Result<_, _>>()?)
    }

    /// Saved schedule identity, with the same ownership check as metadata reads.
    // P1: implement schedule inspection for the Postgres store.
    fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> {
        self.meta(&format!("schedule-shape:{name}"))
    }

    /// Unparsable saved boundaries are absent, as at schedule admission.
    fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> {
        Ok(self
            .meta(&format!("schedule:{name}"))?
            .and_then(|value| value.parse().ok()))
    }

    /// Greatest parsable saved boundary; malformed rows keep their old skip behavior.
    fn latest_schedule_boundary(&self) -> Result<Option<i64>, RuntimeError> {
        let mut statement = self
            .conn()
            .prepare("SELECT value FROM _meta WHERE key LIKE 'schedule:%'")?;
        Ok(statement
            .query_map([], |row| row.get::<_, String>(0))?
            .flatten()
            .filter_map(|value| value.parse::<i64>().ok())
            .max())
    }

    /// At most 64 summaries; does not load arguments, cursors or full errors.
    fn job_summaries(&self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> {
        let mut statement = self.conn().prepare(
            "SELECT name, state, rows_written, substr(error, 1, ?1), octet_length(error) > ?1, id FROM _jobs ORDER BY created_at DESC, id DESC LIMIT 64")?;
        let mut rows = statement.query([error_bytes as i64])?;
        let mut summaries = Vec::new();
        let mut names = std::collections::BTreeSet::new();
        while let Some(row) = rows.next()? {
            let name: String = row.get(0)?;
            if !names.insert(name.clone()) {
                continue;
            }
            let error = row.get(3)?;
            let error_truncated = row.get::<_, Option<bool>>(4)?.unwrap_or(false);
            let id = row.get(5)?;
            let state = row.get(1)?;
            let rows_written = row.get(2)?;
            summaries.push(JobSummary {
                name,
                state,
                rows_written,
                error,
                error_truncated,
                id,
            });
        }
        Ok(summaries)
    }

    /// Number of retained job runs, including completed and parked runs.
    fn job_count(&self) -> Result<i64, RuntimeError> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM _jobs", [], |row| row.get(0))?)
    }
}

// Public host inspection delegates to the same typed adapter capability.
impl Store {
    pub fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> {
        JobStore::schedule_shape(self, name)
    }
    pub fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> {
        JobStore::schedule_boundary(self, name)
    }
    pub fn latest_schedule_boundary(&self) -> Result<Option<i64>, RuntimeError> {
        JobStore::latest_schedule_boundary(self)
    }
    pub fn job_summaries(&self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> {
        JobStore::job_summaries(self, error_bytes)
    }
    pub fn job_count(&self) -> Result<i64, RuntimeError> {
        JobStore::job_count(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::job::test_cases;

    #[test]
    fn shared_queue_and_continuation_cases() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::queue_and_continue(&tx);
        tx.commit().unwrap();
        test_cases::assert_committed(&store);
    }

    #[test]
    fn admission_and_watermark_rollback_together() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::queue_and_continue(&tx);
        tx.rollback().unwrap();
        assert_eq!(store.job_count().unwrap(), 0);
        assert_eq!(store.schedule_shape("pulse").unwrap(), None);
        assert_eq!(store.schedule_boundary("pulse").unwrap(), None);
    }

    #[test]
    fn refused_chunk_keeps_its_previous_continuation() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::queue_and_continue(&tx);
        tx.commit().unwrap();
        let tx = store.transaction().unwrap();
        tx.savepoint("job_chunk").unwrap();
        test_cases::advance(&tx);
        tx.rollback_to("job_chunk").unwrap();
        test_cases::assert_continuation(&tx);
        tx.park_job_chunk("a", "E_BOUND: fixture", 30, 1, 4, 4096)
            .unwrap();
        tx.commit().unwrap();
        let run = JobStore::job(&store, "a").unwrap().unwrap();
        assert_eq!(run.state, JobState::Parked);
        assert_eq!(
            (
                run.chunks,
                run.rows_written,
                run.chunk_size,
                run.retries,
                run.heap_peak
            ),
            (1, 2, 1, 4, 4096)
        );
        assert_eq!(run.error.as_deref(), Some("E_BOUND: fixture"));
    }
}
