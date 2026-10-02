//! Persistent execution behind (never instead of) RequestAdmission.
use std::{collections::VecDeque, sync::{Arc, Condvar, Mutex}, thread};

type Job = Box<dyn FnOnce() + Send + 'static>;
#[derive(Default)]
struct State { jobs: VecDeque<Job>, threads: usize, idle: usize, stopping: bool }
#[derive(Default)]
struct Inner { state: Mutex<State>, ready: Condvar }
#[derive(Default)]
pub(super) struct Workers(Arc<Inner>);

impl Workers {
    // @ref LLP 3000#contended-read-serving — separate class capacity; no extra admission queue.
    pub(super) fn submit(&self, limit: usize, builder: thread::Builder, job: Job) -> std::io::Result<()> {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.jobs.len() >= state.idle && state.threads < limit {
            let inner = self.0.clone();
            // Spawn before enqueue: failure drops/refuses this request on the
            // dispatcher, including an unfinished body, exactly as before.
            builder.spawn(move || {
                // Account every exit, including panic before/after the job's
                // unwind boundary. A later submit may replace the lost worker.
                struct Exit { inner: Arc<Inner>, idle: bool }
                impl Drop for Exit {
                    fn drop(&mut self) {
                        let mut state = self.inner.state.lock().unwrap_or_else(|e| e.into_inner());
                        state.threads -= 1;
                        if self.idle { state.idle -= 1; }
                        // If the last worker dies while another admitted job
                        // is queued, dropping that job invokes PendingRequest's
                        // ordinary refusal and releases its permit. Do it off
                        // the queue lock; no request waits for a future submit.
                        let abandoned = if state.threads == 0 { std::mem::take(&mut state.jobs) } else { VecDeque::new() };
                        drop(state);
                        drop(abandoned);
                    }
                }
                let mut exit = Exit { inner: inner.clone(), idle: false };
                crate::thread_priority::request();
                loop {
                    let job = {
                        let mut state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
                        state.idle += 1;
                        exit.idle = true;
                        while state.jobs.is_empty() && !state.stopping {
                            state = inner.ready.wait(state).unwrap_or_else(|e| e.into_inner());
                        }
                        state.idle -= 1;
                        exit.idle = false;
                        match state.jobs.pop_front() { Some(job) => job, None => return }
                    };
                    // Debug/unwind builds retain the old per-request panic
                    // isolation. Production's panic=abort policy is unchanged.
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                }
            })?;
            state.threads += 1;
        }
        state.jobs.push_back(job);
        self.0.ready.notify_one();
        Ok(())
    }
}
impl Drop for Workers {
    fn drop(&mut self) {
        self.0.state.lock().unwrap_or_else(|e| e.into_inner()).stopping = true;
        self.0.ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_panic_outside_the_job_boundary_does_not_spend_capacity_forever() {
        // Dropping the caught payload happens outside catch_unwind. This is a
        // real unwind exit, not a call to the accounting guard in isolation.
        struct Payload;
        impl Drop for Payload { fn drop(&mut self) { panic!("payload destructor"); } }
        let workers = Workers::default();
        workers.submit(1, thread::Builder::new(), Box::new(|| std::panic::panic_any(Payload))).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while workers.0.state.lock().unwrap().threads != 0 {
            assert!(std::time::Instant::now() < deadline, "exited worker still occupies capacity");
            thread::yield_now();
        }
        let (send, receive) = std::sync::mpsc::channel();
        workers.submit(1, thread::Builder::new(), Box::new(move || send.send(()).unwrap())).unwrap();
        receive.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
    }
}
