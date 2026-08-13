//! The LLP 0081 acceptance corpus, public-surface half: one approved
//! migration's complete lifecycle — deterministic plan, admission, batched
//! execution, the §5 data proof, publication, receipts, replay, verify, and
//! the §6 fast rollback — exercised exactly the way an operator-facing
//! caller reaches it. The transition-interior fault matrix, tamper
//! refusals, and rollback byte-equality live beside the executor
//! (`src/storage/migration_executor.rs` tests); the item→witness map is in
//! `issues/20260724-step5-impl-0081-acceptance-corpus.md`.
//!
//! @ref LLP 0081#5-verification-and-data-proof — the receipt carries the
//!   full-proof digests; a digest with no independent expected value is
//!   inventory, not proof.

use serde_json::json;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use snapback::migration::{
    CompatibilityPosture, MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_PLAN_SCHEMA_VERSION,
    MigrationApprovalV1, MigrationAudienceV1, MigrationBackupRequirement, MigrationCeilings,
    MigrationConstants, MigrationExecutionStrategy, MigrationExpectedOutput, MigrationIntent,
    MigrationPlanArtifactV1, MigrationPlanBody, MigrationProof, MigrationProofMethod,
    MigrationVerification, RetainedWorkPosture, derive_plan_steps, new_operation_id,
};
use std::collections::BTreeMap;

const PUBLICATION_TS: u64 = 2_000_000_000_000;

fn table(name: &str, fields: Vec<(&str, bool)>) -> TableManifest {
    TableManifest {
        name: name.to_owned(),
        fields: fields
            .into_iter()
            .map(|(field, optional)| FieldManifest {
                name: field.to_owned(),
                field_type: FieldType::String,
                optional,
            })
            .collect(),
        indexes: Vec::new(),
        syncable: true,
        permission_backing: false,
        permission_fields: None,
        search_indexes: Vec::new(),
        vector_indexes: Vec::new(),
        search_live_limits: None,
        membership: None,
        authority_profile: None,
        asset_sharing: None,
        visibility: None,
        history: None,
    }
}

fn predecessor() -> SchemaManifest {
    SchemaManifest {
        tables: vec![table("notes", vec![("body", false)])],
        ..SchemaManifest::default()
    }
}

fn successor() -> SchemaManifest {
    SchemaManifest {
        tables: vec![table("notes", vec![("body", false), ("region", false)])],
        ..SchemaManifest::default()
    }
}

fn plan() -> MigrationPlanArtifactV1 {
    let predecessor = predecessor();
    let successor = successor();
    let intents = vec![MigrationIntent::CopyTableToGeneration {
        table: "notes".to_owned(),
        generation: 2,
        source_table: "notes".to_owned(),
        fields: BTreeMap::from([
            (
                "body".to_owned(),
                ValueExpr::Field {
                    base: Box::new(ValueExpr::Binding("row".to_owned())),
                    key: "body".to_owned(),
                },
            ),
            ("region".to_owned(), ValueExpr::Arg("region".to_owned())),
        ]),
    }];
    let mut steps = derive_plan_steps(&successor, &intents).expect("derive steps");
    for record in &mut steps {
        if record.id.contains("CopyTable") {
            record.verification = vec![
                MigrationVerification::RowCountMatchesSource {
                    source_table: "notes".to_owned(),
                    table: "notes".to_owned(),
                },
                MigrationVerification::ContentDigest {
                    table: "notes".to_owned(),
                },
            ];
        }
    }
    let identity = |schema: &SchemaManifest| {
        snapback::storage::migration_executor::schema_identity(schema).expect("schema identity")
    };
    let body = MigrationPlanBody {
        schema_version: MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
        app: "corpus-app".to_owned(),
        instance: "memory".to_owned(),
        target_profile_id: snapback::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        predecessor_schema_hash: identity(&predecessor),
        successor_schema_hash: identity(&successor),
        predecessor_generation: 1,
        steps,
        execution_strategy: MigrationExecutionStrategy::ShadowGeneration,
        proof: MigrationProof {
            method: MigrationProofMethod::Full,
            bound: None,
        },
        ceilings: MigrationCeilings {
            max_affected_rows: 1_000,
            max_bytes: 16 * 1024 * 1024,
            max_writes: 1_000,
            max_barrier_downtime_ms: 60_000,
        },
        compatibility_posture: CompatibilityPosture::SuccessorOnly,
        retained_work_posture: RetainedWorkPosture::Empty,
        backup: MigrationBackupRequirement {
            required: false,
            checkpoint_label: None,
            rehearsal_required: false,
        },
        expected_output: MigrationExpectedOutput {
            schema_hash: identity(&successor),
            projection_generations: BTreeMap::new(),
        },
        constants: MigrationConstants {
            publication_timestamp_ms: PUBLICATION_TS,
            rollback_timestamp_ms: Some(PUBLICATION_TS + 1),
            values: BTreeMap::from([("region".to_owned(), json!("us-east-1"))]),
        },
        boundaries: Default::default(),
    };
    MigrationPlanArtifactV1::seal(body).expect("seal plan")
}

