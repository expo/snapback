//! Job continuations and schedule watermarks in the caller's transaction.
//! Admission, chunking, retries and schedule coalescing stay in engine/job.
// @ref LLP 3000.009.001.000#3.3 — one family contract, with adapter-owned storage.
use super::store::{Store, Tx, decode};
use crate::{
    RuntimeError, Value,
    engine::job::{
        Head, JobChunkUpdate, JobRun, JobState, JobStore, JobSummary, JobTransaction, job_counter,
        job_error_limit, job_limit,
    },
    value::canonical_json,
};
use std::collections::{BTreeMap, BTreeSet};

/// Attach calls this after locking the head and validating the held backend.
/// Catalog guards avoid even a no-op DDL table lock on ordinary reopen.
pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    super::jobs_schema::verify_existing(tx)?;
    for (table, ddl) in [
        (
            "_jobs",
            "CREATE TABLE _jobs (
            id TEXT COLLATE \"C\" PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL,
            program_hash TEXT NOT NULL, state TEXT NOT NULL, sweep BIGINT NOT NULL,
            cursor BYTEA, upper BYTEA, chunks BIGINT NOT NULL, rows_written BIGINT NOT NULL,
            created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, error BYTEA,
            chunk_size BIGINT NOT NULL DEFAULT 0, retries BIGINT NOT NULL DEFAULT 0,
            heap_peak BIGINT NOT NULL DEFAULT 0, domain TEXT,
            insertion_order BIGINT GENERATED ALWAYS AS IDENTITY
        )",
        ),
        (
            "_meta",
            "CREATE TABLE _meta (key TEXT COLLATE \"C\" PRIMARY KEY, value TEXT NOT NULL)",
        ),
    ] {
        let exists: bool = tx.query("SELECT to_regclass($1) IS NOT NULL", &[&table])?[0].get(0);
        if !exists {
            tx.batch(ddl)?;
        }
    }
    Ok(())
}

