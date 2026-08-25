use snapback_kernel::auth::crypto::RandomSource;
use snapback_kernel::storage::LocalDatabase;
use snapback_kernel::storage::auth_agents::AgentRegistration;

fn attempt_composed_registration(
    database: &mut LocalDatabase,
    random: &dyn RandomSource,
    registration: &AgentRegistration,
) {
    // @attack
    let _ = (|| {
        database.create_agent_principal("agent", 0, registration)?;
        database.issue_initial_agent_credential("agent", 0, random)?;
        Ok::<_, snapback_kernel::diagnostic::SnapbackError>(())
    })();
}

fn main() {}
