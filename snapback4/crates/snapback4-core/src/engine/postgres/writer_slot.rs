//! Owned continuation of a buffered transaction. No borrowed engine enters a slot.
// @ref LLP 3000.009.001.000.000.002#3.10 — synchronous final flights run off the committer and the reader runtime.
use super::{
    group_commit::Head,
    store::{Store, Tx},
    tail::Tail,
};
use crate::engine::committer::overlay::{Image, RowKey};
use crate::{RuntimeError, engine::committer::outcome::Failure};
use std::{collections::BTreeMap, time::Instant};

pub(crate) struct Suspended {
    pub head: Head,
    pub ticket: i64,
    pub predecessor: Option<i64>,
    pub attempt: String,
    pub(super) tails: Vec<Tail>,
    pub images: Vec<Image>,
    pub pending: String,
    pub checks: Vec<(usize, u64)>,
    pub deadline: Instant,
    #[cfg(test)]
    pub hook: Option<Hook>,
    #[cfg(test)]
    pub ordinal: usize,
}
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Point {
    BeforeFinal,
    AfterTail,
    BeforeCommit,
    AfterCommit,
}
#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) struct Witness {
    pub point: Point,
    pub ordinal: usize,
    pub xid: String,
    pub attempt: String,
    pub ticket: i64,
}
#[cfg(test)]
pub(crate) type Hook = std::sync::Arc<dyn Fn(Witness) -> Result<(), RuntimeError> + Send + Sync>;
#[cfg(test)]
impl Suspended {
    fn check(&self, point: Point) -> Result<(), RuntimeError> {
        if let Some(hook) = &self.hook {
            hook(Witness {
                point,
                ordinal: self.ordinal,
                xid: self.head.xid.clone(),
                attempt: self.attempt.clone(),
                ticket: self.ticket,
            })?;
        }
        Ok(())
    }
}
impl Suspended {
    pub fn chain(&self, entropy: u64) -> crate::engine::program_pipeline::Chain {
        let mut receipts = BTreeMap::new();
        for tail in &self.tails {
            for r in &tail.receipts {
                receipts.insert(
                    (r.principal.clone(), r.id.clone()),
                    crate::receipts::ReceiptRecord {
                        outcome: r.outcome.clone(),
                        name: r.name.clone(),
                        args_digest: r.args_digest.clone(),
                    },
                );
            }
        }
        crate::engine::program_pipeline::Chain {
            images: self
                .images
                .iter()
                .map(|i| (i.key(), i.new.clone()))
                .collect::<BTreeMap<RowKey, _>>(),
            receipts,
            entropy,
            head: Some(Head {
                seq: self
                    .tails
                    .iter()
                    .filter_map(|t| t.commit.as_ref().map(|c| c.seq as i64))
                    .last()
                    .unwrap_or(self.head.seq),
                revision: self.head.revision + self.tails.len() as i64,
                attempt: self.attempt.clone(),
                xid: self.head.xid.clone(),
            }),
            ticket: Some(self.ticket),
        }
    }
}
impl Tx<'_> {
    pub(crate) fn chain_head(
        &self,
        chain: &crate::engine::program_pipeline::Chain,
    ) -> Result<(), RuntimeError> {
        if let Some(head) = &chain.head {
            if self.batch_ticket.is_none() {
                return Err(RuntimeError::Store("chain requires ticket batch".into()));
            }
            let xid = self
                .batch_base
                .borrow()
                .as_ref()
                .map(|h| h.xid.clone())
                .ok_or_else(|| RuntimeError::Store("missing own P1 xid".into()))?;
            *self.batch_base.borrow_mut() = Some(Head {
                xid,
                ..head.clone()
            });
            self.head.set(Some(head.seq as u64));
            self.group_head.set(Some(head.seq as u64));
        }
        Ok(())
    }
}

