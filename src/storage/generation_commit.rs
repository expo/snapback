use super::auth_mode::{DurableModeCommit, NetworkDeploymentCommit};
use super::projection_rebuild::PendingProjectionPublication;
use super::{
    LocalDatabase, META_FUNCTION_GENERATION, now_millis, preflight_sequence_enrollments,
    projection_rebuild, schema_relation_parent_tables,
    sequence_declarations_from_function_manifest, validate_sequence_activation,
};
use crate::auth::mode::DeploymentIdentity;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FunctionManifest, MaintainedProjectionPlan, SchemaManifest, SeedData, SequenceDeclaration,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Typed input to the raw-dev generation's single durable activation cut.
pub(crate) struct CommitFunctionGeneration {
    pub(crate) manifest: crate::manifest::FunctionManifest,
    pub(crate) trusted_active_generation: bool,
    pub(crate) projection_publications: Vec<PendingProjectionPublication>,
}

/// Boot-safe durable identity of the latest raw-dev function generation.
/// The content digests identify what was admitted; `generation_high_water`
/// orders commits across process restarts where the process fence resets.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FunctionGenerationRecord {
    pub(crate) format_version: u32,
    pub(crate) generation_high_water: u64,
    pub(crate) function_manifest_digest: String,
    pub(crate) sequence_declarations_digest: String,
    pub(crate) committed_at_ms: u64,
}

/// The narrow kernel surface the generation-activation coordinator
/// composes. Owner #2's charter: callers receive typed operations,
/// not a wide `LocalDatabase` surface.
///
/// @ref LLP 0225#1-ownership-map — owner 2 (storage/migration kernel)
pub(crate) struct GenerationCommitOps<'a> {
    db: &'a mut LocalDatabase,
}

impl LocalDatabase {
    pub(crate) fn generation_commit_ops(&mut self) -> GenerationCommitOps<'_> {
        GenerationCommitOps { db: self }
    }
}

impl GenerationCommitOps<'_> {
    pub(crate) fn commit_function_generation(
        &mut self,
        commit: CommitFunctionGeneration,
    ) -> SnapbackResult<FunctionGenerationRecord> {
        self.db.commit_function_generation(commit)
    }

    pub(crate) fn apply_same_mode_network_deployment_with_functions_classified(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        functions: FunctionManifest,
        seed: Option<SeedData>,
        projection_publications: Vec<PendingProjectionPublication>,
    ) -> DurableModeCommit<NetworkDeploymentCommit> {
        self.db
            .apply_same_mode_network_deployment_with_functions_classified(
                deployment,
                manifest,
                functions,
                seed,
                projection_publications,
            )
    }

    pub(crate) fn install_committed_sequence_declarations(
        &mut self,
        declarations: BTreeMap<String, SequenceDeclaration>,
    ) {
        self.db
            .install_committed_sequence_declarations(declarations);
    }

    pub(crate) fn stream_transcript_manifest_matches(
        &self,
        manifest: &FunctionManifest,
    ) -> SnapbackResult<bool> {
        super::stream_transcripts::manifests_match_catalog(
            &self.db.conn,
            &self.db.schema,
            Some(manifest),
        )
    }

    pub(crate) fn rebuild_projection_if_stale(
        &mut self,
        plan: &MaintainedProjectionPlan,
        reason: &str,
    ) -> SnapbackResult<Option<PendingProjectionPublication>> {
        self.db.rebuild_projection_if_stale(plan, reason)
    }

    pub(crate) fn schema(&self) -> &SchemaManifest {
        self.db.schema()
    }
}

impl LocalDatabase {
    pub(super) fn sequence_activation_predecessor(
        &self,
        declarations: &BTreeMap<String, crate::manifest::SequenceDeclaration>,
        trusted_active_generation: bool,
    ) -> (
        BTreeMap<String, crate::manifest::SequenceDeclaration>,
        BTreeSet<String>,
    ) {
        let mut predecessor = BTreeMap::new();
        if trusted_active_generation {
            predecessor.extend(self.sequence_declarations.as_ref().clone());
            predecessor.extend(declarations.clone());
        }
        let trusted_relation_parent_tables = schema_relation_parent_tables(&self.schema)
            .into_iter()
            .map(ToOwned::to_owned)
            .collect();
        (predecessor, trusted_relation_parent_tables)
    }

