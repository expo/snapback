//! Worker authority is sampled against the executing writer.
use super::*;

pub(super) fn service_admission(
    request: &impl RequestInfo,
    shared: &Shared,
) -> Result<String, Refusal> {
    dev_request(request, shared)?;
    if !matches!(single_header(request, "x-snapback-persona"), Ok(None)) {
        return Err(Refusal::new("E_AUTH", "auth", "this is a worker's door: send a live service token (`snapback4 token --service <name>`)").guide("effects"));
    }
    crate::auth::bearer_token(request)
        .map(str::to_owned)
        .map_err(|e| e.refusal())
}
pub(super) fn service_token_of(
    token: &str,
    shared: &Shared,
    engine: &Engine,
) -> Result<String, Refusal> {
    snapback4_core::identity::current_service(engine.store(), token, snapback4_core::identity::ServiceSample {
        now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire),
    }).map_err(|e| e.refusal())?.ok_or_else(|| Refusal::new("E_AUTH", "auth", "this is a worker's door: send a live service token (`snapback4 token --service <name>`)").guide("effects"))
}
pub(super) fn service_of(request: &Request, shared: &Shared) -> Result<String, Refusal> {
    let admission = service_admission(request, shared)?;
    shared
        .engine
        .attempt(move |engine, shared| service_token_of(&admission, shared, engine))
}
pub(super) fn service_of_locked(
    request: &impl RequestInfo,
    shared: &Shared,
    engine: &Engine,
) -> Result<String, Refusal> {
    service_token_of(&service_admission(request, shared)?, shared, engine)
}
