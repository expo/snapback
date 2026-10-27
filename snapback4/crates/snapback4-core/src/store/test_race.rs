//! Shared physical-contention witness for every durable store family.
// @ref LLP 3000.009.001.000#9.1 — a holder cannot commit before its contender is observably blocked.
use super::{Store, Tx};
use crate::RuntimeError;
use std::{
    cell::RefCell,
    sync::{
        Arc, Barrier, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

thread_local! {
    static ACTIVATION_HOOK: RefCell<Option<(Arc<FenceRace>, bool)>> = const { RefCell::new(None) };
    // rusqlite requires a function pointer, so the contender thread supplies
    // the counter through TLS. Each race has its own counter, even in parallel.
    static BUSY_COUNT: RefCell<Option<Arc<AtomicUsize>>> = const { RefCell::new(None) };
    // Composite family operations open their own adapter transaction. A
    // one-shot hook gives them the same after-BEGIN rendezvous as direct Tx tests.
    #[cfg(feature = "postgres")]
    static BEGIN_HOOK: RefCell<Option<(Arc<FenceRace>, bool)>> = const { RefCell::new(None) };
}

#[cfg(feature = "postgres")]
pub(crate) fn after_adapter_begin() {
    if let Some((race, holder)) = BEGIN_HOOK.with(|slot| slot.borrow_mut().take()) {
        race.after_begin(holder);
    }
}

pub(crate) fn activation_after_begin() {
    let hook = ACTIVATION_HOOK.with(|slot| slot.borrow().clone());
    if let Some((race, holder)) = hook { race.after_begin(holder); }
}
pub(crate) fn activation_after_fence() -> Result<(), RuntimeError> {
    if let Some((race, holder)) = ACTIVATION_HOOK.with(|slot| slot.borrow_mut().take()) {
        race.after_fence(holder).map_err(RuntimeError::Store)?;
    }
    Ok(())
}

// The ordinary production writer is BEGIN IMMEDIATE. A test with an armed
// race separates BEGIN from the same writer reservation without an intervening
// snapshot read, so both activation calls can rendezvous before the fence.
pub(crate) fn begin_activation(conn: &mut rusqlite::Connection) -> Result<rusqlite::Transaction<'_>, RuntimeError> {
    let armed = ACTIVATION_HOOK.with(|slot| slot.borrow().is_some());
    let tx = conn.transaction_with_behavior(if armed { rusqlite::TransactionBehavior::Deferred } else { rusqlite::TransactionBehavior::Immediate })?;
    if armed {
        activation_after_begin();
        tx.execute("UPDATE _meta SET value=value WHERE key='version'", [])?;
        activation_after_fence()?;
    }
    Ok(tx)
}

fn count_busy(attempt: i32) -> bool {
    BUSY_COUNT.with(|counter| {
        counter
            .borrow()
            .as_ref()
            .unwrap()
            .fetch_add(1, Ordering::SeqCst)
    });
    std::thread::sleep(Duration::from_millis(5));
    attempt < 2_000
}

enum Witness {
    Sqlite(Arc<AtomicUsize>),
    #[cfg(feature = "postgres")]
    Postgres {
        observer: Box<postgres::Client>,
        holder: i32,
        contender: i32,
        head: u32,
    },
}

pub(crate) struct FenceRace {
    begun: Barrier,
    holder_ready: Barrier,
    witness: Mutex<Witness>,
    timeout: Duration,
}

impl FenceRace {
    fn new(witness: Witness) -> Self {
        Self {
            begun: Barrier::new(2),
            holder_ready: Barrier::new(2),
            witness: Mutex::new(witness),
            timeout: Duration::from_secs(5),
        }
    }

    pub(crate) fn arm_activation(self: &Arc<Self>, holder: bool) {
        ACTIVATION_HOOK.with(|slot| assert!(slot.borrow_mut().replace((self.clone(), holder)).is_none()));
    }

    pub(crate) fn sqlite() -> Self {
        Self::new(Witness::Sqlite(Arc::new(AtomicUsize::new(0))))
    }

    #[cfg(feature = "postgres")]
    pub(crate) fn postgres(
        holder: &mut postgres::Client,
        contender: &mut postgres::Client,
        observer: postgres::Client,
    ) -> Self {
        let facts = holder.query_one("SELECT pg_backend_pid(), '_head'::regclass::oid", &[]).unwrap();
        let holder = facts.get(0);
        let head = facts.get(1);
        let contender = contender
            .query_one("SELECT pg_backend_pid()", &[])
            .unwrap()
            .get(0);
        Self::new(Witness::Postgres {
            observer: Box::new(observer),
            holder,
            contender,
            head,
        })
    }

    pub(crate) fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    #[cfg(feature = "postgres")]
    pub(crate) fn arm_after_begin(self: &Arc<Self>, holder: bool) {
        BEGIN_HOOK.with(|slot| {
            assert!(slot.borrow_mut().replace((self.clone(), holder)).is_none());
        });
    }

    /// Install before BEGIN, on the contender thread and connection only.
    pub(crate) fn install_sqlite_busy_handler(&self, conn: &rusqlite::Connection) {
        let witness = self.witness.lock().unwrap();
        let counter = match &*witness {
            Witness::Sqlite(counter) => counter,
            #[cfg(feature = "postgres")]
            _ => panic!("SQLite witness required"),
        };
        BUSY_COUNT.with(|slot| *slot.borrow_mut() = Some(counter.clone()));
        conn.busy_handler(Some(count_busy)).unwrap();
    }

    /// Both adapter BEGINs must exist before either takes a writer fence.
    pub(crate) fn after_begin(&self, holder: bool) {
        self.begun.wait();
        if !holder {
            self.holder_ready.wait();
        }
    }

    /// Called with the holder's adapter transaction still alive. Opening the
    /// gate starts the contender's fenced operation; only a physical blocking
    /// observation releases the holder to run its policy and commit.
    pub(crate) fn after_fence(&self, holder: bool) -> Result<(), String> {
        if !holder {
            return Ok(());
        }
        self.holder_ready.wait();
        let deadline = Instant::now() + self.timeout;
        loop {
            let blocked = match &mut *self.witness.lock().unwrap() {
                Witness::Sqlite(counter) => counter.load(Ordering::SeqCst) > 0,
                #[cfg(feature = "postgres")]
                Witness::Postgres {
                    observer,
                    holder,
                    contender,
                    head,
                } => {
                    let blockers: Vec<i32> = observer
                        .query_one("SELECT pg_blocking_pids($1)", &[contender])
                        .map_err(|error| error.to_string())?
                        .get(0);
                    if blockers.contains(holder) {
                        // EXECUTE hides the prepared statement's source text.
                        // Reaching the exact head relation plus waiting on the
                        // known holder proves this same physical fence.
                        let reached_head: bool = observer
                            .query_one(
                                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation=$2 AND mode='RowShareLock' AND granted)",
                                &[contender,head],
                            )
                            .map_err(|error| error.to_string())?
                            .get(0);
                        if !reached_head {
                            return Err("contender blocked before reaching the head relation".into());
                        }
                        true
                    } else {
                        false
                    }
                }
            };
            if blocked {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("contender never blocked on the holder's fence".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

// SQLite normally reserves its writer in BEGIN IMMEDIATE. This adapter test
// seam splits BEGIN and that same reservation, without reading a snapshot in
// between. The unfenced mode exists for the helper's negative control only.
impl Store {
    pub(crate) fn transaction_with_begin_hook(
        &mut self,
        serialized: bool,
        after_begin: impl FnOnce(),
    ) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
        after_begin();
        if serialized {
            tx.execute("UPDATE _meta SET value = value WHERE key = 'version'", [])?;
        }
        if super::activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation(
                "the store adopted another backend; reopen this engine".into(),
            ));
        }
        Ok(Tx {
            cache_revision: &self.cache_revision,
            group_tail: Default::default(),
            lifecycle: false,
            read_sessions: &self.read_sessions,
            read_sessions_installed: Default::default(),
            read_sessions_at_start: self.read_sessions.present(),
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

#[test]
fn sqlite_fence_race_rejects_a_contender_that_takes_no_fence() {
    let dir = std::env::temp_dir().join(format!("sb4-fence-negative-{:x}", crate::ids::seed()));
    std::fs::create_dir(&dir).unwrap();
    let mut holder = Store::open(&dir.join("store.sqlite")).unwrap();
    let mut contender = Store::open(&dir.join("store.sqlite")).unwrap();
    let timeout = Duration::from_millis(100);
    let race = Arc::new(FenceRace::sqlite().with_timeout(timeout));
    std::thread::scope(|scope| {
        let race = &race;
        let peer = scope.spawn(move || {
            race.install_sqlite_busy_handler(contender.conn());
            let tx = contender
                .transaction_with_begin_hook(false, || race.after_begin(false))
                .unwrap();
            tx.rollback().unwrap();
        });
        let tx = holder
            .transaction_with_begin_hook(true, || race.after_begin(true))
            .unwrap();
        let started = Instant::now();
        assert_eq!(
            race.after_fence(true).unwrap_err(),
            "contender never blocked on the holder's fence"
        );
        assert!(started.elapsed() >= timeout);
        tx.rollback().unwrap();
        peer.join().unwrap();
    });
    drop(holder);
    std::fs::remove_dir_all(dir).unwrap();
}
