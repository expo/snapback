//! Typed action-authority fixture for the HTTP flight ratchet.
/// Seed an admitted claim through typed access on both stores. PG's HTTP
/// profile refuses action declarations; this only fixtures its shared resolver.
pub fn action_claim(
    store: &mut crate::store_port::AnyStore,
    parent: &crate::identity::Session,
    now: i64,
) -> Result<crate::identity::Session, crate::RuntimeError> {
    use crate::{
        authority::{self, AdmissionStanding},
        engine::actions::requests::{NewRequest, RequestsTransaction},
        identity,
    };
    let admission = store.with_authority_snapshot(|tx| {
        authority::admission_authority(tx, &identity::digest(&parent.token), &parent.principal, now)
    })?;
    let AdmissionStanding::Live(authority) = admission else {
        panic!("live parent fixture");
    };
    let session = identity::open_session(store, &parent.principal, "action", now)?;
    let tx = store.transaction()?;
    tx.insert_request(&NewRequest {
        id: "rt0-action",
        action: "rt0",
        args: "{}",
        principal: &parent.principal,
        at: now,
        authority: Some(&authority),
        args_digest: "rt0",
        spec: "{}",
        contract: "rt0",
        deadline: Some(now + 3_600_000),
        release: None,
        service_generation: None,
    })?;
    tx.claim_request(
        "rt0-action",
        "service:rt0",
        &identity::digest(&session.token),
        now + 3_600_000,
    )?;
    tx.commit()?;
    Ok(session)
}
