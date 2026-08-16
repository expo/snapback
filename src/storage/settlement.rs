use super::*;

impl LocalDatabase {
    /// Durably upsert host-owned `StreamAttemptV1` rows. The write-ahead
    /// pre-mark contract requires the row to be committed BEFORE the upstream
    /// request bytes leave the process; callers hold the instance lock for
    /// exactly this short write.
    // @ref LLP 0076#author-decisions--2026-07-23 — decision 2: the certainty
    //   column persists on the host-owned attempt record, not the authored
    //   progress row.
    pub(super) fn upsert_stream_attempts(
        &mut self,
        rows: &[(String, String, String)],
        now_ms: u64,
    ) -> SnapbackResult<()> {
        for (token, client_key, record_json) in rows {
            self.conn.execute(
                "INSERT INTO _snapback_stream_attempts(token, client_key, record_json, updated_at_ms)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(token) DO UPDATE SET record_json = ?3, updated_at_ms = ?4",
                params![token, client_key, record_json, now_ms as i64],
            )?;
        }
        Ok(())
    }

    pub(super) fn stream_attempt_by_client_key(
        &self,
        client_key: &str,
    ) -> SnapbackResult<Option<(String, String)>> {
        let mut statement = self.conn.prepare(
            "SELECT token, record_json FROM _snapback_stream_attempts WHERE client_key = ?1",
        )?;
        let mut rows = statement.query(params![client_key])?;
        match rows.next()? {
            Some(row) => Ok(Some((row.get(0)?, row.get(1)?))),
            None => Ok(None),
        }
    }

