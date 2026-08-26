pub(super) fn obtain_kernel_verified_evidence() {
    // @attack
    let _: evidence::KernelVerifiedEvidence<'_> = super::super::super::evidence::verify_and_consume(
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        todo!(),
        [1; 32],
        1,
    );
}
