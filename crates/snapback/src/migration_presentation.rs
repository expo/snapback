//! Deterministic human presentation for LLP 0081 migration artifacts.
//!
//! This module is deliberately read-only over its inputs. It renders facts
//! from the sealed plan, the separately digested preview observation, the
//! approval record, or a shipped receipt; it never derives migration
//! authority or changes executor semantics.
//!
//! @ref LLP 0160#2-the-ideal-experience-moment-by-moment — Moments 3, 4, and
//!   7 require default-on human rendering with face-specific redaction and a
//!   render-first approval gate.
//! @ref LLP 0160#3-design-principles — post-preview presentation renders only
//!   admitted sources, labels observation estimates as non-authoritative, and
//!   omits unavailable facts rather than inventing defaults.

use serde_json::Value;

use crate::migration::{
    CompatibilityPosture, MigrationApprovalV1, MigrationExecutionStrategy, MigrationPlanArtifactV1,
    MigrationPreviewObservationV1, MigrationProofMethod, MigrationStep, RetainedWorkPosture,
};
use crate::storage::migration_executor::{MigrationReceiptV1, MigrationRollbackReceiptV1};

pub const STANDARD_PRESENTATION_WIDTH: usize = 88;
pub const NARROW_PRESENTATION_WIDTH: usize = 48;
/// Stable identifier for the human-only presentation grammar pinned by the
/// committed golden fixtures. A breaking presentation change mints a new
/// identifier and fixture set; it never changes an LLP 0081 artifact schema.
pub const MIGRATION_PRESENTATION_CONTRACT_VERSION: &str = "migration-presentation-v1";
const MIN_PRESENTATION_WIDTH: usize = 40;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MigrationPresentationFace {
    /// Secure interactive preview/approval: plan constants are inspectable.
    Review,
    /// Apply/verify/CI narration: literal and row-derived values are redacted.
    Narration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MigrationPresentationOptions {
    pub face: MigrationPresentationFace,
    pub width: usize,
}

impl MigrationPresentationOptions {
    pub fn review(width: usize) -> Self {
        Self {
            face: MigrationPresentationFace::Review,
            width,
        }
    }

    pub fn narration(width: usize) -> Self {
        Self {
            face: MigrationPresentationFace::Narration,
            width,
        }
    }

    fn effective_width(self) -> usize {
        self.width.max(MIN_PRESENTATION_WIDTH)
    }
}

/// The CLI may honor a conventional terminal width, but never renders wider
/// than the committed standard face. Invalid values have no effect.
pub fn presentation_width_from_columns(columns: Option<&str>) -> usize {
    columns
        .and_then(|value| value.parse::<usize>().ok())
        .map(|width| width.clamp(MIN_PRESENTATION_WIDTH, STANDARD_PRESENTATION_WIDTH))
        .unwrap_or(STANDARD_PRESENTATION_WIDTH)
}

fn abbreviated(identity: &str) -> String {
    const PREFIX: usize = 20;
    if identity.chars().count() <= PREFIX {
        identity.to_owned()
    } else {
        format!("{}…", identity.chars().take(PREFIX).collect::<String>())
    }
}

fn push_wrapped(output: &mut String, indent: usize, text: &str, width: usize) {
    let prefix = " ".repeat(indent);
    let available = width.saturating_sub(indent).max(1);
    let mut line = String::new();
    for word in text.split_whitespace() {
        if line.is_empty() {
            line.push_str(word);
        } else if line.len() + 1 + word.len() <= available {
            line.push(' ');
            line.push_str(word);
        } else {
            output.push_str(&prefix);
            output.push_str(&line);
            output.push('\n');
            line.clear();
            line.push_str(word);
        }
    }
    if !line.is_empty() {
        output.push_str(&prefix);
        output.push_str(&line);
        output.push('\n');
    }
}

fn push_field(output: &mut String, label: &str, value: &str, width: usize) {
    push_wrapped(output, 2, &format!("{label}: {value}"), width);
}

fn json_literal(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[unavailable]".to_owned())
}

fn rendered_expression(
    expression: &crate::manifest::ValueExpr,
    artifact: &MigrationPlanArtifactV1,
    face: MigrationPresentationFace,
) -> String {
    if face == MigrationPresentationFace::Narration {
        return "[redacted]".to_owned();
    }
    match expression {
        crate::manifest::ValueExpr::Literal(value) => json_literal(value),
        crate::manifest::ValueExpr::Arg(name) => artifact
            .body
            .constants
            .values
            .get(name)
            .map(|value| format!("constant {name:?} = {}", json_literal(value)))
            .unwrap_or_else(|| format!("constant {name:?} (value unavailable)")),
        other => serde_json::to_string(other).unwrap_or_else(|_| "[unavailable]".to_owned()),
    }
}

fn strategy(value: MigrationExecutionStrategy) -> &'static str {
    match value {
        MigrationExecutionStrategy::SingleTransaction => "exclusive single-writer",
        MigrationExecutionStrategy::ShadowGeneration => "shadow generation",
    }
}

