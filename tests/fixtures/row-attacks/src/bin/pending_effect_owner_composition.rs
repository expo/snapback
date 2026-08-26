use snapback_kernel::storage::pending_effects::PendingEffectStatus;
use snapback_row_attack_fixtures::{NOW, setup_pending_effect_consumer_attack};

fn require_status(
    actual: PendingEffectStatus,
    expected: PendingEffectStatus,
    transition: &str,
) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "{transition} produced {actual:?}, expected {expected:?}"
        ))
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut approval = setup_pending_effect_consumer_attack().await?;
    let approval_id = approval.effect_id.clone();
    let preparation_owner = approval.resolve_owner(NOW + 201)?;
    let prepared = approval
        .serving
        .prepare_pending_effect_approval(&preparation_owner, &approval_id, NOW + 201)
        .map_err(|error| format!("legitimate approval preparation: {error:?}"))?;
    let decision_owner = approval.resolve_owner(NOW + 202)?;
    let approved = approval
        .serving
        .approve_pending_effect_admitted(decision_owner, prepared, false, None, NOW + 202)
        .map_err(|error| format!("legitimate approval: {error:?}"))?;
    require_status(
        approved.record.status,
        PendingEffectStatus::Approved,
        "legitimate approval",
    )?;
    let (_, ticket) = approved.into_parts();
    let settled = approval
        .serving
        .settle_pending_effect_admitted(ticket.executed(Some("EXECUTED"), NOW + 203))
        .map_err(|error| format!("legitimate settlement: {error:?}"))?;
    require_status(
        settled.status,
        PendingEffectStatus::Executed,
        "legitimate settlement",
    )?;
    if settled.outcome_code.as_deref() != Some("EXECUTED") {
        return Err("legitimate settlement lost its ticket-paired outcome".to_owned());
    }

    let mut denial = setup_pending_effect_consumer_attack().await?;
    let denial_id = denial.effect_id.clone();
    let denial_owner = denial.resolve_owner(NOW + 201)?;
    let denied = denial
        .serving
        .deny_pending_effect_admitted(&denial_owner, &denial_id, NOW + 201)
        .map_err(|error| format!("legitimate denial: {error:?}"))?;
    require_status(
        denied.status,
        PendingEffectStatus::Refused,
        "legitimate denial",
    )?;

    let mut refusal = setup_pending_effect_consumer_attack().await?;
    let refusal_id = refusal.effect_id.clone();
    let refusal_owner = refusal.resolve_owner(NOW + 201)?;
    refusal
        .serving
        .refuse_pending_effect_admitted(
            &refusal_owner,
            &refusal_id,
            "LEGITIMATE_REFUSAL",
            NOW + 201,
        )
        .map_err(|error| format!("legitimate refusal: {error:?}"))?;
    let refused = refusal
        .serving
        .pending_effect(&refusal_id, NOW + 201)
        .map_err(|error| format!("read legitimate refusal: {error:?}"))?;
    require_status(
        refused.status,
        PendingEffectStatus::Refused,
        "legitimate refusal",
    )?;

    let mut database_a = setup_pending_effect_consumer_attack().await?;
    let inherited_owner = database_a.resolve_owner(NOW + 201)?;
    let mut database_b = setup_pending_effect_consumer_attack().await?;
    let database_b_id = database_b.effect_id.clone();
    let cross_database = database_b
        .serving
        .deny_pending_effect_admitted(&inherited_owner, &database_b_id, NOW + 201)
        .expect_err("database B accepted database A's exact owner");
    if cross_database.diagnostic.code != "SNAPBACK_EFFECT_AUTHORITY_INVALID" {
        return Err(format!(
            "cross-database owner failed with {}, expected SNAPBACK_EFFECT_AUTHORITY_INVALID",
            cross_database.diagnostic.code
        ));
    }

    #[cfg(unix)]
    {
        let fork_id = database_a.effect_id.clone();
        // SAFETY: the child calls one bridge whose first operation is the
        // process-id check, then exits without unwinding inherited state.
        let child = unsafe { libc::fork() };
        if child < 0 {
            return Err("fork failed".to_owned());
        }
        if child == 0 {
            let refused = database_a
                .serving
                .deny_pending_effect_admitted(&inherited_owner, &fork_id, NOW + 202)
                .is_err_and(|error| {
                    error.diagnostic.code == "SNAPBACK_EFFECT_AUTHORITY_INVALID"
                });
            unsafe { libc::_exit(if refused { 0 } else { 1 }) };
        }
        let mut status = 0;
        if unsafe { libc::waitpid(child, &mut status, 0) } != child
            || !libc::WIFEXITED(status)
            || libc::WEXITSTATUS(status) != 0
        {
            return Err(format!(
                "fork-inherited owner was not rejected, wait status={status}"
            ));
        }
    }

    println!(
        "pending-effect owner composition: legitimate approval/denial/refusal/settlement passed; cross-database and fork substitution refused"
    );
    Ok(())
}
