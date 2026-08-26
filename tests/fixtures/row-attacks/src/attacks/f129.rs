use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;
use snapback_types::telemetry_contract::CallerAttributionV1;

fn record_approver_not_derived_from_authority(effect_execution_authority: PreparedAuthority) {
    // @attack
    let attributed = effect_execution_authority.with_caller_attribution(
        CallerAttributionV1::from_effect("integration", "attacker-selected-caller".to_owned())
            .with_approver("attacker-selected-approver".to_owned()),
    );
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
