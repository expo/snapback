use super::*;

/// A stream-attempt row observed through the canonical store, carrying the
/// exact adoption context supplied for that read. The type is not
/// deserializable, and the compile-fail examples below guard direct field
/// construction plus the single `new` constructor spelling. Within
/// `snapback-kernel`, issuing it only after a successful storage read remains
/// an implementation invariant rather than a stronger Rust visibility
/// guarantee.
///
/// This binding prevents replacing the context after the read. It does not
/// claim that the context owned the historical runner recorded by the row;
/// legacy rows do not retain an identity from which storage could prove that
/// stronger correspondence.
///
/// ```compile_fail,E0451
/// use snapback_kernel::storage::DurableStreamAttempt;
/// use snapback_kernel::stream_attempt::PersistedStreamAttempt;
///
/// let forged = PersistedStreamAttempt {
///     token: "forged".into(),
///     client_key: "forged".into(),
///     runner_generation: 1,
///     progress_commits: 0,
///     cursors_opened: 0,
///     cursors: Default::default(),
///     terminal: None,
///     function_id: None,
///     initiator: None,
///     started_at_ms: 0,
///     settled_at_ms: None,
///     emitted_bytes: 0,
///     chunk_count: 0,
/// };
/// let _witness = DurableStreamAttempt { persisted: forged, read_context: () };
/// ```
///
/// ```compile_fail,E0599
/// use snapback_kernel::storage::DurableStreamAttempt;
/// let _constructor = DurableStreamAttempt::<()>::new;
/// ```
pub struct DurableStreamAttempt<ReadContext> {
    persisted: crate::stream_attempt::PersistedStreamAttempt,
    read_context: ReadContext,
}

// The `new` fixture above is not an exhaustive public-constructor check: a
// future `issue` or `from_parts` spelling would require its own guard. See
// issues/20260822-rustdoc-compile-fail-error-codes-are-not-enforced.md.
impl<ReadContext> DurableStreamAttempt<ReadContext> {
    pub fn persisted(&self) -> &crate::stream_attempt::PersistedStreamAttempt {
        &self.persisted
    }

    pub fn read_context(&self) -> &ReadContext {
        &self.read_context
    }
}

/// Results of the storage-owned startup reconciliation pass. `recovered`
/// counts rows whose terminal CAS was committed by this pass, while
/// `terminal_attempts` also includes pre-existing winners for transcript repair.
pub struct StreamAttemptStartupReconciliation {
    recovered: usize,
    terminal_attempts: Vec<crate::stream_attempt::PersistedStreamAttempt>,
}

impl StreamAttemptStartupReconciliation {
    pub fn recovered_count(&self) -> usize {
        self.recovered
    }

    pub fn terminal_attempts(&self) -> &[crate::stream_attempt::PersistedStreamAttempt] {
        &self.terminal_attempts
    }
}

