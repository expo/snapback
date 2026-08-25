use snapback_engine::contract_types::{AuthMode, ServerProfile};
use snapback_engine::local::LocalSnapback;
use snapback_sync::auth::admission::AdmissionController;
use snapback_sync::auth::invocation::{
    InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
};

fn carry_to_second_engine(resolved: ResolvedAppAuthority) {
    let first = AdmissionController::new(1, true).unwrap();
    let admission = first.admit_for_mode(AuthMode::Sessions).unwrap();
    // @attack
    let prepared = InvocationGate::prepare_admitted_authority(
        InvocationSource::AgentGrantManagement,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission,
        &WireAuthorityFields::default(),
        resolved,
        None,
    )
    .unwrap();
    let mut second = LocalSnapback::memory().unwrap();
    let _ = second.plan_grant_revocation_service_terminal(&prepared, "grant-b", 1);
}

fn main() {
    carry_to_second_engine(ResolvedAppAuthority::Anonymous);
}
