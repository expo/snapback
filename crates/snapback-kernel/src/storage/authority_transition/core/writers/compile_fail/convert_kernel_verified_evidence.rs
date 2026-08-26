pub(super) fn convert_kernel_verified_evidence() {
    let proof: VerifiedProof = todo!();

    // @attack
    let _: KernelVerifiedEvidence<'_> = proof.into();
}
