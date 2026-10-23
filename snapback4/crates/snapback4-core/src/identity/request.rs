//! Host boundaries borrow typed authority and receipt access from one snapshot.
use super::*;

// @ref LLP 3000.009.001.000.001#31-authority-boundaries — preflight is unfenced, including when the owner token has been lost.
pub struct RequestSnapshot<'a, 'store> {
    tx: &'a AnyTx<'store>,
    pub capability: Option<Capability>,
    pub store_id: String,
    pub head: u64,
}

/// An owned observation at one boundary. Carrying it never grants authority at
/// another boundary; that boundary must resolve again with a fresh clock.
pub struct RequestAuthority {
    pub capability: Option<Capability>,
    pub store_id: String,
    pub head: u64,
}

pub(crate) fn request_authority(tx: &AnyTx<'_>, digest: &str, sample: ServiceSample) -> Result<RequestAuthority, RuntimeError> {
    authority_from_facts(tx, tx.session_authority_facts(digest)?, sample)
}

pub(crate) fn authority_from_facts(tx: &AnyTx<'_>, facts: facts::SessionFacts, sample: ServiceSample) -> Result<RequestAuthority, RuntimeError> {
    let store_id = facts.store_id.clone().ok_or_else(|| RuntimeError::Store("missing store identity".into()))?;
    let head = facts.head;
    let capability = facts::resolve(tx, facts, sample.now, Some(sample.supervisor_revision))?
        .map(|s| (s.principal, s.kind, s.scope));
    Ok(RequestAuthority { capability, store_id, head })
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

/// Early refusal only. Ordinary credentials need one statement; discovering a
/// different kind discards those facts and starts its complete borrowed snapshot.
pub fn resolve_ingress_supervised(store: &AnyStore, digest: &str, sample: ServiceSample, expected_store: Option<&str>) -> Result<Option<Capability>, RuntimeError> {
    let facts = store.ingress_session_authority_facts(digest)?;
    if expected_store.is_none() || facts.store_id.as_deref() != expected_store { return Ok(None); }
    let session = if facts::ordinary(&facts) { facts::projected(facts, sample.now, Some(sample.supervisor_revision))? }
        else { return store.resolve_session_snapshot(digest, sample.now, expected_store, Some(sample.supervisor_revision)); };
    Ok(session.map(|s| (s.principal, s.kind, s.scope)))
}
