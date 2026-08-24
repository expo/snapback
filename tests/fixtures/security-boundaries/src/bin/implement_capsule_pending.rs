struct FakePending;

// @attack
impl snapback_server::server::PendingCommit for FakePending {}

fn main() {}
