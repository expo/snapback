//! Owned engine work. The worker supplies state; commands cannot borrow a caller.
use super::Engine;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, mpsc},
    thread,
};

// @ref LLP 3000.009.001.000.000#3.7 — owned commands execute against the worker's engine; existing member drivers retain transaction custody.
/// Work cannot capture a caller's borrowed engine.
/// ```compile_fail
/// use snapback4_core::{Engine, engine::command::Command};
/// fn borrowed(engine: &mut Engine) {
///     let _ = Command::new(move |_worker| engine.seq());
/// }
/// ```
pub struct Command<T> {
    body: Box<dyn FnOnce(&mut Engine) -> T + Send + 'static>,
    #[cfg(any(test, feature = "test-support"))]
    attribution: Option<crate::round_trips::Handle>,
}
impl<T> Command<T> {
    pub fn new(body: impl FnOnce(&mut Engine) -> T + Send + 'static) -> Self {
        Self {
            body: Box::new(body),
            #[cfg(any(test, feature = "test-support"))]
            attribution: None,
        }
    }
    pub fn execute_on(self, engine: &mut Engine) -> T {
        // @ref LLP 3000.009.001.000.001#5 — carry only the submitting request's counts across the queue, including its synchronous continuation.
        #[cfg(any(test, feature = "test-support"))]
        let _attribution = self.attribution.map(crate::round_trips::Handle::enter);
        (self.body)(engine)
    }
}

type Work = Box<dyn FnOnce(&mut Engine) + Send>;
#[path = "command_batch.rs"]
mod batching;
pub use batching::{ProgramCommand, BatchStats, BatchPolicy};
use batching::{Queued, ProgramTask};

/// A disconnected worker never retries a command: its durable outcome may be unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitError {
    Full,
    /// This queue's sole consumer cannot wait for another command on itself.
    Reentrant,
    /// Worker disconnected before execution; the command was not applied.
    Stopped,
    /// Worker disconnected after execution started; reconcile the durable outcome.
    OutcomeUnknown,
    OwnershipLost,
}

type Terminal<T> = Result<thread::Result<T>, SubmitError>;

// @ref LLP 3000.009.001.000.000.002#4.4 — ownership refusal, pause rejection and actual results share one terminal claim.
struct Completion<T>(Arc<Mutex<Option<mpsc::SyncSender<Terminal<T>>>>>);
impl<T> Clone for Completion<T> {
    fn clone(&self) -> Self { Self(self.0.clone()) }
}
impl<T> Completion<T> {
    fn new(sender: mpsc::SyncSender<Terminal<T>>) -> Self {
        Self(Arc::new(Mutex::new(Some(sender))))
    }
    fn complete(&self, outcome: Terminal<T>) -> bool {
        // Taking the only sender arbitrates even after the receiver consumes
        // the first outcome. Never hold admission or the worker on a send.
        let sender = self.0.lock().unwrap().take();
        if let Some(sender) = sender {
            let _ = sender.try_send(outcome);
            true
        } else {
            false
        }
    }
}

pub struct Reply<T> {
    receiver: mpsc::Receiver<Result<thread::Result<T>, SubmitError>>,
    started: Arc<std::sync::atomic::AtomicBool>,
}
pub const ADMISSION_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);
impl<T> Reply<T> {
    pub fn wait(self) -> Result<T, SubmitError> {
        // Admission has a deadline; execution does not. A slow successful COMMIT
        // must deliver its real result, never a manufactured unknown outcome.
        let result = self.receiver.recv().map_err(|_| {
            if self.started.load(std::sync::atomic::Ordering::Acquire) {
                SubmitError::OutcomeUnknown
            } else {
                SubmitError::Stopped
            }
        })??;
        match result {
            Ok(value) => Ok(value),
            Err(panic) => std::panic::resume_unwind(panic),
        }
    }
}

