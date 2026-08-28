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

fn require_authority_refusal<T>(
    result: snapback_kernel::diagnostic::SnapbackResult<T>,
    composition: &str,
) -> Result<(), String> {
    let error = result.map(|_| ()).expect_err(composition);
    if error.diagnostic.code == "SNAPBACK_EFFECT_AUTHORITY_INVALID" {
        Ok(())
    } else {
        Err(format!(
            "{composition} failed with {}, expected SNAPBACK_EFFECT_AUTHORITY_INVALID",
            error.diagnostic.code
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
        .approve_pending_effect_admitted(decision_owner, prepared, None, NOW + 202)
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

    // Alternate producer route for F314 and F316: obtain a genuine owner from
    // database A and drive it through database B's surviving consumers. This
    // does not reuse either witness's missing-owner/caller-string spelling.
    let mut owner_database = setup_pending_effect_consumer_attack().await?;
    let foreign_owner = owner_database.resolve_owner(NOW + 201)?;
    let mut refusal_database = setup_pending_effect_consumer_attack().await?;
    let refusal_database_id = refusal_database.effect_id.clone();
    require_authority_refusal(
        refusal_database.serving.refuse_pending_effect_admitted(
            &foreign_owner,
            &refusal_database_id,
            "FOREIGN_OWNER_REFUSAL",
            NOW + 201,
        ),
        "cross-database refusal accepted database A's owner",
    )?;
    require_status(
        refusal_database
            .serving
            .pending_effect(&refusal_database_id, NOW + 201)
            .map_err(|error| format!("read cross-database refusal target: {error:?}"))?
            .status,
        PendingEffectStatus::Pending,
        "cross-database refusal target",
    )?;

    let mut denial_database = setup_pending_effect_consumer_attack().await?;
    let denial_database_id = denial_database.effect_id.clone();
    require_authority_refusal(
        denial_database.serving.deny_pending_effect_admitted(
            &foreign_owner,
            &denial_database_id,
            NOW + 201,
        ),
        "cross-database denial accepted database A's owner",
    )?;
    require_status(
        denial_database
            .serving
            .pending_effect(&denial_database_id, NOW + 201)
            .map_err(|error| format!("read cross-database denial target: {error:?}"))?
            .status,
        PendingEffectStatus::Pending,
        "cross-database denial target",
    )?;

    // Alternate producer plus Clone route for F315: the approval row is
    // genuinely prepared in B and cloned, but an owner produced by A still
    // cannot authorize either copy. The untouched copy remains usable with a
    // fresh B-derived owner, proving setup did not manufacture the refusal.
    let mut approval_owner_database = setup_pending_effect_consumer_attack().await?;
    let foreign_approval_owner = approval_owner_database.resolve_owner(NOW + 201)?;
    let mut approval_database = setup_pending_effect_consumer_attack().await?;
    let approval_database_id = approval_database.effect_id.clone();
    let approval_database_owner = approval_database.resolve_owner(NOW + 201)?;
    let prepared = approval_database
        .serving
        .prepare_pending_effect_approval(&approval_database_owner, &approval_database_id, NOW + 201)
        .map_err(|error| format!("cross-database approval preparation: {error:?}"))?;
    require_authority_refusal(
        approval_database.serving.approve_pending_effect_admitted(
            foreign_approval_owner,
            prepared.clone(),
            None,
            NOW + 202,
        ),
        "cross-database approval accepted database A's owner",
    )?;
    let approved = approval_database
        .serving
        .approve_pending_effect_admitted(approval_database_owner, prepared, None, NOW + 202)
        .map_err(|error| format!("approval after foreign-owner refusal: {error:?}"))?;
    require_status(
        approved.record.status,
        PendingEffectStatus::Approved,
        "approval after foreign-owner refusal",
    )?;

    // Alternate producer route for F317: a complete settlement produced from
    // A's genuine ticket cannot be consumed by B, and A's durable row remains
    // Approved after the refused composition.
    let mut settlement_database_a = setup_pending_effect_consumer_attack().await?;
    let settlement_a_id = settlement_database_a.effect_id.clone();
    let settlement_a_prepare_owner = settlement_database_a.resolve_owner(NOW + 201)?;
    let settlement_a_prepared = settlement_database_a
        .serving
        .prepare_pending_effect_approval(&settlement_a_prepare_owner, &settlement_a_id, NOW + 201)
        .map_err(|error| format!("cross-database settlement preparation: {error:?}"))?;
    let settlement_a_decision_owner = settlement_database_a.resolve_owner(NOW + 202)?;
    let (_, settlement_a_ticket) = settlement_database_a
        .serving
        .approve_pending_effect_admitted(
            settlement_a_decision_owner,
            settlement_a_prepared,
            None,
            NOW + 202,
        )
        .map_err(|error| format!("cross-database settlement approval: {error:?}"))?
        .into_parts();
    let mut settlement_database_b = setup_pending_effect_consumer_attack().await?;
    require_authority_refusal(
        settlement_database_b
            .serving
            .settle_pending_effect_admitted(
                settlement_a_ticket.executed(Some("FOREIGN_SETTLEMENT"), NOW + 203),
            ),
        "cross-database settlement accepted database A's ticket",
    )?;
    require_status(
        settlement_database_a
            .serving
            .pending_effect(&settlement_a_id, NOW + 203)
            .map_err(|error| format!("read cross-database settlement source: {error:?}"))?
            .status,
        PendingEffectStatus::Approved,
        "cross-database settlement source",
    )?;

    #[cfg(unix)]
    {
        // Rebuild the strongest inherited variants independently: borrowed
        // owner consumers (F314/F316), cloned approval plus consumed owner
        // (F315), and a complete consumed settlement (F317).
        let mut fork_owner_fixture = setup_pending_effect_consumer_attack().await?;
        let fork_owner_id = fork_owner_fixture.effect_id.clone();
        let fork_owner = fork_owner_fixture.resolve_owner(NOW + 201)?;

        let mut fork_approval_fixture = setup_pending_effect_consumer_attack().await?;
        let fork_approval_id = fork_approval_fixture.effect_id.clone();
        let fork_prepare_owner = fork_approval_fixture.resolve_owner(NOW + 201)?;
        let fork_prepared = fork_approval_fixture
            .serving
            .prepare_pending_effect_approval(&fork_prepare_owner, &fork_approval_id, NOW + 201)
            .map_err(|error| format!("fork approval preparation: {error:?}"))?;
        let fork_decision_owner = fork_approval_fixture.resolve_owner(NOW + 202)?;

        let mut fork_settlement_fixture = setup_pending_effect_consumer_attack().await?;
        let fork_settlement_id = fork_settlement_fixture.effect_id.clone();
        let fork_settlement_prepare_owner = fork_settlement_fixture.resolve_owner(NOW + 201)?;
        let fork_settlement_prepared = fork_settlement_fixture
            .serving
            .prepare_pending_effect_approval(
                &fork_settlement_prepare_owner,
                &fork_settlement_id,
                NOW + 201,
            )
            .map_err(|error| format!("fork settlement preparation: {error:?}"))?;
        let fork_settlement_decision_owner = fork_settlement_fixture.resolve_owner(NOW + 202)?;
        let (_, fork_ticket) = fork_settlement_fixture
            .serving
            .approve_pending_effect_admitted(
                fork_settlement_decision_owner,
                fork_settlement_prepared,
                None,
                NOW + 202,
            )
            .map_err(|error| format!("fork settlement approval: {error:?}"))?
            .into_parts();

        // SAFETY: every child call first checks creator-process provenance;
        // the child then exits without unwinding inherited SQLite state.
        let child = unsafe { libc::fork() };
        if child < 0 {
            return Err("fork failed".to_owned());
        }
        if child == 0 {
            let refusal_refused = fork_owner_fixture
                .serving
                .refuse_pending_effect_admitted(
                    &fork_owner,
                    &fork_owner_id,
                    "FORK_REFUSAL",
                    NOW + 202,
                )
                .is_err_and(|error| error.diagnostic.code == "SNAPBACK_EFFECT_AUTHORITY_INVALID");
            let denial_refused = fork_owner_fixture
                .serving
                .deny_pending_effect_admitted(&fork_owner, &fork_owner_id, NOW + 202)
                .is_err_and(|error| error.diagnostic.code == "SNAPBACK_EFFECT_AUTHORITY_INVALID");
            let approval_refused = fork_approval_fixture
                .serving
                .approve_pending_effect_admitted(
                    fork_decision_owner,
                    fork_prepared,
                    None,
                    NOW + 202,
                )
                .is_err_and(|error| error.diagnostic.code == "SNAPBACK_EFFECT_AUTHORITY_INVALID");
            let settlement_refused = fork_settlement_fixture
                .serving
                .settle_pending_effect_admitted(
                    fork_ticket.executed(Some("FORK_SETTLEMENT"), NOW + 203),
                )
                .is_err_and(|error| error.diagnostic.code == "SNAPBACK_EFFECT_AUTHORITY_INVALID");
            unsafe {
                libc::_exit(
                    if refusal_refused && denial_refused && approval_refused && settlement_refused {
                        0
                    } else {
                        1
                    },
                )
            };
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
        "pending-effect owner composition: legitimate approval/denial/refusal/settlement passed; cross-database foreign-owner, cloned-approval, foreign-ticket, and fork substitution refused for F314-F317"
    );
    Ok(())
}
