pub(super) fn clone_kernel_verified_evidence() {
    fn require_clone<T: Clone>(_: &T) {}

    let evidence: evidence::KernelVerifiedEvidence<'_> = todo!();
    // @attack
    require_clone(&evidence);
}
