//! Reference committer: a physical transaction with one savepoint-scoped member.
use crate::{RuntimeError, Store, store::Tx};
use std::cell::Cell;

mod member_store;

// @ref LLP 3000.009.001.000.000#3.2 — kinds describe durable units, including writes that publish no sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Program,
    Engine,
    Publication,
    Direct,
    Administrative,
}

pub(crate) struct Member<F> {
    kind: Kind,
    run: F,
}

impl<F> Member<F> {
    pub(crate) fn new<T>(kind: Kind, run: F) -> Self
    where
        F: FnOnce(MemberTx<'_, '_>) -> Result<Disposition<T>, RuntimeError>,
    {
        Self { kind, run }
    }
}

/// Only a facade that has ended its frame can produce this token.
pub(crate) struct Disposition<T> {
    end: Frame,
    value: T,
}
impl<T> Disposition<T> {
    pub(crate) fn map<R>(self, map: impl FnOnce(T) -> R) -> Disposition<R> {
        Disposition {
            end: self.end,
            value: map(self.value),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Frame {
    Active,
    Complete,
    Abort,
    Failed,
}

/// Restricted store operations, with no owning Tx or connection access.
// @ref LLP 3000.009.001.000.000#3.7 — rollback/drop undo only this member, never a preceding member.
pub(crate) struct MemberTx<'member, 'store> {
    tx: &'member Tx<'store>,
    frame: &'member Cell<Frame>,
}
impl MemberTx<'_, '_> {
    /// Release this member; the driver still owes the physical COMMIT.
    pub(crate) fn complete<T>(self, value: T) -> Result<Disposition<T>, RuntimeError> {
        self.tx.release("member")?;
        self.frame.set(Frame::Complete);
        Ok(Disposition {
            end: Frame::Complete,
            value,
        })
    }

    /// Explicit rollback keeps its fallible contract, including replay paths.
    pub(crate) fn rollback<T>(self, value: T) -> Result<Disposition<T>, RuntimeError> {
        self.rollback_frame()?;
        Ok(Disposition {
            end: Frame::Abort,
            value,
        })
    }

    /// Normal early returns historically ignored rollback errors. The driver
    /// still rejects a failed frame rollback before it can commit any batch.
    pub(crate) fn abort<T>(self, value: T) -> Disposition<T> {
        let _ = self.rollback_frame();
        Disposition {
            end: Frame::Abort,
            value,
        }
    }

    fn rollback_frame(&self) -> Result<(), RuntimeError> {
        if self.frame.get() == Frame::Active {
            self.frame.set(Frame::Failed);
            self.tx.rollback_to("member")?;
            self.frame.set(Frame::Abort);
        }
        Ok(())
    }

    fn nested(name: &str) -> Result<&str, RuntimeError> {
        match name {
            "program" | "job_chunk" | "timeline_chunk" | "seed_sequences" => Ok(name),
            _ => Err(RuntimeError::Store(
                "invalid nested member savepoint".into(),
            )),
        }
    }
    pub(crate) fn savepoint(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.savepoint(Self::nested(name)?)
    }
    pub(crate) fn release(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.release(Self::nested(name)?)
    }
    pub(crate) fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.rollback_to(Self::nested(name)?)
    }
}
impl Drop for MemberTx<'_, '_> {
    fn drop(&mut self) {
        let _ = self.rollback_frame();
    }
}

/// A successful physical commit's acknowledgement across adapter/engine layers.
pub(crate) struct Committed<T>(T);
impl<T> Committed<T> {
    pub(crate) fn after_commit<R>(self, hook: impl FnOnce(T) -> R) -> Committed<R> {
        Committed(hook(self.0))
    }
    pub(crate) fn into_inner(self) -> T {
        self.0
    }
}

pub(crate) struct Committer;
impl Committer {
    pub(crate) fn run<T>(
        store: &mut Store,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> Result<Disposition<T>, RuntimeError>>,
    ) -> Result<T, RuntimeError> {
        let tx = store.transaction()?;
        match Self::execute(&tx, member)? {
            Disposition {
                end: Frame::Complete,
                value,
            } => {
                tx.commit()?;
                Ok(value)
            }
            Disposition {
                end: Frame::Abort,
                value,
            } => {
                // Tx's drop issues ROLLBACK, as on the old normal early returns.
                drop(tx);
                Ok(value)
            }
            _ => unreachable!("execute validates the frame"),
        }
    }

    fn execute<T>(
        tx: &Tx<'_>,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> Result<Disposition<T>, RuntimeError>>,
    ) -> Result<Disposition<T>, RuntimeError> {
        let Member { kind, run } = member;
        // No production batching, queue, revision allocation or retries in K0b.
        let _kind = kind;
        *tx.changes.borrow_mut() = Default::default();
        tx.savepoint("member")?;
        let frame = Cell::new(Frame::Active);
        let disposition = run(MemberTx { tx, frame: &frame })?;
        if !matches!(frame.get(), Frame::Complete | Frame::Abort) || frame.get() != disposition.end
        {
            return Err(RuntimeError::Store(
                "member disposition contradicts its frame".into(),
            ));
        }
        Ok(disposition)
    }

    /// Reset has no normal abort result; acknowledge only after physical COMMIT.
    pub(crate) fn run_committed<T>(
        store: &mut Store,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> Result<Disposition<T>, RuntimeError>>,
    ) -> Result<Committed<T>, RuntimeError> {
        Self::run(
            store,
            Member::new(member.kind, |tx| match (member.run)(tx)? {
                disposition @ Disposition {
                    end: Frame::Complete,
                    ..
                } => Ok(disposition),
                _ => Err(RuntimeError::Store(
                    "commit acknowledgement requires completion".into(),
                )),
            }),
        )
        .map(Committed)
    }

    /// Activation and Following prepare one raw IMMEDIATE transaction over a
    /// candidate catalog. This administrative escape is explicitly solo.
    pub(crate) fn run_solo<T>(
        kind: Kind,
        run: impl FnOnce(&mut Solo) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        assert_eq!(
            kind,
            Kind::Administrative,
            "raw transactions are solo administrative members"
        );
        run(&mut Solo {
            opened: false,
            committed: false,
        })
    }
}

pub(crate) trait CommitTransaction {
    fn commit_transaction(self) -> Result<(), RuntimeError>;
}
impl CommitTransaction for Tx<'_> {
    fn commit_transaction(self) -> Result<(), RuntimeError> {
        self.commit()
    }
}

pub(crate) struct Solo {
    opened: bool,
    committed: bool,
}
impl Solo {
    pub(crate) fn open_solo_with<X>(
        &mut self,
        open: impl FnOnce() -> Result<X, RuntimeError>,
    ) -> Result<X, RuntimeError> {
        assert!(!self.opened, "one transaction per solo member");
        let tx = open()?;
        self.opened = true;
        Ok(tx)
    }
    pub(crate) fn commit(&mut self, tx: impl CommitTransaction) -> Result<(), RuntimeError> {
        assert!(self.opened && !self.committed, "one commit per solo member");
        tx.commit_transaction()?;
        self.committed = true;
        Ok(())
    }
    pub(crate) fn committed<T>(&self, value: T) -> Committed<T> {
        assert!(
            self.committed,
            "commit acknowledgement requires a successful commit"
        );
        Committed(value)
    }
    pub(crate) fn after_commit<T>(&self, hook: impl FnOnce() -> T) -> T {
        assert!(
            self.committed,
            "post-commit hook requires a successful commit"
        );
        hook()
    }
}

#[cfg(test)]
#[path = "../store/committer_tests.rs"]
mod sqlite_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Transaction<'a>(&'a RefCell<Vec<&'static str>>, bool);
    impl CommitTransaction for Transaction<'_> {
        fn commit_transaction(self) -> Result<(), RuntimeError> {
            self.0.borrow_mut().push("commit");
            if self.1 {
                Ok(())
            } else {
                Err(RuntimeError::Store("commit failed".into()))
            }
        }
    }

    #[test]
    fn solo_opens_runs_commits_then_runs_hooks_in_order() {
        let events = RefCell::new(Vec::new());
        let value = Committer::run_solo(Kind::Administrative, |commit| {
            let tx = commit.open_solo_with(|| {
                events.borrow_mut().push("open");
                Ok(Transaction(&events, true))
            })?;
            events.borrow_mut().push("body");
            commit.commit(tx)?;
            commit.after_commit(|| events.borrow_mut().push("first"));
            commit.after_commit(|| events.borrow_mut().push("second"));
            Ok(commit.committed(7))
        })
        .unwrap();
        let value = value
            .after_commit(|value| {
                events.borrow_mut().push("adapter hook");
                value
            })
            .after_commit(|value| {
                events.borrow_mut().push("engine hook");
                value
            })
            .into_inner();
        assert_eq!(value, 7);
        assert_eq!(
            *events.borrow(),
            [
                "open",
                "body",
                "commit",
                "first",
                "second",
                "adapter hook",
                "engine hook"
            ]
        );
    }

    #[test]
    fn solo_has_no_hooks_on_drop_body_error_open_error_or_failed_commit() {
        for mode in 0..4 {
            let events = RefCell::new(Vec::new());
            let result = Committer::run_solo(Kind::Administrative, |commit| {
                let tx = commit.open_solo_with(|| {
                    if mode == 2 {
                        return Err(RuntimeError::Store("open failed".into()));
                    }
                    Ok(Transaction(&events, mode != 3))
                })?;
                if mode == 0 {
                    return Ok(());
                }
                if mode == 1 {
                    return Err(RuntimeError::Store("body failed".into()));
                }
                commit.commit(tx)?;
                commit.after_commit(|| events.borrow_mut().push("hook"));
                Ok(())
            });
            assert_eq!(result.is_ok(), mode == 0);
            assert!(!events.borrow().contains(&"hook"));
        }
    }
}
