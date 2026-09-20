//! Metadata observes identity; a bound overflow grant alone authorizes recovery.
//! Byte measurement is authenticated-server evidence, not something this
//! decoder can prove. Acceptance rechecks the request (including its limit)
//! and durable state. The grant binds its send revision; acceptance advances it atomically.
//! Evidence is trusted server data, not a cryptographic token.
use super::*;

#[derive(Deserialize)]
pub struct SyncMetadata {
    metadata: bool,
    store_id: String,
    generation: u64,
    watermark: u64,
    recovery: Option<grant::Recovery>,
}

#[derive(Deserialize)]
pub struct SyncCapture {
    store_id: Option<String>,
    generation: u64,
    captured_watermark: u64,
    // For an ordinary deferred drain only: captured_watermark is its durable
    // request cut; publication is fenced independently, never advanced by it.
    #[serde(default)]
    published_watermark: Option<u64>,
    #[serde(default)]
    captured_restore_watermark: Option<u64>,
    #[serde(default)]
    captured_restore_images_at: Option<u64>,
    send_revision: u64,
    from: u64,
    #[serde(default)]
    after: Option<String>,
    stream: bool,
    recover: bool,
    // Missing older captures fail closed for recovery, but may still observe
    // metadata. Never infer limit 1 from the host's derived recover boolean.
    #[serde(default)]
    limit: usize,
}

#[derive(Serialize)]
pub struct MetadataObservation {
    snapshot: bool,
    retired: BTreeMap<String, u64>,
    reset: bool,
    backend_required: bool,
    send_revision: u64,
    store_id: Option<String>,
    adoption_capture: BTreeMap<String, Option<String>>,
}

impl<S: DeviceStore> Device<S> {
    // @ref LLP 3000.007#18.2 — request-local fences precede all durable recovery effects.
    pub fn sync_metadata(&mut self, mut metadata: SyncMetadata, capture: SyncCapture) -> Result<MetadataObservation, RuntimeError> {
        let tx = self.store.transaction()?;
        let published = capture.published_watermark.unwrap_or(capture.captured_watermark);
        let identity = tx.meta(deferred::IDENTITY)?.or(tx.meta(STORE_ID)?);
        if !metadata.metadata || metadata.store_id.is_empty() || metadata.generation == 0
            || capture.generation != self.generation || capture.store_id.as_ref().is_none_or(|id| id.is_empty())
            || identity != capture.store_id || meta_u64(&tx, GENERATION)? != capture.generation
            || meta_u64(&tx, SEND_REVISION)? != capture.send_revision
            || meta_u64(&tx, WATERMARK)? != published
            || (capture.published_watermark.is_some() && deferred::cursor(&tx)? != Some(capture.captured_watermark)) {
            return Err(RuntimeError::Generation("sync metadata does not match its device capture; retry sync".into()));
        }
        let same_identity = identity.as_ref() == Some(&metadata.store_id);
        if same_identity && metadata.generation < capture.generation {
            return Err(RuntimeError::Generation("sync metadata generation is obsolete; retry sync".into()));
        }
        // A changed generation may reset positions. Only a same-generation
        // authenticated head proves restore; existing halts still persist.
        let check_head = !same_identity || metadata.generation == capture.generation;
        let observed = store_identity::observe_identity(&tx, store_identity::IdentityEvidence {
            check_restore: check_head,
            store_id: Some(metadata.store_id.clone()),
            watermark: if check_head { metadata.watermark } else { published },
            send_revision: Some(capture.send_revision), captured_watermark: Some(published),
            // An unvalidated request position is not restore evidence. The
            // durable captured cut is; grant acceptance checks from separately.
            requested_watermark: Some(capture.captured_watermark),
            captured_restore_watermark: capture.captured_restore_watermark,
            captured_restore_images_at: capture.captured_restore_images_at,
            images_at: check_head.then_some(metadata.watermark), more: !check_head,
            snapshot_catchup: capture.stream,
        }, false)?;
        if observed.restore_refused {
            tx.commit()?;
            return Err(store_identity::restore_error());
        }
        let backend_required = !same_identity || metadata.generation != capture.generation || observed.backend_required;
        let mut observation = MetadataObservation { snapshot: false, retired: observed.retired, reset: observed.reset,
            backend_required, send_revision: observed.send_revision, store_id: tx.meta(STORE_ID)?,
            adoption_capture: BTreeMap::new() };
        // Adoption always wins. A grant from this response cannot survive it;
        // the client must capture fresh state and request again.
        if !backend_required && let Some(recovery) = metadata.recovery.take() {
            let accepted = recovery.accept(&tx, &metadata, &capture, grant::Owner {
                backend: &self.backend_identity, store_id: &self.store_identity, native: self.native_digest.as_deref(),
                snapshot: self.snapshot_owner.as_deref(), generation: self.generation,
            })?;
            observation.retired = accepted.apply()?;
            observation.snapshot = true;
            observation.send_revision = capture.send_revision + 1;
        }
        observation.adoption_capture = store_identity::adoption_capture(&tx)?;
        tx.commit()?;
        if observation.snapshot || observation.reset { self.snapshot_owner = None; }
        Ok(observation)
    }
}

