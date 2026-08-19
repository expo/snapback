struct FakeSenderProofStore;

// @attack
impl snapback_kernel::storage::auth_sender::SenderProofAuthorityOperations
    for FakeSenderProofStore
{
}

fn main() {}
