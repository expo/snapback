//! Request-scoped test instrumentation; absent from ordinary builds.
// @ref LLP 3000.009.001.000.001#5 — driver waits and SQLite statements are separate units.
use std::{
    cell::{Cell, RefCell},
    marker::PhantomData,
    rc::Rc,
    sync::{Arc, atomic::{AtomicU64, Ordering}},
};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Counts {
    pub postgres: u64,
    pub sqlite: u64,
}
#[derive(Default)]
struct AtomicCounts {
    postgres: AtomicU64,
    sqlite: AtomicU64,
}
/// Explicit request attribution; background threads never inherit it.
#[derive(Clone)]
pub struct Handle(Arc<AtomicCounts>);
thread_local! { static ACTIVE: RefCell<Option<Handle>> = const { RefCell::new(None) }; }
/// Owns request counts and their installation on the submitting thread.
pub struct Scope {
    handle: Handle,
    _guard: Guard,
}
impl Scope {
    pub fn begin() -> Self {
        let handle = Handle(Arc::default());
        let guard = handle.clone().enter();
        Self { handle, _guard: guard }
    }
    pub fn handle(&self) -> Handle {
        self.handle.clone()
    }
    pub fn counts(&self) -> Counts {
        Counts {
            postgres: self.handle.0.postgres.load(Ordering::Relaxed),
            sqlite: self.handle.0.sqlite.load(Ordering::Relaxed),
        }
    }
}
/// The guard must stay on the thread whose dynamic scope it installed.
pub struct Guard(PhantomData<Rc<()>>);
impl Handle {
    pub fn enter(self) -> Guard {
        ACTIVE.with(|a| {
            let mut active = a.borrow_mut();
            assert!(active.is_none(), "nested request counter");
            *active = Some(self);
        });
        Guard(PhantomData)
    }
}
pub(crate) fn current() -> Option<Handle> {
    ACTIVE.with(|a| a.borrow().clone())
}
impl Drop for Guard {
    fn drop(&mut self) {
        ACTIVE.with(|a| *a.borrow_mut() = None);
    }
}
fn add(pg: u64, sqlite: u64) {
    ACTIVE.with(|a| {
        if let Some(handle) = a.borrow().as_ref() {
            handle.0.postgres.fetch_add(pg, Ordering::Relaxed);
            handle.0.sqlite.fetch_add(sqlite, Ordering::Relaxed);
        }
    });
}
pub(crate) fn postgres(n: u64) {
    add(n, 0);
}
/// Cell's existing counter interface, including evaluator resets.
pub struct CallCounter(Cell<u64>);
impl CallCounter {
    pub fn new(n: u64) -> Self {
        Self(Cell::new(n))
    }
    pub fn get(&self) -> u64 {
        self.0.get()
    }
    pub fn set(&self, n: u64) {
        postgres(n.saturating_sub(self.get()));
        self.0.set(n);
    }
}
/// The driver also waits for ROLLBACK when a transaction drops on an error.
pub(crate) struct RollbackCount(Cell<bool>);
impl RollbackCount {
    pub(crate) fn new() -> Self {
        Self(Cell::new(true))
    }
    pub(crate) fn disarm(&self) {
        self.0.set(false);
    }
}
impl Drop for RollbackCount {
    fn drop(&mut self) {
        if self.0.get() {
            postgres(1);
        }
    }
}
pub(crate) fn sqlite_statement() {
    add(0, 1);
}
#[cfg(feature = "sqlite")]
mod fixtures_tests;
#[cfg(feature = "sqlite")]
pub use fixtures_tests::action_claim;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transferred_scope_counts_both_threads_and_clears_after_unwind() {
        let scope = Scope::begin();
        let handle = scope.handle();
        postgres(2);
        std::thread::spawn(move || {
            assert!(current().is_none());
            let result = std::panic::catch_unwind(|| {
                let _guard = handle.enter();
                postgres(3);
                sqlite_statement();
                panic!("unwind the installed attribution");
            });
            assert!(result.is_err());
            assert!(current().is_none());
            postgres(100);
        }).join().unwrap();
        assert_eq!(scope.counts(), Counts { postgres: 5, sqlite: 1 });
    }
    #[test]
    fn transferred_scope_refuses_nesting_without_losing_outer_scope() {
        let scope = Scope::begin();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _nested = scope.handle().enter();
        }));
        assert!(result.is_err());
        postgres(1);
        assert_eq!(scope.counts().postgres, 1);
    }
    #[test]
    fn scope_excludes_background_and_resets_between_requests() {
        let first = Scope::begin();
        postgres(2);
        std::thread::spawn(|| {
            postgres(100);
        })
        .join()
        .unwrap();
        {
            let _rollback = RollbackCount::new();
        }
        assert_eq!(first.counts().postgres, 3);
        drop(first);
        let next = Scope::begin();
        assert_eq!(next.counts(), Counts::default());
    }
}
