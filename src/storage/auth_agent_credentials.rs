//! LLP 0055 G3: agent credential families and scoped token lifecycle.
//!
//! Rotation keeps the live credential row's stable id and moves every prior
//! hash into a revoked row in the same protected table. Those family rows are
//! retained by time only, never by count, so a thief cannot rotate-to-evict an
//! owner's destroy-only `revoke-self` secret.
//!
//! @ref LLP 0055#credentials-and-tokens — one live credential, one-hour
//!   rotation throttle, thirty-day family retention, grant-bound tokens with a
//!   24-hour ceiling, and oldest-token eviction at the live cap.

use super::auth_invalidation::{AUTH_CLOCK_META_KEY, strict_meta_u64, write_meta_u64};
use super::{LocalDatabase, MAX_AUTHORIZATION_EPOCH, new_id};
use crate::auth::crypto::{AgentCredential, RandomSource, ScopedToken};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::Value;

pub const AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS: u64 = 60 * 60 * 1_000;
pub const AGENT_CREDENTIAL_FAMILY_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const SCOPED_TOKEN_DEFAULT_TTL_MS: u64 = 60 * 60 * 1_000;
pub const SCOPED_TOKEN_MAX_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
pub const SCOPED_TOKEN_LIVE_CAP: u64 = 10;
const LAST_USED_COALESCE_MS: u64 = 5 * 60 * 1_000;
const SECRET_COLLISION_RETRY_LIMIT: usize = 3;

#[derive(Debug)]
pub struct IssuedAgentCredential {
    pub credential_id: String,
    pub user_id: String,
    pub generation: u64,
    pub secret: AgentCredential,
}

#[derive(Debug)]
pub struct RotatedAgentCredential {
    pub credential_id: String,
    pub user_id: String,
    pub predecessor_generation: u64,
    pub generation: u64,
    pub invalidated_token_ids: Vec<String>,
    pub secret: AgentCredential,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedAgentCredential {
    pub credential_id: String,
    pub user_id: String,
    pub generation: u64,
}

#[derive(Debug)]
pub struct IssuedScopedToken {
    pub token_id: String,
    pub grant_id: String,
    pub credential_id: String,
    pub credential_generation: u64,
    pub expires_at_ms: u64,
    pub evicted_token_ids: Vec<String>,
    pub secret: ScopedToken,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedScopedToken {
    pub token_id: String,
    pub grant_id: String,
    pub actor_user_id: String,
    pub effective_user_id: Option<String>,
    pub credential_id: String,
    pub credential_generation: u64,
    pub scopes: Value,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AgentFamilyRevocation {
    pub user_id: Option<String>,
    pub credential_ids: Vec<String>,
    pub token_ids: Vec<String>,
    pub grant_ids: Vec<String>,
}

impl LocalDatabase {
    /// Create the first live credential for an existing, active agent. The
    /// identity subject is the stable credential id; rotations update the
    /// secret and generation without changing it.
    pub(crate) fn issue_initial_agent_credential(
        &mut self,
        user_id: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentCredential> {
        self.observe_agent_authorization_clock(now_ms)?;
        let credential_id = new_id();
        let identity_id = new_id();
        let secret = self.with_auth_transaction(|tx| {
            require_agent_active_on(tx, user_id)?;
            require_agent_clock_on(tx, now_ms)?;
            let secret = generate_unique_agent_credential_on(tx, random)?;
            let hash = secret.token_hash();
            tx.execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, 1, ?4, ?4, ?4, NULL)",
                params![credential_id, user_id, hash.as_bytes(), now_ms as i64],
            )
            .map_err(map_live_credential_constraint)?;
            tx.execute(
                "INSERT INTO _auth_identities(
                   id, user_id, provider, subject, verified_at_ms
                 ) VALUES(?1, ?2, 'agent-credential', ?3, ?4)",
                params![identity_id, user_id, credential_id, now_ms as i64],
            )?;
            Ok(secret)
        })?;
        Ok(IssuedAgentCredential {
            credential_id,
            user_id: user_id.to_owned(),
            generation: 1,
            secret,
        })
    }