fn compatibility(value: CompatibilityPosture) -> &'static str {
    match value {
        CompatibilityPosture::SuccessorOnly => "successor-only",
        CompatibilityPosture::DualCompatible => "dual-compatible",
        CompatibilityPosture::PredeployCompatible => "predeploy-compatible",
    }
}

fn retained_work(value: RetainedWorkPosture) -> &'static str {
    match value {
        RetainedWorkPosture::Empty => "empty",
        RetainedWorkPosture::DualCompatible => "dual-compatible",
        RetainedWorkPosture::Transformed => "transformed",
    }
}

fn proof(value: MigrationProofMethod) -> &'static str {
    match value {
        MigrationProofMethod::Full => "full ContentDigestV1",
        MigrationProofMethod::SampledAudit => "sampled-audit (not production proof)",
    }
}

fn step_detail(
    artifact: &MigrationPlanArtifactV1,
    step: &MigrationStep,
    face: MigrationPresentationFace,
) -> Option<String> {
    match step {
        MigrationStep::AddField {
            field_type,
            optional,
            backfill,
            ..
        } => {
            let mut detail = format!(
                "type {field_type:?}; {} install",
                if *optional { "nullable" } else { "required" }
            );
            if let Some(expression) = backfill {
                detail.push_str(&format!(
                    "; value {}",
                    rendered_expression(expression, artifact, face)
                ));
            }
            Some(detail)
        }
        MigrationStep::BackfillField { expr, .. } => Some(format!(
            "value {}",
            rendered_expression(expr, artifact, face)
        )),
        MigrationStep::CreateIndex { fields, .. }
        | MigrationStep::CreateUniqueIndex { fields, .. }
        | MigrationStep::ValidateUnique { fields, .. } => {
            Some(format!("fields {}", fields.join(", ")))
        }
        MigrationStep::CopyField {
            source_table,
            source_field,
            expr,
            ..
        } => Some(match expr {
            Some(expression) => format!(
                "from {source_table}.{source_field}; value {}",
                rendered_expression(expression, artifact, face)
            ),
            None => format!("from {source_table}.{source_field}"),
        }),
        MigrationStep::CopyTable {
            source_table,
            generation,
            fields,
            ..
        } => Some(format!(
            "from {source_table}; generation {generation}; {} mapped fields{}",
            fields.len(),
            if face == MigrationPresentationFace::Narration {
                " (values redacted)"
            } else {
                ""
            }
        )),
        MigrationStep::StageTableGeneration { generation, .. }
        | MigrationStep::RetireGeneration { generation, .. } => {
            Some(format!("generation {generation}"))
        }
        _ => None,
    }
}

