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
fn setup_error(allowlist: &mut crate::stores::UnsupportedAllowlist, diagnostics: &crate::pg_diagnostics::Diagnostics, error: snapback4_core::RuntimeError) -> String {
    let reason = allowlist.classify(error);
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
    unsupported: crate::stores::UnsupportedAllowlist,
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
    /// Exact exclusions for one campaign; `close` asserts every declared count.
    /// Each tuple is (code/family, count, repository ticket path).
    pub fn connect_with_unsupported(entries: &[(&str, u64, &str)]) -> Result<Self, String> {
        let mut database = Self::connect()?;
        database.unsupported = crate::stores::UnsupportedAllowlist::new(entries);
        Ok(database)
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
            unsupported: crate::stores::UnsupportedAllowlist::default(),
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
                .map_err(|e| setup_error(&mut self.unsupported, &diagnostics, e))?;
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
                .map_err(|e| setup_error(&mut self.unsupported, &diagnostics, e))?;
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
        } else {
            self.check_log_integrity(&name)?;
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
    // @ref LLP 3000.009.001.000.002#3.4 — the harness deletes/restores both managed ledgers atomically; assert their invariant independently of public reads' inner join.
    fn check_log_integrity(&mut self, name: &str) -> Result<(), String> {
        let orphan: bool = self.admin.query_one(&format!("SELECT EXISTS(SELECT 1 FROM {name}._log l LEFT JOIN {name}._commits c USING(seq) WHERE c.seq IS NULL)"), &[])
            .map_err(|e| error_chain("log integrity oracle", &e))?.get(0);
        if orphan { return Err("store-log-integrity: _log references a missing _commits row".into()); }
        Ok(())
    }
    fn snapshot(&mut self, name: &str) -> Result<String, String> {
        self.check_log_integrity(name)?;
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
        self.check_log_integrity(&world.name)?;
        if self.fresh {
            self.drop_schema()?;
            *world = self.create(case, source)?;
        } else {
            self.batch(&self.seeded.clone())?;
            self.check_log_integrity(&world.name)?;
            let (config, diagnostics) = crate::pg_diagnostics::Diagnostics::connect(&self.url)?;
            let engine = Engine::open_postgres_evaluation(config, &world.name)
                .map_err(|e| setup_error(&mut self.unsupported, &diagnostics, e))?;
            world.engine = engine;
            world.diagnostics = diagnostics;
        }
        Ok(())
    }
    pub(crate) fn remove(&mut self, world: World) -> Result<(), String> {
        self.check_log_integrity(&world.name)?;
        drop(world);
        if self.fresh {
            self.drop_schema()?;
        }
        Ok(())
    }
    pub fn close(&mut self) -> Result<(), String> {
        self.drop_schema()?;
        self.unsupported.verify()
    }
    fn drop_schema(&mut self) -> Result<(), String> {
        if let Some(name) = self.name.take() {
            self.batch(&format!("DROP SCHEMA {name} CASCADE"))?;
        }
        Ok(())
    }
}
impl Drop for Database {
    fn drop(&mut self) {
        if let Err(e) = self.drop_schema() {
            eprintln!("store cleanup failed: {e}");
        }
        if let Err(error) = self.unsupported.verify() {
            if std::thread::panicking() { eprintln!("{error}"); } else { panic!("{error}"); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Worker {
        child: std::process::Child,
        directory: std::path::PathBuf,
    }
    impl Worker {
        fn spawn(hang: bool) -> Self {
            let directory = std::env::temp_dir().join(format!("sb4-snapshot-worker-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir(&directory).unwrap();
            let output = std::fs::File::create(directory.join("output")).unwrap();
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "store_database::tests::snapshot_failure_worker", "--nocapture"])
                .env("SB4_SNAPSHOT_WORKER", &directory)
                .env("SB4_SNAPSHOT_WORKER_HANG", if hang { "1" } else { "0" })
                .stdout(output.try_clone().unwrap()).stderr(output).spawn().unwrap();
            eprintln!("snapshot worker started PID {}", child.id());
            Self { child, directory }
        }
        fn ready(&mut self) {
            let until = std::time::Instant::now() + std::time::Duration::from_secs(60);
            while !self.directory.join("ready").exists() {
                assert!(self.child.try_wait().unwrap().is_none(), "worker exited before ready: {}", self.output());
                assert!(std::time::Instant::now() < until, "worker setup deadline: {}", self.output());
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        fn output(&self) -> String {
            std::fs::read_to_string(self.directory.join("output")).unwrap_or_default()
        }
        fn wait(&mut self, bound: std::time::Duration) -> Result<std::process::ExitStatus, String> {
            let until = std::time::Instant::now() + bound;
            loop {
                if let Some(status) = self.child.try_wait().map_err(|e| e.to_string())? { return Ok(status); }
                if std::time::Instant::now() >= until {
                    self.child.kill().map_err(|e| e.to_string())?;
                    self.child.wait().map_err(|e| e.to_string())?;
                    return Err(format!("snapshot worker {} exceeded deadline (terminated and reaped)", self.child.id()));
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
    impl Drop for Worker {
        fn drop(&mut self) {
            if self.child.try_wait().unwrap().is_none() { self.child.kill().unwrap(); }
            let status = self.child.wait().unwrap();
            eprintln!("snapshot worker reaped PID {}: {status}", self.child.id());
            // A killed worker cannot run Database::drop. Only its recorded,
            // PID-bound fixture namespace belongs to this parent.
            if let Ok(name) = std::fs::read_to_string(self.directory.join("namespace")) {
                let prefix = format!("sb4_eval_dt_{:x}_", self.child.id());
                assert!(name.starts_with(&prefix) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'));
                let mut admin = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
                admin.batch_execute(&format!("SET lock_timeout='5s'; SET statement_timeout='10s'; DROP SCHEMA IF EXISTS {name} CASCADE")).unwrap();
            }
            std::fs::remove_dir_all(&self.directory).unwrap();
        }
    }
    #[test]
    fn log_integrity_oracle_detects_an_orphan_hidden_by_log_read_join() {
        let mut database = Database::connect().unwrap();
        let case = crate::generate::generate(0);
        let source = case.program.source();
        let world = database.create(&case, &source).unwrap();
        let name = world.name.clone();
        database.admin.execute(&format!("INSERT INTO {name}._log(partition,seq,ord,t,kind,id,data) VALUES ('public',9223372036854775807,0,'test','del','planted',NULL)"), &[]).unwrap();
        let error = database.snapshot(&name).unwrap_err();
        assert_eq!(error, "store-log-integrity: _log references a missing _commits row");
        database.admin.execute(&format!("DELETE FROM {name}._log WHERE seq=9223372036854775807"), &[]).unwrap();
        database.remove(world).unwrap();
        database.close().unwrap();
    }

    #[test]
    fn snapshot_failure_worker() {
        let Some(directory) = std::env::var_os("SB4_SNAPSHOT_WORKER").map(std::path::PathBuf::from) else { return; };
        if std::env::var("SB4_SNAPSHOT_WORKER_HANG").as_deref() == Ok("1") {
            std::fs::write(directory.join("ready"), "ready").unwrap();
            loop { std::thread::park(); }
        }
        let mut database = Database::connect().unwrap();
        let case = crate::generate::generate(0);
        let source = case.program.source();
        let world = database.create(&case, &source).unwrap();
        database.remove(world).unwrap();
        let name = database.name.clone().unwrap();
        std::fs::write(directory.join("namespace"), &name).unwrap();
        database.admin.batch_execute(&format!("DROP TABLE {name}.r CASCADE")).unwrap();
        std::fs::write(directory.join("ready"), "ready").unwrap();
        let error = match database.create(&case, &source) {
            Ok(_) => panic!("a missing snapshotted table must fail setup"),
            Err(error) => error,
        };
        database.close().unwrap();
        assert!(error.contains("SQLSTATE=42P01"), "{error}");
        assert!(error.contains("snapshot restore DELETE/INSERT"), "{error}");
        eprintln!("bounded setup failure: {error}");
    }
    #[test]
    fn failed_reused_snapshot_reports_sql_error_without_hanging_cleanup() {
        let mut worker = Worker::spawn(false);
        worker.ready();
        let status = worker.wait(std::time::Duration::from_secs(10));
        assert!(status.as_ref().is_ok_and(|s| s.success()), "{status:?}: {}", worker.output());
        assert!(worker.output().contains("SQLSTATE=42P01"), "{}", worker.output());
    }
    #[test]
    fn comparison_control_timeout_reaps_worker() {
        let mut worker = Worker::spawn(true);
        worker.ready();
        let error = worker.wait(std::time::Duration::from_millis(50)).unwrap_err();
        assert!(error.contains("exceeded deadline"));
        assert!(worker.child.try_wait().unwrap().is_some(), "timed-out worker must already be terminated and reaped");
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
