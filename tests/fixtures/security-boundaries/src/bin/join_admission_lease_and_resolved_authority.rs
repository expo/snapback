use snapback_auth::auth::admission::AdmissionLease;
use snapback_kernel::contract_types::ServerProfile;
use snapback_kernel::manifest::AuthMode;
use snapback_sync::auth::coordinator::PreparedBearerAuthority;
use snapback_sync::auth::identity_core::AuthClaimsProjection;
use snapback_sync::auth::invocation::{
    InvocationGate, InvocationSource, WireAuthorityFields,
};

// Both carriers are opaque outputs of genuine coordinator resolution. There
// is no forged literal in this fixture: the attack is the raw join itself.
fn join_two_resolutions(
    first: PreparedBearerAuthority,
    second: PreparedBearerAuthority,
    admission: AdmissionLease,
    first_claims: AuthClaimsProjection,
    second_claims: AuthClaimsProjection,
) {
    // @attack
    let _prepared = InvocationGate::prepare_admitted_authority(
        InvocationSource::HttpQuery,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission.clone(),
        &WireAuthorityFields::default(),
        first.resolved().clone(),
        Some(first_claims),
    )
    .unwrap();
    let _second = InvocationGate::prepare_admitted_authority(
        InvocationSource::HttpQuery,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission,
        &WireAuthorityFields::default(),
        second.resolved().clone(),
        Some(second_claims),
    )
    .unwrap();
}

fn main() {}
