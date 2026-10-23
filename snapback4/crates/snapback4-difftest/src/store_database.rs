//! Harness-owned physical state reset. No engine implementation is replaced.
use crate::{execute, generate::Case};
use postgres::{Client, NoTls};
use snapback4_core::{Engine, value::canonical_json, wire};
use std::{
    collections::BTreeMap,
    error::Error,
    sync::atomic::{AtomicU64, Ordering},
};

pub(crate) fn error_chain(kind: &str, error: &(dyn Error + 'static)) -> String {
    let mut parts = vec![format!("statement={kind}: {error}")];
    let mut next = Some(error);
    while let Some(e) = next {
        if let Some(pg) = e.downcast_ref::<postgres::Error>() {
            if let Some(db) = pg.as_db_error() {
                parts.push(format!(
                    "SQLSTATE={} message={} detail={} hint={} context={}",
                    db.code().code(),
                    db.message(),
                    db.detail().unwrap_or("<none>"),
                    db.hint().unwrap_or("<none>"),
                    db.where_().unwrap_or("<none>")
                ));
            }
        }
        next = e.source();
        if let Some(source) = next {
            parts.push(source.to_string());
        }
    }
    parts.join("; caused by: ")
}
fn setup_error(diagnostics: &crate::pg_diagnostics::Diagnostics, error: snapback4_core::RuntimeError) -> String {
    let reason = crate::stores::setup_error(error);
    // A capability refusal is a stable classifier, not a failed SQL exchange.
    if reason.starts_with("postgres-unsupported:") { reason } else { diagnostics.describe(&reason) }
}
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}
fn ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}
static NEXT: AtomicU64 = AtomicU64::new(0);
pub struct Database {
    admin: Client,
    url: String,
    fresh: bool,
    name: Option<String>,
    tables: Vec<String>,
    empty: String,
    seeded: String,
}
pub(crate) struct World {
    pub engine: Engine,
    /// The prelude's outcomes (`execute::prelude`), run once after seeding.
    pub prelude: Vec<execute::Outcome>,
    name: String,
    diagnostics: crate::pg_diagnostics::Diagnostics,
}
impl World {
    pub fn clear_errors(&self) {
        self.diagnostics.clear();
    }
    pub fn check_errors(
        &self,
        record: &(execute::Outcome, Vec<execute::Outcome>),
    ) -> Result<(), String> {
        for outcome in std::iter::once(&record.0).chain(&record.1) {
            if let Some(r) = outcome.refusal().filter(|r| r["code"] == "E_STORE") {
                return Err(self
                    .diagnostics
                    .describe(&format!("engine query/mutation: {r}")));
            }
        }
        Ok(())
    }
}
impl Database {
    pub fn connect() -> Result<Self, String> {
        Self::connect_mode(false)
    }
    /// Fresh schemas are deliberately opt-in, for reset equivalence tests.
    pub fn connect_fresh() -> Result<Self, String> {
        Self::connect_mode(true)
    }
    fn connect_mode(fresh: bool) -> Result<Self, String> {
        let url = std::env::var("SNAPBACK4_EVAL_POSTGRES")
            .map_err(|_| "SNAPBACK4_EVAL_POSTGRES is required; no store work was run")?;
        let mut admin =
            Client::connect(&url, NoTls).map_err(|e| error_chain("CONNECT admin", &e))?;
        admin
            .batch_execute("SET statement_timeout='10s'; SET lock_timeout='5s'")
            .map_err(|e| error_chain("SET admin timeouts", &e))?;
        Ok(Self {
            admin,
            url,
            fresh,
            name: None,
            tables: vec![],
            empty: String::new(),
            seeded: String::new(),
        })
    }
    fn batch(&mut self, sql: &str) -> Result<(), String> {
        self.admin.batch_execute(sql).map_err(|e| {
            let kind = if sql.starts_with("BEGIN") {
                "snapshot restore DELETE/INSERT"
            } else {
                "DROP SCHEMA"
            };
            let detail = error_chain(kind, &e);
            let _ = self.admin.batch_execute("ROLLBACK");
            detail
        })
    }
    pub(crate) fn create(&mut self, case: &Case, source: &str) -> Result<World, String> {
        self.create_prefetch(case, source, true)
    }
    pub(crate) fn create_prefetch(&mut self, case: &Case, source: &str, prefetch: bool) -> Result<World, String> {
        let mut b = execute::compile(source).map_err(|e| format!("binder: {e}"))?;
        let rows = case
            .rows
            .iter()
            .map(|(name, row)| {
                let table = b
                    .schema
                    .tables
                    .get(name)
                    .ok_or_else(|| format!("no table {name}"))?;
                wire::row_from_json(table, row)
                    .map(|r| (name.clone(), r))
                    .map_err(|e| format!("decode seed: {e}"))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let programs: BTreeMap<_, _> = b
            .programs
            .into_iter()
            .map(|p| (p.program.name.clone(), p.program))
            .collect();
        let (config, diagnostics) = crate::pg_diagnostics::Diagnostics::connect(&self.url)?;
        let (name, mut engine) = if let Some(name) = self.name.clone().filter(|_| !self.fresh) {
            self.batch(&self.empty.clone())?;
            // Install an unrelated empty fixture, not a product migration.
            // Engine::open reads the authoritative _generations catalog; the
            // old evaluator read only _backend. Keep both coherent and force
            // the ordinary common activation builder to refresh derived facts.
            let checked = Engine::memory(b.schema, programs.values().cloned())
                .map_err(crate::stores::setup_error)?;
            b.schema = checked.schema().clone();
            let schema = canonical_json(&b.schema);
            let programs = canonical_json(&programs);
            let install = (|| -> Result<(), postgres::Error> {
                let mut tx = self.admin.transaction()?;
                assert!(tx.query_one(&format!("SELECT NOT EXISTS(SELECT 1 FROM {name}.r) AND NOT EXISTS(SELECT 1 FROM {name}._ops)"), &[])?.get::<_, bool>(0), "fixture replacement requires the restored empty snapshot");
                tx.execute(&format!("UPDATE {name}._backend SET schema=$1, programs=$2 WHERE singleton"), &[&schema, &programs])?;
                tx.execute(&format!("UPDATE {name}._generations SET schema=$1, programs=$2 WHERE generation=(SELECT generation FROM {name}._backend WHERE singleton)"), &[&schema, &programs])?;
                tx.execute(&format!("DELETE FROM {name}._meta WHERE key IN ('live_sum_candidates','cap_counts_schema')"), &[])?;
                tx.commit()
            })();
            install.map_err(|e| error_chain("install compiled empty fixture", &e))?;
            let engine = Engine::open_postgres_evaluation(config, &name)
                .map_err(|e| setup_error(&diagnostics, e))?;
            (name, engine)
        } else {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let name = format!(
                "sb4_eval_dt_{:x}_{stamp:x}_{:x}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let engine = Engine::create_postgres_evaluation(config, &name, b.schema, programs.into_values())
                .map_err(|e| setup_error(&diagnostics, e))?;
            self.name = Some(name.clone());
            self.tables = self
                .admin
                .query(
                    "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
                    &[&name],
                )
                .map_err(|e| error_chain("SELECT physical tables", &e))?
                .iter()
                .map(|r| r.get(0))
                .collect();
            // Parent before children on INSERT, reversed for DELETE.
            self.tables.sort_by_key(|t| (t != "_commits", t.clone()));
            self.empty = self.snapshot(&name)?;
            (name, engine)
        };
        engine
            .seed_at(rows, execute::seed_clock(case))
            .map_err(|e| diagnostics.describe(&error_chain("seed INSERT/UPDATE/commit", &e)))?;
        engine.set_evaluation_prefetch(prefetch);
        let prelude = execute::prelude(&mut engine, case);
        engine.set_ceilings(case.budget);
        if case.program.mutation() {
            self.seeded = self.snapshot(&name)?;
        }
        Ok(World {
            name,
            engine,
            prelude,
            diagnostics,
        })
    }
    /// An independent namespace keeps the main world's seed/reset ownership intact.
    pub(crate) fn prelude_prefetch_off(&self, case: &Case, source: &str) -> Result<Vec<execute::Outcome>, String> {
        let mut probe = Self::connect_mode(self.fresh)?;
        let world = probe.create_prefetch(case, source, false)?;
        let outcomes = world.prelude.clone();
        probe.remove(world)?;
        probe.close()?;
        Ok(outcomes)
    }
    fn snapshot(&mut self, name: &str) -> Result<String, String> {
        let mut sql = format!("BEGIN; SET LOCAL search_path={name},pg_catalog;");
        // DELETE preserves relfilenodes, avoiding TRUNCATE's file churn.
        for t in self.tables.iter().rev() {
            sql += &format!("DELETE FROM {};", ident(t));
        }
        for t in &self.tables {
            let data: Option<String> = self
                .admin
                .query_one(
                    &format!(
                        "SELECT json_agg(dt_row.*)::text FROM {name}.{} dt_row",
                        ident(t)
                    ),
                    &[],
                )
                .map_err(|e| error_chain("SELECT seed snapshot", &e))?
                .get(0);
            if let Some(data) = data {
                sql += &format!(
                    "INSERT INTO {0} SELECT * FROM json_populate_recordset(NULL::{0},{1}::json);",
                    ident(t),
                    quote(&data)
                );
            }
        }
        sql += "COMMIT;";
        Ok(sql)
    }
    pub(crate) fn restore(
        &mut self,
        world: &mut World,
        case: &Case,
        source: &str,
    ) -> Result<(), String> {
        if self.fresh {
            self.close()?;
            *world = self.create(case, source)?;
        } else {
            self.batch(&self.seeded.clone())?;
            let (config, diagnostics) = crate::pg_diagnostics::Diagnostics::connect(&self.url)?;
            let engine = Engine::open_postgres_evaluation(config, &world.name)
                .map_err(|e| setup_error(&diagnostics, e))?;
            world.engine = engine;
            world.diagnostics = diagnostics;
        }
        Ok(())
    }
    pub(crate) fn remove(&mut self, world: World) -> Result<(), String> {
        drop(world);
        if self.fresh {
            self.close()?;
        }
        Ok(())
    }
    pub fn close(&mut self) -> Result<(), String> {
        if let Some(name) = self.name.take() {
            self.batch(&format!("DROP SCHEMA {name} CASCADE"))?;
        }
        Ok(())
    }
}
impl Drop for Database {
    fn drop(&mut self) {
        if let Err(e) = self.close() {
            eprintln!("store cleanup failed: {e}");
        }
    }
}

/// Snapshot all SQLite rows once; preserve engine schema/catalog caches.
pub(crate) struct SqliteSnapshot(snapback4_core::store::evaluation::Snapshot);
impl SqliteSnapshot {
    pub fn capture(engine: &Engine) -> Result<Self, String> {
        engine.store().evaluation_snapshot(error_chain).map(Self)
    }
    pub fn restore(&self, engine: &Engine) -> Result<(), String> {
        engine.store().restore_evaluation_snapshot(&self.0, error_chain)
    }
}