fn read_head(row: &postgres::Row) -> Result<Head, RuntimeError> {
    // SQLite retains the legacy fallback for malformed args/state. Domain
    // corruption, unlike args, is an error on both adapters.
    let args = serde_json::from_str::<Value>(row.try_get("args")?).unwrap_or(Value::Null);
    Ok(Head {
        run: JobRun {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            state: match row.try_get::<_, &str>("state")? {
                "queued" => JobState::Queued,
                "running" => JobState::Running,
                "done" => JobState::Done,
                _ => JobState::Parked,
            },
            sweep: row.try_get::<_, i64>("sweep")? as u32,
            chunks: row.try_get::<_, i64>("chunks")? as u64,
            rows_written: row.try_get::<_, i64>("rows_written")? as u64,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            error: row
                .try_get::<_, Option<Vec<u8>>>("error")?
                .map(String::from_utf8)
                .transpose()
                .map_err(|error| RuntimeError::Store(error.to_string()))?,
            chunk_size: row.try_get::<_, i64>("chunk_size")? as u32,
            retries: row.try_get::<_, i64>("retries")? as u64,
            heap_peak: row.try_get::<_, i64>("heap_peak")? as u64,
        },
        args: args.as_object().cloned().unwrap_or_default(),
        program_hash: row.try_get("program_hash")?,
        cursor: row.try_get("cursor")?,
        upper: row.try_get("upper")?,
        domain: row
            .try_get::<_, Option<&str>>("domain")?
            .map(decode)
            .transpose()?,
    })
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
        self.require_serialized_head_fence("insert job")?;
        self.execute_one("INSERT INTO _jobs(id,name,args,program_hash,state,sweep,chunks,rows_written,created_at,updated_at) VALUES ($1,$2,$3,$4,'queued',0,0,0,$5,$5)",
            &[&id, &name, &canonical_json(&Value::Map(args.clone().into())), &program_hash, &now])?;
        Ok(())
    }

    fn head_job(&self) -> Result<Option<Head>, RuntimeError> {
        self.query("SELECT id,name,args,program_hash,state,sweep,cursor,upper,chunks,rows_written,created_at,updated_at,error,chunk_size,retries,heap_peak,domain FROM _jobs WHERE state IN ('queued','running') ORDER BY created_at,id LIMIT 1", &[])?.first().map(read_head).transpose()
    }

    fn park_job_record(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("park job")?;
        if id.contains('\0') {
            return Ok(());
        }
        self.execute(
            "UPDATE _jobs SET state='parked',error=$2,updated_at=$3 WHERE id=$1",
            &[&id, &error.as_bytes(), &now],
        )?;
        Ok(())
    }

    fn finish_job_sweeps(&self, id: &str, sweeps: usize, now: i64) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("finish job sweeps")?;
        if id.contains('\0') {
            return Ok(());
        }
        self.execute("UPDATE _jobs SET state='done',sweep=$2,cursor=NULL,upper=NULL,updated_at=$3 WHERE id=$1", &[&id, &(sweeps as i64), &now])?;
        Ok(())
    }

    fn job_counters(&self, id: &str) -> Result<Option<(i64, i64)>, RuntimeError> {
        self.require_serialized_head_fence("read job counters for update")?;
        if id.contains('\0') {
            return Ok(None);
        }
        Ok(self
            .query("SELECT chunks,rows_written FROM _jobs WHERE id=$1", &[&id])?
            .first()
            .map(|row| (row.get(0), row.get(1))))
    }

    fn write_job_chunk(
        &self,
        chunk: JobChunkUpdate<'_>,
        chunks: i64,
        rows: i64,
    ) -> Result<(), RuntimeError> {
        self.require_serialized_head_fence("record job chunk")?;
        self.execute("UPDATE _jobs SET state=$2,sweep=$3,cursor=$4,upper=$5,chunks=$12,rows_written=$6,updated_at=$7,chunk_size=$8,retries=$9,heap_peak=$10,domain=$11 WHERE id=$1",
            &[&chunk.id, &chunk.state.word(), &(chunk.sweep as i64), &chunk.cursor, &chunk.upper,
                &rows, &chunk.now, &i64::from(chunk.size), &job_counter(chunk.retries), &job_counter(chunk.heap_peak), &chunk.domain.map(canonical_json), &chunks])?;
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
        self.require_serialized_head_fence("park job chunk")?;
        if id.contains('\0') {
            return Ok(());
        }
        self.execute("UPDATE _jobs SET state='parked',error=$2,updated_at=$3,chunk_size=$4,retries=$5,heap_peak=$6 WHERE id=$1",
            &[&id, &error.as_bytes(), &now, &i64::from(size), &job_counter(retries), &job_counter(heap_peak)])?;
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
        self.require_serialized_head_fence("record native job chunk")?;
        self.execute("UPDATE _jobs SET state=$2,cursor=$3,chunks=$6,rows_written=$4,updated_at=$5 WHERE id=$1",
            &[&id, &state.word(), &cursor, &rows, &now, &chunks])?;
        Ok(())
    }

    fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError> {
        meta(self, &format!("schedule-shape:{name}"))
    }
    fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError> {
        Ok(meta(self, &format!("schedule:{name}"))?.and_then(|value| value.parse().ok()))
    }
    fn schedule_exists(&self, name: &str) -> Result<bool, RuntimeError> {
        if name.contains('\0') {
            return Ok(false);
        }
        Ok(self.query(
            "SELECT EXISTS(SELECT 1 FROM _meta WHERE key IN ($1,$2))",
            &[
                &format!("schedule-shape:{name}"),
                &format!("schedule:{name}"),
            ],
        )?[0]
            .get(0))
    }

    fn write_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> {
        set_meta(self, &format!("schedule-shape:{name}"), shape)
    }
    fn write_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> {
        set_meta(self, &format!("schedule:{name}"), &boundary.to_string())
    }
}

fn meta(tx: &Tx<'_>, key: &str) -> Result<Option<String>, RuntimeError> {
    if key.contains('\0') {
        return Ok(None);
    }
    Ok(tx
        .query("SELECT value FROM _meta WHERE key=$1", &[&key])?
        .first()
        .map(|row| row.get(0)))
}
fn set_meta(tx: &Tx<'_>, key: &str, value: &str) -> Result<(), RuntimeError> {
    tx.require_serialized_head_fence("set schedule metadata")?;
    tx.execute_one("INSERT INTO _meta(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", &[&key, &value])?;
    Ok(())
}

