fn commit_protected_tx(transaction: &mut ProtectedTx<'_>) {
    // @attack
    transaction.commit();
}
