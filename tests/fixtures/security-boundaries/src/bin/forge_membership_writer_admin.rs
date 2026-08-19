use serde_json::Map;
use snapback_kernel::storage::{LocalDatabase, MembershipWriter};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut database = LocalDatabase::memory()?;
    // @attack
    let writer = MembershipWriter::Admin;
    let plan = database.membership_plans_read().plan_privileged_membership_insert(
        &writer,
        "members",
        Map::new(),
    )?;
    let _ = database
        .membership_plans()
        .commit_membership_plan(&writer, plan)?;
    Ok(())
}
