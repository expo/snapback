//! Read checkout is independent of the schema-adoption writer.
use super::*;
use snapback4_core::RuntimeError;

// @ref LLP 3000.009.001.000.000#9 — each handoff decodes the original wire arguments against the program that will execute them.
pub(super) fn query_context(engine: &Engine, shared: &Shared, op: &str, args: &Json, mut context: Context) -> Result<Context, Refusal> {
    let program = engine.program(op).ok_or_else(|| snapback4_core::RuntimeError::UnknownOp(op.into()).refusal())?;
    if program.kind != ProgramKind::Query {
        return Err(Refusal::new("E_OP", "op", format!("{op} is no longer a query")));
    }
    if let Some(why) = dev_doors::persona_argument(shared, &program.args, args) { return Err(why); }
    context.args = wire::arguments_from_json_with_refusal(program, args)?;
    Ok(context)
}

// @ref LLP 3000#7-decisions-during-execution — reader reuse retains fresh transactions and retires old native modules.
/// Reuse only detached read owners. Each query still opens and rolls back
/// its own identity-checked SQLite transaction; no result or viewer is cached.
#[derive(Default)]
pub(super) struct QueryReaders {
    pub(super) epoch: Arc<()>,
    pub(super) idle: Vec<Engine>,
    pub(super) source: Option<Engine>,
    factories: Vec<Engine>,
    available: Arc<Condvar>,
    memory: bool,
    pub(super) refusal_sites: Arc<dev_refusals::Sites>,
    #[cfg(test)]
    pub(super) fail_open_after: Option<usize>,
    #[cfg(test)]
    pub(super) retry_open: Option<Arc<dyn Fn() + Send + Sync>>,
    #[cfg(test)]
    pub(super) construction_hook: Option<Arc<dyn Fn() + Send + Sync>>,
    candidate_queries: BTreeSet<String>,
    launching_feed: bool,
}

// @ref LLP 3000.009.001.000.002#4.1 — construction owns a bounded factory loan, never the global mutex, including errors/unwind.
struct FactoryLoan<'a> {
    shared: &'a Shared,
    epoch: Arc<()>,
    engine: Option<Engine>,
}
impl Drop for FactoryLoan<'_> {
    fn drop(&mut self) {
        let mut readers = lock(&self.shared.readers);
        if Arc::ptr_eq(&self.epoch, &readers.epoch) {
            readers.factories.push(self.engine.take().unwrap());
        }
        readers.available.notify_all();
    }
}

impl QueryReaders {
    pub(super) fn put(&mut self, epoch: &Arc<()>, reader: Engine) {
        if Arc::ptr_eq(epoch, &self.epoch) && self.idle.len() < REQUEST_WORKERS {
            self.idle.push(reader);
            self.available.notify_one();
        }
    }

    pub(super) fn invalidate(&mut self) {
        // Native code can change without a schema-generation change. Loans
        // retain their old epoch so an in-flight return cannot repopulate it.
        self.epoch = Arc::new(());
        self.idle.clear();
        self.source = None;
        self.factories.clear();
        self.available.notify_all();
        self.candidate_queries.clear();
        self.launching_feed = false;
    }
}