/// Render the plan and its separately digested preview observation. Every
/// estimate line is explicitly labeled as review context without plan
/// authority; an absent observation row is omitted.
pub fn render_plan(
    artifact: &MigrationPlanArtifactV1,
    observation: &MigrationPreviewObservationV1,
    options: MigrationPresentationOptions,
) -> String {
    let width = options.effective_width();
    let mut output = String::new();
    output.push_str(&format!(
        "Migration plan {} ({} steps, {})\n",
        abbreviated(&artifact.plan_id),
        artifact.body.steps.len(),
        strategy(artifact.body.execution_strategy)
    ));
    output.push_str(&format!(
        "Presentation contract: {MIGRATION_PRESENTATION_CONTRACT_VERSION}\n"
    ));
    output.push_str(match options.face {
        MigrationPresentationFace::Review => "Review face — constants revealed\n",
        MigrationPresentationFace::Narration => "Narration face — constants redacted\n",
    });

    output.push_str("\nIdentity\n");
    push_field(&mut output, "plan id (/planId)", &artifact.plan_id, width);
    push_field(
        &mut output,
        "plan digest (/planDigest)",
        &artifact.plan_digest,
        width,
    );
    push_field(
        &mut output,
        "observation digest (separate review context)",
        &crate::migration::observation_digest(observation)
            .unwrap_or_else(|_| "[unavailable]".to_owned()),
        width,
    );
    push_field(
        &mut output,
        "target profile (/body/targetProfileId)",
        &artifact.body.target_profile_id,
        width,
    );

    output.push_str("\nSteps (/body/steps, canonical order)\n");
    for (index, record) in artifact.body.steps.iter().enumerate() {
        push_wrapped(
            &mut output,
            2,
            &format!(
                "{}. {:<27} {}",
                index + 1,
                record.step.step_type(),
                record.step.qualified_target()
            ),
            width,
        );
        if let Some(detail) = step_detail(artifact, &record.step, options.face) {
            push_wrapped(&mut output, 5, &detail, width);
        }
        if let Some(rows) = observation.precondition_rows.get(&record.id) {
            push_wrapped(&mut output, 5, &format!("preflight: ~{rows} rows"), width);
            push_wrapped(
                &mut output,
                5,
                "estimate — review context, not plan authority",
                width,
            );
        }
    }

    output.push_str("\nCeilings (/body/ceilings; approved facts)\n");
    push_field(
        &mut output,
        "affected rows",
        &format!("≤{}", artifact.body.ceilings.max_affected_rows),
        width,
    );
    push_field(
        &mut output,
        "writes",
        &format!("≤{}", artifact.body.ceilings.max_writes),
        width,
    );
    push_field(
        &mut output,
        "bytes",
        &format!("≤{}", artifact.body.ceilings.max_bytes),
        width,
    );
    push_field(
        &mut output,
        "barrier downtime",
        &format!("≤{} ms", artifact.body.ceilings.max_barrier_downtime_ms),
        width,
    );

    output.push_str("\nBarrier (LLP 0081 §4 fixed rule)\n");
    push_wrapped(
        &mut output,
        2,
        "The target capability registry must close every admitted query, mutation, subscription, job, worker, action, cron, and external-effect egress lane. Plan-bound capability validation is unavailable in the current artifact.",
        width,
    );

    output.push_str("\nClients and retained work\n");
    push_field(
        &mut output,
        "compatibility (/body/compatibilityPosture)",
        compatibility(artifact.body.compatibility_posture),
        width,
    );
    push_field(
        &mut output,
        "retained work (/body/retainedWorkPosture)",
        retained_work(artifact.body.retained_work_posture),
        width,
    );
    if artifact.body.compatibility_posture == CompatibilityPosture::SuccessorOnly {
        push_wrapped(
            &mut output,
            2,
            "Old artifacts receive upgrade-required; incompatible offline mutations remain quarantined as redacted tombstones for re-entry.",
            width,
        );
    }

    output.push_str("\nRollback (LLP 0081 §6 fixed rule)\n");
    push_wrapped(
        &mut output,
        2,
        "Fast predecessor republish is available only while journal state is published-held and every traffic, worker, and egress lane remains fenced.",
        width,
    );
    push_wrapped(
        &mut output,
        2,
        "After release: separately approved reverse plan or exact pre-migration restore; availability is not declared by this artifact.",
        width,
    );

    output.push_str("\nProof (/body/proof)\n");
    push_field(
        &mut output,
        "method",
        proof(artifact.body.proof.method),
        width,
    );
    if let Some(bound) = artifact.body.proof.bound {
        push_field(&mut output, "sample bound", &bound.to_string(), width);
    }

    output.push_str("\nPlan constants (/body/constants)\n");
    push_field(
        &mut output,
        "publicationTimestampMs",
        &artifact.body.constants.publication_timestamp_ms.to_string(),
        width,
    );
    if let Some(timestamp) = artifact.body.constants.rollback_timestamp_ms {
        push_field(
            &mut output,
            "rollbackTimestampMs",
            &timestamp.to_string(),
            width,
        );
    }
    for (name, value) in &artifact.body.constants.values {
        let value = match options.face {
            MigrationPresentationFace::Review => json_literal(value),
            MigrationPresentationFace::Narration => "[redacted]".to_owned(),
        };
        push_field(&mut output, name, &value, width);
    }

    output.push_str("\nObservation (review context; no plan authority)\n");
    push_field(
        &mut output,
        "target head (/targetHeadVersion)",
        &observation.target_head_version.to_string(),
        width,
    );
    push_field(
        &mut output,
        "observed at (/observedAtMs)",
        &observation.observed_at_ms.to_string(),
        width,
    );
    output
}

