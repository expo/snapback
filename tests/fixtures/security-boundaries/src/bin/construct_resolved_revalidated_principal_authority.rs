use snapback_sync::auth::invocation::ResolvedAppAuthority;

fn main() {
    // @attack
    let _authority = ResolvedAppAuthority::RevalidatedPrincipal {
        user_id: "forged-user".to_owned(),
        authority_instance_id: "forged-authority".to_owned(),
    };
}
