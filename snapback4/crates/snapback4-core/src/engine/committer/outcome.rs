//! Physical outcomes: only affirmative abort evidence permits another attempt.
use super::*;
#[cfg(test)]
use std::time::Duration;
use std::time::Instant;

pub(crate) struct Failure {
    pub error: RuntimeError,
    pub aborted: bool,
    pub member: Option<usize>,
}
impl Failure {
    pub(crate) fn may_rerun(&self) -> bool {
        self.aborted && !matches!(&self.error,RuntimeError::StoreOwnership(_) | RuntimeError::Structural { code: "E_STORE_REPLACED", .. }) &&
            !matches!(&self.error,RuntimeError::Store(message) if message.starts_with("pipeline ticket deadline"))
    }
    // Tentative member refusals have authority only after a confirmed abort.
    pub fn refusal(&self, retained: Option<crate::Refusal>) -> crate::Refusal {
        if self.aborted {
            retained.unwrap_or_else(|| self.error.refusal())
        } else {
            self.error.refusal()
        }
    }

    pub fn rollback(tx: AnyTx<'_>, error: RuntimeError, member: Option<usize>) -> Self {
        match tx.rollback() {
            Ok(()) => Self {
                error,
                aborted: true,
                member,
            },
            Err(rollback) => Self {
                error: RuntimeError::CommitOutcomeUnknown(format!(
                    "rollback was not acknowledged: {rollback}; original: {error}"
                )),
                aborted: false,
                member: None,
            },
        }
    }
    #[cfg(test)]
    pub fn commit(error: RuntimeError) -> Self {
        let aborted = false;
        Self {
            error,
            aborted,
            member: None,
        }
    }
}

// @ref LLP 3000.009.001.000.002#3.1 — only adapters attach affirmative database abort evidence; absence never proves rollback.

impl Committer {
    /// N=1 program protocol. A solo fallback gets one attempt, inside the
    /// invocation's original deadline. No reply/continuation escapes a rollback.
    #[cfg(test)]
    pub(crate) fn run_program<T, D>(
        store: &mut AnyStore,
        digest: Option<&str>,
        principal: &str,
        id: Option<&str>,
        body: impl FnMut(MemberTx<'_, '_>) -> MemberResult<Pending<T, D>>,
    ) -> Result<Resolution<T, D>, RuntimeError> {
        Self::run_program_until(
            store,
            digest,
            principal,
            id,
            Instant::now() + Duration::from_millis(100),
            body,
        )
    }
    pub(crate) fn run_program_until<T, D>(
        store: &mut AnyStore,
        digest: Option<&str>,
        principal: &str,
        id: Option<&str>,
        deadline: Instant,
        mut body: impl FnMut(MemberTx<'_, '_>) -> MemberResult<Pending<T, D>>,
    ) -> Result<Resolution<T, D>, RuntimeError> {
        for attempt in 0..2 {
            let tx = Self::open_program_before(
                store,
                digest,
                principal,
                id,
                (attempt > 0).then_some(deadline),
            )?;
            let mut budget_error = None;
            let budget = if attempt > 0 {
                match tx.bound_program_attempt(deadline) {
                    Ok(budget) => Some(budget),
                    Err(error) => {
                        budget_error = Some(error);
                        None
                    }
                }
            } else {
                None
            };
            if let Some(error) = budget_error {
                drop(budget);
                return Err(Failure::rollback(tx, error, None).error);
            }
            let ran = Self::execute(&tx, Member::new(Kind::Program, &mut body));
            drop(budget);
            let disposition = match ran {
                Ok(value) => value,
                Err(error) => return Err(Failure::rollback(tx, error, Some(0)).error),
            };
            let committed = disposition.end == Frame::Complete;
            if !committed {
                tx.rollback()?;
                return Ok(Resolution {
                    committed,
                    pending: disposition.value,
                });
            }
            if attempt > 0 && Instant::now() >= deadline {
                return Err(Failure::rollback(
                    tx,
                    RuntimeError::Store("program invocation's remaining deadline elapsed".into()),
                    None,
                )
                .error);
            }
            if let Err(error) = tx.prepare_program_commit() {
                let failure = Failure::rollback(tx, error, None);
                if failure.aborted && attempt == 0 && Instant::now() < deadline {
                    continue;
                }
                return Err(failure.error);
            }
            if attempt > 0 && Instant::now() >= deadline {
                return Err(Failure::rollback(
                    tx,
                    RuntimeError::Store("program invocation's remaining deadline elapsed".into()),
                    None,
                )
                .error);
            }
            match tx.commit_program() {
                Ok(()) => {
                    return Ok(Resolution {
                        committed,
                        pending: disposition.value,
                    });
                }
                Err(failure) => {
                    if failure.aborted && attempt == 0 && Instant::now() < deadline {
                        continue;
                    }
                    return Err(failure.error);
                }
            }
        }
        unreachable!()
    }
}

#[cfg(test)]
#[path = "../../store/committer_outcome_tests.rs"]
mod tests;