/// One copyable acknowledgement binds both displayed digests for a
/// non-interactive approval caller.
pub fn approval_acknowledgement_token(
    artifact: &MigrationPlanArtifactV1,
    observation: &MigrationPreviewObservationV1,
) -> String {
    format!(
        "{}:{}",
        artifact.plan_digest,
        crate::migration::observation_digest(observation)
            .unwrap_or_else(|_| "[unavailable]".to_owned())
    )
}

pub fn render_approval(
    artifact: &MigrationPlanArtifactV1,
    observation: &MigrationPreviewObservationV1,
    approval: &MigrationApprovalV1,
    options: MigrationPresentationOptions,
) -> String {
    let width = options.effective_width();
    let mut output = render_plan(artifact, observation, options);
    output.push_str("\nApproval binding\n");
    push_field(
        &mut output,
        "plan digest (/approval/planDigest)",
        &approval.plan_digest,
        width,
    );
    push_field(
        &mut output,
        "observation digest (/approval/observationDigest)",
        &approval.observation_digest,
        width,
    );
    push_field(
        &mut output,
        "policy digest (/approval/policyDigest)",
        &approval.policy_digest,
        width,
    );
    for (label, value) in [
        ("projectId", approval.audience.project_id.as_deref()),
        ("targetId", approval.audience.target_id.as_deref()),
        ("environmentId", approval.audience.environment_id.as_deref()),
        ("deploymentId", approval.audience.deployment_id.as_deref()),
        ("releaseId", approval.audience.release_id.as_deref()),
    ] {
        push_field(
            &mut output,
            &format!("audience.{label}"),
            value.unwrap_or("unavailable (not defined by local profile)"),
            width,
        );
    }
    push_field(
        &mut output,
        "audience.databaseId",
        &approval.audience.database_id,
        width,
    );
    push_field(
        &mut output,
        "audience.streamIncarnation",
        &approval.audience.stream_incarnation,
        width,
    );
    push_field(
        &mut output,
        "audience.activationGeneration",
        &approval.audience.activation_generation.to_string(),
        width,
    );
    push_field(
        &mut output,
        "audience.targetProfileId",
        &approval.audience.target_profile_id,
        width,
    );
    push_field(&mut output, "approver", &approval.approver, width);
    push_field(
        &mut output,
        "issuedAtMs",
        &approval.issued_at_ms.to_string(),
        width,
    );
    push_field(
        &mut output,
        "expiresAtMs",
        &approval.expires_at_ms.to_string(),
        width,
    );
    push_field(&mut output, "operationId", &approval.operation_id, width);
    push_field(
        &mut output,
        "backup required (/body/backup/required)",
        &artifact.body.backup.required.to_string(),
        width,
    );
    push_field(
        &mut output,
        "rehearsal required (/body/backup/rehearsalRequired)",
        &artifact.body.backup.rehearsal_required.to_string(),
        width,
    );
    push_wrapped(
        &mut output,
        2,
        &format!(
            "Recoverability preflight status: not yet executed; proven at admission. Local profile maximum age: {} ms.",
            crate::storage::migration_executor::MIGRATION_REHEARSAL_MAX_AGE_MS
        ),
        width,
    );
    if approval.generator_is_approver {
        push_wrapped(
            &mut output,
            2,
            "Generator and approver are the same principal — disclosed exception permitted by this target policy.",
            width,
        );
    } else {
        push_wrapped(
            &mut output,
            2,
            "Generator and approver are distinct principals.",
            width,
        );
    }
    push_field(
        &mut output,
        "non-interactive acknowledgement",
        &approval_acknowledgement_token(artifact, observation),
        width,
    );
    output
}

