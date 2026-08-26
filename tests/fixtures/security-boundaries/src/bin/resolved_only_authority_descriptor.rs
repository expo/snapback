use snapback_sync::auth::invocation::ResolvedAppAuthority;

fn attack(authority: &ResolvedAppAuthority) {
    // @attack
    let _ = snapback_sync::auth::invocation::descriptor_for_resolved_authority(
        authority,
        "018f0d90-7b21-7a22-8c33-445566778899",
    );
}

fn main() {
    let _ = attack;
}
