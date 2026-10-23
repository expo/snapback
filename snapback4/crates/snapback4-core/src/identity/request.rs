//! Host boundaries borrow typed authority and receipt access from one snapshot.
use super::*;

// @ref LLP 3000.009.001.000.001#31-authority-boundaries — preflight is unfenced, including when the owner token has been lost.
pub struct RequestSnapshot<'a, 'store> {
    tx: &'a AnyTx<'store>,
    pub capability: Option<Capability>,
    pub store_id: String,
    pub head: u64,
}
impl RequestSnapshot<'_, '_> {
    pub fn replay_bound(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<crate::MutationOutcome>, RuntimeError> {
        self.tx.replay_bound(principal, id, name, args)?
            .map(|receipt| crate::MutationOutcome::from_receipt(&receipt)).transpose()
    }
}

/// Parse once at ingress; the digest is a credential input, never authority.
pub fn session_digest(token: &str) -> String { super::digest(token) }

/// No handle or facts are retained across requests. The callback can decide an
/// early outcome using exactly the snapshot that authenticated it.
pub fn with_request_snapshot<T>(store: &AnyStore, digest: &str, sample: ServiceSample, run: impl FnOnce(RequestSnapshot<'_, '_>) -> T) -> Result<T, RuntimeError> {
    store.with_session_authority_snapshot(digest, |tx, facts| {
        let store_id = facts.store_id.clone().ok_or_else(|| RuntimeError::Store("missing store identity".into()))?;
        let head = facts.head;
        let capability = facts::resolve(tx, facts, sample.now, Some(sample.supervisor_revision))?
            .map(|session| (session.principal, session.kind, session.scope));
        Ok(run(RequestSnapshot { tx, capability, store_id, head }))
    })
}
