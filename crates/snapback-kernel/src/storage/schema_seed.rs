use super::*;

fn reset_and_seed_transaction(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    projections: &[crate::manifest::MaintainedProjectionPlan],
    order_field_bounds: &BTreeMap<(String, String), u64>,
    seed: Option<SeedData>,
    successor: &crate::contract_types::AuthorizationStreamIncarnation,
    versioned: Option<(&crate::seed_identity::ResetSeedRequestV1, &str)>,
) -> SnapbackResult<(
    Option<MutationOutput>,
    Option<crate::seed_identity::SeedInstallReceiptV1>,
)> {
    let current_data_stream = crate::seed_identity::strict_current_data_version_stream(tx)?;
    if let Some((request, request_digest)) = versioned {
        validate_versioned_seed_request(schema, request.requested_mode, request.artifact.as_ref())?;
        if !crate::seed_identity::expected_stream_matches(
            &request.expected_data_version_stream,
            current_data_stream.as_deref(),
        ) {
            return Err(SnapbackError::error(
                "SNAPBACK_SEED_OPERATION_HISTORICAL",
                "seed",
                "expected data-version stream is no longer current",
            ));
        }
        if crate::seed_identity::replay_completed_operation(
            tx,
            &request.operation_id,
            request_digest,
            current_data_stream.as_deref(),
        )?
        .is_some()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SEED_REPLAY_REQUIRES_PREFLIGHT",
                "seed",
                "current operation replay must complete before entering the reset coordinator",
            ));
        }
    }
    // @ref LLP 0077#issuance-refresh-and-recovery — the stream-incarnation
    // reset advances sender replay authority and clears old proof/nonce state
    // inside this same destructive transaction.
    auth_sender::rotate_sender_authority_for_stream_reset(tx)?;
    // @ref LLP 0057#catalog-write-and-lifecycle-rules — auth state is
    // deleted in dependency order inside the same transaction as app reset,
    // while the protected catalog DDL and marker remain installed.
    auth::reset_auth_catalog_in(tx)?;
    // @ref LLP 0143#d1-device-token-custody — destructive app reset clears
    // deployment-custody token rows in the same transaction as auth state.
    if schema.push_seam.is_some() {
        crate::push::clear_in(tx)?;
    }
    // @ref LLP 0007#schema-evolution — dormant rollback tables are still
    // inside the app-wide reset boundary.
    let physical_tables = physical_user_tables(tx)?;
    let mut reset_deleted_rows = 0usize;
    for table in &physical_tables {
        if versioned.is_some() {
            let count: i64 = tx.query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_ident(table)?),
                [],
                |row| row.get(0),
            )?;
            reset_deleted_rows = reset_deleted_rows
                .checked_add(usize::try_from(count).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_SEED_IDENTITY_CORRUPT",
                        "seed",
                        "reset deletion count is not representable",
                    )
                })?)
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_SEED_IDENTITY_CORRUPT",
                        "seed",
                        "reset deletion count overflowed",
                    )
                })?;
        }
        tx.execute(&format!("DELETE FROM {}", quote_ident(table)?), [])?;
    }
    // @ref LLP 0109#17-dated-amendment-seed-asset-fixtures-2026-07-31 —
    //   asset bytes are app state: reset clears every asset system table
    //   (records, blobs, ledger, fixture mappings, signing keys — outstanding
    //   signed URLs die with the destructive reset) in the same transaction;
    //   the caller removes store files after commit.
    for table in crate::assets::ASSET_SYSTEM_TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute("DELETE FROM _snapback_changes", [])?;
    tx.execute("DELETE FROM _snapback_client_mutations", [])?;
    tx.execute("DELETE FROM _snapback_client_mutation_auth_retention", [])?;
    tx.execute("DELETE FROM _snapback_membership_transitions", [])?;
    tx.execute("DELETE FROM _snapback_relation_incarnations_v1", [])?;
    tx.execute("DELETE FROM _snapback_sequence_counters_v1", [])?;
    // @ref LLP 0076#authority-and-lifecycle — application reload/reset is a
    // cursor-closing terminal event; retained attempt settlement evidence is
    // application state and resets with it.
    tx.execute("DELETE FROM _snapback_stream_attempts", [])?;
    auth_invalidation::clear_retry_episodes_in(tx)?;
    authorized_lease::clear_authorized_lease_reservations_in(tx)?;
    let successor_data_stream = auth_invalidation::rotate_data_version_stream_in(tx)?;
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key = ?1",
        params![META_RETENTION_FLOOR],
    )?;
    save_meta_u64(tx, META_CLIENT_MUTATION_RECORDS, 0)?;
    save_meta_u64(tx, META_CLIENT_MUTATION_BYTES, 0)?;
    save_meta_u64(tx, META_CLIENT_MUTATION_GC_TOTAL, 0)?;
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key = ?1",
        params![META_CRON_STATE],
    )?;
    // @ref LLP 0059#reset-restore-and-stream-publication — the successor is
    // durable in the same transaction as every destructive reset effect.
    auth_stream::rotate_authorization_stream_incarnation_in(tx, successor)?;
    set_version(tx, 0)?;
    // @ref LLP 0073#rebuilds-and-migrations — destructive reset rotates the
    // physical generation, invalidating every pre-reset cursor and rebuilding
    // only from the reset/seed source cut.
    for table in [
        "_snapback_search_terms",
        "_snapback_search_sources",
        "_snapback_search_frontiers",
        "_snapback_search_builds",
        "_snapback_search_journal_leases",
        "_snapback_search_generations",
        "_snapback_vector_build_snapshot",
        "_snapback_vector_journal_leases",
        "_snapback_vector_builds",
        "_snapback_vector_sources",
        "_snapback_vector_frontiers",
        "_snapback_vector_generations",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    crate::search::sqlite::activate_manifest_in_tx(tx, schema, 0)?;
    crate::vector::sqlite::stage_manifest_in_tx(tx, schema, 0)?;

    let seeded = match seed {
        None => None,
        Some(seed) => {
            // Reset deleted every managed row above, so the predecessor cut is
            // the freshly installed zero head. Keep the all-declaration
            // preflight explicit: unlike ordinary seed, no pre-reset corrupt
            // row is allowed to participate in activation.
            preflight_membership_activation_sources(tx, schema, 0)?;
            let mut changes = seed_into_transaction(tx, schema, seed, 1, order_field_bounds)?;
            let direct_application_rows = changes.len();
            if !projections.is_empty() {
                maintain_projections_in_tx(
                    tx,
                    schema,
                    projections,
                    &mut changes,
                    &BTreeMap::new(),
                    1,
                    now_millis(),
                    order_field_bounds,
                    if versioned.is_some() {
                        ProjectionEffectCeiling::VersionedSeedV1
                    } else {
                        ProjectionEffectCeiling::MutationV1
                    },
                )?;
            }
            if versioned.is_some() {
                crate::seed_identity::checked_application_effects(
                    direct_application_rows,
                    changes.len().saturating_sub(direct_application_rows),
                )?;
            }
            maintain_derived_indexes_in_tx(tx, schema, &changes, 1)?;
            // Reset seed is another declaration-privileged writer. Judge its
            // complete same-transaction resource/roster state before the reset
            // cut can publish, including closed roles, referential integrity,
            // and eligible last holders.
            validate_membership_activation(tx, schema, 1)?;
            let changed_count = changes.len();
            if changed_count > 0 {
                set_version(tx, 1)?;
            }
            Some(MutationOutput {
                version: if changed_count > 0 { 1 } else { 0 },
                changed_count,
                result: Value::Null,
                authority_transitions: Vec::new(),
                ctx_ledger: None,
                settlement_mint_observations: Vec::new(),
                settlement_time_observation: None,
                settlement_sequence_allocations: Vec::new(),
            })
        }
    };
    let receipt = if let Some((request, request_digest)) = versioned {
        let schema_hash = required_versioned_seed_schema_hash(schema)?;
        let (operation, outcome, artifact) = match request.operation {
            crate::seed_identity::SeedResetOperationV1::ResetInstall => (
                crate::seed_identity::SeedOperationV1::ResetInstall,
                crate::seed_identity::SeedOutcomeV1::ResetInstalled,
                request.artifact.as_ref(),
            ),
            crate::seed_identity::SeedResetOperationV1::Clear => (
                crate::seed_identity::SeedOperationV1::Clear,
                crate::seed_identity::SeedOutcomeV1::Cleared,
                None,
            ),
        };
        let direct_application_rows = artifact
            .map(crate::seed_identity::SeedArtifactV1::row_count)
            .transpose()?
            .unwrap_or(0);
        let total_application_effects = seeded.as_ref().map_or(0, |output| output.changed_count);
        let derived_projection_rows =
            total_application_effects.saturating_sub(direct_application_rows);
        let receipt = crate::seed_identity::SeedInstallReceiptV1 {
            format_version: crate::seed_identity::SEED_RECEIPT_FORMAT_V1.to_owned(),
            operation_id: request.operation_id.clone(),
            request_digest: request_digest.to_owned(),
            operation,
            outcome,
            app_id: schema.app_id.clone(),
            seed_version: artifact.map(|artifact| artifact.seed_version.clone()),
            seed_digest: artifact.map(|artifact| artifact.seed_digest.clone()),
            schema_hash,
            data_version_stream: successor_data_stream,
            direct_application_rows,
            derived_projection_rows,
            total_application_effects,
            reset_deleted_rows,
        };
        if let Some(artifact) = artifact {
            crate::seed_identity::store_installation(tx, artifact, &receipt)?;
        }
        crate::seed_identity::store_completed_operation(
            tx,
            current_data_stream.as_deref(),
            &receipt,
        )?;
        crate::seed_identity::best_effort_prune_history(tx, &receipt.data_version_stream);
        Some(receipt)
    } else {
        None
    };
    Ok((seeded, receipt))
}

