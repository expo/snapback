use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::{AuthorizationVersion, MAX_AUTHORIZATION_EPOCH};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const AUTH_INVALIDATION_PROTOCOL_VERSION: u32 = 1;

pub const MAX_PROTOCOL_COUNTER: u64 = MAX_AUTHORIZATION_EPOCH;

pub fn invalidation_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message.into())
}

pub fn corrupt(message: impl Into<String>) -> SnapbackError {
    invalidation_error("SNAPBACK_AUTH_INVALIDATION_CORRUPT", message)
}

pub fn validate_counter(value: u64, field: &str, positive: bool) -> SnapbackResult<()> {
    if value > MAX_PROTOCOL_COUNTER || (positive && value == 0) {
        return Err(corrupt(format!(
            "{field} is outside the canonical JavaScript-safe {}integer range",
            if positive {
                "positive "
            } else {
                "nonnegative "
            }
        )));
    }
    Ok(())
}

pub fn validate_uuid_v7(value: &str, field: &str) -> SnapbackResult<()> {
    if crate::ids::is_minted_identifier(value) {
        return Ok(());
    }
    Err(corrupt(format!("{field} is not a Snapback identifier")))
}

pub fn validate_opaque(value: &str, field: &str) -> SnapbackResult<()> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(corrupt(format!("{field} is empty")));
    };
    if value.len() > 256
        || !first.is_ascii_alphanumeric()
        || !chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-'))
    {
        return Err(corrupt(format!("{field} is not a canonical opaque id")));
    }
    Ok(())
}


/// A boot identity is never reused, even when process-local counters restart.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssuerId {
    pub authorization_incarnation: String,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub boot_sequence: u64,
    pub boot_nonce: String,
}

impl IssuerId {
    pub fn fresh(
        authorization_incarnation: impl Into<String>,
        boot_sequence: u64,
    ) -> SnapbackResult<Self> {
        let authorization_incarnation = authorization_incarnation.into();
        validate_uuid_v7(
            &authorization_incarnation,
            "issuerId.authorizationIncarnation",
        )?;
        validate_counter(boot_sequence, "issuerId.bootSequence", true)?;
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
                "could not obtain cryptographic randomness for an invalidation boot issuer",
            )
        })?;
        Ok(Self {
            authorization_incarnation,
            boot_sequence,
            boot_nonce: URL_SAFE_NO_PAD.encode(bytes),
        })
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        validate_uuid_v7(
            &self.authorization_incarnation,
            "issuerId.authorizationIncarnation",
        )?;
        validate_counter(self.boot_sequence, "issuerId.bootSequence", true)?;
        let nonce = URL_SAFE_NO_PAD
            .decode(&self.boot_nonce)
            .map_err(|_| corrupt("issuerId.bootNonce is not canonical base64url"))?;
        if nonce.len() != 16 || URL_SAFE_NO_PAD.encode(nonce) != self.boot_nonce {
            return Err(corrupt(
                "issuerId.bootNonce is not a canonical 128-bit base64url value",
            ));
        }
        Ok(())
    }

}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryNamespace {
    pub client_store_id: String,
    pub query_key: String,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub query_instance_id: u64,
}

impl QueryNamespace {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_opaque(&self.client_store_id, "namespace.clientStoreId")?;
        if self.query_key.is_empty() || self.query_key.len() > 8_192 {
            return Err(corrupt(
                "namespace.queryKey must be a nonempty bounded canonical key",
            ));
        }
        validate_counter(self.query_instance_id, "namespace.queryInstanceId", true)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ScopeId {
    Subscription {
        issuer_id: IssuerId,
        namespace: QueryNamespace,
        #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
        scope_sequence: u64,
        #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
        connection_generation: u64,
        subscription_id: String,
    },
    Connection {
        issuer_id: IssuerId,
        #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
        connection_generation: u64,
    },
    ClientQuery {
        namespace: QueryNamespace,
    },
}

impl ScopeId {
    pub fn validate(&self) -> SnapbackResult<()> {
        match self {
            Self::Subscription {
                issuer_id,
                namespace,
                scope_sequence,
                connection_generation,
                subscription_id,
            } => {
                issuer_id.validate()?;
                namespace.validate()?;
                validate_counter(*scope_sequence, "scopeId.scopeSequence", true)?;
                validate_counter(*connection_generation, "scopeId.connectionGeneration", true)?;
                validate_opaque(subscription_id, "scopeId.subscriptionId")
            }
            Self::Connection {
                issuer_id,
                connection_generation,
            } => {
                issuer_id.validate()?;
                validate_counter(*connection_generation, "scopeId.connectionGeneration", true)
            }
            Self::ClientQuery { namespace } => namespace.validate(),
        }
    }

