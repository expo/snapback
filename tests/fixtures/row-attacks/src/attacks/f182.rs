use snapback_kernel::auth::crypto::RandomSource;
use snapback_kernel::storage::LocalDatabase;
use snapback_kernel::storage::auth_agents::AgentRegistration;
use snapback_row_attack_fixtures::report_observation;

fn compose_registration_partials(
    database: &mut LocalDatabase,
    random: &dyn RandomSource,
    registration: &AgentRegistration,
) {
    // @attack
    let _ = (|| {
        database.create_agent_principal("attacker-agent", 0, registration)?;
        database.issue_initial_agent_credential("attacker-agent", 0, random)?;
        Ok::<_, snapback_kernel::diagnostic::SnapbackError>(())
    })();
}

fn main() {
    let _ = compose_registration_partials;
    report_observation(
        "F182",
        Ok(
            "dependent composed the partial principal and credential APIs into registration"
                .to_owned(),
        ),
    );
}
