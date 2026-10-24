//! Physical transaction custody and savepoint-scoped members.
use crate::{
    RuntimeError,
    store_port::{AnyStore, AnyTx},
};
use std::cell::Cell;

mod member_store;
pub(crate) mod reads;
pub(crate) mod overlay;
pub(crate) mod outcome;

// @ref LLP 3000.009.001.000.000#3.2 — kinds describe durable units, including writes that publish no sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Program,
    Engine,
    Publication,
    Direct,
    Administrative,
}

type MemberResult<T> = Result<Disposition<T>, RuntimeError>;

pub(crate) struct Member<F> {
    kind: Kind,
    run: F,
}

impl<F> Member<F> {
    pub(crate) fn new<T>(kind: Kind, run: F) -> Self
    where
        F: FnOnce(MemberTx<'_, '_>) -> MemberResult<T>,
    {
        Self { kind, run }
    }
    pub(crate) fn pending<T, R, D>(
        self,
        map: impl FnOnce(T) -> Pending<R, D>,
    ) -> Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<Pending<R, D>>>
    where
        F: FnOnce(MemberTx<'_, '_>) -> MemberResult<T>,
    {
        Member::new(self.kind, |tx| (self.run)(tx).map(|d| d.map(map)))
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
pub(super) enum Frame {
    Active,
    Complete,
    Abort,
    Failed,
}

/// Restricted store operations, with no owning AnyTx or connection access.
// @ref LLP 3000.009.001.000.000#3.7 — rollback/drop undo only this member, never a preceding member.
pub(crate) struct MemberTx<'member, 'store> {
    tx: &'member AnyTx<'store>,
    frame: &'member Cell<Frame>,
    reads: std::cell::RefCell<reads::ReadSet>,
    #[cfg(test)]
    rollback_failure: Cell<Option<RuntimeError>>,
}
impl MemberTx<'_, '_> {
    /// Release this member; the driver still owes the physical COMMIT.
    pub(crate) fn complete<T>(self, value: T) -> MemberResult<T> {
        #[cfg(test)]
        super::program_batch::fault::current(super::program_batch::fault::Point::MemberRelease)?;
        self.tx.release("member")?;
        self.frame.set(Frame::Complete);
        Ok(Disposition {
            end: Frame::Complete,
            value,
        })
    }

    /// Explicit rollback keeps its fallible contract, including replay paths.
    pub(crate) fn rollback<T>(self, value: T) -> MemberResult<T> {
        self.rollback_frame()?;
        Ok(Disposition {
            end: Frame::Abort,
            value,
        })
    }

    /// A normal early return must prove its frame rolled back before it can
    /// acknowledge the value or share a batch. Preserve any original SQL error.
    pub(crate) fn abort<T>(self, value: T) -> MemberResult<T> {
        self.rollback(value)
    }

    fn rollback_frame(&self) -> Result<(), RuntimeError> {
        if self.frame.get() == Frame::Active {
            self.frame.set(Frame::Failed);
            #[cfg(test)]
            if let Some(error) = self.rollback_failure.take() {
                return Err(error);
            }
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
        #[cfg(test)]
        if name == "program" {
            super::program_batch::fault::current(
                super::program_batch::fault::Point::ProgramSavepoint,
            )?;
        }
        self.tx.savepoint(Self::nested(name)?)
    }
    pub(crate) fn release(&self, name: &str) -> Result<(), RuntimeError> {
        #[cfg(test)]
        if name == "program" {
            super::program_batch::fault::current(
                super::program_batch::fault::Point::ProgramRelease,
            )?;
        }
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

/// Owned follow-up data and the value acknowledged after it runs.
pub(crate) struct Pending<T, D = ()> {
    pub(super) value: T,
    pub(super) data: D,
}
impl<T, D> Pending<T, D> {
    pub(crate) fn new(value: T, data: D) -> Self {
        Self { value, data }
    }
}
impl<T> Pending<T> {
    pub(crate) fn value(value: T) -> Self {
        Self::new(value, ())
    }
}

/// A durable acknowledgement may cross adapter/engine continuation stages.
pub(crate) struct Committed<T>(T);
impl<T> Committed<T> {
    pub(crate) fn pending<D>(self, data: D) -> Resolution<T, D> {
        Resolution {
            committed: true,
            pending: Pending::new(self.0, data),
        }
    }
    pub(crate) fn into_inner(self) -> T {
        self.0
    }
}

/// Constructed only by the physical driver, before any continuation runs.
pub(crate) struct Resolution<T, D = ()> {
    pub(super) committed: bool,
    pub(super) pending: Pending<T, D>,
}

/// Scoped openers preserve legacy identity transaction modes without exposing
/// an owning transaction to member bodies. Only the driver receives the handle.
pub(crate) trait TransactionSource {
    fn with_transaction<T>(
        self,
        run: impl FnOnce(AnyTx<'_>) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError>;
}
impl TransactionSource for &mut AnyStore {
    fn with_transaction<T>(
        self,
        run: impl FnOnce(AnyTx<'_>) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        run(self.transaction()?)
    }
}

pub(crate) struct Committer;
impl Committer {
    pub(super) fn open_program<'store>(
        store: &'store mut AnyStore,
        digest: Option<&str>,
        principal: &str,
        id: Option<&str>,
    ) -> Result<AnyTx<'store>, RuntimeError> {
        match digest {
            Some(digest) => store.request_write_transaction(digest, principal, id),
            None => store.transaction(),
        }
    }
    pub(super) fn open_program_before<'store>(
        store: &'store mut AnyStore,
        digest: Option<&str>,
        principal: &str,
        id: Option<&str>,
        deadline: Option<std::time::Instant>,
    ) -> Result<AnyTx<'store>, RuntimeError> {
        match deadline {
            Some(deadline) => store.program_transaction_until(digest, principal, id, deadline),
            None => Self::open_program(store, digest, principal, id),
        }
    }
    pub(super) fn resolution<T, D>(disposition: Disposition<Pending<T, D>>) -> Resolution<T, D> {
        Resolution {
            committed: disposition.end == Frame::Complete,
            pending: disposition.value,
        }
    }
    pub(crate) fn run<T>(
        store: impl TransactionSource,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<T>>,
    ) -> Result<T, RuntimeError> {
        store.with_transaction(|tx| Self::run_transaction_value(tx, member))
    }

    pub(crate) fn run_pending<T, D>(
        store: &mut AnyStore,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<Pending<T, D>>>,
    ) -> Result<Resolution<T, D>, RuntimeError> {
        Self::run_transaction(store.transaction()?, member)
    }

    pub(crate) fn run_transaction<T, D>(
        tx: AnyTx<'_>,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<Pending<T, D>>>,
    ) -> Result<Resolution<T, D>, RuntimeError> {
        let disposition = Self::execute(&tx, member)?;
        let committed = disposition.end == Frame::Complete;
        if committed {
            tx.commit()?;
        } else {
            drop(tx);
        }
        Ok(Resolution {
            committed,
            pending: disposition.value,
        })
    }

    pub(crate) fn run_transaction_value<T>(
        tx: AnyTx<'_>,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<T>>,
    ) -> Result<T, RuntimeError> {
        Self::run_transaction(tx, member.pending(Pending::value)).map(|r| r.pending.value)
    }

    /// Host context is borrowed separately for the body and its continuation;
    /// no transaction borrow can reach the continuation or its follow-on member.
    // @ref LLP 3000.009.001.000.000#3.7 — acknowledge in submission order only after durable COMMIT and continuation.
    pub(crate) fn run_with<H, T, D>(
        host: &mut H,
        prepare: impl FnOnce(&mut H) -> Result<Resolution<T, D>, RuntimeError>,
        continuation: impl FnOnce(&mut H, D, T) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        let resolution = prepare(host)?;
        Self::finish(host, resolution, continuation)
    }

    pub(crate) fn run_committed_with<H, T, D, R>(
        host: &mut H,
        prepare: impl FnOnce(&mut H) -> Result<Resolution<T, D>, RuntimeError>,
        continuation: impl FnOnce(&mut H, D, T) -> Result<R, RuntimeError>,
    ) -> Result<Committed<R>, RuntimeError> {
        let resolution = prepare(host)?;
        if !resolution.committed {
            return Err(RuntimeError::Store(
                "commit acknowledgement requires completion".into(),
            ));
        }
        Self::continue_pending(host, resolution.pending, continuation).map(Committed)
    }

    pub(super) fn finish<H, T, D>(
        host: &mut H,
        resolution: Resolution<T, D>,
        continuation: impl FnOnce(&mut H, D, T) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        if resolution.committed {
            Self::continue_pending(host, resolution.pending, continuation)
        } else {
            Ok(resolution.pending.value)
        }
    }

    fn continue_pending<H, T, D, R>(
        host: &mut H,
        pending: Pending<T, D>,
        continuation: impl FnOnce(&mut H, D, T) -> Result<R, RuntimeError>,
    ) -> Result<R, RuntimeError> {
        let Pending { value, data } = pending;
        continuation(host, data, value)
            .map_err(|source| RuntimeError::Continuation(Box::new(source)))
    }

    pub(super) fn execute<T>(
        tx: &AnyTx<'_>,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<T>>,
    ) -> MemberResult<T> {
        Self::execute_handled(tx, member, None::<fn(RuntimeError) -> T>)
    }
    pub(super) fn execute_program<T>(
        tx: &AnyTx<'_>,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<T>>,
        refused: impl FnOnce(RuntimeError) -> T,
    ) -> MemberResult<T> {
        Self::execute_handled(tx, member, Some(refused))
    }
    fn execute_handled<T>(
        tx: &AnyTx<'_>,
        member: Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<T>>,
        refused: Option<impl FnOnce(RuntimeError) -> T>,
    ) -> MemberResult<T> {
        let Member { kind, run } = member;
        // Legacy producers enter alone; the program-only driver reuses this
        // facade serially inside its fenced group transaction.
        let _kind = kind;
        tx.begin_member_evidence();
        #[cfg(test)]
        super::program_batch::fault::current(super::program_batch::fault::Point::MemberSavepoint)?;
        tx.savepoint("member")?;
        let frame = Cell::new(Frame::Active);
        let ran = run(MemberTx {
            tx,
            frame: &frame,
            reads: Default::default(),
            #[cfg(test)]
            rollback_failure: Cell::new(None),
        });
        let disposition = match ran {
            Ok(disposition) => disposition,
            Err(error)
                if error.is_refusal() && frame.get() == Frame::Abort && refused.is_some() =>
            {
                Disposition {
                    end: Frame::Abort,
                    value: refused.unwrap()(error),
                }
            }
            Err(error) => return Err(error),
        };
        if !matches!(frame.get(), Frame::Complete | Frame::Abort) || frame.get() != disposition.end
        {
            return Err(RuntimeError::Store(
                "member disposition contradicts its frame".into(),
            ));
        }
        Ok(disposition)
    }

    /// Facade-only batch witness; production program groups use program_batch.
    #[cfg(test)]
    fn run_batch_with<T, D>(
        store: &mut AnyStore,
        members: impl IntoIterator<
            Item = Member<impl FnOnce(MemberTx<'_, '_>) -> MemberResult<Pending<T, D>>>,
        >,
        mut continuation: impl FnMut(&mut AnyStore, D, T) -> Result<T, RuntimeError>,
    ) -> Result<Vec<Result<T, RuntimeError>>, RuntimeError> {
        let tx = store.transaction()?;
        let mut resolutions = Vec::new();
        for member in members {
            let disposition = Self::execute(&tx, member)?;
            resolutions.push(Resolution {
                committed: disposition.end == Frame::Complete,
                pending: disposition.value,
            });
        }
        tx.commit()?;
        // A failed follow-up does not uncommit this or any later member, nor
        // prevent another committed member's continuation from running.
        Ok(resolutions
            .into_iter()
            .map(|r| Self::finish(store, r, &mut continuation))
            .collect())
    }

    /// Activation and Following prepare one raw IMMEDIATE transaction over a
    /// candidate catalog. This administrative escape is explicitly solo.
    pub(crate) fn run_solo<T, D>(
        kind: Kind,
        run: impl FnOnce(&mut Solo) -> Result<Pending<T, D>, RuntimeError>,
    ) -> Result<Resolution<T, D>, RuntimeError> {
        assert_eq!(
            kind,
            Kind::Administrative,
            "raw transactions are solo administrative members"
        );
        let mut solo = Solo {
            opened: false,
            committed: false,
        };
        let pending = run(&mut solo)?;
        Ok(Resolution {
            committed: solo.committed,
            pending,
        })
    }
}

pub(crate) trait CommitTransaction {
    fn commit_transaction(self) -> Result<(), RuntimeError>;
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
}

impl super::Engine {
    /// Publish the currently durable head and accepted engine identity to a
    /// host's wake state while the writer is owned. Serving runs this stage
    /// on its committer thread. Callers without commit facts take fresh snapshots.
    pub fn continue_durable_publication<D, R>(
        &self,
        data: D,
        publish: impl FnOnce(D, u64, Option<String>, u64) -> Result<R, RuntimeError>,
    ) -> Result<R, RuntimeError> {
        let seq = self.seq()?;
        let store_id = self.store.store_identity().unwrap_or(None);
        let pending = Pending::new((), (data, seq, store_id, self.generation));
        Committer::continue_pending(
            &mut (),
            pending,
            |_, (data, seq, store_id, generation), ()| publish(data, seq, store_id, generation),
        )
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
    fn solo_runs_owned_continuations_after_commit_in_order() {
        let mut events = RefCell::new(Vec::new());
        let value = Committer::run_with(
            &mut events,
            |events| {
                Committer::run_solo(Kind::Administrative, |commit| {
                    let tx = commit.open_solo_with(|| {
                        events.borrow_mut().push("open");
                        Ok(Transaction(events, true))
                    })?;
                    events.borrow_mut().push("body");
                    commit.commit(tx)?;
                    Ok(Pending::new(
                        7,
                        vec!["first", "second", "adapter", "engine"],
                    ))
                })
            },
            |events, data, value| {
                events.borrow_mut().extend(data);
                Ok(value)
            },
        )
        .unwrap();
        assert_eq!(value, 7);
        assert_eq!(
            *events.borrow(),
            [
                "open", "body", "commit", "first", "second", "adapter", "engine"
            ]
        );
    }

    #[test]
    fn solo_has_no_continuation_on_abort_body_open_or_commit_error() {
        for mode in 0..4 {
            let mut events = RefCell::new(Vec::new());
            let result = Committer::run_with(
                &mut events,
                |events| {
                    Committer::run_solo(Kind::Administrative, |commit| {
                        let tx = commit.open_solo_with(|| {
                            if mode == 2 {
                                return Err(RuntimeError::Store("open failed".into()));
                            }
                            Ok(Transaction(events, mode != 3))
                        })?;
                        if mode == 0 {
                            return Ok(Pending::value(()));
                        }
                        if mode == 1 {
                            return Err(RuntimeError::Store("body failed".into()));
                        }
                        commit.commit(tx)?;
                        Ok(Pending::value(()))
                    })
                },
                |events, (), ()| {
                    events.borrow_mut().push("continuation");
                    Ok(())
                },
            );
            assert_eq!(result.is_ok(), mode == 0);
            assert!(!events.borrow().contains(&"continuation"));
        }
    }
}

#[cfg(all(test, feature = "postgres"))]
#[path = "postgres/tests/members.rs"]
mod postgres_tests;

#[cfg(all(test, feature = "postgres"))]
#[path = "postgres/tests/maintained_members.rs"]
mod maintained_members;
