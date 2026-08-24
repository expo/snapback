use snapback_sync::auth::coordinator::AuthCoordinator;

fn main() {
    // @attack
    let _constructor = AuthCoordinator::new;
}
