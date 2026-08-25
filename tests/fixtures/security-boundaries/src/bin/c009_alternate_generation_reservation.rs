use snapback_auth::auth::invalidation::{AuthenticatedBootIssuer, IssuerId, LiveInvalidationIssuer};
use snapback_engine::ephemeral::ConnectionEffectFence;
use snapback_engine::local::{
    LiveInvalidationAdmission, LiveResumeInput, LocalSnapback,
};
use snapback_sync::auth::invocation::PreparedAuthority;

fn attempt_live_route(
    snapback: &mut LocalSnapback,
    input: LiveResumeInput,
    authority: PreparedAuthority,
    effect_fence: ConnectionEffectFence,
) {
    let issuer = LiveInvalidationIssuer::new(AuthenticatedBootIssuer {
        issuer_id: IssuerId {
        authorization_incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
        boot_sequence: 1,
        boot_nonce: "AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
        },
        key_id: "fixture-key".to_owned(),
        mac: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
    })
    .unwrap();
    // @attack
    let connection = issuer.reserve_connection(effect_fence).unwrap();
    let invalidation = LiveInvalidationAdmission::new(connection);
    let _ = snapback.prepare_resume_live_for_transport(
        "fixture-live-query".to_owned(),
        input,
        authority,
        invalidation,
    );
}

fn main() {
    let _ = attempt_live_route;
}
