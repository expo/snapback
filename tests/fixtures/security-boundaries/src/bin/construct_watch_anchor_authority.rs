use snapback_kernel::storage::watches::WatchAnchorAuthority;

// The parameter can only be supplied by the kernel's durable watch lookup;
// field mutation must remain unavailable before the public preparation path.
fn mutate_genuine_anchor(mut authority: WatchAnchorAuthority) {
    // @attack
    authority.effective_user_id = "caller-chosen-user".to_owned();
}

fn main() {}
