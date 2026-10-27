//! Clock-free, demand-driven validation rounds. Only the elected caller uses PG.
// @ref LLP 3000.009.001.000.002#g5-read-index-validation — enrollment closes before sending the statement that certifies a batch.
use super::Stamp;
use std::sync::{Arc, Condvar, Mutex, OnceLock, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Round {
    result: OnceLock<Option<Stamp>>,
}
#[derive(Default)]
struct State {
    pending: Option<Arc<Round>>,
    running: bool,
    waiters: usize,
}
#[derive(Default)]
pub(super) struct ReadIndex {
    pub enabled: AtomicBool,
    state: Mutex<State>,
    changed: Condvar,
    pub rounds: AtomicU64,
    pub reads: AtomicU64,
}
impl ReadIndex {
    #[cfg(test)]
    pub fn pending_for_test(&self) -> bool { self.state.lock().unwrap().pending.is_some() }
    /// Deadlines bound waiting, never the validity of a successful proof. A
    /// cancelled waiter has no custody of the leader's connection or result.
    pub fn validate(&self, deadline: Instant, validate: impl FnOnce() -> Option<Stamp>) -> Option<Stamp> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if state.waiters >= 30 || Instant::now() >= deadline { return None; }
        state.waiters += 1;
        let round = state.pending.get_or_insert_with(Default::default).clone();
        loop {
            if Instant::now() >= deadline {
                state.waiters -= 1;
                return None;
            }
            if let Some(result) = round.result.get() {
                state.waiters -= 1;
                self.reads.fetch_add(1, Ordering::Relaxed);
                return result.clone();
            }
            if !state.running {
                // No result from a statement already sent can enroll a new read.
                assert!(Arc::ptr_eq(state.pending.as_ref().unwrap(), &round));
                state.pending = None;
                state.running = true;
                drop(state);
                // Drop releases the slot and wakes the next round even on unwind.
                struct Leader<'a>(&'a ReadIndex, Arc<Round>);
                impl Drop for Leader<'_> {
                    fn drop(&mut self) {
                        let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
                        let _ = self.1.result.set(None);
                        state.running = false;
                        state.waiters -= 1;
                        self.0.changed.notify_all();
                    }
                }
                let leader = Leader(self, round.clone());
                self.rounds.fetch_add(1, Ordering::Relaxed);
                let result = validate();
                let _ = round.result.set(result.clone());
                self.reads.fetch_add(1, Ordering::Relaxed);
                drop(leader);
                return (Instant::now() < deadline).then_some(result).flatten();
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            state = self.changed.wait_timeout(state, remaining.min(Duration::from_millis(50)))
                .unwrap_or_else(|p| p.into_inner()).0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread};
    fn stamp(revision: i64) -> Stamp {
        Stamp { revision, head: revision as u64, store: "store".into(), generation: 1, schema: "schema".into(), code: "code".into() }
    }
    fn waiters(ri: &ReadIndex, n: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while ri.state.lock().unwrap().waiters != n {
            assert!(Instant::now() < deadline);
            thread::yield_now();
        }
    }
    #[test]
    fn arrival_during_a_flight_needs_next_snapshot_and_coalesces() {
        let ri = Arc::new(ReadIndex::default());
        let (sent, received) = mpsc::channel();
        let (release, held) = mpsc::channel();
        let first = { let ri = ri.clone(); thread::spawn(move || ri.validate(Instant::now()+Duration::from_secs(10), || {
            sent.send(()).unwrap(); held.recv().unwrap(); Some(stamp(1))
        })) };
        received.recv().unwrap(); // snapshot 1 has already begun
        let mut next = Vec::new();
        for _ in 0..20 {
            let ri = ri.clone();
            next.push(thread::spawn(move || ri.validate(Instant::now()+Duration::from_secs(10), || Some(stamp(2)))));
        }
        waiters(&ri, 21);
        release.send(()).unwrap();
        assert_eq!(first.join().unwrap(), Some(stamp(1)));
        for read in next { assert_eq!(read.join().unwrap(), Some(stamp(2))); }
        assert_eq!(ri.rounds.load(Ordering::Relaxed), 2);
        assert_eq!(ri.reads.load(Ordering::Relaxed), 21);
    }
    #[test]
    fn deadline_cancellation_capacity_and_unwind_release_custody() {
        let ri = Arc::new(ReadIndex::default());
        let (sent, received) = mpsc::channel(); let (release, held) = mpsc::channel();
        let leader = { let ri = ri.clone(); thread::spawn(move || ri.validate(Instant::now()+Duration::from_secs(10), || {
            sent.send(()).unwrap(); held.recv().unwrap(); Some(stamp(1))
        })) };
        received.recv().unwrap();
        let mut queued = Vec::new();
        for _ in 0..29 { let ri=ri.clone(); queued.push(thread::spawn(move || ri.validate(Instant::now()+Duration::from_secs(10), || Some(stamp(2))))); }
        waiters(&ri, 30);
        assert!(ri.validate(Instant::now()+Duration::from_secs(1), || panic!("no 31st borrower")).is_none());
        release.send(()).unwrap(); leader.join().unwrap();
        for read in queued { assert_eq!(read.join().unwrap(), Some(stamp(2))); }
        assert!(ri.validate(Instant::now(), || panic!("expired before enrollment")).is_none());
        // A waiter times out independently while its leader still owns the flight.
        let (sent,received)=mpsc::channel(); let (release,held)=mpsc::channel();
        let leader={let ri=ri.clone();thread::spawn(move ||ri.validate(Instant::now()+Duration::from_secs(10),|| {sent.send(()).unwrap();held.recv().unwrap();Some(stamp(3))}))};
        received.recv().unwrap();
        assert!(ri.validate(Instant::now()+Duration::from_millis(10), || panic!("cancelled wait must not lead")).is_none());
        assert!(ri.state.lock().unwrap().running);
        release.send(()).unwrap(); assert_eq!(leader.join().unwrap(),Some(stamp(3)));
        let panic=std::panic::catch_unwind(||ri.validate(Instant::now()+Duration::from_secs(1),||panic!("leader disappeared")));
        assert!(panic.is_err());
        assert_eq!(ri.validate(Instant::now()+Duration::from_secs(1),||Some(stamp(4))),Some(stamp(4)));
        assert_eq!(ri.state.lock().unwrap().waiters,0);
    }
}
