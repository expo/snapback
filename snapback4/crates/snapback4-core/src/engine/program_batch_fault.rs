//! Deterministic boundaries supplement the real database/transport witnesses.
use crate::RuntimeError;
use std::cell::{Cell, RefCell};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) enum Point {
    BeforeMember,
    BeforeFacts,
    AfterFacts,
    BeforeLevel,
    AfterLevel,
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

// Pause after the adapter has verified its tail, before the driver can choose
// COMMIT. This models response delivery/scheduling without slowing SQL itself.
thread_local! {
    static TAIL_HOOK: RefCell<Option<Box<dyn FnMut()>>> = RefCell::new(None);
}
pub(crate) fn tail_prepared() {
    TAIL_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().as_mut() {
            hook();
        }
    });
}
pub(in crate::engine) fn with_tail_hook<T>(
    hook: impl FnMut() + 'static,
    run: impl FnOnce() -> T,
) -> T {
    struct Clear;
    impl Drop for Clear {
        fn drop(&mut self) {
            TAIL_HOOK.with(|s| {
                s.borrow_mut().take();
            });
        }
    }
    TAIL_HOOK.with(|slot| {
        assert!(slot.borrow().is_none());
        *slot.borrow_mut() = Some(Box::new(hook));
    });
    let _clear = Clear;
    run()
}
