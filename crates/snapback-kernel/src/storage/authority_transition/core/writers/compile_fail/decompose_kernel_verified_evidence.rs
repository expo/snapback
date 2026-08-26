pub(super) fn decompose_kernel_verified_evidence() {
    // This compile-fail-only branch can never produce evidence. Unlike a
    // diverging `todo!()`, it lets rustc reach the privacy pass that judges
    // the named-field attack below without constructing an invalid value.
    let evidence = match None::<evidence::KernelVerifiedEvidence<'_>> {
        Some(evidence) => evidence,
        None => return,
    };

    // @attack
    let evidence::KernelVerifiedEvidence {
        transaction: _transaction,
        single_use_nonce: _nonce,
        ..
    } = evidence;
}
