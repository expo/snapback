//! Finite, process-bound auth rehearsal grants.
//!
//! This module owns the closed wire vocabulary, carrier hygiene, immutable
//! grant validation, binding facts, selector matching, and typed refusals.
//! Protected persistence and atomic accounting live in
//! `storage/auth_rehearsal.rs`; the server layer never receives raw SQL.

use crate::auth::crypto::{
    CanonicalAddress, CryptoError, RandomSource, RehearsalBearer, decode_canonical_base64url,
    encode_base64url,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use hmac::{Hmac, Mac as _};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use subtle::ConstantTimeEq as _;
use zeroize::{Zeroize as _, Zeroizing};

pub const AUTH_REHEARSAL_GRANT_KIND: &str = "authRehearsalGrant.v1";
pub const AUTH_REHEARSAL_STATUS_KIND: &str = "authRehearsalStatus.v1";
pub const AUTH_REHEARSAL_PROVENANCE_KIND: &str = "authRehearsalProvenance.v1";
pub const AUTH_REHEARSAL_WINDOW_KIND: &str = "authRehearsalWindow.v1";
pub const AUTH_REHEARSAL_REACHABILITY_KIND: &str = "authRehearsalReachability.v1";
pub const AUTH_REHEARSAL_STORE_MARKERS_KIND: &str = "authRehearsalStoreMarkers.v1";
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub const AUTH_REHEARSAL_EXPORT_ENVELOPE_KIND: &str = "authRehearsalExportEnvelope.v1";
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub const AUTH_REHEARSAL_LOGICAL_EXPORT_KIND: &str = "authRehearsalLogicalExport.v1";
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub const AUTH_REHEARSAL_EXPORT_KEY_CAPSULE_KIND: &str =
    "authRehearsalExportVerificationKeyCapsule.v1";
pub const AUTH_REHEARSAL_CAPABILITY_HEADER: &str = "x-snapback-auth-rehearsal-capability";
pub const MAX_REHEARSAL_CAPABILITY_FILE_BYTES: usize = 128;
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub const MAX_REHEARSAL_EXPORT_KEY_CAPSULE_BYTES: usize = 512;
pub const MAX_REHEARSAL_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
pub const MAX_REHEARSAL_COUNT: u64 = 9_007_199_254_740_991;
pub const REHEARSAL_WINDOW_NAMESPACE_BYTES: usize = 24;
pub const REHEARSAL_WINDOW_NAMESPACE_LABEL_CHARS: usize = 39;
pub const REHEARSAL_WINDOW_NAMESPACE_SUFFIX: &str = ".rehearsal.invalid";

/// Mint one 192-bit, lowercase RFC 4648 base32 selector namespace. The host
/// owns generation; callers can request window behavior but never selector
/// bytes.
///
/// @ref LLP 0213#namespace-spelling-and-entropy — 24 CSPRNG bytes become one
///   39-character lowercase unpadded base32 label under `.rehearsal.invalid`.
pub fn generate_window_namespace(
    random: &dyn RandomSource,
) -> Result<Zeroizing<String>, CryptoError> {
    let mut bytes = [0_u8; REHEARSAL_WINDOW_NAMESPACE_BYTES];
    if let Err(error) = random.fill(&mut bytes) {
        bytes.zeroize();
        return Err(error);
    }
    let mut label = String::with_capacity(REHEARSAL_WINDOW_NAMESPACE_LABEL_CHARS);
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut accumulator = 0_u32;
    let mut bits = 0_u8;
    for byte in bytes {
        accumulator = (accumulator << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            label.push(ALPHABET[((accumulator >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits != 0 {
        label.push(ALPHABET[((accumulator << (5 - bits)) & 0x1f) as usize] as char);
    }
    bytes.zeroize();
    debug_assert_eq!(label.len(), REHEARSAL_WINDOW_NAMESPACE_LABEL_CHARS);
    label.push_str(REHEARSAL_WINDOW_NAMESPACE_SUFFIX);
    Ok(Zeroizing::new(label))
}

pub fn generate_window_namespace_candidates(
    request: &RehearsalMintRequestV1,
    random: &dyn RandomSource,
) -> Result<Vec<[Zeroizing<String>; 3]>, CryptoError> {
    let count = request
        .effect_selectors
        .window_install
        .as_ref()
        .map_or(0, |selector| selector.window_plans.len());
    let mut candidates = Vec::with_capacity(count);
    for _ in 0..count {
        candidates.push([
            generate_window_namespace(random)?,
            generate_window_namespace(random)?,
            generate_window_namespace(random)?,
        ]);
    }
    Ok(candidates)
}

pub fn window_namespace_digest(namespace: &str) -> SnapbackResult<String> {
    if !valid_window_namespace(namespace) {
        return Err(request_invalid());
    }
    Ok(domain_digest_bytes(
        b"snapback.auth-rehearsal.window-namespace.v1\0",
        namespace.as_bytes(),
    ))
}

pub fn valid_window_namespace(namespace: &str) -> bool {
    let Some(label) = namespace.strip_suffix(REHEARSAL_WINDOW_NAMESPACE_SUFFIX) else {
        return false;
    };
    label.len() == REHEARSAL_WINDOW_NAMESPACE_LABEL_CHARS
        && label
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MintedWindowNamespaceV1 {
    pub window_plan_id: String,
    pub namespace: String,
}

impl zeroize::Zeroize for MintedWindowNamespaceV1 {
    fn zeroize(&mut self) {
        self.namespace.zeroize();
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RehearsalReachabilityExposureV1 {
    PublishedPublic,
    NotPublicByDesign,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RehearsalTargetClassV1 {
    Wave1Local,
    PublicByDesign,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReachabilityProducerPolicyV1 {
    Wave1LocalAbsenceException,
    ReachabilityFactProducerRequired,
}

impl RehearsalTargetClassV1 {
    pub fn producer_policy(self) -> ReachabilityProducerPolicyV1 {
        // @ref LLP 0213#producer-parity-gate — every target class has one
        //   closed producer classification; only wave-1 local may omit a fact.
        match self {
            Self::Wave1Local => ReachabilityProducerPolicyV1::Wave1LocalAbsenceException,
            Self::PublicByDesign => ReachabilityProducerPolicyV1::ReachabilityFactProducerRequired,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalReachabilityV1 {
    pub kind: String,
    pub target_class: RehearsalTargetClassV1,
    pub exposure: RehearsalReachabilityExposureV1,
    pub producer_version: u32,
    pub target_build_digest: String,
    pub deployment_config_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RehearsalReachabilityAdmissionV1 {
    pub target_class: RehearsalTargetClassV1,
    pub expected_target_build_digest: String,
    pub fact: Option<AuthRehearsalReachabilityV1>,
}

impl RehearsalReachabilityAdmissionV1 {
    /// Decide install admission without turning topology detection into the
    /// foreign-caller boundary. The named local absence path intentionally
    /// proceeds on selector entropy, including loopback behind a proxy.
    ///
    /// @ref LLP 0213#reachability-fact — published-public refuses, malformed
    ///   or missing-required facts refuse, and wave-1 local absence proceeds.
    pub fn validate_for_install(&self) -> SnapbackResult<()> {
        match (&self.fact, self.target_class.producer_policy()) {
            (None, ReachabilityProducerPolicyV1::Wave1LocalAbsenceException) => Ok(()),
            (None, ReachabilityProducerPolicyV1::ReachabilityFactProducerRequired) => {
                Err(producer_parity())
            }
            (Some(fact), _) => {
                if fact.kind != AUTH_REHEARSAL_REACHABILITY_KIND
                    || fact.target_class != self.target_class
                    || fact.producer_version != 1
                    || !valid_digest(&fact.target_build_digest)
                    || !valid_digest(&fact.deployment_config_digest)
                    || fact.target_build_digest != self.expected_target_build_digest
                {
                    return Err(reachability_invalid());
                }
                if fact.exposure == RehearsalReachabilityExposureV1::PublishedPublic {
                    return Err(reachability_public());
                }
                Ok(())
            }
        }
    }
}

/// Exact authority that governed a rehearsal-derived identity, session, or
/// assurance. A window always retains its parent grant; collapsing it to the
/// parent would incorrectly let the child outlive an independently-ended
/// window.
///
/// @ref LLP 0213#governing-authority — window-mediated derivation records both
///   the window and its parent grant.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RehearsalGoverningAuthorityV1 {
    Grant {
        grant_id: String,
    },
    Window {
        window_id: String,
        parent_grant_id: String,
    },
}

impl RehearsalGoverningAuthorityV1 {
    pub fn authority_ids(&self) -> (&str, Option<&str>) {
        match self {
            Self::Grant { grant_id } => (grant_id, None),
            Self::Window {
                window_id,
                parent_grant_id,
            } => (window_id, Some(parent_grant_id)),
        }
    }
}

/// Sealed server-only lineage attached to prepared invocation authority and
/// protected durable intents. The digests bind the actual effective-authority
/// and assurance decisions; application payloads never construct this value.
///
/// @ref LLP 0213#provenance-shape — canonical, duplicate-free governing
///   authority sets are monotone under composition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalProvenanceV1 {
    pub kind: String,
    pub governing_authorities: Vec<RehearsalGoverningAuthorityV1>,
    pub authority_decision_digest: String,
    pub assurance_decision_digest: String,
}

impl AuthRehearsalProvenanceV1 {
    pub fn from_governing_authority(
        governing_authority: RehearsalGoverningAuthorityV1,
        authority_decision_digest: String,
        assurance_decision_digest: String,
    ) -> SnapbackResult<Self> {
        let value = Self {
            kind: AUTH_REHEARSAL_PROVENANCE_KIND.to_owned(),
            governing_authorities: vec![governing_authority],
            authority_decision_digest,
            assurance_decision_digest,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn for_grant(grant: &AuthRehearsalGrantV1, assurance_used: bool) -> SnapbackResult<Self> {
        let authority_decision_digest = digest_serializable(
            b"snapback.auth-rehearsal.authority-decision.v1\0",
            &(
                grant.grant_id.as_str(),
                grant.instance_id.as_str(),
                grant.expires_at,
            ),
        )?;
        let assurance_decision_digest = digest_serializable(
            b"snapback.auth-rehearsal.assurance-decision.v1\0",
            &(grant.grant_id.as_str(), assurance_used),
        )?;
        Self::from_governing_authority(
            RehearsalGoverningAuthorityV1::Grant {
                grant_id: grant.grant_id.clone(),
            },
            authority_decision_digest,
            assurance_decision_digest,
        )
    }

    pub fn for_window(
        window: &AuthRehearsalWindowV1,
        assurance_used: bool,
    ) -> SnapbackResult<Self> {
        window.validate_record()?;
        let authority_decision_digest = digest_serializable(
            b"snapback.auth-rehearsal.window-authority-decision.v1\0",
            &(
                window.window_id.as_str(),
                window.grant_id.as_str(),
                window.instance_id.as_str(),
                window.expires_at,
            ),
        )?;
        let assurance_decision_digest = digest_serializable(
            b"snapback.auth-rehearsal.window-assurance-decision.v1\0",
            &(window.window_id.as_str(), assurance_used),
        )?;
        Self::from_governing_authority(
            RehearsalGoverningAuthorityV1::Window {
                window_id: window.window_id.clone(),
                parent_grant_id: window.grant_id.clone(),
            },
            authority_decision_digest,
            assurance_decision_digest,
        )
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        if self.kind != AUTH_REHEARSAL_PROVENANCE_KIND
            || self.governing_authorities.is_empty()
            || !self
                .governing_authorities
                .windows(2)
                .all(|pair| pair[0] < pair[1])
            || !valid_digest(&self.authority_decision_digest)
            || !valid_digest(&self.assurance_decision_digest)
        {
            return Err(provenance_invalid());
        }
        let uuid_v7 =
            |value: &str| uuid::Uuid::parse_str(value).is_ok_and(|id| id.get_version_num() == 7);
        for authority in &self.governing_authorities {
            let (authority_id, parent) = authority.authority_ids();
            if !uuid_v7(authority_id) || parent.is_some_and(|value| !uuid_v7(value)) {
                return Err(provenance_invalid());
            }
        }
        Ok(())
    }

    pub fn canonical_union(&self, other: &Self) -> SnapbackResult<Self> {
        self.validate()?;
        other.validate()?;
        let governing_authorities = self
            .governing_authorities
            .iter()
            .chain(other.governing_authorities.iter())
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let authority_decision_digest = digest_serializable(
            b"snapback.auth-rehearsal.authority-union.v1\0",
            &(
                self.authority_decision_digest.as_str(),
                other.authority_decision_digest.as_str(),
                &governing_authorities,
            ),
        )?;
        let assurance_decision_digest = digest_serializable(
            b"snapback.auth-rehearsal.assurance-union.v1\0",
            &(
                self.assurance_decision_digest.as_str(),
                other.assurance_decision_digest.as_str(),
                &governing_authorities,
            ),
        )?;
        Self::from_parts(
            governing_authorities,
            authority_decision_digest,
            assurance_decision_digest,
        )
    }

    fn from_parts(
        governing_authorities: Vec<RehearsalGoverningAuthorityV1>,
        authority_decision_digest: String,
        assurance_decision_digest: String,
    ) -> SnapbackResult<Self> {
        let value = Self {
            kind: AUTH_REHEARSAL_PROVENANCE_KIND.to_owned(),
            governing_authorities,
            authority_decision_digest,
            assurance_decision_digest,
        };
        value.validate()?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RehearsalLiveAuthority {
    pub expires_at_ms: u64,
    pub parent_grant_id: Option<String>,
}

pub type RehearsalLiveAuthorityRegistry = Arc<RwLock<BTreeMap<String, RehearsalLiveAuthority>>>;

/// Process-bound level-triggered authority checker. Restart starts with an
/// empty registry, so durable derived rows from an older boot remain inert.
#[derive(Clone, Debug)]
pub struct RehearsalAuthorityFence {
    provenance: AuthRehearsalProvenanceV1,
    live: RehearsalLiveAuthorityRegistry,
}

impl RehearsalAuthorityFence {
    pub fn new(
        provenance: AuthRehearsalProvenanceV1,
        live: RehearsalLiveAuthorityRegistry,
    ) -> SnapbackResult<Self> {
        provenance.validate()?;
        Ok(Self { provenance, live })
    }

    pub fn validate_at(&self, now_ms: u64) -> SnapbackResult<()> {
        let live = self
            .live
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for authority in &self.provenance.governing_authorities {
            let (authority_id, expected_parent) = authority.authority_ids();
            let Some(current) = live.get(authority_id) else {
                return Err(authority_ended());
            };
            if now_ms >= current.expires_at_ms
                || current.parent_grant_id.as_deref() != expected_parent
            {
                return Err(authority_ended());
            }
            if let Some(parent_grant_id) = expected_parent {
                let Some(parent) = live.get(parent_grant_id) else {
                    return Err(authority_ended());
                };
                if now_ms >= parent.expires_at_ms || parent.parent_grant_id.is_some() {
                    return Err(authority_ended());
                }
            }
        }
        Ok(())
    }

    pub fn try_publish<T>(
        &self,
        now_ms: u64,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        // Hold the read side across the publication cut. Revocation removes
        // the entry under the write side, making the terminal transition and
        // final publication mutually ordered rather than check-then-act.
        let live = self
            .live
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for authority in &self.provenance.governing_authorities {
            let (authority_id, expected_parent) = authority.authority_ids();
            let Some(current) = live.get(authority_id) else {
                return Err(authority_ended());
            };
            if now_ms >= current.expires_at_ms
                || current.parent_grant_id.as_deref() != expected_parent
            {
                return Err(authority_ended());
            }
            if let Some(parent_grant_id) = expected_parent {
                let Some(parent) = live.get(parent_grant_id) else {
                    return Err(authority_ended());
                };
                if now_ms >= parent.expires_at_ms || parent.parent_grant_id.is_some() {
                    return Err(authority_ended());
                }
            }
        }
        publish()
    }
}

/// Identity-core assurance carrier reserved for LLP 0214 integration. Its
/// use-time validator is complete here even though this lane does not invent
/// or activate new assurance kinds.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)] // LLP 0213 slice B staged surface; consumers land with the following rehearsal-effect slices
pub struct RehearsalAssuranceV1 {
    pub kind: String,
    pub provenance: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub governing_authority: RehearsalGoverningAuthorityV1,
}

#[allow(dead_code)] // LLP 0213 slice B staged surface; consumers land with the following rehearsal-effect slices
impl RehearsalAssuranceV1 {
    pub fn validate_use_at(
        &self,
        now_ms: u64,
        live: RehearsalLiveAuthorityRegistry,
    ) -> SnapbackResult<()> {
        if self.kind.is_empty()
            || self.provenance != "rehearsal"
            || self.issued_at >= self.expires_at
            || now_ms >= self.expires_at
        {
            return Err(authority_ended());
        }
        let provenance = AuthRehearsalProvenanceV1::from_governing_authority(
            self.governing_authority.clone(),
            digest_serializable(
                b"snapback.auth-rehearsal.assurance-authority.v1\0",
                &self.governing_authority,
            )?,
            digest_serializable(
                b"snapback.auth-rehearsal.assurance-use.v1\0",
                &(self.kind.as_str(), self.issued_at, self.expires_at),
            )?,
        )?;
        RehearsalAuthorityFence::new(provenance, live)?.validate_at(now_ms)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // LLP 0213 slice B staged surface; consumers land with the following rehearsal-effect slices
pub enum RegisteredEgressChannel {
    RuntimeFetch,
    PushProvider,
    NotificationProvider,
    Webhook,
    ExternalQueue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // LLP 0213 slice B staged surface; consumers land with the following rehearsal-effect slices
pub enum RegisteredEgressAdapter {
    Real,
    DeclaredSimulator,
    DeclaredTestAdapter,
}

#[derive(Debug)]
pub struct ExternalEgressPermit {
    _private: (),
}

pub struct ExternalEgressGate;

impl ExternalEgressGate {
    /// One registered decision point used before any provider secret or
    /// network construction. Exemption is a closed activation-time adapter
    /// classification, never a request argument, hostname, or environment
    /// assertion.
    ///
    /// @ref LLP 0213#the-single-external-egress-gate — marked work admits only
    ///   declared simulator/test adapters on non-production profiles.
    pub fn prepare(
        provenance: Option<&AuthRehearsalProvenanceV1>,
        profile: crate::contract_types::ServerProfile,
        _channel: RegisteredEgressChannel,
        adapter: RegisteredEgressAdapter,
    ) -> SnapbackResult<ExternalEgressPermit> {
        if let Some(provenance) = provenance {
            provenance.validate()?;
            let declared_test_adapter = matches!(
                adapter,
                RegisteredEgressAdapter::DeclaredSimulator
                    | RegisteredEgressAdapter::DeclaredTestAdapter
            );
            if profile == crate::contract_types::ServerProfile::Prod || !declared_test_adapter {
                return Err(egress_refused());
            }
        }
        Ok(ExternalEgressPermit { _private: () })
    }
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema,
)]
pub enum RehearsalEffect {
    #[serde(rename = "challenge.capture")]
    ChallengeCapture,
    #[serde(rename = "challenge.redeem")]
    ChallengeRedeem,
    #[serde(rename = "fixture.identity.create")]
    FixtureIdentityCreate,
    #[serde(rename = "fixture.session.mint")]
    FixtureSessionMint,
    #[serde(rename = "verification.simulate")]
    VerificationSimulate,
    #[serde(rename = "window.install")]
    WindowInstall,
    #[serde(rename = "budget.rehearsal.allocate")]
    BudgetRehearsalAllocate,
    #[serde(rename = "clock.auth.advance")]
    ClockAuthAdvance,
}

impl RehearsalEffect {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChallengeCapture => "challenge.capture",
            Self::ChallengeRedeem => "challenge.redeem",
            Self::FixtureIdentityCreate => "fixture.identity.create",
            Self::FixtureSessionMint => "fixture.session.mint",
            Self::VerificationSimulate => "verification.simulate",
            Self::WindowInstall => "window.install",
            Self::BudgetRehearsalAllocate => "budget.rehearsal.allocate",
            Self::ClockAuthAdvance => "clock.auth.advance",
        }
    }

    pub fn counter(self) -> RehearsalCounter {
        // @ref LLP 0213#total-effect-to-counter-mapping — the closed effect
        //   enum has a total named-counter mapping; maxUses is charged in
        //   addition for every non-idempotent resolved invocation.
        match self {
            Self::ChallengeCapture | Self::ChallengeRedeem => RehearsalCounter::ChallengeAttempts,
            Self::FixtureIdentityCreate => RehearsalCounter::IdentityCreates,
            Self::FixtureSessionMint => RehearsalCounter::SessionMints,
            Self::VerificationSimulate => RehearsalCounter::VerificationSimulations,
            Self::WindowInstall => RehearsalCounter::WindowInstalls,
            Self::BudgetRehearsalAllocate => RehearsalCounter::AllocationUnits,
            Self::ClockAuthAdvance => RehearsalCounter::ClockAdvances,
        }
    }

    pub fn is_attempt_counter(self) -> bool {
        matches!(self, Self::ChallengeCapture | Self::ChallengeRedeem)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RehearsalCounter {
    ChallengeAttempts,
    IdentityCreates,
    SessionMints,
    VerificationSimulations,
    WindowInstalls,
    ClockAdvances,
    AllocationUnits,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ContactSelectorV1 {
    ExactContact {
        #[serde(rename = "canonicalAddressDigest")]
        canonical_address_digest: String,
    },
    ContactNamespace {
        #[serde(rename = "fixtureNamespace")]
        fixture_namespace: String,
        #[serde(rename = "domainDigest")]
        domain_digest: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixtureSelectorV1 {
    pub fixture_namespace: String,
    pub contact: ContactSelectorV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum IdentitySelectorV1 {
    IdentityId {
        #[serde(rename = "identityId")]
        identity_id: String,
    },
    FixtureAlias {
        #[serde(rename = "fixtureNamespace")]
        fixture_namespace: String,
        alias: String,
    },
    WindowNamespace {
        #[serde(rename = "windowPlanId")]
        window_plan_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowBudgetLimitsV1 {
    pub challenge_attempts: u64,
    pub verification_simulations: u64,
    pub session_mints: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowPlanSelectorV1 {
    pub window_plan_id: String,
    /// Empty only on the caller-owned mint request. The host fills the digest
    /// before the immutable grant is committed.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub namespace_digest: String,
    pub enabled_effects: Vec<RehearsalEffect>,
    pub window_budget_limits: WindowBudgetLimitsV1,
    pub expires_no_later_than: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChargeAxisV1 {
    pub axis: String,
    pub value_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetAllocationSelectorV1 {
    pub budget_name: String,
    pub charge_axes: Vec<ChargeAxisV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthClockSelectorV1 {
    pub store_id: String,
    pub clock_domain: AuthClockDomainV1,
    pub disposable_marker_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AuthClockDomainV1 {
    Auth,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactEffectSelectorV1 {
    pub contacts: Vec<ContactSelectorV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixtureEffectSelectorV1 {
    pub fixtures: Vec<FixtureSelectorV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityEffectSelectorV1 {
    pub identities: Vec<IdentitySelectorV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowEffectSelectorV1 {
    pub window_plans: Vec<WindowPlanSelectorV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllocationEffectSelectorV1 {
    pub allocations: Vec<BudgetAllocationSelectorV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClockEffectSelectorV1 {
    pub auth_clock: AuthClockSelectorV1,
}

/// JSON object whose keys are the exact dotted effect names. Every optional
/// member is validated against `scopes`; omission never means wildcard.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectSelectorsV1 {
    #[serde(
        rename = "challenge.capture",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub challenge_capture: Option<ContactEffectSelectorV1>,
    #[serde(
        rename = "challenge.redeem",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub challenge_redeem: Option<ContactEffectSelectorV1>,
    #[serde(
        rename = "fixture.identity.create",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub fixture_identity_create: Option<FixtureEffectSelectorV1>,
    #[serde(
        rename = "fixture.session.mint",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub fixture_session_mint: Option<FixtureEffectSelectorV1>,
    #[serde(
        rename = "verification.simulate",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub verification_simulate: Option<IdentityEffectSelectorV1>,
    #[serde(
        rename = "window.install",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub window_install: Option<WindowEffectSelectorV1>,
    #[serde(
        rename = "budget.rehearsal.allocate",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub budget_rehearsal_allocate: Option<AllocationEffectSelectorV1>,
    #[serde(
        rename = "clock.auth.advance",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub clock_auth_advance: Option<ClockEffectSelectorV1>,
}

impl EffectSelectorsV1 {
    fn present(&self, effect: RehearsalEffect) -> bool {
        match effect {
            RehearsalEffect::ChallengeCapture => self.challenge_capture.is_some(),
            RehearsalEffect::ChallengeRedeem => self.challenge_redeem.is_some(),
            RehearsalEffect::FixtureIdentityCreate => self.fixture_identity_create.is_some(),
            RehearsalEffect::FixtureSessionMint => self.fixture_session_mint.is_some(),
            RehearsalEffect::VerificationSimulate => self.verification_simulate.is_some(),
            RehearsalEffect::WindowInstall => self.window_install.is_some(),
            RehearsalEffect::BudgetRehearsalAllocate => self.budget_rehearsal_allocate.is_some(),
            RehearsalEffect::ClockAuthAdvance => self.clock_auth_advance.is_some(),
        }
    }

    fn nonempty(&self, effect: RehearsalEffect) -> bool {
        match effect {
            RehearsalEffect::ChallengeCapture => self
                .challenge_capture
                .as_ref()
                .is_some_and(|value| !value.contacts.is_empty()),
            RehearsalEffect::ChallengeRedeem => self
                .challenge_redeem
                .as_ref()
                .is_some_and(|value| !value.contacts.is_empty()),
            RehearsalEffect::FixtureIdentityCreate => self
                .fixture_identity_create
                .as_ref()
                .is_some_and(|value| !value.fixtures.is_empty()),
            RehearsalEffect::FixtureSessionMint => self
                .fixture_session_mint
                .as_ref()
                .is_some_and(|value| !value.fixtures.is_empty()),
            RehearsalEffect::VerificationSimulate => self
                .verification_simulate
                .as_ref()
                .is_some_and(|value| !value.identities.is_empty()),
            RehearsalEffect::WindowInstall => self
                .window_install
                .as_ref()
                .is_some_and(|value| !value.window_plans.is_empty()),
            RehearsalEffect::BudgetRehearsalAllocate => self
                .budget_rehearsal_allocate
                .as_ref()
                .is_some_and(|value| !value.allocations.is_empty()),
            RehearsalEffect::ClockAuthAdvance => self.clock_auth_advance.is_some(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalLimitsV1 {
    pub challenge_attempts: u64,
    pub identity_creates: u64,
    pub session_mints: u64,
    pub verification_simulations: u64,
    pub window_installs: u64,
    pub clock_advances: u64,
    pub allocation_ceiling: u64,
    pub max_uses: u64,
}

impl RehearsalLimitsV1 {
    pub fn for_effect(&self, effect: RehearsalEffect) -> u64 {
        match effect.counter() {
            RehearsalCounter::ChallengeAttempts => self.challenge_attempts,
            RehearsalCounter::IdentityCreates => self.identity_creates,
            RehearsalCounter::SessionMints => self.session_mints,
            RehearsalCounter::VerificationSimulations => self.verification_simulations,
            RehearsalCounter::WindowInstalls => self.window_installs,
            RehearsalCounter::ClockAdvances => self.clock_advances,
            RehearsalCounter::AllocationUnits => self.allocation_ceiling,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalConsumedV1 {
    pub challenge_attempts: u64,
    pub identity_creates: u64,
    pub session_mints: u64,
    pub verification_simulations: u64,
    pub window_installs: u64,
    pub clock_advances: u64,
    pub allocation_units: u64,
    pub uses_charged: u64,
}

impl RehearsalConsumedV1 {
    pub fn for_effect(&self, effect: RehearsalEffect) -> u64 {
        match effect.counter() {
            RehearsalCounter::ChallengeAttempts => self.challenge_attempts,
            RehearsalCounter::IdentityCreates => self.identity_creates,
            RehearsalCounter::SessionMints => self.session_mints,
            RehearsalCounter::VerificationSimulations => self.verification_simulations,
            RehearsalCounter::WindowInstalls => self.window_installs,
            RehearsalCounter::ClockAdvances => self.clock_advances,
            RehearsalCounter::AllocationUnits => self.allocation_units,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalCreatedByV1 {
    pub operator_audit_id: String,
    pub mint_request_digest: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RehearsalDeploymentProfile {
    Dev,
    Test,
    Demo,
    Prod,
}

impl RehearsalDeploymentProfile {
    pub fn from_server(profile: crate::contract_types::ServerProfile) -> Self {
        match profile {
            crate::contract_types::ServerProfile::Dev => Self::Dev,
            crate::contract_types::ServerProfile::Test => Self::Test,
            crate::contract_types::ServerProfile::Demo => Self::Demo,
            crate::contract_types::ServerProfile::Prod => Self::Prod,
        }
    }

    pub fn permits_rehearsal(self) -> bool {
        !matches!(self, Self::Prod)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalGrantV1 {
    pub kind: String,
    pub grant_id: String,
    pub instance_id: String,
    pub boot_nonce: String,
    pub app_id: String,
    pub activation_digest: String,
    pub sessions_mode_generation: u64,
    pub deployment_profile: RehearsalDeploymentProfile,
    pub scopes: Vec<RehearsalEffect>,
    pub effect_selectors: EffectSelectorsV1,
    pub limits: RehearsalLimitsV1,
    pub consumed: RehearsalConsumedV1,
    pub created_at: u64,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
    pub created_by: RehearsalCreatedByV1,
    pub carrier_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalWindowV1 {
    pub kind: String,
    pub window_id: String,
    pub grant_id: String,
    pub window_plan_id: String,
    pub namespace_digest: String,
    pub instance_id: String,
    pub boot_nonce: String,
    pub app_id: String,
    pub activation_digest: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
}

impl AuthRehearsalWindowV1 {
    pub fn validate_record(&self) -> SnapbackResult<()> {
        if self.kind != AUTH_REHEARSAL_WINDOW_KIND
            || !uuid_v7(&self.window_id)
            || !uuid_v7(&self.grant_id)
            || !uuid_v7(&self.window_plan_id)
            || !valid_digest(&self.namespace_digest)
            || !uuid_v7(&self.instance_id)
            || self.boot_nonce.is_empty()
            || self.app_id.is_empty()
            || !valid_digest(&self.activation_digest)
            || self.created_at >= self.expires_at
            || self.revoked_at.is_some_and(|value| value < self.created_at)
        {
            return Err(request_invalid());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalStoreMarkersV1 {
    pub kind: String,
    pub store_id: String,
    pub disposable_at_creation: bool,
    pub disposable_marker_id: Option<String>,
    pub rehearsal_admitted: bool,
    pub first_admission_at: Option<u64>,
    pub first_admission_grant_digest: Option<String>,
    pub first_admission_effect: Option<RehearsalEffect>,
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
impl AuthRehearsalStoreMarkersV1 {
    pub fn validate(&self) -> SnapbackResult<()> {
        let disposable_shape = self.disposable_at_creation == self.disposable_marker_id.is_some();
        let admission_shape = if self.rehearsal_admitted {
            self.first_admission_at.is_some()
                && self
                    .first_admission_grant_digest
                    .as_ref()
                    .is_some_and(|value| valid_digest(value))
                && self.first_admission_effect.is_some()
        } else {
            self.first_admission_at.is_none()
                && self.first_admission_grant_digest.is_none()
                && self.first_admission_effect.is_none()
        };
        if self.kind != AUTH_REHEARSAL_STORE_MARKERS_KIND
            || !uuid_v7(&self.store_id)
            || !disposable_shape
            || self
                .disposable_marker_id
                .as_deref()
                .is_some_and(|value| !uuid_v7(value))
            || !admission_shape
        {
            return Err(request_invalid());
        }
        Ok(())
    }

    pub fn production_ineligible(&self) -> bool {
        self.disposable_at_creation || self.rehearsal_admitted
    }

    pub fn marker_state(&self) -> AuthRehearsalMarkerStateV1 {
        AuthRehearsalMarkerStateV1 {
            disposable_at_creation: self.disposable_at_creation,
            disposable_marker_id: self.disposable_marker_id.clone(),
            rehearsal_admitted: self.rehearsal_admitted,
            first_admission_at: self.first_admission_at,
            first_admission_grant_digest: self.first_admission_grant_digest.clone(),
            first_admission_effect: self.first_admission_effect,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalMarkerStateV1 {
    pub disposable_at_creation: bool,
    pub disposable_marker_id: Option<String>,
    pub rehearsal_admitted: bool,
    pub first_admission_at: Option<u64>,
    pub first_admission_grant_digest: Option<String>,
    pub first_admission_effect: Option<RehearsalEffect>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalSnapshotWitnessV1 {
    pub authorization_incarnation: String,
    pub database_version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub struct AuthRehearsalLogicalExportPayloadV1 {
    pub kind: String,
    pub source_store_id: String,
    pub snapshot_witness: AuthRehearsalSnapshotWitnessV1,
    pub body: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalExportEnvelopeV1 {
    pub kind: String,
    pub artifact_id: String,
    pub source_store_id: String,
    pub payload_sha256: String,
    pub marker_state: AuthRehearsalMarkerStateV1,
    pub snapshot_witness: AuthRehearsalSnapshotWitnessV1,
    pub source_key_id: String,
    pub mac: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthRehearsalLogicalExportArtifactV1 {
    pub envelope: AuthRehearsalExportEnvelopeV1,
    pub payload: Vec<u8>,
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub struct RehearsalExportVerificationKey(Zeroizing<[u8; 32]>);

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
impl RehearsalExportVerificationKey {
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub(crate) fn expose_secret(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for RehearsalExportVerificationKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RehearsalExportVerificationKey([REDACTED])")
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
struct RehearsalExportVerificationKeyCapsuleWireV1 {
    kind: String,
    source_store_id: String,
    source_key_id: String,
    key_base64url: String,
}

/// Materialize the independently transferred, store/key-specific verifier in
/// a brand-new strict owner-only file. The capsule is deliberately not an
/// export-artifact field or ordinary JSON response.
///
/// @ref LLP 0213#cross-host-verification-key-custody — cross-host HMAC trust
///   is explicit owner-only custody keyed by source store and auth-key id.
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub(crate) fn write_export_verification_key_capsule(
    path: &Path,
    source_store_id: &str,
    source_key_id: &str,
    key: &RehearsalExportVerificationKey,
) -> SnapbackResult<()> {
    if !uuid::Uuid::parse_str(source_store_id).is_ok_and(|id| id.get_version_num() == 7)
        || crate::auth::crypto::AuthKeyId::parse(source_key_id).is_err()
    {
        return Err(export_key_unavailable());
    }
    let wire = RehearsalExportVerificationKeyCapsuleWireV1 {
        kind: AUTH_REHEARSAL_EXPORT_KEY_CAPSULE_KIND.to_owned(),
        source_store_id: source_store_id.to_owned(),
        source_key_id: source_key_id.to_owned(),
        key_base64url: encode_base64url(key.expose_secret()),
    };
    let mut bytes = serde_json::to_vec(&wire).map_err(|_| export_key_unavailable())?;
    let result = crate::owner_only_file::write_new_owner_only(path, &bytes)
        .map_err(|_| export_key_unavailable());
    bytes.zeroize();
    result
}

/// Read one explicitly selected trust-store capsule without following links
/// or repairing permissions. Expected source ids are caller-owned lookup keys;
/// capsule-provided ids cannot redirect verification.
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub(crate) fn read_export_verification_key_capsule(
    path: &Path,
    expected_source_store_id: &str,
    expected_source_key_id: &str,
) -> SnapbackResult<RehearsalExportVerificationKey> {
    let mut bytes = crate::owner_only_file::read_strict_owner_only(
        path,
        MAX_REHEARSAL_EXPORT_KEY_CAPSULE_BYTES,
    )
    .map_err(|_| export_key_unavailable())?;
    let parsed = serde_json::from_slice::<RehearsalExportVerificationKeyCapsuleWireV1>(&bytes);
    bytes.zeroize();
    let mut wire = parsed.map_err(|_| export_key_unavailable())?;
    let result = if wire.kind != AUTH_REHEARSAL_EXPORT_KEY_CAPSULE_KIND
        || wire.source_store_id != expected_source_store_id
        || wire.source_key_id != expected_source_key_id
    {
        Err(export_key_unavailable())
    } else {
        let key = decode_canonical_base64url::<32>(&wire.key_base64url)
            .map_err(|_| export_key_unavailable())?;
        Ok(RehearsalExportVerificationKey::from_bytes(key))
    };
    wire.key_base64url.zeroize();
    result
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalMintRequestV1 {
    pub scopes: Vec<RehearsalEffect>,
    pub effect_selectors: EffectSelectorsV1,
    pub limits: RehearsalLimitsV1,
    pub expires_at: u64,
    pub idempotency_key: String,
    pub operator_audit_id: String,
}

impl AuthRehearsalGrantV1 {
    /// Validate the complete durable logical record independently of live
    /// authority. Expiry can make a valid record unusable, but cannot make its
    /// stored shape valid retroactively.
    pub fn validate_record(&self) -> SnapbackResult<()> {
        let uuid_v7 =
            |value: &str| uuid::Uuid::parse_str(value).is_ok_and(|id| id.get_version_num() == 7);
        if self.kind != AUTH_REHEARSAL_GRANT_KIND
            || !uuid_v7(&self.grant_id)
            || !uuid_v7(&self.instance_id)
            || self.boot_nonce.is_empty()
            || self.app_id.is_empty()
            || !valid_digest(&self.activation_digest)
            || !self.deployment_profile.permits_rehearsal()
            || self.created_by.operator_audit_id.is_empty()
            || !valid_digest(&self.created_by.mint_request_digest)
            || !valid_digest(&self.carrier_hash)
            || self.created_at >= self.expires_at
            || self.expires_at.saturating_sub(self.created_at) > MAX_REHEARSAL_TTL_MS
            || self
                .revoked_at
                .is_some_and(|revoked_at| revoked_at < self.created_at)
        {
            return Err(request_invalid());
        }
        validate_grant_shape(
            &self.scopes,
            &self.effect_selectors,
            &self.limits,
            self.expires_at,
            true,
        )?;
        for count in [
            self.consumed.challenge_attempts,
            self.consumed.identity_creates,
            self.consumed.session_mints,
            self.consumed.verification_simulations,
            self.consumed.window_installs,
            self.consumed.clock_advances,
            self.consumed.allocation_units,
            self.consumed.uses_charged,
        ] {
            if count > MAX_REHEARSAL_COUNT {
                return Err(request_invalid());
            }
        }
        if self.consumed.challenge_attempts > self.limits.challenge_attempts
            || self.consumed.identity_creates > self.limits.identity_creates
            || self.consumed.session_mints > self.limits.session_mints
            || self.consumed.verification_simulations > self.limits.verification_simulations
            || self.consumed.window_installs > self.limits.window_installs
            || self.consumed.clock_advances > self.limits.clock_advances
            || self.consumed.allocation_units > self.limits.allocation_ceiling
            || self.consumed.uses_charged > self.limits.max_uses
        {
            return Err(request_invalid());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalStatusRequestV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalRevokeRequestV1 {
    pub grant_id: String,
}

impl RehearsalMintRequestV1 {
    /// Validate the complete caller-owned half. Server binding fields and
    /// zero-valued consumed counters are filled only after this succeeds.
    ///
    /// @ref LLP 0213#authrehearsalgrantv1 — scopes are sorted and unique;
    ///   selector keys are exactly the scopes; all counters are present; a
    ///   scope has positive quota and maxUses is finite and positive.
    pub fn validate(&self, now_ms: u64) -> SnapbackResult<()> {
        if self.scopes.is_empty()
            || self.idempotency_key.is_empty()
            || self.idempotency_key.len() > 256
            || self.operator_audit_id.is_empty()
            || self.operator_audit_id.len() > 256
            || self.limits.max_uses == 0
            || self.expires_at <= now_ms
            || self.expires_at.saturating_sub(now_ms) > MAX_REHEARSAL_TTL_MS
        {
            return Err(request_invalid());
        }
        validate_grant_shape(
            &self.scopes,
            &self.effect_selectors,
            &self.limits,
            self.expires_at,
            false,
        )
    }

    pub fn normalized_digest(&self) -> SnapbackResult<String> {
        digest_serializable(b"snapback.auth-rehearsal.mint.v1\0", self)
    }
}

fn validate_grant_shape(
    scopes: &[RehearsalEffect],
    selectors: &EffectSelectorsV1,
    limits: &RehearsalLimitsV1,
    expires_at: u64,
    committed_namespaces: bool,
) -> SnapbackResult<()> {
    if scopes.is_empty() || limits.max_uses == 0 || !scopes.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err(request_invalid());
    }
    for count in [
        limits.challenge_attempts,
        limits.identity_creates,
        limits.session_mints,
        limits.verification_simulations,
        limits.window_installs,
        limits.clock_advances,
        limits.allocation_ceiling,
        limits.max_uses,
        expires_at,
    ] {
        if count > MAX_REHEARSAL_COUNT {
            return Err(request_invalid());
        }
    }
    let scope_set: BTreeSet<_> = scopes.iter().copied().collect();
    for effect in ALL_REHEARSAL_EFFECTS {
        let scoped = scope_set.contains(&effect);
        if selectors.present(effect) != scoped
            || (scoped && !selectors.nonempty(effect))
            || (scoped && limits.for_effect(effect) == 0)
        {
            return Err(request_invalid());
        }
    }
    let expected_nonzero = [
        (
            limits.challenge_attempts,
            scope_set.contains(&RehearsalEffect::ChallengeCapture)
                || scope_set.contains(&RehearsalEffect::ChallengeRedeem),
        ),
        (
            limits.identity_creates,
            scope_set.contains(&RehearsalEffect::FixtureIdentityCreate),
        ),
        (
            limits.session_mints,
            scope_set.contains(&RehearsalEffect::FixtureSessionMint),
        ),
        (
            limits.verification_simulations,
            scope_set.contains(&RehearsalEffect::VerificationSimulate),
        ),
        (
            limits.window_installs,
            scope_set.contains(&RehearsalEffect::WindowInstall),
        ),
        (
            limits.clock_advances,
            scope_set.contains(&RehearsalEffect::ClockAuthAdvance),
        ),
        (
            limits.allocation_ceiling,
            scope_set.contains(&RehearsalEffect::BudgetRehearsalAllocate),
        ),
    ];
    if expected_nonzero
        .into_iter()
        .any(|(limit, present)| (limit != 0) != present)
    {
        return Err(request_invalid());
    }
    validate_selector_shapes(selectors, scopes, expires_at, committed_namespaces)?;
    if let Some(selector) = &selectors.window_install
        && limits.window_installs != selector.window_plans.len() as u64
    {
        return Err(request_invalid());
    }
    Ok(())
}

pub const ALL_REHEARSAL_EFFECTS: [RehearsalEffect; 8] = [
    RehearsalEffect::ChallengeCapture,
    RehearsalEffect::ChallengeRedeem,
    RehearsalEffect::FixtureIdentityCreate,
    RehearsalEffect::FixtureSessionMint,
    RehearsalEffect::VerificationSimulate,
    RehearsalEffect::WindowInstall,
    RehearsalEffect::BudgetRehearsalAllocate,
    RehearsalEffect::ClockAuthAdvance,
];

fn validate_selector_shapes(
    selectors: &EffectSelectorsV1,
    scopes: &[RehearsalEffect],
    grant_expires_at: u64,
    committed_namespaces: bool,
) -> SnapbackResult<()> {
    // @ref LLP 0213#total-effect-to-selector-mapping — selectors are finite,
    //   exact, nonempty, and never default to all/current/localhost.
    let validate_contact = |contact: &ContactSelectorV1| match contact {
        ContactSelectorV1::ExactContact {
            canonical_address_digest,
        } => valid_digest(canonical_address_digest),
        ContactSelectorV1::ContactNamespace {
            fixture_namespace,
            domain_digest,
        } => !fixture_namespace.is_empty() && valid_digest(domain_digest),
    };
    for contacts in [
        selectors.challenge_capture.as_ref().map(|s| &s.contacts),
        selectors.challenge_redeem.as_ref().map(|s| &s.contacts),
    ]
    .into_iter()
    .flatten()
    {
        if contacts.len() > 1_024 || !contacts.iter().all(validate_contact) {
            return Err(request_invalid());
        }
    }
    for fixtures in [
        selectors
            .fixture_identity_create
            .as_ref()
            .map(|s| &s.fixtures),
        selectors.fixture_session_mint.as_ref().map(|s| &s.fixtures),
    ]
    .into_iter()
    .flatten()
    {
        if fixtures.len() > 1_024
            || !fixtures.iter().all(|fixture| {
                !fixture.fixture_namespace.is_empty()
                    && validate_contact(&fixture.contact)
                    && match &fixture.contact {
                        ContactSelectorV1::ContactNamespace {
                            fixture_namespace, ..
                        } => fixture_namespace == &fixture.fixture_namespace,
                        ContactSelectorV1::ExactContact { .. } => true,
                    }
            })
        {
            return Err(request_invalid());
        }
    }
    if let Some(selector) = &selectors.verification_simulate
        && (selector.identities.len() > 1_024
            || !selector.identities.iter().all(|identity| match identity {
                IdentitySelectorV1::IdentityId { identity_id } => {
                    identity_id.starts_with("idn_") && identity_id.len() > 4
                }
                IdentitySelectorV1::FixtureAlias {
                    fixture_namespace,
                    alias,
                } => {
                    !fixture_namespace.is_empty()
                        && !alias.is_empty()
                        && fixture_namespace.len() <= 256
                        && alias.len() <= 256
                }
                IdentitySelectorV1::WindowNamespace { window_plan_id } => uuid_v7(window_plan_id),
            }))
    {
        return Err(request_invalid());
    }
    if let Some(selector) = &selectors.window_install
        && (selector.window_plans.len() > 1_024
            || !selector.window_plans.iter().all(|plan| {
                uuid_v7(&plan.window_plan_id)
                    && if committed_namespaces {
                        valid_digest(&plan.namespace_digest)
                    } else {
                        plan.namespace_digest.is_empty()
                    }
                    && plan.expires_no_later_than <= grant_expires_at
                    && plan.expires_no_later_than > 0
                    && !plan.enabled_effects.is_empty()
                    && plan
                        .enabled_effects
                        .windows(2)
                        .all(|pair| pair[0] < pair[1])
                    && plan.enabled_effects.iter().all(|effect| {
                        matches!(
                            effect,
                            RehearsalEffect::ChallengeCapture
                                | RehearsalEffect::ChallengeRedeem
                                | RehearsalEffect::VerificationSimulate
                        ) && scopes.contains(effect)
                    })
                    && [
                        plan.window_budget_limits.challenge_attempts,
                        plan.window_budget_limits.verification_simulations,
                        plan.window_budget_limits.session_mints,
                    ]
                    .into_iter()
                    .all(|count| count <= MAX_REHEARSAL_COUNT)
            }))
    {
        return Err(request_invalid());
    }
    if let Some(selector) = &selectors.budget_rehearsal_allocate
        && (selector.allocations.len() > 1_024
            || !selector.allocations.iter().all(|allocation| {
                !allocation.budget_name.is_empty()
                    && !matches!(allocation.budget_name.as_str(), "*" | "all" | "any")
                    && !allocation.charge_axes.is_empty()
                    && allocation.charge_axes.len() <= 16
                    && allocation
                        .charge_axes
                        .windows(2)
                        .all(|pair| pair[0].axis < pair[1].axis)
                    && allocation.charge_axes.iter().all(|axis| {
                        !axis.axis.is_empty()
                            && !matches!(axis.axis.as_str(), "*" | "all" | "any")
                            && valid_digest(&axis.value_digest)
                    })
            }))
    {
        return Err(request_invalid());
    }
    if let Some(selector) = &selectors.clock_auth_advance
        && (!uuid_v7(&selector.auth_clock.store_id)
            || !uuid_v7(&selector.auth_clock.disposable_marker_id))
    {
        return Err(request_invalid());
    }
    Ok(())
}

fn uuid_v7(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.get_version_num() == 7)
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RehearsalBindingFacts {
    pub instance_id: String,
    pub boot_nonce: String,
    pub app_id: String,
    pub activation_digest: String,
    pub sessions_mode_generation: u64,
    pub deployment_profile: RehearsalDeploymentProfile,
    pub sessions_settled_available: bool,
}

impl RehearsalBindingFacts {
    pub fn validate_grant(&self, grant: &AuthRehearsalGrantV1, now_ms: u64) -> SnapbackResult<()> {
        if !self.deployment_profile.permits_rehearsal() {
            return Err(profile_forbidden());
        }
        if grant.revoked_at.is_some() {
            return Err(authority_ended());
        }
        if now_ms >= grant.expires_at {
            return Err(expired());
        }
        if !self.sessions_settled_available
            || grant.kind != AUTH_REHEARSAL_GRANT_KIND
            || grant.instance_id != self.instance_id
            || grant.boot_nonce != self.boot_nonce
            || grant.app_id != self.app_id
            || grant.activation_digest != self.activation_digest
            || grant.sessions_mode_generation != self.sessions_mode_generation
            || grant.deployment_profile != self.deployment_profile
        {
            return Err(binding_mismatch());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "effect", deny_unknown_fields)]
pub enum RehearsalExerciseRequestV1 {
    #[serde(rename = "challenge.capture", rename_all = "camelCase")]
    ChallengeCapture {
        idempotency_key: String,
        challenge_id: String,
        fixture_namespace: Option<String>,
    },
    #[serde(rename = "challenge.redeem", rename_all = "camelCase")]
    ChallengeRedeem {
        idempotency_key: String,
        challenge_id: String,
        code: String,
        fixture_namespace: Option<String>,
    },
    #[serde(rename = "fixture.identity.create", rename_all = "camelCase")]
    FixtureIdentityCreate {
        idempotency_key: String,
        fixture_namespace: String,
        email: String,
    },
    #[serde(rename = "fixture.session.mint", rename_all = "camelCase")]
    FixtureSessionMint {
        idempotency_key: String,
        fixture_namespace: String,
        email: String,
    },
    #[serde(rename = "verification.simulate", rename_all = "camelCase")]
    VerificationSimulate {
        idempotency_key: String,
        identity_id: String,
    },
    #[serde(rename = "window.install", rename_all = "camelCase")]
    WindowInstall {
        idempotency_key: String,
        window_plan_id: String,
    },
    #[serde(rename = "budget.rehearsal.allocate", rename_all = "camelCase")]
    BudgetRehearsalAllocate {
        idempotency_key: String,
        budget_name: String,
        units: u64,
    },
    #[serde(rename = "clock.auth.advance", rename_all = "camelCase")]
    ClockAuthAdvance {
        idempotency_key: String,
        advance_ms: u64,
    },
}

impl RehearsalExerciseRequestV1 {
    pub fn effect(&self) -> RehearsalEffect {
        match self {
            Self::ChallengeCapture { .. } => RehearsalEffect::ChallengeCapture,
            Self::ChallengeRedeem { .. } => RehearsalEffect::ChallengeRedeem,
            Self::FixtureIdentityCreate { .. } => RehearsalEffect::FixtureIdentityCreate,
            Self::FixtureSessionMint { .. } => RehearsalEffect::FixtureSessionMint,
            Self::VerificationSimulate { .. } => RehearsalEffect::VerificationSimulate,
            Self::WindowInstall { .. } => RehearsalEffect::WindowInstall,
            Self::BudgetRehearsalAllocate { .. } => RehearsalEffect::BudgetRehearsalAllocate,
            Self::ClockAuthAdvance { .. } => RehearsalEffect::ClockAuthAdvance,
        }
    }

    pub fn idempotency_key(&self) -> &str {
        match self {
            Self::ChallengeCapture {
                idempotency_key, ..
            }
            | Self::ChallengeRedeem {
                idempotency_key, ..
            }
            | Self::FixtureIdentityCreate {
                idempotency_key, ..
            }
            | Self::FixtureSessionMint {
                idempotency_key, ..
            }
            | Self::VerificationSimulate {
                idempotency_key, ..
            }
            | Self::WindowInstall {
                idempotency_key, ..
            }
            | Self::BudgetRehearsalAllocate {
                idempotency_key, ..
            }
            | Self::ClockAuthAdvance {
                idempotency_key, ..
            } => idempotency_key,
        }
    }

    pub fn normalized_digest(&self) -> SnapbackResult<String> {
        if self.idempotency_key().is_empty() || self.idempotency_key().len() > 256 {
            return Err(request_invalid());
        }
        digest_serializable(b"snapback.auth-rehearsal.exercise.v1\0", self)
    }

    pub fn contact(&self) -> SnapbackResult<Option<(CanonicalAddress, Option<&str>)>> {
        match self {
            Self::FixtureIdentityCreate {
                fixture_namespace,
                email,
                ..
            }
            | Self::FixtureSessionMint {
                fixture_namespace,
                email,
                ..
            } => Ok(Some((
                CanonicalAddress::parse(email).map_err(|_| request_invalid())?,
                Some(fixture_namespace.as_str()),
            ))),
            _ => Ok(None),
        }
    }
}

pub fn selector_matches_contact(
    selector: &ContactSelectorV1,
    address: &CanonicalAddress,
    fixture_namespace: Option<&str>,
) -> bool {
    match selector {
        ContactSelectorV1::ExactContact {
            canonical_address_digest,
        } => contact_digest(address) == *canonical_address_digest,
        ContactSelectorV1::ContactNamespace {
            fixture_namespace: expected_namespace,
            domain_digest: expected_domain,
        } => {
            fixture_namespace == Some(expected_namespace.as_str())
                && address
                    .as_str()
                    .rsplit_once('@')
                    .is_some_and(|(_, domain)| domain_digest(domain) == *expected_domain)
        }
    }
}

pub fn selector_allows(
    grant: &AuthRehearsalGrantV1,
    request: &RehearsalExerciseRequestV1,
    resolved_contact: Option<&CanonicalAddress>,
) -> bool {
    // @ref LLP 0213#effect-execution-and-audit — exact selector equality is
    //   checked after the universal attempt charge and before semantic work.
    match request {
        RehearsalExerciseRequestV1::ChallengeCapture {
            fixture_namespace, ..
        } => resolved_contact.is_some_and(|address| {
            grant
                .effect_selectors
                .challenge_capture
                .as_ref()
                .is_some_and(|selector| {
                    selector.contacts.iter().any(|contact| {
                        selector_matches_contact(contact, address, fixture_namespace.as_deref())
                    })
                })
        }),
        RehearsalExerciseRequestV1::ChallengeRedeem {
            fixture_namespace, ..
        } => resolved_contact.is_some_and(|address| {
            grant
                .effect_selectors
                .challenge_redeem
                .as_ref()
                .is_some_and(|selector| {
                    selector.contacts.iter().any(|contact| {
                        selector_matches_contact(contact, address, fixture_namespace.as_deref())
                    })
                })
        }),
        RehearsalExerciseRequestV1::FixtureIdentityCreate {
            fixture_namespace, ..
        } => resolved_contact.is_some_and(|address| {
            grant
                .effect_selectors
                .fixture_identity_create
                .as_ref()
                .is_some_and(|selector| {
                    selector.fixtures.iter().any(|fixture| {
                        fixture.fixture_namespace == *fixture_namespace
                            && selector_matches_contact(
                                &fixture.contact,
                                address,
                                Some(fixture_namespace),
                            )
                    })
                })
        }),
        RehearsalExerciseRequestV1::FixtureSessionMint {
            fixture_namespace, ..
        } => resolved_contact.is_some_and(|address| {
            grant
                .effect_selectors
                .fixture_session_mint
                .as_ref()
                .is_some_and(|selector| {
                    selector.fixtures.iter().any(|fixture| {
                        fixture.fixture_namespace == *fixture_namespace
                            && selector_matches_contact(
                                &fixture.contact,
                                address,
                                Some(fixture_namespace),
                            )
                    })
                })
        }),
        RehearsalExerciseRequestV1::VerificationSimulate { identity_id, .. } => grant
            .effect_selectors
            .verification_simulate
            .as_ref()
            .is_some_and(|selector| {
                selector.identities.iter().any(|identity| match identity {
                    IdentitySelectorV1::IdentityId {
                        identity_id: expected,
                    } => expected == identity_id,
                    // Fixture aliases and window namespaces require protected
                    // receipt resolution at the storage boundary.
                    IdentitySelectorV1::FixtureAlias { .. }
                    | IdentitySelectorV1::WindowNamespace { .. } => false,
                })
            }),
        RehearsalExerciseRequestV1::WindowInstall { window_plan_id, .. } => grant
            .effect_selectors
            .window_install
            .as_ref()
            .is_some_and(|selector| {
                selector
                    .window_plans
                    .iter()
                    .any(|plan| plan.window_plan_id == *window_plan_id)
            }),
        RehearsalExerciseRequestV1::BudgetRehearsalAllocate {
            budget_name, units, ..
        } => {
            *units > 0
                && grant
                    .effect_selectors
                    .budget_rehearsal_allocate
                    .as_ref()
                    .is_some_and(|selector| {
                        selector
                            .allocations
                            .iter()
                            .any(|allocation| allocation.budget_name == *budget_name)
                    })
        }
        RehearsalExerciseRequestV1::ClockAuthAdvance { advance_ms, .. } => {
            *advance_ms > 0 && grant.effect_selectors.clock_auth_advance.is_some()
        }
    }
}

pub fn contact_digest(address: &CanonicalAddress) -> String {
    domain_digest_bytes(
        b"snapback.auth-rehearsal.exact-contact.v1\0",
        address.as_str().as_bytes(),
    )
}

pub fn domain_digest(domain: &str) -> String {
    domain_digest_bytes(
        b"snapback.auth-rehearsal.contact-domain.v1\0",
        domain.as_bytes(),
    )
}

fn domain_digest_bytes(domain: &[u8], value: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update((value.len() as u64).to_be_bytes());
    digest.update(value);
    format!("sha256:{:x}", digest.finalize())
}

pub fn digest_serializable<T: Serialize>(domain: &[u8], value: &T) -> SnapbackResult<String> {
    let bytes = serde_json::to_vec(value).map_err(|_| request_invalid())?;
    Ok(domain_digest_bytes(domain, &bytes))
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub(crate) fn derive_export_verification_key(
    auth_key: &[u8; 32],
    source_store_id: &str,
    source_key_id: &str,
) -> SnapbackResult<RehearsalExportVerificationKey> {
    if !uuid_v7(source_store_id) || crate::auth::crypto::AuthKeyId::parse(source_key_id).is_err() {
        return Err(envelope_invalid());
    }
    let mut mac =
        Hmac::<Sha256>::new_from_slice(auth_key).expect("HMAC-SHA-256 accepts a 32-byte key");
    mac.update(b"snapback.auth-rehearsal.export-key.v1\0");
    update_hmac_lp(&mut mac, source_store_id.as_bytes())?;
    update_hmac_lp(&mut mac, source_key_id.as_bytes())?;
    let output = mac.finalize().into_bytes();
    let mut key = [0_u8; 32];
    key.copy_from_slice(&output);
    Ok(RehearsalExportVerificationKey::from_bytes(key))
}

/// Seal the exact payload bytes and snapshot marker state with the pinned
/// HMAC-SHA-256 envelope profile. The key passed here is already the
/// store-specific derived verification key; it is never serialized.
///
/// @ref LLP 0213#mac-primitive — JSON is decoded/re-encoded into a closed,
///   length-prefixed MAC input rather than treated as canonical bytes.
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub(crate) fn seal_export_envelope(
    payload: &[u8],
    markers: &AuthRehearsalStoreMarkersV1,
    snapshot_witness: AuthRehearsalSnapshotWitnessV1,
    source_key_id: String,
    key: &RehearsalExportVerificationKey,
) -> SnapbackResult<AuthRehearsalExportEnvelopeV1> {
    markers.validate()?;
    validate_snapshot_witness(&snapshot_witness)?;
    if crate::auth::crypto::AuthKeyId::parse(&source_key_id).is_err() {
        return Err(envelope_invalid());
    }
    let mut envelope = AuthRehearsalExportEnvelopeV1 {
        kind: AUTH_REHEARSAL_EXPORT_ENVELOPE_KIND.to_owned(),
        artifact_id: uuid::Uuid::now_v7().to_string(),
        source_store_id: markers.store_id.clone(),
        payload_sha256: encode_base64url(&Sha256::digest(payload)),
        marker_state: markers.marker_state(),
        snapshot_witness,
        source_key_id,
        mac: String::new(),
    };
    let encoded = encode_envelope_without_mac(&envelope)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
        .expect("HMAC-SHA-256 accepts a 32-byte key");
    mac.update(b"snapback.auth-rehearsal.export-envelope.v1\0");
    update_hmac_lp(&mut mac, &encoded)?;
    envelope.mac = encode_base64url(&mac.finalize().into_bytes());
    Ok(envelope)
}

/// Verify integrity before parsing or admitting payload state. A single
/// generic diagnostic covers edits, payload substitution, splices, and replay
/// against a different store/witness.
#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
pub(crate) fn verify_export_envelope(
    envelope: &AuthRehearsalExportEnvelopeV1,
    payload: &[u8],
    key: &RehearsalExportVerificationKey,
) -> SnapbackResult<AuthRehearsalLogicalExportPayloadV1> {
    validate_export_envelope_shape(envelope)?;
    let encoded = encode_envelope_without_mac(envelope)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
        .expect("HMAC-SHA-256 accepts a 32-byte key");
    mac.update(b"snapback.auth-rehearsal.export-envelope.v1\0");
    update_hmac_lp(&mut mac, &encoded)?;
    let expected = mac.finalize().into_bytes();
    let supplied =
        decode_canonical_base64url::<32>(&envelope.mac).map_err(|_| envelope_invalid())?;
    if expected.as_slice().ct_eq(&supplied).unwrap_u8() != 1 {
        return Err(envelope_invalid());
    }
    let observed_payload_digest = encode_base64url(&Sha256::digest(payload));
    if observed_payload_digest != envelope.payload_sha256 {
        return Err(envelope_invalid());
    }
    let decoded: AuthRehearsalLogicalExportPayloadV1 =
        serde_json::from_slice(payload).map_err(|_| envelope_invalid())?;
    if decoded.kind != AUTH_REHEARSAL_LOGICAL_EXPORT_KIND
        || decoded.source_store_id != envelope.source_store_id
        || decoded.snapshot_witness != envelope.snapshot_witness
    {
        return Err(envelope_invalid());
    }
    Ok(decoded)
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn validate_snapshot_witness(witness: &AuthRehearsalSnapshotWitnessV1) -> SnapbackResult<()> {
    if !uuid_v7(&witness.authorization_incarnation)
        || witness.database_version > MAX_REHEARSAL_COUNT
    {
        return Err(envelope_invalid());
    }
    Ok(())
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn validate_export_envelope_shape(envelope: &AuthRehearsalExportEnvelopeV1) -> SnapbackResult<()> {
    let markers = AuthRehearsalStoreMarkersV1 {
        kind: AUTH_REHEARSAL_STORE_MARKERS_KIND.to_owned(),
        store_id: envelope.source_store_id.clone(),
        disposable_at_creation: envelope.marker_state.disposable_at_creation,
        disposable_marker_id: envelope.marker_state.disposable_marker_id.clone(),
        rehearsal_admitted: envelope.marker_state.rehearsal_admitted,
        first_admission_at: envelope.marker_state.first_admission_at,
        first_admission_grant_digest: envelope.marker_state.first_admission_grant_digest.clone(),
        first_admission_effect: envelope.marker_state.first_admission_effect,
    };
    if envelope.kind != AUTH_REHEARSAL_EXPORT_ENVELOPE_KIND
        || !uuid_v7(&envelope.artifact_id)
        || decode_canonical_base64url::<32>(&envelope.payload_sha256).is_err()
        || decode_canonical_base64url::<32>(&envelope.mac).is_err()
        || crate::auth::crypto::AuthKeyId::parse(&envelope.source_key_id).is_err()
    {
        return Err(envelope_invalid());
    }
    markers.validate().map_err(|_| envelope_invalid())?;
    validate_snapshot_witness(&envelope.snapshot_witness)
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn encode_envelope_without_mac(
    envelope: &AuthRehearsalExportEnvelopeV1,
) -> SnapbackResult<Vec<u8>> {
    let mut output = Vec::new();
    append_lp(&mut output, envelope.kind.as_bytes())?;
    append_lp(&mut output, envelope.artifact_id.as_bytes())?;
    append_lp(&mut output, envelope.source_store_id.as_bytes())?;
    append_lp(&mut output, envelope.payload_sha256.as_bytes())?;
    output.push(u8::from(envelope.marker_state.disposable_at_creation));
    append_optional_string(
        &mut output,
        envelope.marker_state.disposable_marker_id.as_deref(),
    )?;
    output.push(u8::from(envelope.marker_state.rehearsal_admitted));
    append_optional_u64(&mut output, envelope.marker_state.first_admission_at);
    append_optional_string(
        &mut output,
        envelope
            .marker_state
            .first_admission_grant_digest
            .as_deref(),
    )?;
    append_optional_string(
        &mut output,
        envelope
            .marker_state
            .first_admission_effect
            .map(RehearsalEffect::as_str),
    )?;
    append_lp(
        &mut output,
        envelope
            .snapshot_witness
            .authorization_incarnation
            .as_bytes(),
    )?;
    output.extend_from_slice(&envelope.snapshot_witness.database_version.to_be_bytes());
    append_lp(&mut output, envelope.source_key_id.as_bytes())?;
    Ok(output)
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn append_lp(output: &mut Vec<u8>, bytes: &[u8]) -> SnapbackResult<()> {
    let length = u32::try_from(bytes.len()).map_err(|_| envelope_invalid())?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(bytes);
    Ok(())
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn append_optional_string(output: &mut Vec<u8>, value: Option<&str>) -> SnapbackResult<()> {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        append_lp(output, value.as_bytes())?;
    }
    Ok(())
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn append_optional_u64(output: &mut Vec<u8>, value: Option<u64>) {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        output.extend_from_slice(&value.to_be_bytes());
    }
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn update_hmac_lp(mac: &mut Hmac<Sha256>, bytes: &[u8]) -> SnapbackResult<()> {
    let length = u32::try_from(bytes.len()).map_err(|_| envelope_invalid())?;
    mac.update(&length.to_be_bytes());
    mac.update(bytes);
    Ok(())
}

pub struct MintedRehearsalGrant {
    pub grant: AuthRehearsalGrantV1,
    carrier: RehearsalBearer,
    window_namespaces: Zeroizing<Vec<MintedWindowNamespaceV1>>,
}

/// Schema-only declaration for the no-store mint payload. Runtime assembly is
/// manual so the secret cannot acquire `Debug`, `Clone`, or a general-purpose
/// serialization path.
#[derive(JsonSchema)]
#[schemars(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
pub struct RehearsalMintResultV1 {
    pub kind: String,
    pub grant: AuthRehearsalGrantV1,
    pub carrier: String,
    pub window_namespaces: Vec<MintedWindowNamespaceV1>,
}

impl MintedRehearsalGrant {
    pub fn new(
        grant: AuthRehearsalGrantV1,
        carrier: RehearsalBearer,
        window_namespaces: Vec<MintedWindowNamespaceV1>,
    ) -> Self {
        Self {
            grant,
            carrier,
            window_namespaces: Zeroizing::new(window_namespaces),
        }
    }

    pub fn into_value(self) -> serde_json::Value {
        serde_json::json!({
            "kind": "authRehearsalMintResult.v1",
            "grant": self.grant,
            "carrier": self.carrier.expose_secret(),
            "windowNamespaces": self.window_namespaces.as_slice(),
        })
    }
}

impl fmt::Debug for MintedRehearsalGrant {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MintedRehearsalGrant")
            .field("grant_id", &self.grant.grant_id)
            .field("carrier", &"[REDACTED]")
            .finish()
    }
}

pub fn generate_carrier(random: &dyn RandomSource) -> Result<RehearsalBearer, CryptoError> {
    RehearsalBearer::generate(random)
}

pub fn rehearsal_capability_sibling(ready_file: &Path) -> std::io::Result<PathBuf> {
    let file_name = ready_file.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ready-file path must contain a file name",
        )
    })?;
    let mut sibling_name = file_name.to_os_string();
    sibling_name.push(".rehearsal");
    Ok(ready_file.with_file_name(sibling_name))
}

pub fn parse_rehearsal_capability_file(
    mut bytes: Zeroizing<Vec<u8>>,
) -> SnapbackResult<RehearsalBearer> {
    if bytes.is_empty() || bytes.len() > MAX_REHEARSAL_CAPABILITY_FILE_BYTES {
        return Err(carrier_required());
    }
    let value = std::str::from_utf8(bytes.as_slice()).map_err(|_| carrier_required())?;
    let parsed = RehearsalBearer::parse(value).map_err(|_| carrier_required());
    bytes.zeroize();
    parsed
}

pub fn request_invalid() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_REQUEST_INVALID",
        "auth rehearsal request is invalid",
    )
}

pub fn carrier_required() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED",
        "a valid auth rehearsal capability is required",
    )
}

pub fn profile_forbidden() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN",
        "auth rehearsal authority is forbidden for this deployment profile",
    )
}

pub fn config_forbidden() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_CONFIG_FORBIDDEN",
        "auth rehearsal configuration is forbidden for this deployment profile",
    )
}

pub fn scope_denied() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED",
        "the rehearsal grant does not authorize this effect",
    )
}

pub fn selector_denied() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED",
        "the rehearsal request does not match its immutable selector",
    )
}

pub fn binding_mismatch() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH",
        "the rehearsal grant no longer matches the live target binding",
    )
}

pub fn expired() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_EXPIRED",
        "the rehearsal grant has expired",
    )
}

pub fn authority_ended() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED",
        "the rehearsal grant authority has ended",
    )
}

pub fn budget_exhausted(counter: &str) -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED",
        "the rehearsal grant budget is exhausted",
    )
    .with_details(serde_json::json!({
        "counter": counter,
        "retryAfter": { "kind": "new-authority-required" },
    }))
}

pub fn idempotency_conflict() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_IDEMPOTENCY_CONFLICT",
        "the rehearsal idempotency key is bound to a different request",
    )
}

pub fn namespace_unavailable() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_NAMESPACE_UNAVAILABLE",
        "rehearsal namespace allocation is unavailable",
    )
}
#[allow(dead_code)]
pub fn namespace_consumed() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_NAMESPACE_CONSUMED",
        "rehearsal namespace authority has ended",
    )
}
#[allow(dead_code)]
pub fn reachability_public() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC",
        "rehearsal cannot target a published public surface",
    )
}
#[allow(dead_code)]
pub fn reachability_invalid() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_INVALID",
        "rehearsal reachability facts are invalid",
    )
}
#[allow(dead_code)]
pub fn producer_parity() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_PRODUCER_PARITY",
        "rehearsal reachability producer parity is incomplete",
    )
}
#[allow(dead_code)]
pub fn disposable_required() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_DISPOSABLE_REQUIRED",
        "auth clock rehearsal requires a disposable store",
    )
}
pub fn state_present() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT",
        "rehearsal state is present",
    )
}
#[allow(dead_code)]
pub fn envelope_invalid() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID",
        "auth rehearsal export envelope is invalid",
    )
}
#[allow(dead_code)]
pub fn export_key_unavailable() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_EXPORT_KEY_UNAVAILABLE",
        "auth rehearsal export key is unavailable",
    )
}
#[allow(dead_code)]
pub fn provenance_invalid() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_PROVENANCE_INVALID",
        "auth rehearsal provenance is invalid",
    )
}
#[allow(dead_code)]
pub fn egress_refused() -> SnapbackError {
    rehearsal_error(
        "SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED",
        "external egress is forbidden under rehearsal authority",
    )
}

fn rehearsal_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "auth-rehearsal", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CredentialClass, OsRandom, classify_credential};

    #[test]
    fn carrier_is_registered_redacted_and_round_trips() {
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        assert_eq!(
            classify_credential(carrier.expose_secret()),
            Some(CredentialClass::RehearsalCapability)
        );
        assert!(RehearsalBearer::parse(carrier.expose_secret()).is_ok());
        assert_eq!(format!("{carrier:?}"), "RehearsalBearer([REDACTED])");
    }

    #[test]
    fn sidecar_is_the_prompt_pinned_mechanical_sibling() {
        assert_eq!(
            rehearsal_capability_sibling(Path::new("/tmp/app.ready.json")).unwrap(),
            PathBuf::from("/tmp/app.ready.json.rehearsal")
        );
    }

    #[test]
    fn mint_dto_refuses_unknown_effects_fields_and_selector_substitution() {
        let base = serde_json::json!({
            "scopes": ["challenge.capture"],
            "effectSelectors": {
                "challenge.capture": {
                    "contacts": [{
                        "kind": "exactContact",
                        "canonicalAddressDigest": format!("sha256:{}", "a".repeat(64))
                    }]
                }
            },
            "limits": {
                "challengeAttempts": 1,
                "identityCreates": 0,
                "sessionMints": 0,
                "verificationSimulations": 0,
                "windowInstalls": 0,
                "clockAdvances": 0,
                "allocationCeiling": 0,
                "maxUses": 1
            },
            "expiresAt": 1_700_000_060_000_u64,
            "idempotencyKey": "mint-closed",
            "operatorAuditId": "operator-closed"
        });
        let request: RehearsalMintRequestV1 = serde_json::from_value(base.clone()).unwrap();
        request.validate(1_700_000_000_000).unwrap();

        let mut unknown_effect = base.clone();
        unknown_effect["scopes"] = serde_json::json!(["challenge.capture-all"]);
        assert!(serde_json::from_value::<RehearsalMintRequestV1>(unknown_effect).is_err());

        let mut unknown_selector = base.clone();
        unknown_selector["effectSelectors"]["challenge.capture"]["wildcard"] =
            serde_json::json!(true);
        assert!(serde_json::from_value::<RehearsalMintRequestV1>(unknown_selector).is_err());

        let mut extra_selector: RehearsalMintRequestV1 = serde_json::from_value(base).unwrap();
        extra_selector.effect_selectors.challenge_redeem =
            extra_selector.effect_selectors.challenge_capture.clone();
        assert_eq!(
            extra_selector
                .validate(1_700_000_000_000)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_REQUEST_INVALID"
        );
    }

    fn digest(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    #[test]
    fn grant_and_window_governors_are_level_triggered_at_use_and_publication() {
        let grant_id = uuid::Uuid::now_v7().to_string();
        let window_id = uuid::Uuid::now_v7().to_string();
        let registry: RehearsalLiveAuthorityRegistry = Arc::new(RwLock::new(BTreeMap::new()));
        registry.write().unwrap().insert(
            grant_id.clone(),
            RehearsalLiveAuthority {
                expires_at_ms: 1_000,
                parent_grant_id: None,
            },
        );
        registry.write().unwrap().insert(
            window_id.clone(),
            RehearsalLiveAuthority {
                expires_at_ms: 800,
                parent_grant_id: Some(grant_id.clone()),
            },
        );
        let provenance = AuthRehearsalProvenanceV1::from_governing_authority(
            RehearsalGoverningAuthorityV1::Window {
                window_id: window_id.clone(),
                parent_grant_id: grant_id.clone(),
            },
            digest('a'),
            digest('b'),
        )
        .unwrap();
        let fence = RehearsalAuthorityFence::new(provenance, registry.clone()).unwrap();
        fence.validate_at(799).unwrap();
        assert_eq!(
            fence.validate_at(800).unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
        );

        registry
            .write()
            .unwrap()
            .get_mut(&window_id)
            .unwrap()
            .expires_at_ms = 900;
        assert_eq!(fence.try_publish(850, || Ok(7)).unwrap(), 7);
        registry.write().unwrap().remove(&window_id);
        assert_eq!(
            fence
                .try_publish(850, || Ok(7))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
        );

        registry.write().unwrap().insert(
            window_id,
            RehearsalLiveAuthority {
                expires_at_ms: 900,
                parent_grant_id: Some(grant_id.clone()),
            },
        );
        registry.write().unwrap().remove(&grant_id);
        assert_eq!(
            fence.validate_at(850).unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
        );
    }

    #[test]
    fn simulated_assurance_rechecks_governor_at_use_time() {
        let grant_id = uuid::Uuid::now_v7().to_string();
        let registry: RehearsalLiveAuthorityRegistry = Arc::new(RwLock::new(BTreeMap::new()));
        registry.write().unwrap().insert(
            grant_id.clone(),
            RehearsalLiveAuthority {
                expires_at_ms: 1_000,
                parent_grant_id: None,
            },
        );
        let assurance = RehearsalAssuranceV1 {
            kind: "email_verified".to_owned(),
            provenance: "rehearsal".to_owned(),
            issued_at: 100,
            expires_at: 900,
            governing_authority: RehearsalGoverningAuthorityV1::Grant {
                grant_id: grant_id.clone(),
            },
        };
        assurance.validate_use_at(899, registry.clone()).unwrap();
        registry.write().unwrap().remove(&grant_id);
        assert_eq!(
            assurance
                .validate_use_at(899, registry)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
        );
    }

    #[test]
    fn external_egress_requires_declared_nonproduction_adapter() {
        let provenance = AuthRehearsalProvenanceV1::from_governing_authority(
            RehearsalGoverningAuthorityV1::Grant {
                grant_id: uuid::Uuid::now_v7().to_string(),
            },
            digest('c'),
            digest('d'),
        )
        .unwrap();
        assert_eq!(
            ExternalEgressGate::prepare(
                Some(&provenance),
                crate::contract_types::ServerProfile::Test,
                RegisteredEgressChannel::RuntimeFetch,
                RegisteredEgressAdapter::Real,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED"
        );
        ExternalEgressGate::prepare(
            Some(&provenance),
            crate::contract_types::ServerProfile::Test,
            RegisteredEgressChannel::NotificationProvider,
            RegisteredEgressAdapter::DeclaredSimulator,
        )
        .unwrap();
        assert_eq!(
            ExternalEgressGate::prepare(
                Some(&provenance),
                crate::contract_types::ServerProfile::Prod,
                RegisteredEgressChannel::Webhook,
                RegisteredEgressAdapter::DeclaredTestAdapter,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED"
        );
        ExternalEgressGate::prepare(
            None,
            crate::contract_types::ServerProfile::Prod,
            RegisteredEgressChannel::ExternalQueue,
            RegisteredEgressAdapter::Real,
        )
        .unwrap();
    }

    #[test]
    fn window_namespace_is_192_bit_host_generated_lowercase_base32() {
        struct FixedRandom;
        impl RandomSource for FixedRandom {
            fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
                for (index, byte) in destination.iter_mut().enumerate() {
                    *byte = index as u8;
                }
                Ok(())
            }
        }
        let namespace = generate_window_namespace(&FixedRandom).unwrap();
        assert!(valid_window_namespace(&namespace));
        assert_eq!(
            namespace.len(),
            REHEARSAL_WINDOW_NAMESPACE_LABEL_CHARS + REHEARSAL_WINDOW_NAMESPACE_SUFFIX.len()
        );
        assert_eq!(
            namespace.as_str(),
            "aaaqeayeaudaocajbifqydiob4ibceqtcqkrmfy.rehearsal.invalid"
        );
        assert!(valid_digest(&window_namespace_digest(&namespace).unwrap()));
        assert!(!valid_window_namespace("example.invalid"));
    }

    #[test]
    fn reachability_fact_is_defense_in_depth_with_one_named_absence_exception() {
        let build = digest('e');
        RehearsalReachabilityAdmissionV1 {
            target_class: RehearsalTargetClassV1::Wave1Local,
            expected_target_build_digest: build.clone(),
            fact: None,
        }
        .validate_for_install()
        .expect("wave-1 local, including proxy-re-exposed loopback, proceeds on entropy");

        assert_eq!(
            RehearsalReachabilityAdmissionV1 {
                target_class: RehearsalTargetClassV1::PublicByDesign,
                expected_target_build_digest: build.clone(),
                fact: None,
            }
            .validate_for_install()
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_PRODUCER_PARITY"
        );

        let published = AuthRehearsalReachabilityV1 {
            kind: AUTH_REHEARSAL_REACHABILITY_KIND.to_owned(),
            target_class: RehearsalTargetClassV1::PublicByDesign,
            exposure: RehearsalReachabilityExposureV1::PublishedPublic,
            producer_version: 1,
            target_build_digest: build.clone(),
            deployment_config_digest: digest('f'),
        };
        assert_eq!(
            RehearsalReachabilityAdmissionV1 {
                target_class: RehearsalTargetClassV1::PublicByDesign,
                expected_target_build_digest: build,
                fact: Some(published),
            }
            .validate_for_install()
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC"
        );
    }
}
