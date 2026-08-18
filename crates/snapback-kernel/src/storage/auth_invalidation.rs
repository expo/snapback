//! Durable server-side authorization-invalidation control state.
//!
//! @ref LLP 0053#invalidation-is-an-obligation-not-a-message — boot issuers
//! are reserved transactionally and retry episodes survive restart, refire,
//! scope replacement, and obligation revision changes.

use super::auth_stream::ensure_authorization_version_in;
use super::{LocalDatabase, MAX_AUTHORIZATION_EPOCH};
use crate::auth::invalidation::{
    AUTH_ERROR_ATTEMPTS_TOTAL, AUTH_ERROR_RETRY_WINDOW_MS, AUTH_RETRY_EPISODE_MAX_GLOBAL,
    AUTH_RETRY_EPISODE_MAX_PER_AUTH_STORE, CompositeWitness, DataWitness, MAX_PROTOCOL_COUNTER,
    RetryEpisode, RetryEpisodeKey, RetryReservation, RetryReservationKind, validate_counter,
    validate_opaque,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::BTreeMap;
use uuid::Uuid;

const BOOT_SEQUENCE_META_KEY: &str = "auth_invalidation_boot_sequence_v1";
const DATA_VERSION_STREAM_META_KEY: &str = "auth_invalidation_data_version_stream_v1";
pub(super) const AUTH_CLOCK_META_KEY: &str = "auth_invalidation_clock_high_water_ms_v1";
const RETRY_GLOBAL_COUNT_META_KEY: &str = "auth_invalidation_retry_records_v1";

fn corrupt(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_INVALIDATION_CORRUPT", "auth", message.into())
}

fn exhausted() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED",
        "auth",
        "authorization invalidation boot sequence exhausted the JavaScript-safe range",
    )
}

/// Kernel-owned durable view of retry episodes. Persistence constructors and
/// the clock high-water never cross the crate boundary; higher layers can ask
/// for typed retry operations but cannot manufacture storage state.
///
/// @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
/// persistence reconstruction stays inside the canonical-store kernel.
#[derive(Clone, Debug, Default)]
struct PersistedRetryEpisodeRegistry {
    episodes: BTreeMap<RetryEpisodeKey, RetryEpisode>,
    clock_high_water_ms: u64,
    unloaded_global_records: usize,
    unloaded_store_records: usize,
}

impl PersistedRetryEpisodeRegistry {
    fn episodes(&self) -> &BTreeMap<RetryEpisodeKey, RetryEpisode> {
        &self.episodes
    }

    fn clock_high_water_ms(&self) -> u64 {
        self.clock_high_water_ms
    }

    fn from_persisted(
        episodes: BTreeMap<RetryEpisodeKey, RetryEpisode>,
        clock_high_water_ms: u64,
    ) -> SnapbackResult<Self> {
        validate_counter(clock_high_water_ms, "retry.clockHighWaterMs", false)?;
        for (key, episode) in &episodes {
            validate_retry_episode_key(key)?;
            validate_persisted_retry_episode(episode, key, clock_high_water_ms)?;
        }
        Ok(Self {
            episodes,
            clock_high_water_ms,
            unloaded_global_records: 0,
            unloaded_store_records: 0,
        })
    }

    fn from_persisted_scoped(
        key: &RetryEpisodeKey,
        episode: Option<RetryEpisode>,
        clock_high_water_ms: u64,
        unloaded_global_records: usize,
        unloaded_store_records: usize,
    ) -> SnapbackResult<Self> {
        validate_counter(clock_high_water_ms, "retry.clockHighWaterMs", false)?;
        validate_retry_episode_key(key)?;
        let mut episodes = BTreeMap::new();
        if let Some(episode) = episode {
            validate_persisted_retry_episode(&episode, key, clock_high_water_ms)?;
            episodes.insert(key.clone(), episode);
        }
        Ok(Self {
            episodes,
            clock_high_water_ms,
            unloaded_global_records,
            unloaded_store_records,
        })
    }

    fn reserve(
        &mut self,
        key: RetryEpisodeKey,
        witness_floor: CompositeWitness,
        now_ms: u64,
        kind: RetryReservationKind,
    ) -> SnapbackResult<RetryReservation> {
        validate_retry_episode_key(&key)?;
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
            return Err(crate::auth::invalidation::invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            )
            .into());
        }
        self.clock_high_water_ms = now_ms;

        if let Some(existing) = self.episodes.get_mut(&key) {
            existing.witness_floor = if existing.witness_floor.authorization
                == witness_floor.authorization
            {
                merge_retry_witness(&existing.witness_floor, &witness_floor)?
            } else if existing.witness_floor.authorization.incarnation
                == witness_floor.authorization.incarnation
                && existing.witness_floor.authorization.epoch < witness_floor.authorization.epoch
            {
                CompositeWitness {
                    authorization: witness_floor.authorization.clone(),
                    data: merge_retry_data_witness(
                        existing.witness_floor.data.as_ref(),
                        witness_floor.data.as_ref(),
                    )?,
                }
            } else {
                return Err(crate::auth::invalidation::invalidation_error(
                    "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                    "retry witness cannot move backward or cross an unauthenticated incarnation",
                )
                .into());
            };
            if kind == RetryReservationKind::Initial {
                return Ok(RetryReservation::Attached(existing.clone()));
            }
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

    fn record_failure(&mut self, key: &RetryEpisodeKey, now_ms: u64) -> SnapbackResult<()> {
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
            return Err(crate::auth::invalidation::invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            )
            .into());
        }
        if episode.first_failure_at_ms.is_none() {
            episode.first_failure_at_ms = Some(now_ms);
            episode.deadline_ms = now_ms
                .checked_add(AUTH_ERROR_RETRY_WINDOW_MS)
                .filter(|value| *value <= MAX_PROTOCOL_COUNTER)
                .or(Some(now_ms));
        }
        self.clock_high_water_ms = self.clock_high_water_ms.max(now_ms);
        Ok(())
    }

    fn resolve(&mut self, key: &RetryEpisodeKey, proof: &CompositeWitness) -> bool {
        let Some(episode) = self.episodes.get(key) else {
            return false;
        };
        if !proof.covers(&episode.witness_floor) {
            return false;
        }
        self.episodes.remove(key);
        true
    }

    fn manual_retry(
        &mut self,
        key: &RetryEpisodeKey,
        manual_retry_id: impl Into<String>,
        now_ms: u64,
    ) -> SnapbackResult<RetryReservation> {
        let manual_retry_id = manual_retry_id.into();
        validate_opaque(&manual_retry_id, "manualRetryId")?;
        validate_counter(now_ms, "manualRetry.nowMs", false)?;
        if now_ms < self.clock_high_water_ms {
            return Err(crate::auth::invalidation::invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            )
            .into());
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
            return Err(crate::auth::invalidation::invalidation_error(
                "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED",
                "manual retry cannot replace an authorization retry episode before exhaustion",
            )
            .into());
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
            return Err(crate::auth::invalidation::invalidation_error(
                "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY",
                "authorization retry episode storage is at its fail-closed capacity",
            )
            .into());
        }
        Ok(())
    }
}

