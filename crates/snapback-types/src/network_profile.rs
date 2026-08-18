//! Process-local network-condition profiles and egress deadline preparation.
//!
//! @ref LLP 0167#authority-one-activation-chokepoint — every selector uses
//!   one fail-closed activation gate and runtime selections are process-local.

use crate::auth::deployment::AuthDeploymentTarget;
use crate::contract_types::ServerProfile;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const NETWORK_PROFILE_HEADER: &str = "snapback-network-profile";
pub const NETWORK_PROFILE_SOURCE_HEADER: &str = "x-snapback-network-profile-source";
pub const NETWORK_PROFILE_DELAY_CEILING_MS: u64 = 30_000;
pub const NETWORK_PROFILE_DELAY_CEILING_CODE: &str = "SNAPBACK_NETWORK_PROFILE_DELAY_CEILING";
pub const NETWORK_PROFILE_FORBIDDEN_CODE: &str = "SNAPBACK_NETWORK_PROFILE_FORBIDDEN";
pub const NETWORK_PROFILE_INVALID_CODE: &str = "SNAPBACK_NETWORK_PROFILE_INVALID";

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkConditionProfile {
    pub name: String,
    pub mutation_ack_delay_ms: u64,
    pub live_delta_delay_ms: u64,
    pub query_response_delay_ms: u64,
    #[serde(default)]
    pub jitter_ms: u64,
}

impl NetworkConditionProfile {
    pub fn normal() -> Self {
        Self {
            name: "normal".to_owned(),
            mutation_ack_delay_ms: 0,
            live_delta_delay_ms: 0,
            query_response_delay_ms: 0,
            jitter_ms: 0,
        }
    }

    pub fn optimistic() -> Self {
        Self {
            name: "optimistic".to_owned(),
            mutation_ack_delay_ms: 1_000,
            live_delta_delay_ms: 1_000,
            query_response_delay_ms: 0,
            jitter_ms: 0,
        }
    }

    pub fn demo_slow() -> Self {
        Self {
            name: "demo-slow".to_owned(),
            mutation_ack_delay_ms: 2_000,
            live_delta_delay_ms: 2_000,
            query_response_delay_ms: 2_000,
            jitter_ms: 250,
        }
    }

    /// The executable built-in authority. Name parsing and the MCP schema
    /// projection test both enumerate this collection, so the advertised
    /// vocabulary cannot drift from the profiles Rust will actually accept.
    ///
    /// @ref LLP 0167#profile-model — built-in names and values are one finite
    ///   Rust-owned vocabulary projected to operating surfaces.
    pub fn builtins() -> [Self; 3] {
        [Self::normal(), Self::optimistic(), Self::demo_slow()]
    }

    pub fn named(name: &str) -> SnapbackResult<Self> {
        Self::builtins()
            .into_iter()
            .find(|profile| profile.name == name)
            .ok_or_else(|| {
                invalid_profile_error("unknown network condition profile name")
                    .with_details(json!({ "name": name }))
            })
    }

    pub fn is_normal(&self) -> bool {
        self == &Self::normal()
    }

