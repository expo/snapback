pub(super) fn convert_kernel_verified_evidence() {
    let proof: evidence::VerifiedProof = todo!();

    // @attack
    let _: evidence::KernelVerifiedEvidence<'_> = proof.into();
}