#[allow(dead_code)] // Used by JobStore; Postgres host inspection is P1b.
fn inspect<T>(
    store: &mut Store,
    read: impl FnOnce(&Tx<'_>) -> Result<T, RuntimeError>,
) -> Result<T, RuntimeError> {
    let tx = store.transaction(None)?;
    let result = read(&tx)?;
    tx.rollback()?;
    Ok(result)
}

/// The driver fetched at most four UTF-8 bytes per requested character. Clip
/// a partial final character. New diagnostics normalize NUL in shared policy;
/// a legacy stored NUL retains SQLite substr's prefix boundary.
fn summary_error(bytes: Option<&[u8]>, characters: i64) -> Result<Option<String>, RuntimeError> {
    bytes
        .map(|bytes| {
            let text = match std::str::from_utf8(bytes) {
                Ok(text) => text,
                Err(error) if error.error_len().is_none() => {
                    std::str::from_utf8(&bytes[..error.valid_up_to()])
                        .map_err(|error| RuntimeError::Store(error.to_string()))?
                }
                Err(error) => return Err(RuntimeError::Store(error.to_string())),
            };
            Ok(text
                .split('\0')
                .next()
                .unwrap_or_default()
                .chars()
                .take(characters.max(0) as usize)
                .collect())
        })
        .transpose()
}

impl JobStore for Store {
    fn job(&mut self, id: &str) -> Result<Option<JobRun>, RuntimeError> {
        if id.contains('\0') {
            return Ok(None);
        }
        inspect(self, |tx| {
            tx.query("SELECT id,name,args,program_hash,state,sweep,cursor,upper,chunks,rows_written,created_at,updated_at,error,chunk_size,retries,heap_peak,domain FROM _jobs WHERE id=$1", &[&id])?
                .first()
                .map(read_head)
                .transpose()
                .map(|head| head.map(|head| head.run))
        })
    }
    fn jobs(&mut self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> {
        // @ref LLP 3000.009.001.000#3.3 — preserve SQLite's rowid/insertion tie order, distinct from head_job's id tie.
        // Shared policy clamps oversized limits to the signed storage maximum.
        let limit = job_limit(limit);
        inspect(self, |tx| {
            tx.query(
                "SELECT id,name,args,program_hash,state,sweep,cursor,upper,chunks,rows_written,created_at,updated_at,error,chunk_size,retries,heap_peak,domain FROM _jobs ORDER BY created_at DESC,insertion_order LIMIT $1",
                &[&limit],
            )?
            .iter()
            .map(|row| read_head(row).map(|head| head.run))
            .collect()
        })
    }
    fn schedule_shape(&mut self, name: &str) -> Result<Option<String>, RuntimeError> {
        if name.contains('\0') {
            return Ok(None);
        }
        inspect(self, |tx| JobTransaction::schedule_shape(tx, name))
    }
    fn schedule_boundary(&mut self, name: &str) -> Result<Option<i64>, RuntimeError> {
        if name.contains('\0') {
            return Ok(None);
        }
        inspect(self, |tx| JobTransaction::schedule_boundary(tx, name))
    }
    fn latest_schedule_boundary(&mut self) -> Result<Option<i64>, RuntimeError> {
        inspect(self, |tx| {
            Ok(tx
                .query("SELECT value FROM _meta WHERE key ILIKE 'schedule:%'", &[])?
                .iter()
                .filter_map(|row| row.get::<_, &str>(0).parse::<i64>().ok())
                .max())
        })
    }
    fn job_summaries(&mut self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError> {
        inspect(self, |tx| {
            // @ref LLP 3000.009.001.000#3.3 — diagnostics normalize NUL before storage; prefixes count characters, flags count bytes.
            // Bound the driver prefix by 4*N and by Postgres' 1 GiB datum
            // limit without overflowing a BIGINT or substring's integer count.
            let rows = tx.query("SELECT id,name,state,rows_written,substring(error FROM 1 FOR (LEAST(GREATEST($1::bigint,0),268435456)*4)::integer),octet_length(error)>$1 FROM _jobs ORDER BY created_at DESC,id DESC LIMIT 64", &[&job_error_limit(error_bytes)])?;
            let mut names = BTreeSet::new();
            rows.iter()
                .filter(|row| names.insert(row.get::<_, String>(1)))
                .map(|row| {
                    Ok(JobSummary {
                        id: row.get(0),
                        name: row.get(1),
                        state: row.get(2),
                        rows_written: row.get(3),
                        error: summary_error(row.get(4), job_error_limit(error_bytes))?,
                        error_truncated: row.get::<_, Option<bool>>(5).unwrap_or(false),
                    })
                })
                .collect()
        })
    }
    fn job_count(&mut self) -> Result<i64, RuntimeError> {
        inspect(self, |tx| {
            Ok(tx.query("SELECT COUNT(*) FROM _jobs", &[])?[0].get(0))
        })
    }
}
