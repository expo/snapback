use super::{LocalDatabase, SnapbackResult};

#[cfg(test)]
use crate::ids::{self, Kind};
#[cfg(test)]
use rusqlite::params;
#[cfg(test)]
use sha2::{Digest, Sha256};

impl LocalDatabase {
    pub(crate) fn push_registry_inspection(
        &self,
    ) -> SnapbackResult<crate::push::PushRegistryInspectionV1> {
        if self.schema.push_seam.is_some() {
            crate::push::inspect(&self.conn)
        } else {
            Ok(crate::push::PushRegistryInspectionV1::default())
        }
    }

    #[cfg(test)]
    pub(crate) fn activate_push_registry_for_test(
        &mut self,
        declaration: crate::push::PushSeamDeclarationV1,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| crate::push::activate_manifest_in(tx, Some(&declaration)))?;
        self.schema.auth = Some(crate::manifest::AuthManifest {
            mode: crate::manifest::AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
        });
        self.schema.push_seam = Some(declaration);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_register(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        token: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::PushTokenRegistrationResponse> {
        self.with_auth_transaction(|tx| {
            crate::push::register_in(
                tx,
                crate::push::Registration {
                    declaration,
                    principal_id,
                    session_id,
                    session_generation,
                    installation_id,
                    token,
                    now_ms,
                },
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_unregister(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::PushTokenUnregisterResponse> {
        self.with_auth_transaction(|tx| {
            crate::push::unregister_in(
                tx,
                declaration,
                principal_id,
                session_id,
                session_generation,
                installation_id,
                now_ms,
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_reserve_send(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> crate::auth::invocation::PreparedAuthority,
        trigger_mode: crate::push::PushTriggerModeV1,
        deferred_grant: Option<&crate::push::PushDeferredGrantV1>,
        request: &crate::push::PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::ReservedPushAttemptV1> {
        self.with_auth_transaction(|tx| {
            let authority = authority();
            crate::push::reserve_send_in(
                tx,
                crate::push::PushSendReservation {
                    declaration,
                    schema,
                    authority: &authority,
                    trigger_mode,
                    deferred_grant,
                    request,
                    now_ms,
                },
            )
        })
    }

    pub(super) fn push_claim_batch(
        &mut self,
        batch_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<crate::push::PushBatchClaimV1>> {
        self.with_auth_transaction(|tx| crate::push::claim_batch_in(tx, batch_id, now_ms))
    }

    pub(super) fn push_mark_batch_transmitting(
        &mut self,
        claim: &crate::push::PushBatchClaimV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| crate::push::mark_batch_transmitting_in(tx, claim, now_ms))
    }

    pub(super) fn push_settle_batch(
        &mut self,
        claim: &crate::push::PushBatchClaimV1,
        settlement: &crate::push::PushBatchSettlementV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| crate::push::settle_batch_in(tx, claim, settlement, now_ms))
    }

    pub(super) fn push_claim_due_receipts(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::PushReceiptPollClaimV1> {
        self.with_auth_transaction(|tx| crate::push::claim_due_receipts_in(tx, now_ms))
    }

    pub(super) fn push_claim_maintenance(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<(
        Option<crate::push::PushRecoveredBatchV1>,
        crate::push::PushReceiptPollClaimV1,
    )> {
        self.with_auth_transaction(|tx| {
            crate::push::recover_expired_batches_in(tx, now_ms)?;
            crate::push::expire_ledger_in(tx, now_ms)?;
            let recovered = crate::push::claim_recovered_batch_for_transmit_in(tx, now_ms)?;
            let receipts = crate::push::claim_due_receipts_in(tx, now_ms)?;
            Ok((recovered, receipts))
        })
    }

    pub(super) fn push_settle_receipt_poll(
        &mut self,
        claim: &crate::push::PushReceiptPollClaimV1,
        outcomes: &std::collections::BTreeMap<String, crate::push::PushReceiptOutcomeV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            crate::push::settle_receipt_poll_in(tx, claim, outcomes, now_ms)
        })
    }

    pub(super) fn push_recover_expired_batches(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<(usize, usize)> {
        self.with_auth_transaction(|tx| crate::push::recover_expired_batches_in(tx, now_ms))
    }

    pub(super) fn push_claim_recovered_batch_for_transmit(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Option<crate::push::PushRecoveredBatchV1>> {
        self.with_auth_transaction(|tx| {
            crate::push::claim_recovered_batch_for_transmit_in(tx, now_ms)
        })
    }

    pub(super) fn push_activate_manifest(
        &mut self,
        declaration: Option<&crate::push::PushSeamDeclarationV1>,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| crate::push::activate_manifest_in(tx, declaration))
    }

    pub(super) fn push_validate_exact_ledger_schema(&self) -> SnapbackResult<()> {
        self.with_auth_read(crate::push::validate_exact_ledger_schema)
    }

    pub(super) fn push_intent_state(&self, intent_id: &str) -> SnapbackResult<String> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT state FROM _snapback_push_intents_v1 WHERE id = ?1",
                rusqlite::params![intent_id],
                |row| row.get(0),
            )?)
        })
    }

    pub(super) fn push_retire_idle(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            crate::push::retire_idle_in(tx, declaration, now_ms)?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn push_insert_session_for_test(
        &mut self,
        principal_id: &str,
        session_id: &str,
        generation: u64,
        expires_at_ms: u64,
        discriminator: u8,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            let identity_id = format!("identity-{discriminator}");
            tx.execute(
                "INSERT OR IGNORE INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![principal_id],
            )?;
            super::insert_test_email_identity(
                tx,
                &identity_id,
                principal_id,
                &format!("user-{discriminator}@example.com"),
                0,
                true,
            )?;
            super::insert_test_identity_session(
                tx,
                session_id,
                principal_id,
                &identity_id,
                &format!("authority-{discriminator}"),
                &[discriminator; 32],
                0,
                0,
                expires_at_ms,
                expires_at_ms,
            )?;
            tx.execute(
                "UPDATE _auth_sessions SET generation = ?1 WHERE id = ?2",
                params![generation as i64, session_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_seed_ledger_projection_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        intent_id: &str,
        batch_id: &str,
        message_id: &str,
        token_id: &str,
        audience_args: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_push_intents_v1(
                   id, app_scope, dedupe_key, binding_hash, audience_name,
                   audience_args_json, payload_json, trigger_mode, state,
                   attempt_count, created_at_ms, updated_at_ms, expires_at_ms
                 ) VALUES(?1, ?2, 'dedupe-secret', zeroblob(32), 'selectedGuests',
                          ?3, '{\"body\":\"payload-secret\"}', 'system',
                          'handed-to-expo', 1, 1, 2, 100000000)",
                params![intent_id, declaration.app_scope.identity(), audience_args],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_batches_v1(
                   id, intent_id, attempt_number, batch_index, state,
                   transmitting_at_ms, settled_at_ms, http_status
                 ) VALUES(?1, ?2, 1, 0, 'settled', 3, 4, 200)",
                params![batch_id, intent_id],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_messages_v1(
                   id, batch_id, token_id, token_hash, token_bytes, state,
                   ticket_id, receipt_poll_count, next_receipt_poll_at_ms,
                   receipt_window_closes_at_ms, handed_to_expo_at_ms
                 ) VALUES(?1, ?2, ?3, zeroblob(32),
                          'ExponentPushToken[token-secret]', 'handed-to-expo',
                          'ticket-fixture', 0, 900003, 86400003, 3)",
                params![message_id, batch_id, token_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn push_seed_acceptance_audience_and_tokens_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        principal_ok: &str,
        principal_ticket_dnr: &str,
        principal_receipt_dnr: &str,
    ) -> SnapbackResult<(String, String, String)> {
        self.with_auth_transaction(|tx| {
            tx.execute_batch(
                "CREATE TABLE event_members(
                   principal TEXT NOT NULL, event_id TEXT NOT NULL, role TEXT NOT NULL
                 );
                 CREATE TABLE event_senders(
                   principal TEXT NOT NULL, event_id TEXT NOT NULL, role TEXT NOT NULL
                 );",
            )?;
            for principal in [principal_ok, principal_ticket_dnr, principal_receipt_dnr] {
                tx.execute(
                    "INSERT INTO event_members(principal, event_id, role)
                     VALUES(?1, 'event-main', 'guest')",
                    params![principal],
                )?;
            }
            Ok((
                insert_acceptance_token(
                    tx,
                    declaration,
                    principal_ok,
                    "ExponentPushToken[fixture-ok]",
                )?,
                insert_acceptance_token(
                    tx,
                    declaration,
                    principal_ticket_dnr,
                    "ExponentPushToken[fixture-ticket-dnr]",
                )?,
                insert_acceptance_token(
                    tx,
                    declaration,
                    principal_receipt_dnr,
                    "ExponentPushToken[fixture-receipt-dnr]",
                )?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn push_assert_acceptance_ledger_outcomes_for_test(
        &self,
        expected: &[(&str, &str, bool)],
    ) -> SnapbackResult<()> {
        self.with_auth_read(|conn| {
            for (token_id, expected_state, expected_retired) in expected {
                let state: String = conn.query_row(
                    "SELECT state FROM _snapback_push_messages_v1
                     WHERE token_id = ?1 ORDER BY id LIMIT 1",
                    params![token_id],
                    |row| row.get(0),
                )?;
                assert_eq!(state, *expected_state);
                let (retired, bytes): (bool, String) = conn.query_row(
                    "SELECT retired_at_ms IS NOT NULL, token_bytes
                     FROM _snapback_push_tokens_v1 WHERE id = ?1",
                    params![token_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(retired, *expected_retired);
                assert_eq!(bytes.is_empty(), *expected_retired);
            }
            let persisted_codes: String = conn.query_row(
                "SELECT COALESCE(group_concat(COALESCE(expo_error_code, ''), '|'), '')
                 FROM _snapback_push_messages_v1",
                [],
                |row| row.get(0),
            )?;
            assert!(!persisted_codes.contains("provider-prose"));
            assert!(persisted_codes.contains("DeviceNotRegistered"));
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn push_seed_drop_audience_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        drop_principal: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO event_members(principal, event_id, role)
                 VALUES(?1, 'event-drop', 'guest')",
                params![drop_principal],
            )?;
            insert_acceptance_token(
                tx,
                declaration,
                drop_principal,
                "ExponentPushToken[fixture-drop]",
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn push_assert_no_expired_batch_recovery_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            assert_eq!(crate::push::recover_expired_batches_in(tx, now_ms)?, (0, 0));
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn push_redrive_previous_ambiguous_for_test(
        &self,
        batch_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_read(|conn| {
            let previous_ambiguous: bool = conn.query_row(
                "SELECT previous_ambiguous FROM _snapback_push_batches_v1
                 WHERE id = ?1 AND attempt_number = 2",
                params![batch_id],
                |row| row.get(0),
            )?;
            assert!(previous_ambiguous);
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn push_object_names_for_test(&self) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|conn| {
            let mut statement = conn.prepare(
                "SELECT name FROM sqlite_schema
                 WHERE name LIKE '_snapback_push_%' ORDER BY name",
            )?;
            Ok(statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?)
        })
    }

    #[cfg(test)]
    pub(super) fn push_ledger_table_names_for_test(&self) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|conn| {
            let mut statement = conn.prepare(
                "SELECT name FROM sqlite_schema
                 WHERE type = 'table' AND name IN (
                   '_snapback_push_intents_v1',
                   '_snapback_push_batches_v1',
                   '_snapback_push_messages_v1'
                 ) ORDER BY name",
            )?;
            Ok(statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?)
        })
    }

    #[cfg(test)]
    pub(super) fn push_tamper_ledger_index_for_test(&mut self) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute_batch(
                "DROP INDEX _snapback_push_messages_v1_receipts;
                 CREATE INDEX _snapback_push_messages_v1_receipts
                   ON _snapback_push_messages_v1(state, ticket_id, id);",
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
fn insert_acceptance_token(
    tx: &rusqlite::Transaction<'_>,
    declaration: &crate::push::PushSeamDeclarationV1,
    principal: &str,
    token: &str,
) -> SnapbackResult<String> {
    let token_id = ids::mint_time_ordered(Kind::PushToken);
    let installation_id = ids::mint(Kind::Installation)?;
    let token_hash = Sha256::digest(token.as_bytes()).to_vec();
    tx.execute(
        "INSERT INTO _snapback_push_tokens_v1(
           id, app_scope, principal_id, installation_id, token_hash, token_bytes,
           session_id, session_generation, registered_at_ms, last_registered_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'fixture-session', 1, 1, 1)",
        params![
            token_id,
            declaration.app_scope.identity(),
            principal,
            installation_id,
            token_hash,
            token,
        ],
    )?;
    Ok(token_id)
}

#[cfg(test)]
impl LocalDatabase {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_seed_mixed_batch_aggregate_for_test(
        &mut self,
        intent_id: &str,
        ambiguous_batch: &str,
        pending_batch: &str,
        failed_batch: &str,
        ambiguous_message: &str,
        pending_message: &str,
        failed_message: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_push_intents_v1(
                   id, app_scope, dedupe_key, binding_hash, audience_name,
                   audience_args_json, payload_json, trigger_mode, state,
                   attempt_count, created_at_ms, updated_at_ms, expires_at_ms
                 ) VALUES(?1, 'scope', 'aggregate', zeroblob(32), 'guests', '{}', '{}',
                          'system', 'reserved', 1, 1, 1, 100000000)",
                params![intent_id],
            )?;
            for (index, batch_id) in [ambiguous_batch, pending_batch, failed_batch]
                .into_iter()
                .enumerate()
            {
                tx.execute(
                    "INSERT INTO _snapback_push_batches_v1(
                       id, intent_id, attempt_number, batch_index, state
                     ) VALUES(?1, ?2, 1, ?3, 'settled')",
                    params![batch_id, intent_id, index as i64],
                )?;
            }
            for (message_id, batch_id, token_id, state) in [
                (ambiguous_message, ambiguous_batch, "token-a", "ambiguous"),
                (pending_message, pending_batch, "token-b", "handed-to-expo"),
                (failed_message, failed_batch, "token-c", "failed-permanent"),
            ] {
                tx.execute(
                    "INSERT INTO _snapback_push_messages_v1(
                       id, batch_id, token_id, token_hash, token_bytes, state
                     ) VALUES(?1, ?2, ?3, zeroblob(32), '', ?4)",
                    params![message_id, batch_id, token_id, state],
                )?;
            }

            crate::push::recompute_intent_state_in(tx, intent_id, 2)?;
            let state = |tx: &rusqlite::Transaction<'_>| -> rusqlite::Result<String> {
                tx.query_row(
                    "SELECT state FROM _snapback_push_intents_v1 WHERE id = ?1",
                    params![intent_id],
                    |row| row.get(0),
                )
            };
            assert_eq!(state(tx)?, "ambiguous");

            tx.execute(
                "UPDATE _snapback_push_messages_v1 SET state = 'expo-accepted'
                 WHERE id = ?1",
                params![ambiguous_message],
            )?;
            crate::push::recompute_intent_state_in(tx, intent_id, 3)?;
            assert_eq!(state(tx)?, "handed-to-expo");

            tx.execute(
                "UPDATE _snapback_push_messages_v1 SET state = 'expo-accepted'
                 WHERE id = ?1",
                params![pending_message],
            )?;
            crate::push::recompute_intent_state_in(tx, intent_id, 4)?;
            assert_eq!(state(tx)?, "expo-error");
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_seed_reserved_recovery_for_test(
        &mut self,
        token_id: &str,
        intent_id: &str,
        batch_id: &str,
        message_id: &str,
        installation_id: &str,
        first_hash: &[u8],
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_push_tokens_v1(
                   id, app_scope, principal_id, installation_id, token_hash, token_bytes,
                   session_id, session_generation, registered_at_ms, last_registered_at_ms
                 ) VALUES(?1, 'scope', 'user', ?2, ?3, 'ExponentPushToken[first]',
                          'session', 1, 1, 1)",
                params![token_id, installation_id, first_hash],
            )?;
            tx.execute(
                r#"INSERT INTO _snapback_push_intents_v1(
                   id, app_scope, dedupe_key, binding_hash, audience_name,
                   audience_args_json, payload_json, trigger_mode, state,
                   attempt_count, created_at_ms, updated_at_ms, expires_at_ms
                 ) VALUES(?1, 'scope', 'dedupe', zeroblob(32), 'guests', '{}',
                          '{"title":"hello","body":"world","data":null}',
                          'system', 'reserved', 1, 1, 1, 100000000)"#,
                params![intent_id],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_batches_v1(
                   id, intent_id, attempt_number, batch_index, state
                 ) VALUES(?1, ?2, 1, 0, 'reserved')",
                params![batch_id, intent_id],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_messages_v1(
                   id, batch_id, token_id, token_hash, token_bytes, state
                 ) VALUES(?1, ?2, ?3, ?4, 'ExponentPushToken[first]', 'reserved')",
                params![
                    message_id,
                    batch_id,
                    token_id,
                    Sha256::digest(b"ExponentPushToken[first]").to_vec()
                ],
            )?;
            Ok(())
        })
    }

    pub(super) fn push_rotate_token_and_recover_reserved_for_test(
        &mut self,
        token_id: &str,
        rotated_hash: &[u8],
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _snapback_push_tokens_v1
                 SET token_hash = ?1, token_bytes = 'ExponentPushToken[rotated]'
                 WHERE id = ?2",
                params![rotated_hash, token_id],
            )?;
            assert_eq!(crate::push::recover_expired_batches_in(tx, 31_000)?, (1, 0));
            Ok(())
        })
    }

    pub(super) fn push_assert_transmitting_recovery_ambiguous_for_test(
        &mut self,
        batch_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            assert_eq!(crate::push::recover_expired_batches_in(tx, 62_000)?, (0, 1));
            let (batch_state, message_state, token_snapshot): (String, String, String) = tx
                .query_row(
                    "SELECT batch.state, message.state, message.token_bytes
                     FROM _snapback_push_batches_v1 AS batch
                     JOIN _snapback_push_messages_v1 AS message ON message.batch_id = batch.id
                     WHERE batch.id = ?1",
                    params![batch_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
            assert_eq!(
                (batch_state.as_str(), message_state.as_str()),
                ("ambiguous", "ambiguous")
            );
            assert!(token_snapshot.is_empty());
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_seed_retired_recovery_for_test(
        &mut self,
        retired_intent: &str,
        retired_batch: &str,
        retired_message: &str,
        live_message: &str,
        live_token_id: &str,
        live_installation_id: &str,
        live_hash: &[u8],
        token_id: &str,
        rotated_hash: &[u8],
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_push_tokens_v1(
                   id, app_scope, principal_id, installation_id, token_hash, token_bytes,
                   session_id, session_generation, registered_at_ms, last_registered_at_ms
                 ) VALUES(?1, 'scope', 'other-user', ?2, ?3, 'ExponentPushToken[live]',
                          'other-session', 1, 1, 1)",
                params![live_token_id, live_installation_id, live_hash],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_intents_v1(
                   id, app_scope, dedupe_key, binding_hash, audience_name,
                   audience_args_json, payload_json, trigger_mode, state,
                   attempt_count, created_at_ms, updated_at_ms, expires_at_ms
                 ) VALUES(?1, 'scope', 'dedupe-retired', zeroblob(32), 'guests', '{}',
                          '{}', 'system', 'reserved', 1, 1, 1, 100000000)",
                params![retired_intent],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_batches_v1(
                   id, intent_id, attempt_number, batch_index, state
                 ) VALUES(?1, ?2, 1, 0, 'reserved')",
                params![retired_batch, retired_intent],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_messages_v1(
                   id, batch_id, token_id, token_hash, token_bytes, state
                 ) VALUES(?1, ?2, ?3, ?4, 'ExponentPushToken[rotated]', 'reserved')",
                params![retired_message, retired_batch, token_id, rotated_hash],
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_messages_v1(
                   id, batch_id, token_id, token_hash, token_bytes, state
                 ) VALUES(?1, ?2, ?3, ?4, 'ExponentPushToken[live]', 'reserved')",
                params![live_message, retired_batch, live_token_id, live_hash],
            )?;
            crate::push::retire_provider_token_in(tx, token_id, 70_000, "ticket:retired")?;
            Ok(())
        })
    }

    pub(super) fn push_settle_mixed_retired_recovery_for_test(
        &mut self,
        claim: &crate::push::PushBatchClaimV1,
        retired_batch: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            crate::push::mark_batch_transmitting_in(tx, claim, 70_002)?;
            crate::push::settle_batch_in(
                tx,
                claim,
                &crate::push::PushBatchSettlementV1::Tickets {
                    http_status: 200,
                    outcomes: vec![crate::push::PushTicketOutcomeV1::Ok {
                        ticket_id: "mixed-ticket".into(),
                    }],
                },
                70_003,
            )?;
            let states: Vec<(String, String)> = {
                let mut statement = tx.prepare(
                    "SELECT state, token_bytes FROM _snapback_push_messages_v1
                     WHERE batch_id = ?1 ORDER BY id",
                )?;
                statement
                    .query_map(params![retired_batch], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<Result<Vec<_>, _>>()?
            };
            assert!(states.contains(&("failed-permanent".into(), String::new())));
            assert!(states.contains(&("handed-to-expo".into(), String::new())));
            Ok(())
        })
    }
}

#[cfg(test)]
impl LocalDatabase {
    pub(super) fn push_create_lookalike_registry_for_test(
        &mut self,
        tampered_table: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute_batch(tampered_table)?;
            Ok(())
        })
    }

    pub(super) fn push_activate_manifest_with_for_test(
        &mut self,
        declaration: impl FnOnce() -> crate::push::PushSeamDeclarationV1,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            let declaration = declaration();
            crate::push::activate_manifest_in(tx, Some(&declaration))
        })
    }

    pub(super) fn push_tamper_registry_index_for_test(&mut self) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute_batch(
                "DROP INDEX _snapback_push_tokens_v1_owner_live;
                 CREATE UNIQUE INDEX _snapback_push_tokens_v1_owner_live
                   ON _snapback_push_tokens_v1(app_scope, token_hash)
                   WHERE retired_at_ms IS NULL;",
            )?;
            let expected_sql = crate::push::expected_registry_owner_index_sql_for_test()?;
            tx.execute_batch("PRAGMA writable_schema = ON;")?;
            tx.execute(
                "UPDATE sqlite_schema SET sql = ?1
                 WHERE name = '_snapback_push_tokens_v1_owner_live'",
                params![expected_sql],
            )?;
            tx.execute_batch("PRAGMA writable_schema = OFF;")?;
            Ok(())
        })
    }

    pub(super) fn push_tamper_lifecycle_trigger_for_test(&mut self) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute_batch(
                "DROP TRIGGER _snapback_push_session_terminal_v1;
                 CREATE TRIGGER _snapback_push_session_terminal_v1
                   AFTER DELETE ON _auth_sessions
                 BEGIN
                   SELECT 1;
                 END;",
            )?;
            Ok(())
        })
    }

    pub(super) fn push_provider_retirement_for_test(
        &mut self,
        token_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_push_tokens_v1(
                   id, app_scope, principal_id, installation_id, token_hash, token_bytes,
                   session_id, session_generation, registered_at_ms, last_registered_at_ms
                 ) VALUES(?1, 'scope', 'user', 'installation', zeroblob(32), ?2,
                          'session', 1, 1, 1)",
                params![token_id, "ExponentPushToken[secret]"],
            )?;
            assert!(crate::push::retire_provider_token_in(
                tx,
                token_id,
                2,
                "ticket:t1"
            )?);
            assert!(!crate::push::retire_provider_token_in(
                tx,
                token_id,
                3,
                "receipt:r1"
            )?);
            let arbitrary = crate::push::retire_provider_token_in(
                tx,
                token_id,
                4,
                "Expo said token ExponentPushToken[secret] failed",
            )
            .expect_err("free-text provider prose is not an evidence reference");
            assert_eq!(arbitrary.diagnostic.code, "SNAPBACK_PUSH_TOKEN_INVALID");
            assert!(!format!("{arbitrary:?}").contains("ExponentPushToken"));
            let row: (String, String, String) = tx.query_row(
                "SELECT token_bytes, retirement_reason, retirement_reference
                 FROM _snapback_push_tokens_v1 WHERE id = ?1",
                params![token_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            assert_eq!(
                row,
                (
                    String::new(),
                    "device-not-registered".into(),
                    "ticket:t1".into()
                )
            );
            Ok(())
        })
    }

    pub(super) fn push_registry_facts_for_test(
        &self,
        predecessor_token_id: &str,
    ) -> SnapbackResult<(i64, (String, String))> {
        self.with_auth_read(|conn| {
            let live = conn.query_row(
                "SELECT COUNT(*) FROM _snapback_push_tokens_v1 WHERE retired_at_ms IS NULL",
                [],
                |row| row.get(0),
            )?;
            let predecessor = conn.query_row(
                "SELECT token_bytes, retirement_reason FROM _snapback_push_tokens_v1 WHERE id = ?1",
                params![predecessor_token_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok((live, predecessor))
        })
    }

    pub(super) fn push_logout_session_for_test(&mut self, session_id: &str) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_sessions SET generation = 2, revoked_at_ms = 200
                 WHERE id = ?1 AND generation = 1",
                params![session_id],
            )?;
            crate::storage::auth::write_session_terminal_cause_in(
                tx,
                session_id,
                2,
                200,
                crate::contract_types::RevocationReason::Logout,
            )
        })
    }

    pub(super) fn push_durable_revoke_session_for_test(
        &mut self,
        session_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_sessions SET generation = 2, revoked_at_ms = 202
                 WHERE id = ?1 AND generation = 1",
                params![session_id],
            )?;
            crate::storage::auth::write_session_terminal_cause_in(
                tx,
                session_id,
                2,
                202,
                crate::contract_types::RevocationReason::DurableRevocation,
            )
        })
    }

    pub(super) fn push_session_retirement_facts_for_test(
        &self,
    ) -> SnapbackResult<Vec<(String, Option<String>, String)>> {
        self.with_auth_read(|conn| {
            let mut statement = conn.prepare(
                "SELECT session_id, retirement_reason, token_bytes
                 FROM _snapback_push_tokens_v1 ORDER BY session_id",
            )?;
            Ok(statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub(super) fn push_token_bytes_for_test(&self) -> SnapbackResult<String> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT token_bytes FROM _snapback_push_tokens_v1",
                [],
                |row| row.get(0),
            )?)
        })
    }

    pub(super) fn push_assert_idle_retention_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        retention: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            assert_eq!(
                crate::push::retire_idle_in(tx, declaration, retention + 99)?,
                0
            );
            assert_eq!(
                crate::push::retire_idle_in(tx, declaration, retention + 100)?,
                1
            );
            Ok(())
        })
    }
}