    pub(super) fn load_stream_attempts(&self) -> SnapbackResult<Vec<(String, String, String)>> {
        let mut statement = self
            .conn
            .prepare("SELECT token, client_key, record_json FROM _snapback_stream_attempts")?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub(super) fn client_mutation_retention_info(
        &self,
    ) -> SnapbackResult<ClientMutationRetentionInfo> {
        let (records, bytes) = client_mutation_retention_counters(&self.conn)?;
        let gc_total = optional_meta_u64(&self.conn, META_CLIENT_MUTATION_GC_TOTAL)?.unwrap_or(0);
        Ok(ClientMutationRetentionInfo {
            records,
            bytes,
            gc_total,
            max_records: CLIENT_MUTATION_MAX_RECORDS,
            max_bytes: CLIENT_MUTATION_MAX_BYTES,
            max_result_bytes: CLIENT_MUTATION_MAX_RESULT_BYTES,
        })
    }

    /// Reclaim full settlement payloads only after the client has durably
    /// removed those ids from its replay queue. The auth fingerprint prevents
    /// one authority from acknowledging another user's opaque ids.
    pub(super) fn acknowledge_client_mutations(
        &mut self,
        auth_fingerprint: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.acknowledge_client_mutations_inner(auth_fingerprint, None, ids)
    }

    pub(super) fn acknowledge_client_mutations_for_authority(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.acknowledge_client_mutations_inner(auth_fingerprint, Some(authority_instance_id), ids)
    }

    pub(super) fn issue_client_operation_identity_range(
        &mut self,
        audience: &str,
        authority_instance_id: &str,
        previous: Option<&crate::commit_envelope::ClientIdentityRangeV1>,
        issued_at_ms: u64,
    ) -> SnapbackResult<crate::commit_envelope::ClientIdentityRangeV1> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stream_id =
            crate::seed_identity::strict_current_data_version_stream(&tx)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
                    "storage",
                    "operation identity range issuance requires an initialized data-version stream",
                )
            })?;
        let range = crate::operation_ledger::issue_client_range_in(
            &tx,
            &stream_id,
            audience,
            authority_instance_id,
            previous,
            issued_at_ms,
        )?;
        tx.commit()?;
        Ok(range)
    }

    pub(super) fn host_operation_issuance(
        &mut self,
        authority_instance_id: &str,
        upstream_identity: &str,
        commit_ordinal: u64,
        issued_at_ms: u64,
    ) -> SnapbackResult<crate::commit_envelope::OperationIssuanceV1> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stream_id =
            crate::seed_identity::strict_current_data_version_stream(&tx)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
                    "storage",
                    "host operation identity requires an initialized data-version stream",
                )
            })?;
        let incarnation = crate::operation_ledger::ensure_host_incarnation_in(
            &tx,
            &stream_id,
            authority_instance_id,
            issued_at_ms,
        )?;
        tx.commit()?;
        Ok(
            crate::commit_envelope::OperationIssuanceV1::HostIncarnation {
                epoch_id: incarnation.epoch_id,
                upstream_identity: upstream_identity.to_owned(),
                commit_ordinal,
                authority_authenticator_digest: incarnation.authority_authenticator_digest,
            },
        )
    }

    #[cfg(test)]
    pub(super) fn operation_envelopes_for_test(
        &self,
    ) -> SnapbackResult<Vec<crate::commit_envelope::CommitEnvelopeV1>> {
        let mut statement = self.conn.prepare(
            "SELECT envelope_json FROM _snapback_commit_envelopes_v1
             ORDER BY recorded_at_ms, operation_id",
        )?;
        let encoded = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        encoded
            .into_iter()
            .map(|value| {
                serde_json::from_str(&value).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_OPERATION_LEDGER_INVALID",
                        "storage",
                        "retained test envelope could not be decoded",
                    )
                })
            })
            .collect()
    }

    pub(super) fn explain_operation(
        &self,
        identity: &crate::commit_envelope::OperationIdentityV1,
        authority: &crate::operation_ledger::CurrentExplanationAuthorityV1,
    ) -> SnapbackResult<Option<crate::commit_envelope::OperationExplanationV1>> {
        crate::operation_ledger::explain_operation(&self.conn, identity, authority)
            .map(|explanation| explanation.map(|explanation| explanation.into_public()))
    }

    fn acknowledge_client_mutations_inner(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: Option<&str>,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        if ids.len() > CLIENT_MUTATION_ACK_MAX_IDS {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED",
                "sync",
                format!(
                    "one request may acknowledge at most {CLIENT_MUTATION_ACK_MAX_IDS} client mutations"
                ),
            ));
        }
        let unique = ids.iter().collect::<BTreeSet<_>>();
        for id in &unique {
            if !replay_opaque_id_is_valid(id) {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
                    "sync",
                    "acknowledged client mutation id is invalid",
                ));
            }
        }
        if unique.is_empty() {
            return Ok(0);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (retained_records, retained_bytes) = client_mutation_retention_counters(&tx)?;
        let (auth_records, auth_bytes) =
            client_mutation_auth_retention_counters(&tx, auth_fingerprint)?;
        let mut deleted = 0_u64;
        let mut deleted_bytes = 0_u64;
        for id in unique {
            let retained_row = tx
                .query_row(
                    "SELECT client_mutation_id, function, auth_fingerprint,
                            authority_instance_id, input_fingerprint,
                            operation_issuance_json, output_json, settlement_format,
                            settlement_record_sequence, settlement_projection_seal_json
                     FROM _snapback_client_mutations
                     WHERE client_mutation_id = ?1 AND auth_fingerprint = ?2
                       AND (?3 IS NULL OR authority_instance_id = ?3)",
                    params![id, auth_fingerprint, authority_instance_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, Option<String>>(7)?,
                            row.get::<_, SqlValue>(8)?,
                            row.get::<_, Option<String>>(9)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                row_id,
                function,
                row_auth_fingerprint,
                row_authority_instance_id,
                input_fingerprint,
                operation_issuance_json,
                output_json,
                settlement_format,
                settlement_record_sequence,
                settlement_projection_seal_json,
            )) = retained_row
            else {
                continue;
            };
            let row_bytes = logical_client_mutation_retained_row_bytes_v4(
                &row_id,
                &function,
                &row_auth_fingerprint,
                row_authority_instance_id.as_deref(),
                &input_fingerprint,
                operation_issuance_json.as_deref(),
                &output_json,
                settlement_format.as_deref(),
                settlement_record_sequence,
                settlement_projection_seal_json.as_deref(),
            )?;
            crate::operation_ledger::acknowledge_client_operation_by_id_in(
                &tx,
                id,
                auth_fingerprint,
                authority_instance_id,
                now_millis(),
            )?;
            let removed = tx.execute(
                "DELETE FROM _snapback_client_mutations
                 WHERE client_mutation_id = ?1 AND auth_fingerprint = ?2
                   AND (?3 IS NULL OR authority_instance_id = ?3)",
                params![id, auth_fingerprint, authority_instance_id],
            )? as u64;
            deleted = deleted.saturating_add(removed);
            if removed > 0 {
                deleted_bytes = deleted_bytes.checked_add(row_bytes).ok_or_else(|| {
                    invalid_client_mutation_retention_state(
                        "acknowledged client-mutation byte count overflowed",
                    )
                })?;
            }
        }
        if deleted > 0 {
            let records = retained_records.checked_sub(deleted).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the retained record counter",
                )
            })?;
            let bytes = retained_bytes.checked_sub(deleted_bytes).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the retained byte counter",
                )
            })?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_RECORDS, records)?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_BYTES, bytes)?;
            let auth_records = auth_records.checked_sub(deleted).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the auth record counter",
                )
            })?;
            let auth_bytes = auth_bytes.checked_sub(deleted_bytes).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the auth byte counter",
                )
            })?;
            save_client_mutation_auth_retention_counters(
                &tx,
                auth_fingerprint,
                auth_records,
                auth_bytes,
            )?;
            let gc_total = optional_meta_u64(&tx, META_CLIENT_MUTATION_GC_TOTAL)?
                .unwrap_or(0)
                .checked_add(deleted)
                .ok_or_else(|| {
                    invalid_client_mutation_retention_state(
                        "client-mutation acknowledgement total overflowed",
                    )
                })?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_GC_TOTAL, gc_total)?;
        }
        tx.commit()?;
        Ok(deleted)
    }

    /// Administrative recovery for a client that can no longer send durable
    /// acknowledgements. Purging deliberately gives up full-result replay for
    /// removed settlements; covered operations retain compact duplicate
    /// prevention while predecessor-only rows retain the legacy tradeoff.
    /// Callers must gate this as an admin write. Ledger rows, purge audit, and
    /// global/per-auth counters change in one transaction.
    pub(super) fn purge_client_mutation_settlements(
        &mut self,
        auth_fingerprint: Option<&str>,
    ) -> SnapbackResult<u64> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (retained_records, retained_bytes) = client_mutation_retention_counters(&tx)?;
        let scanned_global = scan_client_mutation_retention_totals(&tx)?;
        if scanned_global != (retained_records, retained_bytes) {
            return Err(invalid_client_mutation_retention_state(
                "authority-wide collection found stale global retention counters",
            ));
        }
        let deleted = match auth_fingerprint {
            Some(auth_fingerprint) => {
                let (auth_records, auth_bytes) =
                    client_mutation_auth_retention_counters(&tx, auth_fingerprint)?;
                let scanned_auth =
                    scan_client_mutation_retention_totals_for_auth(&tx, Some(auth_fingerprint))?;
                if scanned_auth != (auth_records, auth_bytes) {
                    return Err(invalid_client_mutation_retention_state(
                        "authority-wide collection found stale authority retention counters",
                    ));
                }
                let settlements = tx
                    .prepare(
                        "SELECT client_mutation_id,auth_fingerprint,authority_instance_id
                           FROM _snapback_client_mutations
                          WHERE auth_fingerprint=?1 ORDER BY client_mutation_id",
                    )?
                    .query_map(params![auth_fingerprint], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })?
                    .collect::<rusqlite::Result<Vec<(String, String, Option<String>)>>>()?;
                let selector_digest = crate::operation_ledger::digest_fact_set(
                    b"snapback:operation-purge-selector:v1\n",
                    &json!({ "authFingerprint": auth_fingerprint }),
                );
                crate::operation_ledger::operator_purge_client_operations_in(
                    &tx,
                    "auth",
                    &selector_digest,
                    &settlements,
                    now_millis(),
                )?;
                let deleted = tx.execute(
                    "DELETE FROM _snapback_client_mutations WHERE auth_fingerprint = ?1",
                    params![auth_fingerprint],
                )? as u64;
                if deleted != auth_records {
                    return Err(invalid_client_mutation_retention_state(
                        "auth purge row count did not match its retention counter",
                    ));
                }
                save_meta_u64(
                    &tx,
                    META_CLIENT_MUTATION_RECORDS,
                    retained_records.checked_sub(auth_records).ok_or_else(|| {
                        invalid_client_mutation_retention_state(
                            "auth purge would underflow the global record counter",
                        )
                    })?,
                )?;
                save_meta_u64(
                    &tx,
                    META_CLIENT_MUTATION_BYTES,
                    retained_bytes.checked_sub(auth_bytes).ok_or_else(|| {
                        invalid_client_mutation_retention_state(
                            "auth purge would underflow the global byte counter",
                        )
                    })?,
                )?;
                save_client_mutation_auth_retention_counters(&tx, auth_fingerprint, 0, 0)?;
                deleted
            }
            None => {
                let settlements = tx
                    .prepare(
                        "SELECT client_mutation_id,auth_fingerprint,authority_instance_id
                           FROM _snapback_client_mutations ORDER BY client_mutation_id",
                    )?
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                    .collect::<rusqlite::Result<Vec<(String, String, Option<String>)>>>()?;
                let selector_digest = crate::operation_ledger::digest_fact_set(
                    b"snapback:operation-purge-selector:v1\n",
                    &json!({ "all": true }),
                );
                crate::operation_ledger::operator_purge_client_operations_in(
                    &tx,
                    "all",
                    &selector_digest,
                    &settlements,
                    now_millis(),
                )?;
                let deleted = tx.execute("DELETE FROM _snapback_client_mutations", [])? as u64;
                if deleted != retained_records {
                    return Err(invalid_client_mutation_retention_state(
                        "global purge row count did not match its retention counter",
                    ));
                }
                tx.execute("DELETE FROM _snapback_client_mutation_auth_retention", [])?;
                save_meta_u64(&tx, META_CLIENT_MUTATION_RECORDS, 0)?;
                save_meta_u64(&tx, META_CLIENT_MUTATION_BYTES, 0)?;
                deleted
            }
        };
        tx.commit()?;
        Ok(deleted)
    }

    /// Return the durably settled result for a client mutation identity.
    /// Function/auth mismatches fail closed instead of treating the key as a
    /// cache hit under different authority.
    pub(super) fn client_mutation_result(
        &self,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<Option<MutationOutput>> {
        validate_client_mutation_identity(identity)?;
        with_pinned_read_snapshot(&self.conn, |conn| {
            let row: Option<RetainedClientMutationRow> = conn
                .query_row(
                    "SELECT function, auth_fingerprint, authority_instance_id,
                        input_fingerprint, operation_issuance_json, output_json,
                        settled_version, settled_version_exact, settlement_format,
                        settlement_record_sequence, settlement_projection_seal_json
                 FROM _snapback_client_mutations WHERE client_mutation_id = ?1",
                    params![identity.id],
                    |row| {
                        Ok(RetainedClientMutationRow {
                            function: row.get(0)?,
                            auth_fingerprint: row.get(1)?,
                            authority_instance_id: row.get(2)?,
                            input_fingerprint: row.get(3)?,
                            operation_issuance_json: row.get(4)?,
                            output_json: row.get(5)?,
                            settled_version: row.get(6)?,
                            settled_version_exact: row.get(7)?,
                            settlement_format: row.get(8)?,
                            settlement_record_sequence: row.get(9)?,
                            settlement_projection_seal_json: row.get(10)?,
                        })
                    },
                )
                .optional()?;
            let Some(RetainedClientMutationRow {
                function,
                auth_fingerprint: retained_auth,
                authority_instance_id: retained_authority,
                input_fingerprint: retained_input,
                operation_issuance_json: retained_issuance,
                output_json,
                settled_version,
                settled_version_exact: exact_settled_version,
                settlement_format,
                settlement_record_sequence,
                settlement_projection_seal_json,
            }) = row
            else {
                return covered_operation_recovery_result(conn, identity);
            };
            if function != identity.function {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                    "sync",
                    "client mutation id was already used for another function",
                )
                .with_details(json!({
                    "clientMutationId": identity.id,
                    "expectedFunction": function,
                    "actualFunction": identity.function,
                })));
            }
            if retained_auth != identity.auth_fingerprint {
                if retained_auth.starts_with("fnv1a:") {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
                        "auth",
                        "client mutation uses a legacy auth fingerprint that cannot be rebound safely; acknowledge the consumed result or use the admin purge recovery path",
                    )
                    .with_details(json!({ "clientMutationId": identity.id })));
                }
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_STALE_RESULT",
                    "auth",
                    "client mutation was recorded under another auth context",
                )
                .with_details(json!({ "clientMutationId": identity.id })));
            }
            let Some(retained_authority) = retained_authority else {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
                    "auth",
                    "client mutation predates authority descriptors and cannot be rebound safely; acknowledge the consumed result or use the admin purge recovery path",
                )
                .with_details(json!({ "clientMutationId": identity.id })));
            };
            if retained_authority != identity.authority_instance_id {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_STALE_RESULT",
                    "auth",
                    "client mutation was settled under another authority instance; discard it or explicitly re-record it under the current authority",
                )
                .with_details(json!({
                    "clientMutationId": identity.id,
                    "reason": "authority_instance_mismatch",
                    "guidance": "discard_or_rerecord",
                    "automaticRetry": false,
                })));
            }
            if retained_input != identity.input_fingerprint {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                    "sync",
                    "client mutation id was already used with another mutation payload",
                )
                .with_details(json!({
                    "clientMutationId": identity.id,
                    "reason": "input_fingerprint_mismatch",
                })));
            }
            let proposed_issuance = identity
                .operation_issuance
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|_| {
                    invalid_client_mutation_retention_state(
                        "proposed operation issuance could not be encoded",
                    )
                })?;
            if retained_issuance != proposed_issuance {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                    "sync",
                    "client mutation id was reused with different operation issuance facts",
                )
                .with_details(json!({ "clientMutationId": identity.id })));
            }
            // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
            // — format/watermark and media seal verification precede every
            // broad MutationOutput/version check and never consult current
            // asset metadata or the active bundle.
            let output_value = verify_retained_settlement_carrier_v1(
                conn,
                identity,
                settlement_format.as_deref(),
                settlement_record_sequence,
                settlement_projection_seal_json.as_deref(),
                &output_json,
            )?;
            let head = current_version_on(conn)?;
            let output_version = decode_json_storage_version(
                output_value.get("version"),
                "stored client mutation result version",
            )
            .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
            let settled_version = decode_required_storage_version(
                settled_version,
                "stored client mutation settlement version",
            )
            .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
            let exact_settled_version = decode_optional_storage_version(
                exact_settled_version,
                "stored client mutation exact settlement version",
            )
            .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
            validate_storage_version_at_most(
                output_version,
                head,
                "stored client mutation result version",
            )
            .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
            validate_storage_version_at_most(
                settled_version,
                head,
                "stored client mutation settlement version",
            )
            .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
            if let Some(exact_settled_version) = exact_settled_version {
                validate_storage_version_at_most(
                    exact_settled_version,
                    head,
                    "stored client mutation exact settlement version",
                )
                .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
                if exact_settled_version != settled_version
                    || exact_settled_version != output_version
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_STORAGE_VERSION_CORRUPT",
                        "storage",
                        "stored client mutation result disagrees with its authoritative settlement version",
                    )
                    .with_detail("clientMutationId", identity.id.clone())
                    .with_detail("settledVersion", settled_version)
                    .with_detail("exactSettledVersion", exact_settled_version)
                    .with_detail("outputVersion", output_version));
                }
            } else if settled_version != 0 && settled_version != output_version {
                // Rows written before exact settlement metadata use zero as the
                // migration sentinel. A nullable authoritative column preserves
                // those rows without letting a newly written version-zero result
                // inherit the same ambiguity.
                return Err(SnapbackError::error(
                    "SNAPBACK_STORAGE_VERSION_CORRUPT",
                    "storage",
                    "stored client mutation result disagrees with its settlement version",
                )
                .with_detail("clientMutationId", identity.id.clone())
                .with_detail("settledVersion", settled_version)
                .with_detail("outputVersion", output_version));
            }
            let output: MutationOutput = serde_json::from_value(output_value).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
                    "storage",
                    "stored client mutation result could not be decoded",
                )
                .with_details(json!({
                    "clientMutationId": identity.id,
                    "error": error.to_string(),
                }))
            })?;
            validate_retained_sequence_allocations(&output.settlement_sequence_allocations)
                .map_err(|error| error.with_detail("clientMutationId", identity.id.clone()))?;
            debug_assert_eq!(output.version, output_version);
            Ok(Some(output))
        })
    }
}

