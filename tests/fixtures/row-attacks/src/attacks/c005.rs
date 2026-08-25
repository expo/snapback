use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::ResolvedSessionAuthority;

fn forge_session_authority() {
    // @attack
    let _ = ResolvedSessionAuthority {
        user_id: "victim-user".to_owned(),
        session_id: "victim-session".to_owned(),
        provider: "email-code".to_owned(),
        generation: 1,
        authority_instance_id: "victim-authority".to_owned(),
        session_not_after_ms: u64::MAX,
        provider_not_after_ms: None,
        rehearsal_provenance: None,
        admission_origin: panic!("compile-only forged admission origin"),
    };
}

fn main() {
    let _ = forge_session_authority;
    report_observation(
        "C005",
        Ok("dependent forged a session authority from caller-selected subject fields".to_owned()),
    );
}
