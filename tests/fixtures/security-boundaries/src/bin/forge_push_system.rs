use snapback_kernel::push::PushStorageAuthority;

fn main() {
    // @attack
    let _ = PushStorageAuthority::System;
}