    /// Commit every durable raw-dev generation member in one immediate
    /// transaction. Process publication is intentionally a caller-owned
    /// postcondition and must not occur inside this operation.
    ///
    /// @ref LLP 0225#1-ownership-map — the storage kernel owns the
    ///   composite commit primitive; the activation coordinator owns ordering
    ///   and installs process state only after this durable fact commits.
    pub(super) fn commit_function_generation(
        &mut self,
        commit: CommitFunctionGeneration,
    ) -> SnapbackResult<FunctionGenerationRecord> {
        let CommitFunctionGeneration {
            manifest,
            trusted_active_generation,
            projection_publications,
        } = commit;
        let sequence_declarations = sequence_declarations_from_function_manifest(&manifest);
        let function_manifest_digest = crate::manifest::canonical_content_identity(&manifest)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_FUNCTION_GENERATION_INVALID",
                    "storage",
                    "function generation manifest is not canonically digestible",
                )
            })?;
        let sequence_declarations_digest = crate::manifest::canonical_content_identity(
            &sequence_declarations,
        )
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_FUNCTION_GENERATION_INVALID",
                "storage",
                "sequence declarations are not canonically digestible",
            )
        })?;
        let (predecessor, trusted_relation_parent_tables) =
            self.sequence_activation_predecessor(&sequence_declarations, trusted_active_generation);
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        preflight_sequence_enrollments(
            &tx,
            &self.schema,
            &trusted_relation_parent_tables,
            &predecessor,
            &sequence_declarations,
        )?;
        projection_rebuild::apply_projection_publication_in(&tx, &projection_publications)?;
        // @ref LLP 0225#1-ownership-map — transcript-catalog publication is
        //   generation-coupled durable state, so owner 1 composes it through
        //   owner 2's exact raw-dev transaction instead of a post-commit cut.
        if self.schema.ask_manifest().is_some() {
            super::stream_transcripts::activate_manifests_in(&tx, &self.schema, Some(&manifest))?;
        } else {
            super::stream_transcripts::activate_manifest_in(&tx, &manifest)?;
        }
        let previous: Option<String> = tx
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_FUNCTION_GENERATION],
                |row| row.get(0),
            )
            .optional()?;
        let previous = previous
            .map(|raw| {
                serde_json::from_str::<FunctionGenerationRecord>(&raw).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_FUNCTION_GENERATION_STATE_CORRUPT",
                        "storage",
                        "persisted function generation record is corrupt",
                    )
                })
            })
            .transpose()?;
        let generation_high_water = previous.map_or(Ok(1), |record| {
            record.generation_high_water.checked_add(1).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_FUNCTION_GENERATION_EXHAUSTED",
                    "storage",
                    "function generation high-water is exhausted",
                )
            })
        })?;
        let record = FunctionGenerationRecord {
            format_version: 1,
            generation_high_water,
            function_manifest_digest,
            sequence_declarations_digest,
            committed_at_ms: now_millis(),
        };
        tx.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![
                META_FUNCTION_GENERATION,
                serde_json::to_string(&record).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_FUNCTION_GENERATION_INVALID",
                        "storage",
                        "function generation record does not serialize",
                    )
                })?
            ],
        )?;
        // Keep activation validation inside the same cut and after every
        // candidate durable member has been staged. A refusal therefore proves
        // rollback of enrollments, pins, and the generation record together.
        validate_sequence_activation(&tx, &self.schema, &sequence_declarations)?;
        tx.commit()?;
        Ok(record)
    }

    pub(crate) fn function_generation_record(
        &self,
    ) -> SnapbackResult<Option<FunctionGenerationRecord>> {
        let stored: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_FUNCTION_GENERATION],
                |row| row.get(0),
            )
            .optional()?;
        stored
            .map(|raw| {
                serde_json::from_str(&raw).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_FUNCTION_GENERATION_STATE_CORRUPT",
                        "storage",
                        "persisted function generation record is corrupt",
                    )
                })
            })
            .transpose()
    }

    pub(super) fn install_committed_sequence_declarations(
        &mut self,
        declarations: BTreeMap<String, crate::manifest::SequenceDeclaration>,
    ) {
        self.sequence_declarations = Arc::new(declarations);
    }
}
