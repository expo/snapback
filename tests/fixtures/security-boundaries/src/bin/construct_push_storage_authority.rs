use snapback_kernel::push::PushStorageAuthority;
use snapback_kernel::storage::LocalDatabase;

fn main() {
    let database = LocalDatabase::memory().unwrap();
    // @attack
    let _ = PushStorageAuthority {
        database_binding: database.binding(),
        kind: panic!("compile-only private kind"),
    };
}
