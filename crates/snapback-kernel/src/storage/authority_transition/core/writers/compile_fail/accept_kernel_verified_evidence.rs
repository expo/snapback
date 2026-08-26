pub(super) fn accept_kernel_verified_evidence() {
    let evidence: KernelVerifiedEvidence<'_> = todo!();

    // @attack
    let _ = super::super::super::verifier::consume_verified_proof(
        todo!(),
        todo!(),
        todo!(),
        evidence,
        todo!(),
        [1; 32],
        1,
    );
}
