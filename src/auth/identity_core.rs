//! Catalog-v3 identity-core values shared by storage and handler projection.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AssuranceKind {
    Authenticated,
    EmailVerified,
    PhoneVerified,
    RecentAuth,
    PhishingResistant,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AssuranceProvenance {
    Session,
    Credential,
    Delivery,
    Federation,
    Import,
    Rehearsal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DeploymentPosture {
    Production,
    Dev,
    Test,
    Demo,
}

/// @ref LLP 0214#41-exact-record — kind states what was established while
/// provenance states how; the two dimensions remain independently auditable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AssuranceRecord {
    pub kind: AssuranceKind,
    pub provenance: AssuranceProvenance,
    pub issued_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub governing_authority: Option<String>,
}

impl AssuranceRecord {
    pub(crate) fn admit(&self, posture: DeploymentPosture, now_ms: u64) -> SnapbackResult<()> {
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
pub(crate) struct ClaimsIdentity {
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
pub(crate) struct AuthClaimsProjection {
    pub identities: Vec<ClaimsIdentity>,
    pub assurances: Vec<AssuranceRecord>,
}

impl AuthClaimsProjection {
    pub(crate) fn server_derived(
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

    pub(crate) fn refuse_binding_write(&self) -> SnapbackError {
        SnapbackError::error(
            "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN",
            "auth",
            "identity binding requires sealed verified-provisioning authority",
        )
    }
}

pub(crate) struct PasswordSecret(Zeroizing<String>);
impl PasswordSecret {
    pub(crate) fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }
    pub(crate) fn expose_secret(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for PasswordSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PasswordSecret([REDACTED])")
    }
}

pub(crate) struct RecoveryCodes(Zeroizing<Vec<String>>);
impl RecoveryCodes {
    pub(crate) fn new(values: Vec<String>) -> Self {
        Self(Zeroizing::new(values))
    }
    pub(crate) fn expose_once(&self) -> &[String] {
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
        let claims = AuthClaimsProjection::server_derived(vec![], vec![]);
        assert_eq!(
            claims.refuse_binding_write().diagnostic.code,
            "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN"
        );
    }
}