/// Narrow typed access to client-mutation settlement, operation identity, and
/// stream-attempt persistence operations.
///
/// @ref LLP 0225#1-ownership-map — settlement callers enter the storage
/// kernel through typed operations instead of the wide `LocalDatabase` surface.
pub struct SettlementKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> SettlementKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub(crate) fn upsert_stream_attempts(
        &mut self,
        rows: &[(String, String, String)],
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.upsert_stream_attempts(rows, now_ms)
    }

    pub fn acknowledge_client_mutations(
        &mut self,
        auth_fingerprint: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.db.acknowledge_client_mutations(auth_fingerprint, ids)
    }

    pub(crate) fn acknowledge_client_mutations_for_authority(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.db.acknowledge_client_mutations_for_authority(
            auth_fingerprint,
            authority_instance_id,
            ids,
        )
    }

    pub(crate) fn issue_client_operation_identity_range(
        &mut self,
        audience: &str,
        authority_instance_id: &str,
        previous: Option<&crate::commit_envelope::ClientIdentityRangeV1>,
        issued_at_ms: u64,
    ) -> SnapbackResult<crate::commit_envelope::ClientIdentityRangeV1> {
        self.db.issue_client_operation_identity_range(
            audience,
            authority_instance_id,
            previous,
            issued_at_ms,
        )
    }

    pub(crate) fn host_operation_issuance(
        &mut self,
        authority_instance_id: &str,
        upstream_identity: &str,
        commit_ordinal: u64,
        issued_at_ms: u64,
    ) -> SnapbackResult<crate::commit_envelope::OperationIssuanceV1> {
        self.db.host_operation_issuance(
            authority_instance_id,
            upstream_identity,
            commit_ordinal,
            issued_at_ms,
        )
    }

    pub fn purge_client_mutation_settlements(
        &mut self,
        auth_fingerprint: Option<&str>,
    ) -> SnapbackResult<u64> {
        self.db.purge_client_mutation_settlements(auth_fingerprint)
    }
}

