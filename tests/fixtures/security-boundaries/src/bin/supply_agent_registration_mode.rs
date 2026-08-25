use snapback_kernel::auth::crypto::RandomSource;
use snapback_kernel::manifest::AgentsMode;
use snapback_kernel::storage::LocalDatabase;

fn attempt_mode_supply(database: &mut LocalDatabase, random: &dyn RandomSource) {
    // @attack
    let _ = database.register_agent_principal(
        AgentsMode::Open,
        None,
        None,
        None,
        snapback_kernel::contract_types::ServerProfile::Test,
        0,
        random,
    );
}

fn main() {}
