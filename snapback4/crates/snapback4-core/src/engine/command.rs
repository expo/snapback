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
}
impl<T> Command<T> {
    pub fn new(body: impl FnOnce(&mut Engine) -> T + Send + 'static) -> Self {
        Self {
            body: Box::new(body),
        }
    }
    pub fn execute_on(self, engine: &mut Engine) -> T {
        (self.body)(engine)
    }
}

type Work = Box<dyn FnOnce(&mut Engine) + Send>;

/// A disconnected worker never retries a command: its durable outcome may be unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitError {
    Full,
    Stopped,
    OwnershipLost,
}

pub struct Reply<T>(mpsc::Receiver<Result<thread::Result<T>, SubmitError>>);
impl<T> Reply<T> {
    pub fn wait(self) -> Result<T, SubmitError> {
        match self.0.recv().map_err(|_| SubmitError::Stopped)?? {
            Ok(value) => Ok(value),
            Err(panic) => std::panic::resume_unwind(panic),
        }
    }
}

/// FIFO bounded mailbox. Every work item retains the existing single-member
/// commits, including follow-on members and their synchronous continuations.
pub struct Queue {
    sender: Option<mpsc::SyncSender<Work>>,
    worker: Option<thread::JoinHandle<()>>,
    admission: Arc<Mutex<Admission>>,
    #[cfg(feature = "postgres")]
    lease: Option<LeaseRenewal>,
}
#[derive(Default)]
struct Admission {
    lost: bool,
    next: u64,
    waiting: BTreeMap<u64, Box<dyn FnOnce() + Send>>,
}
struct Ticket {
    admission: Arc<Mutex<Admission>>,
    id: u64,
}
impl Ticket {
    fn begin(&self) -> bool {
        let mut state = self.admission.lock().unwrap();
        state.waiting.remove(&self.id);
        !state.lost
    }
}
impl Drop for Ticket {
    fn drop(&mut self) {
        self.admission.lock().unwrap().waiting.remove(&self.id);
    }
}
impl Queue {
    pub fn start(mut engine: Engine, capacity: usize) -> std::io::Result<Self> {
        Self::start_with(capacity, move |work| work(&mut engine))
    }
    /// Hosts with additional execution instrumentation may supply worker state.
    pub fn start_with(
        capacity: usize,
        mut execute: impl FnMut(Work) + Send + 'static,
    ) -> std::io::Result<Self> {
        assert!(capacity > 0);
        let (sender, receiver) = mpsc::sync_channel::<Work>(capacity);
        let worker = thread::Builder::new()
            .name("snapback4-committer".into())
            .spawn(move || {
                while let Ok(work) = receiver.recv() {
                    execute(work);
                }
            })?;
        Ok(Self {
            sender: Some(sender),
            worker: Some(worker),
            admission: Arc::new(Mutex::new(Admission::default())),
            #[cfg(feature = "postgres")]
            lease: None,
        })
    }
    fn work<T: Send + 'static>(
        &self,
        command: Command<T>,
    ) -> Result<(Work, Reply<T>), SubmitError> {
        let (sent, reply) = mpsc::sync_channel(1);
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
                    let _ = refused.send(Err(SubmitError::OwnershipLost));
                }),
            );
            Ticket {
                admission: self.admission.clone(),
                id,
            }
        };
        let work = Box::new(move |engine: &mut Engine| {
            // @ref LLP 3000.009.001.000#5.1 — loss is terminal for this writer; drain every queued acknowledgement without executing its body.
            // begin and lease loss share one lock: running work keeps its real
            // outcome, while all waiting replies can be refused independently
            // of a blocked, uncancellable COMMIT on the writer thread.
            if !ticket.begin() {
                return;
            }
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                command.execute_on(engine)
            }));
            // A lost submitter does not cancel an admitted write or its continuation.
            let _ = sent.send(Ok(result));
        });
        Ok((work, Reply(reply)))
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
        Ok(reply)
    }
    /// Control work is already bounded by host admission; it waits for mailbox
    /// space. HTTP durable members use `submit` to refuse a full mailbox.
    pub fn call<T: Send + 'static>(&self, command: Command<T>) -> Result<T, SubmitError> {
        self.check_admission()?;
        let (mut work, reply) = self.work(command)?;
        let sender = self.sender.as_ref().ok_or(SubmitError::Stopped)?;
        loop {
            self.check_admission()?;
            match sender.try_send(work) {
                Ok(()) => break,
                Err(mpsc::TrySendError::Disconnected(_)) => return Err(SubmitError::Stopped),
                Err(mpsc::TrySendError::Full(pending)) => {
                    work = pending;
                    // A blocking SyncSender::send could remain parked forever
                    // behind an unknown COMMIT after ownership has been lost.
                    thread::park_timeout(std::time::Duration::from_millis(1));
                }
            }
        }
        reply.wait()
    }
    fn check_admission(&self) -> Result<(), SubmitError> {
        if self.ownership_lost() {
            Err(SubmitError::OwnershipLost)
        } else {
            Ok(())
        }
    }
    pub fn ownership_lost(&self) -> bool {
        self.admission.lock().unwrap().lost
    }

    /// Attach the already acquired lease before exposing the host's listener.
    /// The engine must have been opened with `AnyStore::open_postgres_owned`.
    /// Cadence must be shorter than the configured lease. Renewal has its own
    /// connection and thread, and continues until accepted work has drained.
    #[cfg(feature = "postgres")]
    pub fn hold_lease(
        &mut self,
        mut lease: crate::store_port::StoreLease,
        cadence: std::time::Duration,
    ) -> Result<(), crate::RuntimeError> {
        if self.lease.is_some() || cadence.is_zero() || lease.token().is_none() {
            return Err(crate::RuntimeError::StoreOwnership(
                "queue needs one acquired lease and a positive renewal cadence".into(),
            ));
        }
        if !lease.renew()? {
            return Err(crate::RuntimeError::StoreOwnership(
                "ownership lost before listener admission".into(),
            ));
        }
        let admission = self.admission.clone();
        let (stop, stopping) = mpsc::channel();
        // @ref LLP 3000.009.001.000.000#3.1 — renewal bypasses the stream, even while the writer is busy or COMMIT is waiting.
        let worker = thread::Builder::new()
            .name("snapback4-store-lease".into())
            .spawn(move || {
                loop {
                    match stopping.recv_timeout(cadence) {
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if !matches!(lease.renew(), Ok(true)) {
                                let waiting = {
                                    let mut state = admission.lock().unwrap();
                                    state.lost = true;
                                    std::mem::take(&mut state.waiting)
                                };
                                for refuse in waiting.into_values() {
                                    refuse();
                                }
                                break;
                            }
                        }
                        _ => {
                            let _ = lease.release();
                            break;
                        }
                    }
                }
            })
            .map_err(|error| crate::RuntimeError::Store(error.to_string()))?;
        self.lease = Some(LeaseRenewal {
            stop,
            worker: Some(worker),
        });
        Ok(())
    }
}

#[cfg(feature = "postgres")]
struct LeaseRenewal {
    stop: mpsc::Sender<()>,
    worker: Option<thread::JoinHandle<()>>,
}
#[cfg(feature = "postgres")]
impl Drop for LeaseRenewal {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
impl Drop for Queue {
    fn drop(&mut self) {
        drop(self.sender.take());
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
