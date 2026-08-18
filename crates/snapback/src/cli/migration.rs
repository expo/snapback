use super::*;

// ---------------------------------------------------------------------------
// migrate.* — LLP 0081 host operations (local profile)
// ---------------------------------------------------------------------------

fn migrate_envelope(
    operation: &str,
    ok: bool,
    data: Value,
    diagnostics: Vec<crate::diagnostic::Diagnostic>,
) -> HostOpsResult {
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation),
        operation: operation.to_owned(),
        ok,
        target: crate::host_ops::HostOpsTarget {
            app_id: "local".to_owned(),
            app_root: None,
            target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            server_url: None,
        },
        authority: None,
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next: crate::control_catalog::result_next(ok, operation),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

struct MigrateOutput {
    data: Value,
    human: String,
}

impl MigrateOutput {
    fn new(data: Value, human: String) -> Self {
        Self { data, human }
    }
}

fn migrate_emit(
    operation: &str,
    json_only: bool,
    outcome: anyhow::Result<MigrateOutput>,
) -> anyhow::Result<()> {
    let envelope = match outcome {
        Ok(output) => {
            if !json_only && !output.human.is_empty() {
                eprint!("{}", output.human);
                if !output.human.ends_with('\n') {
                    eprintln!();
                }
            }
            migrate_envelope(operation, true, output.data, Vec::new())
        }
        Err(error) => {
            let diagnostic = match error.downcast::<crate::diagnostic::SnapbackError>() {
                Ok(snapback) => snapback.diagnostic,
                Err(other) => {
                    crate::diagnostic::SnapbackError::error(
                        "SNAPBACK_MIGRATION_PLAN_INVALID",
                        "storage",
                        other.to_string(),
                    )
                    .diagnostic
                }
            };
            if !json_only {
                eprintln!(
                    "Migration command failed\n  {}: {}",
                    diagnostic.code, diagnostic.message
                );
            }
            migrate_envelope(operation, false, Value::Null, vec![diagnostic])
        }
    };
    println!("{}", serde_json::to_string_pretty(&envelope)?);
    if envelope.ok {
        Ok(())
    } else {
        let exit_code = envelope
            .diagnostics
            .first()
            .map_or(EXIT_FUNCTION_ERROR, |diagnostic| {
                classify_native_exit(&diagnostic.code)
            });
        std::process::exit(exit_code);
    }
}

fn migrate_read_json<T: serde::de::DeserializeOwned>(
    path: &PathBuf,
    what: &str,
) -> anyhow::Result<T> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| anyhow::anyhow!("read {what} {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| anyhow::anyhow!("parse {what}: {error}"))
}

/// The preview/approve interchange file: the sealed plan artifact plus its
/// separately digested observation. Only the plan bytes are required to be
/// byte-identical across repeated previews.
#[derive(serde::Deserialize, serde::Serialize)]
struct MigratePreviewFile {
    artifact: crate::migration::MigrationPlanArtifactV1,
    observation: crate::migration::MigrationPreviewObservationV1,
    #[serde(rename = "generatedBy")]
    generated_by: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct MigrateApprovedFile {
    artifact: crate::migration::MigrationPlanArtifactV1,
    observation: crate::migration::MigrationPreviewObservationV1,
    approval: crate::migration::MigrationApprovalV1,
}

pub(crate) fn wall_clock_now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn local_operator() -> String {
    std::env::var("USER").unwrap_or_else(|_| "local-operator".to_owned())
}

fn migrate_presentation_width() -> usize {
    crate::migration_presentation::presentation_width_from_columns(
        std::env::var("COLUMNS").ok().as_deref(),
    )
}

fn migrate_review_options(
    json_only: bool,
) -> crate::migration_presentation::MigrationPresentationOptions {
    let width = migrate_presentation_width();
    if !json_only && io::stderr().is_terminal() {
        crate::migration_presentation::MigrationPresentationOptions::review(width)
    } else {
        crate::migration_presentation::MigrationPresentationOptions::narration(width)
    }
}

fn approval_authorization_error(message: impl Into<String>) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
        "migration",
        message.into(),
    )
}

pub(crate) fn validate_approval_authorization(
    expected: &str,
    acknowledgement: Option<&str>,
    interactive_response: Option<&str>,
) -> crate::diagnostic::SnapbackResult<()> {
    if let Some(acknowledgement) = acknowledgement {
        return if acknowledgement == expected {
            Ok(())
        } else {
            Err(approval_authorization_error(
                "--acknowledge-digests did not exactly match the displayed plan and observation digests",
            ))
        };
    }
    match interactive_response.map(str::trim) {
        Some("approve") => Ok(()),
        Some(_) => Err(approval_authorization_error(
            "approval was not confirmed; the approval artifact was not written",
        )),
        None => Err(approval_authorization_error(format!(
            "non-interactive approval requires --acknowledge-digests {expected}"
        ))),
    }
}

