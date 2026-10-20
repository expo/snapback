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
    use crate::{
        authority::AuthorityTransaction,
        identity::{self, IdentityTransaction},
        schema::ActionSpec,
    };

    fn insert(tx: &impl RequestsTransaction, id: &str, action: &str, at: i64) {
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
        tx: &(impl RequestsTransaction + AuthorityTransaction + IdentityTransaction),
    ) {
        insert(tx, "claim", "work", 10);
        let session = identity::action_session(tx, "dev:alice", 10, 1_010).unwrap();
        let digest = identity::digest(&session.token);
        tx.claim_request("claim", "service:worker", &digest, session.expires_at)
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
        assert_eq!(work.session_digest.as_deref(), Some(digest.as_str()));
        assert_eq!(work.claimed_by.as_deref(), Some("service:worker"));
        assert!(tx.session_by_digest(&digest).unwrap().is_none());

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
        insert(tx, "later", "other", 20);
        insert(tx, "b", "work", 10);
        insert(tx, "a", "work", 10);
        assert_eq!(tx.due_requests(0, None, None, 2).unwrap(), ["a", "b"]);
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
}
