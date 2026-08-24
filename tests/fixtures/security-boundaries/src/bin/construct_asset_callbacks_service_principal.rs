use snapback_kernel::storage::auth_asset_callbacks::AssetCallbacksServicePrincipal;

// A value reaching this function must come from the kernel's protected-catalog
// resolution; the attack edits that genuine carrier before public preparation.
fn mutate_genuine_principal(mut principal: AssetCallbacksServicePrincipal) {
    // @attack
    principal.actor_user_id = "caller-chosen-actor".to_owned();
}

fn main() {}
