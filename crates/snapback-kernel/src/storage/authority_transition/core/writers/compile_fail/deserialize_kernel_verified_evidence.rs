pub(super) fn deserialize_kernel_verified_evidence() {
    // @attack
    let _: evidence::KernelVerifiedEvidence<'_> = serde_json::from_str("{}").unwrap();
}
