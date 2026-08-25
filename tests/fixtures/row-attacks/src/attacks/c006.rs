use snapback_row_attack_fixtures::report_observation;
// Glob both stable modules so this capability witness survives the pending
// ownership move: current main exports the type from the contract module;
// the reviewed lane exports it beside the fence implementation.
use snapback_sync::auth::service_authority_contract::*;
use snapback_sync::auth::service_fence::*;

fn forge_service_authority_witness() {
    // @attack
    let _ = ServiceAuthorityWitness {
        token_id: "victim-token".to_owned(),
        grant_id: "victim-grant".to_owned(),
        actor_user_id: "attacker-agent".to_owned(),
        effective_user_id: Some("victim-user".to_owned()),
        credential_id: "attacker-credential".to_owned(),
        credential_generation: 1,
        expires_at_ms: u64::MAX,
        grant_expires_at_ms: None,
    };
}

fn main() {
    let _ = forge_service_authority_witness;
    report_observation(
        "C006",
        Ok("dependent forged every service-authority witness fact".to_owned()),
    );
}