pub fn render_receipt(receipt: &MigrationReceiptV1, width: usize) -> String {
    let width = width.max(MIN_PRESENTATION_WIDTH);
    let mut output = format!(
        "Migration receipt {} ({})\nPresentation contract: {}\nNarration face — constants and row values redacted\n",
        abbreviated(&receipt.operation_id),
        receipt.state.kind(),
        MIGRATION_PRESENTATION_CONTRACT_VERSION
    );
    output.push_str("\nIdentity\n");
    push_field(&mut output, "operation id", &receipt.operation_id, width);
    push_field(&mut output, "plan id", &receipt.plan_id, width);
    push_field(&mut output, "plan digest", &receipt.plan_digest, width);
    push_field(
        &mut output,
        "approval digest",
        &receipt.approval_digest,
        width,
    );
    push_field(
        &mut output,
        "admission digest",
        &receipt.admission_digest,
        width,
    );
    output.push_str("\nJournal projection\n");
    push_field(&mut output, "state", receipt.state.kind(), width);
    push_field(
        &mut output,
        "entries",
        &receipt.journal_entries.to_string(),
        width,
    );
    push_field(&mut output, "digest", &receipt.journal_digest, width);
    push_field(
        &mut output,
        "input version",
        &receipt.input_version.to_string(),
        width,
    );
    if let Some(version) = receipt.publication_version {
        push_field(
            &mut output,
            "publication version",
            &version.to_string(),
            width,
        );
    }
    push_field(
        &mut output,
        "barrier duration",
        &format!("{} ms", receipt.barrier_duration_ms),
        width,
    );
    output.push_str("\nRecorded step results\n");
    if receipt.step_results.is_empty() {
        push_wrapped(&mut output, 2, "unavailable", width);
    } else {
        for step_id in receipt.step_results.keys() {
            push_wrapped(
                &mut output,
                2,
                &format!("{step_id}: recorded (values redacted)"),
                width,
            );
        }
    }
    output.push_str("\nRollback window\n");
    push_wrapped(
        &mut output,
        2,
        if receipt.state.kind() == "published-held" {
            "Fast predecessor republish is available while the fence remains closed."
        } else {
            "Fast predecessor republish is unavailable after release; use an approved reverse plan or exact restore."
        },
        width,
    );
    output
}

