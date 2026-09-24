//! FIFO admission to the single writer: a chunk cannot overtake a waiting request.
use std::{ops::{Deref, DerefMut}, sync::{Condvar, LockResult, Mutex, MutexGuard, PoisonError}};
use std::time::{Duration, Instant};

const REQUEST_QUIET: Duration = Duration::from_millis(1);
const MAX_DEFER: Duration = Duration::from_millis(5);

pub trait Clock { fn now(&self) -> Instant; }
pub struct SystemClock;
impl Clock for SystemClock { fn now(&self) -> Instant { Instant::now() } }

#[derive(Default)]
struct Queue { next: u64, serving: u64, last_request: Option<Instant> }

// @ref LLP 3000.013#4-following-without-caps — background delivery yields the engine between commits.
/// Both requests and maintenance take tickets. Later requests cannot starve
/// maintenance either; every holder does one bounded operation before release.
pub struct FairMutex<T, C: Clock = SystemClock> {
    clock: C,
    queue: Mutex<Queue>,
    available: Condvar,
    value: Mutex<T>,
}

impl<T> FairMutex<T> {
    pub fn new(value: T) -> Self {
        Self::with_clock(value, SystemClock)
    }
}
impl<T, C: Clock> FairMutex<T, C> {
    fn with_clock(value: T, clock: C) -> Self {
        Self { clock, queue: Mutex::new(Queue::default()), available: Condvar::new(), value: Mutex::new(value) }
    }
    fn background_wait(&self, queue: &Queue, started: Instant) -> Option<Duration> {
        // An existing queue is sustained contention: join its tail now.
        if queue.next.wrapping_sub(queue.serving) > 1 { return None; }
        let now = self.clock.now();
        let quiet = queue.last_request.map_or(Duration::ZERO, |at| REQUEST_QUIET.saturating_sub(now.saturating_duration_since(at)));
        if queue.next == queue.serving && quiet.is_zero() { return None; }
        let remaining = MAX_DEFER.saturating_sub(now.saturating_duration_since(started));
        if remaining.is_zero() { None }
        else { Some(if quiet.is_zero() { remaining } else { quiet.min(remaining) }) }
    }
    pub fn lock(&self) -> LockResult<FairGuard<'_, T, C>> {
        self.admit(false)
    }
    /// Coalesce a short request burst before entering the FIFO. At the deadline
    /// maintenance takes a ticket even under continuous traffic; later arrivals
    /// cannot starve it. No engine lock is held during the deferral.
    pub fn background(&self) -> FairGuard<'_, T, C> {
        recover(self.admit(true), || self.clear_poison())
    }
    fn admit(&self, background: bool) -> LockResult<FairGuard<'_, T, C>> {
        let started = self.clock.now();
        let mut queue = self.queue.lock().unwrap_or_else(PoisonError::into_inner);
        if background {
            while let Some(wait) = self.background_wait(&queue, started) {
                queue = self.available.wait_timeout(queue, wait).unwrap_or_else(PoisonError::into_inner).0;
            }
        }
        let contended = background && (queue.next != queue.serving || queue.last_request.is_some_and(|at| self.clock.now().saturating_duration_since(at) < REQUEST_QUIET));
        let ticket = queue.next;
        queue.next = queue.next.wrapping_add(1);
        while queue.serving != ticket {
            queue = self.available.wait(queue).unwrap_or_else(PoisonError::into_inner);
        }
        drop(queue);
        match self.value.lock() {
            Ok(value) => Ok(FairGuard { owner: self, value: Some(value), background, contended }),
            Err(error) => Err(PoisonError::new(FairGuard { owner: self, value: Some(error.into_inner()), background, contended })),
        }
    }
    pub fn clear_poison(&self) { self.value.clear_poison(); }
    #[cfg(test)]
    pub fn is_poisoned(&self) -> bool { self.value.is_poisoned() }
}

pub struct FairGuard<'a, T, C: Clock = SystemClock> { owner: &'a FairMutex<T, C>, value: Option<MutexGuard<'a, T>>, background: bool, contended: bool }
impl<T, C: Clock> FairGuard<'_, T, C> {
    pub fn contended(&self) -> bool { self.contended }
}
impl<T, C: Clock> Deref for FairGuard<'_, T, C> {
    type Target = T;
    fn deref(&self) -> &T { self.value.as_deref().expect("live guard") }
}
impl<T, C: Clock> DerefMut for FairGuard<'_, T, C> {
    fn deref_mut(&mut self) -> &mut T { self.value.as_deref_mut().expect("live guard") }
}
impl<T, C: Clock> Drop for FairGuard<'_, T, C> {
    fn drop(&mut self) {
        drop(self.value.take());
        let mut queue = self.owner.queue.lock().unwrap_or_else(PoisonError::into_inner);
        if !self.background { queue.last_request = Some(self.owner.clock.now()); }
        queue.serving = queue.serving.wrapping_add(1);
        self.owner.available.notify_all();
    }
}

/// Preserve the server's poison recovery for both ordinary and FIFO locks.
pub(crate) trait Lockable {
    type Guard<'a> where Self: 'a;
    fn recover_lock(&self) -> Self::Guard<'_>;
}
fn recover<T>(result: LockResult<T>, clear: impl FnOnce()) -> T {
    match result {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("snapback4: recovered a mutex after a request panicked");
            clear();
            poisoned.into_inner()
        }
    }
}
impl<T> Lockable for Mutex<T> {
    type Guard<'a> = MutexGuard<'a, T> where T: 'a;
    fn recover_lock(&self) -> Self::Guard<'_> { recover(self.lock(), || self.clear_poison()) }
}
impl<T, C: Clock> Lockable for FairMutex<T, C> {
    type Guard<'a> = FairGuard<'a, T, C> where T: 'a, C: 'a;
    fn recover_lock(&self) -> Self::Guard<'_> { recover(self.lock(), || self.clear_poison()) }
}
impl<T: Lockable> Lockable for std::sync::Arc<T> {
    type Guard<'a> = T::Guard<'a> where T: 'a;
    fn recover_lock(&self) -> Self::Guard<'_> { (**self).recover_lock() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::{Arc, mpsc}, time::{Duration, Instant}};

