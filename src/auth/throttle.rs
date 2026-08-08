//! Durable charge-on-denial authentication throttling for hosted targets.
//!
//! SQLite is the serialized shared authority only for the declared
//! single-instance container/VM profile. Multi-replica adapters must replace
//! it with an equivalent shared transaction.

use hmac::{Hmac, Mac as _};
use rusqlite::{Connection, OptionalExtension as _, TransactionBehavior, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::net::IpAddr;
use zeroize::Zeroizing;

const TABLE: &str = "_snapback_auth_throttle";
const KEY_DOMAIN: &[u8] = b"snapback.auth-throttle.bucket.v1";
const MAX_VALUE_BYTES: usize = 512;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthenticationBucketPolicy {
    #[schemars(range(min = 1_i64, max = 86400000_i64))]
    pub interval_ms: u64,
    #[schemars(range(min = 1_i64, max = 1000000_i64))]
    pub burst: u64,
    #[schemars(range(min = 1_i64, max = 1000000_i64))]
    pub maximum_denial_debt_attempts: u64,
}

impl AuthenticationBucketPolicy {
    fn validate(self) -> Result<(), AuthenticationThrottleError> {
        if self.interval_ms == 0
            || self.interval_ms > 86_400_000
            || self.burst == 0
            || self.burst > 1_000_000
            || self.maximum_denial_debt_attempts == 0
            || self.maximum_denial_debt_attempts > 1_000_000
            || self
                .burst
                .checked_add(self.maximum_denial_debt_attempts)
                .and_then(|attempts| attempts.checked_mul(self.interval_ms))
                .is_none()
        {
            return Err(AuthenticationThrottleError::Invalid);
        }
        Ok(())
    }
}

/// Exact target-published GCRA policy. A denied request advances every
/// applicable bucket, with finite denial debt preventing attacker-controlled
/// integer growth.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SharedAuthenticationThrottleConfig {
    #[schemars(range(min = 1_i64, max = 31536000000_i64))]
    pub retention_ms: u64,
    #[schemars(range(min = 2_i64, max = 9007199254740991_i64))]
    pub maximum_key_count: u64,
    pub global: AuthenticationBucketPolicy,
    pub source: AuthenticationBucketPolicy,
    pub subject: AuthenticationBucketPolicy,
    pub source_subject: AuthenticationBucketPolicy,
    pub family: AuthenticationBucketPolicy,
}

impl SharedAuthenticationThrottleConfig {
    pub(crate) fn validate(&self) -> Result<(), AuthenticationThrottleError> {
        if self.retention_ms == 0
            || self.retention_ms > 365 * 86_400_000
            || self.maximum_key_count < 2
            || self.maximum_key_count > i64::MAX as u64
        {
            return Err(AuthenticationThrottleError::Invalid);
        }
        for policy in [
            self.global,
            self.source,
            self.subject,
            self.source_subject,
            self.family,
        ] {
            policy.validate()?;
        }
        Ok(())
    }
}

pub(crate) struct AuthenticationThrottleKey(Zeroizing<[u8; 32]>);

impl AuthenticationThrottleKey {
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }
    fn expose_secret(&self) -> &[u8; 32] {
        &self.0
    }

    /// Derive the unknown-carrier cover-nonce purpose key as a
    /// domain-separated HMAC of the target-attested secret, so the throttle
    /// secret never doubles as a raw cross-protocol MAC key.
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — decision 3: carriers
    /// resolving to no live bound family receive a deterministic keyed cover
    /// nonce instead of a fresh random value, closing the bound-family
    /// existence oracle.
    pub(crate) fn derive_sender_cover_key(&self) -> [u8; 32] {
        let mut mac = <Hmac<Sha256> as hmac::Mac>::new_from_slice(self.expose_secret())
            .expect("HMAC-SHA256 accepts a 32-byte key");
        mac.update(b"snapback.sender-cover-nonce.v1");
        let digest = mac.finalize().into_bytes();
        let mut key = [0_u8; 32];
        key.copy_from_slice(&digest);
        key
    }
}

