use snapback_auth::auth::invalidation::AuthorizationInvalidationConnection;
use snapback_engine::ephemeral::ConnectionEffectFence;
use snapback_engine::local::{LiveInvalidationAdmission, LiveResumeInput, LocalSnapback};
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;

fn replay_historical_composition(
    snapback: &mut LocalSnapback,
    input: LiveResumeInput,
    authority: PreparedAuthority,
    connection: &AuthorizationInvalidationConnection,
    _effect_fence: ConnectionEffectFence,
) {
    let mut forged = connection.clone();
    // @ref LLP 0303#s-a-compile-fail-witness-proves-a-spelling-is-gone-not-a-capability — replay the historical Clone route instead of the replacement literal witness.
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
    let _ = replay_historical_composition;
    report_observation(
        "C009",
        Ok(
            "dependent cloned an issued invalidation connection, installed a never-issued generation, and supplied it to the live retry route"
                .to_owned(),
        ),
    );
}
