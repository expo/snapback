//! Store-neutral access to durable action and route requests.
//! Policy chooses transitions and checks authority in `actions`; adapters only
//! read and write these facts within the caller's transaction.
// @ref LLP 3000.009.001.000#3.3 — extract access before adding Postgres behavior.
use super::ActionRequest;
use crate::{RuntimeError, identity::Authority};
use std::collections::BTreeMap;

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

pub(crate) struct RequestSettlement<'a> {
    pub state: &'a str,
    pub result: Option<&'a str>,
    pub error: Option<&'a str>,
    pub next_at: Option<i64>,
    pub settled_at: Option<i64>,
    pub error_code: Option<&'a str>,
}

// @ref LLP 3000.009.001.000#10 — one request contract on SQLite and Postgres.
pub(crate) trait RequestsTransaction {
    fn request(&self, id: &str) -> Result<Option<ActionRequest>, RuntimeError>;
    fn request_release(&self) -> Result<Option<String>, RuntimeError>;
    fn insert_request(&self, request: &NewRequest<'_>) -> Result<(), RuntimeError>;
    fn expired_requests(&self, now: i64, limit: i64) -> Result<Vec<ActionRequest>, RuntimeError>;
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
    /// `names` is the already encoded claim-name set, or no set restriction.
    fn due_requests(
        &self,
        now: i64,
        action: Option<&str>,
        names: Option<&str>,
        limit: i64,
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
        assert!(
            tx.due_requests(0, None, Some("[]"), 100)
                .unwrap()
                .is_empty()
        );
        assert!(tx.due_requests(0, None, None, 0).unwrap().is_empty());
        assert_eq!(
            tx.due_requests(0, Some("other"), None, 100).unwrap(),
            ["later"]
        );
        assert_eq!(
            tx.due_requests(0, None, Some("[\"work\"]"), 100).unwrap(),
            ["a", "b"]
        );
        assert!(
            tx.due_requests(0, Some("other"), Some("[\"work\"]"), 100)
                .unwrap()
                .is_empty()
        );
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
        for attempts in [-1, u32::MAX as i64 + 1] {
            set_attempts(attempts);
            assert!(
                tx.request("wide").is_err(),
                "invalid attempts must not truncate or wrap"
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

    /// Two connections call this only after taking their ordinary writer fence.
    /// Selection must be repeated there, rather than using an earlier candidate.
    pub(crate) fn claim_due(tx: &impl RequestsTransaction, worker: &str) -> bool {
        let ids = tx.due_requests(10, Some("work"), None, 1).unwrap();
        let Some(id) = ids.first() else { return false };
        tx.claim_request(id, worker, worker, 100).unwrap();
        true
    }
}
