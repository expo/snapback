use snapback_sync::auth::invocation::ResolvedAppAuthority;

fn main() {
    // @attack
    let _authority = ResolvedAppAuthority::Session {
        user_id: "forged-user".to_owned(),
        session_id: "forged-session".to_owned(),
        provider: "forged-provider".to_owned(),
        generation: 1,
        authority_instance_id: "forged-authority".to_owned(),
        session_not_after_ms: u64::MAX,
        provider_not_after_ms: None,
        rehearsal_provenance: None,
    };
}
