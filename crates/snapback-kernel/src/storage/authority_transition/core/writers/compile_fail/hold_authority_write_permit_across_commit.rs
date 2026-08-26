pub(super) fn hold_authority_write_permit_across_commit() {
    let mut connection = Connection::open_in_memory().expect("open authorizer probe");
    create_schema(&connection).expect("create probe schema before install");
    let authorizer = authorizer();
    authorizer.install(&connection).expect("install authorizer");
    let transaction = authorizer
        .begin_immediate(&mut connection)
        .expect("begin immediate protected transaction");
    let permit = super::super::super::verifier::consume_verified_proof(
        transaction.sqlite(),
        transaction.identity(),
        &transaction.identity().database_origin,
        password_proof(),
        AuthorityMutation::IssuePasswordSession,
        [9; 32],
        15,
    )
    .expect("consume exact password evidence");

    // @attack
    transaction.commit().expect("commit while permit remains live");
    drop(permit);
}
