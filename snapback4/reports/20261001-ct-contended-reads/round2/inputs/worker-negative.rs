mod thread_priority { pub fn request() {} }
mod request_workers {
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
    use std::sync::mpsc;
    use std::time::Duration;

    fn queued_request_is_refused_on_exit(partial: bool) {
        let workers = Workers::default();
        let (release_a, blocked_a) = mpsc::channel::<()>();
        if partial {
            let (started, waiting) = mpsc::channel();
            workers.submit(2, thread::Builder::new(), Box::new(move || {
                started.send(()).unwrap();
                let _ = blocked_a.recv();
            })).unwrap();
            waiting.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        // Hold B outside the job's catch boundary with its slot still live.
        struct Payload { entered: mpsc::Sender<()>, release: mpsc::Receiver<()> }
        impl Drop for Payload {
            fn drop(&mut self) {
                self.entered.send(()).unwrap();
                let _ = self.release.recv();
                panic!("worker B exits from payload destructor");
            }
        }
        let (entered, waiting) = mpsc::channel();
        let (release_b, release) = mpsc::channel();
        let limit = if partial { 2 } else { 1 };
        workers.submit(limit, thread::Builder::new(), Box::new(move || {
            std::panic::panic_any(Payload { entered, release });
        })).unwrap();
        waiting.recv_timeout(Duration::from_secs(5)).unwrap();
        struct Pending(mpsc::Sender<bool>);
        impl Drop for Pending {
            fn drop(&mut self) { let _ = self.0.send(false); }
        }
        let (send, outcome) = mpsc::channel();
        let pending = Pending(send);
        workers.submit(limit, thread::Builder::new(), Box::new(move || {
            pending.0.send(true).unwrap();
            drop(pending);
        })).unwrap();
        {
            let state = workers.0.state.lock().unwrap();
            assert_eq!((state.threads, state.idle, state.jobs.len()), (limit, 0, 1));
        }
        release_b.send(()).unwrap();
        assert!(!outcome.recv_timeout(Duration::from_secs(5)).expect("queued request stranded"));
        assert!(workers.0.state.lock().unwrap().jobs.is_empty());
        // No release of A and no further submit was needed for the refusal.
        drop(release_a);
    }
    #[test]
    fn partial_worker_exit_refuses_queued_requests_while_another_worker_is_blocked() {
        queued_request_is_refused_on_exit(true);
    }
    #[test]
    fn last_worker_exit_refuses_queued_requests() {
        queued_request_is_refused_on_exit(false);
    }
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

}