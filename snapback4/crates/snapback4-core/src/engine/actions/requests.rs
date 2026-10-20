//! Store-neutral access to durable action and route requests.
//! Policy chooses transitions and checks authority in `actions`; adapters only
//! read and write these facts within the caller's transaction.
// @ref LLP 3000.009.001.000#3.3 — extract access before adding Postgres behavior.
use super::ActionRequest;
use crate::{RuntimeError, identity::Authority};
use std::{borrow::Cow, collections::BTreeMap};

pub(crate) struct NewRequest<'a> {
    pub id: &'a str,
    pub action: &'a str,
    pub args: &'a str,
    pub principal: &'a str,
    pub at: i64,
    pub authority: Option<&'a Authority>,
    pub args_digest: &'a str,
    pub spec: &'a str,
    pub contract: &'a str,
    pub deadline: Option<i64>,
    pub release: Option<&'a str>,
    pub service_generation: Option<i64>,
}

// @ref LLP 3000.009.001.000#9.1 — reject storage names before either dialect sees them.
pub(crate) fn validate_text(values: &[&str]) -> Result<(), RuntimeError> {
    if values.iter().any(|value| value.contains('\0')) {
        return Err(RuntimeError::Input(
            "request identifiers and names cannot contain U+0000".into(),
        ));
    }
    Ok(())
}

impl NewRequest<'_> {
    pub(crate) fn validate(&self) -> Result<(), RuntimeError> {
        // args and spec are JSON; their encoders escape NUL. Digests, release
        // and contract are plain text and use the same validation as names.
        validate_text(&[
            self.id,
            self.action,
            self.principal,
            self.args_digest,
            self.contract,
            self.release.unwrap_or(""),
            self.authority
                .map_or("", |authority| authority.family.as_str()),
        ])
    }
}

// @ref LLP 3000.009.001.000#9.1 — normalize diagnostics before policy truncates them.
pub(crate) fn diagnostic_text(text: &str) -> Cow<'_, str> {
    if text.contains('\0') {
        Cow::Owned(text.replace('\0', "\u{fffd}"))
    } else {
        Cow::Borrowed(text)
    }
}

pub(crate) struct RequestSettlement<'a> {
    pub state: &'a str,
    pub result: Option<&'a str>,
    pub error: Option<&'a str>,
    pub next_at: Option<i64>,
    pub settled_at: Option<i64>,
    pub error_code: Option<&'a str>,
}

