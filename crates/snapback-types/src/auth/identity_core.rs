//! Catalog-v3 identity-core values shared by storage and handler projection.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssuranceKind {
    Authenticated,
    EmailVerified,
    PhoneVerified,
    RecentAuth,
    PhishingResistant,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssuranceProvenance {
    Session,
    Credential,
    Delivery,
    Federation,
    Import,
    Rehearsal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeploymentPosture {
    Production,
    Dev,
    Test,
    Demo,
}

impl DeploymentPosture {
    pub fn from_server_profile(profile: crate::contract_types::ServerProfile) -> Self {
        match profile {
            crate::contract_types::ServerProfile::Dev => Self::Dev,
            crate::contract_types::ServerProfile::Test => Self::Test,
            crate::contract_types::ServerProfile::Demo => Self::Demo,
            crate::contract_types::ServerProfile::Prod => Self::Production,
        }
    }
}

/// @ref LLP 0214#41-exact-record — kind states what was established while
/// provenance states how; the two dimensions remain independently auditable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssuranceRecord {
    pub kind: AssuranceKind,
    pub provenance: AssuranceProvenance,
    pub issued_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub governing_authority: Option<String>,
}

impl AssuranceRecord {
    /// Apply the posture-independent timestamp/governor-shape rules and the
    /// deployment-posture rule before an assurance can reach a handler.
    /// Durable governing-authority liveness is resolved by storage after this
    /// value-level admission succeeds.
    ///
    /// @ref LLP 0214#43-provenance-independent-checks — future issuance,
    /// expiry, governing-authority shape, and posture all fail closed.
    pub fn admit(&self, posture: DeploymentPosture, now_ms: u64) -> SnapbackResult<()> {
        let governed = matches!(
            self.provenance,
            AssuranceProvenance::Delivery
                | AssuranceProvenance::Federation
                | AssuranceProvenance::Import
                | AssuranceProvenance::Rehearsal
        );
        if self.issued_at > now_ms
            || self.expires_at.is_some_and(|expiry| now_ms >= expiry)
            || (governed
                && self
                    .governing_authority
                    .as_deref()
                    .is_none_or(str::is_empty))
            || (self.provenance == AssuranceProvenance::Rehearsal
                && posture == DeploymentPosture::Production)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_ASSURANCE_INADMISSIBLE",
                "auth",
                "assurance is not admissible for this deployment posture",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimsIdentity {
    pub kind: String,
    pub provider_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthClaimsProjection {
    pub identities: Vec<ClaimsIdentity>,
    pub assurances: Vec<AssuranceRecord>,
}

impl AuthClaimsProjection {
    pub fn server_derived(
        mut identities: Vec<ClaimsIdentity>,
        mut assurances: Vec<AssuranceRecord>,
    ) -> Self {
        identities.sort();
        assurances.sort_by_key(|record| {
            (
                record.kind,
                record.provenance,
                record.issued_at,
                record.expires_at,
            )
        });
        Self {
            identities,
            assurances,
        }
    }

    // @ref LLP 0214#59-relationship-to-the-guide-binding-gap — ordinary handler
    // writes never acquire verified-provisioning authority merely by holding
    // a claims projection.
    // @ref LLP 0226#b-authd7-owner--principal-claims — claims may eventually
    // seed a declared binding row only through the still-open sealed host
    // writer; today they authorize no binding write at all.
    pub fn refuse_binding_write() -> SnapbackError {
        SnapbackError::error(
            "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN",
            "auth",
            "ordinary writes to a declared identity-binding table are forbidden",
        )
    }
}

pub struct PasswordSecret(Zeroizing<String>);
impl PasswordSecret {
    // Public password request DTOs in the route lane construct this carrier.
    #[allow(dead_code)]
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }
    pub fn expose_secret(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for PasswordSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PasswordSecret([REDACTED])")
    }
}

// The client/route response lane consumes the one-time recovery-code payload;
// storage already needs to construct and preserve its zeroizing carrier.
#[allow(dead_code)]
pub struct RecoveryCodes(Zeroizing<Vec<String>>);
impl RecoveryCodes {
    pub fn new(values: Vec<String>) -> Self {
        Self(Zeroizing::new(values))
    }
    #[allow(dead_code)]
    pub fn expose_once(&self) -> &[String] {
        &self.0
    }
}
impl fmt::Debug for RecoveryCodes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RecoveryCodes([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assurance_kind_and_provenance_remain_separate_and_posture_scoped() {
        let imported = AssuranceRecord {
            kind: AssuranceKind::EmailVerified,
            provenance: AssuranceProvenance::Import,
            issued_at: 1,
            expires_at: None,
            governing_authority: Some("migration-1".into()),
        };
        assert!(imported.admit(DeploymentPosture::Production, 2).is_ok());
        let rehearsal = AssuranceRecord {
            provenance: AssuranceProvenance::Rehearsal,
            governing_authority: Some("rehearsal-1".into()),
            ..imported
        };
        assert_eq!(
            rehearsal
                .admit(DeploymentPosture::Production, 2)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_ASSURANCE_INADMISSIBLE"
        );
        assert!(rehearsal.admit(DeploymentPosture::Test, 2).is_ok());
    }

    #[test]
    fn secrets_and_claim_binding_are_redacted_and_fail_closed() {
        assert_eq!(
            format!("{:?}", PasswordSecret::new("never-print".into())),
            "PasswordSecret([REDACTED])"
        );
        assert_eq!(
            format!("{:?}", RecoveryCodes::new(vec!["never-print".into()])),
            "RecoveryCodes([REDACTED])"
        );
        assert_eq!(
            AuthClaimsProjection::refuse_binding_write().diagnostic.code,
            "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN"
        );
    }
}