fn required_versioned_seed_schema_hash(schema: &SchemaManifest) -> SnapbackResult<String> {
    schema.schema_hash.clone().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_SEED_DECLARATION_INVALID",
            "seed",
            "versioned seed requires the loaded generated schema identity",
        )
    })
}

pub(super) fn validate_versioned_seed_request(
    schema: &SchemaManifest,
    requested_mode: AuthMode,
    artifact: Option<&crate::seed_identity::SeedArtifactV1>,
) -> SnapbackResult<()> {
    if schema.effective_auth_mode() != requested_mode {
        return Err(SnapbackError::error(
            "SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED",
            "seed",
            "versioned seed requested mode does not match the active app mode",
        ));
    }
    required_versioned_seed_schema_hash(schema)?;
    if let Some(artifact) = artifact {
        artifact.validate()?;
        if artifact.app_id != schema.app_id {
            return Err(SnapbackError::error(
                "SNAPBACK_SEED_DECLARATION_INVALID",
                "seed",
                "versioned seed appId does not match the active schema",
            ));
        }
        for table_name in artifact.tables.keys() {
            // Membership tables are admitted through the declared fixture
            // lane (LLP 0109 §8, commissioned by LLP 0100 §8b): fixture
            // seats install under the seed writer with per-row provenance
            // stamping, and the same-transaction activation scan enforces
            // vocabulary, axes, uniqueness, referential integrity, and
            // lastHolder eligibility. The first-landing
            // SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED narrowing is
            // retired (dated 0109 amendment, 2026-08-01); unknown tables
            // still refuse here.
            // @ref LLP 0109#8-authorization-and-authority-bearing-rows
            let _ = schema_table(schema, table_name)?;
        }
    }
    Ok(())
}

