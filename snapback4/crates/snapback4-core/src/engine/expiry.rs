//! Deadline ownership follows read emission, independently of the work meter.
use std::{cell::Cell, rc::Rc};

#[derive(Clone, Copy, Default)]
struct Frame {
    deadline: Option<i64>,
    depth: u32,
}

/// A detached prefix decision may seed candidates, but cannot publish a deadline.
#[derive(Clone, Copy, Default)]
pub(super) struct Pending(Option<i64>);

/// One fixed control cell per runner. Marks are stack-sized handles; nesting
/// allocates no row-dependent storage and follows the interpreter's bounded stack.
#[derive(Default)]
pub(crate) struct Expiry(Rc<Cell<Frame>>);

// @ref LLP 3000.014#5-what-derives-from-the-capture — authorization and recount deadlines are provisional until their answer is emitted.
impl Expiry {
    pub(crate) fn get(&self) -> Option<i64> {
        debug_assert_eq!(
            self.0.get().depth,
            0,
            "reply has an unfinished expiry scope"
        );
        self.0.get().deadline
    }

    pub(super) fn scope(&self) -> Mark {
        let parent = self.0.replace(Frame {
            deadline: None,
            depth: self.0.get().depth + 1,
        });
        Mark {
            cell: self.0.clone(),
            parent,
        }
    }

    pub(super) fn note(&self, at: i64) {
        let mut frame = self.0.get();
        // Raw authorization outside a read (for example a write check) has
        // no emitted answer to own a deadline.
        if frame.depth == 0 {
            return;
        }
        frame.deadline = Some(frame.deadline.map_or(at, |prior| prior.min(at)));
        self.0.set(frame);
    }

    pub(super) fn inherit(&self, pending: Pending) {
        if let Some(at) = pending.0 {
            self.note(at);
        }
    }

    pub(super) fn note_option(&self, at: Option<i64>) {
        if let Some(at) = at {
            self.note(at);
        }
    }

    // @ref LLP 3000.015#2 — the complete-rule evaluator isolates each witness
    // leaf's deadline and restores the frame with the whole rule's boundary.
    // Outside an emitting read the frame is detached: a raw write check owns
    // no deadline and observes none, exactly as `note` above.
    pub(super) fn replace(&self, deadline: Option<i64>) -> Option<i64> {
        let mut frame = self.0.get();
        if frame.depth == 0 {
            return None;
        }
        let prior = frame.deadline;
        frame.deadline = deadline;
        self.0.set(frame);
        prior
    }
}

impl Pending {
    /// The deferred boundary itself, for a caller that records it durably
    /// (a recount work record) instead of emitting it into an answer.
    pub(super) fn deadline(self) -> Option<i64> {
        self.0
    }
}

/// Every exit discards by default, including `?`, `continue`, and `break`.
/// Emission joins this mark into its enclosing answer, never past it.
#[must_use]
pub(super) struct Mark {
    cell: Rc<Cell<Frame>>,
    parent: Frame,
}
impl Mark {
    pub(super) fn emit(mut self) {
        self.parent.deadline = earliest(self.parent.deadline, self.cell.get().deadline);
    }

    pub(super) fn defer(self) -> Pending {
        Pending(self.cell.get().deadline)
    }
}
impl Drop for Mark {
    fn drop(&mut self) {
        debug_assert_eq!(
            self.cell.get().depth,
            self.parent.depth + 1,
            "expiry scopes must close in order"
        );
        self.cell.set(self.parent);
    }
}

fn earliest(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

#[cfg(test)]
impl From<Option<i64>> for Expiry {
    fn from(deadline: Option<i64>) -> Self {
        Self(Rc::new(Cell::new(Frame { deadline, depth: 0 })))
    }
}
