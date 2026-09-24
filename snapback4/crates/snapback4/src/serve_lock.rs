//! FIFO admission to the single writer: a chunk cannot overtake a waiting request.
use std::{ops::{Deref, DerefMut}, sync::{Condvar, LockResult, Mutex, MutexGuard, PoisonError}};

#[derive(Default)]
struct Queue { next: u64, serving: u64 }

// @ref LLP 3000.013#4-following-without-caps — background delivery yields the engine between commits.
/// Both requests and maintenance take tickets. Later requests cannot starve
/// maintenance either; every holder does one bounded operation before release.
pub struct FairMutex<T> {
    queue: Mutex<Queue>,
    available: Condvar,
    value: Mutex<T>,
}

impl<T> FairMutex<T> {
    pub fn new(value: T) -> Self {
        Self { queue: Mutex::new(Queue::default()), available: Condvar::new(), value: Mutex::new(value) }
    }
    pub fn lock(&self) -> LockResult<FairGuard<'_, T>> {
        let mut queue = self.queue.lock().unwrap_or_else(PoisonError::into_inner);
        let ticket = queue.next;
        queue.next = queue.next.wrapping_add(1);
        while queue.serving != ticket {
            queue = self.available.wait(queue).unwrap_or_else(PoisonError::into_inner);
        }
        drop(queue);
        match self.value.lock() {
            Ok(value) => Ok(FairGuard { owner: self, value: Some(value) }),
            Err(error) => Err(PoisonError::new(FairGuard { owner: self, value: Some(error.into_inner()) })),
        }
    }
    pub fn clear_poison(&self) { self.value.clear_poison(); }
    #[cfg(test)]
    pub fn is_poisoned(&self) -> bool { self.value.is_poisoned() }
}

pub struct FairGuard<'a, T> { owner: &'a FairMutex<T>, value: Option<MutexGuard<'a, T>> }
impl<T> Deref for FairGuard<'_, T> {
    type Target = T;
    fn deref(&self) -> &T { self.value.as_deref().expect("live guard") }
}
impl<T> DerefMut for FairGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut T { self.value.as_deref_mut().expect("live guard") }
}
impl<T> Drop for FairGuard<'_, T> {
    fn drop(&mut self) {
        drop(self.value.take());
        let mut queue = self.owner.queue.lock().unwrap_or_else(PoisonError::into_inner);
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
impl<T> Lockable for FairMutex<T> {
    type Guard<'a> = FairGuard<'a, T> where T: 'a;
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
}