// @ref LLP 3000.009.001.000#10 — one request contract on SQLite and Postgres.
/// Any adapter error is terminal for the caller's transaction: propagate it
/// and roll back/drop the transaction. A conflict that policy may continue
/// past must instead be expressed as a typed outcome, never a statement error.
// @ref LLP 3000.009.001.000#9.1 — SQLite must not continue after errors that abort Postgres.
pub(crate) trait RequestsTransaction {
    fn request(&self, id: &str) -> Result<Option<ActionRequest>, RuntimeError>;
    fn request_release(&self) -> Result<Option<String>, RuntimeError>;
    fn insert_request(&self, request: &NewRequest<'_>) -> Result<(), RuntimeError>;
    fn expired_requests(&self, now: i64, limit: u64) -> Result<Vec<ActionRequest>, RuntimeError>;
    /// Preserve the claim fence; policy invalidates its session before finishing.
    fn finish_request(
        &self,
        id: &str,
        state: &str,
        code: &str,
        error: &str,
        now: i64,
    ) -> Result<(), RuntimeError>;
    fn requeue_request(&self, id: &str, now: i64) -> Result<(), RuntimeError>;
    /// `names` is a typed claim-name set, or no set restriction.
    /// Limits above BIGINT::MAX saturate there in both adapters.
    fn due_requests(
        &self,
        now: i64,
        action: Option<&str>,
        names: Option<&[String]>,
        limit: u64,
    ) -> Result<Vec<String>, RuntimeError>;
    fn fail_request_authority(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError>;
    fn claim_request(
        &self,
        id: &str,
        worker: &str,
        session_digest: &str,
        lease_until: i64,
    ) -> Result<(), RuntimeError>;
    fn settle_request(&self, id: &str, settled: &RequestSettlement<'_>)
    -> Result<(), RuntimeError>;
    fn cancel_request(&self, id: &str) -> Result<(), RuntimeError>;
}

pub(crate) trait RequestsStore {
    fn request_counts(&mut self) -> Result<BTreeMap<String, u64>, RuntimeError>;
}

#[cfg(test)]
pub(crate) mod test_cases {
    use super::*;
    use crate::{authority::AuthorityTransaction, schema::ActionSpec};

    pub(crate) fn insert(tx: &impl RequestsTransaction, id: &str, action: &str, at: i64) {
        tx.insert_request(&NewRequest {
            id,
            action,
            args: "{}",
            principal: "dev:alice",
            at,
            authority: None,
            args_digest: "args-digest",
            spec: &serde_json::to_string(&ActionSpec::default()).unwrap(),
            contract: "contract",
            deadline: None,
            release: Some("release"),
            service_generation: None,
        })
        .unwrap();
    }

    /// Finishing preserves a cooperative cancellation fence, while retry and
    /// ordinary settlement clear it. The delegated credential is revoked first.
    pub(crate) fn finish_and_settle(
        tx: &(impl RequestsTransaction + AuthorityTransaction),
        digest: &str,
    ) {
        insert(tx, "claim", "work", 10);
        assert!(tx.session_by_digest(digest).unwrap().is_some());
        tx.claim_request("claim", "service:worker", digest, 1_010)
            .unwrap();
        super::super::finish(tx, "claim", "parked", "E_STEP_PARKED", "uncertain", 20).unwrap();
        tx.cancel_request("claim").unwrap();
        let parked = tx.request("claim").unwrap().unwrap();
        assert_eq!(parked.state, "parked");
        assert_eq!(parked.attempt, 1);
        assert_eq!(parked.lease_until, Some(1_010));
        assert_eq!(parked.error_code.as_deref(), Some("E_STEP_PARKED"));
        assert_eq!(parked.settled_at, Some(20));
        assert_eq!(parked.release.as_deref(), Some("release"));
        assert!(parked.cancelled);
        let work = tx.work_by_id("claim").unwrap().unwrap();
        assert_eq!(work.session_digest.as_deref(), Some(digest));
        assert_eq!(work.claimed_by.as_deref(), Some("service:worker"));
        assert!(tx.session_by_digest(digest).unwrap().is_none());

        tx.requeue_request("claim", 30).unwrap();
        let work = tx.work_by_id("claim").unwrap().unwrap();
        assert!(
            work.session_digest.is_none()
                && work.claimed_by.is_none()
                && work.lease_until.is_none()
        );
        assert_eq!(
            tx.request("claim").unwrap().unwrap().error.as_deref(),
            Some("the action lease expired")
        );
        assert!(tx.due_requests(29, None, None, 100).unwrap().is_empty());
        assert_eq!(tx.due_requests(30, None, None, 100).unwrap(), ["claim"]);
        tx.claim_request("claim", "service:next", "next-digest", 2_000)
            .unwrap();
        tx.settle_request(
            "claim",
            &RequestSettlement {
                state: "done",
                result: Some("{\"ok\":true}"),
                error: None,
                next_at: None,
                settled_at: Some(40),
                error_code: None,
            },
        )
        .unwrap();
        let done = tx.request("claim").unwrap().unwrap();
        assert_eq!(done.attempt, 2);
        assert_eq!(done.result, Some(serde_json::json!({"ok": true})));
        assert_eq!(done.settled_at, Some(40));
        let work = tx.work_by_id("claim").unwrap().unwrap();
        assert!(
            work.session_digest.is_none()
                && work.claimed_by.is_none()
                && work.lease_until.is_none()
        );
        assert!(tx.expired_requests(3_000, 100).unwrap().is_empty());
    }

    pub(crate) fn selection(tx: &impl RequestsTransaction) {
        assert!(tx.request("missing").unwrap().is_none());
        insert(tx, "later", "other", 20);
        insert(tx, "b", "work", 10);
        insert(tx, "a", "work", 10);
        assert_eq!(tx.due_requests(0, None, None, 2).unwrap(), ["a", "b"]);
        assert!(tx.due_requests(0, None, Some(&[]), 100).unwrap().is_empty());
        assert!(tx.due_requests(0, None, None, 0).unwrap().is_empty());
        assert_eq!(
            tx.due_requests(0, Some("other"), None, 100).unwrap(),
            ["later"]
        );
        assert_eq!(
            tx.due_requests(0, None, Some(&["work".into()]), 100)
                .unwrap(),
            ["a", "b"]
        );
        assert!(
            tx.due_requests(0, Some("other"), Some(&["work".into()]), 100)
                .unwrap()
                .is_empty()
        );
        insert(tx, "odd", "quoted\"\\é", 30);
        assert_eq!(
            tx.due_requests(
                0,
                None,
                Some(&["quoted\"\\é".into(), "work".into(), "work".into()]),
                u64::MAX
            )
            .unwrap(),
            ["a", "b", "odd"]
        );
        tx.fail_request_authority("odd", "not needed", 0).unwrap();
        tx.claim_request("a", "service:worker", "digest", 100)
            .unwrap();
        assert!(tx.expired_requests(99, 1).unwrap().is_empty());
        assert_eq!(tx.expired_requests(100, 1).unwrap()[0].id, "a");
        tx.fail_request_authority("b", super::super::AUTHORITY_ERROR, 50)
            .unwrap();
        let failed = tx.request("b").unwrap().unwrap();
        assert_eq!(failed.error_code.as_deref(), Some("E_ACTION_AUTHORITY"));
        assert_eq!(failed.settled_at, Some(50));
        assert_eq!(tx.due_requests(0, None, None, 100).unwrap(), ["later"]);
    }

    /// NULL next_at is immediately due, NULL lease/deadline never expires;
    /// JSON null is a recorded result, distinct from no recorded result.
    pub(crate) fn nulls_and_integer_bounds(
        tx: &impl RequestsTransaction,
        set_attempts: impl Fn(i64),
    ) {
        let at = i64::MAX - 10;
        let authority = Authority {
            family: "family".into(),
            generation: at,
            expires_at: i64::MAX,
        };
        let args = BTreeMap::from([("wide".to_owned(), crate::Value::Int(i64::MAX))]);
        tx.insert_request(&NewRequest {
            id: "wide",
            action: "work",
            args: &serde_json::to_string(&args).unwrap(),
            principal: "alice",
            at,
            authority: Some(&authority),
            args_digest: "digest",
            spec: "{}",
            contract: "contract",
            deadline: Some(i64::MAX),
            release: None,
            service_generation: Some(at),
        })
        .unwrap();
        let run = tx.request("wide").unwrap().unwrap();
        assert_eq!(run.at, at);
        assert_eq!(run.args, args);
        assert_eq!(run.authority, Some(authority));
        assert_eq!(run.service_generation, Some(at));
        assert_eq!(run.deadline, Some(i64::MAX));
        assert!(!run.cancelled);
        assert!(run.result.is_none() && run.lease_until.is_none() && run.release.is_none());
        assert_eq!(tx.due_requests(i64::MIN, None, None, 1).unwrap(), ["wide"]);
        assert!(tx.expired_requests(at, 100).unwrap().is_empty());
        assert_eq!(tx.expired_requests(i64::MAX, 100).unwrap()[0].id, "wide");
        for attempts in [i32::MAX as i64, u32::MAX as i64 - 1] {
            set_attempts(attempts);
            tx.claim_request("wide", "service:worker", "digest", at)
                .unwrap();
            assert_eq!(
                tx.request("wide").unwrap().unwrap().attempt as i64,
                attempts + 1
            );
        }
        set_attempts(2);
        for (result, expected) in [(Some("null"), Some(serde_json::Value::Null)), (None, None)] {
            tx.settle_request(
                "wide",
                &RequestSettlement {
                    state: "queued",
                    result,
                    error: None,
                    next_at: Some(at),
                    settled_at: None,
                    error_code: None,
                },
            )
            .unwrap();
            let run = tx.request("wide").unwrap().unwrap();
            assert_eq!(run.result, expected);
            assert!(run.error.is_none() && run.error_code.is_none() && run.settled_at.is_none());
            assert!(tx.due_requests(at - 1, None, None, 1).unwrap().is_empty());
            assert_eq!(tx.due_requests(at, None, None, 1).unwrap(), ["wide"]);
        }
        tx.cancel_request("wide").unwrap();
        tx.cancel_request("wide").unwrap();
        assert!(tx.request("wide").unwrap().unwrap().cancelled);
        // All mutation methods retain SQLite's no-op behavior on missing ids.
        tx.claim_request("missing", "worker", "digest", at).unwrap();
        tx.finish_request("missing", "failed", "code", "error", at)
            .unwrap();
        tx.requeue_request("missing", at).unwrap();
        tx.fail_request_authority("missing", "error", at).unwrap();
        tx.cancel_request("missing").unwrap();
        tx.settle_request(
            "missing",
            &RequestSettlement {
                state: "done",
                result: None,
                error: None,
                next_at: None,
                settled_at: Some(at),
                error_code: None,
            },
        )
        .unwrap();
        assert!(tx.request("missing").unwrap().is_none());
    }

    pub(crate) fn invalid_attempts(tx: &impl RequestsTransaction) {
        assert!(
            matches!(tx.request("wide"), Err(RuntimeError::Sql(_))),
            "out-of-range attempts retain the common legacy Sql variant"
        );
    }

    /// Harness seeds a predecessor row with nullable optional columns and an
    /// incomplete authority binding. It remains legacy authority on both stores.
    pub(crate) fn legacy_nulls(tx: &impl RequestsTransaction) {
        let run = tx.request("legacy").unwrap().unwrap();
        assert_eq!(run.at, i64::MIN);
        assert_eq!(run.attempt, 0);
        assert_eq!(run.spec, ActionSpec::default());
        assert!(run.authority.is_none() && run.args_digest.is_none() && run.contract.is_none());
        assert!(
            run.deadline.is_none() && run.release.is_none() && run.service_generation.is_none()
        );
        assert!(run.result.is_none() && run.error.is_none() && run.error_code.is_none());
        assert!(run.lease_until.is_none() && run.settled_at.is_none() && !run.cancelled);
        assert_eq!(
            tx.due_requests(i64::MIN, None, None, 1).unwrap(),
            ["legacy"]
        );
        assert!(tx.expired_requests(i64::MAX, 100).unwrap().is_empty());
    }

    /// Compare SQLite's changes()/execute count and Postgres RETURNING length.
    pub(crate) fn conditional_counts(
        tx: &impl RequestsTransaction,
        transition: impl Fn(&str, &str, &str) -> u64,
    ) {
        insert(tx, "conditional", "work", 0);
        assert_eq!(
            transition("conditional", "queued", "queued"),
            1,
            "matched no-op counts"
        );
        assert_eq!(transition("conditional", "queued", "running"), 1);
        assert_eq!(
            transition("conditional", "queued", "failed"),
            0,
            "stale state loses"
        );
        assert_eq!(transition("missing", "queued", "running"), 0);
        assert_eq!(tx.request("conditional").unwrap().unwrap().state, "running");
    }

    /// Harness supplies an admitting family member and a delegated action
    /// credential. These are the production authority/lease policy functions.
    pub(crate) fn authority_and_lease(tx: &(impl RequestsTransaction + AuthorityTransaction)) {
        tx.insert_request(&NewRequest {
            id: "bound",
            action: "work",
            args: "{}",
            principal: "alice",
            at: 10,
            authority: Some(&Authority {
                family: "family".into(),
                generation: 0,
                expires_at: 100,
            }),
            args_digest: "digest",
            spec: "{}",
            contract: "contract",
            deadline: Some(90),
            release: None,
            service_generation: None,
        })
        .unwrap();
        let run = tx.request("bound").unwrap().unwrap();
        assert_eq!(
            super::super::authority_expiry(tx, &run, 99).unwrap(),
            Some(100)
        );
        assert_eq!(super::super::authority_expiry(tx, &run, 100).unwrap(), None);
        tx.claim_request("bound", "service:worker", "delegated", 80)
            .unwrap();
        assert!(
            crate::authority::held_claim_authority(tx, "bound", "service:worker", "delegated", 79)
                .unwrap()
        );
        assert!(
            !crate::authority::held_claim_authority(tx, "bound", "service:worker", "delegated", 80)
                .unwrap()
        );
        assert!(
            !crate::authority::held_claim_authority(tx, "bound", "service:other", "delegated", 79)
                .unwrap()
        );
        assert!(
            !crate::authority::held_claim_authority(tx, "bound", "service:worker", "stale", 79)
                .unwrap()
        );
        tx.invalidate_session("admitting").unwrap();
        let run = tx.request("bound").unwrap().unwrap();
        assert!(
            super::super::authority_expiry(tx, &run, 79)
                .unwrap()
                .is_none()
        );
        assert!(
            !crate::authority::held_claim_authority(tx, "bound", "service:worker", "delegated", 79)
                .unwrap()
        );
        super::super::finish(
            tx,
            "bound",
            "parked",
            "E_STEP_RESULT",
            "oversized result",
            79,
        )
        .unwrap();
        assert!(tx.session_by_digest("delegated").unwrap().is_none());
        assert_eq!(tx.request("bound").unwrap().unwrap().lease_until, Some(80));
    }

    pub(crate) fn limited_expiry(tx: &(impl RequestsTransaction + AuthorityTransaction)) {
        insert(tx, "b", "z", 10);
        insert(tx, "a", "a", 10);
        tx.claim_request("b", "worker", "digest-b", 10).unwrap();
        tx.claim_request("a", "worker", "digest-a", 10).unwrap();
        tx.insert_request(&NewRequest {
            deadline: Some(10),
            ..new("q", "q", 0)
        })
        .unwrap();
        assert!(tx.expired_requests(10, 0).unwrap().is_empty());
        assert_eq!(
            tx.expired_requests(10, u64::MAX)
                .unwrap()
                .iter()
                .map(|r| r.id.as_str())
                .collect::<Vec<_>>(),
            ["q", "a", "b"]
        );
        for (id, state) in [("q", "failed"), ("a", "queued"), ("b", "queued")] {
            assert_eq!(tx.expired_requests(10, 1).unwrap()[0].id, id);
            assert_eq!(
                super::super::expire_batch(tx, 10, 1, std::time::Duration::MAX).unwrap(),
                1
            );
            let run = tx.request(id).unwrap().unwrap();
            assert_eq!(run.state, state);
            if id == "q" {
                assert_eq!(run.error_code.as_deref(), Some("E_ACTION_DEADLINE"));
            } else {
                assert!(run.lease_until.is_none());
            }
        }
        assert!(tx.expired_requests(10, 1).unwrap().is_empty());
    }

    pub(crate) fn new<'a>(id: &'a str, action: &'a str, at: i64) -> NewRequest<'a> {
        NewRequest {
            id,
            action,
            at,
            args: "{}",
            principal: "dev:alice",
            authority: None,
            args_digest: "digest",
            spec: "{}",
            contract: "contract",
            deadline: None,
            release: None,
            service_generation: None,
        }
    }

    /// The harness must end this transaction after the error, then verify that
    /// even the preceding successful insert was rolled back on a fresh one.
    pub(crate) fn duplicate_insert(tx: &impl RequestsTransaction) {
        insert(tx, "duplicate", "work", 0);
        assert!(tx.insert_request(&new("duplicate", "work", 1)).is_err());
    }

    /// Validation is shared and occurs before SQL. The harness rolls back after
    /// each refused insertion, honoring the terminal-error contract.
    pub(crate) fn nul_insertion(tx: &impl RequestsTransaction, field: usize) {
        let authority = Authority {
            family: "family\0bad".into(),
            generation: 0,
            expires_at: 100,
        };
        let mut request = new("nul", "work", 0);
        match field {
            0 => request.id = "id\0bad",
            1 => request.action = "name\0bad",
            2 => request.principal = "principal\0bad",
            3 => request.authority = Some(&authority),
            4 => request.args_digest = "digest\0bad",
            5 => request.contract = "contract\0bad",
            6 => request.release = Some("release\0bad"),
            _ => unreachable!(),
        }
        assert!(matches!(
            tx.insert_request(&request),
            Err(RuntimeError::Input(_))
        ));
    }

    pub(crate) fn diagnostic_and_json_text(tx: &(impl RequestsTransaction + AuthorityTransaction)) {
        use super::super::{ActionSettled, record_settlement};
        assert!(tx.session_by_digest("delegated").unwrap().is_some());
        let encoded_args = serde_json::to_string(&BTreeMap::from([(
            "text",
            crate::Value::String("a\0b".into()),
        )]))
        .unwrap();
        tx.insert_request(&NewRequest {
            args: &encoded_args,
            ..new("json", "work", 0)
        })
        .unwrap();
        assert_eq!(
            tx.request("json").unwrap().unwrap().args["text"],
            crate::Value::String("a\0b".into())
        );
        let encoded_result = serde_json::to_string(&serde_json::json!({"text": "a\0b"})).unwrap();
        for (id, settled, refusal, expected) in [
            (
                "failed",
                ActionSettled::Failed {
                    error: "provider\0failure".into(),
                    retry: false,
                },
                None,
                "provider\u{fffd}failure".to_owned(),
            ),
            (
                "retry",
                ActionSettled::Failed {
                    error: format!("{}\0tail", "x".repeat(1_999)),
                    retry: true,
                },
                None,
                format!("{}\u{fffd}", "x".repeat(1_999)),
            ),
            (
                "refused",
                ActionSettled::Refused {
                    code: "E_REFUSED",
                    error: "provider\0refused".into(),
                },
                None,
                "provider\u{fffd}refused".to_owned(),
            ),
            (
                "route",
                ActionSettled::Done(serde_json::Value::Null),
                Some("route\0refused".into()),
                "route\u{fffd}refused".to_owned(),
            ),
        ] {
            insert(tx, id, "work", 0);
            tx.claim_request(id, "service:worker", "delegated", 100)
                .unwrap();
            let run = tx.request(id).unwrap().unwrap();
            let result =
                matches!(settled, ActionSettled::Done(_)).then_some(encoded_result.as_str());
            record_settlement(tx, &run, "delegated", settled, result, refusal, 20).unwrap();
            assert_eq!(
                tx.request(id).unwrap().unwrap().error.as_deref(),
                Some(expected.as_str())
            );
            let run = tx.request(id).unwrap().unwrap();
            assert_eq!(
                run.state,
                match id {
                    "retry" => "queued",
                    "route" => "done",
                    _ => "failed",
                }
            );
            if id != "refused" {
                assert!(run.lease_until.is_none());
            }
            assert!(tx.session_by_digest("delegated").unwrap().is_none());
        }
        insert(tx, "park", "work", 0);
        super::super::finish(
            tx,
            "park",
            "parked",
            "E_STEP_PARKED",
            "uncertain\0outcome",
            20,
        )
        .unwrap();
        assert_eq!(
            tx.request("park").unwrap().unwrap().error.as_deref(),
            Some("uncertain\u{fffd}outcome")
        );
        tx.fail_request_authority("json", "authority\0refused", 20)
            .unwrap();
        assert_eq!(
            tx.request("json").unwrap().unwrap().error.as_deref(),
            Some("authority\u{fffd}refused")
        );
        let run = tx.request("route").unwrap().unwrap();
        assert_eq!(run.result, Some(serde_json::json!({"text": "a\0b"})));
    }

    /// Two BEGINs overlap. The second is released only once the first owns
    /// the fence; the first keeps that fence until the second is approaching it.
    pub(crate) struct RaceOrder {
        begun: std::sync::Barrier,
        holder: std::sync::Barrier,
        contender: std::sync::Barrier,
    }
    impl RaceOrder {
        pub(crate) fn new() -> Self {
            Self {
                begun: std::sync::Barrier::new(2),
                holder: std::sync::Barrier::new(2),
                contender: std::sync::Barrier::new(2),
            }
        }
        pub(crate) fn after_begin(&self, first: bool) {
            self.begun.wait();
            if !first {
                self.holder.wait();
                self.contender.wait();
            }
        }
        pub(crate) fn after_fence(&self, first: bool) {
            if first {
                self.holder.wait();
                self.contender.wait();
            }
        }
    }

    pub(crate) fn seed_expiry_settlement(tx: &impl RequestsTransaction, token: &str) {
        insert(tx, "expiry-race", "work", 0);
        tx.claim_request(
            "expiry-race",
            "service:worker",
            &crate::identity::digest(token),
            10,
        )
        .unwrap();
    }

    pub(crate) fn expiry_settlement_operation(
        tx: &(impl RequestsTransaction + AuthorityTransaction),
        expire: bool,
        token: &str,
    ) -> bool {
        if expire {
            super::super::expire_batch(tx, 10, 1, std::time::Duration::MAX).unwrap() == 1
        } else {
            let run = match super::super::held_claim_authority(
                tx,
                "expiry-race",
                "service:worker",
                token,
                9,
            ) {
                Ok(run) => run,
                Err(error) => {
                    assert!(matches!(
                        error,
                        RuntimeError::Structural {
                            code: "E_ACTION_LEASE",
                            ..
                        }
                    ));
                    return false;
                }
            };
            super::super::record_settlement(
                tx,
                &run,
                &crate::identity::digest(token),
                super::super::ActionSettled::Done(serde_json::Value::Null),
                Some("null"),
                None,
                9,
            )
            .unwrap();
            true
        }
    }

    pub(crate) fn sqlite_expiry_settlement_outcome(expiry_first: bool) -> ActionRequest {
        let mut store = crate::store::Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        let session = crate::identity::action_session(&tx, "dev:alice", 0, 100).unwrap();
        seed_expiry_settlement(&tx, &session.token);
        tx.commit().unwrap();
        for expire in [expiry_first, !expiry_first] {
            let tx = store.transaction().unwrap();
            let won = expiry_settlement_operation(&tx, expire, &session.token);
            assert_eq!(won, expire == expiry_first);
            tx.commit().unwrap();
        }
        let tx = store.transaction().unwrap();
        let run = tx.request("expiry-race").unwrap().unwrap();
        assert_expiry_settlement(&run, expiry_first);
        run
    }

    pub(crate) fn assert_expiry_settlement(run: &ActionRequest, expiry_first: bool) {
        assert_eq!(run.attempt, 1);
        assert!(run.lease_until.is_none());
        if expiry_first {
            assert_eq!(run.state, "queued");
            assert_eq!(run.error.as_deref(), Some("the action lease expired"));
            assert!(run.result.is_none() && run.settled_at.is_none());
        } else {
            assert_eq!(run.state, "done");
            assert_eq!(run.result, Some(serde_json::Value::Null));
            assert_eq!(run.settled_at, Some(9));
            assert!(run.error.is_none());
        }
    }

    /// Two connections call this only after taking their ordinary writer fence.
    /// Selection must be repeated there, rather than using an earlier candidate.
    pub(crate) fn claim_due(tx: &impl RequestsTransaction, worker: &str) -> bool {
        let ids = tx.due_requests(10, Some("work"), None, 1).unwrap();
        let Some(id) = ids.first() else { return false };
        tx.claim_request(id, worker, worker, 100).unwrap();
        true
    }
}