pub(crate) fn migrate_command(command: MigrateCommand, json_only: bool) -> anyhow::Result<()> {
    match command {
        MigrateCommand::Preview {
            db,
            intents,
            schema,
            publication_timestamp_ms,
            rollback_timestamp_ms,
            constants,
            max_affected_rows,
            max_barrier_downtime_ms,
            out,
        } => migrate_emit(
            "migrate.preview",
            json_only,
            (|| {
                let successor: crate::manifest::SchemaManifest =
                    migrate_read_json(&schema, "successor schema")?;
                let constant_values: std::collections::BTreeMap<String, Value> = match &constants {
                    Some(path) => migrate_read_json(path, "constants")?,
                    None => Default::default(),
                };
                let snapback = crate::local::LocalSnapback::open(&db)?;
                let predecessor = snapback.migrate_predecessor_schema();
                // Explicit intents win; a schema-diff derivation covers exactly
                // the unambiguous changes (LLP 0081 §2 — the derivation refuses
                // anything needing a declared backfill/rename/conversion).
                let intents: Vec<crate::migration::MigrationIntent> = match &intents {
                    Some(path) => migrate_read_json(path, "intents")?,
                    None => crate::migration::derive_intents(&predecessor, &successor)?,
                };
                let steps =
                    crate::migration::derive_plan_steps(&predecessor, &successor, &intents)?;
                let execution_strategy = crate::migration::execution_strategy_for_steps(&steps);
                // @ref LLP 0160#2-the-ideal-experience-moment-by-moment —
                // Moment 3's estimate line is sourced only from the separately
                // digested, snapshot-pinned observation; it adds no plan
                // authority and is omitted when no step declares a read table.
                let (head, precondition_rows) =
                    snapback.migrate_preview_observation_facts(&steps, max_affected_rows)?;
                let body = crate::migration::MigrationPlanBody {
                    schema_version: crate::migration::MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
                    app: snapback.migrate_app_id(),
                    instance: db.display().to_string(),
                    target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                        .to_owned(),
                    predecessor_schema_hash: crate::storage::migration_executor::schema_identity(
                        &predecessor,
                    )?,
                    successor_schema_hash: crate::storage::migration_executor::schema_identity(
                        &successor,
                    )?,
                    predecessor_generation: head,
                    steps,
                    execution_strategy,
                    proof: crate::migration::MigrationProof {
                        method: crate::migration::MigrationProofMethod::Full,
                        bound: None,
                    },
                    ceilings: crate::migration::MigrationCeilings {
                        max_affected_rows,
                        max_bytes: 64 * 1024 * 1024,
                        max_writes: max_affected_rows,
                        max_barrier_downtime_ms,
                    },
                    compatibility_posture: crate::migration::CompatibilityPosture::SuccessorOnly,
                    retained_work_posture: crate::migration::RetainedWorkPosture::Empty,
                    backup: crate::migration::MigrationBackupRequirement {
                        required: false,
                        checkpoint_label: None,
                        rehearsal_required: false,
                    },
                    expected_output: crate::migration::MigrationExpectedOutput {
                        schema_hash: crate::storage::migration_executor::schema_identity(
                            &successor,
                        )?,
                        projection_generations: Default::default(),
                    },
                    constants: crate::migration::MigrationConstants {
                        publication_timestamp_ms,
                        rollback_timestamp_ms,
                        values: constant_values,
                    },
                    boundaries: Default::default(),
                };
                let artifact = crate::migration::MigrationPlanArtifactV1::seal(body)?;
                crate::migration::validate_plan_artifact(&artifact, &predecessor, &successor)?;
                let observation = crate::migration::MigrationPreviewObservationV1 {
                    schema_version: crate::migration::MIGRATION_OBSERVATION_SCHEMA_VERSION
                        .to_owned(),
                    plan_digest: artifact.plan_digest.clone(),
                    target_head_version: head,
                    observed_at_ms: wall_clock_now_ms(),
                    precondition_rows,
                    capability_health: Default::default(),
                };
                let file = MigratePreviewFile {
                    artifact,
                    observation,
                    generated_by: local_operator(),
                };
                std::fs::write(&out, serde_json::to_string_pretty(&file)?)?;
                let human = crate::migration_presentation::render_plan(
                    &file.artifact,
                    &file.observation,
                    migrate_review_options(json_only),
                );
                Ok(MigrateOutput::new(
                    json!({
                        "planId": file.artifact.plan_id,
                        "planDigest": file.artifact.plan_digest,
                        "steps": file.artifact.body.steps.len(),
                        "out": out.display().to_string(),
                    }),
                    human,
                ))
            })(),
        ),
        MigrateCommand::Approve {
            plan,
            approver,
            expires_in_ms,
            db,
            out,
            acknowledge_digests,
        } => migrate_emit(
            "migrate.approve",
            json_only,
            (|| {
                let preview: MigratePreviewFile = migrate_read_json(&plan, "preview file")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                let audience = snapback.migrate_resolved_audience()?;
                let approver = approver.unwrap_or_else(local_operator);
                let now = wall_clock_now_ms();
                let approval = crate::migration::MigrationApprovalV1 {
                    schema_version: crate::migration::MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
                    plan_digest: preview.artifact.plan_digest.clone(),
                    observation_digest: crate::migration::observation_digest(&preview.observation)?,
                    policy_digest: "local-operator-policy-v1".to_owned(),
                    audience: crate::migration::MigrationAudienceV1 {
                        project_id: None,
                        target_id: None,
                        environment_id: None,
                        deployment_id: None,
                        release_id: None,
                        database_id: audience.database_id,
                        stream_incarnation: audience.stream_incarnation,
                        activation_generation: audience.activation_generation,
                        target_profile_id: audience.target_profile_id,
                    },
                    approver: approver.clone(),
                    generator_is_approver: approver == preview.generated_by,
                    issued_at_ms: now,
                    expires_at_ms: now + expires_in_ms,
                    operation_id: crate::migration::new_operation_id(),
                };
                crate::migration::validate_approval_shape(&approval)?;
                let rendered = crate::migration_presentation::render_approval(
                    &preview.artifact,
                    &preview.observation,
                    &approval,
                    migrate_review_options(json_only),
                );
                // Render before the authorization gate and before the output
                // path is touched. A CI/piped face is redacted and therefore
                // requires the exact two-digest acknowledgement.
                // @ref LLP 0160#2-the-ideal-experience-moment-by-moment —
                // Moment 4's render-before-mint/write ordering.
                if !json_only {
                    eprint!("{rendered}");
                    if !rendered.ends_with('\n') {
                        eprintln!();
                    }
                }
                let expected = crate::migration_presentation::approval_acknowledgement_token(
                    &preview.artifact,
                    &preview.observation,
                );
                if acknowledge_digests.is_some() {
                    validate_approval_authorization(
                        &expected,
                        acknowledge_digests.as_deref(),
                        None,
                    )?;
                } else if !json_only && io::stdin().is_terminal() && io::stderr().is_terminal() {
                    eprint!("Type `approve` to authorize these exact digests: ");
                    std::io::Write::flush(&mut io::stderr())?;
                    let mut response = String::new();
                    io::stdin().read_line(&mut response)?;
                    validate_approval_authorization(&expected, None, Some(&response))?;
                } else {
                    validate_approval_authorization(&expected, None, None)?;
                }
                let approved = MigrateApprovedFile {
                    artifact: preview.artifact,
                    observation: preview.observation,
                    approval,
                };
                std::fs::write(&out, serde_json::to_string_pretty(&approved)?)?;
                Ok(MigrateOutput::new(
                    json!({
                        "operationId": approved.approval.operation_id,
                        "planId": approved.artifact.plan_id,
                        "generatorIsApprover": approved.approval.generator_is_approver,
                        "out": out.display().to_string(),
                    }),
                    String::new(),
                ))
            })(),
        ),
        MigrateCommand::Apply {
            approved,
            schema,
            db,
            dry_run,
            rehearsal_receipt,
        } => migrate_emit(
            "migrate.apply",
            json_only,
            (|| {
                let approved: MigrateApprovedFile = migrate_read_json(&approved, "approved file")?;
                let successor: crate::manifest::SchemaManifest =
                    migrate_read_json(&schema, "successor schema")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                if dry_run {
                    let predecessor = snapback.migrate_predecessor_schema();
                    crate::migration::validate_plan_artifact(
                        &approved.artifact,
                        &predecessor,
                        &successor,
                    )?;
                    crate::migration::validate_approval_shape(&approved.approval)?;
                    let mut human = crate::migration_presentation::render_plan(
                        &approved.artifact,
                        &approved.observation,
                        crate::migration_presentation::MigrationPresentationOptions::narration(
                            migrate_presentation_width(),
                        ),
                    );
                    human.push_str("\nDry run\n  Non-authoritative pre-admission estimate; real admission re-proves under the closed fence.\n");
                    return Ok(MigrateOutput::new(
                        json!({
                            "dryRun": true,
                            "operationId": approved.approval.operation_id,
                            "planId": approved.artifact.plan_id,
                            "wouldApply": true,
                        }),
                        human,
                    ));
                }
                let rehearsal: Option<crate::storage::migration_executor::MigrationReceiptV1> =
                    match &rehearsal_receipt {
                        Some(path) => Some(migrate_read_json(path, "rehearsal receipt")?),
                        None => None,
                    };
                let receipt = snapback.migrate_apply_artifact_with_rehearsal_receipt(
                    &approved.artifact,
                    &approved.approval,
                    &successor,
                    rehearsal.as_ref(),
                )?;
                let human = crate::migration_presentation::render_receipt(
                    &receipt,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(serde_json::to_value(&receipt)?, human))
            })(),
        ),
        MigrateCommand::Rehearse {
            approved,
            schema,
            rehearsal_plan,
            db,
            out,
        } => migrate_emit(
            "migrate.rehearse",
            json_only,
            (|| {
                let approved: MigrateApprovedFile = migrate_read_json(&approved, "approved file")?;
                let successor: crate::manifest::SchemaManifest =
                    migrate_read_json(&schema, "successor schema")?;
                let rehearsal: crate::migration::MigrationRehearsalPlanV1 =
                    migrate_read_json(&rehearsal_plan, "rehearsal plan")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                // Thin wrapper: identical semantics to the library path — the
                // binding check, marking, and freshness anchor all live in the
                // executor, not here.
                let receipt = snapback.migrate_rehearse_artifact(
                    &approved.artifact,
                    &approved.approval,
                    &successor,
                    &rehearsal,
                )?;
                std::fs::write(&out, serde_json::to_string_pretty(&receipt)?)?;
                let human = crate::migration_presentation::render_receipt(
                    &receipt,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(
                    json!({
                        "operationId": approved.approval.operation_id,
                        "planId": approved.artifact.plan_id,
                        "rehearsal": true,
                        "state": receipt.state.kind(),
                        "out": out.display().to_string(),
                    }),
                    human,
                ))
            })(),
        ),
        MigrateCommand::Cancel { approved, db } => migrate_emit(
            "migrate.cancel",
            json_only,
            (|| {
                let approved: MigrateApprovedFile = migrate_read_json(&approved, "approved file")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                snapback.migrate_request_cancel(&approved.approval.operation_id)?;
                let mut human = crate::migration_presentation::render_plan(
                    &approved.artifact,
                    &approved.observation,
                    crate::migration_presentation::MigrationPresentationOptions::narration(
                        migrate_presentation_width(),
                    ),
                );
                human.push('\n');
                human.push_str(&crate::migration_presentation::render_action(
                    "cancellation",
                    &approved.approval.operation_id,
                    "cancel_requested",
                    migrate_presentation_width(),
                ));
                Ok(MigrateOutput::new(
                    json!({
                        "operationId": approved.approval.operation_id,
                        "cancelRequested": true,
                    }),
                    human,
                ))
            })(),
        ),
        MigrateCommand::Verify { operation_id, db } => migrate_emit(
            "migrate.verify",
            json_only,
            (|| {
                let snapback = crate::local::LocalSnapback::open(&db)?;
                let verification = snapback.migrate_verify_receipt(&operation_id)?;
                let human = crate::migration_presentation::render_verification(
                    &verification,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(verification, human))
            })(),
        ),
        MigrateCommand::Rollback { receipt, db } => migrate_emit(
            "migrate.rollback",
            json_only,
            (|| {
                // The fast rollback runs under the original operation's
                // approval, which acknowledged the rollback boundary by
                // declaring the explicit rollback timestamp — so the input is
                // the approved migration file (the same authority `apply`
                // consumed), not a regenerated plan.
                let approved: MigrateApprovedFile = migrate_read_json(&receipt, "approved file")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                let rollback =
                    snapback.migrate_rollback_artifact(&approved.artifact, &approved.approval)?;
                let human = crate::migration_presentation::render_rollback_receipt(
                    &rollback,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(serde_json::to_value(&rollback)?, human))
            })(),
        ),
    }
}