impl QueryReaders {
    pub(super) fn new(engine: &Engine, sites: &dev_refusals::Sites) -> Self {
        // Four independent factory loans bound concurrent construction. They
        // share PG's fixed physical pool; no connection is borrowed through a
        // global mutex while connect/qualification runs.
        let mut source = engine.reader().ok();
        let factories: Vec<_> = (0..4).filter_map(|_| source.as_ref()?.reader().ok()).collect();
        if factories.is_empty() { source = None; }
        Self {
            source,
            factories,
            refusal_sites: Arc::new(sites.clone()),
            memory: engine.store().is_memory(),
            ..Self::default()
        }
    }
    pub(super) fn replace(&mut self, prepared: Self) {
        self.invalidate();
        self.refusal_sites = prepared.refusal_sites;
        self.memory = prepared.memory;
        self.source = prepared.source;
        self.factories = prepared.factories;
    }
    // Startup has no global mutex yet. PG serve readiness includes all 30
    // detached loans, including their identity/generation qualification.
    pub(super) fn prepare_population(&mut self, engine: &Engine) -> Result<(), RuntimeError> {
        #[cfg(feature = "postgres")]
        if matches!(engine.store(), snapback4_core::store_port::AnyStore::Postgres(_)) {
            let source = self.source.as_ref().ok_or_else(|| RuntimeError::Store("Postgres reader population unavailable before readiness".into()))?;
            while self.idle.len() < REQUEST_WORKERS { self.idle.push(source.reader()?); }
        }
        let _ = engine;
        Ok(())
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
    fn check_open(&mut self) -> Result<(), RuntimeError> {
        #[cfg(test)]
        if let Some(remaining) = &mut self.fail_open_after {
            if *remaining == 0 {
                self.idle.clear();
                return Err(RuntimeError::Store("injected reader-open failure; retry the request".into()));
            }
            *remaining -= 1;
        }
        Ok(())
    }
}
impl Shared {
    // @ref LLP 3000.019#3.6 — a fresh WAL snapshot reads the old program during atomic activation.
    // The source is only a connection factory: no transaction, answer or viewer
    // is retained. Identity guards still refuse an obsolete generation.
    pub(super) fn reader(&self) -> Result<(Arc<()>, TimedReader), snapback4_core::RuntimeError> {
        self.acquire_reader(|| loop {
            let start = trace::begin();
            let mut readers = lock(&self.readers);
            trace::waited(start, "readers");
            readers.check_open()?;
            let epoch = readers.epoch.clone();
            let sites = readers.refusal_sites.clone();
            let engine = if let Some(reader) = readers.idle.pop() { reader } else {
                if readers.source.is_none() {
                    return Err(RuntimeError::Store("detached reader unavailable; retry the request after the store is available".into()));
                }
                let Some(factory) = readers.factories.pop() else {
                    let available = readers.available.clone();
                    drop(available.wait(readers).unwrap_or_else(|p| p.into_inner()));
                    continue;
                };
                #[cfg(test)]
                let hook = readers.construction_hook.clone();
                drop(readers);
                let loan = FactoryLoan { shared: self, epoch: epoch.clone(), engine: Some(factory) };
                #[cfg(test)]
                if let Some(hook) = hook { hook(); }
                let opened = loan.engine.as_ref().unwrap().reader();
                drop(loan);
                readers = lock(&self.readers);
                if !Arc::ptr_eq(&epoch, &readers.epoch) { continue; }
                opened?
            };
            return Ok((epoch, TimedReader { engine, refusal_sites: sites, _timing: latency::EngineSpan::new() }));
        })
    }
    pub(super) fn reader_after_handoff(&self) -> Result<(Arc<()>, TimedReader), snapback4_core::RuntimeError> {
        let (epoch, engine, sites) = self.engine.attempt(|engine, shared| {
            let reader = shared.open_reader(engine)?;
            let readers = lock(&shared.readers);
            Ok::<_, snapback4_core::RuntimeError>((readers.epoch.clone(), reader, readers.refusal_sites.clone()))
        })?;
        // The reader crosses the queue; its thread-local timing guard must be
        // created and dropped on the request thread, just as in reader().
        Ok((epoch, TimedReader { engine, refusal_sites: sites, _timing: latency::EngineSpan::new() }))
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
        let _ = engine;
        self.reader().map(|(epoch, reader)| (epoch, reader.into_inner()))
    }
    pub(super) fn replace_readers(&self, engine: &Engine, sites: &dev_refusals::Sites) {
        let prepared = QueryReaders::new(engine, sites);
        lock(&self.readers).replace(prepared);
    }
    // @ref LLP 3000.019#3.6 — repair on existing writer work, outside the reader lock; reads refuse a missing factory.
    pub(super) fn retry_missing_readers(&self, engine: &Engine) {
        #[cfg(test)]
        let hook;
        let (epoch, sites) = {
            let readers = lock(&self.readers);
            if readers.memory || readers.source.is_some() { return; }
            #[cfg(test)]
            { hook = readers.retry_open.clone(); }
            let state = (readers.epoch.clone(), readers.refusal_sites.clone());
            drop(readers);
            state
        };
        let prepared = latency::acquire(|| {
            #[cfg(test)]
            if let Some(hook) = hook { hook(); }
            QueryReaders::new(engine, &sites)
        });
        let mut readers = lock(&self.readers);
        if Arc::ptr_eq(&epoch, &readers.epoch) && readers.source.is_none() {
            readers.source = prepared.source;
            readers.factories = prepared.factories;
            readers.available.notify_all();
        }
    }
    pub(super) fn memory_store(&self) -> bool { lock(&self.readers).memory }

    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — early outcomes share one fresh reader snapshot, with no writer fence.
    pub(super) fn request_snapshot<T: Send + 'static>(&self, admission: session_identity::Admission,
        run: impl FnOnce(&Shared, &Engine, snapback4_core::identity::Capability, &snapback4_core::identity::RequestSnapshot<'_, '_>) -> Result<T, Refusal> + Send + 'static,
    ) -> Result<T, Refusal> {
        self.request_receipt_snapshot(admission,None,run)
    }
    pub(super) fn request_receipt_snapshot<T: Send + 'static>(&self, admission: session_identity::Admission, receipt: Option<(String,String)>,
        run: impl FnOnce(&Shared, &Engine, snapback4_core::identity::Capability, &snapback4_core::identity::RequestSnapshot<'_, '_>) -> Result<T, Refusal> + Send + 'static,
    ) -> Result<T, Refusal> {
        match self.reader() {
            Ok((epoch, reader)) => {
                let result = admission.with_snapshot(self, &reader, receipt.as_ref(), |capability, snapshot| run(self, &reader, capability, snapshot));
                if result.is_ok() { lock(&self.readers).put(&epoch, reader.into_inner()); }
                result
            }
            Err(_) if self.memory_store() => self.engine.attempt(move |engine, shared| admission.with_snapshot(shared, engine, receipt.as_ref(), |capability, snapshot| run(shared, engine, capability, snapshot))),
            Err(error) => Err(error.refusal()),
        }
    }

    // Identity, head and generation are captured from one reader incarnation.
    pub(super) fn read_identity(&self) -> Result<(String, u64, u64), Refusal> {
        match self.reader() {
            Ok((epoch, mut reader)) => {
                let generation = reader.generation();
                let head = response_head(&mut reader).map(|(id, head)| (id, head, generation));
                lock(&self.readers).put(&epoch, reader.into_inner());
                head
            }
            Err(_) if self.memory_store() => {
                self.engine.attempt(|engine, _| {
                    let generation = engine.generation();
                    response_head(engine).map(|(id, head)| (id, head, generation))
                })
            }
            Err(error) => Err(error.refusal()),
        }
    }

    pub(super) fn read_head(&self) -> Result<(String, u64), Refusal> {
        match self.reader() {
            Ok((epoch, mut reader)) => {
                let head = response_head(&mut reader);
                lock(&self.readers).put(&epoch, reader.into_inner());
                head
            }
            Err(_) if self.memory_store() => self.engine.attempt(|engine, _| response_head(engine)),
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
            snapback4_core::ids::mint(snapback4_core::now_ms(), &mut snapback4_core::ids::Mint::default())
                .map_err(|e| e.to_string())?;
        let path =
            std::env::temp_dir().join(format!("snapback4-fresh-{}-{id}", std::process::id()));
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        let owned = Self(path);
        snapback4_core::private_fs::directory(&owned.0).map_err(|e| e.to_string())?;
        Ok(owned)
    }
    pub(super) fn path(&self) -> std::path::PathBuf { self.0.join("store.db") }
    pub(super) fn store(&self) -> Result<snapback4_core::store_port::AnyStore, snapback4_core::RuntimeError> {
        snapback4_core::store_port::AnyStore::open(&self.0.join("store.db"))
    }
}
impl Drop for FreshDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// Ownership ends on return to the pool or on an error/drop (including sync).
pub(super) struct TimedReader { engine: Engine, pub(super) refusal_sites: Arc<dev_refusals::Sites>, _timing: latency::EngineSpan }
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