fn validate_retry_episode_key(key: &RetryEpisodeKey) -> SnapbackResult<()> {
    validate_opaque(&key.authority_subject, "authoritySubject")?;
    validate_opaque(&key.client_store_id, "clientStoreId")?;
    if key.query_key.is_empty() || key.query_key.len() > 8_192 {
        return Err(corrupt("retry query key is empty or too large"));
    }
    Ok(())
}

fn validate_persisted_retry_episode(
    episode: &RetryEpisode,
    expected_key: &RetryEpisodeKey,
    clock_high_water_ms: u64,
) -> SnapbackResult<()> {
    if &episode.key != expected_key {
        return Err(corrupt("retry episode key does not match its storage key"));
    }
    validate_opaque(&episode.episode_id, "retry.episodeId")?;
    episode.witness_floor.validate()?;
    validate_counter(
        episode.first_attempt_reserved_at_ms,
        "retry.firstAttemptReservedAtMs",
        false,
    )?;
    validate_counter(
        episode.last_reservation_at_ms,
        "retry.lastReservationAtMs",
        false,
    )?;
    if episode.attempts_reserved == 0 || episode.attempts_reserved > AUTH_ERROR_ATTEMPTS_TOTAL {
        return Err(corrupt("retry attemptsReserved is outside 1..=3"));
    }
    if episode.last_reservation_at_ms < episode.first_attempt_reserved_at_ms
        || episode.last_reservation_at_ms > clock_high_water_ms
    {
        return Err(corrupt("retry reservation times are not monotone"));
    }
    match (episode.first_failure_at_ms, episode.deadline_ms) {
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
    if let Some(manual_retry_id) = &episode.manual_retry_id {
        validate_opaque(manual_retry_id, "retry.manualRetryId")?;
    }
    Ok(())
}

fn merge_retry_witness(
    current: &CompositeWitness,
    incoming: &CompositeWitness,
) -> SnapbackResult<CompositeWitness> {
    if current.authorization != incoming.authorization {
        return Err(corrupt(
            "one live scope cannot merge obligations from different authorization pairs",
        ));
    }
    let data = merge_retry_data_witness(current.data.as_ref(), incoming.data.as_ref())?;
    Ok(CompositeWitness {
        authorization: incoming.authorization.clone(),
        data,
    })
}

fn merge_retry_data_witness(
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

impl LocalDatabase {
    /// The durable data version stream (LLP 0043/0053 `versionStreamId`):
    /// ensured on first read, rotated only inside reset/import/restore
    /// transactions. RQS token admission compares it by exact string
    /// equality (LLP 0091 §0A.7 — no new stream identity).
    pub fn data_version_stream(&mut self) -> SnapbackResult<String> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stream = ensure_data_version_stream_in(&tx)?;
        tx.commit()?;
        Ok(stream)
    }

    /// Activate the server-owned ordinary-mutation coverage cut on this
    /// database. No production caller invokes this while LLP 0163 remains
    /// Draft; the paired acceptance recorder uses it only on a fresh private
    /// fixture so it can measure the real covered write seam without
    /// advertising the capability.
    ///
    /// @ref LLP 0162#measurement-gate — candidate evidence must exercise the
    ///   issuance-bearing covered lane, not merely the dormant implementation.
    pub fn activate_ordinary_mutation_coverage_for_evidence(
        &mut self,
        activated_at_ms: u64,
    ) -> SnapbackResult<()> {
        let manifest = {
            let _writer = self
                .writer_authority
                .enter(super::write_authority::LocalWriterLaneV1::OperationLedger)?;
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let stream = ensure_data_version_stream_in(&tx)?;
            let manifest = crate::operation_ledger::activate_ordinary_mutation_coverage_in(
                &tx,
                &stream,
                activated_at_ms,
            )?;
            let persisted = crate::operation_ledger::active_coverage_manifest(&tx, &stream)?
                .ok_or_else(|| {
                    corrupt("ordinary-mutation activation did not retain a coverage manifest")
                })?;
            if persisted != manifest {
                return Err(corrupt(
                    "ordinary-mutation activation did not retain the closed coverage manifest",
                ));
            }
            tx.commit()?;
            manifest
        };
        // The same-process SQLite authorizer observes this exact committed
        // manifest before activation reports success. Reopen reconstructs the
        // same state from the durable row.
        self.writer_authority.arm_manifest(&self.conn, manifest)?;
        Ok(())
    }

    /// Publish the closed local-target coverage cut through production storage
    /// code. The caller remains server-owned: range issuance and database open
    /// never activate coverage implicitly. Publication first proves that the
    /// physical inventory has no grouped or reason-less row, then names only
    /// the four adapters that already carry authenticated envelopes.
    ///
    /// @ref LLP 0162#acceptance — row 4 requires a complete target inventory
    ///   and makes every excluded app-effective writer remain visibly Missing.
    pub fn activate_local_target_operation_coverage(
        &mut self,
        activated_at_ms: u64,
    ) -> SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1> {
        let before = self.local_writer_coverage_inventory()?;
        if !before.all_physical_writers_enumerated || !before.all_app_effective_writers_accounted {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_COVERAGE_INCOMPLETE",
                "storage",
                "local operation coverage requires a closed physical writer inventory",
            ));
        }

        let manifest = {
            let _writer = self
                .writer_authority
                .enter(super::write_authority::LocalWriterLaneV1::OperationLedger)?;
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let stream = ensure_data_version_stream_in(&tx)?;
            let manifest = crate::operation_ledger::activate_local_target_mutation_coverage_in(
                &tx,
                &stream,
                activated_at_ms,
            )?;
            let persisted = crate::operation_ledger::active_coverage_manifest(&tx, &stream)?
                .ok_or_else(|| corrupt("local-target activation lost its coverage manifest"))?;
            if persisted != manifest {
                return Err(corrupt(
                    "local-target activation did not retain the exact coverage manifest",
                ));
            }
            validate_local_target_coverage_manifest(&manifest)?;
            tx.commit()?;
            manifest
        };
        self.writer_authority
            .arm_manifest(&self.conn, manifest.clone())?;
        Ok(manifest)
    }

    /// Arm the fork-only journal-authority profile. The manifest uses logical
    /// lane names distinct from LLP 0163's operation-envelope lanes, so a
    /// normal fork mutation remains unattributed while every covered physical
    /// writer still requires the generated token and emits the app journal in
    /// its transaction.
    ///
    /// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — a
    ///   fresh derived fork may publish this narrower whole-lifetime cut
    ///   without changing the parent deployment's default arming policy.
    pub fn activate_derived_fork_app_row_journal_coverage(
        &mut self,
        activated_at_ms: u64,
    ) -> SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1> {
        let before = self.local_writer_coverage_inventory()?;
        if !before.all_physical_writers_enumerated || !before.all_app_effective_writers_accounted {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_COVERAGE_INCOMPLETE",
                "storage",
                "derived-fork journal coverage requires a closed physical writer inventory",
            ));
        }

        let manifest = {
            let _writer = self
                .writer_authority
                .enter(super::write_authority::LocalWriterLaneV1::OperationLedger)?;
            let tx = self
                .conn
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let stream = ensure_data_version_stream_in(&tx)?;
            let manifest =
                crate::operation_ledger::activate_derived_fork_app_row_journal_coverage_in(
                    &tx,
                    &stream,
                    activated_at_ms,
                )?;
            let persisted = crate::operation_ledger::active_coverage_manifest(&tx, &stream)?
                .ok_or_else(|| corrupt("derived-fork activation lost its coverage manifest"))?;
            if persisted != manifest {
                return Err(corrupt(
                    "derived-fork activation did not retain the exact coverage manifest",
                ));
            }
            validate_derived_fork_coverage_manifest(&manifest)?;
            tx.commit()?;
            manifest
        };
        self.writer_authority
            .arm_manifest(&self.conn, manifest.clone())?;
        Ok(manifest)
    }

    /// Persist the fork-point coverage receipt without opening a competing
    /// short-lived SQLite connection or draining the live WAL during startup.
    ///
    /// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 —
    ///   the receipt and active manifest share the pre-bind serving cut.
    pub fn persist_derived_fork_app_row_coverage_receipt(
        &self,
        encoded: &str,
    ) -> SnapbackResult<()> {
        let _writer = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::OperationLedger)?;
        self.conn.execute(
            "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
            params![crate::instance_fork::APP_ROW_COVERAGE_META_KEY, encoded],
        )?;
        Ok(())
    }

    /// Reserve one never-reused boot sequence in the same transaction that
    /// reads the authorization incarnation it names. A crash consumes the
    /// reservation; rollback makes it available because no issuer escaped.
    pub fn reserve_invalidation_boot_issuer(
        &mut self,
    ) -> SnapbackResult<(crate::storage::AuthorizationVersion, String, u64)> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let authorization = ensure_authorization_version_in(&tx)?;
        let version_stream = ensure_data_version_stream_in(&tx)?;
        let previous = strict_meta_u64(&tx, BOOT_SEQUENCE_META_KEY)?.unwrap_or(0);
        let sequence = previous
            .checked_add(1)
            .filter(|value| *value <= MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(exhausted)?;
        write_meta_u64(&tx, BOOT_SEQUENCE_META_KEY, sequence)?;
        tx.commit()?;
        Ok((authorization, version_stream, sequence))
    }

    /// Run one retry-registry operation for exactly one episode key under one
    /// IMMEDIATE auth-control transaction. Only the named episode row, the
    /// affected `(authority_subject, client_store_id)` counter row, the global
    /// count, and the shared clock high-water can be read strictly or written;
    /// unrelated episodes are never deserialized or rewritten, so a refire
    /// against one key performs bounded row writes regardless of how many
    /// other episodes exist (ENG-24990).
    ///
    /// The episode table remains the authority: whenever admission of a new
    /// episode is possible (the key has no durable episode) the capacity
    /// baselines are derived from bounded `COUNT` queries against the table
    /// itself, and missing/malformed counter projections are rebuilt from it.
    ///
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — counters
    /// are maintained in the same auth-control transaction as episode
    /// insert/replace/delete and rebuilt from the bounded table before
    /// admission; no unresolved or exhausted episode is ever safety-evicted.
    fn with_invalidation_retry_episode<T>(
        &mut self,
        key: &RetryEpisodeKey,
        operation: impl FnOnce(&mut PersistedRetryEpisodeRegistry) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let clock_high_water_ms = strict_meta_u64(&tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
        let head = super::current_version_on(&tx)?;
        let loaded = load_retry_episode(&tx, key, head)?;
        // Creation is possible only while the key has no durable episode; in
        // that case both caps are enforced from exact table-derived counts.
        // With the episode loaded, `reserve` can only attach or replace, so
        // the (unused) global baseline may come from the maintained
        // projection without another full-table scan.
        let store_records = usize::try_from(count_store_episodes(&tx, key)?)
            .map_err(|_| corrupt("retry per-store count is not representable"))?;
        let global_records = if loaded.is_some() {
            match lenient_meta_u64(&tx, RETRY_GLOBAL_COUNT_META_KEY) {
                Some(value) => usize::try_from(value)
                    .map_err(|_| corrupt("retry global count is not representable"))?,
                None => usize::try_from(count_global_episodes(&tx)?)
                    .map_err(|_| corrupt("retry global count is not representable"))?,
            }
        } else {
            usize::try_from(count_global_episodes(&tx)?)
                .map_err(|_| corrupt("retry global count is not representable"))?
        };
        let loaded_records = usize::from(loaded.is_some());
        let mut registry = PersistedRetryEpisodeRegistry::from_persisted_scoped(
            key,
            loaded.clone(),
            clock_high_water_ms,
            global_records.saturating_sub(loaded_records),
            store_records.saturating_sub(loaded_records),
        )?;
        let output = operation(&mut registry)?;
        if let Some(episode) = registry.episodes().get(key) {
            validate_retry_episode_data_head(episode, head)?;
        }
        persist_scoped_retry_episode(&tx, key, loaded.as_ref(), clock_high_water_ms, &registry)?;
        tx.commit()?;
        Ok(output)
    }

    pub fn reserve_invalidation_retry_episode(
        &mut self,
        key: &RetryEpisodeKey,
        witness_floor: crate::auth::invalidation::CompositeWitness,
        now_ms: u64,
        kind: crate::auth::invalidation::RetryReservationKind,
    ) -> SnapbackResult<crate::auth::invalidation::RetryReservation> {
        self.with_invalidation_retry_episode(key, |registry| {
            registry
                .reserve(key.clone(), witness_floor, now_ms, kind)
                .map_err(Into::into)
        })
    }

    pub fn record_invalidation_retry_failure(
        &mut self,
        key: &RetryEpisodeKey,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_invalidation_retry_episode(key, |registry| {
            registry.record_failure(key, now_ms).map_err(Into::into)
        })
    }

    pub fn resolve_invalidation_retry_episode(
        &mut self,
        key: &RetryEpisodeKey,
        proof: &crate::auth::invalidation::CompositeWitness,
    ) -> SnapbackResult<bool> {
        self.with_invalidation_retry_episode(key, |registry| Ok(registry.resolve(key, proof)))
    }

    pub fn reserve_manual_invalidation_retry(
        &mut self,
        key: &RetryEpisodeKey,
        manual_retry_id: impl Into<String>,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::invalidation::RetryReservation> {
        self.with_invalidation_retry_episode(key, |registry| {
            registry
                .manual_retry(key, manual_retry_id, now_ms)
                .map_err(Into::into)
        })
    }

    /// Test-only full snapshot of the durable retry registry. Reads and
    /// validates every episode without rewriting anything; production paths
    /// are key-local by design.
    #[cfg(any(test, feature = "test-support"))]
    fn read_invalidation_retry_registry<T>(
        &mut self,
        operation: impl FnOnce(&PersistedRetryEpisodeRegistry) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let head = super::current_version_on(&tx)?;
        let episodes = load_retry_episodes(&tx, head)?;
        let clock_high_water_ms = strict_meta_u64(&tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
        let registry =
            PersistedRetryEpisodeRegistry::from_persisted(episodes, clock_high_water_ms)?;
        let output = operation(&registry)?;
        tx.commit()?;
        Ok(output)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn invalidation_retry_episodes_for_test(
        &mut self,
    ) -> SnapbackResult<BTreeMap<RetryEpisodeKey, RetryEpisode>> {
        self.read_invalidation_retry_registry(|registry| Ok(registry.episodes().clone()))
    }

    /// Test-only bulk fixture installer: durable episodes, counter rows, the
    /// global count, and the clock high-water in one transaction, exactly as
    /// incremental maintenance would have left them.
    #[cfg(any(test, feature = "test-support"))]
    pub fn seed_invalidation_retry_episodes_for_test(
        &mut self,
        episodes: &BTreeMap<RetryEpisodeKey, RetryEpisode>,
        clock_high_water_ms: u64,
    ) -> SnapbackResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO _snapback_auth_retry_episodes(
                     authority_subject, client_store_id, query_key, episode_json
                 ) VALUES(?1, ?2, ?3, ?4)",
            )?;
            for (key, episode) in episodes {
                let encoded = serde_json::to_string(episode)
                    .map_err(|_| corrupt("retry episode could not be encoded"))?;
                insert.execute(params![
                    key.authority_subject,
                    key.client_store_id,
                    key.query_key,
                    encoded
                ])?;
            }
        }
        persist_retry_counters(&tx, episodes)?;
        write_meta_u64(&tx, AUTH_CLOCK_META_KEY, clock_high_water_ms)?;
        tx.commit()?;
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn invalidation_retry_episode_count(&self) -> SnapbackResult<u64> {
        let count = self.conn.query_row(
            "SELECT COUNT(*) FROM _snapback_auth_retry_episodes",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        u64::try_from(count).map_err(|_| corrupt("retry episode count is negative"))
    }

    /// Total row inserts/updates/deletes performed on this connection since
    /// open. Used by tests to prove key-local persistence writes a bounded
    /// number of rows.
    #[cfg(any(test, feature = "test-support"))]
    pub fn total_row_changes_for_test(&self) -> SnapbackResult<i64> {
        Ok(self
            .conn
            .query_row("SELECT total_changes()", [], |row| row.get(0))?)
    }
}

fn validate_local_target_coverage_manifest(
    manifest: &crate::commit_envelope::OperationCoverageManifestV1,
) -> SnapbackResult<()> {
    let actual_lanes = manifest
        .covered_lanes
        .iter()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected_lanes = [
        crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
        crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
    ]
    .into_iter()
    .collect::<std::collections::BTreeSet<_>>();
    let actual_writers = manifest
        .writer_choke_points
        .iter()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected_writers = crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
        .into_iter()
        .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
        .collect::<std::collections::BTreeSet<_>>();
    if actual_lanes == expected_lanes && actual_writers == expected_writers {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_OPERATION_COVERAGE_INCOMPLETE",
            "storage",
            "local operation coverage manifest is not the exact closed adapter set",
        ))
    }
}

