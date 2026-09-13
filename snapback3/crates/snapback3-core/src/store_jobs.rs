use crate::jobs::{JobRecord, JobRecoveryRecord, JobRefusal};
use crate::{RuntimeError, Store};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};

const RECOVERY_INITIAL_SQL: &str = "SELECT id,name,state,created_at,updated_at,finished_at
     FROM _jobs WHERE enqueued_by=?1
     ORDER BY created_at DESC,id DESC LIMIT ?2";
const RECOVERY_AFTER_SQL: &str = "SELECT id,name,state,created_at,updated_at,finished_at
     FROM _jobs WHERE enqueued_by=?1 AND (created_at,id)<(?2,?3)
     ORDER BY created_at DESC,id DESC LIMIT ?4";

pub(crate) fn create(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _jobs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT, program_hash TEXT NOT NULL,
        generation TEXT NOT NULL, args TEXT NOT NULL, state TEXT NOT NULL,
        sweep INTEGER NOT NULL, upper_key TEXT, cursor TEXT, chunks INTEGER NOT NULL,
        rows_written TEXT NOT NULL, enqueued_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, finished_at INTEGER, last_error TEXT);
        CREATE INDEX IF NOT EXISTS _jobs_state_created ON _jobs(state, created_at);
        CREATE INDEX IF NOT EXISTS _jobs_operator_recovery
          ON _jobs(enqueued_by, created_at DESC, id DESC);",
    )?;
    Ok(())
}
pub(crate) fn encode<T: Serialize + ?Sized>(value: &T) -> Result<String, RuntimeError> {
    serde_json::to_string(value).map_err(|e| RuntimeError::Serialization(e.to_string()))
}
pub(crate) fn decode<T: DeserializeOwned>(value: &str) -> Result<T, RuntimeError> {
    serde_json::from_str(value).map_err(|e| RuntimeError::Serialization(e.to_string()))
}
pub(crate) fn save(conn: &Connection, row: &JobRecord) -> Result<(), RuntimeError> {
    conn.execute(
        "INSERT INTO _jobs VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
        ON CONFLICT(id) DO UPDATE SET state=excluded.state, generation=excluded.generation,
        sweep=excluded.sweep, upper_key=excluded.upper_key, cursor=excluded.cursor,
        chunks=excluded.chunks, rows_written=excluded.rows_written, updated_at=excluded.updated_at,
        finished_at=excluded.finished_at, last_error=excluded.last_error",
        params![
            row.id,
            row.name,
            row.source,
            row.program_hash,
            row.generation,
            encode(&row.args)?,
            row.state,
            row.sweep as i64,
            row.upper_key.as_ref().map(encode).transpose()?,
            row.cursor.as_ref().map(encode).transpose()?,
            row.chunks as i64,
            encode(&row.rows_written)?,
            row.enqueued_by,
            row.created_at,
            row.updated_at,
            row.finished_at,
            row.last_error.as_ref().map(encode).transpose()?
        ],
    )?;
    Ok(())
}
pub(crate) fn get(conn: &Connection, id: &str) -> Result<Option<JobRecord>, RuntimeError> {
    let value: Option<String> = conn.query_row("SELECT json_object(
        'id',id,'name',name,'source',source,'programHash',program_hash,'generation',generation,
        'args',json(args),'state',state,'sweep',sweep,'upperKey',json(upper_key),'cursor',json(cursor),
        'chunks',chunks,'rowsWritten',json(rows_written),'enqueuedBy',enqueued_by,
        'createdAt',created_at,'updatedAt',updated_at,'finishedAt',finished_at,'lastError',json(last_error))
        FROM _jobs WHERE id=?1", [id], |r| r.get(0)).optional()?;
    value.as_deref().map(decode).transpose()
}
impl Store {
    pub fn job_get(&self, id: &str) -> Result<Option<JobRecord>, RuntimeError> {
        get(&self.conn, id)
    }
    pub fn job_head(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn.query_row("SELECT id FROM _jobs WHERE state IN ('queued','running') ORDER BY created_at,rowid LIMIT 1", [], |r| r.get(0)).optional()?)
    }
    pub fn jobs(&self, limit: usize) -> Result<Vec<JobRecord>, RuntimeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM _jobs ORDER BY created_at DESC,rowid DESC LIMIT ?1")?;
        let ids = stmt
            .query_map([limit.min(500) as i64], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| {
                self.job_get(id)?
                    .ok_or_else(|| RuntimeError::Input("job disappeared".into()))
            })
            .collect()
    }
    /// A bounded reverse-chronological recovery page for one authenticated
    /// operator identity. `after` is an opaque job-id cursor whose ownership is
    /// checked before it can influence the stable `(created_at,id)` keyset.
    // @ref LLP 2000#integration-choices — durable job discovery is operator-scoped, bounded, redacted, and observe-only.
    pub fn jobs_for_operator(
        &self,
        by: &str,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<JobRecoveryRecord>, RuntimeError> {
        let cursor = after
            .map(|id| {
                self.conn
                    .query_row(
                        "SELECT created_at,id FROM _jobs WHERE id=?1 AND enqueued_by=?2",
                        params![id, by],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()
                    .map_err(RuntimeError::from)?
                    .ok_or_else(|| RuntimeError::Input("unknown job recovery cursor".into()))
            })
            .transpose()?;
        let bound = limit.min(65) as i64;
        let read = |row: &rusqlite::Row<'_>| {
            Ok(JobRecoveryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                state: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                finished_at: row.get(5)?,
            })
        };
        if let Some((created_at, id)) = cursor {
            let mut statement = self.conn.prepare(RECOVERY_AFTER_SQL)?;
            Ok(statement
                .query_map(params![by, created_at, id, bound], read)?
                .collect::<Result<Vec<_>, _>>()?)
        } else {
            let mut statement = self.conn.prepare(RECOVERY_INITIAL_SQL)?;
            Ok(statement
                .query_map(params![by, bound], read)?
                .collect::<Result<Vec<_>, _>>()?)
        }
    }
    pub fn job_counts(&self) -> Result<serde_json::Value, RuntimeError> {
        let mut counts = serde_json::json!({"running":0,"queued":0,"parked":0});
        let mut stmt = self
            .conn
            .prepare("SELECT state,COUNT(*) FROM _jobs GROUP BY state")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (state, count) = row?;
            if counts.get(&state).is_some() {
                counts[&state] = count.into();
            }
        }
        Ok(counts)
    }
}
pub(crate) fn reconcile(
    conn: &Connection,
    next: &crate::Generation,
    succession: bool,
) -> Result<(), RuntimeError> {
    let mut stmt = conn.prepare("SELECT id FROM _jobs WHERE state IN ('queued','running')")?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in ids {
        let mut row = get(conn, &id)?.unwrap();
        let compatible = if row.source.is_some() {
            !succession
        } else {
            next.programs().get(&row.name).is_some_and(|(p, c)| {
                p.kind == crate::ProgramKind::Job
                    && bound_hash(p, c, next.schema()) == row.program_hash
            })
        };
        if compatible {
            row.generation = next.hash();
        } else {
            row.state = "parked".into();
            row.last_error = Some(JobRefusal::generation(&row.name));
        }
        save(conn, &row)?;
    }
    Ok(())
}
// The plan hash also binds the declared index descriptor: index reordering is a different sweep.
pub(crate) fn bound_hash(
    program: &crate::Program,
    certificate: &crate::Certificate,
    schema: &crate::Schema,
) -> String {
    let indexes: Vec<_> = certificate
        .job
        .as_ref()
        .map(|j| {
            j.sweeps
                .iter()
                .map(|s| {
                    (
                        &s.table,
                        &s.index,
                        &schema.tables[&s.table].indexes[&s.index],
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    crate::digest(&(program, indexes))
}

impl Store {
    pub fn job_commits(
        &self,
        id: &str,
        after: u64,
        limit: usize,
    ) -> Result<Vec<crate::CommitRecord>, RuntimeError> {
        // Read the ledger in bounded pages, selecting the job before applying the cap.
        let mut stmt = self
            .conn
            .prepare("SELECT seq FROM _commits WHERE job=?1 AND job_chunk IS NOT NULL AND seq>?2 ORDER BY seq LIMIT ?3")?;
        let seqs = stmt
            .query_map(params![id, after as i64, limit.min(500) as i64], |r| {
                r.get::<_, i64>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        seqs.into_iter()
            .map(|seq| {
                self.commits_since((seq as u64).saturating_sub(1), 1)?
                    .pop()
                    .ok_or_else(|| RuntimeError::Input("job commit disappeared".into()))
            })
            .collect()
    }
    pub fn index_entry_count(
        &self,
        table: &str,
        index: &str,
        prefix: &[crate::Value],
    ) -> Result<u64, RuntimeError> {
        let mut parameters = vec![table.to_owned(), index.to_owned()];
        let mut predicates = vec!["table_name=?1".into(), "index_name=?2".into()];
        for (i, value) in prefix.iter().enumerate() {
            parameters.push(crate::engine::encode_job_key(value)?);
            predicates.push(format!("c{i}=?{}", parameters.len()));
        }
        Ok(self.conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM index_entries WHERE {}",
                predicates.join(" AND ")
            ),
            rusqlite::params_from_iter(parameters.iter()),
            |r| r.get::<_, i64>(0),
        )? as u64)
    }
}

// @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — queue edits have an operator receipt as well as durable job attribution.
pub(crate) fn audit_control(
    tx: &rusqlite::Transaction<'_>,
    row: &JobRecord,
    verb: &str,
    by: &str,
) -> Result<(), RuntimeError> {
    let seq = tx.query_row("SELECT COALESCE(MAX(seq),0)+1 FROM _commits", [], |r| {
        r.get::<_, i64>(0)
    })? as u64;
    crate::engine::append_commit(
        tx,
        &crate::CommitRecord {
            seq,
            at: row.updated_at,
            program: format!("{verb}:{}", row.name),
            principal: crate::SYSTEM_PRINCIPAL_ID.to_owned(),
            kind: "operator".into(),
            by: Some(by.into()),
            job: Some(row.id.clone()),
            job_chunk: None,
            schedule: None,
            touched: Vec::new(),
            scope_touches: Vec::new(),
            writes: std::collections::BTreeMap::from([("_jobs".into(), 1)]),
            emits: 0,
        },
    )
}

impl Store {
    pub fn job_commit_summary(&self, id: &str) -> Result<serde_json::Value, RuntimeError> {
        let (first, last, count) = self.conn.query_row(
            "SELECT MIN(seq),MAX(seq),COUNT(job_chunk) FROM _commits WHERE job=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, Option<u64>>(0)?,
                    r.get::<_, Option<u64>>(1)?,
                    r.get::<_, u64>(2)?,
                ))
            },
        )?;
        let mut stmt=self.conn.prepare("SELECT json_extract(job_chunk,'$.sweep'),COUNT(*) FROM _commits WHERE job=?1 AND job_chunk IS NOT NULL GROUP BY json_extract(job_chunk,'$.sweep')")?;
        let groups = stmt
            .query_map([id], |r| {
                Ok((r.get::<_, u64>(0)?.to_string(), r.get::<_, u64>(1)?))
            })?
            .collect::<Result<std::collections::BTreeMap<_, _>, _>>()?;
        Ok(
            serde_json::json!({"commitRange":{"from":first,"to":last},"sweepChunks":groups,"retainedChunks":count}),
        )
    }
}

// The caller owns the transaction: an operator enqueue audits here, a timer enqueue settles on its schedule commit.
pub(crate) fn enqueue(
    conn: &Connection,
    schema: &crate::Schema,
    program: &crate::Program,
    certificate: &crate::Certificate,
    mut args: std::collections::BTreeMap<String, crate::Value>,
    id: String,
    by: String,
    now: i64,
    source: Option<String>,
) -> Result<JobRecord, RuntimeError> {
    if !certificate.has_current_semantics() {
        return Err(RuntimeError::TraceSubset(
            "unsupported job certificate semantics".into(),
        ));
    }
    crate::engine::complete_optional_args(&program.args, &mut args);
    crate::engine::validate_inputs(schema, program, &args)?;
    let row = JobRecord {
        id,
        name: program.name.clone(),
        source,
        program_hash: bound_hash(program, certificate, schema),
        generation: schema.hash(),
        args,
        state: "queued".into(),
        sweep: 0,
        upper_key: None,
        cursor: None,
        chunks: 0,
        rows_written: std::collections::BTreeMap::new(),
        enqueued_by: by,
        created_at: now,
        updated_at: now,
        finished_at: None,
        last_error: None,
    };
    conn.execute(
        "INSERT OR REPLACE INTO _meta(key,value) VALUES (?1,?2)",
        params![
            format!("job_plan:{}", row.program_hash),
            encode(&(program, certificate))?
        ],
    )?;
    save(conn, &row)?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_recovery_is_indexed_redacted_and_stable_across_equal_timestamps() {
        let mut store = Store::memory().unwrap();
        store
            .conn
            .execute("DROP INDEX _jobs_operator_recovery", [])
            .unwrap();
        create(&store.conn).unwrap();
        create(&store.conn).unwrap();
        let index_count: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='_jobs_operator_recovery'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            index_count, 1,
            "existing stores gain the recovery index idempotently"
        );

        let transaction = store.conn.transaction().unwrap();
        let mut expected = Vec::new();
        let mut foreign_cursor = String::new();
        for ordinal in 0..4_096 {
            let owned = ordinal % 7 == 0;
            let by = if owned {
                "operator-owned"
            } else {
                "operator-foreign"
            };
            let id = format!("job_{ordinal:05}");
            let created_at = 1_700_000_000_000_i64 + i64::from(ordinal % 5);
            if owned {
                expected.push((created_at, id.clone()));
            } else if foreign_cursor.is_empty() {
                foreign_cursor = id.clone();
            }
            transaction
                .execute(
                    "INSERT INTO _jobs (
                       id,name,source,program_hash,generation,args,state,sweep,upper_key,cursor,
                       chunks,rows_written,enqueued_by,created_at,updated_at,finished_at,last_error
                     ) VALUES (?1,?2,NULL,'program','generation',?3,'queued',0,NULL,NULL,0,'{}',?4,?5,?6,NULL,NULL)",
                    params![
                        id,
                        if owned { "owned.job" } else { "foreign.job" },
                        if owned { "opaque-not-json" } else { "{}" },
                        by,
                        created_at,
                        created_at + 1,
                    ],
                )
                .unwrap();
        }
        transaction.commit().unwrap();
        expected.sort_by(|left, right| right.cmp(left));

        let initial_plan = query_plan(&store.conn, RECOVERY_INITIAL_SQL, false);
        let cursor_plan = query_plan(&store.conn, RECOVERY_AFTER_SQL, true);
        eprintln!("job recovery initial plan: {initial_plan:?}");
        eprintln!("job recovery cursor plan: {cursor_plan:?}");
        for plan in [&initial_plan, &cursor_plan] {
            assert!(
                plan.iter()
                    .any(|detail| detail.contains("_jobs_operator_recovery")),
                "{plan:?}"
            );
            assert!(
                !plan.iter().any(|detail| detail.contains("SCAN _jobs")),
                "{plan:?}"
            );
            assert!(
                !plan.iter().any(|detail| detail.contains("TEMP B-TREE")),
                "{plan:?}"
            );
        }

        let mut after: Option<String> = None;
        let mut observed = Vec::new();
        loop {
            let mut page = store
                .jobs_for_operator("operator-owned", after.as_deref(), 14)
                .unwrap();
            let more = page.len() > 13;
            page.truncate(13);
            assert!(page.iter().all(|row| row.name == "owned.job"));
            observed.extend(page.iter().map(|row| (row.created_at, row.id.clone())));
            if !more {
                break;
            }
            after = page.last().map(|row| row.id.clone());
        }
        assert_eq!(observed, expected);
        assert_eq!(observed.len(), 586);

        let foreign = store
            .jobs_for_operator("operator-owned", Some(&foreign_cursor), 2)
            .unwrap_err();
        assert!(foreign.to_string().contains("unknown job recovery cursor"));
        let unknown = store
            .jobs_for_operator("operator-owned", Some("job_missing"), 2)
            .unwrap_err();
        assert!(unknown.to_string().contains("unknown job recovery cursor"));
    }

    fn query_plan(conn: &Connection, query: &str, after: bool) -> Vec<String> {
        let mut statement = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
            .unwrap();
        if after {
            statement
                .query_map(
                    params!["operator-owned", 1_700_000_000_002_i64, "job_02000", 14],
                    |row| row.get(3),
                )
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        } else {
            statement
                .query_map(params!["operator-owned", 14], |row| row.get(3))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        }
    }
}
