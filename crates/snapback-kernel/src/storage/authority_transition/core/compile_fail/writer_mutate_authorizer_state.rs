fn writer_mutate_authorizer_state(transaction: &mut ProtectedTx<'_>) {
    // @attack
    transaction
        .authorizer_state
        .transition
        .lock()
        .unwrap()
        .phase = ScopePhase::Idle {
        generation: u64::MAX,
    };
}
