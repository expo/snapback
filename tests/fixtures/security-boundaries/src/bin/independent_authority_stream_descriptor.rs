use snapback_sync::auth::invocation::PreparedAuthority;

fn attack(authority: &PreparedAuthority) {
    // @attack
    let _ = snapback_sync::auth::invocation::descriptor_for_authority(
        authority,
        "018f0d90-7b21-7a22-8c33-445566778899",
    );
}

fn main() {
    let _ = attack;
}
