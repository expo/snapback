pub(super) fn reinstall_kernel_verified_evidence() {
    let evidence: evidence::KernelVerifiedEvidence<'_> = todo!();

    // @attack
    let _ = super::super::super::evidence::consume(evidence, todo!(), todo!());
}
