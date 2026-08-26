fn swap_initialized_writer_policy(
    mut initialized: evidence::InitializedConnection,
    writer_authority: crate::storage::write_authority::WriterAuthorityV1,
) -> evidence::InitializedConnection {
    // @attack
    initialized.writer_authority = writer_authority;
    initialized
}