pub fn render_rollback_receipt(receipt: &MigrationRollbackReceiptV1, width: usize) -> String {
    let width = width.max(MIN_PRESENTATION_WIDTH);
    let mut output = format!(
        "Migration rollback receipt {}\nPresentation contract: {}\nNarration face — constants and row values redacted\n",
        abbreviated(&receipt.operation_id),
        MIGRATION_PRESENTATION_CONTRACT_VERSION
    );
    push_field(&mut output, "operation id", &receipt.operation_id, width);
    push_field(&mut output, "plan digest", &receipt.plan_digest, width);
    push_field(
        &mut output,
        "republished version",
        &receipt.republished_version.to_string(),
        width,
    );
    push_field(
        &mut output,
        "restored storage generation",
        &receipt.restored_storage_generation.to_string(),
        width,
    );
    push_field(
        &mut output,
        "restamped rows",
        &receipt.restamped_rows.to_string(),
        width,
    );
    push_field(
        &mut output,
        "journal digest",
        &receipt.journal_digest,
        width,
    );
    output
}

pub fn render_verification(value: &Value, width: usize) -> String {
    let width = width.max(MIN_PRESENTATION_WIDTH);
    let mut output = format!(
        "Migration receipt verification\nPresentation contract: {MIGRATION_PRESENTATION_CONTRACT_VERSION}\nNarration face — recorded proof values redacted\n"
    );
    for (label, pointer) in [
        ("operation id", "/operationId"),
        ("state", "/state"),
        ("journal digest", "/journalDigest"),
        ("journal entries", "/journalEntries"),
    ] {
        if let Some(value) = value.pointer(pointer) {
            let rendered = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            push_field(&mut output, label, &rendered, width);
        }
    }
    push_field(
        &mut output,
        "data proof",
        if value.get("dataProof").is_some_and(|value| !value.is_null()) {
            "recorded (values redacted)"
        } else {
            "unavailable"
        },
        width,
    );
    push_wrapped(
        &mut output,
        2,
        "Verification re-proved the receipt against its journal projection; it did not re-digest a live post-release database.",
        width,
    );
    output
}

