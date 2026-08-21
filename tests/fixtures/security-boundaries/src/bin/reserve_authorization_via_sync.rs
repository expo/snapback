fn main() {
    let backend = snapback_sync::ephemeral::LocalEphemeralBackend::new();
    // @attack
    backend.install_authorization_commit_carriers(());
}
