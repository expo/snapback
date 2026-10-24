//! Persistent execution behind (never instead of) RequestAdmission.
use std::{collections::VecDeque, sync::{Arc, Condvar, Mutex}, thread, time::Instant};

type Job = Box<dyn FnOnce() + Send + 'static>;
struct Queued { job: Job, deadline: Option<Instant> }
#[derive(Default)]
struct State { jobs: VecDeque<Queued>, threads: usize, idle: usize, stopping: bool, expiring: bool }
#[derive(Default)]
struct Inner { state: Mutex<State>, ready: Condvar, deadlines: Condvar }
#[derive(Default)]
pub(super) struct Workers(Arc<Inner>);

pub(super) fn deadline(request: &super::Request, age: std::time::Duration) -> Instant {
    let intake = request.accepted_at() + age;
    request.body_deadline().map_or(intake, |body| body.min(intake))
}

impl Workers {
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — queued work retains its intake deadline and opens no snapshot before execution.
    #[cfg(test)]
    pub(super) fn submit(&self, limit: usize, builder: thread::Builder, job: Job) -> std::io::Result<()> {
        self.submit_until(limit, builder, None, job)
    }
    pub(super) fn submit_until(&self, limit: usize, builder: thread::Builder, deadline: Option<Instant>, job: Job) -> std::io::Result<()> {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        if deadline.is_some() && !state.expiring {
            let inner = self.0.clone();
            thread::Builder::new().name("request-deadlines".into()).spawn(move || expire(inner))?;
            state.expiring = true;
        }
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
                        // Healthy workers retain FIFO work after a peer exits.
                        // The independent expiry thread still bounds requests
                        // while every surviving worker is blocked. If none
                        // survive, refuse immediately rather than strand work.
                        let abandoned = if state.threads == 0 { std::mem::take(&mut state.jobs) } else { VecDeque::new() };
                        drop(state);
                        self.inner.ready.notify_one();
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
                    if job.deadline.is_some_and(|at| Instant::now() >= at) { drop(job); continue; }
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job.job));
                }
            })?;
            state.threads += 1;
        }
        state.jobs.push_back(Queued { job, deadline });
        self.0.ready.notify_one();
        self.0.deadlines.notify_one();
        Ok(())
    }
}
impl Drop for Workers {
    fn drop(&mut self) {
        self.0.state.lock().unwrap_or_else(|e| e.into_inner()).stopping = true;
        self.0.ready.notify_all();
        self.0.deadlines.notify_all();
    }
}

// Queue expiry cannot depend on a request worker making progress. This one
// timer per timed pool owns no DB connection and drops/refuses outside the
// queue lock, preserving admission permits and the original body deadline.
fn expire(inner: Arc<Inner>) {
    let mut state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        if state.stopping { return; }
        let now = Instant::now();
        let (expired, live): (VecDeque<_>, VecDeque<_>) = std::mem::take(&mut state.jobs)
            .into_iter().partition(|job| job.deadline.is_some_and(|at| now >= at));
        state.jobs = live;
        if !expired.is_empty() {
            drop(state);
            drop(expired);
            state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
            continue;
        }
        let next = state.jobs.iter().filter_map(|job| job.deadline).min();
        state = if let Some(at) = next {
            inner.deadlines.wait_timeout(state, at.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|e| e.into_inner()).0
        } else {
            inner.deadlines.wait(state).unwrap_or_else(|e| e.into_inner())
        };
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
        if partial {
            assert!(outcome.recv_timeout(Duration::from_millis(100)).is_err(), "one worker exit discarded another worker's queue");
            release_a.send(()).unwrap();
            assert!(outcome.recv_timeout(Duration::from_secs(5)).expect("queued request stranded"));
        } else {
            assert!(!outcome.recv_timeout(Duration::from_secs(5)).expect("queued request stranded"));
        }
        assert!(workers.0.state.lock().unwrap().jobs.is_empty());
        drop(release_a);
    }
    #[test]
    fn g4a_fix1_partial_worker_exit_preserves_the_queue_for_healthy_workers() {
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
