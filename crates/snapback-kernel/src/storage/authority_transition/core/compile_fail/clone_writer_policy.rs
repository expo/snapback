fn clone_writer_policy(
    policy: crate::storage::write_authority::WriterAuthorityV1,
) -> crate::storage::write_authority::WriterAuthorityV1 {
    // @attack
    Clone::clone(&policy)
}
