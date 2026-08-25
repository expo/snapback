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
    connection: AuthorizationInvalidationConnection,
    independently_supplied_fence: ConnectionEffectFence,
) {
    // @attack
    let invalidation =
        LiveInvalidationAdmission::new(Some(connection), independently_supplied_fence);
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
