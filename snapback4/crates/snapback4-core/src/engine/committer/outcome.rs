//! Physical outcomes: only affirmative abort evidence permits another attempt.
use super::*;
use std::time::{Duration, Instant};

pub(crate) struct Failure {
    pub error: RuntimeError,
    pub aborted: bool,
    pub member: Option<usize>,
}
impl Failure {
    pub fn rollback(tx: AnyTx<'_>, error: RuntimeError, member: Option<usize>) -> Self {
        match tx.rollback() {
            Ok(()) => Self { error, aborted: true, member },
            Err(rollback) => Self { error: RuntimeError::CommitOutcomeUnknown(format!("rollback was not acknowledged: {rollback}; original: {error}")), aborted: false, member: None },
        }
    }
    pub fn commit(error: RuntimeError) -> Self {
        let aborted = explicit_commit_abort(&error);
        Self { error, aborted, member: None }
    }
}

// @ref LLP 3000.009.001.000.002#3.1 — a timeout, broken connection or missing receipt never proves abort.
fn explicit_commit_abort(error: &RuntimeError) -> bool {
    #[cfg(feature = "postgres")]
    if let RuntimeError::Postgres(error) = error {
        return error.code().is_some_and(|code| matches!(code.code(), "40001" | "40P01") || code.code().starts_with("23"));
    }
    let _ = error;
    false
}

impl Committer {
    /// N=1 program protocol. A solo fallback gets one attempt, inside the
    /// invocation's original deadline. No reply/continuation escapes a rollback.
    pub(crate) fn run_program<T, D>(store: &mut AnyStore, digest: Option<&str>, principal: &str, id: Option<&str>,
        mut body: impl FnMut(MemberTx<'_, '_>) -> MemberResult<Pending<T, D>>,
    ) -> Result<Resolution<T, D>, RuntimeError> {
        let deadline = Instant::now() + Duration::from_millis(100);
        for attempt in 0..2 {
            let tx = match digest {
                Some(digest) => store.request_write_transaction(digest, principal, id)?,
                None => store.transaction()?,
            };
            let disposition = match Self::execute(&tx, Member::new(Kind::Program, &mut body)) {
                Ok(value) => value,
                Err(error) => return Err(Failure::rollback(tx, error, Some(0)).error),
            };
            let committed = disposition.end == Frame::Complete;
            if !committed {
                tx.rollback()?;
                return Ok(Resolution { committed, pending: disposition.value });
            }
            if let Err(error) = tx.prepare_program_commit() {
                let failure = Failure::rollback(tx, error, None);
                if failure.aborted && attempt == 0 && Instant::now() < deadline { continue; }
                return Err(failure.error);
            }
            match tx.commit_program() {
                Ok(()) => return Ok(Resolution { committed, pending: disposition.value }),
                Err(failure) => {
                    if failure.aborted && attempt == 0 && Instant::now() < deadline { continue; }
                    return Err(failure.error);
                }
            }
        }
        unreachable!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn known_commit_rollback_reruns_once_without_publishing_first_attempt() {
        let mut store = AnyStore::memory().unwrap();
        store.test_support_conn().execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1); CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)").unwrap();
        let attempts = Cell::new(0);
        let resolution = Committer::run_program(&mut store, None, "alice", None, |tx| {
            attempts.set(attempts.get() + 1);
            tx.tx.test_support_conn().execute("INSERT INTO child VALUES(?1)", [if attempts.get() == 1 { 2 } else { 1 }])?;
            tx.complete(Pending::new(attempts.get(), attempts.get()))
        }).unwrap();
        assert_eq!(attempts.get(), 2);
        let value = Committer::finish(&mut store, resolution, |store, data, value| {
            assert_eq!(store.test_support_conn().query_row("SELECT count(*) FROM child", [], |row| row.get::<_, i64>(0))?, 1);
            assert_eq!(data, 2);
            Ok(value)
        }).unwrap();
        assert_eq!(value, 2);
    }

    #[test]
    fn failed_rollback_does_not_authorize_rerun() {
        let mut store = AnyStore::memory().unwrap();
        let attempts = Cell::new(0);
        let result: Result<Resolution<()>, _> = Committer::run_program(&mut store, None, "alice", None, |tx| {
            attempts.set(attempts.get() + 1);
            tx.tx.test_support_conn().execute_batch("ROLLBACK")?;
            Err(RuntimeError::Store("original failure".into()))
        });
        assert!(matches!(result, Err(RuntimeError::CommitOutcomeUnknown(_))));
        assert_eq!(attempts.get(), 1);
    }

    #[test]
    fn ambiguity_ownership_loss_and_transport_absence_are_not_abort_evidence() {
        for error in [RuntimeError::CommitOutcomeUnknown("lost ack".into()), RuntimeError::StoreOwnership("new owner".into()), RuntimeError::Store("disconnected".into())] {
            assert!(!Failure::commit(error).aborted);
        }
    }
}
