//! SQLite facts and snapshot operations used by release tools and operator inspection.
// @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — preserve tooling statement and transaction order.
// P1: implement these inspection/snapshot capabilities in the Postgres adapter.
use super::{Store, Tx};
use crate::{
    RuntimeError,
    inspection::{CommitClockRecord, HandlerFailure},
};

use std::path::Path;

fn schema_json(conn: &rusqlite::Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')", [], |row| row.get(0))
}
impl Tx<'_> {
    pub fn inspection_schema_json(&self) -> Result<String, RuntimeError> {
        Ok(schema_json(&self.tx)?)
    }
    /// Residency historically reports the driver's text without the runtime prefix.
    pub fn inspection_schema_text(&self) -> Result<String, String> {
        schema_json(&self.tx).map_err(|e| e.to_string())
    }
}
impl Store {
    pub fn snapshot_to(&self, path: &Path) -> Result<(), String> {
        self.conn
            .execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    pub fn inspection_generation(&self) -> Result<(String, String), String> {
        self.conn.query_row("SELECT schema,programs FROM _generations WHERE generation=(SELECT CAST(value AS INTEGER) FROM _meta WHERE key='generation')",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())
    }
    pub fn inspection_table_population(&self, name: &str) -> Result<u64, String> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM r WHERE t=(SELECT num FROM _catalog WHERE name=?1)",
                [name],
                |r| r.get::<_, i64>(0).map(|n| n as u64),
            )
            .map_err(|e| e.to_string())
    }
    pub fn has_release_history(&self) -> Result<bool, String> {
        self.conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_release_events')",[],|r|r.get(0)).map_err(|e|e.to_string())
    }
    pub fn release_referenced(&self, release: i64) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _release_events WHERE release=?1 OR previous=?1)",
                [release],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
    }
    pub fn release_adopted(&self, release: i64) -> Result<bool, String> {
        self.conn.query_row("SELECT EXISTS(SELECT 1 FROM _release_events WHERE (release=?1 OR previous=?1) AND operation!='prune')",[release],|r|r.get(0)).map_err(|e|e.to_string())
    }
    pub fn capture_preview_active(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TEMP TABLE preview_active AS SELECT c.name,r.t,r.id,r.data FROM r JOIN _catalog c ON c.num=r.t; CREATE INDEX preview_active_id ON preview_active(t,id);").map_err(|e|e.to_string())
    }
    pub fn preview_populations(&self, table: &str) -> Result<(i64, i64, i64), String> {
        self.conn.query_row("SELECT (SELECT count(*) FROM preview_active WHERE name=?1),(SELECT count(*) FROM r JOIN _catalog c ON c.num=r.t WHERE c.name=?1),(SELECT count(*) FROM preview_active p WHERE p.name=?1 AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=p.t AND r.id=p.id))",[table],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|e.to_string())
    }
    // Callback keeps row decoding/refusal order interleaved with dependent probes.
    pub fn visit_preview_lost(
        &self,
        mut visit: impl FnMut(String, String, String) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut statement=self.conn.prepare("SELECT p.name,p.id,p.data FROM preview_active p WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=p.t AND r.id=p.id) AND (EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=p.t AND n.id=p.id) OR EXISTS(SELECT 1 FROM _dormant_rows n WHERE n.t=p.t AND n.id=p.id)) ORDER BY p.name,p.id").map_err(|e|e.to_string())?;
        let lost = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in lost {
            let (name, id, data) = row.map_err(|e| e.to_string())?;
            visit(name, id, data)?;
        }
        Ok(())
    }
    pub fn preview_parent_dormant(&self, parent: &str, id: &str) -> Result<bool, String> {
        self.conn.query_row("SELECT EXISTS(SELECT 1 FROM _catalog c WHERE c.name=?1 AND (EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=c.num AND n.id=?2) OR EXISTS(SELECT 1 FROM _dormant_rows n WHERE n.t=c.num AND n.id=?2)) AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=c.num AND r.id=?2))",[parent,id],|r|r.get(0)).map_err(|e|e.to_string())
    }
    pub fn inspection_worker_reports(&self) -> Vec<String> {
        if let Ok(mut statement) = self.conn.prepare("SELECT value FROM _meta WHERE key = 'worker:status' OR key LIKE 'worker:status:%' ORDER BY key")
            && let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) {
            return rows.flatten().collect();
        }
        Vec::new()
    }
    pub fn handler_failure_records(&self) -> Result<Vec<HandlerFailure>, String> {
        let conn = &self.conn;
        let mut records = Vec::new();
        for (table, kind, name) in [
            ("_requests", "action", "name"),
            ("_outbox", "effect", "effect"),
        ] {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    [table],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                continue;
            }
            let mut query = conn.prepare(&format!("SELECT id, {name}, state, attempts, error FROM {table} WHERE error IS NOT NULL ORDER BY at DESC, id DESC LIMIT 3")).map_err(|e|e.to_string())?;
            let rows = query
                .query_map([], |row| {
                    Ok(HandlerFailure {
                        kind,
                        id: row.get(0)?,
                        name: row.get(1)?,
                        state: row.get(2)?,
                        attempts: row.get(3)?,
                        error: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                records.push(row.map_err(|e| e.to_string())?);
            }
        }
        Ok(records)
    }
    pub fn visit_recent_commit_clock(
        &self,
        threshold: i64,
        table_bytes: i64,
        limit: i64,
        mut visit: impl FnMut(CommitClockRecord) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        let mut query = self.conn.prepare(
        "SELECT at, CASE WHEN at > ?1 AND octet_length(touched) <= ?2 THEN CAST(touched AS BLOB) END,
         octet_length(touched) FROM _commits ORDER BY seq DESC LIMIT ?3")?;
        let mut rows = query.query(rusqlite::params![threshold, table_bytes, limit])?;
        while let Some(row) = rows.next()? {
            let at = row.get(0)?;
            let length = if at > threshold {
                Some(row.get::<_, i64>(2)?)
            } else {
                None
            };
            let touched = if length.is_some_and(|n| n <= table_bytes) {
                Some(row.get::<_, Vec<u8>>(1)?)
            } else {
                None
            };
            visit(CommitClockRecord {
                at,
                length,
                touched,
            })?;
        }
        Ok(())
    }
    pub fn recent_commit_max_at(&self, limit: i64) -> Result<Option<i64>, RuntimeError> {
        Ok(self.conn.query_row(
            "SELECT MAX(at) FROM (SELECT at FROM _commits ORDER BY seq DESC LIMIT ?1)",
            [limit],
            |row| row.get(0),
        )?)
    }
    pub fn inspection_has_data(&self) -> Result<bool, RuntimeError> {
        Ok(self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM r)", [], |r| r.get(0))?)
    }
    pub fn record_witness_barrier(
        &mut self,
        at: impl FnOnce() -> i64,
    ) -> Result<u64, RuntimeError> {
        crate::engine::committer::Committer::run(self, crate::engine::committer::Member::new(crate::engine::committer::Kind::Engine, |tx| {
        let seq = tx.next_seq()?;
        tx.record_commit(seq, at(), "native-smoke", "system", "witness", &[], 0)?;
        tx.commit(seq)
        }))
    }
    pub fn inspection_column_populated(
        &self,
        table: &str,
        column: &str,
        mut non_null: impl FnMut(bool, &str) -> Result<bool, String>,
    ) -> Result<bool, String> {
        let mut populated = false;
        for storage in [
            "r",
            "_dormant_rows",
            "_dormant_narrow_rows",
            "_dormant_values",
            "_dormant_refs",
        ] {
            let exists: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
                    [storage],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                continue;
            }
            if storage == "_dormant_refs" {
                populated=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=(SELECT num FROM _catalog WHERE name=?1) AND column_name=?2)",[table,column],|row|row.get(0)).map_err(|e|e.to_string())?;
            } else {
                let sql = format!(
                    "SELECT data FROM {storage} WHERE t=(SELECT num FROM _catalog WHERE name=?1){}",
                    if storage == "_dormant_values" {
                        " AND column_name=?2"
                    } else {
                        ""
                    }
                );
                let mut statement = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
                let parameters: Vec<&dyn rusqlite::ToSql> = if storage == "_dormant_values" {
                    vec![&table, &column]
                } else {
                    vec![&table]
                };
                let mut rows = statement
                    .query(parameters.as_slice())
                    .map_err(|e| e.to_string())?;
                while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                    let data: String = row.get(0).map_err(|e| e.to_string())?;
                    populated = non_null(storage == "_dormant_values", &data)?;
                    if populated {
                        break;
                    }
                }
            }
            if populated {
                break;
            }
        }
        Ok(populated)
    }
}