    pub fn validate(self) -> SnapbackResult<Self> {
        if self.name.trim().is_empty() {
            return Err(invalid_profile_error(
                "network profile name must not be empty",
            ));
        }
        if !self
            .name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err(invalid_profile_error(
                "network profile name must contain only ASCII letters, digits, '.', '_' or '-'",
            ));
        }
        for (field, value) in [
            ("mutationAckDelayMs", self.mutation_ack_delay_ms),
            ("liveDeltaDelayMs", self.live_delta_delay_ms),
            ("queryResponseDelayMs", self.query_response_delay_ms),
            ("jitterMs", self.jitter_ms),
        ] {
            if value > NETWORK_PROFILE_DELAY_CEILING_MS {
                return Err(SnapbackError::error(
                    NETWORK_PROFILE_DELAY_CEILING_CODE,
                    "network-profile",
                    format!(
                        "network profile field {field} exceeds the {} ms ceiling",
                        NETWORK_PROFILE_DELAY_CEILING_MS
                    ),
                )
                .with_details(json!({
                    "field": field,
                    "valueMs": value,
                    "ceilingMs": NETWORK_PROFILE_DELAY_CEILING_MS,
                })));
            }
        }
        // The RFC ceiling is per response, and the effective per-response
        // delay is lane + jitter; per-field checks alone would admit a 60 s
        // combination. Refuse, never clamp.
        let max_lane_delay_ms = self
            .mutation_ack_delay_ms
            .max(self.live_delta_delay_ms)
            .max(self.query_response_delay_ms);
        if max_lane_delay_ms.saturating_add(self.jitter_ms) > NETWORK_PROFILE_DELAY_CEILING_MS {
            return Err(SnapbackError::error(
                NETWORK_PROFILE_DELAY_CEILING_CODE,
                "network-profile",
                format!(
                    "network profile lane delay plus jitter exceeds the {} ms per-response ceiling",
                    NETWORK_PROFILE_DELAY_CEILING_MS
                ),
            )
            .with_details(json!({
                "maxLaneDelayMs": max_lane_delay_ms,
                "jitterMs": self.jitter_ms,
                "ceilingMs": NETWORK_PROFILE_DELAY_CEILING_MS,
            })));
        }
        // A built-in name is a contract: an inline profile may reuse it only
        // when field-identical, so a marker naming "normal"/"optimistic"
        // cannot lie about the delays actually applied.
        if let Ok(reserved) = Self::named(&self.name)
            && reserved != self
        {
            return Err(invalid_profile_error(
                "inline network profile reuses a built-in name with different fields",
            )
            .with_details(json!({ "name": self.name })));
        }
        Ok(self)
    }

    pub fn parse_value(value: Value) -> SnapbackResult<Self> {
        match value {
            Value::String(name) => Self::named(&name),
            Value::Object(_) => serde_json::from_value::<Self>(value)
                .map_err(|error| {
                    invalid_profile_error("invalid inline network condition profile")
                        .with_details(json!({ "cause": error.to_string() }))
                })?
                .validate(),
            _ => Err(invalid_profile_error(
                "network profile must be a built-in name or inline object",
            )),
        }
    }

    pub fn parse_env(raw: &str) -> SnapbackResult<Self> {
        let trimmed = raw.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('"') {
            let value = serde_json::from_str(trimmed).map_err(|error| {
                invalid_profile_error("invalid SNAPBACK_NETWORK_PROFILE JSON")
                    .with_details(json!({ "cause": error.to_string() }))
            })?;
            Self::parse_value(value)
        } else {
            Self::named(trimmed)
        }
    }

    fn delay_ms(&self, lane: NetworkEgressLane) -> u64 {
        match lane {
            NetworkEgressLane::MutationAck => self.mutation_ack_delay_ms,
            NetworkEgressLane::LiveDelta => self.live_delta_delay_ms,
            NetworkEgressLane::QueryResponse => self.query_response_delay_ms,
        }
    }
}

