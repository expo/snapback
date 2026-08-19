struct FakeInterlock;

// @attack
impl snapback_kernel::storage::AuthorizationCommitInterlock for FakeInterlock {}

fn main() {}
