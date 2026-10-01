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
                crate::thread_priority::request();
                loop {
                    let job = {
                        let mut state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
                        state.idle += 1;
                        while state.jobs.is_empty() && !state.stopping {
                            state = inner.ready.wait(state).unwrap_or_else(|e| e.into_inner());
                        }
                        state.idle -= 1;
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
