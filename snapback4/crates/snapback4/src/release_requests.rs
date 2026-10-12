//! Writer-fair operation admission; leases end before socket I/O.
// @ref LLP 3000.000.000#93-http-admission-and-reporting — publication waits for execution, never a slow socket.
use std::{
    cell::RefCell,
    sync::{Arc, Condvar, Mutex},
};
#[derive(Default)]
struct State {
    readers: usize,
    writer: bool,
    waiting: usize,
}
#[derive(Default)]
pub(crate) struct Gate {
    state: Mutex<State>,
    wake: Condvar,
}
pub(crate) struct Lease {
    gate: Arc<Gate>,
    writer: bool,
}
impl Gate {
    pub(crate) fn read(self: &Arc<Self>) -> Lease {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while state.writer || state.waiting > 0 {
            state = self.wake.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        state.readers += 1;
        Lease {
            gate: self.clone(),
            writer: false,
        }
    }
    pub(crate) fn write(self: &Arc<Self>) -> Lease {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.waiting += 1;
        while state.writer || state.readers > 0 {
            state = self.wake.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        state.waiting -= 1;
        state.writer = true;
        Lease {
            gate: self.clone(),
            writer: true,
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut state = self.gate.state.lock().unwrap_or_else(|e| e.into_inner());
        if self.writer {
            state.writer = false;
        } else {
            state.readers -= 1;
        }
        self.gate.wake.notify_all();
    }
}
thread_local! {static REQUEST:RefCell<(Option<Lease>,Option<u64>)>=const{RefCell::new((None,None))};}
pub(crate) struct Scope;
impl Scope {
    pub(crate) fn begin(generation: u64) -> Self {
        REQUEST.with(|r| *r.borrow_mut() = (None, Some(generation)));
        Self
    }
    pub(crate) fn admit(gate: &Arc<Gate>, generation: impl FnOnce() -> u64) {
        let lease = gate.read();
        REQUEST.with(|r| *r.borrow_mut() = (Some(lease), Some(generation())));
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        REQUEST.with(|r| *r.borrow_mut() = (None, None));
    }
}
pub(crate) fn stamp(generation: u64) {
    REQUEST.with(|r| r.borrow_mut().1 = Some(generation));
}
pub(crate) fn reply_generation() -> Option<u64> {
    REQUEST.with(|r| r.borrow().1)
}
pub(crate) fn executed() {
    REQUEST.with(|r| r.borrow_mut().0.take());
}
