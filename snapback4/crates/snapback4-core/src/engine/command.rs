//! Owned engine work. The worker supplies state; commands cannot borrow a caller.
use super::Engine;
use std::{sync::mpsc, thread};

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
    pub fn execute(self, engine: &mut Engine) -> T {
        (self.body)(engine)
    }
}

type Work = Box<dyn FnOnce(&mut Engine) + Send>;

/// A disconnected worker never retries a command: its durable outcome may be unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitError {
    Full,
    Stopped,
}

pub struct Reply<T>(mpsc::Receiver<thread::Result<T>>);
impl<T> Reply<T> {
    pub fn wait(self) -> Result<T, SubmitError> {
        match self.0.recv().map_err(|_| SubmitError::Stopped)? {
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
        })
    }
    fn work<T: Send + 'static>(command: Command<T>) -> (Work, Reply<T>) {
        let (sent, reply) = mpsc::sync_channel(1);
        let work = Box::new(move |engine: &mut Engine| {
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| command.execute(engine)));
            // A lost submitter does not cancel an admitted write or its continuation.
            let _ = sent.send(result);
        });
        (work, Reply(reply))
    }
    pub fn submit<T: Send + 'static>(&self, command: Command<T>) -> Result<Reply<T>, SubmitError> {
        let (work, reply) = Self::work(command);
        self.sender
            .as_ref()
            .ok_or(SubmitError::Stopped)?
            .try_send(work)
            .map_err(|e| match e {
                mpsc::TrySendError::Full(_) => SubmitError::Full,
                mpsc::TrySendError::Disconnected(_) => SubmitError::Stopped,
            })?;
        Ok(reply)
    }
    /// Control work is already bounded by host admission; it waits for mailbox
    /// space. HTTP durable members use `submit` to refuse a full mailbox.
    pub fn call<T: Send + 'static>(&self, command: Command<T>) -> Result<T, SubmitError> {
        let (work, reply) = Self::work(command);
        self.sender
            .as_ref()
            .ok_or(SubmitError::Stopped)?
            .send(work)
            .map_err(|_| SubmitError::Stopped)?;
        reply.wait()
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
