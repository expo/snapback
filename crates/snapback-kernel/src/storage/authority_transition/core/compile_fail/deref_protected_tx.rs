fn deref_protected_tx(transaction: &mut ProtectedTx<'_>) {
    // @attack
    let _: &rusqlite::Transaction<'_> = &**transaction;
}
