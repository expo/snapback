//! Serving handle for the worker-owned writer. Readers and the ephemeral hub
//! retain their independent owners; only owned work crosses this mailbox.
use super::*;
use snapback4_core::engine::command::{Command, Queue, SubmitError};
use std::sync::{OnceLock, Weak};

const CAPACITY: usize = 128;

pub struct Writer {
    queue: Queue,
    host: OnceLock<Weak<Shared>>,
    queued: Arc<AtomicUsize>,
    last_request: Mutex<Option<Instant>>,
    #[cfg(test)]
    background_pause: Mutex<
        Option<(
            bool,
            std::sync::mpsc::Sender<()>,
            std::sync::mpsc::Receiver<()>,
        )>,
    >,
    #[cfg(test)]
    fixture: Arc<FairMutex<Engine>>,
}
impl Writer {
    pub fn new(engine: Engine) -> std::io::Result<Self> {
        #[cfg(not(test))]
        let queue = Queue::start(engine, CAPACITY)?;
        #[cfg(test)]
        let (queue, fixture) = {
            let fixture = Arc::new(FairMutex::new(engine));
            let state = fixture.clone();
            let queue = Queue::start_with(CAPACITY, move |work| work(&mut lock(&state)))?;
            (queue, fixture)
        };
        Ok(Self {
            queue,
            host: OnceLock::new(),
            queued: Arc::new(AtomicUsize::new(0)),
            last_request: Mutex::new(None),
            #[cfg(test)]
            background_pause: Mutex::new(None),
            #[cfg(test)]
            fixture,
        })
    }
    pub(super) fn bind(&self, host: &Arc<Shared>) {
        let _ = self.host.set(Arc::downgrade(host));
    }
    fn command<T: Send + 'static>(
        &self,
        run: impl FnOnce(&mut Engine, &Shared) -> T + Send + 'static,
    ) -> Command<Execution<T>> {
        let host = self
            .host
            .get()
            .expect("writer bound to serving host")
            .upgrade()
            .expect("live serving host");
        let queued = self.queued.clone();
        queued.fetch_add(1, Ordering::AcqRel);
        struct Ticket(Arc<AtomicUsize>);
        impl Drop for Ticket {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::AcqRel);
            }
        }
        let ticket = Ticket(queued);
        let timing = latency::worker_sample();
        let tracing = trace::worker_sample();
        let evidence = dev_refusals::response::worker_sample();
        Command::new(move |engine| {
            let _ticket = ticket;
            let _scope = crate::release_requests::Scope::begin(engine.generation());
            let (((value, timing), tracing), evidence) =
                dev_refusals::response::run_worker(evidence, || {
                    trace::run_worker(tracing, || {
                        latency::run_worker(timing, || run(engine, &host))
                    })
                });
            Execution {
                value,
                timing,
                tracing,
                evidence,
                generation: crate::release_requests::reply_generation()
                    .unwrap_or(engine.generation()),
            }
        })
    }

    pub(crate) fn call<T: Send + 'static>(
        &self,
        run: impl FnOnce(&mut Engine, &Shared) -> T + Send + 'static,
    ) -> T {
        *lock(&self.last_request) = Some(Instant::now());
        self.queue
            .call(self.command(run))
            .expect("committer stopped before acknowledgement")
            .finish()
    }
    pub(crate) fn submit<T: Send + 'static>(
        &self,
        run: impl FnOnce(&mut Engine, &Shared) -> T + Send + 'static,
    ) -> Result<T, Refusal> {
        *lock(&self.last_request) = Some(Instant::now());
        self.queue
            .submit(self.command(run))
            .and_then(|reply| reply.wait())
            .map(Execution::finish)
            .map_err(|error| {
                latency::merge_worker(None);
                queue_error(error).refusal()
            })
    }
    pub(crate) fn attempt<T: QueueResult + Send + 'static>(
        &self,
        run: impl FnOnce(&mut Engine, &Shared) -> T + Send + 'static,
    ) -> T {
        match self.submit(run) {
            Ok(value) => value,
            Err(why) => T::refused(why),
        }
    }
    pub(crate) fn background_call<T: QueueResult + Send + 'static>(
        &self,
        run: impl FnOnce(&mut Engine, &Shared, bool) -> T + Send + 'static,
    ) -> T {
        #[cfg(test)]
        let pause = lock(&self.background_pause).take();
        #[cfg(test)]
        if let Some((false, entered, resume)) = &pause {
            entered.send(()).unwrap();
            resume.recv().unwrap();
        }
        let started = Instant::now();
        while self.queued.load(Ordering::Acquire) == 0
            && started.elapsed() < Duration::from_millis(5)
        {
            let quiet = lock(&self.last_request).map_or(Duration::ZERO, |last| {
                Duration::from_millis(1).saturating_sub(last.elapsed())
            });
            if quiet.is_zero() {
                break;
            }
            std::thread::sleep(
                quiet.min(Duration::from_millis(5).saturating_sub(started.elapsed())),
            );
        }
        let contended = self.queued.load(Ordering::Acquire) > 0
            || lock(&self.last_request)
                .is_some_and(|last| last.elapsed() < Duration::from_millis(1));
        let result = self
            .queue
            .submit(self.command(move |engine, shared| {
                #[cfg(test)]
                if let Some((true, entered, resume)) = pause {
                    entered.send(()).unwrap();
                    resume.recv().unwrap();
                }
                run(engine, shared, contended)
            }))
            .and_then(|reply| reply.wait());
        match result {
            Ok(value) => value.finish(),
            Err(error) => {
                latency::merge_worker(None);
                T::refused(queue_error(error).refusal())
            }
        }
    }
    pub fn has_waiters(&self) -> bool {
        self.queued.load(Ordering::Acquire) > 1 || {
            #[cfg(test)]
            {
                self.fixture.has_waiters()
            }
            #[cfg(not(test))]
            {
                false
            }
        }
    }
    // Fixture guards exist only in unit tests. Production has no mutex holding
    // an Engine and no way to lend the writer to request threads.
    #[cfg(test)]
    pub fn lock(&self) -> std::sync::LockResult<engine_lock::FairGuard<'_, Engine>> {
        self.fixture.lock()
    }
    #[cfg(test)]
    pub fn waiting(&self) -> u64 {
        let queued = self.queued.load(Ordering::Acquire) as u64;
        let fixture_waiting = self.fixture.waiting();
        if fixture_waiting > 0 {
            queued + fixture_waiting - u64::from(queued > 0)
        } else {
            queued.saturating_sub(u64::from(self.fixture.queued() > 0))
        }
    }
    #[cfg(test)]
    pub fn queued(&self) -> u64 {
        self.fixture.queued().max(self.waiting() + 1)
    }
    #[cfg(test)]
    pub fn is_poisoned(&self) -> bool {
        self.fixture.is_poisoned()
    }
    #[cfg(test)]
    pub(super) fn pause_next_background(
        &self,
        holding: bool,
    ) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let (entered, observed) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        *lock(&self.background_pause) = Some((holding, entered, resume));
        (observed, release)
    }
}
#[cfg(test)]
impl Lockable for Writer {
    type Guard<'a> = engine_lock::FairGuard<'a, Engine>;
    fn recover_lock(&self) -> Self::Guard<'_> {
        self.fixture.recover_lock()
    }
}

