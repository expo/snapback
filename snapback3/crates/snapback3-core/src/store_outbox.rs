use super::*;

const UNKNOWN_CLEANUP_LIMIT: usize = 64;
const RECOVERY_PAGE_LIMIT: usize = 64;

impl Store {
    pub(crate) fn effect_claims_without_target_identity(
        &self,
        declared_names: &[String],
    ) -> Result<BTreeMap<String, EffectClaimBinding>, RuntimeError> {
        let effects = self
            .meta("effects_json")?
            .map(|json| {
                serde_json::from_str::<BTreeMap<String, EffectDecl>>(&json)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))
            })
            .transpose()?
            .unwrap_or_default();
        Ok(declared_names
            .iter()
            .filter_map(|name| {
                effects.get(name).map(|declaration| {
                    (
                        name.clone(),
                        EffectClaimBinding {
                            then_op: declaration.then.clone(),
                            identity: None,
                        },
                    )
                })
            })
            .collect())
    }

    /// Fail at most 64 unknown rows and claim at most one due declared row in
    /// one transaction. Neither cleanup work nor its returned report can grow
    /// with the complete outbox.
    pub(crate) fn outbox_claim_next_bound(
        &self,
        now: i64,
        declarations: &BTreeMap<String, EffectClaimBinding>,
    ) -> Result<OutboxClaim, RuntimeError> {
        let transaction = self.conn.unchecked_transaction()?;
        let names = declarations.keys().collect::<Vec<_>>();
        let unknown_predicate = not_in_predicate(&names, 1);
        let unknown_sql = format!(
            "SELECT id FROM _outbox WHERE state = 'queued'{unknown_predicate}
             ORDER BY seq, id LIMIT {}",
            UNKNOWN_CLEANUP_LIMIT + 1
        );
        let mut unknown_ids = {
            let mut statement = transaction.prepare(&unknown_sql)?;
            statement
                .query_map(params_from_iter(names.iter().copied()), |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        unknown_ids.truncate(UNKNOWN_CLEANUP_LIMIT);
        let mut failed = Vec::with_capacity(unknown_ids.len());
        for id in unknown_ids {
            transaction.execute(
                "UPDATE _outbox SET state = 'failed', last_error = 'E_EFFECT_UNKNOWN',
                        updated_at = ?1 WHERE id = ?2 AND state = 'queued'",
                params![now, id],
            )?;
            if let Some(row) = outbox_get_connection(&transaction, &id)? {
                failed.push(row);
            }
        }

        let mut claim = OutboxClaim {
            failed,
            claimed: None,
            more: false,
        };
        if !names.is_empty() {
            let placeholders = placeholders(names.len(), 2);
            let candidate_sql = format!(
                "SELECT id, effect FROM _outbox
                 WHERE state = 'queued' AND next_at <= ?1 AND effect IN ({placeholders})
                 ORDER BY next_at, created_at, id LIMIT 1"
            );
            let candidate = transaction
                .query_row(
                    &candidate_sql,
                    params_from_iter(
                        std::iter::once(&now as &dyn rusqlite::ToSql)
                            .chain(names.iter().map(|name| *name as &dyn rusqlite::ToSql)),
                    ),
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            if let Some((id, effect)) = candidate {
                let declaration = declarations.get(&effect).ok_or_else(|| {
                    RuntimeError::Serialization(format!(
                        "declared effect {effect} has no claim binding"
                    ))
                })?;
                let generation = transaction
                    .query_row(
                        "SELECT value FROM _meta WHERE key = 'effects_generation'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                let changed = transaction.execute(
                    "UPDATE _outbox SET state = 'running', attempts = attempts + 1,
                            then_op = ?1, generation = ?2, claim_binding = ?3, updated_at = ?4
                     WHERE id = ?5 AND state = 'queued' AND next_at <= ?4",
                    params![
                        declaration.then_op.as_deref(),
                        generation,
                        declaration.identity.as_deref(),
                        now,
                        id
                    ],
                )?;
                if changed == 1 {
                    claim.claimed = outbox_get_connection(&transaction, &id)?;
                }
            }
        }
        claim.more = immediate_work(&transaction, now, &names)?;
        transaction.commit()?;
        Ok(claim)
    }

    pub fn outbox_has_immediate_work(
        &self,
        now: i64,
        declared_names: &[String],
    ) -> Result<bool, RuntimeError> {
        let names = declared_names.iter().collect::<Vec<_>>();
        immediate_work(&self.conn, now, &names)
    }

    /// Bounded operator recovery view. Provider payloads and results never
    /// enter this listing.
    pub fn outbox_recovery_page(
        &self,
        state: &str,
        after: &str,
        limit: usize,
    ) -> Result<OutboxRecoveryPage, RuntimeError> {
        if !matches!(state, "sent_unknown" | "failed") {
            return Err(RuntimeError::Input(
                "effect recovery state must be sent_unknown or failed".into(),
            ));
        }
        if limit == 0 || limit > RECOVERY_PAGE_LIMIT {
            return Err(RuntimeError::Input(
                "effect recovery page limit must be between 1 and 64".into(),
            ));
        }
        let mut statement = self.conn.prepare(
            "SELECT id, effect, state, attempts, last_error, created_at, updated_at
             FROM _outbox WHERE state = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
        )?;
        let mut items = statement
            .query_map(
                params![state, after, i64::try_from(limit + 1).unwrap_or(i64::MAX)],
                |row| {
                    Ok(OutboxRecoverySummary {
                        id: row.get(0)?,
                        effect: row.get(1)?,
                        state: row.get(2)?,
                        attempts: row.get::<_, i64>(3)?.max(0) as u32,
                        last_error: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let continuation = (items.len() > limit).then(|| items[limit - 1].id.clone());
        items.truncate(limit);
        Ok(OutboxRecoveryPage {
            items,
            continuation,
        })
    }
}

fn placeholders(count: usize, start: usize) -> String {
    (0..count)
        .map(|index| format!("?{}", start + index))
        .collect::<Vec<_>>()
        .join(", ")
}

fn not_in_predicate(names: &[&String], start: usize) -> String {
    if names.is_empty() {
        String::new()
    } else {
        format!(" AND effect NOT IN ({})", placeholders(names.len(), start))
    }
}

fn immediate_work(
    connection: &Connection,
    now: i64,
    names: &[&String],
) -> Result<bool, RuntimeError> {
    let unknown = not_in_predicate(names, 2);
    let due = if names.is_empty() {
        "0".to_owned()
    } else {
        format!(
            "EXISTS(SELECT 1 FROM _outbox WHERE state = 'queued' AND next_at <= ?1
                    AND effect IN ({}))",
            placeholders(names.len(), 2)
        )
    };
    let sql = format!(
        "SELECT EXISTS(SELECT 1 FROM _outbox WHERE state = 'then_pending')
             OR EXISTS(SELECT 1 FROM _outbox WHERE state = 'queued'{unknown}
                       AND ?1 IS NOT NULL)
             OR {due}"
    );
    Ok(connection.query_row(
        &sql,
        params_from_iter(
            std::iter::once(&now as &dyn rusqlite::ToSql)
                .chain(names.iter().map(|name| *name as &dyn rusqlite::ToSql)),
        ),
        |row| row.get(0),
    )?)
}
