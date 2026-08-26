pub(super) fn reinstall_kernel_verified_evidence() {
    let evidence: KernelVerifiedEvidence<'_> = todo!();

    // @attack
    let _ = super::super::super::permit::activate(
        &evidence,
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        [1; 32],
    );
}
