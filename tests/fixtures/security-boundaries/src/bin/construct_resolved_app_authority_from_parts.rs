use snapback_sync::auth::invocation::{
    ResolvedAppAuthority, ResolvedRevalidatedPrincipalAuthority, ResolvedServicePrincipalAuthority,
    ResolvedSessionAuthority,
};

fn main() {
    // @attack
    let subject = ResolvedSessionAuthority {
        user_id: "user".to_owned(),
        session_id: "session".to_owned(),
        provider: "email-code".to_owned(),
        generation: 1,
        authority_instance_id: "authority".to_owned(),
        session_not_after_ms: 2,
        provider_not_after_ms: None,
        rehearsal_provenance: None,
        admission_origin: panic!("compile-only admission origin"),
    };
    let _ = ResolvedAppAuthority::Session(subject);

    let subject = ResolvedServicePrincipalAuthority {
        actor_user_id: "agent".to_owned(),
        credential_id: "credential".to_owned(),
        credential_generation: 1,
        grant_id: "grant".to_owned(),
        token_id: "token".to_owned(),
        effective_user_id: Some("user".to_owned()),
        scopes: Vec::new(),
        token_expires_at_ms: 2,
        integration_status: None,
        admission_origin: panic!("compile-only admission origin"),
    };
    let _ = ResolvedAppAuthority::ServicePrincipal(subject);

    let subject = ResolvedRevalidatedPrincipalAuthority {
        user_id: "user".to_owned(),
        authority_instance_id: "watch-authority".to_owned(),
        admission_origin: panic!("compile-only admission origin"),
    };
    let _ = ResolvedAppAuthority::RevalidatedPrincipal(subject);
}