/// Narrow typed access to push-registry and handoff-ledger storage operations.
///
/// @ref LLP 0225#1-ownership-map — push services enter the storage
/// kernel through typed operations instead of a raw auth-catalog transaction.
pub struct PushRegistryKernel<'a> {
    db: &'a mut LocalDatabase,
}

#[allow(private_interfaces)]
impl<'a> PushRegistryKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn activate_current_auth_catalog(&mut self) -> SnapbackResult<()> {
        self.db.activate_current_auth_catalog()
    }

    pub fn push_registry_inspection(
        &self,
    ) -> SnapbackResult<crate::push::PushRegistryInspectionV1> {
        self.db.push_registry_inspection()
    }

    #[cfg(test)]
    pub fn activate_push_registry_for_test(
        &mut self,
        declaration: crate::push::PushSeamDeclarationV1,
    ) -> SnapbackResult<()> {
        self.db.activate_push_registry_for_test(declaration)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn register(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        token: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::PushTokenRegistrationResponse> {
        self.db.push_register(
            declaration,
            principal_id,
            session_id,
            session_generation,
            installation_id,
            token,
            now_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn unregister(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::PushTokenUnregisterResponse> {
        self.db.push_unregister(
            declaration,
            principal_id,
            session_id,
            session_generation,
            installation_id,
            now_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reserve_send(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> crate::auth::invocation::PreparedAuthority,
        trigger_mode: crate::push::PushTriggerModeV1,
        deferred_grant: Option<&crate::push::PushDeferredGrantV1>,
        request: &crate::push::PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::ReservedPushAttemptV1> {
        self.db.push_reserve_send(
            declaration,
            schema,
            authority,
            trigger_mode,
            deferred_grant,
            request,
            now_ms,
        )
    }

    pub fn claim_batch(
        &mut self,
        batch_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<crate::push::PushBatchClaimV1>> {
        self.db.push_claim_batch(batch_id, now_ms)
    }

    pub fn mark_batch_transmitting(
        &mut self,
        claim: &crate::push::PushBatchClaimV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.push_mark_batch_transmitting(claim, now_ms)
    }

    pub fn settle_batch(
        &mut self,
        claim: &crate::push::PushBatchClaimV1,
        settlement: &crate::push::PushBatchSettlementV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.push_settle_batch(claim, settlement, now_ms)
    }

    pub fn claim_due_receipts(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<crate::push::PushReceiptPollClaimV1> {
        self.db.push_claim_due_receipts(now_ms)
    }

    pub fn claim_maintenance(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<(
        Option<crate::push::PushRecoveredBatchV1>,
        crate::push::PushReceiptPollClaimV1,
    )> {
        self.db.push_claim_maintenance(now_ms)
    }

    pub fn settle_receipt_poll(
        &mut self,
        claim: &crate::push::PushReceiptPollClaimV1,
        outcomes: &std::collections::BTreeMap<String, crate::push::PushReceiptOutcomeV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.push_settle_receipt_poll(claim, outcomes, now_ms)
    }

    pub fn recover_expired_batches(&mut self, now_ms: u64) -> SnapbackResult<(usize, usize)> {
        self.db.push_recover_expired_batches(now_ms)
    }

    pub fn claim_recovered_batch_for_transmit(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Option<crate::push::PushRecoveredBatchV1>> {
        self.db.push_claim_recovered_batch_for_transmit(now_ms)
    }

    pub fn activate_manifest(
        &mut self,
        declaration: Option<&crate::push::PushSeamDeclarationV1>,
    ) -> SnapbackResult<()> {
        self.db.push_activate_manifest(declaration)
    }

    pub fn validate_exact_ledger_schema(&self) -> SnapbackResult<()> {
        self.db.push_validate_exact_ledger_schema()
    }

    pub fn intent_state(&self, intent_id: &str) -> SnapbackResult<String> {
        self.db.push_intent_state(intent_id)
    }

    pub fn retire_idle(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.push_retire_idle(declaration, now_ms)
    }
}

#[cfg(test)]
#[allow(private_interfaces)]
impl PushRegistryKernel<'_> {
    pub fn insert_session_for_test(
        &mut self,
        principal_id: &str,
        session_id: &str,
        generation: u64,
        expires_at_ms: u64,
        discriminator: u8,
    ) -> SnapbackResult<()> {
        self.db.push_insert_session_for_test(
            principal_id,
            session_id,
            generation,
            expires_at_ms,
            discriminator,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn seed_ledger_projection_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        intent_id: &str,
        batch_id: &str,
        message_id: &str,
        token_id: &str,
        audience_args: &str,
    ) -> SnapbackResult<()> {
        self.db.push_seed_ledger_projection_for_test(
            declaration,
            intent_id,
            batch_id,
            message_id,
            token_id,
            audience_args,
        )
    }

    pub fn seed_acceptance_audience_and_tokens_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        principal_ok: &str,
        principal_ticket_dnr: &str,
        principal_receipt_dnr: &str,
    ) -> SnapbackResult<(String, String, String)> {
        self.db.push_seed_acceptance_audience_and_tokens_for_test(
            declaration,
            principal_ok,
            principal_ticket_dnr,
            principal_receipt_dnr,
        )
    }

    pub fn assert_acceptance_ledger_outcomes_for_test(
        &self,
        expected: &[(&str, &str, bool)],
    ) -> SnapbackResult<()> {
        self.db
            .push_assert_acceptance_ledger_outcomes_for_test(expected)
    }

    pub fn seed_drop_audience_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        drop_principal: &str,
    ) -> SnapbackResult<()> {
        self.db
            .push_seed_drop_audience_for_test(declaration, drop_principal)
    }

    pub fn assert_no_expired_batch_recovery_for_test(&mut self, now_ms: u64) -> SnapbackResult<()> {
        self.db
            .push_assert_no_expired_batch_recovery_for_test(now_ms)
    }

    pub fn redrive_previous_ambiguous_for_test(&self, batch_id: &str) -> SnapbackResult<()> {
        self.db.push_redrive_previous_ambiguous_for_test(batch_id)
    }

    pub fn object_names_for_test(&self) -> SnapbackResult<Vec<String>> {
        self.db.push_object_names_for_test()
    }

    pub fn ledger_table_names_for_test(&self) -> SnapbackResult<Vec<String>> {
        self.db.push_ledger_table_names_for_test()
    }

    pub fn tamper_ledger_index_for_test(&mut self) -> SnapbackResult<()> {
        self.db.push_tamper_ledger_index_for_test()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn seed_mixed_batch_aggregate_for_test(
        &mut self,
        intent_id: &str,
        ambiguous_batch: &str,
        pending_batch: &str,
        failed_batch: &str,
        ambiguous_message: &str,
        pending_message: &str,
        failed_message: &str,
    ) -> SnapbackResult<()> {
        self.db.push_seed_mixed_batch_aggregate_for_test(
            intent_id,
            ambiguous_batch,
            pending_batch,
            failed_batch,
            ambiguous_message,
            pending_message,
            failed_message,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn seed_reserved_recovery_for_test(
        &mut self,
        token_id: &str,
        intent_id: &str,
        batch_id: &str,
        message_id: &str,
        installation_id: &str,
        first_hash: &[u8],
    ) -> SnapbackResult<()> {
        self.db.push_seed_reserved_recovery_for_test(
            token_id,
            intent_id,
            batch_id,
            message_id,
            installation_id,
            first_hash,
        )
    }

    pub fn rotate_token_and_recover_reserved_for_test(
        &mut self,
        token_id: &str,
        rotated_hash: &[u8],
    ) -> SnapbackResult<()> {
        self.db
            .push_rotate_token_and_recover_reserved_for_test(token_id, rotated_hash)
    }

    pub fn assert_transmitting_recovery_ambiguous_for_test(
        &mut self,
        batch_id: &str,
    ) -> SnapbackResult<()> {
        self.db
            .push_assert_transmitting_recovery_ambiguous_for_test(batch_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn seed_retired_recovery_for_test(
        &mut self,
        retired_intent: &str,
        retired_batch: &str,
        retired_message: &str,
        live_message: &str,
        live_token_id: &str,
        live_installation_id: &str,
        live_hash: &[u8],
        token_id: &str,
        rotated_hash: &[u8],
    ) -> SnapbackResult<()> {
        self.db.push_seed_retired_recovery_for_test(
            retired_intent,
            retired_batch,
            retired_message,
            live_message,
            live_token_id,
            live_installation_id,
            live_hash,
            token_id,
            rotated_hash,
        )
    }

    pub fn settle_mixed_retired_recovery_for_test(
        &mut self,
        claim: &crate::push::PushBatchClaimV1,
        retired_batch: &str,
    ) -> SnapbackResult<()> {
        self.db
            .push_settle_mixed_retired_recovery_for_test(claim, retired_batch)
    }

    pub fn create_lookalike_registry_for_test(
        &mut self,
        tampered_table: &str,
    ) -> SnapbackResult<()> {
        self.db
            .push_create_lookalike_registry_for_test(tampered_table)
    }

    pub fn activate_manifest_with_for_test(
        &mut self,
        declaration: impl FnOnce() -> crate::push::PushSeamDeclarationV1,
    ) -> SnapbackResult<()> {
        self.db.push_activate_manifest_with_for_test(declaration)
    }

    pub fn tamper_registry_index_for_test(&mut self) -> SnapbackResult<()> {
        self.db.push_tamper_registry_index_for_test()
    }

    pub fn tamper_lifecycle_trigger_for_test(&mut self) -> SnapbackResult<()> {
        self.db.push_tamper_lifecycle_trigger_for_test()
    }

    pub fn provider_retirement_for_test(&mut self, token_id: &str) -> SnapbackResult<()> {
        self.db.push_provider_retirement_for_test(token_id)
    }

    pub fn registry_facts_for_test(
        &self,
        predecessor_token_id: &str,
    ) -> SnapbackResult<(i64, (String, String))> {
        self.db.push_registry_facts_for_test(predecessor_token_id)
    }

    pub fn logout_session_for_test(&mut self, session_id: &str) -> SnapbackResult<()> {
        self.db.push_logout_session_for_test(session_id)
    }

    pub fn durable_revoke_session_for_test(&mut self, session_id: &str) -> SnapbackResult<()> {
        self.db.push_durable_revoke_session_for_test(session_id)
    }

    pub fn session_retirement_facts_for_test(
        &self,
    ) -> SnapbackResult<Vec<(String, Option<String>, String)>> {
        self.db.push_session_retirement_facts_for_test()
    }

    pub fn token_bytes_for_test(&self) -> SnapbackResult<String> {
        self.db.push_token_bytes_for_test()
    }

    pub fn assert_idle_retention_for_test(
        &mut self,
        declaration: &crate::push::PushSeamDeclarationV1,
        retention: u64,
    ) -> SnapbackResult<()> {
        self.db
            .push_assert_idle_retention_for_test(declaration, retention)
    }
}
