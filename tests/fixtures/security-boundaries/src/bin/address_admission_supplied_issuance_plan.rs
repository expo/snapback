use snapback_auth::auth::provider::{AddressAdmission, ProviderSessionIssuanceCommitPlan};

fn supply_independent_plan(
    admission: &AddressAdmission,
    plan: &ProviderSessionIssuanceCommitPlan,
) {
    // @attack
    let _ = admission.commit_planned_issuance_plan(plan);
}

fn main() {}
