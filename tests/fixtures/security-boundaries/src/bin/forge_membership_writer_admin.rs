use serde_json::Map;
use snapback_kernel::storage::{LocalDatabase, MembershipWriter, ServingDatabase};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database = LocalDatabase::memory()?;
    let mut serving = ServingDatabase::adopt(database)?;
    // @attack
    let writer = MembershipWriter::Admin;
    let plan = serving.membership_plans().plan_privileged_membership_insert(
        &writer,
        "members",
        Map::new(),
    )?;
    let _ = serving
        .membership_plans()
        .commit_membership_plan(&writer, plan)?;
    Ok(())
}