    /// Resolve only the current live generation. Rotated and revoked family
    /// secrets deliberately retain destroy-only attribution but authenticate
    /// nowhere else.
    pub(crate) fn resolve_agent_credential(
        &mut self,
        credential: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedAgentCredential> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = credential.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let resolved = live_credential_by_hash(tx, hash.as_bytes())?
                .ok_or_else(agent_credential_invalid)?;
            require_agent_active_on(tx, &resolved.user_id)?;
            coalesce_credential_use(tx, &resolved.credential_id, now_ms)?;
            Ok(resolved)
        })
    }

    /// Rotate with revocation strength. The predecessor hash becomes a
    /// time-retained revoked family row, every prior-generation token is
    /// terminally revoked, and the live row keeps its stable id.
    pub(crate) fn rotate_agent_credential(
        &mut self,
        credential: &AgentCredential,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<RotatedAgentCredential> {
        self.observe_agent_authorization_clock(now_ms)?;
        let predecessor_hash = credential.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            sweep_credential_family_on(tx, now_ms)?;
            let row = credential_row_by_hash(tx, predecessor_hash.as_bytes())?
                .filter(|row| row.revoked_at_ms.is_none())
                .ok_or_else(agent_credential_invalid)?;
            require_agent_active_on(tx, &row.user_id)?;
            if now_ms
                < row
                    .rotated_at_ms
                    .saturating_add(AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS)
            {
                return Err(agent_credential_rotation_throttled());
            }
            let successor_generation = row
                .generation
                .checked_add(1)
                .filter(|generation| *generation <= i64::MAX as u64)
                .ok_or_else(agent_credential_state_corrupt)?;
            let successor = generate_unique_agent_credential_on(tx, random)?;
            let successor_hash = successor.token_hash();
            tx.execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    new_id(),
                    row.user_id,
                    predecessor_hash.as_bytes(),
                    row.generation as i64,
                    row.created_at_ms as i64,
                    row.rotated_at_ms as i64,
                    row.last_used_at_ms as i64,
                    now_ms as i64,
                ],
            )?;
            let invalidated_token_ids = live_token_ids_for_credential(tx, &row.id)?;
            tx.execute(
                "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                 WHERE credential_id = ?2 AND revoked_at_ms IS NULL",
                params![now_ms as i64, row.id],
            )?;
            tx.execute(
                "UPDATE _auth_agent_credentials
                 SET secret_hash = ?1, generation = ?2, rotated_at_ms = ?3,
                     last_used_at_ms = ?3
                 WHERE id = ?4 AND revoked_at_ms IS NULL",
                params![
                    successor_hash.as_bytes(),
                    successor_generation as i64,
                    now_ms as i64,
                    row.id,
                ],
            )?;
            Ok(RotatedAgentCredential {
                credential_id: row.id,
                user_id: row.user_id,
                predecessor_generation: row.generation,
                generation: successor_generation,
                invalidated_token_ids,
                secret: successor,
            })
        })
    }

    /// Destroy the complete attributable credential family. Any family secret
    /// retained inside the thirty-day horizon reaches this path, including N-2
    /// and older generations; none can authenticate or mint authority.
    pub(crate) fn revoke_agent_credential_family(
        &mut self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = attributable.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            sweep_credential_family_on(tx, now_ms)?;
            let Some(row) = credential_row_by_hash(tx, hash.as_bytes())? else {
                return Err(agent_credential_invalid());
            };
            let credential_ids = credential_ids_for_user(tx, &row.user_id)?;
            let token_ids = live_token_ids_for_user(tx, &row.user_id)?;
            let grant_ids = live_grant_ids_for_actor(tx, &row.user_id)?;
            tx.execute(
                "UPDATE _auth_agent_credentials SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE user_id = ?2",
                params![now_ms as i64, row.user_id],
            )?;
            tx.execute(
                "UPDATE _auth_grant_tokens SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE credential_id IN (
                   SELECT id FROM _auth_agent_credentials WHERE user_id = ?2
                 )",
                params![now_ms as i64, row.user_id],
            )?;
            tx.execute(
                "UPDATE _auth_grants SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE actor_user_id = ?2",
                params![now_ms as i64, row.user_id],
            )?;
            Ok(AgentFamilyRevocation {
                user_id: Some(row.user_id),
                credential_ids,
                token_ids,
                grant_ids,
            })
        })
    }

    /// Mint one grant-bound scoped token under the current live credential
    /// generation. The eleventh live token atomically revokes the oldest and
    /// returns its id for connection invalidation projection.
    pub(crate) fn mint_scoped_token(
        &mut self,
        credential: &AgentCredential,
        grant_id: &str,
        ttl_ms: Option<u64>,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        let ttl_ms = ttl_ms.unwrap_or(SCOPED_TOKEN_DEFAULT_TTL_MS);
        if ttl_ms == 0 || ttl_ms > SCOPED_TOKEN_MAX_TTL_MS {
            return Err(scoped_token_ttl_invalid());
        }
        let expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .filter(|expiry| *expiry <= MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(scoped_token_ttl_invalid)?;
        self.observe_agent_authorization_clock(now_ms)?;
        let secret = ScopedToken::generate(random).map_err(|_| secret_generation_failed())?;
        let token_hash = secret.token_hash();
        let token_id = new_id();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let resolved = live_credential_by_hash(tx, credential.token_hash().as_bytes())?
                .ok_or_else(agent_credential_invalid)?;
            require_agent_active_on(tx, &resolved.user_id)?;
            let grant_expires_at_ms =
                require_live_grant_for_actor(tx, grant_id, &resolved.user_id, now_ms)?;
            let expires_at_ms = grant_expires_at_ms
                .map_or(expires_at_ms, |grant_expiry| expires_at_ms.min(grant_expiry));
            let mut live = live_token_ids_for_grant(tx, grant_id, now_ms)?;
            let mut evicted_token_ids = Vec::new();
            while live.len() as u64 >= SCOPED_TOKEN_LIVE_CAP {
                let evicted = live.remove(0);
                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                     WHERE id = ?2 AND revoked_at_ms IS NULL",
                    params![now_ms as i64, evicted],
                )?;
                evicted_token_ids.push(evicted);
            }
            tx.execute(
                "INSERT INTO _auth_grant_tokens(
                   id, token_hash, grant_id, credential_id,
                   credential_generation, created_at_ms, expires_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                params![
                    token_id,
                    token_hash.as_bytes(),
                    grant_id,
                    resolved.credential_id,
                    resolved.generation as i64,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )?;
            coalesce_credential_use(tx, &resolved.credential_id, now_ms)?;
            Ok(IssuedScopedToken {
                token_id,
                grant_id: grant_id.to_owned(),
                credential_id: resolved.credential_id,
                credential_generation: resolved.generation,
                expires_at_ms,
                evicted_token_ids,
                secret,
            })
        })
    }

    /// Per-invocation scoped-token validation. TTL is only a theft-window
    /// bound: every call also proves the grant, credential generation, and
    /// principal remain live.
    pub(crate) fn resolve_scoped_token(
        &mut self,
        token: &ScopedToken,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedScopedToken> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = token.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let row: Option<(
                String,
                String,
                String,
                Option<String>,
                String,
                i64,
                String,
                i64,
            )> = tx
                .query_row(
                    "SELECT t.id, g.id, g.actor_user_id, g.effective_user_id,
                            t.credential_id, t.credential_generation, g.scopes,
                            t.expires_at_ms
                     FROM _auth_grant_tokens AS t
                     JOIN _auth_grants AS g ON g.id = t.grant_id
                     JOIN _auth_agent_credentials AS c ON c.id = t.credential_id
                     JOIN _auth_users AS u ON u.id = g.actor_user_id
                     WHERE t.token_hash = ?1
                       AND t.revoked_at_ms IS NULL AND t.expires_at_ms > ?2
                       AND g.revoked_at_ms IS NULL
                       AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?2)
                       AND c.revoked_at_ms IS NULL
                       AND c.generation = t.credential_generation
                       AND c.user_id = g.actor_user_id
                       AND u.kind = 'agent' AND u.deactivated_at_ms IS NULL",
                    params![hash.as_bytes(), now_ms as i64],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                            row.get(6)?,
                            row.get(7)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                token_id,
                grant_id,
                actor_user_id,
                effective_user_id,
                credential_id,
                generation,
                scopes,
                expires_at_ms,
            )) = row
            else {
                return Err(scoped_token_invalid());
            };
            let scopes =
                serde_json::from_str(&scopes).map_err(|_| agent_credential_state_corrupt())?;
            coalesce_credential_use(tx, &credential_id, now_ms)?;
            tx.execute(
                "UPDATE _auth_grants SET last_used_at_ms = ?1
                 WHERE id = ?2 AND last_used_at_ms <= ?3",
                params![
                    now_ms as i64,
                    grant_id,
                    now_ms.saturating_sub(LAST_USED_COALESCE_MS) as i64,
                ],
            )?;
            Ok(ResolvedScopedToken {
                token_id,
                grant_id,
                actor_user_id,
                effective_user_id,
                credential_id,
                credential_generation: generation as u64,
                scopes,
                expires_at_ms: expires_at_ms as u64,
            })
        })
    }

    pub(super) fn observe_agent_authorization_clock(&mut self, now_ms: u64) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| advance_agent_clock_on(tx, now_ms))
    }
}

