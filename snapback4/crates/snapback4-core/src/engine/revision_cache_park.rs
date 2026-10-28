//! Owned candidates cross a wait without retaining an Engine or PG custody.
// @ref LLP 3000.009.001.000.002#g5-read-index-validation — a proof belongs only to reads enrolled before its statement.
use super::*;

/// Opaque fresh statement result. Only an engine can construct it.
#[derive(Clone)]
pub struct ReadIndexValidation(pub(super) Stamp, std::sync::Weak<Cache>, u64);
/// Immutable candidate selected before enrollment; retention remains charged.
pub struct ReadIndexCandidate { cache: Arc<Cache>, key: Key, entry: Arc<Entry>, serial: u64 }
/// One-use continuation input, bound to the selected cache and request key.
pub struct ReadIndexProof {
    pub(super) cache: Arc<Cache>, pub(super) key: Key, pub(super) entry: Arc<Entry>,
    pub(super) validation: Option<ReadIndexValidation>,
}
impl ReadIndexCandidate {
    /// Call only with the result of a statement submitted after this candidate
    /// was enrolled and its batch closed. Failure resumes ordinary G5.
    pub fn complete(self, validation: Option<ReadIndexValidation>) -> ReadIndexProof {
        self.cache.read_index.reads.fetch_add(1, Ordering::Relaxed);
        let validation=validation.filter(|v|self.serial<=v.2 && std::sync::Weak::ptr_eq(&v.1,&Arc::downgrade(&self.cache)));
        ReadIndexProof { cache: self.cache, key: self.key, entry: self.entry, validation }
    }
}
impl Engine {
    pub fn prepare_read_index(&self, name: &str, context: &Context, retained: Option<&[String]>, manifest: DeliveryManifest, digest: &str) -> Option<ReadIndexCandidate> {
        let cache = &self.revision_cache;
        if !cache.read_index.enabled.load(Ordering::Relaxed)
            || !self.store.read_index_eligible()
            || self.store.read_grant().is_some_and(|g|g.configured.load(Ordering::Acquire) || g.revoked.load(Ordering::Acquire) || g.uncertain.load(Ordering::Acquire))
        { return None; }
        let (key, _) = self.cache_key(name, context, retained, manifest, digest)?;
        // A candidate probe is not another request observation: only the
        // ordinary query path may advance two-observation fill probation/LRU.
        let entry=cache.state.try_lock().ok()?.entries.get(&key)?.entry.clone();
        // A monotonically ordered receipt prevents even an API caller from
        // applying a previously completed proof to a later invocation. Overflow
        // disables enrollment; it never wraps into an old validation cut.
        let serial=cache.read_index.enrollments.fetch_update(Ordering::AcqRel,Ordering::Acquire,|n|n.checked_add(1)).ok()?+1;
        Some(ReadIndexCandidate { cache: cache.clone(), key, entry, serial })
    }
    /// The caller must detach/close enrollment before entering this function.
    pub fn validate_read_index(&mut self) -> Option<ReadIndexValidation> {
        if !self.store.read_index_eligible() { return None; }
        self.revision_cache.read_index.rounds.fetch_add(1, Ordering::Relaxed);
        let cut=self.revision_cache.read_index.enrollments.load(Ordering::Acquire);
        self.store.read_index_validation().map(|stamp|ReadIndexValidation(stamp,Arc::downgrade(&self.revision_cache),cut))
    }
    #[cfg(feature = "server-search")]
    pub fn query_materialized_search_without_read_index(
        &mut self, name: &str, context: Context, retained: Option<&[String]>, manifest: DeliveryManifest,
        digest: &str, mut snapshot: impl FnMut(&crate::store_port::ReadSnapshot<'_>, u64) -> Result<(), Refusal>,
    ) -> (Result<QueryOutcome, Refusal>, Option<u64>, Option<Vec<String>>) {
        self.query_cached_request(name, context, retained, manifest, digest, &mut snapshot, None)
    }
    #[cfg(feature = "server-search")]
    pub fn query_materialized_search_with_read_index(
        &mut self, name: &str, context: Context, retained: Option<&[String]>, manifest: DeliveryManifest,
        digest: &str, proof: ReadIndexProof,
        mut snapshot: impl FnMut(&crate::store_port::ReadSnapshot<'_>, u64) -> Result<(), Refusal>,
    ) -> (Result<QueryOutcome, Refusal>, Option<u64>, Option<Vec<String>>) {
        self.query_cached_request(name, context, retained, manifest, digest, &mut snapshot, Some(proof))
    }
}
