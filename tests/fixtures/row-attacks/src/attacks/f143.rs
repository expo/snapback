use snapback_auth::auth::admission::AdmissionLease;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::{
    InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
};
use snapback_types::contract_types::{AuthMode, ServerProfile};

fn join_independent_subject_and_lease(admission: AdmissionLease, resolved: ResolvedAppAuthority) {
    // @attack
    let _ = InvocationGate::prepare_admitted_authority(
        InvocationSource::AgentGrantManagement,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission,
        &WireAuthorityFields::default(),
        resolved,
        None,
    );
}

fn main() {
    let _ = join_independent_subject_and_lease;
    report_observation(
        "F143",
        Ok(
            "dependent joined a live admission lease to an independently obtained subject"
                .to_owned(),
        ),
    );
}