fn versioned_seed_target_occupancy(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    artifact: &crate::seed_identity::SeedArtifactV1,
) -> SnapbackResult<Vec<bool>> {
    artifact
        .tables
        .keys()
        .map(|table_name| {
            let table = schema_table(schema, table_name)?;
            let occupied = tx
                .query_row(
                    &format!(
                        "SELECT 1 FROM {} LIMIT 1",
                        quote_ident(table.name.as_str())?
                    ),
                    [],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            Ok(occupied)
        })
        .collect()
}

fn count_physical_application_rows(tx: &Transaction<'_>) -> SnapbackResult<usize> {
    physical_user_tables(tx)?
        .into_iter()
        .try_fold(0usize, |total, table| {
            let count: i64 = tx.query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_ident(&table)?),
                [],
                |row| row.get(0),
            )?;
            let count = usize::try_from(count).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_SEED_IDENTITY_CORRUPT",
                    "seed",
                    "application row count is not representable",
                )
            })?;
            total.checked_add(count).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_SEED_IDENTITY_CORRUPT",
                    "seed",
                    "application row count overflowed",
                )
            })
        })
}

fn preview_identity(
    artifact: &crate::seed_identity::SeedArtifactV1,
    stream: &str,
    schema: &SchemaManifest,
    direct_application_rows: usize,
    derived_projection_rows: usize,
) -> crate::seed_identity::ActiveSeedIdentityV1 {
    crate::seed_identity::ActiveSeedIdentityV1 {
        app_id: artifact.app_id.clone(),
        seed_version: artifact.seed_version.clone(),
        seed_digest: artifact.seed_digest.clone(),
        data_version_stream: stream.to_owned(),
        schema_hash: schema.schema_hash.clone().unwrap_or_default(),
        direct_application_rows,
        derived_projection_rows,
        total_application_effects: direct_application_rows.saturating_add(derived_projection_rows),
    }
}

/// Evaluate versioned-seed projection effects against an owned in-memory
/// database copy. The source connection is read only by SQLite backup; every
/// simulated DML byte is confined to the disposable copy, preserving the
/// preview contract for the database and its WAL.
///
/// @ref LLP 0109#165-executable-effect-accounting — preview reports the same
/// distinct changed projection-output rows as a real install.
fn simulate_versioned_seed_projection_rows(
    database: &LocalDatabase,
    schema: &SchemaManifest,
    projections: &[crate::manifest::MaintainedProjectionPlan],
    artifact: &crate::seed_identity::SeedArtifactV1,
    reset_first: bool,
) -> SnapbackResult<usize> {
    let mut simulation = database.detached_read_snapshot()?;
    let simulation = &mut simulation.db;
    let _writer_token = simulation
        .writer_authority
        .enter(write_authority::LocalWriterLaneV1::DryRun)?;
    let tx = simulation
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    if reset_first {
        for table in physical_user_tables(&tx)? {
            tx.execute(&format!("DELETE FROM {}", quote_ident(&table)?), [])?;
        }
        // Reset-generated relation incarnations are application-derived
        // protected state. The real reset clears them before seeding; the
        // disposable preview must model that same successor cut.
        tx.execute("DELETE FROM _snapback_relation_incarnations_v1", [])?;
        tx.execute("DELETE FROM _snapback_sequence_counters_v1", [])?;
    }
    let current_version = current_version_on(&tx)?;
    let next_version = next_storage_version(current_version)?;
    let mut changes = seed_into_transaction(
        &tx,
        schema,
        artifact.seed_data(),
        next_version,
        &simulation.order_field_bounds,
    )?;
    let direct_application_rows = changes.len();
    if !projections.is_empty() {
        maintain_projections_in_tx(
            &tx,
            schema,
            projections,
            &mut changes,
            &BTreeMap::new(),
            next_version,
            now_millis(),
            &simulation.order_field_bounds,
            ProjectionEffectCeiling::UnboundedPreview,
        )?;
    }
    let derived_projection_rows = changes.len().saturating_sub(direct_application_rows);
    tx.rollback()?;
    Ok(derived_projection_rows)
}

