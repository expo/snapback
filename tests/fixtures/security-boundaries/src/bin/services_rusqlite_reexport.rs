// @attack
use snapback_services::test_support::rusqlite::Connection;

fn main() {
    let _ = Connection::open_in_memory();
}