    pub fn issuer(&self) -> Option<&IssuerId> {
        match self {
            Self::Subscription { issuer_id, .. } | Self::Connection { issuer_id, .. } => {
                Some(issuer_id)
            }
            Self::ClientQuery { .. } => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataWitness {
    pub version_stream: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub min_commit_version: u64,
}

impl DataWitness {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_opaque(&self.version_stream, "witness.data.versionStream")?;
        validate_counter(
            self.min_commit_version,
            "witness.data.minCommitVersion",
            false,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompositeWitness {
    pub authorization: AuthorizationVersion,
    pub data: Option<DataWitness>,
}

/// The authorization-witness record named by a completeness proof. The shape
/// lives here with [`CompositeWitness`] so sync-engine consumers never import
/// upward; construction/digest logic stays in `crate::completeness` with the
/// proof issuance coordinator (LLP 0199 worklist item 7).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationWitnessRecordV1 {
    pub format: String,
    pub query_instance_id: u64,
    pub composite_witness: CompositeWitness,
}

impl CompositeWitness {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_uuid_v7(
            &self.authorization.incarnation,
            "witness.authorization.incarnation",
        )?;
        validate_counter(
            self.authorization.epoch,
            "witness.authorization.epoch",
            false,
        )?;
        if let Some(data) = &self.data {
            data.validate()?;
        }
        Ok(())
    }

    pub fn covers(&self, floor: &Self) -> bool {
        if self.authorization != floor.authorization {
            return false;
        }
        match (&self.data, &floor.data) {
            (_, None) => true,
            (Some(actual), Some(required)) => {
                actual.version_stream == required.version_stream
                    && actual.min_commit_version >= required.min_commit_version
            }
            (None, Some(_)) => false,
        }
    }
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum InvalidationDisposition {
    Retain,
    Quarantine,
    Delete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResyncObligation {
    pub protocol_version: u32,
    pub scope_id: ScopeId,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub revision: u64,
    pub max_disposition: InvalidationDisposition,
    pub witness: CompositeWitness,
    pub retry_episode_id: Option<String>,
    /// Cleanup ownership for the client-side pending token. This is not part
    /// of scope/revision identity; retirement may finish only after this exact
    /// continuity ends (except an already-applied terminal delete).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_continuity_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ResolutionKind {
    Snapshot,
    TerminalDelete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionTicket {
    pub protocol_version: u32,
    pub kind: ResolutionKind,
    pub scope_id: ScopeId,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub revision: u64,
    pub witness: CompositeWitness,
    pub max_disposition: InvalidationDisposition,
    pub ack_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_continuity_id: Option<String>,
}



/// One level-triggered live projection. Delivery is only a hint; the exact
/// obligation remains authoritative until the optional resolution ticket is
/// acknowledged after the client commits its local transition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationProjection {
    pub obligation: ResyncObligation,
    pub resolution: Option<ResolutionTicket>,
}

pub const AUTH_ERROR_RETRY_WINDOW_MS: u64 = 15_000;
pub const AUTH_ERROR_ATTEMPTS_TOTAL: u8 = 3;
pub const AUTH_RETRY_EPISODE_MAX_GLOBAL: usize = 10_000;
pub const AUTH_RETRY_EPISODE_MAX_PER_AUTH_STORE: usize = 1_024;

pub fn merge_witness(
    current: &CompositeWitness,
    incoming: &CompositeWitness,
) -> SnapbackResult<CompositeWitness> {
    if current.authorization != incoming.authorization {
        return Err(corrupt(
            "one live scope cannot merge obligations from different authorization pairs",
        ));
    }
    let data = merge_data_witness(current.data.as_ref(), incoming.data.as_ref())?;
    Ok(CompositeWitness {
        authorization: incoming.authorization.clone(),
        data,
    })
}

pub fn merge_data_witness(
    current: Option<&DataWitness>,
    incoming: Option<&DataWitness>,
) -> SnapbackResult<Option<DataWitness>> {
    match (current, incoming) {
        (Some(current), Some(incoming)) => {
            if current.version_stream != incoming.version_stream {
                return Err(corrupt(
                    "one live scope cannot merge obligations from different version streams",
                ));
            }
            Ok(Some(DataWitness {
                version_stream: current.version_stream.clone(),
                min_commit_version: current.min_commit_version.max(incoming.min_commit_version),
            }))
        }
        (Some(current), None) => Ok(Some(current.clone())),
        (None, Some(incoming)) => Ok(Some(incoming.clone())),
        (None, None) => Ok(None),
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryEpisodeKey {
    pub authority_subject: String,
    pub client_store_id: String,
    pub query_key: String,
}

impl RetryEpisodeKey {
    fn validate(&self) -> SnapbackResult<()> {
        validate_opaque(&self.authority_subject, "authoritySubject")?;
        validate_opaque(&self.client_store_id, "clientStoreId")?;
        if self.query_key.is_empty() || self.query_key.len() > 8_192 {
            return Err(corrupt("retry query key is empty or too large"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryEpisode {
    pub episode_id: String,
    pub key: RetryEpisodeKey,
    pub witness_floor: CompositeWitness,
    pub first_attempt_reserved_at_ms: u64,
    pub first_failure_at_ms: Option<u64>,
    pub attempts_reserved: u8,
    pub deadline_ms: Option<u64>,
    pub manual_retry_id: Option<String>,
    pub last_reservation_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetryReservationKind {
    Initial,
    Automatic,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RetryReservation {
    Reserved(RetryEpisode),
    Attached(RetryEpisode),
    Exhausted(RetryEpisode),
}

/// Serializable durable retry-episode state. Storage persists this snapshot in
/// the auth-control transaction; counters are derived and cross-checked rather
/// than trusted independently.
///
/// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — retry budgets
/// survive re-fire, reconnect, scope replacement, and process restart.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryEpisodeRegistry {
    episodes: BTreeMap<RetryEpisodeKey, RetryEpisode>,
    clock_high_water_ms: u64,
    /// Durable episodes deliberately not loaded into this registry view.
    /// A key-scoped view (ENG-24990) loads exactly one episode; the caps
    /// still bind against the complete durable table through these
    /// storage-derived baselines. Zero for a fully loaded registry.
    #[serde(skip)]
    unloaded_global_records: usize,
    #[serde(skip)]
    unloaded_store_records: usize,
}

impl RetryEpisodeRegistry {
    pub fn episodes(&self) -> &BTreeMap<RetryEpisodeKey, RetryEpisode> {
        &self.episodes
    }

    pub fn clock_high_water_ms(&self) -> u64 {
        self.clock_high_water_ms
    }

    // Full-table loads remain for test-only registry snapshots; production
    // persistence is key-scoped (ENG-24990).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_persisted(
        episodes: BTreeMap<RetryEpisodeKey, RetryEpisode>,
        clock_high_water_ms: u64,
    ) -> SnapbackResult<Self> {
        validate_counter(clock_high_water_ms, "retry.clockHighWaterMs", false)?;
        for (key, episode) in &episodes {
            key.validate()?;
            episode.validate_persisted(key, clock_high_water_ms)?;
        }
        Ok(Self {
            episodes,
            clock_high_water_ms,
            unloaded_global_records: 0,
            unloaded_store_records: 0,
        })
    }

    /// Build a registry view holding at most the one episode a key-local
    /// storage transaction loaded. Capacity baselines carry the durable
    /// counts of the episodes deliberately left on disk so the fail-closed
    /// caps still bind exactly (LLP 0053: counters are rebuilt from the
    /// bounded table before admission).
    ///
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — retry
    /// persistence is per-key insert/replace/delete, not a full-table
    /// rewrite (ENG-24990).
    pub fn from_persisted_scoped(
        key: &RetryEpisodeKey,
        episode: Option<RetryEpisode>,
        clock_high_water_ms: u64,
        unloaded_global_records: usize,
        unloaded_store_records: usize,
    ) -> SnapbackResult<Self> {
        validate_counter(clock_high_water_ms, "retry.clockHighWaterMs", false)?;
        key.validate()?;
        let mut episodes = BTreeMap::new();
        if let Some(episode) = episode {
            episode.validate_persisted(key, clock_high_water_ms)?;
            episodes.insert(key.clone(), episode);
        }
        Ok(Self {
            episodes,
            clock_high_water_ms,
            unloaded_global_records,
            unloaded_store_records,
        })
    }

    pub fn reserve(
        &mut self,
        key: RetryEpisodeKey,
        witness_floor: CompositeWitness,
        now_ms: u64,
        kind: RetryReservationKind,
    ) -> SnapbackResult<RetryReservation> {
        key.validate()?;
        witness_floor.validate()?;
        validate_counter(now_ms, "retry.nowMs", false)?;
        if now_ms < self.clock_high_water_ms {
            if let Some(existing) = self.episodes.get_mut(&key) {
                existing.attempts_reserved = AUTH_ERROR_ATTEMPTS_TOTAL;
                existing.first_failure_at_ms.get_or_insert(
                    existing
                        .first_attempt_reserved_at_ms
                        .min(existing.last_reservation_at_ms),
                );
                existing.deadline_ms = Some(self.clock_high_water_ms);
                return Ok(RetryReservation::Exhausted(existing.clone()));
            }
            return Err(invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            ));
        }
        self.clock_high_water_ms = now_ms;

        if let Some(existing) = self.episodes.get_mut(&key) {
            existing.witness_floor = if existing.witness_floor.authorization
                == witness_floor.authorization
            {
                merge_witness(&existing.witness_floor, &witness_floor)?
            } else if existing.witness_floor.authorization.incarnation
                == witness_floor.authorization.incarnation
                && existing.witness_floor.authorization.epoch < witness_floor.authorization.epoch
            {
                CompositeWitness {
                    authorization: witness_floor.authorization.clone(),
                    data: merge_data_witness(
                        existing.witness_floor.data.as_ref(),
                        witness_floor.data.as_ref(),
                    )?,
                }
            } else {
                return Err(invalidation_error(
                    "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                    "retry witness cannot move backward or cross an unauthenticated incarnation",
                ));
            };
            if kind == RetryReservationKind::Initial {
                return Ok(RetryReservation::Attached(existing.clone()));
            }
            // A prior reservation with no recorded outcome is the crash case.
            // Its reservation time becomes the conservative failure origin;
            // restart can shorten but never extend the retry window.
            if existing.first_failure_at_ms.is_none() {
                let origin = existing
                    .first_attempt_reserved_at_ms
                    .min(existing.last_reservation_at_ms);
                existing.first_failure_at_ms = Some(origin);
                existing.deadline_ms = origin
                    .checked_add(AUTH_ERROR_RETRY_WINDOW_MS)
                    .filter(|value| *value <= MAX_PROTOCOL_COUNTER)
                    .or(Some(origin));
            }
            if existing.attempts_reserved >= AUTH_ERROR_ATTEMPTS_TOTAL
                || existing
                    .deadline_ms
                    .is_some_and(|deadline| now_ms > deadline)
            {
                return Ok(RetryReservation::Exhausted(existing.clone()));
            }
            existing.attempts_reserved += 1;
            existing.last_reservation_at_ms = now_ms;
            return Ok(RetryReservation::Reserved(existing.clone()));
        }

        if kind != RetryReservationKind::Initial {
            return Err(corrupt(
                "automatic retry cannot create an episode without an initial attempt",
            ));
        }
        self.ensure_capacity(&key)?;
        let episode = RetryEpisode {
            episode_id: crate::ids::mint_time_ordered(crate::ids::Kind::RetryEpisode),
            key: key.clone(),
            witness_floor,
            first_attempt_reserved_at_ms: now_ms,
            first_failure_at_ms: None,
            attempts_reserved: 1,
            deadline_ms: None,
            manual_retry_id: None,
            last_reservation_at_ms: now_ms,
        };
        self.episodes.insert(key, episode.clone());
        Ok(RetryReservation::Reserved(episode))
    }

    pub fn record_failure(&mut self, key: &RetryEpisodeKey, now_ms: u64) -> SnapbackResult<()> {
        validate_counter(now_ms, "retry.failureAtMs", false)?;
        let episode = self
            .episodes
            .get_mut(key)
            .ok_or_else(|| corrupt("retry failure has no reserved episode"))?;
        if now_ms < self.clock_high_water_ms {
            episode.attempts_reserved = AUTH_ERROR_ATTEMPTS_TOTAL;
            episode.first_failure_at_ms.get_or_insert(
                episode
                    .first_attempt_reserved_at_ms
                    .min(episode.last_reservation_at_ms),
            );
            episode.deadline_ms = Some(self.clock_high_water_ms);
            return Err(invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            ));
        }
        let failure_origin = now_ms;
        if episode.first_failure_at_ms.is_none() {
            episode.first_failure_at_ms = Some(failure_origin);
            episode.deadline_ms = failure_origin
                .checked_add(AUTH_ERROR_RETRY_WINDOW_MS)
                .filter(|value| *value <= MAX_PROTOCOL_COUNTER);
            if episode.deadline_ms.is_none() {
                // An unrepresentable deadline cannot be treated as an
                // unbounded retry window.
                episode.deadline_ms = Some(failure_origin);
            }
        }
        self.clock_high_water_ms = self.clock_high_water_ms.max(now_ms);
        Ok(())
    }

    pub fn resolve(&mut self, key: &RetryEpisodeKey, proof: &CompositeWitness) -> bool {
        let Some(episode) = self.episodes.get(key) else {
            return false;
        };
        if !proof.covers(&episode.witness_floor) {
            return false;
        }
        self.episodes.remove(key);
        true
    }

    pub fn manual_retry(
        &mut self,
        key: &RetryEpisodeKey,
        manual_retry_id: impl Into<String>,
        now_ms: u64,
    ) -> SnapbackResult<RetryReservation> {
        let manual_retry_id = manual_retry_id.into();
        validate_opaque(&manual_retry_id, "manualRetryId")?;
        validate_counter(now_ms, "manualRetry.nowMs", false)?;
        if now_ms < self.clock_high_water_ms {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            ));
        }
        let episode = self
            .episodes
            .get_mut(key)
            .ok_or_else(|| corrupt("manual retry has no unresolved episode"))?;
        if episode.manual_retry_id.as_deref() == Some(&manual_retry_id) {
            return Ok(RetryReservation::Attached(episode.clone()));
        }
        if episode.attempts_reserved < AUTH_ERROR_ATTEMPTS_TOTAL
            && episode
                .deadline_ms
                .is_none_or(|deadline| now_ms <= deadline)
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED",
                "manual retry cannot replace an authorization retry episode before exhaustion",
            ));
        }
        episode.episode_id = crate::ids::mint_time_ordered(crate::ids::Kind::RetryEpisode);
        episode.first_attempt_reserved_at_ms = now_ms;
        episode.first_failure_at_ms = None;
        episode.attempts_reserved = 1;
        episode.deadline_ms = None;
        episode.manual_retry_id = Some(manual_retry_id);
        episode.last_reservation_at_ms = now_ms;
        self.clock_high_water_ms = self.clock_high_water_ms.max(now_ms);
        Ok(RetryReservation::Reserved(episode.clone()))
    }

    fn ensure_capacity(&self, key: &RetryEpisodeKey) -> SnapbackResult<()> {
        let per_store = self
            .episodes
            .keys()
            .filter(|candidate| {
                candidate.authority_subject == key.authority_subject
                    && candidate.client_store_id == key.client_store_id
            })
            .count()
            .saturating_add(self.unloaded_store_records);
        let global = self
            .episodes
            .len()
            .saturating_add(self.unloaded_global_records);
        if global >= AUTH_RETRY_EPISODE_MAX_GLOBAL
            || per_store >= AUTH_RETRY_EPISODE_MAX_PER_AUTH_STORE
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY",
                "authorization retry episode storage is at its fail-closed capacity",
            ));
        }
        Ok(())
    }
}

impl RetryEpisode {
    fn validate_persisted(
        &self,
        expected_key: &RetryEpisodeKey,
        clock_high_water_ms: u64,
    ) -> SnapbackResult<()> {
        if &self.key != expected_key {
            return Err(corrupt("retry episode key does not match its storage key"));
        }
        validate_opaque(&self.episode_id, "retry.episodeId")?;
        self.witness_floor.validate()?;
        validate_counter(
            self.first_attempt_reserved_at_ms,
            "retry.firstAttemptReservedAtMs",
            false,
        )?;
        validate_counter(
            self.last_reservation_at_ms,
            "retry.lastReservationAtMs",
            false,
        )?;
        if self.attempts_reserved == 0 || self.attempts_reserved > AUTH_ERROR_ATTEMPTS_TOTAL {
            return Err(corrupt("retry attemptsReserved is outside 1..=3"));
        }
        if self.last_reservation_at_ms < self.first_attempt_reserved_at_ms
            || self.last_reservation_at_ms > clock_high_water_ms
        {
            return Err(corrupt("retry reservation times are not monotone"));
        }
        match (self.first_failure_at_ms, self.deadline_ms) {
            (None, None) => {}
            (Some(failure), Some(deadline)) => {
                validate_counter(failure, "retry.firstFailureAtMs", false)?;
                validate_counter(deadline, "retry.deadlineMs", false)?;
                let maximum = failure
                    .checked_add(AUTH_ERROR_RETRY_WINDOW_MS)
                    .filter(|value| *value <= MAX_PROTOCOL_COUNTER)
                    .unwrap_or(failure);
                if deadline > maximum {
                    return Err(corrupt("retry deadline extends beyond the fixed window"));
                }
            }
            _ => return Err(corrupt("retry failure and deadline must appear together")),
        }
        if let Some(manual_retry_id) = &self.manual_retry_id {
            validate_opaque(manual_retry_id, "retry.manualRetryId")?;
        }
        Ok(())
    }
}
