//! Reference committer: one in-place member and its original transaction.
use crate::{RuntimeError, Store, store::Tx};

// @ref LLP 3000.009.001.000.000#3.2 — kinds describe durable units, including writes that publish no sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Program,
    Engine,
    Publication,
    Direct,
    Administrative,
}

/// The body carries its post-commit continuations as calls to `after_commit`.
/// The reference runs those hooks inline in submission order, after releasing
/// the transaction borrow. This also permits a hook to rebind engine/store state.
pub(crate) struct Member<F> {
    kind: Kind,
    run: F,
}

impl<F> Member<F> {
    pub(crate) fn new<T>(kind: Kind, run: F) -> Self
    where
        F: FnOnce(&mut Committer) -> Result<T, RuntimeError>,
    {
        Self { kind, run }
    }
}

pub(crate) trait CommitTransaction {
    fn commit_transaction(self) -> Result<(), RuntimeError>;
}

impl CommitTransaction for Tx<'_> {
    fn commit_transaction(self) -> Result<(), RuntimeError> { self.commit() }
}

/// A member-scoped boundary. The body selects the original commit point and
/// retains ownership of the handle so explicit rollback errors and implicit
/// drop paths keep their existing behavior, including normal refusal returns.
pub(crate) struct Committer {
    opened: bool,
    committed: bool,
}

impl Committer {
    pub(crate) fn run<T>(member: Member<impl FnOnce(&mut Self) -> Result<T, RuntimeError>>) -> Result<T, RuntimeError> {
        let Member { kind, run } = member;
        // K0a deliberately has no kind-dependent scheduling, queue, batching,
        // revision allocation or retries. Every member runs in place, alone.
        let _kind = kind;
        run(&mut Self { opened: false, committed: false })
    }

    pub(crate) fn transaction<'a>(&mut self, store: &'a mut Store) -> Result<Tx<'a>, RuntimeError> {
        self.open_with(|| store.transaction())
    }

    /// Activation must prepare its raw transaction before constructing a Tx
    /// over the candidate catalog. Invoke its adapter's original opener.
    pub(crate) fn open_with<X>(&mut self, open: impl FnOnce() -> Result<X, RuntimeError>) -> Result<X, RuntimeError> {
        assert!(!self.opened, "one transaction per reference member");
        let tx = open()?;
        self.opened = true;
        Ok(tx)
    }

    pub(crate) fn commit(&mut self, tx: impl CommitTransaction) -> Result<(), RuntimeError> {
        assert!(self.opened && !self.committed, "one commit per reference member");
        tx.commit_transaction()?;
        self.committed = true;
        Ok(())
    }

    /// Register and run the next post-commit hook. Inline execution preserves
    /// today's ordering relative to subsequent reads, wakeups and fallible work.
    pub(crate) fn after_commit<T>(&self, hook: impl FnOnce() -> T) -> T {
        assert!(self.committed, "post-commit hook requires a successful commit");
        hook()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Transaction<'a>(&'a RefCell<Vec<&'static str>>, bool);
    impl CommitTransaction for Transaction<'_> {
        fn commit_transaction(self) -> Result<(), RuntimeError> {
            self.0.borrow_mut().push("commit");
            if self.1 { Ok(()) } else { Err(RuntimeError::Store("commit failed".into())) }
        }
    }

    #[test]
    fn reference_opens_runs_commits_then_runs_hooks_in_order() {
        let events = RefCell::new(Vec::new());
        let value = Committer::run(Member::new(Kind::Program, |commit| {
            let tx = commit.open_with(|| {
                events.borrow_mut().push("open");
                Ok(Transaction(&events, true))
            })?;
            events.borrow_mut().push("body");
            commit.commit(tx)?;
            commit.after_commit(|| events.borrow_mut().push("first"));
            commit.after_commit(|| events.borrow_mut().push("second"));
            Ok(7)
        })).unwrap();
        assert_eq!(value, 7);
        assert_eq!(*events.borrow(), ["open", "body", "commit", "first", "second"]);
    }

    #[test]
    fn no_hooks_on_drop_body_error_open_error_or_failed_commit() {
        for mode in 0..4 {
            let events = RefCell::new(Vec::new());
            let result = Committer::run(Member::new(Kind::Direct, |commit| {
                let tx = commit.open_with(|| {
                    if mode == 2 { return Err(RuntimeError::Store("open failed".into())); }
                    Ok(Transaction(&events, mode != 3))
                })?;
                if mode == 0 { return Ok(()); }
                if mode == 1 { return Err(RuntimeError::Store("body failed".into())); }
                commit.commit(tx)?;
                commit.after_commit(|| events.borrow_mut().push("hook"));
                Ok(())
            }));
            assert_eq!(result.is_ok(), mode == 0);
            assert!(!events.borrow().contains(&"hook"));
        }
    }
}
