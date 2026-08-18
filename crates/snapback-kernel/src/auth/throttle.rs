//! Durable charge-on-denial authentication throttling for hosted targets.
//!
//! SQLite is the serialized shared authority only for the declared
//! single-instance container/VM profile. Multi-replica adapters must replace
//! it with an equivalent shared transaction.

use hmac::{Hmac, Mac as _};
use rusqlite::{Connection, OptionalExtension as _, TransactionBehavior, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
use std::net::IpAddr;
use zeroize::Zeroizing;

const TABLE: &str = "_snapback_auth_throttle";
const IDEMPOTENCY_TABLE: &str = "_snapback_auth_budget_idempotency";
const KEY_DOMAIN: &[u8] = b"snapback.auth-throttle.bucket.v1";
#[allow(dead_code)] // Request-bound effect consumers enter through the staged idempotency seam.
const IDEMPOTENCY_KEY_DOMAIN: &[u8] = b"snapback.auth-budget.idempotency-key.v1";
#[allow(dead_code)] // Request-bound effect consumers enter through the staged idempotency seam.
const IDEMPOTENCY_REQUEST_DOMAIN: &[u8] = b"snapback.auth-budget.normalized-request.v1";
const MAX_VALUE_BYTES: usize = 512;

/// Stable budget identifiers. Route names and deployment algorithms are
/// deliberately absent: local compatibility counters, hosted buckets, and
/// rehearsal authorities all project onto this one vocabulary.
///
/// @ref LLP 0215#5-canonical-budget-name-register — canonical names are the
/// accounting and diagnostic vocabulary; legacy diagnostics are aliases.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub enum AuthBudgetName {
    #[serde(rename = "auth.guessing")]
    Guessing,
    #[serde(rename = "auth.enumeration")]
    Enumeration,
    #[serde(rename = "auth.delivery")]
    Delivery,
    #[serde(rename = "auth.challenge-allocation")]
    ChallengeAllocation,
    #[serde(rename = "auth.hash-cpu")]
    HashCpu,
    #[serde(rename = "auth.session-mint")]
    SessionMint,
    #[serde(rename = "auth.oauth-transaction")]
    OauthTransaction,
    #[serde(rename = "auth.oauth-callback")]
    OauthCallback,
}

#[allow(dead_code)] // Staged password routes bind these effects next.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PasswordAuthEffect {
    Signup,
    Signin,
}

#[allow(dead_code)]
impl PasswordAuthEffect {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Signup => "auth.password.signup",
            Self::Signin => "auth.password.signin",
        }
    }

    pub const fn budgets(self) -> &'static [AuthBudgetName] {
        match self {
            Self::Signup => &[
                AuthBudgetName::Enumeration,
                AuthBudgetName::HashCpu,
                AuthBudgetName::SessionMint,
            ],
            Self::Signin => &[
                AuthBudgetName::Guessing,
                AuthBudgetName::Enumeration,
                AuthBudgetName::HashCpu,
                AuthBudgetName::SessionMint,
            ],
        }
    }
}

impl AuthBudgetName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Guessing => "auth.guessing",
            Self::Enumeration => "auth.enumeration",
            Self::Delivery => "auth.delivery",
            Self::ChallengeAllocation => "auth.challenge-allocation",
            Self::HashCpu => "auth.hash-cpu",
            Self::SessionMint => "auth.session-mint",
            Self::OauthTransaction => "auth.oauth-transaction",
            Self::OauthCallback => "auth.oauth-callback",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "auth.guessing" => Some(Self::Guessing),
            "auth.enumeration" => Some(Self::Enumeration),
            "auth.delivery" => Some(Self::Delivery),
            "auth.challenge-allocation" => Some(Self::ChallengeAllocation),
            "auth.hash-cpu" => Some(Self::HashCpu),
            "auth.session-mint" => Some(Self::SessionMint),
            "auth.oauth-transaction" => Some(Self::OauthTransaction),
            "auth.oauth-callback" => Some(Self::OauthCallback),
            _ => None,
        }
    }
}

#[allow(dead_code)] // The closed vocabulary includes harms reserved for later active budgets.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetHarm {
    Guessing,
    Enumeration,
    DeliveryCost,
    ChallengeStateAllocation,
    HashCpu,
    SessionMinting,
    OauthTransactionAllocation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetCounterClass {
    Attempt,
    SuccessfulEffect,
}