/// Shared-borrow settlement operations for callers holding `&LocalDatabase`.
pub struct SettlementReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> SettlementReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub(crate) fn stream_attempt_by_client_key(
        &self,
        client_key: &str,
    ) -> SnapbackResult<Option<(String, String)>> {
        self.db.stream_attempt_by_client_key(client_key)
    }

    pub(crate) fn load_stream_attempts(&self) -> SnapbackResult<Vec<(String, String, String)>> {
        self.db.load_stream_attempts()
    }

    pub fn client_mutation_retention_info(&self) -> SnapbackResult<ClientMutationRetentionInfo> {
        self.db.client_mutation_retention_info()
    }

    #[cfg(test)]
    pub(crate) fn operation_envelopes_for_test(
        &self,
    ) -> SnapbackResult<Vec<crate::commit_envelope::CommitEnvelopeV1>> {
        self.db.operation_envelopes_for_test()
    }

    pub(crate) fn explain_operation(
        &self,
        identity: &crate::commit_envelope::OperationIdentityV1,
        authority: &crate::operation_ledger::CurrentExplanationAuthorityV1,
    ) -> SnapbackResult<Option<crate::commit_envelope::OperationExplanationV1>> {
        self.db.explain_operation(identity, authority)
    }

    pub fn client_mutation_result(
        &self,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<Option<MutationOutput>> {
        self.db.client_mutation_result(identity)
    }
}
