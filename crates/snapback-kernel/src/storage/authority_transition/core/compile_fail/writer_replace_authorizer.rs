fn writer_replace_authorizer(transaction: &mut ProtectedTx<'_>) {
    // @attack
    transaction.connection.authorizer(Some(writer_allow_all));
}

fn writer_allow_all(_: rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization {
    rusqlite::hooks::Authorization::Allow
}
