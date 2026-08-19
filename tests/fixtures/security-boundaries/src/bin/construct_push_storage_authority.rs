use snapback_kernel::push::PushStorageAuthority;

fn main() {
    // @attack
    let _ = PushStorageAuthority {
        database_identity: std::sync::Arc::new(()),
        kind: panic!("compile-only private kind"),
    };
}
