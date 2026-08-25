use snapback_kernel::storage::LocalDatabase;
use snapback_sync::auth::invocation::PreparedAuthority;

fn attack(database: &mut LocalDatabase, authority: PreparedAuthority, effect_id: &str) {
    // @attack
    let _recorded = {
        let forged = database
            .prepare_pending_effect_approval(effect_id, "attacker-selected-approver", 1)
            .unwrap();
        authority
            .with_effect_caller_attribution(
                forged.effect(),
                forged.approver_principal_id(),
            )
            .unwrap()
            .telemetry_caller_details()
    };
}

fn main() {}
