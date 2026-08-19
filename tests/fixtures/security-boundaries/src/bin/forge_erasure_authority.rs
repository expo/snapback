use snapback_kernel::proof_checkpoint::ProtectedRecordErasureAuthorityV1;

fn main() {
    // @attack
    let _ = ProtectedRecordErasureAuthorityV1::from_admitted_facts(
        std::sync::Arc::new(()),
        "admin-bypass",
        "operator",
        "protected-erasure",
        "production",
        1,
        "fixture",
        "00",
        "fixture-stream",
    );
}