impl Store {
    pub(crate) fn finish_suspended(
        &mut self,
        frozen: Suspended,
    ) -> Result<Option<super::read_grant::Published>, Failure> {
        let deadline = frozen.deadline;
        #[cfg(test)]
        let check = |point| frozen.check(point);
        #[cfg(test)]
        let before = check(Point::BeforeFinal);
        #[cfg(test)]
        let hook = frozen.hook.clone();
        #[cfg(test)]
        let witness = Witness {
            point: Point::AfterTail,
            ordinal: frozen.ordinal,
            xid: frozen.head.xid.clone(),
            attempt: frozen.attempt.clone(),
            ticket: frozen.ticket,
        };
        let tx = self.resume_program(frozen).map_err(|error| Failure {
            error,
            aborted: false,
            member: None,
        })?;
        #[cfg(test)]
        let hook_check = |point| {
            if let Some(hook) = &hook {
                hook(Witness {
                    point,
                    ..witness.clone()
                })
            } else {
                Ok(())
            }
        };
        #[cfg(test)]
        let prepared = before
            .and_then(|()| tx.flush_tail())
            .and_then(|()| hook_check(Point::AfterTail))
            .and_then(|()| hook_check(Point::BeforeCommit));
        #[cfg(not(test))]
        let prepared = tx.flush_tail();
        if let Err(error) = prepared {
            let error = if matches!(&error,RuntimeError::Postgres(e) if e.code().is_some_and(|c|matches!(c.code(),"55P03"|"57014")))
            {
                RuntimeError::Store("pipeline ticket deadline elapsed".into())
            } else {
                error
            };
            let aborted = tx.rollback();
            return Err(match aborted {
                Ok(()) => Failure {
                    error,
                    aborted: true,
                    member: None,
                },
                Err(rollback) => Failure {
                    error: RuntimeError::CommitOutcomeUnknown(format!(
                        "slot rollback unacknowledged: {rollback}; original: {error}"
                    )),
                    aborted: false,
                    member: None,
                },
            });
        }
        if Instant::now() >= deadline {
            let error = RuntimeError::Store(
                "program invocation's remaining deadline elapsed after tail".into(),
            );
            let aborted = tx.rollback().is_ok();
            return Err(Failure {
                error: if aborted {
                    error
                } else {
                    RuntimeError::CommitOutcomeUnknown(
                        "deadline rollback was not acknowledged".into(),
                    )
                },
                aborted,
                member: None,
            });
        }
        let publication = tx.publication.borrow().clone();
        #[cfg(any(test, feature = "test-support"))]
        let started = Instant::now();
        let result = tx.commit_program();
        #[cfg(any(test, feature = "test-support"))]
        crate::round_trips::committed_in(started.elapsed());
        result?;
        #[cfg(test)]
        if let Err(error) = hook_check(Point::AfterCommit) {
            return Err(Failure {
                error: RuntimeError::CommitOutcomeUnknown(format!(
                    "lost final confirmation: {error}"
                )),
                aborted: false,
                member: None,
            });
        }
        Ok(publication)
    }
}

impl Store {
    // A ticket probe is an end witness even when the COMMIT reply was lost.
    pub(crate) fn drain_program_tickets(&mut self, tickets: &[i64]) -> Result<(), RuntimeError> {
        let tx = self.recovery_transaction()?;
        for ticket in tickets {
            tx.query(super::group_commit::TICKET, &[ticket])?;
        }
        tx.query(
            "SELECT seq,revision,attempt FROM _head WHERE singleton FOR UPDATE",
            &[],
        )?;
        tx.rollback()
    }
}

impl Store {
    // @ref LLP 3000.009.001.000.000.002#4.2 — timeout escalates to fenced termination; only a fresh acquisition may admit work again.
    pub(crate) fn fence_pipeline_terminal(&mut self) -> Result<Vec<i32>, RuntimeError> {
        let fence = self
            .fence
            .clone()
            .ok_or_else(|| RuntimeError::StoreOwnership("missing terminal fence".into()))?;
        let tx = self.recovery_transaction()?;
        tx.query("SELECT token FROM _owner WHERE singleton", &[])?;
        let killed = tx
            .inner
            .borrow_mut()
            .client
            .terminate_tagged(&fence.store_id, fence.token)?;
        let until = Instant::now() + std::time::Duration::from_secs(5);
        loop {
            tx.query("SELECT pg_stat_clear_snapshot()", &[])?;
            let count: i64 = tx.query(
                "SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1)",
                &[&killed],
            )?[0]
                .get(0);
            if count == 0 {
                break;
            }
            if Instant::now() >= until {
                return Err(RuntimeError::StoreOwnership(
                    "terminated pipeline backends did not exit".into(),
                ));
            }
            std::thread::park_timeout(std::time::Duration::from_millis(1));
        }
        tx.rollback()?;
        self.client.close_writer();
        Ok(killed)
    }
}
