//! Request-scoped test instrumentation; absent from ordinary builds.
// @ref LLP 3000.009.001.000.001#5 — driver waits and SQLite statements are separate units.
use std::cell::Cell;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Counts {
    pub postgres: u64,
    pub sqlite: u64,
}
thread_local! { static ACTIVE: Cell<Option<Counts>> = const { Cell::new(None) }; }
/// Synchronous dynamic scope. Background threads never inherit it; a future
/// cross-thread committer must explicitly transfer request attribution.
pub struct Scope;
impl Scope {
    pub fn begin() -> Self {
        ACTIVE.with(|a| {
            assert!(a.get().is_none(), "nested request counter");
            a.set(Some(Counts::default()));
        });
        Self
    }
    pub fn counts(&self) -> Counts {
        ACTIVE.with(|a| a.get().expect("active request"))
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        ACTIVE.with(|a| a.set(None));
    }
}
fn add(pg: u64, sqlite: u64) {
    ACTIVE.with(|a| {
        if let Some(mut n) = a.get() {
            n.postgres += pg;
            n.sqlite += sqlite;
            a.set(Some(n));
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