#[derive(Debug)]
struct CredentialRow {
    id: String,
    user_id: String,
    generation: u64,
    created_at_ms: u64,
    rotated_at_ms: u64,
    last_used_at_ms: u64,
    revoked_at_ms: Option<u64>,
}

fn advance_agent_clock_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    if now_ms > MAX_AUTHORIZATION_EPOCH {
        return Err(auth_clock_rollback());
    }
    let high_water = strict_meta_u64(tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
    if now_ms < high_water {
        return Err(auth_clock_rollback());
    }
    write_meta_u64(tx, AUTH_CLOCK_META_KEY, now_ms)
}

pub(super) fn require_agent_clock_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    let high_water = strict_meta_u64(tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
    if now_ms < high_water || now_ms > MAX_AUTHORIZATION_EPOCH {
        return Err(auth_clock_rollback());
    }
    Ok(())
}

pub(super) fn require_agent_active_on(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<()> {
    let active = tx
        .query_row(
            "SELECT 1 FROM _auth_users
             WHERE id = ?1 AND kind = 'agent' AND deactivated_at_ms IS NULL",
            params![user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if active {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_AGENT_DEACTIVATED",
            "auth",
            "the agent principal is absent or permanently deactivated",
        ))
    }
}

fn credential_row_by_hash(
    tx: &Transaction<'_>,
    hash: &[u8],
) -> SnapbackResult<Option<CredentialRow>> {
    let mut statement = tx.prepare(
        "SELECT id, user_id, generation, created_at_ms, rotated_at_ms,
                last_used_at_ms, revoked_at_ms
         FROM _auth_agent_credentials WHERE secret_hash = ?1
         ORDER BY revoked_at_ms IS NULL DESC, id LIMIT 2",
    )?;
    let rows = statement.query_map(params![hash], |row| {
        Ok(CredentialRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            generation: row.get::<_, i64>(2)? as u64,
            created_at_ms: row.get::<_, i64>(3)? as u64,
            rotated_at_ms: row.get::<_, i64>(4)? as u64,
            last_used_at_ms: row.get::<_, i64>(5)? as u64,
            revoked_at_ms: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
        })
    })?;
    one_credential_row(rows.collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn live_credential_by_hash(
    tx: &Transaction<'_>,
    hash: &[u8],
) -> SnapbackResult<Option<ResolvedAgentCredential>> {
    let mut statement = tx.prepare(
        "SELECT id, user_id, generation, revoked_at_ms FROM _auth_agent_credentials
         WHERE secret_hash = ?1
         ORDER BY id LIMIT 2",
    )?;
    let rows = statement.query_map(params![hash], |row| {
        Ok((
            ResolvedAgentCredential {
                credential_id: row.get(0)?,
                user_id: row.get(1)?,
                generation: row.get::<_, i64>(2)? as u64,
            },
            row.get::<_, Option<i64>>(3)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    match rows.len() {
        0 => Ok(None),
        1 => {
            let (resolved, revoked_at_ms) = rows.into_iter().next().expect("one row");
            Ok(revoked_at_ms.is_none().then_some(resolved))
        }
        _ => Err(agent_credential_state_corrupt()),
    }
}

fn one_credential_row(rows: Vec<CredentialRow>) -> SnapbackResult<Option<CredentialRow>> {
    match rows.len() {
        0 => Ok(None),
        1 => Ok(rows.into_iter().next()),
        _ => Err(agent_credential_state_corrupt()),
    }
}

/// The auth transaction is an immediate, serialized writer lane. Checking all
/// retained family rows and inserting/updating before its commit therefore
/// provides the uniqueness invariant without changing the deployed catalog
/// shape.
fn generate_unique_agent_credential_on(
    tx: &Transaction<'_>,
    random: &dyn RandomSource,
) -> SnapbackResult<AgentCredential> {
    for _ in 0..SECRET_COLLISION_RETRY_LIMIT {
        let secret =
            AgentCredential::generate(random).map_err(|_| secret_generation_failed())?;
        let hash = secret.token_hash();
        let collision = tx
            .query_row(
                "SELECT 1 FROM _auth_agent_credentials WHERE secret_hash = ?1 LIMIT 1",
                params![hash.as_bytes()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !collision {
            return Ok(secret);
        }
    }
    Err(secret_generation_failed())
}

pub(super) fn coalesce_credential_use(
    tx: &Transaction<'_>,
    credential_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _auth_agent_credentials SET last_used_at_ms = ?1
         WHERE id = ?2 AND last_used_at_ms <= ?3",
        params![
            now_ms as i64,
            credential_id,
            now_ms.saturating_sub(LAST_USED_COALESCE_MS) as i64,
        ],
    )?;
    Ok(())
}

fn require_live_grant_for_actor(
    tx: &Transaction<'_>,
    grant_id: &str,
    actor_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<Option<u64>> {
    let expires_at_ms = tx
        .query_row(
            "SELECT expires_at_ms FROM _auth_grants
             WHERE id = ?1 AND actor_user_id = ?2 AND revoked_at_ms IS NULL
               AND (expires_at_ms IS NULL OR expires_at_ms > ?3)",
            params![grant_id, actor_user_id, now_ms as i64],
            |row| {
                row.get::<_, Option<i64>>(0)
                    .map(|expiry| expiry.map(|value| value as u64))
            },
        )
        .optional()?;
    expires_at_ms.ok_or_else(grant_invalid)
}

fn live_token_ids_for_grant(
    tx: &Transaction<'_>,
    grant_id: &str,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    let mut statement = tx.prepare(
        "SELECT id FROM _auth_grant_tokens
         WHERE grant_id = ?1 AND revoked_at_ms IS NULL AND expires_at_ms > ?2
         ORDER BY created_at_ms, id",
    )?;
    let rows = statement.query_map(params![grant_id, now_ms as i64], |row| {
        row.get::<_, String>(0)
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn live_token_ids_for_credential(
    tx: &Transaction<'_>,
    credential_id: &str,
) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT id FROM _auth_grant_tokens
         WHERE credential_id = ?1 AND revoked_at_ms IS NULL ORDER BY id",
        credential_id,
    )
}

fn credential_ids_for_user(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT id FROM _auth_agent_credentials WHERE user_id = ?1 ORDER BY id",
        user_id,
    )
}

fn live_token_ids_for_user(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT t.id FROM _auth_grant_tokens AS t
         JOIN _auth_agent_credentials AS c ON c.id = t.credential_id
         WHERE c.user_id = ?1 AND t.revoked_at_ms IS NULL ORDER BY t.id",
        user_id,
    )
}

fn live_grant_ids_for_actor(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT id FROM _auth_grants
         WHERE actor_user_id = ?1 AND revoked_at_ms IS NULL ORDER BY id",
        user_id,
    )
}

fn collect_ids(tx: &Transaction<'_>, sql: &str, value: &str) -> SnapbackResult<Vec<String>> {
    let mut statement = tx.prepare(sql)?;
    let rows = statement.query_map(params![value], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn sweep_credential_family_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    let cutoff = now_ms.saturating_sub(AGENT_CREDENTIAL_FAMILY_RETENTION_MS);
    tx.execute(
        "DELETE FROM _auth_agent_credentials
         WHERE revoked_at_ms IS NOT NULL AND revoked_at_ms <= ?1",
        params![cutoff as i64],
    )?;
    Ok(())
}

fn map_live_credential_constraint(error: rusqlite::Error) -> SnapbackError {
    if matches!(error, rusqlite::Error::SqliteFailure(ref code, _)
        if code.code == rusqlite::ErrorCode::ConstraintViolation)
    {
        SnapbackError::error(
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_EXISTS",
            "auth",
            "the agent already has a live credential",
        )
    } else {
        error.into()
    }
}

fn secret_generation_failed() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "agent secret generation is unavailable",
    )
}

fn agent_credential_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID",
        "auth",
        "agent credential is invalid",
    )
}

fn agent_credential_rotation_throttled() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED",
        "auth",
        "agent credential rotation is limited to once per hour",
    )
}

fn agent_credential_state_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT",
        "auth",
        "agent credential state is corrupt",
    )
}

