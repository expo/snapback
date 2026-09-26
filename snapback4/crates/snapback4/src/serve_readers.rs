//! Read checkout is independent of the schema-adoption writer.
use super::*;

// @ref LLP 3000#7-decisions-during-execution — reader reuse retains fresh transactions and retires old native modules.
/// Reuse only detached read owners. Each query still opens and rolls back
/// its own identity-checked SQLite transaction; no result or viewer is cached.
#[derive(Default)]
pub(super) struct QueryReaders {
    pub(super) epoch: Arc<()>,
    pub(super) idle: Vec<Engine>,
    source: Option<Engine>,
    candidate_queries: BTreeSet<String>,
}

impl QueryReaders {
    pub(super) fn take(
        &mut self,
        engine: &Engine,
    ) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
        if self.source.is_none() {
            self.source = engine.reader().ok();
        }
        let reader = match self.idle.pop() {
            Some(reader) => reader,
            None => engine.reader()?,
        };
        Ok((self.epoch.clone(), reader))
    }

    pub(super) fn put(&mut self, epoch: &Arc<()>, reader: Engine) {
        if Arc::ptr_eq(epoch, &self.epoch) && self.idle.len() < REQUEST_WORKERS {
            self.idle.push(reader);
        }
    }

    pub(super) fn invalidate(&mut self) {
        // Native code can change without a schema-generation change. Loans
        // retain their old epoch so an in-flight return cannot repopulate it.
        self.epoch = Arc::new(());
        self.idle.clear();
        self.source = None;
        self.candidate_queries.clear();
    }
}

impl QueryReaders {
    pub(super) fn new(engine: &Engine) -> Self {
        Self {
            source: engine.reader().ok(),
            ..Self::default()
        }
    }
    pub(super) fn replace(&mut self, engine: &Engine) {
        self.invalidate();
        self.source = engine.reader().ok();
    }
    pub(super) fn begin_adoption(&mut self, candidate: &Bound) {
        self.candidate_queries = candidate
            .programs
            .iter()
            .filter(|p| p.program.kind == ProgramKind::Query)
            .map(|p| p.program.name.clone())
            .collect();
    }
    pub(super) fn finish_adoption(&mut self) {
        self.candidate_queries.clear();
    }
    pub(super) fn pending(&self, name: &str) -> bool {
        self.candidate_queries.contains(name)
    }
    fn detached(&mut self) -> Option<Result<(Arc<()>, Engine), snapback4_core::RuntimeError>> {
        let source = self.source.as_ref()?;
        Some(match self.idle.pop() {
            Some(reader) => Ok((self.epoch.clone(), reader)),
            None => source.reader().map(|reader| (self.epoch.clone(), reader)),
        })
    }
}
impl Shared {
    // @ref LLP 3000.019#3.6 — a fresh WAL snapshot reads the old program during atomic activation.
    // The source is only a connection factory: no transaction, answer or viewer
    // is retained. Identity guards still refuse an obsolete generation.
    pub(super) fn reader(&self) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
        if let Some(result) = lock(&self.readers).detached() {
            return result;
        }
        let engine = lock(&self.engine);
        lock(&self.readers).take(&engine)
    }
    pub(super) fn read_head(&self) -> Result<(String, u64), Refusal> {
        match self.reader() {
            Ok((epoch, mut reader)) => {
                let head = response_head(&mut reader);
                lock(&self.readers).put(&epoch, reader);
                head
            }
            Err(_) => response_head(&mut lock(&self.engine)),
        }
    }
}

/// `--fresh` still dies with its host, but a private WAL file permits detached
/// readers during a schema save. Only this guard removes its own directory.
pub(super) struct FreshDirectory(std::path::PathBuf);
impl FreshDirectory {
    pub(super) fn new() -> Result<Self, String> {
        let id =
            snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::seed())
                .map_err(|e| e.to_string())?;
        let path =
            std::env::temp_dir().join(format!("snapback4-fresh-{}-{id}", std::process::id()));
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        let owned = Self(path);
        snapback4_core::private_fs::directory(&owned.0).map_err(|e| e.to_string())?;
        Ok(owned)
    }
    pub(super) fn store(&self) -> Result<snapback4_core::Store, snapback4_core::RuntimeError> {
        snapback4_core::Store::open(&self.0.join("store.db"))
    }
}
impl Drop for FreshDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