fn decode_stream_attempt(
    stored_token: &str,
    stored_client_key: &str,
    record_json: &str,
) -> SnapbackResult<crate::stream_attempt::PersistedStreamAttempt> {
    let persisted =
        serde_json::from_str::<crate::stream_attempt::PersistedStreamAttempt>(record_json)
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ACTION_STREAM_INVALID",
                    "runtime",
                    "the durable stream attempt record is not valid bounded JSON",
                )
                .with_details(
                    json!({ "operation": "durableAttemptRead", "error": error.to_string() }),
                )
            })?;
    if persisted.token != stored_token || persisted.client_key != stored_client_key {
        return Err(SnapbackError::error(
            "SNAPBACK_ACTION_STREAM_INVALID",
            "runtime",
            "the durable stream attempt identity disagrees with its storage key",
        )
        .with_details(json!({ "operation": "durableAttemptRead" })));
    }
    Ok(persisted)
}

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
        self.upsert_stream_attempts_guarded(rows, now_ms, || Ok(()))
    }

    /// Stage one complete stream-attempt batch before acquiring one final,
    /// one-shot guard for the durable cut. R2 deliberately keeps this seam
    /// private: every production path still supplies the no-op callback above.
    fn upsert_stream_attempts_guarded<G, BeforeCommit>(
        &mut self,
        rows: &[(String, String, String)],
        now_ms: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        if rows.is_empty() {
            return Ok(());
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for (token, client_key, record_json) in rows {
            tx.execute(
                "INSERT INTO _snapback_stream_attempts(token, client_key, record_json, updated_at_ms)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(token) DO UPDATE SET record_json = ?3, updated_at_ms = ?4",
                params![token, client_key, record_json, now_ms as i64],
            )?;
        }
        let _commit_guard = before_commit()?;
        // Once the final guard exists, COMMIT is the only remaining operation.
        tx.commit()?;
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
        self.acknowledge_client_mutations_for_authority_guarded(
            auth_fingerprint,
            authority_instance_id,
            ids,
            || Ok(()),
        )
    }

    pub(super) fn acknowledge_client_mutations_for_authority_guarded<G, BeforeCommit>(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: &str,
        ids: &[String],
        before_commit: BeforeCommit,
    ) -> SnapbackResult<u64>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.acknowledge_client_mutations_inner_guarded(
            auth_fingerprint,
            Some(authority_instance_id),
            ids,
            before_commit,
        )
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
        #[cfg(any(test, feature = "test-support"))]
        super::observe_durable_commit_for_test();
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
        #[cfg(any(test, feature = "test-support"))]
        super::observe_durable_commit_for_test();
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

    #[cfg(any(test, feature = "test-support"))]
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
        self.acknowledge_client_mutations_inner_guarded(
            auth_fingerprint,
            authority_instance_id,
            ids,
            || Ok(()),
        )
    }

    fn acknowledge_client_mutations_inner_guarded<G, BeforeCommit>(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: Option<&str>,
        ids: &[String],
        before_commit: BeforeCommit,
    ) -> SnapbackResult<u64>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
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
        #[cfg(any(test, feature = "test-support"))]
        super::observe_durable_commit_for_test();
        let _commit_guard = before_commit()?;
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
        #[cfg(any(test, feature = "test-support"))]
        super::observe_durable_commit_for_test();
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
    stream_attempt_persistence_verifier:
        Option<&'a crate::stream_attempt::StreamAttemptPersistenceVerifier>,
}

