use snapback_auth::auth::invalidation::{
    AUTH_INVALIDATION_PROTOCOL_VERSION, AuthorizationInvalidationConnection, IssuerId,
};
use snapback_engine::ephemeral::ConnectionEffectFence;
use snapback_engine::local::{
    LiveInvalidationAdmission, LiveResumeInput, LocalSnapback,
};
use snapback_kernel::storage::AuthorizationVersion;
use snapback_sync::auth::invocation::PreparedAuthority;

fn attempt_live_route(
    snapback: &mut LocalSnapback,
    input: LiveResumeInput,
    authority: PreparedAuthority,
    _effect_fence: ConnectionEffectFence,
) {
    // @attack
    let connection = AuthorizationInvalidationConnection {
        protocol_version: AUTH_INVALIDATION_PROTOCOL_VERSION,
        issuer_id: IssuerId {
            authorization_incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            boot_sequence: 1,
            boot_nonce: "AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
        },
        connection_generation: 10_001,
        authorization: AuthorizationVersion {
            incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            epoch: 1,
        },
        version_stream: "fixture-stream".to_owned(),
        issuer_retirement: None,
    };
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