fn queue_error(error: SubmitError) -> snapback4_core::RuntimeError {
    match error {
        SubmitError::Full => snapback4_core::RuntimeError::Structural {
            code: "E_RATE_LIMIT", message: "HTTP connections or request workers are occupied; wait for pending writes to settle or reduce concurrent clients before retrying".into(),
        },
        SubmitError::Stopped => snapback4_core::RuntimeError::Store("committer stopped before acknowledgement; the durable outcome may be unknown".into()),
    }
}
pub(crate) trait QueueResult {
    fn refused(why: Refusal) -> Self;
}
pub(crate) trait QueueError {
    fn refused(why: Refusal) -> Self;
}
impl QueueError for Refusal {
    fn refused(why: Refusal) -> Self {
        why
    }
}
impl QueueError for snapback4_core::RuntimeError {
    fn refused(why: Refusal) -> Self {
        if why.code == "E_RATE_LIMIT" {
            Self::Structural {
                code: "E_RATE_LIMIT",
                message: why.message,
            }
        } else {
            snapback4_core::RuntimeError::Store(why.message)
        }
    }
}
impl QueueError for String {
    fn refused(why: Refusal) -> Self {
        why.to_string()
    }
}
impl QueueError for (u16, Refusal) {
    fn refused(why: Refusal) -> Self {
        (503, why)
    }
}
impl QueueError for (u16, Json) {
    fn refused(why: Refusal) -> Self {
        (503, json!({"denied":why}))
    }
}
impl<T, E: QueueError> QueueResult for Result<T, E> {
    fn refused(why: Refusal) -> Self {
        Err(E::refused(why))
    }
}