fn validate_derived_fork_coverage_manifest(
    manifest: &crate::commit_envelope::OperationCoverageManifestV1,
) -> SnapbackResult<()> {
    let actual_lanes = manifest
        .covered_lanes
        .iter()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected_lanes = [
        crate::operation_ledger::DERIVED_FORK_ORDINARY_APP_ROW_JOURNAL_LANE_V1,
        crate::operation_ledger::DERIVED_FORK_HOST_CHILD_APP_ROW_JOURNAL_LANE_V1,
    ]
    .into_iter()
    .collect::<std::collections::BTreeSet<_>>();
    let actual_writers = manifest
        .writer_choke_points
        .iter()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected_writers = crate::operation_ledger::ORDINARY_MUTATION_WRITERS_V1
        .into_iter()
        .chain(crate::operation_ledger::HOST_CHILD_MUTATION_WRITERS_V1)
        .collect::<std::collections::BTreeSet<_>>();
    if manifest.covered_lanes.len() == expected_lanes.len()
        && actual_lanes == expected_lanes
        && manifest.writer_choke_points.len() == expected_writers.len()
        && actual_writers == expected_writers
    {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_OPERATION_COVERAGE_INCOMPLETE",
            "storage",
            "derived-fork journal coverage manifest is not the exact closed adapter set",
        ))
    }
}

