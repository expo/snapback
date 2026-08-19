use snapback_kernel::storage::LocalDatabase;
use snapback_kernel::storage::pending_effects::CreatePendingEffect;

fn create_without_admission(database: &mut LocalDatabase, request: CreatePendingEffect) {
    let _ = database.create_pending_effect(request);
}

fn main() {}