pub fn render_action(operation: &str, operation_id: &str, state: &str, width: usize) -> String {
    let width = width.max(MIN_PRESENTATION_WIDTH);
    let mut output = format!(
        "Migration {operation}\nPresentation contract: {MIGRATION_PRESENTATION_CONTRACT_VERSION}\nNarration face — constants redacted\n"
    );
    push_field(&mut output, "operation id", operation_id, width);
    push_field(&mut output, "state", state, width);
    output
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;
    use crate::manifest::{FieldType, ValueExpr};
    use crate::migration::{
        MigrationAudienceV1, MigrationBackupRequirement, MigrationBoundaries, MigrationCeilings,
        MigrationConstants, MigrationExpectedOutput, MigrationPlanBody, MigrationProof,
        MigrationStepBounds, MigrationStepRecord,
    };
    use crate::storage::migration_executor::MigrationExecState;

    fn fixture() -> (
        MigrationPlanArtifactV1,
        MigrationPreviewObservationV1,
        MigrationApprovalV1,
        MigrationReceiptV1,
    ) {
        let step = |id: &str, step: MigrationStep| MigrationStepRecord {
            id: id.to_owned(),
            step,
            preconditions: Vec::new(),
            reads: Vec::new(),
            writes: Vec::new(),
            bounds: MigrationStepBounds {
                max_rows: 10_000,
                max_bytes: 1_048_576,
            },
            reversible: true,
            verification: Vec::new(),
        };
        let steps = vec![
            step(
                "s1:AddField:models.provider",
                MigrationStep::AddField {
                    table: "models".to_owned(),
                    field: "provider".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                    backfill: None,
                },
            ),
            step(
                "s2:BackfillField:models.provider",
                MigrationStep::BackfillField {
                    table: "models".to_owned(),
                    field: "provider".to_owned(),
                    expr: ValueExpr::Arg("providerDefault".to_owned()),
                },
            ),
            step(
                "s3:ValidateRequired:models.provider",
                MigrationStep::ValidateRequired {
                    table: "models".to_owned(),
                    field: "provider".to_owned(),
                },
            ),
            step(
                "s4:MakeRequired:models.provider",
                MigrationStep::MakeRequired {
                    table: "models".to_owned(),
                    field: "provider".to_owned(),
                },
            ),
        ];
        let artifact = MigrationPlanArtifactV1 {
            body: MigrationPlanBody {
                schema_version: "migration-plan-v1".to_owned(),
                app: "fixture-app".to_owned(),
                instance: "fixture-instance".to_owned(),
                target_profile_id: "local-dev-sqlite-ibex".to_owned(),
                predecessor_schema_hash: "1".repeat(64),
                successor_schema_hash: "2".repeat(64),
                predecessor_generation: 7,
                steps,
                execution_strategy: MigrationExecutionStrategy::SingleTransaction,
                proof: MigrationProof {
                    method: MigrationProofMethod::Full,
                    bound: None,
                },
                ceilings: MigrationCeilings {
                    max_affected_rows: 10_000,
                    max_bytes: 67_108_864,
                    max_writes: 10_000,
                    max_barrier_downtime_ms: 30_000,
                },
                compatibility_posture: CompatibilityPosture::SuccessorOnly,
                retained_work_posture: RetainedWorkPosture::Empty,
                backup: MigrationBackupRequirement {
                    required: false,
                    checkpoint_label: None,
                    rehearsal_required: false,
                },
                expected_output: MigrationExpectedOutput {
                    schema_hash: "2".repeat(64),
                    projection_generations: BTreeMap::new(),
                },
                constants: MigrationConstants {
                    publication_timestamp_ms: 2_000_000_000_000,
                    rollback_timestamp_ms: Some(2_000_000_000_100),
                    values: BTreeMap::from([("providerDefault".to_owned(), json!("openai"))]),
                },
                boundaries: MigrationBoundaries::default(),
            },
            plan_digest: "a".repeat(64),
            plan_id: format!("migration-v1:{}", "a".repeat(64)),
        };
        let mut observation = MigrationPreviewObservationV1 {
            schema_version: "migration-observation-v1".to_owned(),
            plan_digest: artifact.plan_digest.clone(),
            target_head_version: 42,
            observed_at_ms: 2_000_000_000_010,
            precondition_rows: BTreeMap::from([(
                "s2:BackfillField:models.provider".to_owned(),
                1_204,
            )]),
            capability_health: BTreeMap::new(),
        };
        let observation_digest = crate::migration::observation_digest(&observation).unwrap();
        let approval = MigrationApprovalV1 {
            schema_version: "migration-approval-v1".to_owned(),
            plan_digest: artifact.plan_digest.clone(),
            observation_digest,
            policy_digest: "local-operator-policy-v1".to_owned(),
            audience: MigrationAudienceV1 {
                project_id: None,
                target_id: None,
                environment_id: None,
                deployment_id: None,
                release_id: None,
                database_id: "data-stream-fixture".to_owned(),
                stream_incarnation: "auth-stream-fixture".to_owned(),
                activation_generation: 7,
                target_profile_id: "local-dev-sqlite-ibex".to_owned(),
            },
            approver: "fixture-operator".to_owned(),
            generator_is_approver: true,
            issued_at_ms: 2_000_000_000_020,
            expires_at_ms: 2_000_086_400_020,
            operation_id: "operation-v1:fixture0001".to_owned(),
        };
        let receipt = MigrationReceiptV1 {
            version: "migration-receipt-v1".to_owned(),
            operation_id: approval.operation_id.clone(),
            plan_id: artifact.plan_id.clone(),
            plan_digest: artifact.plan_digest.clone(),
            approval_digest: "b".repeat(64),
            admission_digest: "c".repeat(64),
            audience: approval.audience.clone(),
            generator_is_approver: true,
            state: MigrationExecState::Released,
            input_version: 42,
            publication_version: Some(43),
            journal_entries: 12,
            journal_digest: "d".repeat(64),
            barrier_duration_ms: 987,
            step_results: BTreeMap::from([
                (
                    "s2:BackfillField:models.provider".to_owned(),
                    json!({"rows": 1204}),
                ),
                (
                    "§5-data-proof".to_owned(),
                    json!({"actual": "secret-digest"}),
                ),
            ]),
            error_code: None,
            rehearsal: false,
            completed_at_ms: 2_000_000_001_000,
        };
        // Callers use an empty observation for the omission fixture without
        // rebuilding the rest of the fixed input.
        observation.plan_digest = artifact.plan_digest.clone();
        (artifact, observation, approval, receipt)
    }

    fn golden(name: &str, actual: String) {
        let expected = match name {
            "plan-review" => {
                include_str!("../../../tests/fixtures/migration-presentation/plan-review.txt")
            }
            "plan-narration" => {
                include_str!("../../../tests/fixtures/migration-presentation/plan-narration.txt")
            }
            "plan-estimate-absent" => {
                include_str!("../../../tests/fixtures/migration-presentation/plan-estimate-absent.txt")
            }
            "plan-narrow" => {
                include_str!("../../../tests/fixtures/migration-presentation/plan-narrow.txt")
            }
            "approval-review" => {
                include_str!("../../../tests/fixtures/migration-presentation/approval-review.txt")
            }
            "receipt-narration" => {
                include_str!("../../../tests/fixtures/migration-presentation/receipt-narration.txt")
            }
            _ => unreachable!(),
        };
        assert_eq!(actual, expected, "golden fixture {name}");
    }

    #[test]
    fn presentation_golden_fixture_set() {
        let (artifact, observation, approval, receipt) = fixture();
        golden(
            "plan-review",
            render_plan(
                &artifact,
                &observation,
                MigrationPresentationOptions::review(STANDARD_PRESENTATION_WIDTH),
            ),
        );
        golden(
            "plan-narration",
            render_plan(
                &artifact,
                &observation,
                MigrationPresentationOptions::narration(STANDARD_PRESENTATION_WIDTH),
            ),
        );
        let mut estimate_absent = observation.clone();
        estimate_absent.precondition_rows.clear();
        golden(
            "plan-estimate-absent",
            render_plan(
                &artifact,
                &estimate_absent,
                MigrationPresentationOptions::review(STANDARD_PRESENTATION_WIDTH),
            ),
        );
        golden(
            "plan-narrow",
            render_plan(
                &artifact,
                &observation,
                MigrationPresentationOptions::narration(NARROW_PRESENTATION_WIDTH),
            ),
        );
        golden(
            "approval-review",
            render_approval(
                &artifact,
                &observation,
                &approval,
                MigrationPresentationOptions::review(STANDARD_PRESENTATION_WIDTH),
            ),
        );
        golden(
            "receipt-narration",
            render_receipt(&receipt, STANDARD_PRESENTATION_WIDTH),
        );
    }

    #[test]
    fn presentation_contract_pins_width_redaction_and_acknowledgement() {
        let (artifact, observation, _, _) = fixture();
        assert_eq!(presentation_width_from_columns(None), 88);
        assert_eq!(presentation_width_from_columns(Some("12")), 40);
        assert_eq!(presentation_width_from_columns(Some("72")), 72);
        assert_eq!(presentation_width_from_columns(Some("999")), 88);
        assert_eq!(
            MIGRATION_PRESENTATION_CONTRACT_VERSION,
            "migration-presentation-v1"
        );
        let review = render_plan(
            &artifact,
            &observation,
            MigrationPresentationOptions::review(88),
        );
        let narration = render_plan(
            &artifact,
            &observation,
            MigrationPresentationOptions::narration(88),
        );
        assert!(review.contains("\"openai\""));
        assert!(review.contains("Presentation contract: migration-presentation-v1"));
        assert!(!narration.contains("openai"));
        assert!(narration.contains("[redacted]"));
        assert!(!review.contains('\u{1b}'));
        assert!(!narration.contains('\u{1b}'));
        assert_eq!(
            approval_acknowledgement_token(&artifact, &observation),
            format!(
                "{}:{}",
                artifact.plan_digest,
                crate::migration::observation_digest(&observation).unwrap()
            )
        );
    }
}