// The received wire value is not itself authority. Only accept can construct
// Accepted, and only Accepted exposes the durable recovery transaction.
mod grant {
    use super::*;

    #[derive(Deserialize)]
    pub(super) struct Recovery {
        from: u64, snapshot: bool, store_id: String, generation: u64,
        // Missing evidence fields decode only to a refusal, never inferred authority.
        #[serde(default)] limit: usize,
        #[serde(default)] stream: Option<bool>,
        #[serde(default)] send_revision: Option<u64>,
        #[serde(default)] single_commit: bool,
        #[serde(default)] commit: u64,
        #[serde(default)] measured_head: u64,
    }
    pub(super) struct Accepted<'tx, T: DeviceTx> { tx: &'tx T, revision: u64 }
    pub(super) struct Owner<'a> {
        pub backend: &'a str,
        pub store_id: &'a Option<String>,
        pub native: Option<&'a str>,
        pub snapshot: Option<&'a str>,
        pub generation: u64,
    }

    impl Recovery {
        pub(super) fn accept<'tx, T: DeviceTx>(self, tx: &'tx T, metadata: &SyncMetadata, capture: &SyncCapture,
            owner: Owner<'_>) -> Result<Accepted<'tx, T>, RuntimeError> {
            // Accepted carries all recovery fences, even if a later caller
            // reaches this method through a different metadata control path.
            store_identity::require_healthy(tx)?;
            if !metadata.metadata || metadata.store_id.is_empty() || metadata.generation == 0
                || tx.meta(deferred::IDENTITY)?.or(tx.meta(STORE_ID)?) != capture.store_id || capture.store_id.as_ref() != Some(&metadata.store_id)
                || meta_u64(tx, GENERATION)? != capture.generation || owner.generation != capture.generation
                || meta_u64(tx, SEND_REVISION)? != capture.send_revision
                || meta_u64(tx, WATERMARK)? != capture.published_watermark.unwrap_or(capture.captured_watermark)
                || (capture.published_watermark.is_some() && deferred::cursor(tx)? != Some(capture.captured_watermark))
                || tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()) {
                return Err(RuntimeError::Generation("snapshot recovery capture requires a fresh adopted backend".into()));
            }
            if self.limit != 1 || self.limit != capture.limit || self.stream != Some(capture.stream)
                || self.send_revision != Some(capture.send_revision) || !self.single_commit
                || self.commit <= self.from || self.commit > self.measured_head || self.measured_head != metadata.watermark
                || !self.snapshot || !capture.recover || capture.limit != 1 || capture.after.is_some()
                || self.store_id != metadata.store_id || self.generation != metadata.generation
                || self.from != capture.from || capture.from != capture.captured_watermark
                || capture.from >= metadata.watermark || metadata.generation != capture.generation {
                return Err(RuntimeError::Generation("snapshot recovery does not match its confirmed position".into()));
            }
            // A live staged lease is an additional fence, never an exemption
            // from the confirmed-position equality above (including from zero).
            if capture.stream && capture.published_watermark.is_none() && (owner.snapshot.is_none() || owner.snapshot != tx.meta(SNAPSHOT_OWNER)?.as_deref()
                || meta_u64(tx, SNAPSHOT_THROUGH)? != capture.from) {
                return Err(RuntimeError::Generation("snapshot recovery lease is no longer current".into()));
            }
            store_identity::require_owner(tx, owner.backend, owner.store_id, owner.native)?;
            let revision = capture.send_revision.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
            Ok(Accepted { tx, revision })
        }
    }

    impl<T: DeviceTx> Accepted<'_, T> {
        pub(super) fn apply(self) -> Result<BTreeMap<String, u64>, RuntimeError> {
            let tx = self.tx;
            let retired = store_identity::retire_known(tx)?;
            tx.set_meta(SNAPSHOT_REQUIRED, "1")?;
            // Keep the old base's acquisition evidence for reads. sync_state
            // reports unacquired and new predictions refuse while recovery is owed.
            tx.set_meta(SEND_REVISION, &self.revision.to_string())?;
            predictions::clear_capture(tx)?;
            // Keep private effects/ACKs until the first valid replacement page;
            // retain image-head evidence even when consuming a snapshot lease.
            let images_at = store_identity::restore_images_at(tx)?;
            snapshot::clear(tx)?;
            tx.set_meta(deferred::IMAGES_AT, &images_at.to_string())?;
            Ok(retired)
        }
    }
}
