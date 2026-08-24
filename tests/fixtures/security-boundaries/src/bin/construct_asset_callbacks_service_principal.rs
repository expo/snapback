use snapback_kernel::storage::auth_asset_callbacks::AssetCallbacksServicePrincipal;
use snapback_kernel::storage::auth_grants::{ExactGrantScope, ScopedFunctionKind};

fn main() {
    // @attack
    let _principal = AssetCallbacksServicePrincipal {
        app_id: "forged-app".to_owned(),
        actor_user_id: "forged-actor".to_owned(),
        grant_id: "forged-grant".to_owned(),
        scope: ExactGrantScope {
            function_id: "forged-function".to_owned(),
            kind: ScopedFunctionKind::Mutation,
            basis: 1,
            authority_creating: false,
        },
    };
}