impl LocalDatabase {
    pub(super) fn apply_schema(
        &mut self,
        manifest: SchemaManifest,
    ) -> SnapbackResult<Vec<Diagnostic>> {
        let diagnostics = manifest.agent_registration_diagnostics();
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::SchemaActivation)?;
        self.apply_schema_mode_aware(manifest)?;
        self.writer_authority.set_schema(&self.schema)?;
        Ok(diagnostics)
    }

    pub(super) fn reset(&mut self) -> SnapbackResult<ResetCommit> {
        self.reset_and_seed(None)
    }

    /// Replace all app data with an optional declarative seed in one SQLite
    /// transaction. Validation, inserts, version reset, and seed changes are
    /// all covered by the same commit: any error drops the transaction and
    /// leaves the previous database byte-for-byte visible to callers.
    ///
    /// @ref LLP 0003#execution-and-write-semantics — a logical mutation has
    /// one durable commit boundary; reset+seed is one operation, not a
    /// committed reset followed by a fallible second mutation.
    pub(super) fn reset_and_seed(&mut self, seed: Option<SeedData>) -> SnapbackResult<ResetCommit> {
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::ResetAndSeed)?;
        let predecessor = self.ensure_authorization_stream_incarnation()?;
        // A standalone database owns no published session projection or grant
        // registry. Mint the same fresh successor the process coordinator
        // would carry; server-owned reset uses the installed full coordinator.
        let successor = crate::contract_types::AuthorizationStreamIncarnation::fresh();
        let attempt =
            self.attempt_reset_and_seed_with_authorization_stream(seed, &predecessor, &successor);
        match attempt {
            auth::AuthTransactionAttempt::Committed(seeded) => Ok(ResetCommit {
                seeded,
                authorization: AuthorizationCommitWitness {
                    version: self.authorization_version()?,
                    event: true,
                    incarnation_rotated: true,
                    membership_declarations: Vec::new(),
                },
            }),
            auth::AuthTransactionAttempt::RolledBack(error) => Err(error),
            auth::AuthTransactionAttempt::CommitUncertain(_) => Err(SnapbackError::error(
                "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
                "auth",
                "authorization-stream reset commit outcome is uncertain",
            )),
        }
    }

    /// Coordinated destructive reset with explicit commit certainty. A unique
    /// stream successor is the durable operation marker used to reconcile a
    /// lost COMMIT acknowledgement without replaying seed effects.
    pub(super) fn attempt_reset_and_seed_with_authorization_stream(
        &mut self,
        seed: Option<SeedData>,
        predecessor: &crate::contract_types::AuthorizationStreamIncarnation,
        successor: &crate::contract_types::AuthorizationStreamIncarnation,
    ) -> auth::AuthTransactionAttempt<Option<MutationOutput>> {
        let _writer_token = match self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::ResetAndSeed)
        {
            Ok(token) => token,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        let schema = self.schema.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = match self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(tx) => tx,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error.into()),
        };
        let authorization_predecessor = match auth_stream::read_authorization_version_on(&tx) {
            Ok(version) => version,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        if authorization_predecessor
            .as_ref()
            .map(|version| version.incarnation.as_str())
            != Some(predecessor.as_str())
        {
            return auth::AuthTransactionAttempt::RolledBack(SnapbackError::error(
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
                "auth",
                "reset coordinator predecessor does not match durable authorization state",
            ));
        }
        let seeded = match reset_and_seed_transaction(
            &tx,
            &schema,
            self.projections.as_ref(),
            &self.order_field_bounds,
            seed,
            successor,
            None,
        ) {
            Ok((seeded, None)) => seeded,
            Ok((_seeded, Some(_))) => unreachable!("legacy reset produced versioned receipt"),
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        #[cfg(any(test, feature = "test-support"))]
        if let Err(error) = BEFORE_RESET_COMMIT_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook()?;
            }
            Ok::<(), SnapbackError>(())
        }) {
            return auth::AuthTransactionAttempt::RolledBack(error);
        }
        let authorization = AuthorizationCommitWitness {
            version: AuthorizationVersion {
                incarnation: successor.as_str().to_owned(),
                epoch: 0,
            },
            event: true,
            incarnation_rotated: true,
            membership_declarations: Vec::new(),
        };
        let min_commit_version = seeded.as_ref().map_or(0, |output| output.version);
        let prepared = match prepare_authorization_commit_interlock(
            &authorization,
            AuthorizationCommitImpact::AllProtectedRooms,
            &authorization_interlock,
            &commit_authority_identity,
            authorization_predecessor.as_ref(),
        ) {
            Ok(prepared) => prepared,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        match tx.commit() {
            Ok(()) => match prepared {
                Some(prepared) => match prepared.finalize_committed(min_commit_version) {
                    Ok(()) => auth::AuthTransactionAttempt::Committed(seeded),
                    Err(error) => auth::AuthTransactionAttempt::CommitUncertain(error),
                },
                None => auth::AuthTransactionAttempt::Committed(seeded),
            },
            Err(error) => {
                let error = SnapbackError::from(error);
                match auth_stream::read_authorization_version_snapshot(&self.conn) {
                    Ok(durable) if durable == Some(authorization.version.clone()) => match prepared
                    {
                        Some(prepared) => match prepared.finalize_committed(min_commit_version) {
                            Ok(()) => auth::AuthTransactionAttempt::Committed(seeded),
                            Err(error) => auth::AuthTransactionAttempt::CommitUncertain(error),
                        },
                        None => auth::AuthTransactionAttempt::Committed(seeded),
                    },
                    Ok(durable) if durable == authorization_predecessor => {
                        drop(prepared);
                        auth::AuthTransactionAttempt::RolledBack(error)
                    }
                    Ok(_) | Err(_) => {
                        if let Some(prepared) = prepared {
                            prepared.finalize_ambiguous();
                        }
                        auth::AuthTransactionAttempt::CommitUncertain(error)
                    }
                }
            }
        }
    }

    pub(super) fn replay_versioned_seed_operation(
        &mut self,
        operation_id: &str,
        request_digest: &str,
    ) -> SnapbackResult<Option<crate::seed_identity::SeedInstallReceiptV1>> {
        let tx = self.conn.transaction()?;
        let current = crate::seed_identity::strict_current_data_version_stream(&tx)?;
        let replay = crate::seed_identity::replay_completed_operation(
            &tx,
            operation_id,
            request_digest,
            current.as_deref(),
        )?;
        tx.rollback()?;
        Ok(replay)
    }

    /// The versioned reset half of LLP 0109 rides the exact same durable
    /// transaction and commit-certainty machinery as every shipped reset.
    pub(super) fn attempt_versioned_seed_reset_with_authorization_stream(
        &mut self,
        request: crate::seed_identity::ResetSeedRequestV1,
        predecessor: &crate::contract_types::AuthorizationStreamIncarnation,
        successor: &crate::contract_types::AuthorizationStreamIncarnation,
    ) -> auth::AuthTransactionAttempt<(
        Option<MutationOutput>,
        crate::seed_identity::SeedInstallReceiptV1,
    )> {
        let _writer_token = match self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::ResetAndSeed)
        {
            Ok(token) => token,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        if let Err(error) = request.validate() {
            return auth::AuthTransactionAttempt::RolledBack(error);
        }
        let request_digest = match request.request_digest() {
            Ok(digest) => digest,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        let seed = request
            .artifact
            .as_ref()
            .map(crate::seed_identity::SeedArtifactV1::seed_data);
        let schema = self.schema.clone();
        let projections = self.projections.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = match self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(tx) => tx,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error.into()),
        };
        let authorization_predecessor = match auth_stream::read_authorization_version_on(&tx) {
            Ok(version) => version,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        if authorization_predecessor
            .as_ref()
            .map(|version| version.incarnation.as_str())
            != Some(predecessor.as_str())
        {
            return auth::AuthTransactionAttempt::RolledBack(SnapbackError::error(
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
                "auth",
                "reset coordinator predecessor does not match durable authorization state",
            ));
        }
        let (seeded, receipt) = match reset_and_seed_transaction(
            &tx,
            &schema,
            projections.as_ref(),
            &self.order_field_bounds,
            seed,
            successor,
            Some((&request, &request_digest)),
        ) {
            Ok((seeded, Some(receipt))) => (seeded, receipt),
            Ok((_seeded, None)) => unreachable!("versioned reset omitted receipt"),
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        let authorization = AuthorizationCommitWitness {
            version: AuthorizationVersion {
                incarnation: successor.as_str().to_owned(),
                epoch: 0,
            },
            event: true,
            incarnation_rotated: true,
            membership_declarations: Vec::new(),
        };
        let min_commit_version = seeded.as_ref().map_or(0, |output| output.version);
        let prepared = match prepare_authorization_commit_interlock(
            &authorization,
            AuthorizationCommitImpact::AllProtectedRooms,
            &authorization_interlock,
            &commit_authority_identity,
            authorization_predecessor.as_ref(),
        ) {
            Ok(prepared) => prepared,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        let committed = (seeded, receipt);
        #[cfg(any(test, feature = "test-support"))]
        if let Err(error) = BEFORE_RESET_COMMIT_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook()?;
            }
            Ok::<(), SnapbackError>(())
        }) {
            return auth::AuthTransactionAttempt::RolledBack(error);
        }
        match tx.commit() {
            Ok(()) => match prepared {
                Some(prepared) => match prepared.finalize_committed(min_commit_version) {
                    Ok(()) => auth::AuthTransactionAttempt::Committed(committed),
                    Err(error) => auth::AuthTransactionAttempt::CommitUncertain(error),
                },
                None => auth::AuthTransactionAttempt::Committed(committed),
            },
            Err(error) => {
                let error = SnapbackError::from(error);
                match auth_stream::read_authorization_version_snapshot(&self.conn) {
                    Ok(durable) if durable == Some(authorization.version.clone()) => match prepared
                    {
                        Some(prepared) => match prepared.finalize_committed(min_commit_version) {
                            Ok(()) => auth::AuthTransactionAttempt::Committed(committed),
                            Err(error) => auth::AuthTransactionAttempt::CommitUncertain(error),
                        },
                        None => auth::AuthTransactionAttempt::Committed(committed),
                    },
                    Ok(durable) if durable == authorization_predecessor => {
                        drop(prepared);
                        auth::AuthTransactionAttempt::RolledBack(error)
                    }
                    Ok(_) | Err(_) => {
                        if let Some(prepared) = prepared {
                            prepared.finalize_ambiguous();
                        }
                        auth::AuthTransactionAttempt::CommitUncertain(error)
                    }
                }
            }
        }
    }

    /// Authorization-aware compatibility seam for direct storage callers.
    /// Item 5's coordinated reset chooses and durably publishes the successor
    /// stream; the exact version read after that successful cut is its proof.
    pub(super) fn reset_and_seed_with_authorization(
        &mut self,
        seed: Option<SeedData>,
    ) -> SnapbackResult<ResetCommit> {
        self.reset_and_seed(seed)
    }

    /// Install or observe one generated v1 seed against the current app pair.
    /// Row effects, projection effects, identity, receipt, and idempotency
    /// evidence share this one SQLite writer transaction.
    ///
    /// @ref LLP 0109#165-executable-effect-accounting — application effects
    /// are bounded before the transaction can publish any byte.
    pub(super) fn ensure_versioned_seed(
        &mut self,
        request: crate::seed_identity::InstallSeedRequestV1,
    ) -> SnapbackResult<SeedEnsureCommit> {
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::StandaloneSeed)?;
        request.validate()?;
        validate_versioned_seed_request(
            &self.schema,
            request.requested_mode,
            Some(&request.artifact),
        )?;
        let request_digest = request.request_digest()?;
        let schema = self.schema.clone();
        let projections = self.projections.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        crate::seed_identity::create_infra(&tx)?;
        let current_stream = crate::seed_identity::strict_current_data_version_stream(&tx)?;

        if let Some(receipt) = crate::seed_identity::replay_completed_operation(
            &tx,
            &request.operation_id,
            &request_digest,
            current_stream.as_deref(),
        )? {
            if receipt.operation != crate::seed_identity::SeedOperationV1::Install {
                return Err(SnapbackError::error(
                    "SNAPBACK_SEED_OPERATION_ID_REUSED",
                    "seed",
                    "operation id belongs to another seed operation",
                ));
            }
            tx.rollback()?;
            return Ok(SeedEnsureCommit {
                output: crate::seed_identity::SeedEnsureResultV1::Installed { receipt },
                publication: None,
            });
        }

        if let Some(stream) = current_stream.as_deref()
            && let Some(active) = crate::seed_identity::active_installation(&tx, stream)?
        {
            if active.identity.app_id == request.artifact.app_id
                && active.identity.seed_version == request.artifact.seed_version
                && active.identity.seed_digest == request.artifact.seed_digest
            {
                tx.rollback()?;
                return Ok(SeedEnsureCommit {
                    output: crate::seed_identity::SeedEnsureResultV1::Matched {
                        observation: crate::seed_identity::SeedMatchedObservationV1 {
                            format_version:
                                crate::seed_identity::SEED_MATCHED_OBSERVATION_FORMAT_V1.to_owned(),
                            outcome: "matched".to_owned(),
                            active: active.identity,
                            establishing_receipt: active.receipt,
                        },
                    },
                    publication: None,
                });
            }
            let code = if active.identity.app_id == request.artifact.app_id
                && active.identity.seed_version == request.artifact.seed_version
            {
                "SNAPBACK_SEED_VERSION_REUSED"
            } else {
                "SNAPBACK_SEED_MIGRATION_REQUIRED"
            };
            return Err(SnapbackError::error(
                code,
                "seed",
                "another versioned seed identity is active in the current data stream",
            ));
        }

        let occupancy = versioned_seed_target_occupancy(&tx, &schema, &request.artifact)?;
        if occupancy.iter().any(|occupied| *occupied) {
            let code = if occupancy.iter().all(|occupied| *occupied) {
                "SNAPBACK_SEED_NONEMPTY_UNTRACKED"
            } else {
                "SNAPBACK_SEED_PARTIAL_UNTRACKED"
            };
            return Err(SnapbackError::error(
                code,
                "seed",
                "seed targets contain application rows without active versioned \
                 identity; recover with the versioned reset-install \
                 (POST /_snapback/api/app/seed/reset-install-v1) or start from \
                 a fresh database — a raw app reset with an inline seed \
                 produces exactly this state",
            ));
        }

        let predecessor_stream = current_stream.clone();
        let stream = match current_stream {
            Some(stream) => stream,
            None => auth_invalidation::ensure_data_version_stream_in(&tx)?,
        };
        let current_version = current_version_on(&tx)?;
        let next_version = next_storage_version(current_version)?;
        let touched = request.artifact.tables.keys().cloned().collect();
        validate_touched_managed_tables(&tx, &schema, &touched, current_version)?;
        preflight_membership_activation_sources(&tx, &schema, current_version)?;
        // @ref LLP 0109#17-dated-amendment-seed-asset-fixtures-2026-07-31 —
        //   fixtures finalize strictly before rows install: placeholders
        //   resolve through the ingestion mapping inside this transaction,
        //   and any missing or stale mapping refuses the whole ensure with
        //   zero row effects.
        let seed_data = crate::assets::resolve_seed_fixture_placeholders(
            &tx,
            &schema,
            &request.artifact.tables,
            request.asset_fixtures.as_ref(),
        )?;
        let mut changes = seed_into_transaction(
            &tx,
            &schema,
            seed_data,
            next_version,
            &self.order_field_bounds,
        )?;
        let direct_application_rows = changes.len();
        if !projections.is_empty() {
            maintain_projections_in_tx(
                &tx,
                &schema,
                projections.as_ref(),
                &mut changes,
                &BTreeMap::new(),
                next_version,
                now_millis(),
                &self.order_field_bounds,
                ProjectionEffectCeiling::VersionedSeedV1,
            )?;
        }
        let derived_projection_rows = changes.len().saturating_sub(direct_application_rows);
        let total_application_effects = crate::seed_identity::checked_application_effects(
            direct_application_rows,
            derived_projection_rows,
        )?;
        maintain_derived_indexes_in_tx(&tx, &schema, &changes, next_version)?;
        validate_membership_activation(&tx, &schema, next_version)?;
        if !changes.is_empty() {
            set_version(&tx, next_version)?;
        }
        let receipt = crate::seed_identity::SeedInstallReceiptV1 {
            format_version: crate::seed_identity::SEED_RECEIPT_FORMAT_V1.to_owned(),
            operation_id: request.operation_id.clone(),
            request_digest,
            operation: crate::seed_identity::SeedOperationV1::Install,
            outcome: crate::seed_identity::SeedOutcomeV1::Installed,
            app_id: request.artifact.app_id.clone(),
            seed_version: Some(request.artifact.seed_version.clone()),
            seed_digest: Some(request.artifact.seed_digest.clone()),
            schema_hash: required_versioned_seed_schema_hash(&schema)?,
            data_version_stream: stream,
            direct_application_rows,
            derived_projection_rows,
            total_application_effects,
            reset_deleted_rows: 0,
        };
        crate::seed_identity::store_installation(&tx, &request.artifact, &receipt)?;
        crate::seed_identity::store_completed_operation(
            &tx,
            predecessor_stream.as_deref(),
            &receipt,
        )?;
        crate::seed_identity::best_effort_prune_history(&tx, &receipt.data_version_stream);
        let authorization_predecessor = auth_stream::read_authorization_version_on(&tx)?;
        let authorization = authorization::authorization_commit_hook_in(
            &tx,
            authorization::AuthorizationCommitCause::AppWrites {
                schema: &schema,
                changes: &changes,
            },
        )?;
        let version = if changes.is_empty() {
            current_version
        } else {
            next_version
        };
        commit_with_authorization_interlock(
            tx,
            &authorization,
            AuthorizationCommitImpact::AppWrites {
                schema: &schema,
                changes: &changes,
            },
            authorization_predecessor,
            version,
            authorization_interlock,
            &commit_authority_identity,
        )?;
        Ok(SeedEnsureCommit {
            output: crate::seed_identity::SeedEnsureResultV1::Installed { receipt },
            publication: Some(SeedCommitPublication {
                version,
                authorization,
            }),
        })
    }

    /// Read-only classification for the v1 seed family. This uses a deferred
    /// transaction and rolls it back without creating stream metadata.
    pub(super) fn preview_versioned_seed(
        &mut self,
        request: crate::seed_identity::SeedPreviewRequestV1,
    ) -> SnapbackResult<crate::seed_identity::SeedPreviewResultV1> {
        request.validate()?;
        validate_versioned_seed_request(
            &self.schema,
            request.requested_mode,
            request.artifact.as_ref(),
        )?;
        let schema = self.schema.clone();
        let tx = self.conn.transaction()?;
        let stream = crate::seed_identity::strict_current_data_version_stream(&tx)?;
        let active = match stream.as_deref() {
            Some(stream) => crate::seed_identity::active_installation(&tx, stream)?,
            None => None,
        };
        let direct = request
            .artifact
            .as_ref()
            .map(crate::seed_identity::SeedArtifactV1::row_count)
            .transpose()?
            .unwrap_or(0);
        let reset_deleted_rows = if matches!(
            request.operation,
            crate::seed_identity::SeedPreviewOperationV1::ResetInstall
                | crate::seed_identity::SeedPreviewOperationV1::Clear
        ) {
            count_physical_application_rows(&tx)?
        } else {
            0
        };
        let mut state = "installable".to_owned();
        let mut diagnostic_code = None;
        if matches!(
            request.operation,
            crate::seed_identity::SeedPreviewOperationV1::Install
        ) {
            match (&active, request.artifact.as_ref()) {
                (Some(active), Some(artifact))
                    if active.identity.app_id == artifact.app_id
                        && active.identity.seed_version == artifact.seed_version
                        && active.identity.seed_digest == artifact.seed_digest =>
                {
                    state = "matched".to_owned();
                }
                (Some(active), Some(artifact))
                    if active.identity.app_id == artifact.app_id
                        && active.identity.seed_version == artifact.seed_version =>
                {
                    state = "refused".to_owned();
                    diagnostic_code = Some("SNAPBACK_SEED_VERSION_REUSED".to_owned());
                }
                (Some(_), Some(_)) => {
                    state = "refused".to_owned();
                    diagnostic_code = Some("SNAPBACK_SEED_MIGRATION_REQUIRED".to_owned());
                }
                (None, Some(artifact)) => {
                    let occupancy = versioned_seed_target_occupancy(&tx, &schema, artifact)?;
                    if occupancy.iter().any(|occupied| *occupied) {
                        state = "refused".to_owned();
                        diagnostic_code = Some(
                            if occupancy.iter().all(|occupied| *occupied) {
                                "SNAPBACK_SEED_NONEMPTY_UNTRACKED"
                            } else {
                                "SNAPBACK_SEED_PARTIAL_UNTRACKED"
                            }
                            .to_owned(),
                        );
                    }
                }
                _ => unreachable!("preview validation closed operation/artifact combinations"),
            }
        } else if let Some(expected) = request.expected_data_version_stream.as_ref()
            && !crate::seed_identity::expected_stream_matches(expected, stream.as_deref())
        {
            state = "refused".to_owned();
            diagnostic_code = Some("SNAPBACK_SEED_OPERATION_HISTORICAL".to_owned());
        } else {
            state = match request.operation {
                crate::seed_identity::SeedPreviewOperationV1::ResetInstall => {
                    "reset-installable".to_owned()
                }
                crate::seed_identity::SeedPreviewOperationV1::Clear => "clearable".to_owned(),
                crate::seed_identity::SeedPreviewOperationV1::Install => unreachable!(),
            };
        }
        let current = active.as_ref().map(|active| active.identity.clone());
        tx.rollback()?;
        let mut derived = if state == "matched" {
            active
                .as_ref()
                .map_or(0, |active| active.identity.derived_projection_rows)
        } else {
            0
        };
        let reset_first = matches!(
            request.operation,
            crate::seed_identity::SeedPreviewOperationV1::ResetInstall
        );
        if let Some(artifact) = request.artifact.as_ref()
            && (reset_first || state == "installable")
        {
            derived = simulate_versioned_seed_projection_rows(
                self,
                &schema,
                self.projections.as_ref(),
                artifact,
                reset_first,
            )?;
        }
        let total = direct.checked_add(derived).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED",
                "seed",
                "versioned seed application-effect count overflowed",
            )
        })?;
        if total > crate::seed_identity::VERSIONED_SEED_MAX_EFFECTS_V1 {
            state = "refused".to_owned();
            diagnostic_code = Some("SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED".to_owned());
        }
        let requested = request.artifact.as_ref().and_then(|artifact| {
            stream
                .as_ref()
                .map(|stream| preview_identity(artifact, stream, &schema, direct, derived))
        });
        Ok(crate::seed_identity::SeedPreviewResultV1 {
            state,
            diagnostic_code,
            current,
            requested,
            direct_application_rows: direct,
            derived_projection_rows: derived,
            total_application_effects: total,
            reset_deleted_rows,
        })
    }

    pub(super) fn preview_seed_changes(
        &mut self,
        seed: SeedData,
    ) -> SnapbackResult<Vec<ChangedRow>> {
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::DryRun)?;
        let schema = self.schema.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current_version = current_version_on(&tx)?;
        let next_version = next_storage_version(current_version)?;
        let touched = seed.tables.keys().cloned().collect();
        validate_touched_managed_tables(&tx, &schema, &touched, current_version)?;
        preflight_membership_activation_sources(&tx, &schema, current_version)?;
        let changes =
            seed_into_transaction(&tx, &schema, seed, next_version, &self.order_field_bounds)?;
        maintain_derived_indexes_in_tx(&tx, &schema, &changes, next_version)?;
        validate_membership_activation(&tx, &schema, next_version)?;
        tx.rollback()?;
        Ok(changes)
    }

    /// Kernel-internal convenience for fixtures and migration simulations.
    /// It retains the same witness-bearing carrier as the public adapter so a
    /// new internal caller cannot recreate an output-only commit seam.
    pub(super) fn seed(&mut self, seed: SeedData) -> SnapbackResult<SeedCommit> {
        self.seed_with_authorization(seed)
    }

    pub(super) fn seed_with_authorization(&mut self, seed: SeedData) -> SnapbackResult<SeedCommit> {
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::StandaloneSeed)?;
        let schema = self.schema.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // @ref LLP 0007#commit-version-graduation-dk-2-decided-2026-07-02 — SQLite's writer
        // reservation is the local target's version-allocation fence.
        let current_version = current_version_on(&tx)?;
        let next_version = next_storage_version(current_version)?;
        let touched = seed.tables.keys().cloned().collect();
        validate_touched_managed_tables(&tx, &schema, &touched, current_version)?;
        preflight_membership_activation_sources(&tx, &schema, current_version)?;
        let changes =
            seed_into_transaction(&tx, &schema, seed, next_version, &self.order_field_bounds)?;
        // The standalone seed API has the same invariant obligations as a
        // deployment seed; it cannot bypass membership activation checks just
        // because DDL was already active.
        validate_membership_activation(&tx, &schema, next_version)?;
        let changed_count = changes.len();

        if changed_count > 0 {
            maintain_derived_indexes_in_tx(&tx, &schema, &changes, next_version)?;
            set_version(&tx, next_version)?;
        }
        let authorization_predecessor = auth_stream::read_authorization_version_on(&tx)?;
        let authorization = authorization::authorization_commit_hook_in(
            &tx,
            authorization::AuthorizationCommitCause::AppWrites {
                schema: &schema,
                changes: &changes,
            },
        )?;
        let version = if changed_count > 0 {
            next_version
        } else {
            current_version
        };
        commit_with_authorization_interlock(
            tx,
            &authorization,
            AuthorizationCommitImpact::AppWrites {
                schema: &schema,
                changes: &changes,
            },
            authorization_predecessor,
            version,
            authorization_interlock,
            &commit_authority_identity,
        )?;

        Ok(SeedCommit {
            output: MutationOutput {
                version,
                changed_count,
                result: Value::Null,
                authority_transitions: Vec::new(),
                ctx_ledger: None,
                settlement_mint_observations: Vec::new(),
                settlement_time_observation: None,
                settlement_sequence_allocations: Vec::new(),
            },
            authorization,
        })
    }
}

