//! Retry only opening/adopting the local backend, before invoking an operation.
use crate::project::{Project, SourceStamp};
use snapback4_core::{Engine, RuntimeError};
use snapback4_lang::Bound;
use std::{fmt, time::{Duration, Instant}};

const WAIT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(100);

pub(super) struct Source {
    quarry: Vec<(String, String)>,
    stamp: SourceStamp,
}
impl Source {
    pub fn capture(project: &Project) -> std::io::Result<Self> {
        Ok(Self { quarry: project.sources()?, stamp: project.sources_stamp() })
    }

    // Compile exactly the bytes whose identity is revalidated. A separate
    // project.compile() could observe an intervening A → B → A edit.
    pub fn compile(&self) -> Bound { snapback4_lang::compile(&self.quarry) }

    /// The captured files, for quoting exactly the source that ran.
    pub fn files(&self) -> &[(String, String)] { &self.quarry }

    pub fn validate(&self, project: &Project) -> Result<(), Error> {
        let now = project.sources().map_err(|error| Error::Source(error.to_string()))?;
        if now != self.quarry || project.sources_stamp() != self.stamp {
            return Err(Error::Source("the source changed after this invocation was compiled".into()));
        }
        Ok(())
    }
}

#[derive(Debug)]
pub(super) enum Error {
    Store(RuntimeError),
    Source(String),
    Busy { operation: String, elapsed: Duration, reason: RuntimeError },
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(error) => error.fmt(f),
            Self::Source(reason) => write!(f, "E_RUN_SOURCE_CHANGED: {reason}; no operation was admitted; check the source and rerun with the intended arguments"),
            Self::Busy { operation, elapsed, reason } => write!(f,
                "E_RUN_BUSY: run {operation} could not open/adopt the store after {} ms (15000 ms contention deadline): {reason}; no operation was admitted; inspect `snapback4 doctor` and the dev adoption log, wait for the writer or stop your dev host, then run once and restart dev; restart a --no-watch host after external adoption",
                elapsed.as_millis()),
        }
    }
}

fn locked(error: &RuntimeError) -> bool {
    matches!(error, RuntimeError::Sql(error) if matches!(error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)))
}

// @ref LLP 3000.011.004.000#2 — bind retries to source before admission, never retry the operation.
// @ref LLP 3000.011.004.000#3 — external adoption remains supported; the watcher reopens and stale hosts refuse.
pub(super) fn open(project: &Project, owner: &crate::store_owner::Owner, bound: &Bound, source: &Source, operation: &str, now: i64) -> Result<Engine, Error> {
    let started = Instant::now();
    let mut last = None;
    loop {
        source.validate(project)?;
        if started.elapsed() >= WAIT && let Some(reason) = last.take() {
            return Err(Error::Busy { operation: operation.into(), elapsed: started.elapsed(), reason });
        }
        // Do not stack SQLite's per-statement five-second waits behind this
        // deadline. Restore the ordinary policy before any operation executes.
        match owner.open_engine(bound, Duration::ZERO, now) {
            Ok(engine) => {
                source.validate(project)?;
                if started.elapsed() >= WAIT && let Some(reason) = last.take() {
                    return Err(Error::Busy { operation: operation.into(), elapsed: started.elapsed(), reason });
                }
                engine.store().conn().busy_timeout(Duration::from_secs(5))
                    .map_err(|error| Error::Store(error.into()))?;
                if last.is_some() {
                    eprintln!("snapback4 run {operation}: open/adoption ready after {} ms; using generation {}", started.elapsed().as_millis(), engine.generation());
                }
                return Ok(engine);
            }
            Err(error) if locked(&error) => {
                if last.is_none() {
                    eprintln!("snapback4 run {operation}: waiting before admission for store open/adoption ({} ms elapsed; 15000 ms contention deadline): {error}; inspect `snapback4 doctor` or the dev adoption log", started.elapsed().as_millis());
                }
                last = Some(error);
                std::thread::sleep(POLL.min(WAIT.saturating_sub(started.elapsed())));
            }
            Err(error) => return Err(Error::Store(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compilation_uses_captured_bytes_through_an_aba_source_edit() {
        use snapback4_core::ir::{Expr, Stmt};
        let root = std::env::temp_dir().join(format!("snapback4-run-source-{}", std::process::id()));
        let project = Project { root: root.clone() };
        std::fs::create_dir_all(project.schema_dir()).unwrap();
        let path = project.schema_dir().join("schema.q");
        let original = "query version():\n  return 1\n";
        std::fs::write(&path, original).unwrap();
        let modified = path.metadata().unwrap().modified().unwrap();
        let source = Source::capture(&project).unwrap();
        std::fs::write(&path, "query version():\n  return 2\n").unwrap();
        let compiled = source.compile();
        std::fs::write(&path, original).unwrap();
        std::fs::File::options().write(true).open(&path).unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified)).unwrap();
        source.validate(&project).unwrap();
        assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
        assert!(matches!(compiled.programs[0].program.body.as_slice(),
            [Stmt::Return(Expr::Literal(snapback4_core::Value::Int(1)))]),
            "the operation must describe captured source A, never intervening source B");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_typed_sqlite_locks_are_retryable() {
        for code in [rusqlite::ffi::SQLITE_BUSY, rusqlite::ffi::SQLITE_LOCKED, rusqlite::ffi::SQLITE_BUSY_SNAPSHOT] {
            assert!(locked(&rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None).into()));
        }
        for code in [rusqlite::ffi::SQLITE_IOERR, rusqlite::ffi::SQLITE_CORRUPT, rusqlite::ffi::SQLITE_READONLY] {
            assert!(!locked(&rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), Some("database is locked".into())).into()));
        }
        assert!(!locked(&RuntimeError::Store("database is locked".into())));
        assert!(!locked(&RuntimeError::Generation("changed".into())));
    }
}