/// FIFO bounded mailbox. Typed program commands may group; every other command
/// retains its solo commits and synchronous continuations.
pub struct Queue {
    sender: Option<mpsc::SyncSender<Queued>>,
    notice: Arc<notice::Notice>,
    worker: Option<thread::JoinHandle<()>>,
    admission: Arc<Mutex<Admission>>,
    batching: Arc<Mutex<BatchStats>>,
    #[cfg(feature = "postgres")]
    lease: Option<LeaseRenewal>,
}
#[derive(Default)]
struct Admission {
    lost: bool,
    #[cfg(feature="postgres")]
    grant: Option<Arc<super::postgres::read_grant::Grant>>,
    #[cfg(feature = "postgres")]
    deadline: Option<crate::store_port::LeaseDeadline>,
    next: u64,
    waiting: BTreeMap<u64, Box<dyn FnOnce() + Send>>,
}
struct Ticket {
    admission: Arc<Mutex<Admission>>,
    id: u64,
    started: Arc<std::sync::atomic::AtomicBool>,
}
impl Ticket {
    fn start_execution(&self, engine:&Engine) -> bool {
        #[cfg(feature="postgres")] {self.admission.lock().unwrap().grant=engine.store.read_grant();}
        #[cfg(not(feature="postgres"))] let _=engine;
        latch_expired(&self.admission);
        let mut state = self.admission.lock().unwrap();
        let pending=state.waiting.remove(&self.id);
        if state.lost || admission_uncertain(&state) {drop(state);if let Some(refuse)=pending {refuse();}return false;}
        self.started.store(true, std::sync::atomic::Ordering::Release);
        true
    }
}
impl Drop for Ticket {
    fn drop(&mut self) {
        self.admission.lock().unwrap().waiting.remove(&self.id);
    }
}
impl Queue {
    pub fn start(mut engine: Engine, capacity: usize) -> std::io::Result<Self> {
        #[cfg(feature="postgres")] let grant=engine.store.read_grant();
        let queue=Self::start_with(capacity, move |work| work(&mut engine))?;
        #[cfg(feature="postgres")] {queue.admission.lock().unwrap().grant=grant;}
        Ok(queue)
    }
    /// Hosts with additional execution instrumentation may supply worker state.
    pub fn start_with(
        capacity: usize,
        execute: impl FnMut(Work) + Send + 'static,
    ) -> std::io::Result<Self> {
        Self::start_with_policy(capacity, execute, BatchPolicy::Adaptive)
    }
    fn start_with_policy(capacity: usize, execute: impl FnMut(Work) + Send + 'static, policy: BatchPolicy) -> std::io::Result<Self> {
        Self::start_policy_depth(capacity,execute,policy,2)
    }
    fn start_policy_depth(capacity: usize, execute: impl FnMut(Work) + Send + 'static, policy: BatchPolicy, depth:usize) -> std::io::Result<Self> {
        assert!(capacity > 0);
        let (sender, receiver) = mpsc::sync_channel::<Queued>(capacity);
        let batching = Arc::new(Mutex::new(BatchStats::new(policy)));
        let stats = batching.clone();
        let admission = Arc::new(Mutex::new(Admission::default()));
        let worker_admission = admission.clone();
        let notice=Arc::new(notice::Notice::default());
        let worker_notice=notice.clone();
        let worker = thread::Builder::new().name("snapback4-committer".into())
            .spawn(move || batching::run(receiver, execute, stats, depth, worker_admission, worker_notice))?;
        Ok(Self { notice, sender:Some(sender), worker:Some(worker), admission, batching,
            #[cfg(feature="postgres")] lease:None })
    }
    /// Controlled N=1/4/16/32 witnesses use the same queue and transaction path.
    #[cfg(any(test, feature="test-support"))]
    pub fn start_fixed(mut engine: Engine, capacity: usize, n: usize) -> std::io::Result<Self> {
        Self::start_with_policy(capacity, move |work|work(&mut engine), BatchPolicy::Fixed(n))
    }
    #[cfg(any(test,feature="test-support"))]
    pub fn start_fixed_depth(mut engine: Engine, capacity:usize,n:usize,depth:usize)->std::io::Result<Self> {
        assert!((1..=2).contains(&depth));
        Self::start_policy_depth(capacity,move|work|work(&mut engine),BatchPolicy::Fixed(n),depth)
    }
    pub fn batch_stats(&self) -> BatchStats { self.batching.lock().unwrap().clone() }

    fn work<T: Send + 'static>(
        &self,
        command: Command<T>,
    ) -> Result<(Queued, Reply<T>), SubmitError> {
        debug_assert!(!self.on_worker(), "committer commands must use inline continuations");
        #[cfg(any(test, feature = "test-support"))]
        let command = Command {
            attribution: crate::round_trips::current(),
            ..command
        };
        let (sent, receiver) = mpsc::sync_channel(1);
        let sent = Completion::new(sent);
        let started = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let ticket = {
            let mut state = self.admission.lock().unwrap();
            if state.lost {
                return Err(SubmitError::OwnershipLost);
            }
            let id = state.next;
            state.next = state.next.wrapping_add(1);
            let refused = sent.clone();
            state.waiting.insert(
                id,
                Box::new(move || {
                    refused.complete(Err(SubmitError::OwnershipLost));
                }),
            );
            Ticket {
                admission: self.admission.clone(),
                id,
                started: started.clone(),
            }
        };
        let unknown = sent.clone();
        let work = Box::new(move |engine: &mut Engine| {
            // @ref LLP 3000.009.001.000#5.1 — loss is terminal for this writer; drain every queued acknowledgement without executing its body.
            // Command start and lease loss share one lock: running work keeps its real
            // outcome, while all waiting replies can be refused independently
            // of a blocked, uncancellable COMMIT on the writer thread.
            if !ticket.start_execution(engine) {
                return;
            }
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                command.execute_on(engine)
            }));
            // A lost submitter does not cancel an admitted write or its continuation.
            sent.complete(Ok(result));
        });
        Ok((Queued::Solo(work, Box::new(move || { unknown.complete(Err(SubmitError::OutcomeUnknown)); })), Reply { receiver, started }))
    }
    pub fn submit_program<T: Send + 'static>(&self, command: ProgramCommand<T>) -> Result<Reply<T>, SubmitError> {
        self.check_admission()?;
        let (sent, receiver) = mpsc::sync_channel(1);
        let sent = Completion::new(sent);
        let started = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let ticket = {
            let mut state = self.admission.lock().unwrap();
            if state.lost { return Err(SubmitError::OwnershipLost); }
            let id = state.next; state.next = state.next.wrapping_add(1);
            let refused = sent.clone();
            state.waiting.insert(id, Box::new(move ||{ refused.complete(Err(SubmitError::OwnershipLost)); }));
            Ticket { admission:self.admission.clone(), id, started:started.clone() }
        };
        let task = ProgramTask::new(command, sent, ticket);
        self.sender.as_ref().ok_or(SubmitError::Stopped)?.try_send(Queued::Program(Box::new(task)))
            .map_err(|error| match error { mpsc::TrySendError::Full(_) => self.check_admission().err().unwrap_or(SubmitError::Full), mpsc::TrySendError::Disconnected(_) => SubmitError::Stopped })?;
        self.notice.notify();
        Ok(Reply { receiver, started })
    }
    pub fn submit<T: Send + 'static>(&self, command: Command<T>) -> Result<Reply<T>, SubmitError> {
        self.check_admission()?;
        let (work, reply) = self.work(command)?;
        self.sender
            .as_ref()
            .ok_or(SubmitError::Stopped)?
            .try_send(work)
            .map_err(|e| match e {
                mpsc::TrySendError::Full(_) => {
                    self.check_admission().err().unwrap_or(SubmitError::Full)
                }
                mpsc::TrySendError::Disconnected(_) => SubmitError::Stopped,
            })?;
        self.notice.notify();
        Ok(reply)
    }
    /// Control work waits at most 100 ms for space (one short scheduling burst).
    /// HTTP durable members use `submit` to refuse a full mailbox immediately.
    pub fn call<T: Send + 'static>(&self, command: Command<T>) -> Result<T, SubmitError> {
        self.check_admission()?;
        let (mut work, reply) = self.work(command)?;
        let sender = self.sender.as_ref().ok_or(SubmitError::Stopped)?;
        let deadline = std::time::Instant::now() + ADMISSION_TIMEOUT;
        loop {
            self.check_admission()?;
            if std::time::Instant::now() >= deadline {
                return Err(SubmitError::Full);
            }
            match sender.try_send(work) {
                Ok(()) => break,
                Err(mpsc::TrySendError::Disconnected(_)) => return Err(SubmitError::Stopped),
                Err(mpsc::TrySendError::Full(pending)) => {
                    if std::time::Instant::now() >= deadline {
                        return Err(SubmitError::Full);
                    }
                    work = pending;
                    // A blocking SyncSender::send could remain parked forever
                    // behind an unknown COMMIT after ownership has been lost.
                    thread::park_timeout(std::time::Duration::from_millis(1));
                }
            }
        }
        self.notice.notify();
        reply.wait()
    }
    fn check_admission(&self) -> Result<(), SubmitError> {
        // @ref LLP 3000.009.001.000.000#9 — continuations run inline; neither submission door may enqueue onto its own consumer.
        if self.on_worker() {
            return Err(SubmitError::Reentrant);
        }
        if self.ownership_lost() || admission_uncertain(&self.admission.lock().unwrap()) {
            Err(SubmitError::OwnershipLost)
        } else {
            Ok(())
        }
    }
    fn on_worker(&self) -> bool {
        self.worker.as_ref().is_some_and(|worker| worker.thread().id() == thread::current().id())
    }
    pub fn ownership_lost(&self) -> bool {
        latch_expired(&self.admission);
        self.admission.lock().unwrap().lost
    }

    /// Terminal loss arbitrates queued command start and drains acknowledgements
    /// independently of an active writer or a blocked renewal COMMIT.
    pub fn refuse_ownership(&self) {
        lose_ownership(&self.admission);
    }

    /// Attach the acquired lease before exposing the listener. Keep startup
    /// release custody across every fallible step, including thread creation.
    #[cfg(feature = "postgres")]
    pub fn hold_lease(
        &mut self,
        lease: crate::store_port::StoreLease,
        cadence: std::time::Duration,
    ) -> Result<(), crate::RuntimeError> {
        let mut guard = StartupLease(Some(lease));
        let lease = guard.0.as_mut().unwrap();
        self.admission.lock().unwrap().grant=Some(lease.read_grant.clone());
        if self.lease.is_some() || cadence.is_zero() || lease.token().is_none() {
            return Err(crate::RuntimeError::StoreOwnership(
                "queue needs one acquired lease and a positive renewal cadence".into(),
            ));
        }
        let started = std::time::Instant::now();
        let deadline = crate::store_port::LeaseDeadline::new(lease.lease_duration(), started);
        if !lease.renew()? || deadline.expired() {
            return Err(crate::RuntimeError::StoreOwnership(
                "ownership lost before listener admission".into(),
            ));
        }
        self.admission.lock().unwrap().deadline = Some(deadline.clone());
        let admission = self.admission.clone();
        let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watching = finished.clone();
        let renewed = deadline.clone();
        let (stop, stopping) = mpsc::channel();
        // @ref LLP 3000.009.001.000.000#3.1 — the watchdog never locks the
        // lease connection; even renewal's uncancellable COMMIT cannot park it.
        let watchdog = thread::Builder::new()
            .name("store-lease-deadline".into())
            .spawn(move || {
                while !watching.load(std::sync::atomic::Ordering::Acquire) {
                    if deadline.expired() {
                        lose_ownership(&admission);
                        break;
                    }
                    thread::park_timeout(deadline.remaining().min(std::time::Duration::from_millis(10)));
                }
            })
            .map_err(|error| crate::RuntimeError::Store(error.to_string()))?;
        let mut renewal = LeaseRenewal {
            stop,
            worker: None,
            watchdog: Some(watchdog),
            finished,
        };
        let admission = self.admission.clone();
        renewal.worker = Some(
            thread::Builder::new()
                .name("snapback4-store-lease".into())
                .spawn(move || {
                    loop {
                        match stopping.recv_timeout(cadence) {
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                let started = std::time::Instant::now();
                                if !matches!(guard.0.as_mut().unwrap().renew(), Ok(true))
                                    || !renewed.renewed(started)
                                {
                                    lose_ownership(&admission);
                                    // Live serving work keeps its SQL fence; leave
                                    // expiry/recovery to the store after loss.
                                    guard.0.take();
                                    break;
                                }
                            }
                            _ => break, // guard releases only after accepted work drains
                        }
                    }
                })
                .map_err(|error| crate::RuntimeError::Store(error.to_string()))?,
        );
        self.lease = Some(renewal);
        Ok(())
    }
}
fn admission_uncertain(state:&Admission)->bool {
    #[cfg(feature="postgres")] {state.grant.as_ref().is_some_and(|g|g.uncertain.load(std::sync::atomic::Ordering::Acquire))}
    #[cfg(not(feature="postgres"))] {let _=state;false}
}
fn latch_expired(admission: &Mutex<Admission>) {
    #[cfg(feature = "postgres")]
    {
        let deadline = admission.lock().unwrap().deadline.clone();
        if deadline.is_some_and(|deadline| deadline.expired()) {
            lose_ownership(admission);
        }
    }
    #[cfg(not(feature = "postgres"))]
    let _ = admission;
}
fn lose_ownership(admission: &Mutex<Admission>) {
    let waiting = {
        let mut state = admission.lock().unwrap();
        state.lost = true;
        std::mem::take(&mut state.waiting)
    };
    for refuse in waiting.into_values() {
        refuse();
    }
}
#[cfg(feature = "postgres")]
struct StartupLease(Option<crate::store_port::StoreLease>);
#[cfg(feature = "postgres")]
impl Drop for StartupLease {
    fn drop(&mut self) {
        if let Some(lease) = &mut self.0 {
            let _ = lease.release();
        }
    }
}
#[cfg(feature = "postgres")]
struct LeaseRenewal {
    stop: mpsc::Sender<()>,
    worker: Option<thread::JoinHandle<()>>,
    watchdog: Option<thread::JoinHandle<()>>,
    finished: Arc<std::sync::atomic::AtomicBool>,
}
#[cfg(feature = "postgres")]
impl Drop for LeaseRenewal {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        self.finished
            .store(true, std::sync::atomic::Ordering::Release);
        if let Some(watchdog) = self.watchdog.take() {
            let _ = watchdog.join();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for Queue {
    fn drop(&mut self) {
        drop(self.sender.take());
        self.notice.notify();
        if let Some(worker) = self.worker.take() {
            // The last host reference can be released by a finishing command.
            if worker.thread().id() != thread::current().id() {
                let _ = worker.join();
            }
        }
    }
}

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;

#[path = "command_notice.rs"]
mod notice;