struct Execution<T> {
    value: T,
    generation: u64,
    timing: Option<latency::WorkerTiming>,
    tracing: Option<trace::Trace>,
    evidence: Option<dev_refusals::response::WorkerEvidence>,
}
impl<T> Execution<T> {
    // @ref LLP 3000.000.000#93-http-admission-and-reporting — stamp the executing generation before the request encodes its response.
    fn finish(self) -> T {
        crate::release_requests::stamp(self.generation);
        latency::merge_worker(self.timing);
        trace::merge_worker(self.tracing);
        dev_refusals::response::merge_worker(self.evidence);
        self.value
    }
}

impl QueueResult for (u16, String, bool) {
    fn refused(why: Refusal) -> Self {
        (503, json!({"denied":why}).to_string(), false)
    }
}

// A skipped bulk turn is not a completed member; its scheduler remains due.
impl QueueResult for bool {
    fn refused(_: Refusal) -> Self {
        false
    }
}
impl<T> QueueResult for (Result<T, snapback4_core::RuntimeError>, Vec<String>) {
    fn refused(why: Refusal) -> Self {
        (Err(QueueError::refused(why)), Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serve::tests::{Host, body, status};

    #[test]
    fn a_full_mailbox_uses_the_http_overload_refusal_without_running_the_write() {
        let host = Host::with_store(
            true,
            snapback4_core::store_port::AnyStore::memory().unwrap(),
            "use personas alice\ntable rows:\n  n: int\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert rows { n: 1 }\n",
        );
        let (entered, started) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        let held = host
            .shared
            .engine
            .queue
            .submit(Command::new(move |_| {
                entered.send(()).unwrap();
                resume.recv().unwrap();
            }))
            .unwrap();
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        for _ in 0..CAPACITY {
            // Keep the mailbox full without adding a durable member.
            drop(
                host.shared
                    .engine
                    .queue
                    .submit(Command::new(|_| ()))
                    .unwrap(),
            );
        }
        let reply = host.request(
            "POST",
            "/m/add",
            "x-snapback-persona: alice\r\n",
            r#"{"id":"refused","args":{}}"#,
        );
        assert_eq!(status(&reply), 503, "{reply}");
        assert_eq!(body(&reply)["denied"]["code"], "E_RATE_LIMIT");
        assert_eq!(body(&reply)["denied"]["family"], "limit");
        assert_eq!(body(&reply)["denied"]["retryable"], true);
        assert!(reply.to_ascii_lowercase().contains("retry-after: 1\r\n"));
        release.send(()).unwrap();
        held.wait().unwrap();
        assert_eq!(
            host.shared
                .engine
                .call(|engine, _| engine.store().count("rows").unwrap()),
            0
        );
        assert_eq!(host.shared.engine.queued.load(Ordering::Acquire), 0);
    }
}
