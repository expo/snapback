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
    /// Store generation and supervisor fence at this observation, never at insertion.
    pub generation: Option<u64>,
    pub supervisor_revision: usize,
    pub capability: Option<Capability>,
    pub store_id: String,
    pub head: u64,
}

// @ref LLP 3000.009.001.000.001#31-authority-boundaries — required request authority rejects an absent NUL credential before opening SQL.
pub(crate) fn require_digest(digest: &str) -> Result<(), RuntimeError> {
    refuse_nul(&[(digest, "this session is not live; sign in again")])
}

pub(crate) fn request_authority(tx: &AnyTx<'_>, digest: &str, sample: ServiceSample) -> Result<RequestAuthority, RuntimeError> {
    require_digest(digest)?;
    authority_from_facts(tx, tx.session_authority_facts(digest)?, sample)
}

pub(crate) fn authority_from_facts(tx: &AnyTx<'_>, facts: facts::SessionFacts, sample: ServiceSample) -> Result<RequestAuthority, RuntimeError> {
    let store_id = facts.store_id.clone().ok_or_else(|| RuntimeError::Store("missing store identity".into()))?;
    let head = facts.head;
    let generation = facts.store_generation.as_deref().and_then(|value| value.parse().ok());
    let capability = facts::resolve(tx, facts, sample.now, Some(sample.supervisor_revision))?
        .map(|s| (s.principal, s.kind, s.scope));
    Ok(RequestAuthority { capability, store_id, head, generation, supervisor_revision: sample.supervisor_revision })
}

