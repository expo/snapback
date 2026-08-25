use snapback_kernel::storage::LocalDatabase;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;

fn record_approver_not_derived_from_authority(
    database: &mut LocalDatabase,
    effect_execution_authority: PreparedAuthority,
    effect_id: &str,
) {
    // @attack
    let attributed = {
        let forged = database
            .prepare_pending_effect_approval(effect_id, "attacker-selected-approver", 1)
            .expect("public database preparation accepts the supplied approver");
        effect_execution_authority
            .with_effect_caller_attribution(
                forged.effect(),
                forged.approver_principal_id(),
            )
            .expect("the supplied approver is accepted as telemetry authority")
    };
    assert_eq!(
        attributed
            .telemetry_caller_details()
            .expect("effect attribution")
            .get("approverKey")
            .and_then(serde_json::Value::as_str),
        Some("attacker-selected-approver"),
    );
}

fn main() {
    let _ = record_approver_not_derived_from_authority;
    report_observation(
        "F129",
        Ok("dependent can mint and record an approver that no approving authority derived".to_owned()),
    );
}
