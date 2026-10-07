//! Native open has one durable acceptance boundary, including recovery.
//! The feature-gated early return keeps the qualified web opening body and its
//! source locations unchanged; only native builds reach this transaction path.
use super::*;

// @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — consume the kept-backend/absence observation inside installation's transaction.
// @ref LLP 3000.033#1.3 — no fallible native-open work remains after the
// installation transaction commits: capture recovery and cache cleanup join it.
pub(super) fn open<S: DeviceStore>(mut store: S, backend: Backend, metadata: BTreeMap<String, String>, expected: BTreeMap<String, Option<String>>, reset: bool, backend_identity: String, first: bool) -> Result<Device<S>, RuntimeError> {
    let (native, native_digest, store_identity) = store.install_open(&backend.schema, &metadata, reset, &expected, |tx| {
        if first { tx.set_meta(media::FORMAT, media::ROW_FORMAT)?; }
        predictions::abandon_capture(tx)?;
        let digest = tx.meta(NATIVE_DIGEST)?;
        let module = tx.meta(NATIVE)?;
        let generation = tx.meta(NATIVE_GENERATION)?;
        let native = match (&module, &digest, &generation) {
            (Some(hex), Some(digest), Some(generation)) if generation.parse::<u64>().ok() == Some(backend.generation) => snapback4_core::value::decode_bytes_hex(hex)
                .filter(|bytes| sha256(bytes) == *digest)
                .and_then(|bytes| snapback4_core::engine::native::Module::compile(&bytes).ok())
                .map(std::sync::Arc::new),
            _ => None,
        };
        let valid = native.is_some();
        if !valid && (module.is_some() || digest.is_some() || generation.is_some()) {
            tx.delete_meta(&[NATIVE, NATIVE_DIGEST, NATIVE_GENERATION])?;
        }
        Ok((native, if valid { digest } else { None }, tx.meta(STORE_ID)?))
    })?;
    Ok(Device { preserved: None, delivery_now: 0, read_scopes: RefCell::new(serde_json::Value::Null),
        store, schema: backend.schema,
        programs: snapback4_core::small_map::collect(backend.programs.into_iter().map(|p| (p.name.clone(), p))),
        generation: backend.generation, backend_identity, store_identity, snapshot_owner: None,
        native, native_digest })
}