#[allow(dead_code)] // Source/principal are closed axes even when this compatibility policy omits them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetChargeAxis {
    Recipient,
    Source,
    Principal,
    Credential,
    Provider,
    App,
    Deployment,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetChargeTiming {
    ObservationBoundary,
    KdfAdmission,
    ChallengeTransactionCommit,
    SessionTransactionCommit,
    MailboxReservation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetCounterStrategy {
    RollingWindow,
    FixedTotal,
    Occupancy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MissingAxisPolicy {
    OmitByDeclaration,
    Refuse,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthBudgetRuleDefinition {
    pub id: &'static str,
    pub axes: &'static [AuthBudgetChargeAxis],
    pub strategy: AuthBudgetCounterStrategy,
    pub charge_timing: AuthBudgetChargeTiming,
    pub missing_axis: MissingAxisPolicy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthBudgetDefinition {
    pub name: AuthBudgetName,
    pub harms: &'static [AuthBudgetHarm],
    pub effects: &'static [&'static str],
    pub counter_class: AuthBudgetCounterClass,
    pub rules: &'static [AuthBudgetRuleDefinition],
    pub public_non_enumerating: bool,
}

const DELIVERY_RECIPIENT_AXES: &[AuthBudgetChargeAxis] = &[
    AuthBudgetChargeAxis::Recipient,
    AuthBudgetChargeAxis::Provider,
    AuthBudgetChargeAxis::App,
    AuthBudgetChargeAxis::Deployment,
];
const CHALLENGE_GLOBAL_AXES: &[AuthBudgetChargeAxis] =
    &[AuthBudgetChargeAxis::App, AuthBudgetChargeAxis::Deployment];
const MAILBOX_AXES: &[AuthBudgetChargeAxis] = &[
    AuthBudgetChargeAxis::Provider,
    AuthBudgetChargeAxis::App,
    AuthBudgetChargeAxis::Deployment,
];
const CHALLENGE_CREDENTIAL_AXES: &[AuthBudgetChargeAxis] = &[
    AuthBudgetChargeAxis::Credential,
    AuthBudgetChargeAxis::Provider,
    AuthBudgetChargeAxis::App,
    AuthBudgetChargeAxis::Deployment,
];
const PASSWORD_IDENTIFIER_AXES: &[AuthBudgetChargeAxis] = &[
    AuthBudgetChargeAxis::Recipient,
    AuthBudgetChargeAxis::Source,
    AuthBudgetChargeAxis::Provider,
    AuthBudgetChargeAxis::App,
    AuthBudgetChargeAxis::Deployment,
];
const PASSWORD_RESOURCE_AXES: &[AuthBudgetChargeAxis] = &[
    AuthBudgetChargeAxis::Source,
    AuthBudgetChargeAxis::Provider,
    AuthBudgetChargeAxis::App,
    AuthBudgetChargeAxis::Deployment,
];

const DELIVERY_RULES: &[AuthBudgetRuleDefinition] = &[AuthBudgetRuleDefinition {
    id: "request-code-recipient",
    axes: DELIVERY_RECIPIENT_AXES,
    strategy: AuthBudgetCounterStrategy::RollingWindow,
    charge_timing: AuthBudgetChargeTiming::ChallengeTransactionCommit,
    missing_axis: MissingAxisPolicy::OmitByDeclaration,
}];
const CHALLENGE_ALLOCATION_RULES: &[AuthBudgetRuleDefinition] = &[
    AuthBudgetRuleDefinition {
        id: "request-code-app-deployment",
        axes: CHALLENGE_GLOBAL_AXES,
        strategy: AuthBudgetCounterStrategy::RollingWindow,
        charge_timing: AuthBudgetChargeTiming::ChallengeTransactionCommit,
        missing_axis: MissingAxisPolicy::Refuse,
    },
    AuthBudgetRuleDefinition {
        id: "capture-mailbox-occupancy",
        axes: MAILBOX_AXES,
        strategy: AuthBudgetCounterStrategy::Occupancy,
        charge_timing: AuthBudgetChargeTiming::MailboxReservation,
        missing_axis: MissingAxisPolicy::Refuse,
    },
];
const GUESSING_RULES: &[AuthBudgetRuleDefinition] = &[
    AuthBudgetRuleDefinition {
        id: "challenge-credential-total",
        axes: CHALLENGE_CREDENTIAL_AXES,
        strategy: AuthBudgetCounterStrategy::FixedTotal,
        charge_timing: AuthBudgetChargeTiming::ObservationBoundary,
        missing_axis: MissingAxisPolicy::Refuse,
    },
    AuthBudgetRuleDefinition {
        id: "password-signin-identifier-source",
        axes: PASSWORD_IDENTIFIER_AXES,
        strategy: AuthBudgetCounterStrategy::RollingWindow,
        charge_timing: AuthBudgetChargeTiming::KdfAdmission,
        missing_axis: MissingAxisPolicy::Refuse,
    },
];
const ENUMERATION_RULES: &[AuthBudgetRuleDefinition] = &[AuthBudgetRuleDefinition {
    id: "password-identifier-source",
    axes: PASSWORD_IDENTIFIER_AXES,
    strategy: AuthBudgetCounterStrategy::RollingWindow,
    charge_timing: AuthBudgetChargeTiming::ObservationBoundary,
    missing_axis: MissingAxisPolicy::Refuse,
}];
const HASH_CPU_RULES: &[AuthBudgetRuleDefinition] = &[AuthBudgetRuleDefinition {
    id: "password-kdf-source",
    axes: PASSWORD_RESOURCE_AXES,
    strategy: AuthBudgetCounterStrategy::RollingWindow,
    charge_timing: AuthBudgetChargeTiming::KdfAdmission,
    missing_axis: MissingAxisPolicy::Refuse,
}];
const SESSION_MINT_RULES: &[AuthBudgetRuleDefinition] = &[AuthBudgetRuleDefinition {
    id: "password-session-mint",
    axes: PASSWORD_IDENTIFIER_AXES,
    strategy: AuthBudgetCounterStrategy::RollingWindow,
    charge_timing: AuthBudgetChargeTiming::SessionTransactionCommit,
    missing_axis: MissingAxisPolicy::Refuse,
}];

pub const AUTH_DELIVERY_BUDGET: AuthBudgetDefinition = AuthBudgetDefinition {
    name: AuthBudgetName::Delivery,
    harms: &[AuthBudgetHarm::DeliveryCost],
    effects: &["auth.request-code"],
    counter_class: AuthBudgetCounterClass::SuccessfulEffect,
    rules: DELIVERY_RULES,
    public_non_enumerating: true,
};
pub const AUTH_CHALLENGE_ALLOCATION_BUDGET: AuthBudgetDefinition = AuthBudgetDefinition {
    name: AuthBudgetName::ChallengeAllocation,
    harms: &[AuthBudgetHarm::ChallengeStateAllocation],
    effects: &["auth.request-code", "auth.capture-mailbox.reserve"],
    counter_class: AuthBudgetCounterClass::SuccessfulEffect,
    rules: CHALLENGE_ALLOCATION_RULES,
    public_non_enumerating: true,
};
pub const AUTH_GUESSING_BUDGET: AuthBudgetDefinition = AuthBudgetDefinition {
    name: AuthBudgetName::Guessing,
    harms: &[AuthBudgetHarm::Guessing],
    effects: &["auth.challenge.exchange", "auth.password.signin"],
    counter_class: AuthBudgetCounterClass::Attempt,
    rules: GUESSING_RULES,
    public_non_enumerating: true,
};
pub const AUTH_ENUMERATION_BUDGET: AuthBudgetDefinition = AuthBudgetDefinition {
    name: AuthBudgetName::Enumeration,
    harms: &[AuthBudgetHarm::Enumeration],
    effects: &["auth.password.signup", "auth.password.signin"],
    counter_class: AuthBudgetCounterClass::Attempt,
    rules: ENUMERATION_RULES,
    public_non_enumerating: true,
};
pub const AUTH_HASH_CPU_BUDGET: AuthBudgetDefinition = AuthBudgetDefinition {
    name: AuthBudgetName::HashCpu,
    harms: &[AuthBudgetHarm::HashCpu],
    effects: &["auth.password.signup", "auth.password.signin"],
    counter_class: AuthBudgetCounterClass::Attempt,
    rules: HASH_CPU_RULES,
    public_non_enumerating: true,
};
pub const AUTH_SESSION_MINT_BUDGET: AuthBudgetDefinition = AuthBudgetDefinition {
    name: AuthBudgetName::SessionMint,
    harms: &[AuthBudgetHarm::SessionMinting],
    effects: &["auth.password.signup", "auth.password.signin"],
    counter_class: AuthBudgetCounterClass::SuccessfulEffect,
    rules: SESSION_MINT_RULES,
    public_non_enumerating: true,
};

pub const AUTH_COMPATIBILITY_BUDGETS: &[AuthBudgetDefinition] = &[
    AUTH_DELIVERY_BUDGET,
    AUTH_CHALLENGE_ALLOCATION_BUDGET,
    AUTH_GUESSING_BUDGET,
    AUTH_ENUMERATION_BUDGET,
    AUTH_HASH_CPU_BUDGET,
    AUTH_SESSION_MINT_BUDGET,
];

fn compatibility_registry_is_closed() -> bool {
    AUTH_COMPATIBILITY_BUDGETS.len() == 6
        && AUTH_COMPATIBILITY_BUDGETS.iter().all(|budget| {
            !budget.harms.is_empty()
                && !budget.effects.is_empty()
                && !budget.rules.is_empty()
                && budget.public_non_enumerating
                && matches!(
                    budget.counter_class,
                    AuthBudgetCounterClass::Attempt | AuthBudgetCounterClass::SuccessfulEffect
                )
                && budget.rules.iter().all(|rule| {
                    !rule.id.is_empty()
                        && !rule.axes.is_empty()
                        && matches!(
                            rule.strategy,
                            AuthBudgetCounterStrategy::RollingWindow
                                | AuthBudgetCounterStrategy::FixedTotal
                                | AuthBudgetCounterStrategy::Occupancy
                        )
                        && matches!(
                            rule.charge_timing,
                            AuthBudgetChargeTiming::ObservationBoundary
                                | AuthBudgetChargeTiming::KdfAdmission
                                | AuthBudgetChargeTiming::ChallengeTransactionCommit
                                | AuthBudgetChargeTiming::SessionTransactionCommit
                                | AuthBudgetChargeTiming::MailboxReservation
                        )
                        && matches!(
                            rule.missing_axis,
                            MissingAxisPolicy::OmitByDeclaration | MissingAxisPolicy::Refuse
                        )
                })
        })
        && AUTH_COMPATIBILITY_BUDGETS
            .iter()
            .any(|budget| budget.name == AuthBudgetName::Delivery)
        && AUTH_COMPATIBILITY_BUDGETS
            .iter()
            .any(|budget| budget.name == AuthBudgetName::ChallengeAllocation)
        && AUTH_COMPATIBILITY_BUDGETS
            .iter()
            .any(|budget| budget.name == AuthBudgetName::Guessing)
        && AUTH_COMPATIBILITY_BUDGETS
            .iter()
            .any(|budget| budget.name == AuthBudgetName::Enumeration)
        && AUTH_COMPATIBILITY_BUDGETS
            .iter()
            .any(|budget| budget.name == AuthBudgetName::HashCpu)
        && AUTH_COMPATIBILITY_BUDGETS
            .iter()
            .any(|budget| budget.name == AuthBudgetName::SessionMint)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RollingWindowBudgetTerms {
    pub limit: u64,
    pub window_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FixedTotalBudgetTerms {
    pub limit: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OccupancyBudgetTerms {
    pub limit: u64,
}

// LLP 0057 compatibility values now have one numeric authority: the named
// budget policy. Provider/mailbox compatibility symbols below re-export these
// values instead of owning independent literals.
pub const AUTH_DELIVERY_RECIPIENT_TERMS: RollingWindowBudgetTerms =
    RollingWindowBudgetTerms {
        limit: 5,
        window_ms: 10 * 60 * 1_000,
    };
pub const AUTH_CHALLENGE_GLOBAL_TERMS: RollingWindowBudgetTerms = RollingWindowBudgetTerms {
    limit: 120,
    window_ms: 60 * 1_000,
};
pub const AUTH_GUESSING_CHALLENGE_TERMS: FixedTotalBudgetTerms =
    FixedTotalBudgetTerms { limit: 5 };
pub const AUTH_CAPTURE_MAILBOX_TERMS: OccupancyBudgetTerms =
    OccupancyBudgetTerms { limit: 1_024 };

pub const AUTH_ADDRESS_REQUEST_LIMIT: usize = AUTH_DELIVERY_RECIPIENT_TERMS.limit as usize;
pub const AUTH_ADDRESS_REQUEST_WINDOW_MS: u64 = AUTH_DELIVERY_RECIPIENT_TERMS.window_ms;
pub const AUTH_GLOBAL_REQUEST_LIMIT: usize = AUTH_CHALLENGE_GLOBAL_TERMS.limit as usize;
pub const AUTH_GLOBAL_REQUEST_WINDOW_MS: u64 = AUTH_CHALLENGE_GLOBAL_TERMS.window_ms;
pub const AUTH_MAXIMUM_ATTEMPTS: u32 = AUTH_GUESSING_CHALLENGE_TERMS.limit as u32;
pub const AUTH_CAPTURE_MAILBOX_CAPACITY: usize = AUTH_CAPTURE_MAILBOX_TERMS.limit as usize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetDeploymentProfile {
    Dev,
    Test,
    Demo,
    Prod,
}

/// Ordered budget posture selected exclusively from verified server state.
/// It deliberately implements neither `Deserialize` nor a string parser.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum AuthTrustTier {
    Anonymous,
    VerifiedContact,
    EstablishedSession,
    SenderBound,
    ScopedAgent,
    RehearsalAuthority,
}

/// Sealed result of server-side evidence verification. Request DTOs and
/// headers have no construction or deserialization path to this type.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DerivedAuthTrustTier(AuthTrustTier);

#[allow(dead_code)] // The compatibility consumer currently selects Anonymous; stronger seams are staged.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServerVerifiedAuthTrustEvidence {
    Anonymous,
    VerifiedContact,
    EstablishedSession,
    SenderBound,
    ScopedAgent,
    RehearsalAuthority,
}

/// @ref LLP 0215#7-server-derived-trust-tiers — tier selection is a sealed
/// server result, never a header/body/query value, and every tier stays finite.
pub fn derive_auth_trust_tier(
    evidence: ServerVerifiedAuthTrustEvidence,
) -> DerivedAuthTrustTier {
    DerivedAuthTrustTier(match evidence {
        ServerVerifiedAuthTrustEvidence::Anonymous => AuthTrustTier::Anonymous,
        ServerVerifiedAuthTrustEvidence::VerifiedContact => AuthTrustTier::VerifiedContact,
        ServerVerifiedAuthTrustEvidence::EstablishedSession => AuthTrustTier::EstablishedSession,
        ServerVerifiedAuthTrustEvidence::SenderBound => AuthTrustTier::SenderBound,
        ServerVerifiedAuthTrustEvidence::ScopedAgent => AuthTrustTier::ScopedAgent,
        ServerVerifiedAuthTrustEvidence::RehearsalAuthority => AuthTrustTier::RehearsalAuthority,
    })
}

impl DerivedAuthTrustTier {
    pub const fn tier(self) -> AuthTrustTier {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecipientRuleDisposition {
    Applied(RollingWindowBudgetTerms),
    OmittedByDeclaration {
        covered_by_budget: AuthBudgetName,
        covered_by_rule: &'static str,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResolvedCompatibilityAuthBudgetPolicy {
    profile: AuthBudgetDeploymentProfile,
    trust_tier: AuthTrustTier,
    recipient: RecipientRuleDisposition,
    global: RollingWindowBudgetTerms,
    challenge_attempts: FixedTotalBudgetTerms,
    mailbox: OccupancyBudgetTerms,
}

impl ResolvedCompatibilityAuthBudgetPolicy {
    /// Base -> profile overlay -> derived tier. The current compatibility
    /// table intentionally resolves all six tiers to the same finite terms;
    /// future tier scaling must be an explicit policy amendment.
    ///
    /// @ref LLP 0215#8-repo-declared-policy-and-deployment-overlays — dev/demo
    /// omit only the recipient rule and remain covered by the global rule.
    pub fn resolve(
        profile: AuthBudgetDeploymentProfile,
        trust: DerivedAuthTrustTier,
    ) -> Self {
        debug_assert!(
            compatibility_registry_is_closed(),
            "compiled authentication budget registry is closed"
        );
        let recipient = match profile {
            AuthBudgetDeploymentProfile::Dev | AuthBudgetDeploymentProfile::Demo => {
                RecipientRuleDisposition::OmittedByDeclaration {
                    covered_by_budget: AuthBudgetName::ChallengeAllocation,
                    covered_by_rule: "request-code-app-deployment",
                }
            }
            AuthBudgetDeploymentProfile::Test | AuthBudgetDeploymentProfile::Prod => {
                RecipientRuleDisposition::Applied(AUTH_DELIVERY_RECIPIENT_TERMS)
            }
        };
        Self {
            profile,
            trust_tier: trust.tier(),
            recipient,
            global: AUTH_CHALLENGE_GLOBAL_TERMS,
            challenge_attempts: AUTH_GUESSING_CHALLENGE_TERMS,
            mailbox: AUTH_CAPTURE_MAILBOX_TERMS,
        }
    }

    #[allow(dead_code)] // Policy/introspection seam; production consumes the resolved terms below.
    pub const fn profile(self) -> AuthBudgetDeploymentProfile {
        self.profile
    }

    #[allow(dead_code)] // Policy/introspection seam; production consumes the resolved terms below.
    pub const fn trust_tier(self) -> AuthTrustTier {
        self.trust_tier
    }

    pub const fn recipient(self) -> RecipientRuleDisposition {
        self.recipient
    }

    pub const fn global(self) -> RollingWindowBudgetTerms {
        self.global
    }

    pub const fn challenge_attempts(self) -> FixedTotalBudgetTerms {
        self.challenge_attempts
    }

    pub const fn mailbox(self) -> OccupancyBudgetTerms {
        self.mailbox
    }

    #[allow(dead_code)] // Bound into normalized idempotency requests by effect consumers.
    pub fn digest(self) -> [u8; 32] {
        let mut digest = Sha256::new();
        digest.update(b"snapback.auth.effect-budgets.compatibility-policy.v1\0");
        digest.update([self.profile as u8, self.trust_tier as u8]);
        match self.recipient {
            RecipientRuleDisposition::Applied(terms) => {
                digest.update([1]);
                digest.update(terms.limit.to_be_bytes());
                digest.update(terms.window_ms.to_be_bytes());
            }
            RecipientRuleDisposition::OmittedByDeclaration { .. } => digest.update([0]),
        }
        digest.update(self.global.limit.to_be_bytes());
        digest.update(self.global.window_ms.to_be_bytes());
        digest.update(self.challenge_attempts.limit.to_be_bytes());
        digest.update(self.mailbox.limit.to_be_bytes());
        digest.finalize().into()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AuthBudgetRetryAfter {
    Duration { milliseconds: u64 },
    At { epoch_ms: u64 },
    ResourceRelease,
    NewAuthorityRequired,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthBudgetRefusalDetails {
    pub budget_name: AuthBudgetName,
    pub retry_after: AuthBudgetRetryAfter,
    pub correlation_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthBudgetRefusalClass {
    Rate,
    Quota,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthBudgetRefusal {
    pub class: AuthBudgetRefusalClass,
    pub details: AuthBudgetRefusalDetails,
}

impl AuthBudgetRefusal {
    pub fn rate_duration(budget_name: AuthBudgetName, milliseconds: u64) -> Self {
        Self::with_retry(
            AuthBudgetRefusalClass::Rate,
            budget_name,
            AuthBudgetRetryAfter::Duration {
                milliseconds: milliseconds.max(1),
            },
        )
    }

    fn rate_at(budget_name: AuthBudgetName, epoch_ms: u64, correlation_id: String) -> Self {
        Self {
            class: AuthBudgetRefusalClass::Rate,
            details: AuthBudgetRefusalDetails {
                budget_name,
                retry_after: AuthBudgetRetryAfter::At { epoch_ms },
                correlation_id,
            },
        }
    }

    pub fn occupancy(budget_name: AuthBudgetName) -> Self {
        Self::with_retry(
            AuthBudgetRefusalClass::Quota,
            budget_name,
            AuthBudgetRetryAfter::ResourceRelease,
        )
    }

    pub fn fixed_total(budget_name: AuthBudgetName) -> Self {
        Self::with_retry(
            AuthBudgetRefusalClass::Quota,
            budget_name,
            AuthBudgetRetryAfter::NewAuthorityRequired,
        )
    }

    fn with_retry(
        class: AuthBudgetRefusalClass,
        budget_name: AuthBudgetName,
        retry_after: AuthBudgetRetryAfter,
    ) -> Self {
        Self {
            class,
            details: AuthBudgetRefusalDetails {
                budget_name,
                retry_after,
                correlation_id: uuid::Uuid::now_v7().to_string(),
            },
        }
    }

    #[allow(dead_code)] // Legacy aliases are emitted during migration; gated surfaces use this code.
    pub const fn canonical_code(&self) -> &'static str {
        match self.class {
            AuthBudgetRefusalClass::Rate => "SNAPBACK_AUTH_RATE_BUDGET",
            AuthBudgetRefusalClass::Quota => "SNAPBACK_AUTH_QUOTA_BUDGET",
        }
    }

    pub fn legacy_error(
        self,
        legacy_code: &'static str,
        subsystem: &'static str,
        message: &'static str,
    ) -> crate::diagnostic::SnapbackError {
        crate::diagnostic::SnapbackError::error(legacy_code, subsystem, message)
            .with_details(serde_json::to_value(self.details).expect("closed budget refusal"))
    }
}

// @ref LLP 0215#12-llp-0057-migration — the legacy email-code refusal pair
// preserves its exact compatibility payload beside the budget vocabulary that
// gives the locked refusal its structured details.
pub fn code_invalid() -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_AUTH_CODE_INVALID",
        "auth",
        "verification code is invalid",
    )
}

pub fn code_locked() -> crate::diagnostic::SnapbackError {
    AuthBudgetRefusal::fixed_total(AuthBudgetName::Guessing).legacy_error(
        "SNAPBACK_AUTH_CODE_LOCKED",
        "auth",
        "verification code attempt budget is exhausted",
    )
}

pub fn throttled_snapback(refusal: AuthBudgetRefusal) -> crate::diagnostic::SnapbackError {
    refusal.legacy_error(
        "SNAPBACK_AUTH_THROTTLED",
        "auth",
        "authentication request rate limit exceeded",
    )
}

/// Complete normalized request material required to bind an idempotency key.
/// Secret-bearing semantic inputs enter only as protocol-owned,
/// domain-separated keyed digests.
#[allow(dead_code)] // Staged seam for effects that expose request idempotency.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthBudgetSecretDigest([u8; 32]);

#[allow(dead_code)] // Staged seam for effects that expose request idempotency.
impl AuthBudgetSecretDigest {
    /// Derive a non-reversible field identity without retaining the plaintext
    /// secret. `field_domain` is a stable protocol-owned purpose string, not
    /// caller-selected presentation metadata.
    pub fn derive(
        key: &AuthenticationThrottleKey,
        field_domain: &'static [u8],
        secret: &[u8],
    ) -> Self {
        let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
            .expect("HMAC-SHA-256 accepts every key length");
        update_lp(&mut mac, IDEMPOTENCY_REQUEST_DOMAIN);
        update_lp(&mut mac, b"secret-field");
        update_lp(&mut mac, field_domain);
        update_lp(&mut mac, secret);
        Self(mac.finalize().into_bytes().into())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NormalizedAuthBudgetRequest {
    effect: String,
    protocol_version: u32,
    app: String,
    deployment: String,
    profile: AuthBudgetDeploymentProfile,
    provider: String,
    public_fields: BTreeMap<String, Vec<u8>>,
    secret_field_digests: BTreeMap<String, [u8; 32]>,
    principal_domain: Option<[u8; 32]>,
    credential_domain: Option<[u8; 32]>,
    effective_source: Option<String>,
    trust_tier: AuthTrustTier,
    evidence_generation: u64,
    policy_digest: [u8; 32],
    limiter_epoch: Option<u64>,
    rehearsal_authority: Option<[u8; 32]>,
}

#[allow(dead_code)] // Staged seam; rehearsal state remains owned by LLP 0213.
impl NormalizedAuthBudgetRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        effect: impl Into<String>,
        protocol_version: u32,
        app: impl Into<String>,
        deployment: impl Into<String>,
        profile: AuthBudgetDeploymentProfile,
        provider: impl Into<String>,
        trust_tier: DerivedAuthTrustTier,
        evidence_generation: u64,
        policy_digest: [u8; 32],
        limiter_epoch: Option<u64>,
    ) -> Self {
        Self {
            effect: effect.into(),
            protocol_version,
            app: app.into(),
            deployment: deployment.into(),
            profile,
            provider: provider.into(),
            public_fields: BTreeMap::new(),
            secret_field_digests: BTreeMap::new(),
            principal_domain: None,
            credential_domain: None,
            effective_source: None,
            trust_tier: trust_tier.tier(),
            evidence_generation,
            policy_digest,
            limiter_epoch,
            rehearsal_authority: None,
        }
    }

    pub fn insert_public_field(&mut self, name: impl Into<String>, value: &[u8]) {
        self.public_fields.insert(name.into(), value.to_vec());
    }

    pub fn insert_secret_field_digest(
        &mut self,
        name: impl Into<String>,
        digest: AuthBudgetSecretDigest,
    ) {
        self.secret_field_digests.insert(name.into(), digest.0);
    }

    #[allow(dead_code)] // Wired by future principal/credential-aware consumers.
    pub fn set_server_domains(
        &mut self,
        principal_domain: Option<[u8; 32]>,
        credential_domain: Option<[u8; 32]>,
        effective_source: Option<String>,
        rehearsal_authority: Option<[u8; 32]>,
    ) {
        self.principal_domain = principal_domain;
        self.credential_domain = credential_domain;
        self.effective_source = effective_source;
        self.rehearsal_authority = rehearsal_authority;
    }

    fn digest(&self) -> [u8; 32] {
        let mut digest = Sha256::new();
        update_digest_lp(&mut digest, IDEMPOTENCY_REQUEST_DOMAIN);
        update_digest_lp(&mut digest, b"effect");
        update_digest_lp(&mut digest, self.effect.as_bytes());
        update_digest_lp(&mut digest, b"protocol-version");
        update_digest_lp(&mut digest, &self.protocol_version.to_be_bytes());
        update_digest_lp(&mut digest, b"app");
        update_digest_lp(&mut digest, self.app.as_bytes());
        update_digest_lp(&mut digest, b"deployment");
        update_digest_lp(&mut digest, self.deployment.as_bytes());
        update_digest_lp(&mut digest, b"profile");
        update_digest_lp(&mut digest, &[self.profile as u8]);
        update_digest_lp(&mut digest, b"provider");
        update_digest_lp(&mut digest, self.provider.as_bytes());
        update_digest_lp(&mut digest, b"public-fields");
        update_digest_lp(
            &mut digest,
            &(self.public_fields.len() as u64).to_be_bytes(),
        );
        for (name, value) in &self.public_fields {
            update_digest_lp(&mut digest, name.as_bytes());
            update_digest_lp(&mut digest, value);
        }
        update_digest_lp(&mut digest, b"secret-field-digests");
        update_digest_lp(
            &mut digest,
            &(self.secret_field_digests.len() as u64).to_be_bytes(),
        );
        for (name, value) in &self.secret_field_digests {
            update_digest_lp(&mut digest, name.as_bytes());
            update_digest_lp(&mut digest, value);
        }
        update_digest_lp(&mut digest, b"principal-domain");
        update_optional_digest(
            &mut digest,
            self.principal_domain.as_ref().map(<[u8; 32]>::as_slice),
        );
        update_digest_lp(&mut digest, b"credential-domain");
        update_optional_digest(
            &mut digest,
            self.credential_domain.as_ref().map(<[u8; 32]>::as_slice),
        );
        update_digest_lp(&mut digest, b"effective-source");
        update_optional_digest(
            &mut digest,
            self.effective_source.as_deref().map(str::as_bytes),
        );
        update_digest_lp(&mut digest, b"trust-tier");
        update_digest_lp(&mut digest, &[self.trust_tier as u8]);
        update_digest_lp(&mut digest, b"evidence-generation");
        update_digest_lp(&mut digest, &self.evidence_generation.to_be_bytes());
        update_digest_lp(&mut digest, b"policy-digest");
        update_digest_lp(&mut digest, &self.policy_digest);
        update_digest_lp(&mut digest, b"limiter-epoch");
        match self.limiter_epoch {
            Some(epoch) => {
                digest.update([1]);
                update_digest_lp(&mut digest, &epoch.to_be_bytes());
            }
            None => digest.update([0]),
        }
        update_digest_lp(&mut digest, b"rehearsal-authority");
        update_optional_digest(
            &mut digest,
            self.rehearsal_authority.as_ref().map(<[u8; 32]>::as_slice),
        );
        digest.finalize().into()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthBudgetIdempotencyIdentity {
    key_digest: [u8; 32],
    request_digest: [u8; 32],
}

#[allow(dead_code)] // Staged constructor; the throttle already consumes the bound identity type.
impl AuthBudgetIdempotencyIdentity {
    pub fn bind(
        key: &AuthenticationThrottleKey,
        idempotency_key: &str,
        request: &NormalizedAuthBudgetRequest,
    ) -> Result<Self, AuthenticationThrottleError> {
        if idempotency_key.is_empty() || idempotency_key.len() > MAX_VALUE_BYTES {
            return Err(AuthenticationThrottleError::Invalid);
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
            .expect("HMAC-SHA-256 accepts every key length");
        update_lp(&mut mac, IDEMPOTENCY_KEY_DOMAIN);
        update_lp(&mut mac, idempotency_key.as_bytes());
        Ok(Self {
            key_digest: mac.finalize().into_bytes().into(),
            request_digest: request.digest(),
        })
    }
}

#[allow(dead_code)] // Used by the staged normalized-request seam.
fn update_digest_lp(digest: &mut Sha256, bytes: &[u8]) {
    digest.update((bytes.len() as u64).to_be_bytes());
    digest.update(bytes);
}

#[allow(dead_code)] // Used by the staged normalized-request seam.
fn update_optional_digest(digest: &mut Sha256, bytes: Option<&[u8]>) {
    match bytes {
        Some(bytes) => {
            digest.update([1]);
            update_digest_lp(digest, bytes);
        }
        None => digest.update([0]),
    }
}

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
    pub fn validate(&self) -> Result<(), AuthenticationThrottleError> {
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

/// Finite password-effect terms selected exclusively from the verified server
/// profile. Dev/test are intentionally generous enough for lockout and race
/// acceptance suites; production retains bounded debt and key custody.
#[allow(dead_code)] // Consumed by the staged storage adapter and adjacent route lane.
pub fn password_budget_config(
    profile: AuthBudgetDeploymentProfile,
    budget: AuthBudgetName,
) -> SharedAuthenticationThrottleConfig {
    fn policy(interval_ms: u64, burst: u64, debt: u64) -> AuthenticationBucketPolicy {
        AuthenticationBucketPolicy {
            interval_ms,
            burst,
            maximum_denial_debt_attempts: debt,
        }
    }
    let (interval_ms, burst, debt, maximum_key_count) = match profile {
        AuthBudgetDeploymentProfile::Dev | AuthBudgetDeploymentProfile::Test => {
            (1, 100_000, 100_000, 1_000_000)
        }
        AuthBudgetDeploymentProfile::Demo => (10, 10_000, 10_000, 250_000),
        AuthBudgetDeploymentProfile::Prod => match budget {
            AuthBudgetName::HashCpu => (1_000, 4, 32, 1_000_000),
            AuthBudgetName::Guessing => (1_000, 10, 100, 1_000_000),
            AuthBudgetName::Enumeration => (250, 20, 200, 1_000_000),
            AuthBudgetName::SessionMint => (1_000, 10, 100, 1_000_000),
            _ => (1_000, 10, 100, 1_000_000),
        },
    };
    SharedAuthenticationThrottleConfig {
        retention_ms: 24 * 60 * 60 * 1_000,
        maximum_key_count,
        global: policy(interval_ms, burst, debt),
        source: policy(interval_ms, burst, debt),
        subject: policy(interval_ms, burst, debt),
        source_subject: policy(interval_ms, burst, debt),
        family: policy(interval_ms, burst, debt),
    }
}

pub struct AuthenticationThrottleKey(Zeroizing<[u8; 32]>);

impl AuthenticationThrottleKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
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
    pub fn derive_sender_cover_key(&self) -> [u8; 32] {
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
pub struct AuthenticationThrottleDimensions {
    pub budget_name: AuthBudgetName,
    pub deployment_id: String,
    pub effective_source: String,
    pub subject: Option<String>,
    pub family: Option<String>,
}

impl AuthenticationThrottleDimensions {
    pub fn for_ip(
        deployment_id: impl Into<String>,
        source: IpAddr,
        subject: Option<String>,
        family: Option<String>,
    ) -> Self {
        Self::for_named_budget(
            AuthBudgetName::Enumeration,
            deployment_id,
            source,
            subject,
            family,
        )
    }

    pub fn for_named_budget(
        budget_name: AuthBudgetName,
        deployment_id: impl Into<String>,
        source: IpAddr,
        subject: Option<String>,
        family: Option<String>,
    ) -> Self {
        Self {
            budget_name,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticationThrottleDecision {
    pub admitted: bool,
    pub retry_after_ms: u64,
    pub budget_name: AuthBudgetName,
    pub refusal: Option<AuthBudgetRefusal>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthenticationThrottleError {
    Capacity,
    IdempotencyConflict,
    Invalid,
    Unavailable,
}

#[allow(dead_code)] // Hosted compatibility presentation still uses its legacy unavailable alias.
impl AuthenticationThrottleError {
    pub const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::Capacity | Self::Unavailable => "SNAPBACK_AUTH_BUDGET_AUTHORITY_UNAVAILABLE",
            Self::IdempotencyConflict => "SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT",
            Self::Invalid => "SNAPBACK_AUTH_BUDGET_POLICY_INVALID",
        }
    }

    pub fn into_snapback_error(self) -> crate::diagnostic::SnapbackError {
        let message = match self {
            Self::Capacity => "authentication budget authority capacity is unavailable",
            Self::IdempotencyConflict => {
                "authentication idempotency key was reused for a different request"
            }
            Self::Invalid => "authentication budget policy is invalid",
            Self::Unavailable => "authentication budget authority is unavailable",
        };
        crate::diagnostic::SnapbackError::error(self.diagnostic_code(), "auth", message)
    }
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

fn idempotency_retention_ms(
    config: &SharedAuthenticationThrottleConfig,
) -> Result<u64, AuthenticationThrottleError> {
    [
        config.global,
        config.source,
        config.subject,
        config.source_subject,
        config.family,
    ]
    .into_iter()
    .try_fold(config.retention_ms, |retention, policy| {
        policy
            .burst
            .checked_add(policy.maximum_denial_debt_attempts)
            .and_then(|attempts| attempts.checked_mul(policy.interval_ms))
            .map(|horizon| retention.max(horizon))
            .ok_or(AuthenticationThrottleError::Invalid)
    })
}

pub fn initialize_shared_authentication_throttle(
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
                ON {TABLE}(limiter_epoch, last_used_ms, theoretical_arrival_ms);
            CREATE TABLE IF NOT EXISTS {IDEMPOTENCY_TABLE} (
                limiter_epoch INTEGER NOT NULL CHECK(limiter_epoch > 0),
                idempotency_key BLOB NOT NULL CHECK(length(idempotency_key) = 32),
                request_digest BLOB NOT NULL CHECK(length(request_digest) = 32),
                budget_name TEXT NOT NULL CHECK(length(budget_name) > 0),
                admitted INTEGER NOT NULL CHECK(admitted IN (0, 1)),
                retry_deadline_ms INTEGER NOT NULL CHECK(retry_deadline_ms >= 0),
                correlation_id TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
                PRIMARY KEY (limiter_epoch, idempotency_key)
            ) STRICT;"
        ))
        .map_err(|_| AuthenticationThrottleError::Unavailable)
}

/// @ref LLP 0060#d3-shared-authentication-throttling — one serialized
/// transaction advances the complete applicable key set even on denial.
pub fn charge_shared_authentication_attempt(
    connection: &mut Connection,
    limiter_epoch: u64,
    key: &AuthenticationThrottleKey,
    config: &SharedAuthenticationThrottleConfig,
    dimensions: &AuthenticationThrottleDimensions,
    now_ms: u64,
) -> Result<AuthenticationThrottleDecision, AuthenticationThrottleError> {
    charge_shared_authentication_attempt_idempotent(
        connection,
        limiter_epoch,
        key,
        config,
        dimensions,
        now_ms,
        None,
    )
}

/// Bind the attempt charge to the complete normalized request when the owning
/// effect supplies an idempotency identity. Exact retries replay one decision;
/// same-key/different-request calls still advance every attempt bucket before
/// returning the typed conflict.
///
/// @ref LLP 0215#6-idempotency-and-retry-identity — exact retransmission is
/// not double-charged and a changed guess cannot become a free attempt.
#[allow(clippy::too_many_arguments)]
pub fn charge_shared_authentication_attempt_idempotent(
    connection: &mut Connection,
    limiter_epoch: u64,
    key: &AuthenticationThrottleKey,
    config: &SharedAuthenticationThrottleConfig,
    dimensions: &AuthenticationThrottleDimensions,
    now_ms: u64,
    idempotency: Option<&AuthBudgetIdempotencyIdentity>,
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
            &format!("DELETE FROM {IDEMPOTENCY_TABLE} WHERE limiter_epoch <> ?1"),
            params![epoch],
        )
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    let idempotency_lower = now_ms.saturating_sub(idempotency_retention_ms(config)?) as i64;
    transaction
        .execute(
            &format!(
                "DELETE FROM {IDEMPOTENCY_TABLE}
                 WHERE limiter_epoch = ?1 AND created_at_ms < ?2"
            ),
            params![epoch, idempotency_lower],
        )
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    let mut idempotency_conflict = false;
    let mut idempotency_is_new = idempotency.is_some();
    if let Some(idempotency) = idempotency {
        let existing = transaction
            .query_row(
                &format!(
                    "SELECT request_digest, budget_name, admitted,
                            retry_deadline_ms, correlation_id
                     FROM {IDEMPOTENCY_TABLE}
                     WHERE limiter_epoch = ?1 AND idempotency_key = ?2"
                ),
                params![epoch, idempotency.key_digest.as_slice()],
                |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, bool>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| AuthenticationThrottleError::Unavailable)?;
        if let Some((request_digest, budget_name, admitted, retry_deadline, correlation_id)) =
            existing
        {
            idempotency_is_new = false;
            let stored_budget = AuthBudgetName::parse(&budget_name)
                .ok_or(AuthenticationThrottleError::Unavailable)?;
            if request_digest.as_slice() == idempotency.request_digest
                && stored_budget == dimensions.budget_name
            {
                let retry_deadline = u64::try_from(retry_deadline)
                    .map_err(|_| AuthenticationThrottleError::Unavailable)?;
                let refusal = (!admitted).then(|| {
                    AuthBudgetRefusal::rate_at(stored_budget, retry_deadline, correlation_id)
                });
                return Ok(AuthenticationThrottleDecision {
                    admitted,
                    retry_after_ms: if admitted {
                        0
                    } else {
                        retry_deadline.saturating_sub(now_ms).max(1)
                    },
                    budget_name: stored_budget,
                    refusal,
                });
            }
            idempotency_conflict = true;
        }
    }
    if idempotency_is_new {
        let records: i64 = transaction
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM {IDEMPOTENCY_TABLE}
                     WHERE limiter_epoch = ?1"
                ),
                params![epoch],
                |row| row.get(0),
            )
            .map_err(|_| AuthenticationThrottleError::Unavailable)?;
        if records < 0 || records as u64 >= config.maximum_key_count {
            return Err(AuthenticationThrottleError::Capacity);
        }
    }
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
    let retry_after_ms = if admitted {
        0
    } else {
        retry_deadline.saturating_sub(now_ms).max(1)
    };
    let refusal = (!admitted).then(|| {
        AuthBudgetRefusal::rate_at(
            dimensions.budget_name,
            retry_deadline,
            uuid::Uuid::now_v7().to_string(),
        )
    });
    if let Some(idempotency) = idempotency
        && !idempotency_conflict
    {
        transaction
            .execute(
                &format!(
                    "INSERT INTO {IDEMPOTENCY_TABLE}(
                       limiter_epoch, idempotency_key, request_digest,
                       budget_name, admitted, retry_deadline_ms,
                       correlation_id, created_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
                ),
                params![
                    epoch,
                    idempotency.key_digest.as_slice(),
                    idempotency.request_digest.as_slice(),
                    dimensions.budget_name.as_str(),
                    admitted,
                    retry_deadline as i64,
                    refusal
                        .as_ref()
                        .map(|refusal| refusal.details.correlation_id.as_str())
                        .unwrap_or(""),
                    now,
                ],
            )
            .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    }
    transaction
        .commit()
        .map_err(|_| AuthenticationThrottleError::Unavailable)?;
    if idempotency_conflict {
        return Err(AuthenticationThrottleError::IdempotencyConflict);
    }
    Ok(AuthenticationThrottleDecision {
        admitted,
        retry_after_ms,
        budget_name: dimensions.budget_name,
        refusal,
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

    fn normalized_request(
        key: &AuthenticationThrottleKey,
        secret: &[u8],
    ) -> NormalizedAuthBudgetRequest {
        let tier = derive_auth_trust_tier(ServerVerifiedAuthTrustEvidence::Anonymous);
        let policy =
            ResolvedCompatibilityAuthBudgetPolicy::resolve(AuthBudgetDeploymentProfile::Prod, tier);
        let mut request = NormalizedAuthBudgetRequest::new(
            "auth.challenge.exchange",
            1,
            "app-1",
            "deployment-secret-name",
            AuthBudgetDeploymentProfile::Prod,
            "email-code",
            tier,
            9,
            policy.digest(),
            Some(11),
        );
        request.insert_public_field("challenge-shape", b"verification-code");
        request.insert_secret_field_digest(
            "submitted-code",
            AuthBudgetSecretDigest::derive(key, b"auth.challenge-code.v1", secret),
        );
        request.set_server_domains(
            None,
            Some([4; 32]),
            Some("v6:2001:0db8:0001:0002::/64".to_owned()),
            None,
        );
        request
    }

    #[test]
    fn compatibility_budget_vocabulary_pins_names_harms_axes_classes_and_timing() {
        let canonical_names = [
            AuthBudgetName::Guessing,
            AuthBudgetName::Enumeration,
            AuthBudgetName::Delivery,
            AuthBudgetName::ChallengeAllocation,
            AuthBudgetName::HashCpu,
            AuthBudgetName::SessionMint,
            AuthBudgetName::OauthTransaction,
            AuthBudgetName::OauthCallback,
        ];
        assert_eq!(
            canonical_names.map(|name| serde_json::to_value(name).unwrap()),
            [
                serde_json::json!("auth.guessing"),
                serde_json::json!("auth.enumeration"),
                serde_json::json!("auth.delivery"),
                serde_json::json!("auth.challenge-allocation"),
                serde_json::json!("auth.hash-cpu"),
                serde_json::json!("auth.session-mint"),
                serde_json::json!("auth.oauth-transaction"),
                serde_json::json!("auth.oauth-callback"),
            ]
        );
        assert_eq!(AUTH_COMPATIBILITY_BUDGETS.len(), 6);

        assert_eq!(AUTH_DELIVERY_BUDGET.name, AuthBudgetName::Delivery);
        assert_eq!(AUTH_DELIVERY_BUDGET.harms, &[AuthBudgetHarm::DeliveryCost]);
        assert_eq!(
            AUTH_DELIVERY_BUDGET.counter_class,
            AuthBudgetCounterClass::SuccessfulEffect
        );
        assert_eq!(AUTH_DELIVERY_BUDGET.rules, DELIVERY_RULES);
        assert_eq!(
            DELIVERY_RULES[0].charge_timing,
            AuthBudgetChargeTiming::ChallengeTransactionCommit
        );
        assert_eq!(DELIVERY_RULES[0].axes, DELIVERY_RECIPIENT_AXES);

        assert_eq!(
            AUTH_CHALLENGE_ALLOCATION_BUDGET.name,
            AuthBudgetName::ChallengeAllocation
        );
        assert_eq!(
            AUTH_CHALLENGE_ALLOCATION_BUDGET.harms,
            &[AuthBudgetHarm::ChallengeStateAllocation]
        );
        assert_eq!(
            AUTH_CHALLENGE_ALLOCATION_BUDGET.counter_class,
            AuthBudgetCounterClass::SuccessfulEffect
        );
        assert_eq!(
            CHALLENGE_ALLOCATION_RULES[0].charge_timing,
            AuthBudgetChargeTiming::ChallengeTransactionCommit
        );
        assert_eq!(
            CHALLENGE_ALLOCATION_RULES[1].charge_timing,
            AuthBudgetChargeTiming::MailboxReservation
        );

        assert_eq!(AUTH_GUESSING_BUDGET.name, AuthBudgetName::Guessing);
        assert_eq!(AUTH_GUESSING_BUDGET.harms, &[AuthBudgetHarm::Guessing]);
        assert_eq!(
            AUTH_GUESSING_BUDGET.counter_class,
            AuthBudgetCounterClass::Attempt
        );
        assert_eq!(
            GUESSING_RULES[0].charge_timing,
            AuthBudgetChargeTiming::ObservationBoundary
        );
        assert_eq!(
            GUESSING_RULES[1].charge_timing,
            AuthBudgetChargeTiming::KdfAdmission
        );
        assert_eq!(
            AUTH_ENUMERATION_BUDGET.effects,
            &["auth.password.signup", "auth.password.signin"]
        );
        assert_eq!(ENUMERATION_RULES[0].missing_axis, MissingAxisPolicy::Refuse);
        assert_eq!(
            HASH_CPU_RULES[0].charge_timing,
            AuthBudgetChargeTiming::KdfAdmission
        );
        assert_eq!(
            SESSION_MINT_RULES[0].charge_timing,
            AuthBudgetChargeTiming::SessionTransactionCommit
        );
        assert!(
            AUTH_COMPATIBILITY_BUDGETS
                .iter()
                .all(|budget| budget.public_non_enumerating && !budget.effects.is_empty())
        );
    }

    #[test]
    fn password_effect_bindings_and_every_profile_term_are_finite() {
        assert_eq!(PasswordAuthEffect::Signup.as_str(), "auth.password.signup");
        assert_eq!(
            PasswordAuthEffect::Signup.budgets(),
            &[
                AuthBudgetName::Enumeration,
                AuthBudgetName::HashCpu,
                AuthBudgetName::SessionMint,
            ]
        );
        assert_eq!(PasswordAuthEffect::Signin.as_str(), "auth.password.signin");
        assert_eq!(
            PasswordAuthEffect::Signin.budgets(),
            &[
                AuthBudgetName::Guessing,
                AuthBudgetName::Enumeration,
                AuthBudgetName::HashCpu,
                AuthBudgetName::SessionMint,
            ]
        );
        for profile in [
            AuthBudgetDeploymentProfile::Dev,
            AuthBudgetDeploymentProfile::Test,
            AuthBudgetDeploymentProfile::Demo,
            AuthBudgetDeploymentProfile::Prod,
        ] {
            for budget in PasswordAuthEffect::Signin.budgets() {
                let terms = password_budget_config(profile, *budget);
                terms.validate().expect("finite password budget terms");
                assert!(terms.retention_ms > 0);
                assert!(terms.maximum_key_count < i64::MAX as u64);
            }
        }
        for profile in [
            AuthBudgetDeploymentProfile::Dev,
            AuthBudgetDeploymentProfile::Test,
        ] {
            let terms = password_budget_config(profile, AuthBudgetName::Guessing);
            assert!(
                terms.source_subject.burst >= 10,
                "acceptance profiles must reach the declared lock boundary"
            );
        }
    }

    #[test]
    fn default_parity_and_overlay_precedence_hold_for_every_server_derived_tier() {
        assert_eq!(
            AUTH_DELIVERY_RECIPIENT_TERMS,
            RollingWindowBudgetTerms {
                limit: 5,
                window_ms: 10 * 60 * 1_000,
            }
        );
        assert_eq!(
            AUTH_CHALLENGE_GLOBAL_TERMS,
            RollingWindowBudgetTerms {
                limit: 120,
                window_ms: 60 * 1_000,
            }
        );
        assert_eq!(
            AUTH_GUESSING_CHALLENGE_TERMS,
            FixedTotalBudgetTerms { limit: 5 }
        );
        assert_eq!(
            AUTH_CAPTURE_MAILBOX_TERMS,
            OccupancyBudgetTerms { limit: 1_024 }
        );
        let profiles = [
            AuthBudgetDeploymentProfile::Dev,
            AuthBudgetDeploymentProfile::Test,
            AuthBudgetDeploymentProfile::Demo,
            AuthBudgetDeploymentProfile::Prod,
        ];
        let evidence = [
            ServerVerifiedAuthTrustEvidence::Anonymous,
            ServerVerifiedAuthTrustEvidence::VerifiedContact,
            ServerVerifiedAuthTrustEvidence::EstablishedSession,
            ServerVerifiedAuthTrustEvidence::SenderBound,
            ServerVerifiedAuthTrustEvidence::ScopedAgent,
            ServerVerifiedAuthTrustEvidence::RehearsalAuthority,
        ];
        let expected_tiers = [
            AuthTrustTier::Anonymous,
            AuthTrustTier::VerifiedContact,
            AuthTrustTier::EstablishedSession,
            AuthTrustTier::SenderBound,
            AuthTrustTier::ScopedAgent,
            AuthTrustTier::RehearsalAuthority,
        ];

        for profile in profiles {
            for (evidence, expected_tier) in evidence.into_iter().zip(expected_tiers) {
                let policy = ResolvedCompatibilityAuthBudgetPolicy::resolve(
                    profile,
                    derive_auth_trust_tier(evidence),
                );
                assert_eq!(policy.profile(), profile);
                assert_eq!(policy.trust_tier(), expected_tier);
                assert_eq!(policy.global(), AUTH_CHALLENGE_GLOBAL_TERMS);
                assert_eq!(policy.challenge_attempts(), AUTH_GUESSING_CHALLENGE_TERMS);
                assert_eq!(policy.mailbox(), AUTH_CAPTURE_MAILBOX_TERMS);
                assert!(policy.global().limit > 0 && policy.global().window_ms > 0);
                assert!(policy.challenge_attempts().limit > 0);
                assert!(policy.mailbox().limit > 0);
                match profile {
                    AuthBudgetDeploymentProfile::Dev | AuthBudgetDeploymentProfile::Demo => {
                        assert_eq!(
                            policy.recipient(),
                            RecipientRuleDisposition::OmittedByDeclaration {
                                covered_by_budget: AuthBudgetName::ChallengeAllocation,
                                covered_by_rule: "request-code-app-deployment",
                            }
                        );
                    }
                    AuthBudgetDeploymentProfile::Test | AuthBudgetDeploymentProfile::Prod => {
                        assert_eq!(
                            policy.recipient(),
                            RecipientRuleDisposition::Applied(AUTH_DELIVERY_RECIPIENT_TERMS)
                        );
                    }
                }
            }
        }
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
        assert_eq!(denied.budget_name, AuthBudgetName::Enumeration);
        let refusal = denied.refusal.as_ref().expect("typed refusal");
        assert_eq!(refusal.canonical_code(), "SNAPBACK_AUTH_RATE_BUDGET");
        assert_eq!(refusal.details.budget_name, AuthBudgetName::Enumeration);
        assert!(matches!(
            refusal.details.retry_after,
            AuthBudgetRetryAfter::At { epoch_ms: 12_000 }
        ));
        let refusal_json = serde_json::to_value(&refusal.details).unwrap();
        assert_eq!(refusal_json["budgetName"], "auth.enumeration");
        assert_eq!(refusal_json["retryAfter"]["kind"], "at");
        assert_eq!(refusal_json["retryAfter"]["epochMs"], 12_000);
        assert!(refusal_json["retryAfter"].get("epoch_ms").is_none());
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
    fn exact_idempotent_retries_replay_and_changed_secret_requests_charge_then_conflict() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize_shared_authentication_throttle(&db).unwrap();
        let key = AuthenticationThrottleKey::from_bytes([10; 32]);
        let request = normalized_request(&key, b"111111");
        let first_identity =
            AuthBudgetIdempotencyIdentity::bind(&key, "first-request", &request).unwrap();
        let denied_identity =
            AuthBudgetIdempotencyIdentity::bind(&key, "denied-request", &request).unwrap();
        let global_tat = |db: &Connection| {
            db.query_row(
                &format!(
                    "SELECT theoretical_arrival_ms FROM {TABLE}
                     WHERE limiter_epoch = 11 AND bucket_kind = 1"
                ),
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
        };

        let first = charge_shared_authentication_attempt_idempotent(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_000,
            Some(&first_identity),
        )
        .unwrap();
        assert!(first.admitted);
        let after_first = global_tat(&db);

        let exact_success = charge_shared_authentication_attempt_idempotent(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_001,
            Some(&first_identity),
        )
        .unwrap();
        assert!(exact_success.admitted);
        assert_eq!(global_tat(&db), after_first, "success replay is free");

        let denied = charge_shared_authentication_attempt_idempotent(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_001,
            Some(&denied_identity),
        )
        .unwrap();
        assert!(!denied.admitted);
        let denial_refusal = denied.refusal.clone().expect("denial refusal");
        let after_denial = global_tat(&db);
        assert!(after_denial > after_first, "denial charges the attempt");

        let exact_denial = charge_shared_authentication_attempt_idempotent(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_500,
            Some(&denied_identity),
        )
        .unwrap();
        assert!(!exact_denial.admitted);
        assert_eq!(exact_denial.refusal, Some(denial_refusal));
        assert_eq!(global_tat(&db), after_denial, "refusal replay is free");

        let changed_request = normalized_request(&key, b"222222");
        let changed_identity =
            AuthBudgetIdempotencyIdentity::bind(&key, "denied-request", &changed_request).unwrap();
        let conflict = charge_shared_authentication_attempt_idempotent(
            &mut db,
            11,
            &key,
            &config(),
            &dimensions(),
            10_500,
            Some(&changed_identity),
        )
        .unwrap_err();
        assert_eq!(conflict, AuthenticationThrottleError::IdempotencyConflict);
        assert_eq!(
            conflict.into_snapback_error().diagnostic.code,
            "SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT"
        );
        assert!(
            global_tat(&db) > after_denial,
            "a changed guess receives its own attempt accounting"
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