impl std::fmt::Debug for AuthenticationThrottleKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AuthenticationThrottleKey([REDACTED])")
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AuthenticationThrottleDimensions {
    pub(crate) deployment_id: String,
    pub(crate) effective_source: String,
    pub(crate) subject: Option<String>,
    pub(crate) family: Option<String>,
}

impl AuthenticationThrottleDimensions {
    pub(crate) fn for_ip(
        deployment_id: impl Into<String>,
        source: IpAddr,
        subject: Option<String>,
        family: Option<String>,
    ) -> Self {
        Self {
            deployment_id: deployment_id.into(),
            effective_source: grouped_source(source),
            subject,
            family,
        }
    }

    fn validate(&self) -> Result<(), AuthenticationThrottleError> {
        for value in [
            Some(self.deployment_id.as_str()),
            Some(self.effective_source.as_str()),
            self.subject.as_deref(),
            self.family.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if value.is_empty() || value.len() > MAX_VALUE_BYTES {
                return Err(AuthenticationThrottleError::Invalid);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AuthenticationThrottleDecision {
    pub(crate) admitted: bool,
    pub(crate) retry_after_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthenticationThrottleError {
    Capacity,
    Invalid,
    Unavailable,
}

#[derive(Clone, Copy)]
enum BucketKind {
    Global = 1,
    Source = 2,
    Subject = 3,
    SourceSubject = 4,
    Family = 5,
}

impl BucketKind {
    fn domain(self) -> &'static [u8] {
        match self {
            Self::Global => b"global",
            Self::Source => b"source",
            Self::Subject => b"subject",
            Self::SourceSubject => b"source-subject",
            Self::Family => b"family",
        }
    }
}

struct Charge {
    kind: BucketKind,
    key: [u8; 32],
    policy: AuthenticationBucketPolicy,
}

fn update_lp(mac: &mut Hmac<Sha256>, bytes: &[u8]) {
    mac.update(&(bytes.len() as u64).to_be_bytes());
    mac.update(bytes);
}

fn bucket_key(key: &AuthenticationThrottleKey, kind: BucketKind, values: &[&str]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
        .expect("HMAC-SHA-256 accepts every key length");
    update_lp(&mut mac, KEY_DOMAIN);
    update_lp(&mut mac, kind.domain());
    for value in values {
        update_lp(&mut mac, value.as_bytes());
    }
    mac.finalize().into_bytes().into()
}

fn grouped_source(source: IpAddr) -> String {
    match source {
        IpAddr::V4(address) => format!("v4:{address}/32"),
        IpAddr::V6(address) => {
            let segments = address.segments();
            format!(
                "v6:{:04x}:{:04x}:{:04x}:{:04x}::/64",
                segments[0], segments[1], segments[2], segments[3]
            )
        }
    }
}

pub(crate) fn initialize_shared_authentication_throttle(
    connection: &Connection,
) -> Result<(), AuthenticationThrottleError> {
    connection
        .execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {TABLE} (
                limiter_epoch INTEGER NOT NULL CHECK(limiter_epoch > 0),
                bucket_key BLOB NOT NULL CHECK(length(bucket_key) = 32),
                bucket_kind INTEGER NOT NULL CHECK(bucket_kind BETWEEN 1 AND 5),
                theoretical_arrival_ms INTEGER NOT NULL CHECK(theoretical_arrival_ms >= 0),
                last_used_ms INTEGER NOT NULL CHECK(last_used_ms >= 0),
                PRIMARY KEY (limiter_epoch, bucket_key)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS _snapback_auth_throttle_retention
                ON {TABLE}(limiter_epoch, last_used_ms, theoretical_arrival_ms);"
        ))
        .map_err(|_| AuthenticationThrottleError::Unavailable)
}

/// @ref LLP 0060#d3-shared-authentication-throttling — one serialized
/// transaction advances the complete applicable key set even on denial.
pub(crate) fn charge_shared_authentication_attempt(
    connection: &mut Connection,
    limiter_epoch: u64,
    key: &AuthenticationThrottleKey,
    config: &SharedAuthenticationThrottleConfig,
    dimensions: &AuthenticationThrottleDimensions,
    now_ms: u64,
) -> Result<AuthenticationThrottleDecision, AuthenticationThrottleError> {
    config.validate()?;
    dimensions.validate()?;
    if limiter_epoch == 0 || limiter_epoch > i64::MAX as u64 || now_ms > i64::MAX as u64 {
        return Err(AuthenticationThrottleError::Invalid);
    }
    let mut charges = vec![
        Charge {
            kind: BucketKind::Global,
            key: bucket_key(key, BucketKind::Global, &[&dimensions.deployment_id]),
            policy: config.global,
        },
        Charge {
            kind: BucketKind::Source,
            key: bucket_key(
                key,
                BucketKind::Source,
                &[&dimensions.deployment_id, &dimensions.effective_source],
            ),
            policy: config.source,
        },
    ];
    if let Some(subject) = dimensions.subject.as_deref() {
        charges.push(Charge {
            kind: BucketKind::Subject,
            key: bucket_key(
                key,
                BucketKind::Subject,
                &[&dimensions.deployment_id, subject],
            ),
            policy: config.subject,
        });
        charges.push(Charge {
            kind: BucketKind::SourceSubject,
            key: bucket_key(
                key,
                BucketKind::SourceSubject,
                &[
                    &dimensions.deployment_id,
                    &dimensions.effective_source,
                    subject,
                ],
            ),
            policy: config.source_subject,
        });
    }
    if let Some(family) = dimensions.family.as_deref() {
        charges.push(Charge {
            kind: BucketKind::Family,
            key: bucket_key(
                key,
                BucketKind::Family,
                &[&dimensions.deployment_id, family],
            ),
            policy: config.family,
        });
    }

    let epoch = limiter_epoch as i64;
    let now = now_ms as i64;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    transaction
        .execute(
            &format!("DELETE FROM {TABLE} WHERE limiter_epoch <> ?1"),
            params![epoch],
        )
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    transaction
        .execute(
            &format!(
                "DELETE FROM {TABLE}
                 WHERE limiter_epoch = ?1 AND last_used_ms <= ?2
                   AND theoretical_arrival_ms <= ?3"
            ),
            params![
                epoch,
                now_ms.saturating_sub(config.retention_ms) as i64,
                now
            ],
        )
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    let existing: i64 = transaction
        .query_row(
            &format!("SELECT COUNT(*) FROM {TABLE} WHERE limiter_epoch = ?1"),
            params![epoch],
            |row| row.get(0),
        )
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    let mut states = Vec::with_capacity(charges.len());
    let mut new_count = 0_u64;
    for charge in &charges {
        let prior = transaction
            .query_row(
                &format!(
                    "SELECT theoretical_arrival_ms FROM {TABLE}
                     WHERE limiter_epoch = ?1 AND bucket_key = ?2"
                ),
                params![epoch, charge.key.as_slice()],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|_| AuthenticationThrottleError::Unavailable)?;
        new_count += u64::from(prior.is_none());
        states.push(prior);
    }
    if existing < 0 {
        return Err(AuthenticationThrottleError::Capacity);
    }
    let projected_count = (existing as u64)
        .checked_add(new_count)
        .ok_or(AuthenticationThrottleError::Capacity)?;
    let required_evictions = projected_count.saturating_sub(config.maximum_key_count);
    if required_evictions > 0 {
        // Keep every bucket participating in this atomic charge, especially
        // the deployment-global backstop, and make room by evicting the least
        // recently used unrelated rows inside the same serialized transaction.
        // The fixed five-key exclusion is padded with the global key because
        // one attempt carries between two and five dimensions.
        let excluded = [
            charges[0].key.as_slice(),
            charges.get(1).unwrap_or(&charges[0]).key.as_slice(),
            charges.get(2).unwrap_or(&charges[0]).key.as_slice(),
            charges.get(3).unwrap_or(&charges[0]).key.as_slice(),
            charges.get(4).unwrap_or(&charges[0]).key.as_slice(),
        ];
        for _ in 0..required_evictions {
            let removed = transaction
                .execute(
                    &format!(
                        "DELETE FROM {TABLE}
                         WHERE rowid = (
                           SELECT rowid FROM {TABLE}
                            WHERE limiter_epoch = ?1
                              AND bucket_key NOT IN (?2, ?3, ?4, ?5, ?6)
                            ORDER BY last_used_ms, bucket_key
                            LIMIT 1
                         )"
                    ),
                    params![
                        epoch,
                        excluded[0],
                        excluded[1],
                        excluded[2],
                        excluded[3],
                        excluded[4],
                    ],
                )
                .map_err(|_| AuthenticationThrottleError::Unavailable)?;
            if removed != 1 {
                return Err(AuthenticationThrottleError::Capacity);
            }
        }
    }

    let mut admitted = true;
    let mut retry_deadline = now_ms;
    for (charge, prior) in charges.iter().zip(states) {
        let interval = charge.policy.interval_ms;
        let tolerance = charge
            .policy
            .burst
            .saturating_sub(1)
            .checked_mul(interval)
            .ok_or(AuthenticationThrottleError::Invalid)?;
        let prior_tat = prior
            .and_then(|value| u64::try_from(value).ok())
            .unwrap_or(now_ms);
        let bucket_admitted = now_ms >= prior_tat.saturating_sub(tolerance);
        admitted &= bucket_admitted;
        let horizon = charge
            .policy
            .burst
            .checked_add(charge.policy.maximum_denial_debt_attempts)
            .and_then(|attempts| attempts.checked_mul(interval))
            .and_then(|duration| now_ms.checked_add(duration))
            .ok_or(AuthenticationThrottleError::Invalid)?;
        let next_tat = prior_tat.max(now_ms).saturating_add(interval).min(horizon);
        if !bucket_admitted {
            retry_deadline = retry_deadline.max(next_tat.saturating_sub(tolerance));
        }
        transaction
            .execute(
                &format!(
                    "INSERT INTO {TABLE}
                     (limiter_epoch, bucket_key, bucket_kind, theoretical_arrival_ms, last_used_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(limiter_epoch, bucket_key) DO UPDATE SET
                       bucket_kind = excluded.bucket_kind,
                       theoretical_arrival_ms = excluded.theoretical_arrival_ms,
                       last_used_ms = excluded.last_used_ms"
                ),
                params![
                    epoch,
                    charge.key.as_slice(),
                    charge.kind as i64,
                    i64::try_from(next_tat).map_err(|_| AuthenticationThrottleError::Invalid)?,
                    now,
                ],
            )
            .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    }
    transaction
        .commit()
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    Ok(AuthenticationThrottleDecision {
        admitted,
        retry_after_ms: if admitted {
            0
        } else {
            retry_deadline.saturating_sub(now_ms).max(1)
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(interval_ms: u64, burst: u64) -> AuthenticationBucketPolicy {
        AuthenticationBucketPolicy {
            interval_ms,
            burst,
            maximum_denial_debt_attempts: 4,
        }
    }
    fn config() -> SharedAuthenticationThrottleConfig {
        SharedAuthenticationThrottleConfig {
            retention_ms: 60_000,
            maximum_key_count: 100,
            global: policy(1_000, 1),
            source: policy(100, 10),
            subject: policy(100, 10),
            source_subject: policy(100, 10),
            family: policy(100, 10),
        }
    }
    fn dimensions() -> AuthenticationThrottleDimensions {
        AuthenticationThrottleDimensions::for_ip(
            "deployment-secret-name",
            "2001:db8:1:2:3:4:5:6".parse().unwrap(),
            Some("person@example.com".to_owned()),
            Some("session-family-secret-name".to_owned()),
        )
    }

    #[test]
    fn denial_atomically_advances_all_hashed_buckets() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize_shared_authentication_throttle(&db).unwrap();
        let key = AuthenticationThrottleKey::from_bytes([7; 32]);
        let first = charge_shared_authentication_attempt(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_000,
        )
        .unwrap();
        assert!(first.admitted);
        let read = |db: &Connection| {
            db.prepare(&format!(
                "SELECT bucket_kind, theoretical_arrival_ms FROM {TABLE} ORDER BY bucket_kind"
            ))
            .unwrap()
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
        };
        let prior = read(&db);
        assert_eq!(prior.len(), 5);
        let denied = charge_shared_authentication_attempt(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_000,
        )
        .unwrap();
        assert!(!denied.admitted);
        assert_eq!(denied.retry_after_ms, 2_000);
        let next = read(&db);
        assert!(
            next.iter()
                .zip(&prior)
                .all(|((kind, tat), (old_kind, old_tat))| kind == old_kind && tat > old_tat)
        );
        let count: i64 = db
            .query_row(&format!("SELECT COUNT(*) FROM {TABLE}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 5, "only HMAC bucket ids are retained");
    }

    #[test]
    fn capacity_and_missing_authority_fail_closed() {
        let mut db = Connection::open_in_memory().unwrap();
        let key = AuthenticationThrottleKey::from_bytes([8; 32]);
        assert_eq!(
            charge_shared_authentication_attempt(&mut db, 1, &key, &config(), &dimensions(), 1_000),
            Err(AuthenticationThrottleError::Unavailable)
        );
        initialize_shared_authentication_throttle(&db).unwrap();
        let mut tiny = config();
        tiny.maximum_key_count = 4;
        assert_eq!(
            charge_shared_authentication_attempt(&mut db, 1, &key, &tiny, &dimensions(), 1_000),
            Err(AuthenticationThrottleError::Capacity)
        );
        assert_eq!(
            db.query_row(&format!("SELECT COUNT(*) FROM {TABLE}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn full_table_evicts_oldest_unrelated_rows_and_admits_a_new_charge() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize_shared_authentication_throttle(&db).unwrap();
        let key = AuthenticationThrottleKey::from_bytes([9; 32]);
        let mut bounded = config();
        bounded.maximum_key_count = 6;
        let dimensions_for = |subject: &str| {
            AuthenticationThrottleDimensions::for_ip(
                "deployment-secret-name",
                "192.0.2.8".parse().unwrap(),
                Some(subject.to_owned()),
                None,
            )
        };

        assert!(
            charge_shared_authentication_attempt(
                &mut db,
                1,
                &key,
                &bounded,
                &dimensions_for("oldest@example.com"),
                10_000,
            )
            .unwrap()
            .admitted
        );
        assert!(
            charge_shared_authentication_attempt(
                &mut db,
                1,
                &key,
                &bounded,
                &dimensions_for("newer@example.com"),
                20_000,
            )
            .unwrap()
            .admitted
        );
        assert_eq!(
            db.query_row(&format!("SELECT COUNT(*) FROM {TABLE}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            6
        );

        let decision = charge_shared_authentication_attempt(
            &mut db,
            1,
            &key,
            &bounded,
            &dimensions_for("legitimate@example.com"),
            30_000,
        )
        .unwrap();
        assert!(
            decision.admitted,
            "capacity is not a deployment-wide refusal"
        );
        assert_eq!(
            db.query_row(&format!("SELECT COUNT(*) FROM {TABLE}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            6
        );

        let oldest_subject = bucket_key(
            &key,
            BucketKind::Subject,
            &["deployment-secret-name", "oldest@example.com"],
        );
        let retained: i64 = db
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM {TABLE} WHERE limiter_epoch = 1 AND bucket_key = ?1"
                ),
                params![oldest_subject.as_slice()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            retained, 0,
            "the oldest unrelated subject row is evicted first"
        );
    }

    #[test]
    fn ipv6_sources_group_at_64_bits() {
        let first: IpAddr = "2001:db8:1:2:3:4:5:6".parse().unwrap();
        let second: IpAddr = "2001:db8:1:2:ffff::1".parse().unwrap();
        assert_eq!(grouped_source(first), grouped_source(second));
        assert_eq!(
            grouped_source("192.0.2.4".parse().unwrap()),
            "v4:192.0.2.4/32"
        );
    }
}