/// Load and strictly validate the one durable episode row for `key`.
/// Canonical-encoding and key-binding corruption checks match the full
/// loader row-for-row; unrelated rows are deliberately untouched and are
/// checked when their own key is next operated on.
fn load_retry_episode(
    tx: &Transaction<'_>,
    key: &RetryEpisodeKey,
    maximum: u64,
) -> SnapbackResult<Option<RetryEpisode>> {
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT typeof(episode_json), episode_json
             FROM _snapback_auth_retry_episodes
             WHERE authority_subject = ?1 AND client_store_id = ?2 AND query_key = ?3",
            params![key.authority_subject, key.client_store_id, key.query_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((storage_class, encoded)) = row else {
        return Ok(None);
    };
    if storage_class != "text" {
        return Err(corrupt("retry episode JSON is not SQLite text"));
    }
    let episode: RetryEpisode = serde_json::from_str(&encoded)
        .map_err(|_| corrupt("retry episode JSON is malformed or non-canonical"))?;
    if &episode.key != key {
        return Err(corrupt(
            "retry episode primary key does not match its payload",
        ));
    }
    let canonical = serde_json::to_string(&episode)
        .map_err(|_| corrupt("retry episode could not be canonically encoded"))?;
    if canonical != encoded {
        return Err(corrupt("retry episode JSON is not canonically encoded"));
    }
    validate_retry_episode_data_head(&episode, maximum)?;
    Ok(Some(episode))
}

fn validate_retry_episode_data_head(episode: &RetryEpisode, maximum: u64) -> SnapbackResult<()> {
    if let Some(data) = &episode.witness_floor.data {
        super::validate_storage_version_at_most(
            data.min_commit_version,
            maximum,
            "authorization retry data witness version",
        )?;
    }
    Ok(())
}

fn count_global_episodes(tx: &Transaction<'_>) -> SnapbackResult<u64> {
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_auth_retry_episodes",
        [],
        |row| row.get(0),
    )?;
    u64::try_from(count).map_err(|_| corrupt("retry episode count is negative"))
}