    fn queued(lock: &FairMutex<()>, expected: u64) {
        let start = Instant::now();
        while lock.queue.lock().unwrap().next < expected {
            assert!(start.elapsed() < Duration::from_secs(5), "waiter did not enqueue");
            std::thread::yield_now();
        }
    }

    #[test]
    fn waiting_request_precedes_next_chunk_and_background_precedes_later_requests() {
        let lock = Arc::new(FairMutex::new(()));
        let initial_chunk = lock.lock().unwrap();
        let (sent, received) = mpsc::channel();
        let mut threads = Vec::new();
        // A request queues during a chunk; the next chunk queues behind it;
        // a sustained stream of later requests must not starve that chunk.
        for ticket in 1..=32 {
            let waiter = lock.clone(); let sent = sent.clone();
            threads.push(std::thread::spawn(move || {
                let _guard = waiter.lock().unwrap(); sent.send(ticket).unwrap();
            }));
            queued(&lock, ticket + 1);
        }
        drop(initial_chunk);
        for expected in 1..=32 { assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), expected); }
        for thread in threads { thread.join().unwrap(); }
    }

    #[test]
    fn panic_releases_ticket_and_poison_can_be_recovered() {
        let lock = Arc::new(FairMutex::new(0));
        let worker = lock.clone();
        assert!(std::thread::spawn(move || { let mut value = worker.lock().unwrap(); *value = 7; panic!("request"); }).join().is_err());
        assert!(lock.is_poisoned());
        assert_eq!(*lock.recover_lock(), 7);
        assert!(!lock.is_poisoned());
        assert_eq!(*lock.lock().unwrap(), 7);
    }

    #[test]
    fn busy_background_eventually_takes_a_ticket_behind_waiting_requests() {
        let lock = Arc::new(FairMutex::new(()));
        let initial = lock.lock().unwrap();
        let (sent, received) = mpsc::channel();
        let requester = lock.clone(); let request_sent = sent.clone();
        let request = std::thread::spawn(move || {
            let _guard = requester.lock().unwrap(); request_sent.send("request").unwrap();
        });
        queued(&lock, 2);
        let worker = lock.clone(); let work_sent = sent.clone();
        let background = std::thread::spawn(move || {
            let guard = worker.background();
            assert!(guard.contended()); work_sent.send("background").unwrap();
        });
        // The held request and its waiter trigger immediate FIFO admission.
        queued(&lock, 3);
        let later = lock.clone();
        let last = std::thread::spawn(move || {
            let _guard = later.lock().unwrap(); sent.send("later request").unwrap();
        });
        queued(&lock, 4);
        drop(initial);
        for expected in ["request", "background", "later request"] {
            assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), expected);
        }
        request.join().unwrap(); background.join().unwrap(); last.join().unwrap();
    }

    #[test]
    fn background_does_not_count_as_request_activity() {
        let lock = FairMutex::new(());
        assert!(!lock.background().contended());
        assert!(lock.queue.lock().unwrap().last_request.is_none());
        assert!(!lock.background().contended());
    }

    struct ManualClock(std::cell::Cell<Instant>);
    impl Clock for ManualClock { fn now(&self) -> Instant { self.0.get() } }

    #[test]
    fn background_takes_its_ticket_at_five_ms_despite_new_request_activity() {
        let start = Instant::now();
        let lock = FairMutex::with_clock((), ManualClock(std::cell::Cell::new(start)));
        let mut queue = Queue { next: 1, serving: 0, last_request: None };
        assert_eq!(lock.background_wait(&queue, start), Some(Duration::from_millis(5)));
        lock.clock.0.set(start + Duration::from_micros(4999));
        queue.last_request = Some(lock.clock.now());
        assert_eq!(lock.background_wait(&queue, start), Some(Duration::from_micros(1)));
        lock.clock.0.set(start + Duration::from_millis(5));
        queue.last_request = Some(lock.clock.now());
        assert_eq!(lock.background_wait(&queue, start), None, "the deadline is 5 ms, not the test harness timeout");
    }

    #[test]
    fn a_waiting_request_behind_a_holder_admits_background_immediately() {
        let start = Instant::now();
        let lock = FairMutex::with_clock((), ManualClock(std::cell::Cell::new(start)));
        let queue = Queue { next: 2, serving: 0, last_request: Some(start) };
        assert_eq!(lock.background_wait(&queue, start), None, "do not wait for a quiet interval or the deadline");
    }

    #[test]
    fn quiet_interval_ends_at_one_ms_on_the_injected_clock() {
        let start = Instant::now();
        let lock = FairMutex::with_clock((), ManualClock(std::cell::Cell::new(start)));
        let queue = Queue { next: 1, serving: 1, last_request: Some(start) };
        assert_eq!(lock.background_wait(&queue, start), Some(Duration::from_millis(1)));
        lock.clock.0.set(start + Duration::from_micros(999));
        assert_eq!(lock.background_wait(&queue, start), Some(Duration::from_micros(1)));
        lock.clock.0.set(start + Duration::from_millis(1));
        assert_eq!(lock.background_wait(&queue, start), None);
    }
}
