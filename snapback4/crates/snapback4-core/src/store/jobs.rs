//! SQLite job and schedule access; chunking and firing policy stay in engine/job.
// @ref LLP 3000.009.001.000#3.3 — retain SQLite transactions and job-ordering semantics behind the family contract.
use super::{Store, Tx};
use crate::engine::job::{
    Head, JobChunkUpdate, JobRun, JobState, JobStore, JobSummary, JobTransaction, job_counter,
    job_error_limit, job_limit,
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
    fn insert_job_record(
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

    fn park_job_record(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
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

    fn job_counters(&self, id: &str) -> Result<Option<(i64, i64)>, RuntimeError> {
        Ok(self
            .conn()
            .query_row(
                "SELECT chunks,rows_written FROM _jobs WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    fn write_job_chunk(
        &self,
        chunk: JobChunkUpdate<'_>,
        chunks: i64,
        rows: i64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute(
            "UPDATE _jobs SET state = ?2, sweep = ?3, cursor = ?4, upper = ?5, chunks = ?12, rows_written = ?6, updated_at = ?7, chunk_size = ?8, retries = ?9, heap_peak = ?10, domain = ?11 WHERE id = ?1",
            params![chunk.id, chunk.state.word(), chunk.sweep as i64, chunk.cursor.map(encode_bytes_hex), chunk.upper.map(encode_bytes_hex), rows, chunk.now, chunk.size, job_counter(chunk.retries), job_counter(chunk.heap_peak), chunk.domain.map(canonical_json), chunks],
        )?;
        Ok(())
    }

    fn park_job_chunk_record(
        &self,
        id: &str,
        error: &str,
        now: i64,
        size: u32,
        retries: u64,
        heap_peak: u64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3, chunk_size = ?4, retries = ?5, heap_peak = ?6 WHERE id = ?1", params![id, error, now, size, job_counter(retries), job_counter(heap_peak)])?;
        Ok(())
    }

    #[cfg(feature = "native")]
    fn write_native_job_chunk(
        &self,
        id: &str,
        state: JobState,
        cursor: Option<&[u8]>,
        chunks: i64,
        rows: i64,
        now: i64,
    ) -> Result<(), RuntimeError> {
        self.conn().execute(
            "UPDATE _jobs SET state = ?2, cursor = ?3, chunks = ?6, rows_written = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, state.word(), cursor.map(encode_bytes_hex), rows, now, chunks],
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

    fn schedule_exists(&self, name: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM _meta WHERE key IN (?1,?2))",
            params![format!("schedule-shape:{name}"), format!("schedule:{name}")],
            |row| row.get(0),
        )?)
    }

    fn write_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> {
        self.set_meta(&format!("schedule-shape:{name}"), shape)
    }

    fn write_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> {
        self.set_meta(&format!("schedule:{name}"), &boundary.to_string())
    }
}

impl Store {
    pub fn job(&self, id: &str) -> Result<Option<JobRun>, RuntimeError> {
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

    pub fn jobs(&self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> {
        let mut statement = self.conn().prepare(&format!(
            "SELECT {COLUMNS} FROM _jobs ORDER BY created_at DESC, rowid LIMIT ?1"
        ))?;
        let rows = statement.query_map([job_limit(limit)], read_head)?;
        Ok(rows
            .map(|head| head.map(|head| head.run))
            .collect::<Result<_, _>>()?)
    }

    /// Saved schedule identity, with the same ownership check as metadata reads.
    pub fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> {
        self.meta(&format!("schedule-shape:{name}"))
    }

    /// Unparsable saved boundaries are absent, as at schedule admission.
    pub fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> {
        Ok(self
            .meta(&format!("schedule:{name}"))?
            .and_then(|value| value.parse().ok()))
    }

    /// Greatest parsable saved boundary; malformed rows keep their old skip behavior.
    pub fn latest_schedule_boundary(&self) -> Result<Option<i64>, RuntimeError> {
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
    pub fn job_summaries(&self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> {
        let mut statement = self.conn().prepare(
            "SELECT name, state, rows_written, substr(error, 1, ?1), octet_length(error) > ?1, id FROM _jobs ORDER BY created_at DESC, id DESC LIMIT 64")?;
        let mut rows = statement.query([job_error_limit(error_bytes)])?;
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
    pub fn job_count(&self) -> Result<i64, RuntimeError> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM _jobs", [], |row| row.get(0))?)
    }
}

// The mutable contract can open a driver snapshot; SQLite's public inspection
// remains available through a shared reference.
impl JobStore for Store {
    fn job(&mut self, id: &str) -> Result<Option<JobRun>, RuntimeError> {
        Store::job(self, id)
    }
    fn jobs(&mut self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> {
        Store::jobs(self, limit)
    }
    fn schedule_shape(&mut self, name: &str) -> Result<Option<String>, RuntimeError> {
        Store::schedule_shape(self, name)
    }
    fn schedule_boundary(&mut self, name: &str) -> Result<Option<i64>, RuntimeError> {
        Store::schedule_boundary(self, name)
    }
    fn latest_schedule_boundary(&mut self) -> Result<Option<i64>, RuntimeError> {
        Store::latest_schedule_boundary(self)
    }
    fn job_summaries(&mut self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> {
        Store::job_summaries(self, error_bytes)
    }
    fn job_count(&mut self) -> Result<i64, RuntimeError> {
        Store::job_count(self)
    }
}

#[cfg(test)]
#[path = "job_tests.rs"]
mod tests;
