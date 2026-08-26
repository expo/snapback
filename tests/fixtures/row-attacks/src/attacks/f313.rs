use snapback_kernel::push::test_support::PushAuthorizationTestFixture;
use snapback_row_attack_fixtures::report_observation;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = PushAuthorizationTestFixture::app_members()?;
    // @attack
    fixture.connection.execute_batch(
        "CREATE TABLE authorization_bypass(value INTEGER NOT NULL);\
         INSERT INTO authorization_bypass(value) VALUES (313);",
    )?;
    let observed = fixture.connection.query_row(
        "SELECT value FROM authorization_bypass",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    report_observation(
        "F313",
        (observed == 313)
            .then_some("dependent executed arbitrary SQL through the confined fixture".to_owned())
            .ok_or_else(|| format!("raw SQL read back unexpected value {observed}")),
    );
    Ok(())
}