impl<'a> SettlementKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self {
            db,
            stream_attempt_persistence_verifier: None,
        }
    }

    pub(super) fn new_with_stream_attempt_verifier(
        db: &'a mut LocalDatabase,
        stream_attempt_persistence_verifier: Option<
            &'a crate::stream_attempt::StreamAttemptPersistenceVerifier,
        >,
    ) -> Self {
        Self {
            db,
            stream_attempt_persistence_verifier,
        }
    }

    pub fn upsert_stream_attempts(
        &mut self,
        batch: &crate::stream_attempt::StreamAttemptPersistenceBatch,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let expected_issuer = self.stream_attempt_persistence_verifier.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED",
                "storage",
                "this serving database has no stream-attempt persistence authority",
            )
        })?;
        if batch.issuer() != expected_issuer.issuer() {
            return Err(SnapbackError::error(
                "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED",
                "storage",
                "the stream-attempt batch issuer does not own this serving database",
            ));
        }
        if !expected_issuer.verify(&batch.authentication_message(), batch.authentication_tag()) {
            return Err(SnapbackError::error(
                "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED",
                "storage",
                "the stream-attempt persistence authentication tag is invalid",
            ));
        }
        self.db.upsert_stream_attempts(batch.rows(), now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn upsert_stream_attempts_for_test(
        &mut self,
        rows: &[(String, String, String)],
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.upsert_stream_attempts(rows, now_ms)
    }

    /// Settle every process-orphaned attempt inside the storage authority
    /// boundary. The one-use startup capability is consumed here, and the
    /// Terminalizer classification is part of the same durable row update.
    // @ref LLP 0076#settlement-and-retry — the trusted startup terminalizer
    //   folds the write-ahead initiation states conservatively and commits a
    //   durable winner before another runner can adopt the client key.
    pub(super) fn reconcile_orphaned_stream_attempts(
        &mut self,
        _startup_recovery: StreamAttemptStartupRecoveryCapability,
        now_ms: u64,
    ) -> SnapbackResult<StreamAttemptStartupReconciliation> {
        let rows = self.db.load_stream_attempts()?;
        let mut recovered_attempts = Vec::new();
        let mut terminal_attempts = Vec::new();
        let mut updates = Vec::new();
        for (token, client_key, record_json) in rows {
            let mut persisted = decode_stream_attempt(&token, &client_key, &record_json)?;
            if persisted.terminal.is_none() {
                let effect_may_have_executed = persisted.cursors.values().any(|cursor| {
                    cursor.initiation_state
                        != crate::stream_attempt::StreamInitiationState::DefinitelyNotInitiated
                });
                persisted.terminal = Some(crate::stream_attempt::StreamAttemptTerminal {
                    cause: crate::stream_attempt::StreamAttemptCause::Failed,
                    effect_may_have_executed,
                    settled_by: crate::stream_attempt::StreamAttemptSettledBy::Terminalizer,
                });
                persisted.settled_at_ms = Some(now_ms);
                for cursor in persisted.cursors.values_mut() {
                    cursor.open = false;
                }
                updates.push(persisted.to_row()?);
                recovered_attempts.push(persisted.clone());
            }
            terminal_attempts.push(persisted);
        }
        self.db.upsert_stream_attempts(&updates, now_ms)?;
        Ok(StreamAttemptStartupReconciliation {
            recovered: recovered_attempts.len(),
            terminal_attempts,
        })
    }

    pub fn acknowledge_client_mutations(
        &mut self,
        auth_fingerprint: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.db.acknowledge_client_mutations(auth_fingerprint, ids)
    }

    pub fn acknowledge_client_mutations_for_authority(
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

    pub fn acknowledge_client_mutations_for_authority_guarded<G, BeforeCommit>(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: &str,
        ids: &[String],
        before_commit: BeforeCommit,
    ) -> SnapbackResult<u64>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.acknowledge_client_mutations_for_authority_guarded(
            auth_fingerprint,
            authority_instance_id,
            ids,
            before_commit,
        )
    }

    pub fn issue_client_operation_identity_range(
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

    pub fn host_operation_issuance(
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

    pub fn durable_stream_attempt_by_client_key<ReadContext>(
        &self,
        client_key: &str,
        read_context: ReadContext,
    ) -> SnapbackResult<Option<DurableStreamAttempt<ReadContext>>> {
        let Some((token, record_json)) = self.db.stream_attempt_by_client_key(client_key)? else {
            return Ok(None);
        };
        let persisted = decode_stream_attempt(&token, client_key, &record_json)?;
        Ok(Some(DurableStreamAttempt {
            persisted,
            read_context,
        }))
    }

    pub fn load_stream_attempts(&self) -> SnapbackResult<Vec<(String, String, String)>> {
        self.db.load_stream_attempts()
    }

    pub fn client_mutation_retention_info(&self) -> SnapbackResult<ClientMutationRetentionInfo> {
        self.db.client_mutation_retention_info()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn operation_envelopes_for_test(
        &self,
    ) -> SnapbackResult<Vec<crate::commit_envelope::CommitEnvelopeV1>> {
        self.db.operation_envelopes_for_test()
    }

    pub fn explain_operation(
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::hooks::{Action, AuthAction, Authorization, TransactionOperation};
    use rusqlite::{Connection, ErrorCode};
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    type AttemptRow = (String, String, String);

    fn before_rows() -> Vec<AttemptRow> {
        vec![
            ("r2-token-1".into(), "r2-client-1".into(), "before-1".into()),
            ("r2-token-2".into(), "r2-client-2".into(), "before-2".into()),
            ("r2-token-3".into(), "r2-client-3".into(), "before-3".into()),
        ]
    }

    fn after_rows() -> Vec<AttemptRow> {
        vec![
            ("r2-token-1".into(), "r2-client-1".into(), "after-1".into()),
            ("r2-token-2".into(), "r2-client-2".into(), "after-2".into()),
            ("r2-token-3".into(), "r2-client-3".into(), "after-3".into()),
        ]
    }

    fn sorted_stream_attempt_rows(db: &LocalDatabase) -> Vec<AttemptRow> {
        let mut rows = db.load_stream_attempts().expect("load stream attempts");
        rows.sort();
        rows
    }

    fn install_row_failure(db: &LocalDatabase, token: &str) {
        assert!(
            ["r2-token-1", "r2-token-2", "r2-token-3"].contains(&token),
            "test trigger token must be a fixed fixture value"
        );
        db.conn
            .execute_batch(&format!(
                "CREATE TEMP TRIGGER stream_attempt_injected_failure
                 BEFORE INSERT ON _snapback_stream_attempts
                 WHEN NEW.token = '{token}'
                 BEGIN
                   SELECT RAISE(ABORT, 'injected stream-attempt row failure');
                 END;"
            ))
            .expect("install row failure");
    }

    fn nonterminal_attempt(
        token: &str,
        client_key: &str,
    ) -> crate::stream_attempt::PersistedStreamAttempt {
        crate::stream_attempt::PersistedStreamAttempt {
            token: token.to_owned(),
            client_key: client_key.to_owned(),
            runner_generation: 1,
            progress_commits: 0,
            cursors_opened: 1,
            cursors: BTreeMap::from([(
                "cursor".to_owned(),
                crate::stream_attempt::PersistedStreamCursor {
                    initiation_state:
                        crate::stream_attempt::StreamInitiationState::InitiationPossible,
                    open: true,
                },
            )]),
            terminal: None,
            function_id: Some("app:r2-test".to_owned()),
            initiator: None,
            started_at_ms: 1,
            settled_at_ms: None,
            emitted_bytes: 0,
            chunk_count: 0,
        }
    }

    fn recovery_rows() -> Vec<AttemptRow> {
        [
            ("r2-token-1", "r2-client-1"),
            ("r2-token-2", "r2-client-2"),
            ("r2-token-3", "r2-client-3"),
        ]
        .into_iter()
        .map(|(token, client_key)| {
            nonterminal_attempt(token, client_key)
                .to_row()
                .expect("serialize recovery fixture")
        })
        .collect()
    }

    #[test]
    fn authenticated_stream_attempt_batch_is_atomic_at_every_row_failure() {
        for failed_token in ["r2-token-1", "r2-token-2", "r2-token-3"] {
            let mut db = LocalDatabase::memory().expect("stream-attempt database");
            let before = before_rows();
            db.upsert_stream_attempts(&before, 1)
                .expect("seed exact preimage");
            install_row_failure(&db, failed_token);

            let key = crate::stream_attempt::StreamAttemptPersistenceMacKey::generate()
                .expect("generate persistence key");
            let verifier = key.verifier();
            let batch = key.authenticate(after_rows());
            let error =
                SettlementKernel::new_with_stream_attempt_verifier(&mut db, Some(&verifier))
                    .upsert_stream_attempts(&batch, 2)
                    .expect_err("injected row failure must abort the batch");
            assert_eq!(error.diagnostic.code, "SNAPBACK_SQLITE_ERROR");
            assert_eq!(
                sorted_stream_attempt_rows(&db),
                before,
                "failure at {failed_token} left a partial durable batch"
            );
        }
    }

    #[test]
    fn stream_attempt_batch_reserves_immediate_writer_before_first_row_prepare() {
        const NOT_OBSERVED: usize = 0;
        const DEFERRED_OR_MISSING: usize = 1;
        const IMMEDIATE: usize = 2;
        const EXCLUSIVE: usize = 3;
        const SECONDARY_UNEXPECTED_ERROR: usize = 4;

        let directory = tempfile::tempdir().expect("stream-attempt tempdir");
        let path = directory.path().join("immediate.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("primary stream-attempt database");
        db.conn
            .execute_batch("PRAGMA journal_mode = DELETE;")
            .expect("rollback journal distinguishes IMMEDIATE from EXCLUSIVE");
        db.conn.set_prepared_statement_cache_capacity(0);

        let secondary = Connection::open(&path).expect("secondary SQLite connection");
        secondary
            .busy_timeout(Duration::ZERO)
            .expect("zero secondary busy timeout");
        let secondary = Arc::new(Mutex::new(secondary));
        let observation = Arc::new(AtomicUsize::new(NOT_OBSERVED));
        let hook_secondary = Arc::clone(&secondary);
        let hook_observation = Arc::clone(&observation);
        db.conn
            .authorizer(Some(move |context: rusqlite::hooks::AuthContext<'_>| {
                if matches!(
                    context.action,
                    AuthAction::Insert {
                        table_name: "_snapback_stream_attempts"
                    }
                ) && hook_observation
                    .compare_exchange(
                        NOT_OBSERVED,
                        DEFERRED_OR_MISSING,
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    )
                    .is_ok()
                {
                    let secondary = hook_secondary.lock().expect("secondary connection lock");
                    let writer_result = secondary.execute_batch("BEGIN IMMEDIATE; ROLLBACK;");
                    let reader_result = secondary.query_row(
                        "SELECT COUNT(*) FROM _snapback_stream_attempts",
                        [],
                        |row| row.get::<_, u64>(0),
                    );
                    hook_observation.store(
                        match (writer_result, reader_result) {
                            (Ok(()), Ok(_)) => DEFERRED_OR_MISSING,
                            (Err(error), Ok(_))
                                if matches!(
                                    error.sqlite_error_code(),
                                    Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
                                ) =>
                            {
                                IMMEDIATE
                            }
                            (Err(writer_error), Err(reader_error))
                                if matches!(
                                    writer_error.sqlite_error_code(),
                                    Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
                                ) && matches!(
                                    reader_error.sqlite_error_code(),
                                    Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
                                ) =>
                            {
                                EXCLUSIVE
                            }
                            _ => SECONDARY_UNEXPECTED_ERROR,
                        },
                        Ordering::SeqCst,
                    );
                }
                Authorization::Allow
            }));

        db.upsert_stream_attempts(&after_rows()[..1], 2)
            .expect("primary batch commits");
        assert_eq!(
            observation.load(Ordering::SeqCst),
            IMMEDIATE,
            "the primary must hold exactly an IMMEDIATE reservation before its first row is prepared"
        );
    }

    #[test]
    fn stream_attempt_before_commit_failure_follows_full_staging_and_rolls_back() {
        let mut db = LocalDatabase::memory().expect("stream-attempt database");
        let staged_rows = Arc::new(AtomicUsize::new(0));
        let hook_staged_rows = Arc::clone(&staged_rows);
        db.conn.update_hook(Some(
            move |action: Action, _database: &str, table: &str, _rowid: i64| {
                if action == Action::SQLITE_INSERT && table == "_snapback_stream_attempts" {
                    hook_staged_rows.fetch_add(1, Ordering::SeqCst);
                }
            },
        ));
        let callback_count = AtomicUsize::new(0);

        let error = db
            .upsert_stream_attempts_guarded(&after_rows(), 2, || -> SnapbackResult<()> {
                assert_eq!(
                    staged_rows.load(Ordering::SeqCst),
                    3,
                    "before_commit ran before every row was staged"
                );
                callback_count.fetch_add(1, Ordering::SeqCst);
                Err(SnapbackError::error(
                    "TEST_STREAM_ATTEMPT_BEFORE_COMMIT_REFUSED",
                    "test",
                    "injected before-commit refusal",
                ))
            })
            .expect_err("callback refusal must abort the transaction");

        assert_eq!(
            error.diagnostic.code,
            "TEST_STREAM_ATTEMPT_BEFORE_COMMIT_REFUSED"
        );
        assert_eq!(callback_count.load(Ordering::SeqCst), 1);
        assert_eq!(staged_rows.load(Ordering::SeqCst), 3);
        assert!(sorted_stream_attempt_rows(&db).is_empty());
    }

    struct CommitLifetimeGuard {
        live: Arc<AtomicBool>,
    }

    impl Drop for CommitLifetimeGuard {
        fn drop(&mut self) {
            self.live.store(false, Ordering::SeqCst);
        }
    }

    #[test]
    fn stream_attempt_before_commit_guard_remains_live_through_actual_commit() {
        let mut db = LocalDatabase::memory().expect("stream-attempt database");
        let guard_live = Arc::new(AtomicBool::new(false));
        let hook_guard_live = Arc::clone(&guard_live);
        let commit_count = Arc::new(AtomicUsize::new(0));
        let hook_commit_count = Arc::clone(&commit_count);
        let commit_observed_live_guard = Arc::new(AtomicBool::new(false));
        let hook_observed_live_guard = Arc::clone(&commit_observed_live_guard);
        db.conn.commit_hook(Some(move || {
            hook_commit_count.fetch_add(1, Ordering::SeqCst);
            hook_observed_live_guard
                .store(hook_guard_live.load(Ordering::SeqCst), Ordering::SeqCst);
            false
        }));
        let callback_count = AtomicUsize::new(0);
        let callback_guard_live = Arc::clone(&guard_live);

        db.upsert_stream_attempts_guarded(&after_rows(), 2, || {
            callback_count.fetch_add(1, Ordering::SeqCst);
            callback_guard_live.store(true, Ordering::SeqCst);
            Ok(CommitLifetimeGuard {
                live: Arc::clone(&callback_guard_live),
            })
        })
        .expect("guarded stream-attempt batch commits");

        assert_eq!(callback_count.load(Ordering::SeqCst), 1);
        assert_eq!(commit_count.load(Ordering::SeqCst), 1);
        assert!(commit_observed_live_guard.load(Ordering::SeqCst));
        assert!(!guard_live.load(Ordering::SeqCst));
        assert_eq!(sorted_stream_attempt_rows(&db), after_rows());
    }

    #[test]
    fn empty_stream_attempt_batch_skips_transaction_and_callback_but_not_authentication() {
        let directory = tempfile::tempdir().expect("stream-attempt tempdir");
        let path = directory.path().join("empty.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("primary stream-attempt database");
        db.conn
            .busy_timeout(Duration::ZERO)
            .expect("zero primary busy timeout");
        let secondary = Connection::open(&path).expect("secondary SQLite connection");
        secondary
            .execute_batch("BEGIN IMMEDIATE;")
            .expect("secondary owns the writer reservation");

        let key = crate::stream_attempt::StreamAttemptPersistenceMacKey::generate()
            .expect("generate persistence key");
        let verifier = key.verifier();
        let invalid_empty =
            crate::stream_attempt::StreamAttemptPersistenceBatch::from_authenticated_parts(
                Vec::new(),
                verifier.issuer().to_vec(),
                vec![0; 32],
            );
        let error = SettlementKernel::new_with_stream_attempt_verifier(&mut db, Some(&verifier))
            .upsert_stream_attempts(&invalid_empty, 2)
            .expect_err("invalid empty batch must not bypass authentication");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );

        let callback_count = AtomicUsize::new(0);
        db.upsert_stream_attempts_guarded(&[], 2, || -> SnapbackResult<()> {
            callback_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .expect("empty batch does not contend with the existing writer");
        assert_eq!(callback_count.load(Ordering::SeqCst), 0);
        secondary
            .execute_batch("ROLLBACK;")
            .expect("release secondary writer reservation");
    }

    #[test]
    fn exact_batch_authentication_finishes_before_any_transaction_or_row_write() {
        let directory = tempfile::tempdir().expect("stream-attempt tempdir");
        let path = directory.path().join("authentication.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("primary stream-attempt database");
        db.conn.set_prepared_statement_cache_capacity(0);
        let transaction_begins = Arc::new(AtomicUsize::new(0));
        let hook_transaction_begins = Arc::clone(&transaction_begins);
        db.conn
            .authorizer(Some(move |context: rusqlite::hooks::AuthContext<'_>| {
                if matches!(
                    context.action,
                    AuthAction::Transaction {
                        operation: TransactionOperation::Begin
                    }
                ) {
                    hook_transaction_begins.fetch_add(1, Ordering::SeqCst);
                }
                Authorization::Allow
            }));
        let key = crate::stream_attempt::StreamAttemptPersistenceMacKey::generate()
            .expect("generate persistence key");
        let verifier = key.verifier();
        let original = key.authenticate(after_rows());
        let mut tampered_rows = original.rows().to_vec();
        tampered_rows.last_mut().expect("last authenticated row").2 = "tampered-last-row".into();
        let tampered =
            crate::stream_attempt::StreamAttemptPersistenceBatch::from_authenticated_parts(
                tampered_rows,
                original.issuer().to_vec(),
                original.authentication_tag().to_vec(),
            );

        let error = SettlementKernel::new_with_stream_attempt_verifier(&mut db, Some(&verifier))
            .upsert_stream_attempts(&tampered, 2)
            .expect_err("last-row tamper must fail before storage begins");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );
        assert_eq!(transaction_begins.load(Ordering::SeqCst), 0);
        assert!(sorted_stream_attempt_rows(&db).is_empty());

        SettlementKernel::new_with_stream_attempt_verifier(&mut db, Some(&verifier))
            .upsert_stream_attempts(&original, 2)
            .expect("original exact batch commits");
        assert_eq!(
            transaction_begins.load(Ordering::SeqCst),
            1,
            "the authorizer probe must observe the valid batch's transaction"
        );
        assert_eq!(sorted_stream_attempt_rows(&db), after_rows());
    }

    #[test]
    fn startup_recovery_batch_is_atomic_at_every_row_failure_and_result_is_takeable_once() {
        for failed_token in ["r2-token-1", "r2-token-2", "r2-token-3"] {
            let directory = tempfile::tempdir().expect("stream-attempt tempdir");
            let path = directory.path().join("recovery.sqlite3");
            let mut db = LocalDatabase::open(&path).expect("stream-attempt database");
            let before = recovery_rows();
            db.upsert_stream_attempts(&before, 1)
                .expect("seed nonterminal attempts");
            install_row_failure(&db, failed_token);

            let error = match ServingDatabase::adopt(db) {
                Ok(_) => panic!("failure at {failed_token} must abort startup adoption"),
                Err(error) => error,
            };
            assert_eq!(error.diagnostic.code, "SNAPBACK_SQLITE_ERROR");

            let reopened = LocalDatabase::open(&path).expect("inspect failed recovery");
            assert_eq!(
                sorted_stream_attempt_rows(&reopened),
                before,
                "failed recovery at {failed_token} changed a durable row"
            );
            let mut serving = ServingDatabase::adopt(reopened).expect("retry recovery atomically");
            let recovery = serving
                .take_stream_attempt_startup_reconciliation()
                .expect("take startup recovery result");
            assert_eq!(recovery.recovered_count(), 3);
            assert_eq!(recovery.terminal_attempts().len(), 3);
            assert!(
                serving
                    .take_stream_attempt_startup_reconciliation()
                    .is_none(),
                "startup recovery result must be takeable only once"
            );
        }
    }

    #[test]
    fn fresh_stream_attempt_verifier_reads_and_recovers_prior_issuer_rows() {
        let directory = tempfile::tempdir().expect("stream-attempt tempdir");
        let path = directory.path().join("new-process.sqlite3");
        let key_a = crate::stream_attempt::StreamAttemptPersistenceMacKey::generate()
            .expect("generate process-A persistence key");
        let issuer_a = key_a.verifier().issuer().to_vec();
        let mut terminal = nonterminal_attempt("terminal-a", "client-terminal-a");
        terminal.terminal = Some(crate::stream_attempt::StreamAttemptTerminal {
            cause: crate::stream_attempt::StreamAttemptCause::Complete,
            effect_may_have_executed: true,
            settled_by: crate::stream_attempt::StreamAttemptSettledBy::Authored,
        });
        terminal.settled_at_ms = Some(10);
        for cursor in terminal.cursors.values_mut() {
            cursor.open = false;
        }
        let orphan = nonterminal_attempt("orphan-a", "client-orphan-a");
        let rows = vec![
            terminal.to_row().expect("serialize terminal attempt"),
            orphan.to_row().expect("serialize orphan attempt"),
        ];
        {
            let local = LocalDatabase::open(&path).expect("process-A database");
            let mut serving =
                ServingDatabase::adopt_with_stream_attempt_verifier(local, key_a.verifier())
                    .expect("adopt process-A verifier");
            serving
                .settlement()
                .upsert_stream_attempts(&key_a.authenticate(rows), 10)
                .expect("process A persists both rows");
        }

        let key_b = crate::stream_attempt::StreamAttemptPersistenceMacKey::generate()
            .expect("generate process-B persistence key");
        assert_ne!(issuer_a, key_b.verifier().issuer());
        let local = LocalDatabase::open(&path).expect("process-B database");
        let mut serving =
            ServingDatabase::adopt_with_stream_attempt_verifier(local, key_b.verifier())
                .expect("new verifier recovers prior issuer rows");
        let recovery = serving
            .take_stream_attempt_startup_reconciliation()
            .expect("process-B startup result");
        assert_eq!(recovery.recovered_count(), 1);

        let durable_terminal = serving
            .settlement_read()
            .durable_stream_attempt_by_client_key("client-terminal-a", ())
            .expect("read prior terminal")
            .expect("prior terminal exists");
        assert_eq!(durable_terminal.persisted().terminal, terminal.terminal);
        let durable_orphan = serving
            .settlement_read()
            .durable_stream_attempt_by_client_key("client-orphan-a", ())
            .expect("read recovered orphan")
            .expect("recovered orphan exists");
        assert_eq!(
            durable_orphan.persisted().terminal,
            Some(crate::stream_attempt::StreamAttemptTerminal {
                cause: crate::stream_attempt::StreamAttemptCause::Failed,
                effect_may_have_executed: true,
                settled_by: crate::stream_attempt::StreamAttemptSettledBy::Terminalizer,
            })
        );
    }
}
