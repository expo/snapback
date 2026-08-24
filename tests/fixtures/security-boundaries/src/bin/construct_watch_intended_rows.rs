use snapback_kernel::storage::watches::WatchManagementIntendedRows;

fn main() {
    // @attack
    let _ = WatchManagementIntendedRows {
        operation_identity: panic!("compile-only operation identity"),
        watch: panic!("compile-only watch"),
        durable_watch: panic!("compile-only durable row"),
        effect: panic!("compile-only effect"),
        minted_fingerprint: [0; 32],
    };
}
