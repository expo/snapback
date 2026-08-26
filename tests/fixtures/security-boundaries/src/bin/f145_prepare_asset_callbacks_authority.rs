use snapback_auth::auth::admission::AdmissionLease;
use snapback_kernel::storage::auth_asset_callbacks::AssetCallbacksServicePrincipal;
use snapback_sync::auth::invocation::InvocationGate;

fn prepare_raw(admission: AdmissionLease, principal: AssetCallbacksServicePrincipal) {
    // @attack
    let _ = InvocationGate::prepare_admitted_asset_callbacks(admission, principal);
}

fn main() {
    let _ = prepare_raw;
}
