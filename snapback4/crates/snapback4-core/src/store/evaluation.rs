//! Typed physical snapshots for the standalone differential evaluator.
//! No raw handle is exposed to the host or evaluator.
// @ref LLP 3000.035#5.1 — restore seeded rows and bookkeeping between evaluator attempts.
use super::Store;
fn ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Snapshot all SQLite rows once; preserve engine schema/catalog caches.
pub struct Snapshot {
    tables: Vec<String>,
}
impl Snapshot {
    pub fn capture(
        store: &Store,
        error_chain: impl Fn(&str, &(dyn std::error::Error + 'static)) -> String,
    ) -> Result<Self, String> {
        let conn = store.conn();
        let mut statement = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(|e| error_chain("SQLite snapshot table list", &e))?;
        let tables = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| error_chain("SQLite snapshot table list", &e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| error_chain("SQLite snapshot table list", &e))?;
        conn.execute_batch("CREATE TEMP TABLE dt_dirty (t INTEGER PRIMARY KEY)")
            .map_err(|e| error_chain("SQLite changed table tracker", &e))?;
        for (i, t) in tables.iter().enumerate() {
            conn.execute_batch(&format!(
                "CREATE TEMP TABLE dt_seed_{i} AS SELECT * FROM {}",
                ident(t)
            ))
            .map_err(|e| error_chain("SQLite snapshot", &e))?;
            for event in ["INSERT", "UPDATE", "DELETE"] {
                conn.execute_batch(&format!("CREATE TEMP TRIGGER dt_track_{i}_{event} AFTER {event} ON {} BEGIN INSERT OR IGNORE INTO dt_dirty VALUES ({i}); END;",ident(t)))
                    .map_err(|e| error_chain("SQLite changed table trigger", &e))?;
            }
        }
        Ok(Self { tables })
    }
    pub fn restore(
        &self,
        store: &Store,
        error_chain: impl Fn(&str, &(dyn std::error::Error + 'static)) -> String,
    ) -> Result<(), String> {
        let conn = store.conn();
        let mut query = conn
            .prepare_cached("SELECT t FROM temp.dt_dirty ORDER BY t")
            .map_err(|e| error_chain("SQLite changed tables", &e))?;
        let changed = query
            .query_map([], |r| r.get::<_, u32>(0))
            .map_err(|e| error_chain("SQLite changed tables", &e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| error_chain("SQLite changed tables", &e))?;
        if changed.is_empty() {
            return Ok(());
        }
        let mut sql = String::from("PRAGMA foreign_keys=OFF; BEGIN;");
        for i in changed {
            sql += &format!(
                "DELETE FROM {0}; INSERT INTO {0} SELECT * FROM dt_seed_{i};",
                ident(&self.tables[i as usize])
            );
        }
        sql += "DELETE FROM temp.dt_dirty; COMMIT; PRAGMA foreign_keys=ON;";
        conn.execute_batch(&sql)
            .map_err(|e| error_chain("SQLite restore", &e))
    }
}

impl Store {
    pub fn evaluation_rows(&self) -> Result<Vec<(String, String)>, String> {
        let mut statement = self
            .conn()
            .prepare("SELECT id, data FROM r")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }
}


/// The linked SQLite library's version for standalone evaluation reports.
/// Store::open already applies the measured WAL/FULL durability policy.
pub fn sqlite_version() -> &'static str { rusqlite::version() }
