use snapback_engine::local::ServiceAuthorityTerminalPlan;

fn reuse(plan: ServiceAuthorityTerminalPlan) {
    // @attack
    let second = plan.clone();
    drop((plan.acquire_gate(), second.acquire_gate()));
}

fn main() {
    let _ = reuse;
}