fn count_store_episodes(tx: &Transaction<'_>, key: &RetryEpisodeKey) -> SnapbackResult<u64> {
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_auth_retry_episodes
         WHERE authority_subject = ?1 AND client_store_id = ?2",
        params![key.authority_subject, key.client_store_id],
        |row| row.get(0),
    )?;
    u64::try_from(count).map_err(|_| corrupt("retry per-store count is negative"))
}

/// A missing or malformed counter projection is repaired from the table, the
/// same posture the previous full-rewrite persistence took by blindly
/// re-deriving it on every entry.
fn lenient_meta_u64(tx: &Transaction<'_>, key: &str) -> Option<u64> {
    strict_meta_u64(tx, key).ok().flatten()
}

/// Persist exactly the state a key-scoped operation may have changed: the one
/// episode row (insert/replace/delete only when its bytes changed), the shared
/// clock high-water (only when advanced), the affected per-store counter row,
/// and the global count. Counter and episode changes commit atomically or not
/// at all.
fn persist_scoped_retry_episode(
    tx: &Transaction<'_>,
    key: &RetryEpisodeKey,
    loaded: Option<&RetryEpisode>,
    loaded_clock_high_water_ms: u64,
    registry: &PersistedRetryEpisodeRegistry,
) -> SnapbackResult<()> {
    if registry.episodes().keys().any(|candidate| candidate != key) {
        return Err(corrupt(
            "key-scoped retry operation escaped its episode key",
        ));
    }
    let current = registry.episodes().get(key);
    if current.is_some_and(|episode| &episode.key != key) {
        return Err(corrupt("retry episode key does not match its storage key"));
    }
    match (loaded, current) {
        (None, None) => {}
        (Some(before), Some(after)) if before == after => {}
        (_, Some(after)) => {
            let encoded = serde_json::to_string(after)
                .map_err(|_| corrupt("retry episode could not be encoded"))?;
            tx.execute(
                "INSERT INTO _snapback_auth_retry_episodes(
                     authority_subject, client_store_id, query_key, episode_json
                 ) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(authority_subject, client_store_id, query_key)
                 DO UPDATE SET episode_json = excluded.episode_json",
                params![
                    key.authority_subject,
                    key.client_store_id,
                    key.query_key,
                    encoded
                ],
            )?;
        }
        (Some(_), None) => {
            tx.execute(
                "DELETE FROM _snapback_auth_retry_episodes
                 WHERE authority_subject = ?1 AND client_store_id = ?2 AND query_key = ?3",
                params![key.authority_subject, key.client_store_id, key.query_key],
            )?;
        }
    }
    if registry.clock_high_water_ms() != loaded_clock_high_water_ms {
        write_meta_u64(tx, AUTH_CLOCK_META_KEY, registry.clock_high_water_ms())?;
    }
    // The affected store's counter row is re-derived from the table (bounded
    // by the per-store cap through an indexed prefix count), repairing any
    // missing or drifted projection for the store this operation touched.
    let store_records = count_store_episodes(tx, key)?;
    write_store_counter_if_changed(tx, key, store_records)?;
    let created = loaded.is_none() && current.is_some();
    let deleted = loaded.is_some() && current.is_none();
    update_global_count(tx, created, deleted)?;
    Ok(())
}

fn write_store_counter_if_changed(
    tx: &Transaction<'_>,
    key: &RetryEpisodeKey,
    records: u64,
) -> SnapbackResult<()> {
    let stored: Option<rusqlite::types::Value> = tx
        .query_row(
            "SELECT records FROM _snapback_auth_retry_counters
             WHERE authority_subject = ?1 AND client_store_id = ?2",
            params![key.authority_subject, key.client_store_id],
            |row| row.get(0),
        )
        .optional()?;
    let records_i64 = i64::try_from(records)
        .map_err(|_| corrupt("retry per-store count is not representable"))?;
    match (&stored, records) {
        (None, 0) => Ok(()),
        (Some(rusqlite::types::Value::Integer(value)), _)
            if *value == records_i64 && records > 0 =>
        {
            Ok(())
        }
        (_, 0) => {
            // Stores without episodes keep no counter row, matching the
            // previous full-derivation projection exactly.
            tx.execute(
                "DELETE FROM _snapback_auth_retry_counters
                 WHERE authority_subject = ?1 AND client_store_id = ?2",
                params![key.authority_subject, key.client_store_id],
            )?;
            Ok(())
        }
        _ => {
            tx.execute(
                "INSERT INTO _snapback_auth_retry_counters(
                     authority_subject, client_store_id, records
                 ) VALUES(?1, ?2, ?3)
                 ON CONFLICT(authority_subject, client_store_id)
                 DO UPDATE SET records = excluded.records",
                params![key.authority_subject, key.client_store_id, records_i64],
            )?;
            Ok(())
        }
    }
}

/// The global count is adjusted by the structural delta of this operation, or
/// rebuilt from the (already updated) authoritative table when the stored
/// projection is missing or malformed.
fn update_global_count(tx: &Transaction<'_>, created: bool, deleted: bool) -> SnapbackResult<()> {
    let stored = lenient_meta_u64(tx, RETRY_GLOBAL_COUNT_META_KEY);
    let value = match stored {
        Some(_) if !created && !deleted => return Ok(()),
        Some(value) if created => value.saturating_add(1),
        Some(value) => value.saturating_sub(1),
        None => count_global_episodes(tx)?,
    };
    write_meta_u64(
        tx,
        RETRY_GLOBAL_COUNT_META_KEY,
        value.min(MAX_AUTHORIZATION_EPOCH),
    )
}

