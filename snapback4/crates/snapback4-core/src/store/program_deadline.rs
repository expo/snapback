//! A retry deadline covers SQLite lock acquisition as well as VM execution.
//!
//! rusqlite 0.41 installs a callback only through `&mut Connection`, and an
//! attempt arms its deadline inside an open transaction, which lends only
//! `&Connection`. So each store connection receives one busy handler when it
//! opens (`Handlers::install`). Its progress handler is installed once, by the
//! first `Store::program_transaction_until` on that connection, before BEGIN:
//! every SQLite deadline-bound attempt runs in a transaction opened there, and
//! connections that never retry pay no per-step callback. A deadline scope
//! arms and disarms the handlers; no scope installs or removes a callback.
use super::*;
use std::{
    cell::Cell,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
thread_local! { static DEADLINE: Cell<Option<Instant>> = const {Cell::new(None)}; }
fn deadline_wait() -> bool {
    DEADLINE.with(|slot| {
        let Some(remaining) = slot
            .get()
            .and_then(|deadline| deadline.checked_duration_since(Instant::now()))
        else {
            return false;
        };
        std::thread::sleep(remaining.min(Duration::from_millis(1)));
        slot.get().is_some_and(|deadline| Instant::now() < deadline)
    })
}

/// A connection's lock wait when the host sets none. SQLite itself starts at
/// 0, but rusqlite sets 5 s inside every open (in-memory included), and
/// `Store::open` uses the same value; the handler keeps it.
pub(crate) const DEFAULT_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Virtual machine steps between deadline checks.
const PROGRESS_STEPS: std::ffi::c_int = 1000;
// The bundled SQLite's `busy_timeout` schedule (sqliteDefaultBusyCallback, the
// sub-second sleep branch): wait `count` sleeps DELAYS[count] ms after TOTALS[count].
const DELAYS: [u64; 12] = [1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50, 100];
const TOTALS: [u64; 12] = [0, 1, 3, 8, 18, 33, 53, 78, 103, 128, 178, 228];
/// The ordinary `busy_timeout` sleep before retry `count`, or `None` to stop waiting.
fn ordinary_delay(count: i32, timeout_ms: u64) -> Option<Duration> {
    let count = u64::try_from(count).unwrap_or(0);
    let last = DELAYS.len() - 1;
    let (delay, prior) = match usize::try_from(count).ok().filter(|n| *n <= last) {
        Some(n) => (DELAYS[n], TOTALS[n]),
        None => (DELAYS[last], TOTALS[last] + DELAYS[last] * (count - last as u64)),
    };
    let delay = if prior + delay > timeout_ms { timeout_ms.saturating_sub(prior) } else { delay };
    (delay > 0).then(|| Duration::from_millis(delay))
}
fn timeout_millis(timeout: Duration) -> Result<u64, RuntimeError> {
    // SQLite keeps the timeout in a C int, as rusqlite's busy_timeout did.
    u64::try_from(timeout.as_millis())
        .ok()
        .filter(|ms| *ms <= i32::MAX as u64)
        .ok_or_else(|| RuntimeError::Store(format!("busy timeout {timeout:?} exceeds SQLite's limit")))
}

struct State {
    timeout_ms: AtomicU64,
    busy_armed: AtomicBool,
    // Nanoseconds after `epoch`, plus one; zero leaves statements uninterrupted.
    interrupt_at: AtomicU64,
    // Whether this connection's progress handler is ours and installed.
    progress: AtomicBool,
    epoch: Instant,
}
impl State {
    fn busy(&self, count: i32) -> bool {
        if self.busy_armed.load(Ordering::Acquire) {
            return deadline_wait();
        }
        match ordinary_delay(count, self.timeout_ms.load(Ordering::Acquire)) {
            Some(delay) => {
                std::thread::sleep(delay);
                true
            }
            None => false,
        }
    }
    fn interrupted(&self) -> bool {
        let at = self.interrupt_at.load(Ordering::Acquire);
        at != 0 && self.encode(Instant::now()) >= at
    }
    fn encode(&self, instant: Instant) -> u64 {
        u64::try_from(instant.saturating_duration_since(self.epoch).as_nanos())
            .unwrap_or(u64::MAX - 1)
            .saturating_add(1)
    }
}

/// One connection's busy handler (from open) and progress handler (from its
/// first deadline-bound transaction). Cloning shares them.
#[derive(Clone)]
pub(crate) struct Handlers(Arc<State>);
impl Handlers {
    /// Replaces the connection's busy handler: SQLite runs one at a time, so
    /// the ordinary timeout lives here. Later `busy_timeout` calls or
    /// `PRAGMA busy_timeout = N` would remove it; set the timeout here instead.
    /// While installed, `PRAGMA busy_timeout` reads 0.
    pub(crate) fn install(conn: &mut Connection, timeout: Duration) -> Result<Self, RuntimeError> {
        let handlers = Self(Arc::new(State {
            timeout_ms: AtomicU64::new(timeout_millis(timeout)?),
            busy_armed: AtomicBool::new(false),
            interrupt_at: AtomicU64::new(0),
            progress: AtomicBool::new(false),
            epoch: Instant::now(),
        }));
        let busy = handlers.0.clone();
        conn.busy_handler(Some(move |count| busy.busy(count)))?;
        Ok(handlers)
    }
    /// Install the progress handler unless this connection already has it.
    /// Needs the connection exclusively, so it runs before a transaction opens.
    fn ensure_progress(&self, conn: &mut Connection) -> Result<(), RuntimeError> {
        if !self.0.progress.load(Ordering::Acquire) {
            let progress = self.0.clone();
            conn.progress_handler(PROGRESS_STEPS, Some(move || progress.interrupted()))?;
            self.0.progress.store(true, Ordering::Release);
        }
        Ok(())
    }
    /// A fixture borrowed the connection mutably and may have replaced the
    /// progress handler; the next deadline-bound transaction installs it again.
    #[cfg(feature = "test-support")]
    pub(crate) fn forget_progress(&self) {
        self.0.progress.store(false, Ordering::Release);
    }
    pub(crate) fn timeout(&self) -> Duration {
        Duration::from_millis(self.0.timeout_ms.load(Ordering::Acquire))
    }
    pub(crate) fn set_timeout(&self, timeout: Duration) -> Result<(), RuntimeError> {
        self.0.timeout_ms.store(timeout_millis(timeout)?, Ordering::Release);
        Ok(())
    }
    /// Interrupt this connection's statements once `deadline` passes, until
    /// the guard drops. Refuses when no progress handler would observe it, so
    /// an attempt outside `program_transaction_until` cannot lose its deadline.
    pub(crate) fn interrupt_at(&self, deadline: Instant) -> Result<Interrupt<'_>, RuntimeError> {
        if !self.0.progress.load(Ordering::Acquire) {
            return Err(RuntimeError::Store(
                "deadline-bound SQLite work must open through program_transaction_until".into(),
            ));
        }
        let previous = self.0.interrupt_at.swap(self.0.encode(deadline), Ordering::AcqRel);
        Ok(Interrupt { handlers: self, previous })
    }
}
pub(crate) struct Interrupt<'a> {
    handlers: &'a Handlers,
    previous: u64,
}
impl Drop for Interrupt<'_> {
    fn drop(&mut self) {
        self.handlers.0.interrupt_at.store(self.previous, Ordering::Release);
    }
}

