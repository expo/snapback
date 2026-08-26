use snapback_kernel::storage::pending_effects::{
    PendingEffectOwnerEvidence, PendingEffectStatus,
};
use snapback_row_attack_fixtures::{report_observation, setup_pending_effect_owner_bridge_attack};

fn main() -> Result<(), String> {
    let mut fixture = setup_pending_effect_owner_bridge_attack()?;
    let owner = fixture
        .serving
        .resolve_pending_effect_owner(PendingEffectOwnerEvidence::Anonymous, 10_000)
        .map_err(|error| format!("resolve anonymous owner: {error:?}"))?;

    // @attack
    let result = fixture
        .serving
        .create_pending_effect_admitted(&owner, fixture.request)
        .map_err(|error| format!("raw creation bridge refused: {error:?}"))
        .and_then(|record| {
            (record.status == PendingEffectStatus::Pending)
                .then(|| {
                    format!(
                        "caller-authored request became durable Pending id={}",
                        record.id
                    )
                })
                .ok_or_else(|| format!("creation returned unexpected status: {:?}", record.status))
        });

    report_observation("F318", result);
    Ok(())
}