#[cfg(any(test, feature = "test-support"))]
fn load_retry_episodes(
    tx: &Transaction<'_>,
    maximum: u64,
) -> SnapbackResult<BTreeMap<RetryEpisodeKey, RetryEpisode>> {
    let mut statement = tx.prepare(
        "SELECT authority_subject, client_store_id, query_key, episode_json
         FROM _snapback_auth_retry_episodes
         ORDER BY authority_subject, client_store_id, query_key",
    )?;
    let mut rows = statement.query([])?;
    let mut episodes = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let key = RetryEpisodeKey {
            authority_subject: row.get(0)?,
            client_store_id: row.get(1)?,
            query_key: row.get(2)?,
        };
        let storage_class: String = row.get_ref(3)?.data_type().to_string();
        if storage_class != "Text" {
            return Err(corrupt("retry episode JSON is not SQLite text"));
        }
        let encoded: String = row.get(3)?;
        let episode: RetryEpisode = serde_json::from_str(&encoded)
            .map_err(|_| corrupt("retry episode JSON is malformed or non-canonical"))?;
        if episode.key != key {
            return Err(corrupt(
                "retry episode primary key does not match its payload",
            ));
        }
        let canonical = serde_json::to_string(&episode)
            .map_err(|_| corrupt("retry episode could not be canonically encoded"))?;
        if canonical != encoded {
            return Err(corrupt("retry episode JSON is not canonically encoded"));
        }
        validate_retry_episode_data_head(&episode, maximum)?;
        if episodes.insert(key, episode).is_some() {
            return Err(corrupt("retry episode key is duplicated"));
        }
    }
    Ok(episodes)
}

#[cfg(any(test, feature = "test-support"))]
fn persist_retry_counters(
    tx: &Transaction<'_>,
    episodes: &BTreeMap<RetryEpisodeKey, RetryEpisode>,
) -> SnapbackResult<()> {
    let global = u64::try_from(episodes.len())
        .map_err(|_| corrupt("retry episode count is not representable"))?;
    write_meta_u64(tx, RETRY_GLOBAL_COUNT_META_KEY, global)?;
    let mut per_store: BTreeMap<(&str, &str), u64> = BTreeMap::new();
    for key in episodes.keys() {
        let count = per_store
            .entry((&key.authority_subject, &key.client_store_id))
            .or_default();
        *count = count
            .checked_add(1)
            .ok_or_else(|| corrupt("retry per-store count overflowed"))?;
    }
    tx.execute("DELETE FROM _snapback_auth_retry_counters", [])?;
    let mut insert = tx.prepare(
        "INSERT INTO _snapback_auth_retry_counters(
             authority_subject, client_store_id, records
         ) VALUES(?1, ?2, ?3)",
    )?;
    for ((authority_subject, client_store_id), records) in per_store {
        insert.execute(params![authority_subject, client_store_id, records])?;
    }
    Ok(())
}

/// A destructive incarnation rotation makes every old retry witness
/// permanently non-current. Remove episodes and both counter projections in
/// the same transaction as that rotation; ordinary restart never calls this.
pub fn clear_retry_episodes_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    tx.execute("DELETE FROM _snapback_auth_retry_episodes", [])?;
    tx.execute("DELETE FROM _snapback_auth_retry_counters", [])?;
    write_meta_u64(tx, RETRY_GLOBAL_COUNT_META_KEY, 0)?;
    Ok(())
}

pub fn rotate_data_version_stream_in(tx: &Transaction<'_>) -> SnapbackResult<String> {
    let stream = Uuid::now_v7().hyphenated().to_string();
    write_text_meta(tx, DATA_VERSION_STREAM_META_KEY, &stream)?;
    Ok(stream)
}

pub(super) fn ensure_data_version_stream_in(tx: &Transaction<'_>) -> SnapbackResult<String> {
    let value: Option<(String, Vec<u8>)> = tx
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta WHERE key = ?1",
            params![DATA_VERSION_STREAM_META_KEY],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match value {
        None => rotate_data_version_stream_in(tx),
        Some((storage_class, bytes)) if storage_class == "text" => {
            let stream = std::str::from_utf8(&bytes)
                .map_err(|_| corrupt("data version stream is not UTF-8"))?;
            let parsed = Uuid::parse_str(stream)
                .map_err(|_| corrupt("data version stream is not a canonical UUIDv7"))?;
            if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != stream {
                return Err(corrupt("data version stream is not a canonical UUIDv7"));
            }
            Ok(stream.to_owned())
        }
        Some(_) => Err(corrupt("data version stream is not SQLite text")),
    }
}

pub(super) fn strict_meta_u64(
    connection: &rusqlite::Connection,
    key: &str,
) -> SnapbackResult<Option<u64>> {
    let value: Option<(String, Vec<u8>)> = connection
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((storage_class, bytes)) = value else {
        return Ok(None);
    };
    if storage_class != "text" {
        return Err(corrupt(format!("{key} is not SQLite text")));
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| corrupt(format!("{key} is not UTF-8")))?;
    if text.is_empty()
        || (text.len() > 1 && text.starts_with('0'))
        || !text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(corrupt(format!("{key} is not a canonical counter")));
    }
    let value = text
        .parse::<u64>()
        .map_err(|_| corrupt(format!("{key} is not a canonical counter")))?;
    if value > MAX_AUTHORIZATION_EPOCH {
        return Err(corrupt(format!("{key} exceeds the JavaScript-safe range")));
    }
    Ok(Some(value))
}