fn approval(snapback: &mut LocalSnapback, plan: &MigrationPlanArtifactV1) -> MigrationApprovalV1 {
    let resolved = snapback
        .migrate_resolved_audience()
        .expect("resolve local audience");
    MigrationApprovalV1 {
        schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
        plan_digest: plan.plan_digest.clone(),
        observation_digest: "0".repeat(64),
        policy_digest: "local-operator-policy-v1".to_owned(),
        audience: MigrationAudienceV1 {
            project_id: None,
            target_id: None,
            environment_id: None,
            deployment_id: None,
            release_id: None,
            database_id: resolved.database_id,
            stream_incarnation: resolved.stream_incarnation,
            activation_generation: resolved.activation_generation,
            target_profile_id: resolved.target_profile_id,
        },
        approver: "corpus-operator".to_owned(),
        generator_is_approver: true,
        issued_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_millis() as u64,
        expires_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_millis() as u64
            + 86_400_000,
        operation_id: new_operation_id(),
    }
}

fn fixture() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory instance");
    snapback.apply_schema(predecessor()).expect("apply schema");
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "notes".to_owned(),
                vec![
                    json!({ "body": "alpha" }).as_object().cloned().unwrap(),
                    json!({ "body": "beta" }).as_object().cloned().unwrap(),
                ],
            )]),
        })
        .expect("seed");
    snapback
}

/// The forward lifecycle: apply → released receipt with the §5 full proof on
/// its face → verify re-proves the seal → replay returns the same receipt.
#[test]
fn corpus_forward_lifecycle_with_full_proof() {
    let mut snapback = fixture();
    let plan = plan();
    let approval = approval(&mut snapback, &plan);
    let receipt = snapback
        .migrate_apply_artifact(&plan, &approval, &successor())
        .expect("apply");
    assert_eq!(receipt.state.kind(), "released");
    let proof = receipt
        .step_results
        .get("§5-data-proof")
        .expect("data proof rides the receipt");
    assert_eq!(proof["proofMethod"], json!("full"));
    assert!(
        proof["tables"]["notes"]["logicalDigest"]
            .as_str()
            .is_some_and(|digest| digest.starts_with("cdv1:")),
    );
    assert_eq!(proof["tables"]["notes"]["rows"], json!(2));

    let verify = snapback
        .migrate_verify_receipt(&approval.operation_id)
        .expect("verify");
    assert_eq!(verify["state"], json!("released"));
    assert!(verify["dataProof"].is_object());

    let replay = snapback
        .migrate_apply_artifact(&plan, &approval, &successor())
        .expect("replay");
    assert_eq!(replay, receipt);
}

/// A fresh approval of the same plan is a NEW operation and is stale
/// against the completed predecessor identity — never a silent re-run.
#[test]
fn corpus_completed_plan_is_stale_under_a_new_operation() {
    let mut snapback = fixture();
    let plan = plan();
    let first = approval(&mut snapback, &plan);
    snapback
        .migrate_apply_artifact(&plan, &first, &successor())
        .expect("apply");
    let second = approval(&mut snapback, &plan);
    let error = snapback
        .migrate_apply_artifact(&plan, &second, &successor())
        .expect_err("a new operation against a completed plan is stale");
    assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_STALE");
}

/// Rollback is refused once released: after the fence opened, external
/// effects may exist, so §6 demands a separately approved reverse plan.
#[test]
fn corpus_rollback_refused_after_release() {
    let mut snapback = fixture();
    let plan = plan();
    let approval = approval(&mut snapback, &plan);
    snapback
        .migrate_apply_artifact(&plan, &approval, &successor())
        .expect("apply");
    let error = snapback
        .migrate_rollback_artifact(&plan, &approval)
        .expect_err("released operations cannot fast-rollback");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE"
    );
}

/// Publication moves BOTH pre-sessions manifest slots together: a
/// file-backed store that executed a reviewed migration must pass the
/// auth-mode open inspection on its next open. Found by the Step 5
/// schema-evolution witness — publication wrote only the legacy slot,
/// leaving the capability-aware copy at the predecessor and bricking the
/// store with SNAPBACK_AUTH_MODE_STATE_CORRUPT at reopen.
#[test]
fn corpus_published_store_reopens_cleanly() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("migrated.sqlite");
    let mut snapback = LocalSnapback::open(&path).expect("open");
    snapback.apply_schema(predecessor()).expect("apply schema");
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "notes".to_owned(),
                vec![json!({ "body": "alpha" }).as_object().cloned().unwrap()],
            )]),
        })
        .expect("seed");
    let plan = plan();
    let approval = approval(&mut snapback, &plan);
    snapback
        .migrate_apply_artifact(&plan, &approval, &successor())
        .expect("apply");
    drop(snapback);
    let reopened =
        LocalSnapback::open(&path).expect("a migrated store reopens through the mode inspection");
    drop(reopened);
}
