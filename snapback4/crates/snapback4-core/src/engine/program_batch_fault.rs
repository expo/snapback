//! Deterministic boundaries supplement the real database/transport witnesses.
use crate::RuntimeError;
use std::cell::{Cell, RefCell};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) enum Point {
    BeforeMember,
    MemberSavepoint,
    ProgramSavepoint,
    ProgramRelease,
    MemberRelease,
    AfterMember,
    BeforeTail,
    AfterTail,
    BeforeCommit,
    AfterCommit,
}
thread_local! {
    static FAULT:RefCell<Option<(Point,usize,bool)>>=const{RefCell::new(None)};
    static MEMBER:Cell<usize>=const{Cell::new(usize::MAX)};
}
pub(in crate::engine) fn check(point: Point, index: usize) -> Result<(), RuntimeError> {
    FAULT.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some((p, i, fired)) = slot.as_mut()
            && *p == point
            && *i == index
            && !*fired
        {
            *fired = true;
            Err(if point == Point::AfterCommit {
                RuntimeError::CommitOutcomeUnknown(
                    "injected lost batch COMMIT acknowledgement".into(),
                )
            } else {
                RuntimeError::Store(format!("injected batch boundary {point:?} at {index}"))
            })
        } else {
            Ok(())
        }
    })
}
pub(in crate::engine) fn current(point: Point) -> Result<(), RuntimeError> {
    MEMBER.with(|i| check(point, i.get()))
}
pub(in crate::engine) struct MemberGuard(usize);
pub(in crate::engine) fn enter(index: usize) -> MemberGuard {
    MemberGuard(MEMBER.with(|i| i.replace(index)))
}
impl Drop for MemberGuard {
    fn drop(&mut self) {
        MEMBER.with(|i| i.set(self.0));
    }
}
pub(super) fn inject<T>(point: Point, index: usize, run: impl FnOnce() -> T) -> T {
    struct Clear;
    impl Drop for Clear {
        fn drop(&mut self) {
            FAULT.with(|s| {
                s.borrow_mut().take();
            });
        }
    }
    FAULT.with(|s| *s.borrow_mut() = Some((point, index, false)));
    let _clear = Clear;
    let value = run();
    assert!(
        FAULT.with(|s| s.borrow().as_ref().unwrap().2),
        "unreached {point:?}/{index}"
    );
    value
}