pub(super) fn write_meta_u64(tx: &Transaction<'_>, key: &str, value: u64) -> SnapbackResult<()> {
    if value > MAX_AUTHORIZATION_EPOCH {
        return Err(corrupt(format!("{key} exceeds the JavaScript-safe range")));
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

fn write_text_meta(tx: &Transaction<'_>, key: &str, value: &str) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::invalidation::{
        AUTH_ERROR_ATTEMPTS_TOTAL, CompositeWitness, DataWitness, RetryReservation,
        RetryReservationKind,
    };
    use crate::storage::AuthorizationVersion;
    use tempfile::tempdir;

    const INCARNATION: &str = "018f0d90-7b11-7a22-8c33-445566778899";

    fn witness(version: u64) -> CompositeWitness {
        CompositeWitness {
            authorization: AuthorizationVersion {
                incarnation: INCARNATION.to_owned(),
                epoch: 0,
            },
            data: Some(DataWitness {
                version_stream: "stream-A".to_owned(),
                min_commit_version: version,
            }),
        }
    }

    fn key() -> RetryEpisodeKey {
        RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-A".to_owned(),
            query_key: "todos:{}".to_owned(),
        }
    }

    #[test]
    fn boot_sequence_is_consumed_before_restart_and_names_current_incarnation() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut first = LocalDatabase::open(&path).unwrap();
        let (authorization, stream, sequence) = first.reserve_invalidation_boot_issuer().unwrap();
        assert_eq!(sequence, 1);
        drop(first);

        let mut second = LocalDatabase::open(&path).unwrap();
        let (reopened, reopened_stream, next) = second.reserve_invalidation_boot_issuer().unwrap();
        assert_eq!(reopened, authorization);
        assert_eq!(reopened_stream, stream);
        assert_eq!(next, 2);
    }

    #[test]
    fn retry_attempt_and_deadline_survive_restart_and_counter_repair() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut first = LocalDatabase::open(&path).unwrap();
        first
            .with_invalidation_retry_episode(&key(), |registry| {
                assert!(matches!(
                    registry.reserve(key(), witness(0), 1_000, RetryReservationKind::Initial)?,
                    RetryReservation::Reserved(_)
                ));
                registry.record_failure(&key(), 1_100).map_err(Into::into)
            })
            .unwrap();
        drop(first);

        let mut second = LocalDatabase::open(&path).unwrap();
        second
            .conn
            .execute("DELETE FROM _snapback_auth_retry_counters", [])
            .unwrap();
        second
            .conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![RETRY_GLOBAL_COUNT_META_KEY],
            )
            .unwrap();
        second
            .with_invalidation_retry_episode(&key(), |registry| {
                let episode = registry.episodes().get(&key()).unwrap();
                assert_eq!(episode.attempts_reserved, 1);
                assert_eq!(episode.deadline_ms, Some(16_100));
                assert!(matches!(
                    registry.reserve(key(), witness(0), 1_200, RetryReservationKind::Initial)?,
                    RetryReservation::Attached(_)
                ));
                Ok(())
            })
            .unwrap();
        assert_eq!(second.invalidation_retry_episode_count().unwrap(), 1);
        let counter: i64 = second
            .conn
            .query_row(
                "SELECT records FROM _snapback_auth_retry_counters
                 WHERE authority_subject = 'user-A' AND client_store_id = 'store-A'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(counter, 1);
    }

    #[test]
    fn future_retry_witnesses_fail_closed_on_write_and_load() {
        let mut db = LocalDatabase::memory().unwrap();
        let error = db
            .with_invalidation_retry_episode(&key(), |registry| {
                registry
                    .reserve(key(), witness(1), 1_000, RetryReservationKind::Initial)
                    .map_err(Into::into)
            })
            .expect_err("future witness cannot be persisted at head zero");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert_eq!(db.invalidation_retry_episode_count().unwrap(), 0);

        let episode = RetryEpisode {
            episode_id: "future-episode".to_owned(),
            key: key(),
            witness_floor: witness(1),
            first_attempt_reserved_at_ms: 1_000,
            first_failure_at_ms: None,
            attempts_reserved: 1,
            deadline_ms: None,
            manual_retry_id: None,
            last_reservation_at_ms: 1_000,
        };
        db.seed_invalidation_retry_episodes_for_test(&BTreeMap::from([(key(), episode)]), 1_000)
            .unwrap();

        let key_error = db
            .with_invalidation_retry_episode(&key(), |_| Ok(()))
            .expect_err("key-local load must reject future witness");
        assert_eq!(
            key_error.diagnostic.code,
            "SNAPBACK_STORAGE_VERSION_CORRUPT"
        );
        let bulk_error = db
            .read_invalidation_retry_registry(|_| Ok(()))
            .expect_err("bulk load must reject future witness");
        assert_eq!(
            bulk_error.diagnostic.code,
            "SNAPBACK_STORAGE_VERSION_CORRUPT"
        );
        assert_eq!(
            db.invalidation_retry_episode_count().unwrap(),
            1,
            "failed reads must not rewrite durable retry state"
        );
    }

    fn exhausted_episode(key: &RetryEpisodeKey, label: String) -> RetryEpisode {
        RetryEpisode {
            episode_id: label,
            key: key.clone(),
            witness_floor: witness(0),
            first_attempt_reserved_at_ms: 1_000,
            first_failure_at_ms: Some(1_000),
            attempts_reserved: AUTH_ERROR_ATTEMPTS_TOTAL,
            deadline_ms: Some(16_000),
            manual_retry_id: None,
            last_reservation_at_ms: 1_000,
        }
    }

    /// The ticket-24990 adversarial layout: the 10,000-episode global cap
    /// filled across ten client stores, each below the 1,024 per-store cap.
    fn ten_thousand_exhausted_episodes() -> BTreeMap<RetryEpisodeKey, RetryEpisode> {
        let mut episodes = BTreeMap::new();
        for store in 0..10_u32 {
            for query in 0..1_000_u32 {
                let key = RetryEpisodeKey {
                    authority_subject: format!("user-{store}"),
                    client_store_id: format!("store-{store}"),
                    query_key: format!("todos-{query}:{{}}"),
                };
                let episode = exhausted_episode(&key, format!("retry-{store}-{query}"));
                episodes.insert(key, episode);
            }
        }
        episodes
    }

    fn store_counter(db: &LocalDatabase, key: &RetryEpisodeKey) -> Option<i64> {
        db.conn
            .query_row(
                "SELECT records FROM _snapback_auth_retry_counters
                 WHERE authority_subject = ?1 AND client_store_id = ?2",
                params![key.authority_subject, key.client_store_id],
                |row| row.get(0),
            )
            .optional()
            .unwrap()
    }

    /// ENG-24990: refiring one exhausted key must touch only that episode and
    /// its affected counter rows — never rewrite the other 9,999 episodes —
    /// and must stay fast regardless of unrelated episode count. The pre-fix
    /// persistence rewrote the full table (>20,000 row writes and two full
    /// JSON round-trips per refire).
    #[test]
    fn exhausted_refire_at_the_global_cap_performs_bounded_key_local_writes() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut db = LocalDatabase::open(&path).unwrap();
        let episodes = ten_thousand_exhausted_episodes();
        let target = episodes.keys().nth(4_321).cloned().unwrap();
        db.seed_invalidation_retry_episodes_for_test(&episodes, 1_000_000)
            .unwrap();
        assert_eq!(db.invalidation_retry_episode_count().unwrap(), 10_000);

        // One production refire is the initial reservation reattaching and
        // the automatic reservation reporting exhaustion, exactly as
        // `invoke_authorization_resolution` performs them.
        let mut now = 1_000_000_u64;
        let mut max_row_writes = 0_i64;
        let mut best = std::time::Duration::MAX;
        for _ in 0..25 {
            let changes_before = db.total_row_changes_for_test().unwrap();
            let started = std::time::Instant::now();
            now += 1;
            let initial = db
                .with_invalidation_retry_episode(&target, |registry| {
                    registry
                        .reserve(
                            target.clone(),
                            witness(0),
                            now,
                            RetryReservationKind::Initial,
                        )
                        .map_err(Into::into)
                })
                .unwrap();
            assert!(matches!(initial, RetryReservation::Attached(_)));
            now += 1;
            let automatic = db
                .with_invalidation_retry_episode(&target, |registry| {
                    registry
                        .reserve(
                            target.clone(),
                            witness(0),
                            now,
                            RetryReservationKind::Automatic,
                        )
                        .map_err(Into::into)
                })
                .unwrap();
            assert!(matches!(automatic, RetryReservation::Exhausted(_)));
            best = best.min(started.elapsed());
            max_row_writes =
                max_row_writes.max(db.total_row_changes_for_test().unwrap() - changes_before);
        }

        assert!(
            max_row_writes <= 6,
            "an exhausted refire wrote {max_row_writes} rows; key-local persistence \
             touches only the episode, its counter row, and the clock high-water",
        );
        assert!(
            best < std::time::Duration::from_millis(50),
            "best exhausted refire took {best:?} against 9,999 unrelated episodes",
        );
        // No safety eviction and no counter drift under refire churn.
        assert_eq!(db.invalidation_retry_episode_count().unwrap(), 10_000);
        assert_eq!(store_counter(&db, &target), Some(1_000));
    }

    /// ENG-24990: the fail-closed hard caps still refuse creation from the
    /// authoritative table, and resolution deletes exactly one episode,
    /// freeing exactly one slot.
    #[test]
    fn hard_cap_refusal_and_resolution_stay_exact_and_key_local_at_capacity() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut db = LocalDatabase::open(&path).unwrap();
        let episodes = ten_thousand_exhausted_episodes();
        let target = episodes.keys().next().cloned().unwrap();
        db.seed_invalidation_retry_episodes_for_test(&episodes, 1_000_000)
            .unwrap();

        let fresh = RetryEpisodeKey {
            authority_subject: "user-fresh".to_owned(),
            client_store_id: "store-fresh".to_owned(),
            query_key: "todos:{}".to_owned(),
        };
        let error = db
            .with_invalidation_retry_episode(&fresh, |registry| {
                registry
                    .reserve(
                        fresh.clone(),
                        witness(0),
                        1_000_001,
                        RetryReservationKind::Initial,
                    )
                    .map_err(Into::into)
            })
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY"
        );
        assert_eq!(db.invalidation_retry_episode_count().unwrap(), 10_000);

        // A satisfying proof removes exactly the resolved episode and its
        // counter share in one bounded transaction.
        let changes_before = db.total_row_changes_for_test().unwrap();
        db.with_invalidation_retry_episode(&target, |registry| {
            assert!(registry.resolve(&target, &witness(0)));
            Ok(())
        })
        .unwrap();
        let writes = db.total_row_changes_for_test().unwrap() - changes_before;
        assert!(writes <= 4, "resolution wrote {writes} rows");
        assert_eq!(db.invalidation_retry_episode_count().unwrap(), 9_999);
        assert_eq!(store_counter(&db, &target), Some(999));

        // The freed slot admits exactly one new key.
        let reserved = db
            .with_invalidation_retry_episode(&fresh, |registry| {
                registry
                    .reserve(
                        fresh.clone(),
                        witness(0),
                        1_000_002,
                        RetryReservationKind::Initial,
                    )
                    .map_err(Into::into)
            })
            .unwrap();
        assert!(matches!(reserved, RetryReservation::Reserved(_)));
        assert_eq!(db.invalidation_retry_episode_count().unwrap(), 10_000);
        assert_eq!(store_counter(&db, &fresh), Some(1));
    }

    /// ENG-24990: the per-store cap binds against the durable table for the
    /// exact `(authority_subject, client_store_id)` under admission, while
    /// other stores keep admitting.
    #[test]
    fn per_store_cap_binds_against_the_durable_table() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut db = LocalDatabase::open(&path).unwrap();
        let mut episodes = BTreeMap::new();
        for query in 0..1_024_u32 {
            let key = RetryEpisodeKey {
                authority_subject: "user-A".to_owned(),
                client_store_id: "store-A".to_owned(),
                query_key: format!("todos-{query}:{{}}"),
            };
            let episode = exhausted_episode(&key, format!("retry-a-{query}"));
            episodes.insert(key, episode);
        }
        db.seed_invalidation_retry_episodes_for_test(&episodes, 1_000_000)
            .unwrap();

        let full_store = RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-A".to_owned(),
            query_key: "one-more:{}".to_owned(),
        };
        let error = db
            .with_invalidation_retry_episode(&full_store, |registry| {
                registry
                    .reserve(
                        full_store.clone(),
                        witness(0),
                        1_000_001,
                        RetryReservationKind::Initial,
                    )
                    .map_err(Into::into)
            })
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY"
        );

        let other_store = RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-B".to_owned(),
            query_key: "todos:{}".to_owned(),
        };
        let reserved = db
            .with_invalidation_retry_episode(&other_store, |registry| {
                registry
                    .reserve(
                        other_store.clone(),
                        witness(0),
                        1_000_002,
                        RetryReservationKind::Initial,
                    )
                    .map_err(Into::into)
            })
            .unwrap();
        assert!(matches!(reserved, RetryReservation::Reserved(_)));
    }

    /// ENG-24990: per-row corruption checks are preserved for the touched
    /// key and fail closed without blocking operations on other keys.
    #[test]
    fn corrupt_target_episode_fails_closed_without_blocking_other_keys() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut db = LocalDatabase::open(&path).unwrap();
        let key_a = RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-A".to_owned(),
            query_key: "todos:{}".to_owned(),
        };
        let key_b = RetryEpisodeKey {
            authority_subject: "user-B".to_owned(),
            client_store_id: "store-B".to_owned(),
            query_key: "todos:{}".to_owned(),
        };
        let mut episodes = BTreeMap::new();
        episodes.insert(
            key_a.clone(),
            exhausted_episode(&key_a, "retry-a".to_owned()),
        );
        episodes.insert(
            key_b.clone(),
            exhausted_episode(&key_b, "retry-b".to_owned()),
        );
        db.seed_invalidation_retry_episodes_for_test(&episodes, 1_000_000)
            .unwrap();
        db.conn
            .execute(
                "UPDATE _snapback_auth_retry_episodes SET episode_json = episode_json || ' '
                 WHERE authority_subject = ?1",
                params![key_a.authority_subject],
            )
            .unwrap();

        let error = db
            .with_invalidation_retry_episode(&key_a, |registry| {
                registry
                    .reserve(
                        key_a.clone(),
                        witness(0),
                        1_000_001,
                        RetryReservationKind::Initial,
                    )
                    .map_err(Into::into)
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_INVALIDATION_CORRUPT");

        let attached = db
            .with_invalidation_retry_episode(&key_b, |registry| {
                registry
                    .reserve(
                        key_b.clone(),
                        witness(0),
                        1_000_002,
                        RetryReservationKind::Initial,
                    )
                    .map_err(Into::into)
            })
            .unwrap();
        assert!(matches!(attached, RetryReservation::Attached(_)));
    }
}