impl RequestSnapshot<'_, '_> {
    pub fn replay_bound(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<crate::MutationOutcome>, RuntimeError> {
        self.tx.replay_bound(principal, id, name, args)?
            .map(|receipt| crate::MutationOutcome::from_receipt(&receipt)).transpose()
    }
}

/// Serving preflight knows whether it needs a receipt before it opens the
/// snapshot. Values are observations only; the shared resolver still decides.
// @ref LLP 3000.009.001.000.001#31-authority-boundaries — unfenced replay before judgment and a live store binding.
pub fn with_request_preflight<T>(store: &AnyStore, digest: &str, sample: ServiceSample, ordinary: bool, receipt: Option<(&str,&str)>, run: impl FnOnce(RequestSnapshot<'_, '_>)->T) -> Result<T,RuntimeError> {
    require_digest(digest)?;
    store.with_preflight_snapshot(digest,receipt,ordinary,|tx,facts| {
        let store_id = facts.store_id.clone().ok_or_else(||RuntimeError::Store("missing store identity".into()))?;
        let head = facts.head;
        let capability = facts::resolve(tx,facts,sample.now,Some(sample.supervisor_revision))?.map(|s|(s.principal,s.kind,s.scope));
        Ok(run(RequestSnapshot {tx,capability,store_id,head}))
    })
}

/// Parse once at ingress; the digest is a credential input, never authority.
pub fn session_digest(token: &str) -> String { super::digest(token) }

/// No handle or facts are retained across requests. The callback can decide an
/// early outcome using exactly the snapshot that authenticated it.
pub fn with_request_snapshot<T>(store: &AnyStore, digest: &str, sample: ServiceSample, run: impl FnOnce(RequestSnapshot<'_, '_>) -> T) -> Result<T, RuntimeError> {
    require_digest(digest)?;
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
/// Refusals disclose no store facts, including a mismatched serving binding.
pub fn resolve_ingress_supervised(store: &AnyStore, digest: &str, sample: ServiceSample, expected_store: Option<&str>) -> Result<Option<Capability>, crate::Refusal> {
    let facts = store.ingress_session_authority_facts(digest).map_err(|e| e.refusal())?;
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — ingress compares its existing projection without reading or disclosing another metadata cut.
    if let (Some(expected), Some(actual)) = (expected_store, facts.store_id.as_deref()) && actual != expected {
        return Err(crate::Refusal::new("E_STORE_REPLACED", "store", "the serving store identity changed; reconcile with the original store").guide("sync"));
    }
    if expected_store.is_none() || facts.store_id.as_deref() != expected_store { return Ok(None); }
    let session = if facts::ordinary(&facts) { facts::projected(facts, sample.now, Some(sample.supervisor_revision)).map_err(|e| e.refusal())? }
        else { return store.resolve_session_snapshot(digest, sample.now, expected_store, Some(sample.supervisor_revision)).map_err(|e| e.refusal()); };
    Ok(session.map(|s| (s.principal, s.kind, s.scope)))
}


#[cfg(test)]
mod tests {
    use super::*;
    fn engine(pg: bool) -> crate::Engine {
        let store = if pg {
            #[cfg(feature = "postgres")]
            { AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &format!("sb4_rt3b_nul_{:x}", crate::ids::seed())).unwrap() }
            #[cfg(not(feature = "postgres"))]
            { unreachable!() }
        } else { AnyStore::memory().unwrap() };
        let bound = snapback4_lang::compile(&[("schema.q".into(), "use identity\nmutation noop():\n  return 1\n".into())]);
        let schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
        let programs: Vec<crate::Program> = bound.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
        crate::Engine::new_at(store, schema, programs, 1000).unwrap()
    }
    fn check(why: crate::Refusal, counts: crate::round_trips::Counts) {
        eprintln!("NUL witness: {why:?}; SQL={counts:?}");
        assert_eq!(why.code, "E_AUTH", "{why:?}");
        assert!(!why.retryable, "{why:?}");
        assert_eq!(counts, crate::round_trips::Counts::default(), "NUL must refuse before opening SQL");
    }
    fn snapshot(pg: bool) {
        let engine = engine(pg);
        let scope = crate::round_trips::Scope::begin();
        let why = with_request_snapshot(engine.store(), "raw\0digest", ServiceSample { now: 1000, supervisor_revision: 0 }, |_| panic!("NUL has no authority")).unwrap_err().refusal();
        check(why, scope.counts());
    }
    fn mutation(pg: bool) {
        let mut engine = engine(pg);
        let scope = crate::round_trips::Scope::begin();
        let why = engine.mutate_authorized("noop", Some("nul-write"), crate::Context::new("guest:nul", Default::default()), "raw\0digest", || ServiceSample { now: 1000, supervisor_revision: 0 }, |_| panic!("NUL has no authority")).unwrap_err();
        check(why, scope.counts());
    }
    fn borrowed(pg: bool) {
        let mut engine = engine(pg);
        let tx = engine.store_mut().read_transaction().unwrap();
        let scope = crate::round_trips::Scope::begin();
        let why = tx.request_authority("raw\0digest", ServiceSample { now: 1000, supervisor_revision: 0 }).err().unwrap().refusal();
        check(why, scope.counts());
    }
    fn optional(pg: bool) {
        let engine = engine(pg);
        let scope = crate::round_trips::Scope::begin();
        assert!(resolve_ingress_supervised(engine.store(), "raw\0digest", ServiceSample { now: 1000, supervisor_revision: 0 }, Some("store")).unwrap().is_none());
        assert_eq!(scope.counts(), crate::round_trips::Counts::default());
    }
    #[test] fn rt3b_nul_borrowed_sqlite() { borrowed(false); }
    #[test] fn rt3b_nul_optional_sqlite() { optional(false); }
    #[cfg(feature = "postgres")] #[test] #[ignore = "requires private Postgres"]
    fn rt3b_nul_borrowed_postgres() { borrowed(true); }
    #[cfg(feature = "postgres")] #[test] #[ignore = "requires private Postgres"]
    fn rt3b_nul_optional_postgres() { optional(true); }
    #[test] fn rt3b_nul_snapshot_sqlite() { snapshot(false); }
    #[test] fn rt3b_nul_mutation_sqlite() { mutation(false); }
    #[cfg(feature = "postgres")] #[test] #[ignore = "requires private Postgres"]
    fn rt3b_nul_snapshot_postgres() { snapshot(true); }
    #[cfg(feature = "postgres")] #[test] #[ignore = "requires private Postgres"]
    fn rt3b_nul_mutation_postgres() { mutation(true); }
}
