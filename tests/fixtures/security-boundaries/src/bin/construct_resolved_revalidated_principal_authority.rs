use snapback_kernel::storage::watches::RevalidatedWatchPrincipal;

// A genuine revalidation result must not be editable before it is consumed by
// prepare_admitted_revalidated_principal.
fn mutate_genuine_revalidation(mut principal: RevalidatedWatchPrincipal) {
    // @attack
    principal.user_id = "caller-chosen-user".to_owned();
}

fn main() {}
