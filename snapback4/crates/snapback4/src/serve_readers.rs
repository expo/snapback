//! Read checkout is independent of the schema-adoption writer.
use super::*;

// @ref LLP 3000#7-decisions-during-execution — reader reuse retains fresh transactions and retires old native modules.
/// Reuse only detached read owners. Each query still opens and rolls back
/// its own identity-checked SQLite transaction; no result or viewer is cached.
#[derive(Default)]
pub(super) struct QueryReaders {
    pub(super) epoch: Arc<()>,
    pub(super) idle: Vec<Engine>,
    pub(super) source: Option<Engine>,
    memory: bool,
    #[cfg(test)]
    pub(super) fail_open_after: Option<usize>,
    #[cfg(test)]
    pub(super) retry_open: Option<Arc<dyn Fn() + Send + Sync>>,
    candidate_queries: BTreeSet<String>,
    launching_feed: bool,
}

impl QueryReaders {
    pub(super) fn take(
        &mut self,
        engine: &Engine,
    ) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
        self.memory = engine.store().conn().path().is_none_or(str::is_empty);
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
        self.launching_feed = false;
    }
}

impl QueryReaders {
    pub(super) fn new(engine: &Engine) -> Self {
        Self {
            source: engine.reader().ok(),
            memory: engine.store().conn().path().is_none_or(str::is_empty),
            ..Self::default()
        }
    }
    pub(super) fn replace(&mut self, engine: &Engine) {
        self.invalidate();
        self.memory = engine.store().conn().path().is_none_or(str::is_empty);
        self.source = engine.reader().ok();
    }
    // @ref LLP 3000.019#3.6 — retry a failed factory on existing writer work; reads still refuse immediately.
    pub(super) fn retry_missing(&mut self, engine: &Engine) {
        if !self.memory && self.source.is_none() {
            self.source = latency::acquire(|| {
                #[cfg(test)]
                if let Some(open) = &self.retry_open { open(); }
                engine.reader()
            }).ok();
        }
    }
    pub(super) fn begin_adoption(&mut self, candidate: &Bound) {
        self.launching_feed = self.source.as_ref().is_some_and(|old| candidate.schema.timelines.iter()
            .any(|next| !old.schema().timelines.iter().any(|t| t.same_declaration(next))));
        self.candidate_queries = candidate
            .programs
            .iter()
            .filter(|p| p.program.kind == ProgramKind::Query)
            .map(|p| p.program.name.clone())
            .collect();
    }
    pub(super) fn finish_adoption(&mut self) {
        self.candidate_queries.clear();
        self.launching_feed = false;
    }
    pub(super) fn launching_feed(&self) -> bool { self.launching_feed }
    pub(super) fn pending(&self, name: &str) -> bool {
        self.candidate_queries.contains(name)
    }
    fn detached(&mut self) -> Option<Result<(Arc<()>, Engine), snapback4_core::RuntimeError>> {
        #[cfg(test)]
        if let Some(remaining) = &mut self.fail_open_after {
            if *remaining == 0 {
                self.idle.clear();
                return Some(Err(snapback4_core::RuntimeError::Store("injected reader-open failure; retry the request".into())));
            }
            *remaining -= 1;
        }
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
    pub(super) fn reader(&self) -> Result<(Arc<()>, TimedReader), snapback4_core::RuntimeError> {
        let result = self.acquire_reader(|| lock(&self.readers).detached());
        if let Some(result) = result {
            return result.map(|(epoch, reader)| (epoch, TimedReader { engine: reader, _timing: latency::EngineSpan::new() }));
        }
        // A missing factory can also mean opening a file-backed reader failed.
        // Never acquire the writer to repair that failure under a read permit.
        Err(snapback4_core::RuntimeError::Store("detached reader unavailable; retry the request after the store is available".into()))
    }
    fn acquire_reader<T>(&self, open: impl FnOnce() -> T) -> T {
        latency::acquire(|| {
            #[cfg(test)]
            test_work(&self.reader_open);
            open()
        })
    }
    pub(super) fn open_reader(&self, engine: &Engine) -> Result<Engine, snapback4_core::RuntimeError> {
        self.acquire_reader(|| engine.reader())
    }
    pub(super) fn take_reader(&self, engine: &Engine) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
        self.acquire_reader(|| lock(&self.readers).take(engine))
    }
    pub(super) fn memory_store(&self) -> bool { lock(&self.readers).memory }

    pub(super) fn read_head(&self) -> Result<(String, u64), Refusal> {
        match self.reader() {
            Ok((epoch, mut reader)) => {
                let head = response_head(&mut reader);
                lock(&self.readers).put(&epoch, reader.into_inner());
                head
            }
            Err(_) if self.memory_store() => response_head(&mut lock(&self.engine)),
            Err(error) => Err(error.refusal()),
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

// Ownership ends on return to the pool or on an error/drop (including sync).
pub(super) struct TimedReader { engine: Engine, _timing: latency::EngineSpan }
impl TimedReader {
    pub(super) fn into_inner(self) -> Engine { self.engine }
}
impl std::ops::Deref for TimedReader {
    type Target = Engine;
    fn deref(&self) -> &Engine { &self.engine }
}
impl std::ops::DerefMut for TimedReader {
    fn deref_mut(&mut self) -> &mut Engine { &mut self.engine }
}
