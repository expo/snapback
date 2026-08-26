// @attack
use snapback_services::test_support::rusqlite::Connection;

use snapback_row_attack_fixtures::report_observation;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "CREATE TABLE authorization_bypass(value INTEGER NOT NULL);\
         INSERT INTO authorization_bypass(value) VALUES (313);",
    )?;
    let observed = connection.query_row(
        "SELECT value FROM authorization_bypass",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    report_observation(
        "F313",
        (observed == 313)
            .then_some("dependent executed arbitrary SQL through the services re-export".to_owned())
            .ok_or_else(|| format!("raw SQL read back unexpected value {observed}")),
    );
    Ok(())
}
