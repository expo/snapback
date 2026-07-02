//! Debug-build enforcement that blocking work — Hermes eval and SQLite — never
//! runs on a tokio async worker thread.
//!
//! The server's offload helpers (`with_snapback`, the read-lane runner) wrap
//! every core execution in a [`BlockingSanction`] on a `spawn_blocking` thread.
//! Chokepoints in the runtime and storage layers call
//! [`debug_assert_off_async_worker`]; a call that reaches them from inside a
//! tokio runtime context *without* the sanction is a handler running blocking
//! work on an async worker, and fails loudly in debug/test builds. Plain
//! threads (unit tests, the bench bin, direct library use) carry no tokio
//! context and pass untouched.
//!
//! @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7: no
//! `ex_hermes_eval` or rusqlite call executes on a tokio worker.

use std::cell::Cell;

thread_local! {
    static BLOCKING_SANCTIONED: Cell<bool> = const { Cell::new(false) };
}

/// Marks the current thread as sanctioned for blocking work until dropped.
/// Nested acquisition is harmless (restores the previous state).
pub struct BlockingSanction {
    previous: bool,
}

impl BlockingSanction {
    pub fn acquire() -> Self {
        let previous = BLOCKING_SANCTIONED.with(|flag| flag.replace(true));
        Self { previous }
    }
}

impl Drop for BlockingSanction {
    fn drop(&mut self) {
        let previous = self.previous;
        BLOCKING_SANCTIONED.with(|flag| flag.set(previous));
    }
}

/// Debug assertion: the caller is about to run blocking work (an engine eval or
/// a SQLite call), which must not happen on a tokio async worker. Sanctioned
/// blocking-pool threads and non-tokio threads pass. Current-thread runtimes
/// (`#[tokio::test]` default) also pass: blocking there stalls only the
/// caller's own single-threaded runtime — the hazard this guards against is
/// starving the shared workers of the server's multi-thread runtime.
#[track_caller]
pub fn debug_assert_off_async_worker(what: &str) {
    #[cfg(debug_assertions)]
    {
        let on_multi_thread_runtime = tokio::runtime::Handle::try_current()
            .map(|handle| handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread)
            .unwrap_or(false);
        if on_multi_thread_runtime && !BLOCKING_SANCTIONED.with(Cell::get) {
            panic!(
                "{what} would block a tokio async worker; route it through the \
                 blocking offload helpers (LLP 0032 L7)"
            );
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = what;
    }
}
