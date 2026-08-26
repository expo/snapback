fn raw_connection_accessor(transaction: &mut ProtectedTx<'_>) {
    // @attack
    transaction.connection.authorizer(Some(raw_allow_all));
}

fn raw_allow_all(_: rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization {
    rusqlite::hooks::Authorization::Allow
}