// SQLite invokes its busy handler on the caller thread. The actor's scopes do
// not overlap on one connection; nested scopes on other connections restore
// their predecessor's deadline. No deadline survives COMMIT: the scope ends
// before it, and its drop returns the connection to the ordinary timeout.
// @ref LLP 3000.009.001.000.002#3.1 — all cancellable fallback work shares the original remaining deadline.
pub(crate) struct Budget<'a> {
    handlers: &'a Handlers,
    armed: bool,
    previous: Option<Instant>,
}
impl<'a> Budget<'a> {
    pub(crate) fn begin(handlers: &'a Handlers, deadline: Instant) -> Result<Self, RuntimeError> {
        if Instant::now() >= deadline {
            return Err(RuntimeError::Store(
                "program invocation's remaining deadline elapsed".into(),
            ));
        }
        // Preserve a host's shorter contention policy too. The callback samples
        // one absolute cutoff, rather than restarting a timeout at each wait.
        let deadline = deadline.min(Instant::now() + handlers.timeout());
        let previous = DEADLINE.with(|slot| {
            slot.replace(Some(
                slot.get().map_or(deadline, |prior| prior.min(deadline)),
            ))
        });
        let armed = handlers.0.busy_armed.swap(true, Ordering::AcqRel);
        Ok(Self {
            handlers,
            armed,
            previous,
        })
    }
}
impl Drop for Budget<'_> {
    fn drop(&mut self) {
        self.handlers.0.busy_armed.store(self.armed, Ordering::Release);
        DEADLINE.with(|slot| slot.set(self.previous));
    }
}
impl Tx<'_> {
    pub(crate) fn deadline_handlers(&self) -> &Handlers {
        self.handlers
    }
}
impl Store {
    pub(crate) fn program_transaction_until(
        &mut self,
        deadline: Instant,
    ) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        self.handlers.ensure_progress(&mut self.conn)?;
        let _budget = Budget::begin(&self.handlers, deadline)?;
        // The &mut Store still gives exclusive custody. The guard disarms the
        // deadline on both BEGIN outcomes, before any COMMIT.
        let tx = rusqlite::Transaction::new_unchecked(
            &self.conn,
            rusqlite::TransactionBehavior::Immediate,
        )?;
        let read_storage = self.read_sessions.snapshot()?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation(
                "the store adopted another backend; reopen this engine".into(),
            ));
        }
        if Instant::now() >= deadline {
            return Err(RuntimeError::Store(
                "program invocation's remaining deadline elapsed".into(),
            ));
        }
        Ok(Tx {
            cache_revision: &self.cache_revision,
            handlers: &self.handlers,
            group_tail: Default::default(),
            lifecycle: false,
            read_sessions: &self.read_sessions,
            read_sessions_installed: Default::default(),
            read_sessions_at_start: *read_storage,
            read_sessions_installation: Default::default(),
            activation_scan: None,
            changes: Default::default(),
            sequence_table: Default::default(),
            tx,
            page_size: self.page_size,
            server: self.server,
            catalog: &self.catalog,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // The emulated schedule must match SQLite's own for every timeout.
    #[test]
    fn ordinary_delays_follow_sqlite_busy_timeout_schedule() {
        let waits = |timeout| (0..).map_while(|n| ordinary_delay(n, timeout)).map(|d| d.as_millis() as u64).collect::<Vec<_>>();
        assert_eq!(waits(0), Vec::<u64>::new());
        assert_eq!(waits(1), [1]);
        assert_eq!(waits(10), [1, 2, 5, 2]);
        assert_eq!(waits(228), DELAYS[..11]);
        let default = waits(5000);
        assert_eq!((default.iter().sum::<u64>(), default.len(), default[58]), (5000, 59, 72));
        assert_eq!(ordinary_delay(i32::MAX, 5000), None);
        assert!(timeout_millis(Duration::from_millis(i32::MAX as u64 + 1)).is_err());
    }
    fn busy_after(run: impl FnOnce() -> Result<(), RuntimeError>) -> Duration {
        let started = Instant::now();
        let error = run().expect_err("the held writer lock must refuse");
        assert!(error.is_busy(), "{error}");
        started.elapsed()
    }
    #[test]
    fn armed_deadline_stops_a_lock_wait_and_disarm_restores_the_ordinary_timeout() {
        let dir = std::env::temp_dir().join(format!("sb4-deadline-arm-{:x}", crate::ids::seed()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let mut store = Store::open(&path).unwrap();
        store.set_busy_timeout(Duration::from_millis(400)).unwrap();
        let blocker = Connection::open(&path).unwrap();
        blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        // Armed: the wait ends at the deadline, far below the ordinary timeout.
        let armed = busy_after(|| store.program_transaction_until(Instant::now() + Duration::from_millis(60)).map(drop));
        assert!(armed >= Duration::from_millis(50) && armed < Duration::from_millis(300), "deadline wait: {armed:?}");
        // Disarmed: the same connection waits out its ordinary timeout again.
        let ordinary = busy_after(|| Ok(store.conn.execute_batch("BEGIN IMMEDIATE")?));
        assert!(ordinary >= Duration::from_millis(400) && ordinary < Duration::from_secs(3), "ordinary wait: {ordinary:?}");
        // A later deadline is still capped at now + the ordinary timeout.
        let capped = busy_after(|| store.program_transaction_until(Instant::now() + Duration::from_secs(30)).map(drop));
        assert!(capped >= Duration::from_millis(350) && capped < Duration::from_secs(3), "capped wait: {capped:?}");
        assert!(store.conn.is_autocommit());
        blocker.execute_batch("ROLLBACK").unwrap();
        // Progress: a passed deadline interrupts statements only while armed.
        let count = "WITH RECURSIVE n(v) AS (VALUES(1) UNION ALL SELECT v+1 FROM n WHERE v<100000) SELECT count(*) FROM n";
        {
            let _interrupt = store.handlers.interrupt_at(Instant::now()).unwrap();
            let error = store.conn.query_row(count, [], |row| row.get::<_, i64>(0)).unwrap_err();
            assert_eq!(error.sqlite_error_code(), Some(rusqlite::ErrorCode::OperationInterrupted), "{error}");
        }
        assert_eq!(store.conn.query_row(count, [], |row| row.get::<_, i64>(0)).unwrap(), 100000);
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }

    const COUNT: &str = "WITH RECURSIVE n(v) AS (VALUES(1) UNION ALL SELECT v+1 FROM n WHERE v<100000) SELECT count(*) FROM n";
    fn uninterrupted(store: &Store) {
        assert_eq!(store.conn.query_row(COUNT, [], |row| row.get::<_, i64>(0)).unwrap(), 100000);
    }
    /// a store at a fresh path with its ordinary timeout, and a second
    /// connection that can hold the writer lock against it.
    fn contended(timeout: Duration) -> (Store, Connection, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("sb4-deadline-{:x}", crate::ids::seed()));
        std::fs::create_dir(&dir).unwrap();
        let store = Store::open(&dir.join("store.sqlite")).unwrap();
        store.set_busy_timeout(timeout).unwrap();
        let blocker = Connection::open(dir.join("store.sqlite")).unwrap();
        (store, blocker, dir)
    }
    fn timed<T>(run: impl FnOnce() -> T) -> (T, Duration) {
        let started = Instant::now();
        let value = run();
        (value, started.elapsed())
    }
    fn within(elapsed: Duration, low: u64, high: u64) {
        assert!(elapsed >= Duration::from_millis(low) && elapsed < Duration::from_millis(high), "{elapsed:?} outside {low}..{high} ms");
    }

    #[test]
    fn progress_handler_is_installed_by_the_first_deadline_transaction_only() {
        let (mut store, blocker, dir) = contended(Duration::from_millis(200));
        drop(blocker);
        assert!(store.handlers.interrupt_at(Instant::now()).is_err(), "no handler would observe the deadline");
        store.transaction().unwrap().rollback().unwrap();
        assert!(store.handlers.interrupt_at(Instant::now()).is_err(), "ordinary transactions install nothing");
        store.program_transaction_until(Instant::now() + Duration::from_secs(5)).unwrap().rollback().unwrap();
        let interrupt = store.handlers.interrupt_at(Instant::now()).unwrap();
        assert!(store.conn.query_row(COUNT, [], |row| row.get::<_, i64>(0)).is_err());
        drop(interrupt);
        uninterrupted(&store);
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }

    // finding 4: rusqlite sets 5 s inside every open, in-memory included, so
    // in-memory stores had 5 s before the handler; they keep it.
    #[test]
    fn in_memory_stores_keep_the_lock_wait_rusqlite_sets_at_open() {
        let raw = Connection::open_in_memory().unwrap();
        assert_eq!(raw.query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0)).unwrap(), 5000);
        let memory = Store::memory().unwrap();
        assert_eq!(memory.handlers.timeout(), DEFAULT_BUSY_TIMEOUT);
        assert_eq!(memory.fork_memory().unwrap().handlers.timeout(), DEFAULT_BUSY_TIMEOUT);
        assert_eq!(memory.empty_with_asset_ledger().unwrap().handlers.timeout(), DEFAULT_BUSY_TIMEOUT);
        assert_eq!(DEFAULT_BUSY_TIMEOUT, Duration::from_millis(5000));
    }

    // finding 1a: nested scopes on two connections on one thread share the
    // tighter deadline, and the inner scope's drop restores the outer one.
    #[test]
    fn nested_scopes_on_two_connections_take_the_tighter_deadline_and_restore_the_outer() {
        let (a, a_blocker, a_dir) = contended(Duration::from_secs(3));
        let (mut b, b_blocker, b_dir) = contended(Duration::from_secs(3));
        a_blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        b_blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        let start = Instant::now();
        let a_deadline = start + Duration::from_millis(500);
        let outer = Budget::begin(&a.handlers, a_deadline).unwrap();
        // b is tighter: its wait ends at its own deadline.
        let (inner, elapsed) = timed(|| b.program_transaction_until(Instant::now() + Duration::from_millis(60)).map(drop));
        assert!(inner.unwrap_err().is_busy());
        within(elapsed, 50, 300);
        // b's scope dropped: a's own wait ends at a's deadline, not b's and
        // not a's 3 s ordinary timeout.
        let (waited, _) = timed(|| a.conn.execute_batch("BEGIN IMMEDIATE"));
        assert!(waited.is_err());
        within(start.elapsed(), 480, 900);
        drop(outer);
        // b looser than a: b's wait ends at a's deadline.
        let start = Instant::now();
        let outer = Budget::begin(&a.handlers, start + Duration::from_millis(150)).unwrap();
        let (inner, _) = timed(|| b.program_transaction_until(Instant::now() + Duration::from_secs(2)).map(drop));
        assert!(inner.unwrap_err().is_busy());
        within(start.elapsed(), 140, 500);
        drop(outer);
        DEADLINE.with(|slot| assert_eq!(slot.get(), None));
        assert!(!a.handlers.0.busy_armed.load(Ordering::Acquire) && !b.handlers.0.busy_armed.load(Ordering::Acquire));
        drop((a, b, a_blocker, b_blocker));
        std::fs::remove_dir_all(a_dir).unwrap();
        std::fs::remove_dir_all(b_dir).unwrap();
    }

    // finding 1b: unwinding through an armed attempt disarms everything it armed.
    #[test]
    fn unwinding_through_an_armed_attempt_restores_the_ordinary_policy() {
        let (mut store, blocker, dir) = contended(Duration::from_millis(400));
        let deadline = Instant::now() + Duration::from_millis(80);
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let tx = crate::store_port::AnyTx::from_sqlite(store.program_transaction_until(deadline).unwrap());
            let _budget = tx.bound_program_attempt(deadline).unwrap();
            assert!(store_armed(&tx));
            panic!("unwind with the attempt armed");
        }));
        assert!(unwound.is_err());
        DEADLINE.with(|slot| assert_eq!(slot.get(), None));
        assert!(!store.handlers.0.busy_armed.load(Ordering::Acquire));
        assert_eq!(store.handlers.0.interrupt_at.load(Ordering::Acquire), 0);
        assert!(store.conn.is_autocommit(), "the unwound transaction rolled back");
        std::thread::sleep(deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(20));
        uninterrupted(&store);
        blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        let (waited, elapsed) = timed(|| store.conn.execute_batch("BEGIN IMMEDIATE"));
        assert!(waited.is_err());
        within(elapsed, 400, 3000);
        drop((store, blocker));
        std::fs::remove_dir_all(dir).unwrap();
    }
    fn store_armed(tx: &crate::store_port::AnyTx<'_>) -> bool {
        tx.with_sqlite(|tx| tx.deadline_handlers().0.busy_armed.load(Ordering::Acquire) && tx.deadline_handlers().0.interrupt_at.load(Ordering::Acquire) != 0)
    }

    // finding 1c: a disarmed attempt that outlives its deadline still commits
    // under contention with the ordinary policy, and the connection stays usable.
    #[test]
    fn a_disarmed_attempt_commits_after_its_deadline_under_contention() {
        let (mut store, _, dir) = contended(Duration::from_secs(2));
        // rollback journal: COMMIT needs EXCLUSIVE, so a reader makes it wait.
        store.conn.execute_batch("PRAGMA journal_mode=DELETE; CREATE TABLE late(v INTEGER)").unwrap();
        let path = dir.join("store.sqlite");
        let deadline = Instant::now() + Duration::from_millis(60);
        let tx = crate::store_port::AnyTx::from_sqlite(store.program_transaction_until(deadline).unwrap());
        let budget = tx.bound_program_attempt(deadline).unwrap();
        tx.with_sqlite(|tx| tx.conn().execute("INSERT INTO late VALUES(1)", [])).unwrap();
        tx.prepare_program_commit().unwrap();
        drop(budget);
        assert!(!store_armed(&tx));
        std::thread::sleep(deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(20));
        let (reading, read) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            let reader = Connection::open(path).unwrap();
            reader.execute_batch("BEGIN").unwrap();
            reader.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0)).unwrap();
            reading.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(250));
            reader.execute_batch("COMMIT").unwrap();
        });
        read.recv().unwrap();
        let (committed, elapsed) = timed(|| tx.commit_program());
        assert!(committed.is_ok(), "{:?}", committed.err().map(|f| f.error));
        within(elapsed, 150, 2000);
        reader.join().unwrap();
        assert_eq!(store.conn.query_row("SELECT count(*) FROM late", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        uninterrupted(&store);
        let tx = store.transaction().unwrap();
        tx.conn().execute("INSERT INTO late VALUES(2)", []).unwrap();
        tx.commit().unwrap();
        assert_eq!(store.conn.query_row("SELECT count(*) FROM late", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }

    // finding 1d: deadlines live per thread.
    #[test]
    fn deadlines_on_two_threads_are_independent() {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let run = |wait: u64| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let (mut store, blocker, dir) = contended(Duration::from_secs(3));
                blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
                barrier.wait();
                let (result, elapsed) = timed(|| store.program_transaction_until(Instant::now() + Duration::from_millis(wait)).map(drop));
                assert!(result.unwrap_err().is_busy());
                drop((store, blocker));
                std::fs::remove_dir_all(dir).unwrap();
                elapsed
            })
        };
        let (short, long) = (run(80), run(600));
        within(short.join().unwrap(), 70, 400);
        within(long.join().unwrap(), 580, 1500);
    }

    // finding 5: lending the connection mutably forgets the progress handler,
    // so the next deadline-bound transaction installs it again.
    #[test]
    fn a_fixture_that_removes_the_progress_handler_cannot_disable_deadlines() {
        let (mut store, blocker, dir) = contended(Duration::from_millis(200));
        drop(blocker);
        store.program_transaction_until(Instant::now() + Duration::from_secs(5)).unwrap().rollback().unwrap();
        store.test_support_conn_mut().progress_handler(0, None::<fn() -> bool>).unwrap();
        assert!(store.handlers.interrupt_at(Instant::now()).is_err());
        store.program_transaction_until(Instant::now() + Duration::from_secs(5)).unwrap().rollback().unwrap();
        let interrupt = store.handlers.interrupt_at(Instant::now()).unwrap();
        assert!(store.conn.query_row(COUNT, [], |row| row.get::<_, i64>(0)).is_err());
        drop(interrupt);
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
