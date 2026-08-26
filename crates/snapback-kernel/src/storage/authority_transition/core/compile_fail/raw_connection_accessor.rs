fn raw_connection_accessor(connection: &GuardedConnection) {
    // @attack
    let _ = connection.connection();
}
