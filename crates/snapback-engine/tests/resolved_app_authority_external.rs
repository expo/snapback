use snapback_engine::contract_types::{AuthMode, ServerProfile};
use snapback_engine::local::LocalSnapback;
use snapback_sync::auth::admission::AdmissionController;
use snapback_sync::auth::invocation::{
    InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
};

#[test]
fn dependent_cannot_carry_a_genuine_prepared_authority_to_a_second_engine() {
    let first = AdmissionController::new(1, true).expect("first admission controller");
    let authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::HttpMutation,
        AuthMode::Dev,
        ServerProfile::Test,
        first.admit_dev().expect("first engine admission"),
        &WireAuthorityFields::default(),
        ResolvedAppAuthority::Anonymous,
        None,
    )
    .expect("genuine first-graph authority");

    let mut second = LocalSnapback::memory().expect("second engine");
    let rederive_error = second
        .prepare_anonymous_authority(
            InvocationSource::HttpMutation,
            AuthMode::Dev,
            ServerProfile::Test,
            first.admit_dev().expect("another first-engine admission"),
            &WireAuthorityFields::default(),
            0,
            None,
        )
        .expect_err("the second engine cannot rederive authority under a foreign admission");
    assert_eq!(
        rederive_error.diagnostic.code,
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    );
    let error = second
        .plan_grant_revocation_service_terminal(&authority, "grant-b", 1)
        .expect_err("a genuine authority remains bound to its producing graph");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
}