fn invalid_profile_error(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(NETWORK_PROFILE_INVALID_CODE, "network-profile", message)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkProfileSource {
    Env,
    Api,
    Console,
    #[serde(rename = "host-ops")]
    HostOps,
    Mcp,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileProvenance {
    pub source: NetworkProfileSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal: Option<String>,
    pub activated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveNetworkProfile {
    pub profile: NetworkConditionProfile,
    pub provenance: NetworkProfileProvenance,
}

impl ActiveNetworkProfile {
    fn new(
        profile: NetworkConditionProfile,
        source: NetworkProfileSource,
        principal: Option<String>,
        activated_at_ms: u64,
    ) -> Self {
        Self {
            profile,
            provenance: NetworkProfileProvenance {
                source,
                principal,
                activated_at_ms,
            },
        }
    }
}

/// Closed activation facts. `None` is deliberately representable so the gate
/// can refuse incomplete classification rather than letting callers default it
/// open.
#[derive(Clone, Copy, Debug)]
pub struct NetworkProfileAuthority {
    pub server_profile: Option<ServerProfile>,
    pub deployment: Option<AuthDeploymentTarget>,
    pub hosted_serving_present: Option<bool>,
    pub derived_instance_present: Option<bool>,
}

impl NetworkProfileAuthority {
    pub fn classified(
        server_profile: ServerProfile,
        deployment: AuthDeploymentTarget,
        hosted_serving_present: bool,
        derived_instance_present: bool,
    ) -> Self {
        Self {
            server_profile: Some(server_profile),
            deployment: Some(deployment),
            hosted_serving_present: Some(hosted_serving_present),
            derived_instance_present: Some(derived_instance_present),
        }
    }

    fn permits(&self, profile: &NetworkConditionProfile) -> SnapbackResult<()> {
        if profile.is_normal() {
            return Ok(());
        }
        let non_production = matches!(
            self.server_profile,
            Some(ServerProfile::Dev | ServerProfile::Demo | ServerProfile::Test)
        );
        let deployment_allowed = matches!(
            (
                self.deployment,
                self.hosted_serving_present,
                self.derived_instance_present,
            ),
            // Primary and derived local instances retain the existing local
            // allowance. The derived fact must still be classified explicitly.
            (Some(AuthDeploymentTarget::Local), Some(false), Some(_))
                // OQ3's sole hosted exception: the otherwise-identical primary
                // tuple stays refused unless boot-validated derived identity is
                // present.
                | (Some(AuthDeploymentTarget::Hosted), Some(true), Some(true))
        );
        let allowed = non_production && deployment_allowed;
        if allowed {
            return Ok(());
        }
        Err(SnapbackError::error(
            NETWORK_PROFILE_FORBIDDEN_CODE,
            "network-profile",
            "non-normal network profiles require a classified non-production local server or an explicitly derived hosted instance",
        )
        .with_details(json!({
            "serverProfile": self.server_profile.map(ServerProfile::as_str),
            "deployment": self.deployment.map(|deployment| match deployment {
                AuthDeploymentTarget::Local => "local",
                AuthDeploymentTarget::Hosted => "hosted",
            }),
            "hostedServingPresent": self.hosted_serving_present,
            "derivedInstancePresent": self.derived_instance_present,
        })))
    }
}

#[derive(Clone)]
pub struct NetworkProfileState {
    inner: Arc<NetworkProfileStateInner>,
}

struct NetworkProfileStateInner {
    non_normal: AtomicBool,
    active: RwLock<Arc<ActiveNetworkProfile>>,
}

impl Default for NetworkProfileState {
    fn default() -> Self {
        Self::new()
    }
}

impl NetworkProfileState {
    pub fn new() -> Self {
        let active = ActiveNetworkProfile::new(
            NetworkConditionProfile::normal(),
            NetworkProfileSource::Env,
            None,
            now_ms(),
        );
        Self {
            inner: Arc::new(NetworkProfileStateInner {
                non_normal: AtomicBool::new(false),
                active: RwLock::new(Arc::new(active)),
            }),
        }
    }

    pub fn active(&self) -> Arc<ActiveNetworkProfile> {
        self.inner
            .active
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Fast identity check for response wrappers that should disappear
    /// entirely while `normal` is active.
    pub fn is_normal(&self) -> bool {
        !self.inner.non_normal.load(Ordering::Acquire)
    }

    /// The sole state-changing activation gate for env and runtime surfaces.
    ///
    /// @ref LLP 0167#authority-one-activation-chokepoint — classification is
    ///   fail-closed and provenance is captured atomically with activation.
    pub fn activate(
        &self,
        profile: NetworkConditionProfile,
        authority: NetworkProfileAuthority,
        source: NetworkProfileSource,
        principal: Option<String>,
    ) -> SnapbackResult<Arc<ActiveNetworkProfile>> {
        let profile = profile.validate()?;
        authority.permits(&profile)?;
        let is_non_normal = !profile.is_normal();
        let active = Arc::new(ActiveNetworkProfile::new(
            profile,
            source,
            principal,
            now_ms(),
        ));
        {
            // The fast-path flag must be published while the snapshot write
            // guard is still held: storing it after the guard drops lets a
            // concurrent normal/non-normal pair interleave into a snapshot
            // that reports perturbation while the flag disables it.
            let mut guard = self
                .inner
                .active
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *guard = active.clone();
            self.inner
                .non_normal
                .store(is_non_normal, Ordering::Release);
        }
        Ok(active)
    }

    /// One cheap check keeps `normal` allocation- and timer-free.
    ///
    /// @ref LLP 0167#observation-semantics--what-a-delay-means — one immutable
    ///   snapshot and one jitter sample prepare a result-readiness deadline.
    pub fn admit_result(
        &self,
        lane: NetworkEgressLane,
        ready_at: Instant,
    ) -> Option<PreparedNetworkEgress> {
        if !self.inner.non_normal.load(Ordering::Acquire) {
            return None;
        }
        let snapshot = self.active();
        if snapshot.profile.is_normal() {
            return None;
        }
        Some(PreparedNetworkEgress::new(
            snapshot.clone(),
            ready_at,
            lane,
            sample_jitter_ms(snapshot.profile.jitter_ms),
        ))
    }

    pub fn admit_commit(&self, committed_at: Instant) -> Option<PreparedCommitEgress> {
        if !self.inner.non_normal.load(Ordering::Acquire) {
            return None;
        }
        let snapshot = self.active();
        if snapshot.profile.is_normal() {
            return None;
        }
        let jitter_ms = sample_jitter_ms(snapshot.profile.jitter_ms);
        Some(PreparedCommitEgress {
            snapshot,
            committed_at,
            jitter_ms,
        })
    }

    #[cfg(test)]
    fn activate_at(
        &self,
        profile: NetworkConditionProfile,
        authority: NetworkProfileAuthority,
        source: NetworkProfileSource,
        principal: Option<String>,
        activated_at_ms: u64,
    ) -> SnapbackResult<Arc<ActiveNetworkProfile>> {
        let profile = profile.validate()?;
        authority.permits(&profile)?;
        let is_non_normal = !profile.is_normal();
        let active = Arc::new(ActiveNetworkProfile::new(
            profile,
            source,
            principal,
            activated_at_ms,
        ));
        {
            let mut guard = self
                .inner
                .active
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *guard = active.clone();
            self.inner
                .non_normal
                .store(is_non_normal, Ordering::Release);
        }
        Ok(active)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkEgressLane {
    MutationAck,
    LiveDelta,
    QueryResponse,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedNetworkEgress {
    snapshot: Arc<ActiveNetworkProfile>,
    release_at: Instant,
}

impl PreparedNetworkEgress {
    fn new(
        snapshot: Arc<ActiveNetworkProfile>,
        basis: Instant,
        lane: NetworkEgressLane,
        jitter_ms: u64,
    ) -> Self {
        let delay_ms = snapshot.profile.delay_ms(lane).saturating_add(jitter_ms);
        Self {
            snapshot,
            release_at: basis + Duration::from_millis(delay_ms),
        }
    }

    pub fn snapshot(&self) -> &Arc<ActiveNetworkProfile> {
        &self.snapshot
    }

    pub fn profile_name(&self) -> &str {
        &self.snapshot.profile.name
    }

    pub fn release_at(&self) -> Instant {
        self.release_at
    }

    pub fn clamp_release_at(&mut self, predecessor: Option<Instant>) {
        if let Some(predecessor) = predecessor {
            self.release_at = self.release_at.max(predecessor);
        }
    }
}

/// One commit snapshot and jitter sample shared by its ack and every live
/// delta. Lane conversion is allocation-free beyond cloning the shared Arc.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedCommitEgress {
    snapshot: Arc<ActiveNetworkProfile>,
    committed_at: Instant,
    jitter_ms: u64,
}

impl PreparedCommitEgress {
    pub fn for_lane(&self, lane: NetworkEgressLane) -> PreparedNetworkEgress {
        PreparedNetworkEgress::new(
            self.snapshot.clone(),
            self.committed_at,
            lane,
            self.jitter_ms,
        )
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub enum MutationEgressBasis {
    /// A no-commit mutation response stamps from result readiness.
    #[default]
    ResultReady,
    /// A real commit happened while the identity profile was active.
    NormalCommit,
    /// A real commit captured this immutable non-normal egress group.
    ProfiledCommit(PreparedCommitEgress),
}

fn sample_jitter_ms(maximum_ms: u64) -> u64 {
    if maximum_ms == 0 {
        return 0;
    }
    let mut bytes = [0_u8; 8];
    getrandom::fill(&mut bytes).expect("system entropy is required for network profile jitter");
    u64::from_le_bytes(bytes) % maximum_ms.saturating_add(1)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_authority(profile: ServerProfile) -> NetworkProfileAuthority {
        NetworkProfileAuthority::classified(profile, AuthDeploymentTarget::Local, false, false)
    }

    #[test]
    fn parses_builtins_inline_profiles_and_refuses_invalid_shapes() {
        assert_eq!(
            NetworkConditionProfile::parse_env("optimistic").unwrap(),
            NetworkConditionProfile::optimistic()
        );
        assert_eq!(
            NetworkConditionProfile::parse_env(
                r#"{"name":"tiny","mutationAckDelayMs":12,"liveDeltaDelayMs":8,"queryResponseDelayMs":4}"#,
            )
            .unwrap(),
            NetworkConditionProfile {
                name: "tiny".to_owned(),
                mutation_ack_delay_ms: 12,
                live_delta_delay_ms: 8,
                query_response_delay_ms: 4,
                jitter_ms: 0,
            }
        );
        let invalid = NetworkConditionProfile::parse_value(json!(17)).unwrap_err();
        assert_eq!(invalid.diagnostic.code, NETWORK_PROFILE_INVALID_CODE);
    }

    #[test]
    fn ceiling_refuses_each_field_without_clamping() {
        for field in [
            "mutationAckDelayMs",
            "liveDeltaDelayMs",
            "queryResponseDelayMs",
            "jitterMs",
        ] {
            let mut value = json!({
                "name": "too-slow",
                "mutationAckDelayMs": 0,
                "liveDeltaDelayMs": 0,
                "queryResponseDelayMs": 0,
                "jitterMs": 0,
            });
            value[field] = json!(NETWORK_PROFILE_DELAY_CEILING_MS + 1);
            let error = NetworkConditionProfile::parse_value(value).unwrap_err();
            assert_eq!(error.diagnostic.code, NETWORK_PROFILE_DELAY_CEILING_CODE);
            assert_eq!(error.diagnostic.details["field"], field);
        }
    }

    #[test]
    fn ceiling_bounds_the_combined_lane_plus_jitter_deadline() {
        // Each field is individually at/under the ceiling, but the effective
        // per-response delay (lane + jitter) exceeds it: refuse, never clamp.
        let error = NetworkConditionProfile::parse_value(json!({
            "name": "combined-too-slow",
            "mutationAckDelayMs": NETWORK_PROFILE_DELAY_CEILING_MS,
            "liveDeltaDelayMs": 0,
            "queryResponseDelayMs": 0,
            "jitterMs": 1,
        }))
        .unwrap_err();
        assert_eq!(error.diagnostic.code, NETWORK_PROFILE_DELAY_CEILING_CODE);
        assert_eq!(
            error.diagnostic.details["maxLaneDelayMs"],
            NETWORK_PROFILE_DELAY_CEILING_MS
        );
        // The pinned built-ins stay comfortably valid under the combined rule.
        NetworkConditionProfile::demo_slow().validate().unwrap();
    }

    #[test]
    fn inline_profiles_cannot_spoof_built_in_names() {
        let spoof = NetworkConditionProfile {
            name: "normal".to_owned(),
            mutation_ack_delay_ms: 5_000,
            live_delta_delay_ms: 0,
            query_response_delay_ms: 0,
            jitter_ms: 0,
        };
        let error = spoof.validate().unwrap_err();
        assert_eq!(error.diagnostic.code, NETWORK_PROFILE_INVALID_CODE);
        // Field-identical restatements of a built-in remain valid.
        NetworkConditionProfile::optimistic().validate().unwrap();
    }

    #[test]
    fn normal_remains_available_for_fail_closed_recovery() {
        NetworkProfileState::new()
            .activate(
                NetworkConditionProfile::normal(),
                NetworkProfileAuthority {
                    server_profile: None,
                    deployment: None,
                    hosted_serving_present: None,
                    derived_instance_present: None,
                },
                NetworkProfileSource::Api,
                None,
            )
            .unwrap();
    }

    #[test]
    fn runtime_selection_does_not_survive_reconstruction() {
        let authority = local_authority(ServerProfile::Dev);
        let env_profile = NetworkConditionProfile::optimistic();
        let first = NetworkProfileState::new();
        first
            .activate_at(
                env_profile.clone(),
                authority,
                NetworkProfileSource::Env,
                None,
                10,
            )
            .unwrap();
        first
            .activate_at(
                NetworkConditionProfile::demo_slow(),
                authority,
                NetworkProfileSource::Api,
                Some("operator".to_owned()),
                20,
            )
            .unwrap();

        let restarted = NetworkProfileState::new();
        restarted
            .activate_at(
                env_profile.clone(),
                authority,
                NetworkProfileSource::Env,
                None,
                30,
            )
            .unwrap();
        assert_eq!(restarted.active().profile, env_profile);
        assert_eq!(
            restarted.active().provenance.source,
            NetworkProfileSource::Env
        );
    }

    #[test]
    fn commit_group_shares_basis_and_jitter_across_equal_lanes() {
        let state = NetworkProfileState::new();
        state
            .activate_at(
                NetworkConditionProfile {
                    name: "shared".to_owned(),
                    mutation_ack_delay_ms: 80,
                    live_delta_delay_ms: 80,
                    query_response_delay_ms: 0,
                    jitter_ms: 20,
                },
                local_authority(ServerProfile::Test),
                NetworkProfileSource::Api,
                None,
                1,
            )
            .unwrap();
        let group = state.admit_commit(Instant::now()).unwrap();
        let ack = group.for_lane(NetworkEgressLane::MutationAck);
        let delta = group.for_lane(NetworkEgressLane::LiveDelta);
        assert_eq!(ack.release_at(), delta.release_at());
        assert_eq!(
            ack.release_at(),
            group.committed_at + Duration::from_millis(80 + group.jitter_ms)
        );
    }

    #[test]
    fn result_readiness_and_monotone_pipeline_deadlines_preserve_order() {
        let snapshot = Arc::new(ActiveNetworkProfile::new(
            NetworkConditionProfile {
                name: "deadline-test".to_owned(),
                mutation_ack_delay_ms: 0,
                live_delta_delay_ms: 0,
                query_response_delay_ms: 0,
                jitter_ms: 0,
            },
            NetworkProfileSource::Api,
            None,
            1,
        ));
        let basis = Instant::now();
        let mut first = PreparedNetworkEgress {
            snapshot: snapshot.clone(),
            release_at: basis + Duration::from_millis(100),
        };
        let mut second = PreparedNetworkEgress {
            snapshot: snapshot.clone(),
            release_at: basis + Duration::from_millis(80),
        };
        let mut third = PreparedNetworkEgress {
            snapshot,
            release_at: basis + Duration::from_millis(120),
        };
        first.clamp_release_at(None);
        second.clamp_release_at(Some(first.release_at()));
        third.clamp_release_at(Some(second.release_at()));
        assert_eq!(second.release_at(), first.release_at());
        assert!(third.release_at() >= second.release_at());

        let burst_basis = Instant::now();
        let burst_snapshot = Arc::new(ActiveNetworkProfile::new(
            NetworkConditionProfile {
                name: "burst".to_owned(),
                mutation_ack_delay_ms: 0,
                live_delta_delay_ms: 40,
                query_response_delay_ms: 0,
                jitter_ms: 0,
            },
            NetworkProfileSource::Api,
            None,
            2,
        ));
        let mut predecessor = None;
        for _ in 0..8 {
            let mut item = PreparedNetworkEgress::new(
                burst_snapshot.clone(),
                burst_basis,
                NetworkEgressLane::LiveDelta,
                0,
            );
            item.clamp_release_at(predecessor);
            predecessor = Some(item.release_at());
        }
        assert_eq!(
            predecessor,
            Some(burst_basis + Duration::from_millis(40)),
            "a burst shifts once by the lane delay, never N times"
        );
        assert_eq!(
            MutationEgressBasis::default(),
            MutationEgressBasis::ResultReady
        );
    }

    #[test]
    fn sampled_jitter_is_clamped_monotone_per_connection() {
        let state = NetworkProfileState::new();
        state
            .activate_at(
                NetworkConditionProfile {
                    name: "jitter".to_owned(),
                    mutation_ack_delay_ms: 0,
                    live_delta_delay_ms: 0,
                    query_response_delay_ms: 0,
                    jitter_ms: 20,
                },
                local_authority(ServerProfile::Test),
                NetworkProfileSource::Api,
                None,
                1,
            )
            .unwrap();
        let basis = Instant::now();
        let mut predecessor = None;
        for _ in 0..128 {
            let mut item = state
                .admit_result(NetworkEgressLane::QueryResponse, basis)
                .unwrap();
            item.clamp_release_at(predecessor);
            assert!(predecessor.is_none_or(|prior| item.release_at() >= prior));
            assert!(item.release_at() <= basis + Duration::from_millis(20));
            predecessor = Some(item.release_at());
        }
    }

    #[test]
    fn normal_admission_is_a_true_identity() {
        let state = NetworkProfileState::new();
        assert!(
            state
                .admit_result(NetworkEgressLane::QueryResponse, Instant::now())
                .is_none()
        );
        assert!(state.admit_commit(Instant::now()).is_none());
    }

    #[test]
    fn mcp_authority_projection_matches_rust_builtins_and_ceiling() {
        // @ref LLP 0167#profile-model — the MCP schema derives from this
        // package projection, while this owning Rust test pins that projection
        // to the model and ceiling enforced by the activation authority.
        let projection: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/snapback-cli/network-profile-authority.json"
        ))
        .expect("network-profile MCP authority projection is JSON");
        assert_eq!(
            projection["builtinNames"],
            serde_json::json!(
                NetworkConditionProfile::builtins()
                    .into_iter()
                    .map(|profile| profile.name)
                    .collect::<Vec<_>>()
            )
        );
        assert_eq!(
            projection["delayCeilingMs"],
            NETWORK_PROFILE_DELAY_CEILING_MS
        );
    }
}
