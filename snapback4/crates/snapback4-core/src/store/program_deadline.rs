//! A retry deadline covers SQLite lock acquisition as well as VM execution.
use super::*;
use std::{
    cell::Cell,
    time::{Duration, Instant},
};
thread_local! { static DEADLINE: Cell<Option<Instant>> = const {Cell::new(None)}; }
fn busy(_: i32) -> bool {
    DEADLINE.with(|slot| {
        let Some(remaining) = slot
            .get()
            .and_then(|deadline| deadline.checked_duration_since(Instant::now()))
        else {
            return false;
        };
        std::thread::sleep(remaining.min(Duration::from_millis(1)));
        slot.get().is_some_and(|deadline| Instant::now() < deadline)
    })
}
// SQLite invokes its busy handler on the caller thread. The actor's scopes do
// not overlap on one connection; nested scopes on other connections restore
// their predecessor's deadline. No callback or deadline survives COMMIT.
// @ref LLP 3000.009.001.000.002#3.1 — all cancellable fallback work shares the original remaining deadline.
pub(crate) struct Budget<'a> {
    conn: &'a Connection,
    timeout: Duration,
    previous: Option<Instant>,
}
impl<'a> Budget<'a> {
    pub(crate) fn begin(conn: &'a Connection, deadline: Instant) -> Result<Self, RuntimeError> {
        if Instant::now() >= deadline {
            return Err(RuntimeError::Store(
                "program invocation's remaining deadline elapsed".into(),
            ));
        }
        let timeout = Duration::from_millis(
            conn.query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))?
                .max(0) as u64,
        );
        // Preserve a host's shorter contention policy too. The callback samples
        // one absolute cutoff, rather than restarting a timeout at each wait.
        let deadline = deadline.min(Instant::now() + timeout);
        let previous = DEADLINE.with(|slot| {
            slot.replace(Some(
                slot.get().map_or(deadline, |prior| prior.min(deadline)),
            ))
        });
        if let Err(error) = conn.busy_handler(Some(busy)) {
            DEADLINE.with(|slot| slot.set(previous));
            return Err(error.into());
        }
        Ok(Self {
            conn,
            timeout,
            previous,
        })
    }
}
impl Drop for Budget<'_> {
    fn drop(&mut self) {
        let _ = self.conn.busy_timeout(self.timeout);
        DEADLINE.with(|slot| slot.set(self.previous));
    }
}
impl Store {
    pub(crate) fn program_transaction_until(
        &mut self,
        deadline: Instant,
    ) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        let _budget = Budget::begin(&self.conn, deadline)?;
        // The &mut Store still gives exclusive custody. The shared SQLite
        // opener lets the timeout guard restore policy on both BEGIN outcomes.
        let tx = rusqlite::Transaction::new_unchecked(
            &self.conn,
            rusqlite::TransactionBehavior::Immediate,
        )?;
        let read_storage = self.read_sessions.snapshot()?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation(
                "the store adopted another backend; reopen this engine".into(),
            ));
        }
        if Instant::now() >= deadline {
            return Err(RuntimeError::Store(
                "program invocation's remaining deadline elapsed".into(),
            ));
        }
        Ok(Tx {
            lifecycle: false,
            read_sessions: &self.read_sessions,
            read_sessions_installed: Default::default(),
            read_sessions_at_start: *read_storage,
            read_sessions_installation: Default::default(),
            activation_scan: None,
            changes: Default::default(),
            sequence_table: Default::default(),
            tx,
            page_size: self.page_size,
            server: self.server,
            catalog: &self.catalog,
        })
    }
}