fn scoped_token_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
        "auth",
        "scoped agent token is invalid",
    )
}

fn scoped_token_ttl_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SCOPED_TOKEN_TTL_INVALID",
        "auth",
        "scoped agent token TTL must be between one millisecond and 24 hours",
    )
}

fn grant_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_INVALID",
        "auth",
        "agent grant is invalid",
    )
}

fn auth_clock_rollback() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_CLOCK_ROLLBACK",
        "auth",
        "server auth clock moved behind its durable high-water",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::storage::auth_agents::AgentRegistration;
    use std::sync::atomic::{AtomicU8, Ordering};

    struct CounterRandom(AtomicU8);

    struct FixedRandom(u8);

    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU8::new(1))
        }
    }

    impl RandomSource for CounterRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            let byte = self.0.fetch_add(1, Ordering::SeqCst);
            destination.fill(byte);
            Ok(())
        }
    }

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0);
            Ok(())
        }
    }

    fn create_agent(db: &mut LocalDatabase, user_id: &str) {
        db.create_agent_principal(
            user_id,
            0,
            &AgentRegistration {
                display_name: None,
                operator_contact: None,
                registration_provenance: "test".to_owned(),
                owner_user_id: None,
            },
        )
        .expect("agent principal");
    }

    fn ready() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_auth_catalog_v1().expect("auth catalog v2");
        db.create_agent_principal(
            "agent-a",
            0,
            &AgentRegistration {
                display_name: Some("Agent A".to_owned()),
                operator_contact: None,
                registration_provenance: "test".to_owned(),
                owner_user_id: None,
            },
        )
        .expect("agent principal");
        db
    }

    fn seed_grant(db: &LocalDatabase, id: &str, now_ms: u64) {
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
               id, actor_user_id, effective_user_id, scopes, created_at_ms,
               expires_at_ms, revoked_at_ms, created_by, request_id,
               consent_digest, last_used_at_ms
             ) VALUES(?1, 'agent-a', NULL, ?2, ?3, NULL, NULL, 'test', NULL, NULL, ?3)",
                params![id, r#"[{"fn":"query-a","kind":"query"}]"#, now_ms as i64],
            )
            .expect("grant");
    }

    fn seed_expiring_grant(db: &LocalDatabase, id: &str, now_ms: u64, expires_at_ms: u64) {
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
               id, actor_user_id, effective_user_id, scopes, created_at_ms,
               expires_at_ms, revoked_at_ms, created_by, request_id,
               consent_digest, last_used_at_ms
             ) VALUES(?1, 'agent-a', 'user-a', ?2, ?3, ?4, NULL, 'test', NULL, NULL, ?3)",
                params![
                    id,
                    r#"[{"fn":"query-a","kind":"query"}]"#,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )
            .expect("expiring grant");
    }

    #[test]
    fn thief_rotates_n_but_original_secret_still_destroys_the_family() {
        let random = CounterRandom::new();
        let mut db = ready();
        let start = 1_000;
        let issued = db
            .issue_initial_agent_credential("agent-a", start, &random)
            .unwrap();
        let original = issued.secret.expose_secret().to_owned();
        let mut live = issued.secret;
        for turn in 1..=24 {
            let now = start + turn * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
            let rotated = db.rotate_agent_credential(&live, now, &random).unwrap();
            assert_eq!(rotated.generation, turn + 1);
            assert_eq!(
                db.resolve_agent_credential(&live, now)
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID"
            );
            live = rotated.secret;
        }
        let original = AgentCredential::parse(&original).unwrap();
        let revoked = db
            .revoke_agent_credential_family(
                &original,
                start + 24 * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
            )
            .unwrap();
        assert_eq!(revoked.user_id.as_deref(), Some("agent-a"));
        assert_eq!(
            db.resolve_agent_credential(
                &live,
                start + 24 * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID"
        );
        db.revoke_agent_credential_family(
            &original,
            start + 24 * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
        )
        .expect("destroy-only alarm is idempotent while attributable");
    }

    #[test]
    fn repeated_rng_output_cannot_alias_issue_or_rotation() {
        let random = FixedRandom(7);
        let mut db = ready();
        let issued = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap();
        create_agent(&mut db, "agent-b");

        let issue_error = db
            .issue_initial_agent_credential("agent-b", 1_001, &random)
            .unwrap_err();
        assert_eq!(
            issue_error.diagnostic.code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        let agent_b_credentials: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _auth_agent_credentials WHERE user_id = 'agent-b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_b_credentials, 0);

        let rotation_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        let rotate_error = db
            .rotate_agent_credential(&issued.secret, rotation_at, &random)
            .unwrap_err();
        assert_eq!(
            rotate_error.diagnostic.code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        let resolved = db
            .resolve_agent_credential(&issued.secret, rotation_at)
            .expect("failed collision retries leave the predecessor live");
        assert_eq!(resolved.generation, 1);
    }

    #[test]
    fn revoked_agent_hash_cannot_alias_a_different_live_agent() {
        let random = CounterRandom::new();
        let mut db = ready();
        let issued = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap();
        let rotation_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        db.rotate_agent_credential(&issued.secret, rotation_at, &random)
            .unwrap();
        create_agent(&mut db, "agent-b");
        let hash = issued.secret.token_hash();
        db.conn
            .execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES('credential-b', 'agent-b', ?1, 1, ?2, ?2, ?2, NULL)",
                params![hash.as_bytes(), rotation_at as i64],
            )
            .unwrap();

        let resolve_error = db
            .resolve_agent_credential(&issued.secret, rotation_at + 1)
            .unwrap_err();
        assert_eq!(
            resolve_error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT"
        );
        let revoke_error = db
            .revoke_agent_credential_family(&issued.secret, rotation_at + 1)
            .unwrap_err();
        assert_eq!(
            revoke_error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT"
        );
        let agent_b_live: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _auth_agent_credentials
                 WHERE user_id = 'agent-b' AND revoked_at_ms IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_b_live, 1);
    }

    #[test]
    fn rotation_throttle_and_family_retention_survive_restart() {
        let random = CounterRandom::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent.sqlite3");
        let original = {
            let mut db = LocalDatabase::open(&path).unwrap();
            db.activate_auth_catalog_v1().unwrap();
            db.create_agent_principal(
                "agent-a",
                0,
                &AgentRegistration {
                    display_name: None,
                    operator_contact: None,
                    registration_provenance: "test".to_owned(),
                    owner_user_id: None,
                },
            )
            .unwrap();
            db.issue_initial_agent_credential("agent-a", 1_000, &random)
                .unwrap()
                .secret
        };
        let mut db = LocalDatabase::open(&path).unwrap();
        let throttled = db
            .rotate_agent_credential(&original, 2_000, &random)
            .unwrap_err();
        assert_eq!(
            throttled.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED"
        );
        let rotated_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        let rotated = db
            .rotate_agent_credential(&original, rotated_at, &random)
            .unwrap();
        drop(db);
        let mut reopened = LocalDatabase::open(&path).unwrap();
        reopened
            .revoke_agent_credential_family(&original, rotated_at + 1)
            .expect("predecessor survives reopen");
        assert!(
            reopened
                .resolve_agent_credential(&rotated.secret, rotated_at + 1)
                .is_err()
        );
    }

    #[test]
    fn token_cap_evicts_oldest_and_resolution_checks_every_live_axis() {
        let random = CounterRandom::new();
        let mut db = ready();
        let now = 1_000;
        let credential = db
            .issue_initial_agent_credential("agent-a", now, &random)
            .unwrap()
            .secret;
        seed_grant(&db, "grant-a", now);
        let mut tokens = Vec::new();
        for offset in 0..=SCOPED_TOKEN_LIVE_CAP {
            tokens.push(
                db.mint_scoped_token(&credential, "grant-a", None, now + offset, &random)
                    .unwrap(),
            );
        }
        assert_eq!(tokens.last().unwrap().evicted_token_ids.len(), 1);
        assert_eq!(
            db.resolve_scoped_token(&tokens.remove(0).secret, now + SCOPED_TOKEN_LIVE_CAP)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
        let current = tokens.last().unwrap();
        let resolved = db
            .resolve_scoped_token(&current.secret, now + SCOPED_TOKEN_LIVE_CAP)
            .unwrap();
        assert_eq!(resolved.grant_id, "grant-a");
        assert_eq!(resolved.actor_user_id, "agent-a");
    }

    #[test]
    fn expired_token_observation_prevents_clock_rollback_revival() {
        let random = CounterRandom::new();
        let mut db = ready();
        let credential = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap()
            .secret;
        seed_grant(&db, "grant-a", 1_000);
        let token = db
            .mint_scoped_token(&credential, "grant-a", Some(10), 1_000, &random)
            .unwrap()
            .secret;
        assert_eq!(
            db.resolve_scoped_token(&token, 1_010)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
        assert_eq!(
            db.resolve_scoped_token(&token, 1_009)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_CLOCK_ROLLBACK"
        );
    }

    #[test]
    fn token_receipt_and_durable_expiry_are_clamped_to_the_grant() {
        let random = CounterRandom::new();
        let mut db = ready();
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-a', 0, 'human', NULL, NULL, NULL, NULL, NULL)",
                [],
            )
            .unwrap();
        let credential = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap()
            .secret;
        seed_expiring_grant(&db, "grant-short", 1_000, 1_010);
        let issued = db
            .mint_scoped_token(&credential, "grant-short", Some(1_000), 1_001, &random)
            .unwrap();
        assert_eq!(issued.expires_at_ms, 1_010);
        db.resolve_scoped_token(&issued.secret, 1_009)
            .expect("token remains live strictly before the grant expiry");
        assert_eq!(
            db.resolve_scoped_token(&issued.secret, 1_010)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
    }
}
