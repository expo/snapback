use snapback_auth::auth::invalidation::AuthorizationInvalidationConnection;
use snapback_engine::ephemeral::ConnectionEffectFence;
use snapback_engine::local::{
    LiveInvalidationAdmission, LiveResumeInput, LocalSnapback,
};
use snapback_sync::auth::invocation::PreparedAuthority;

fn attempt_live_route(
    snapback: &mut LocalSnapback,
    input: LiveResumeInput,
    authority: PreparedAuthority,
    connection: &AuthorizationInvalidationConnection,
    _effect_fence: ConnectionEffectFence,
) {
    let mut forged = connection.clone();
    // @attack
    forged.connection_generation = forged.connection_generation().saturating_add(10_000);
    let invalidation = LiveInvalidationAdmission::new(forged);
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
