use snapback_engine::local::{
    ExpiredServiceAuthorityCommit, ExpiredServiceAuthorityPlan,
};

fn accept_commit(_: ExpiredServiceAuthorityCommit) {}

async fn split(plan: ExpiredServiceAuthorityPlan) {
    // @attack
    let (commit, gate) = plan.acquire_gate().await.unwrap();
    drop(gate);
    accept_commit(commit);
}

fn main() {
    let _ = split;
}