/// Narrow typed access to schema application, seeding, and destructive reset.
///
/// @ref LLP 0225#1-ownership-map — callers enter the storage kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct SchemaSeedKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> SchemaSeedKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        self.db.apply_schema(manifest)
    }

    pub fn reset(&mut self) -> SnapbackResult<ResetCommit> {
        self.db.reset_and_seed_with_authorization(None)
    }

    pub fn reset_and_seed(&mut self, seed: Option<SeedData>) -> SnapbackResult<ResetCommit> {
        self.db.reset_and_seed_with_authorization(seed)
    }

    pub fn attempt_reset_and_seed_with_authorization_stream(
        &mut self,
        seed: Option<SeedData>,
        predecessor: &crate::contract_types::AuthorizationStreamIncarnation,
        successor: &crate::contract_types::AuthorizationStreamIncarnation,
    ) -> auth::AuthTransactionAttempt<Option<MutationOutput>> {
        self.db
            .attempt_reset_and_seed_with_authorization_stream(seed, predecessor, successor)
    }

    pub fn replay_versioned_seed_operation(
        &mut self,
        operation_id: &str,
        request_digest: &str,
    ) -> SnapbackResult<Option<crate::seed_identity::SeedInstallReceiptV1>> {
        self.db
            .replay_versioned_seed_operation(operation_id, request_digest)
    }

    pub fn attempt_versioned_seed_reset_with_authorization_stream(
        &mut self,
        request: crate::seed_identity::ResetSeedRequestV1,
        predecessor: &crate::contract_types::AuthorizationStreamIncarnation,
        successor: &crate::contract_types::AuthorizationStreamIncarnation,
    ) -> auth::AuthTransactionAttempt<(
        Option<MutationOutput>,
        crate::seed_identity::SeedInstallReceiptV1,
    )> {
        self.db
            .attempt_versioned_seed_reset_with_authorization_stream(request, predecessor, successor)
    }

    pub fn reset_and_seed_with_authorization(
        &mut self,
        seed: Option<SeedData>,
    ) -> SnapbackResult<ResetCommit> {
        self.db.reset_and_seed_with_authorization(seed)
    }

    pub fn ensure_versioned_seed(
        &mut self,
        request: crate::seed_identity::InstallSeedRequestV1,
    ) -> SnapbackResult<SeedEnsureCommit> {
        self.db.ensure_versioned_seed(request)
    }

    pub fn preview_versioned_seed(
        &mut self,
        request: crate::seed_identity::SeedPreviewRequestV1,
    ) -> SnapbackResult<crate::seed_identity::SeedPreviewResultV1> {
        self.db.preview_versioned_seed(request)
    }

    pub fn active_seed_identity(
        &mut self,
    ) -> SnapbackResult<Option<crate::seed_identity::ActiveSeedIdentityV1>> {
        let tx = self.db.conn.transaction()?;
        let current = crate::seed_identity::strict_current_data_version_stream(&tx)?;
        let identity = match current {
            None => None,
            Some(stream) => match crate::seed_identity::active_identity(&tx, &stream)? {
                crate::seed_identity::ActiveSeedStateV1::Absent => None,
                crate::seed_identity::ActiveSeedStateV1::Installed(identity) => Some(identity),
            },
        };
        tx.rollback()?;
        Ok(identity)
    }

    pub fn seed(&mut self, seed: SeedData) -> SnapbackResult<SeedCommit> {
        self.db.seed_with_authorization(seed)
    }

    pub fn preview_seed_changes(&mut self, seed: SeedData) -> SnapbackResult<Vec<ChangedRow>> {
        self.db.preview_seed_changes(seed)
    }

    pub fn seed_with_authorization(&mut self, seed: SeedData) -> SnapbackResult<SeedCommit> {
        self.db.seed_with_authorization(seed)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn validate_versioned_seed_request(
        schema: &SchemaManifest,
        requested_mode: AuthMode,
        artifact: Option<&crate::seed_identity::SeedArtifactV1>,
    ) -> SnapbackResult<()> {
        validate_versioned_seed_request(schema, requested_mode, artifact)
    }
}
