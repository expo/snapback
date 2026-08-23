//! Storage-owned hosted authentication throttle composition.

use std::net::IpAddr;

use super::LocalDatabase;
use crate::auth::crypto::{CanonicalAddress, SessionBearer};
use crate::auth::deployment::HostedAuthenticationThrottle;
use crate::auth::sender_proof::sender_constraint_for_presented_token;
use crate::auth::throttle::{
    AuthBudgetDeploymentProfile, AuthBudgetIdempotencyIdentity, AuthBudgetName,
    AuthenticationThrottleDecision, AuthenticationThrottleDimensions, AuthenticationThrottleError,
    LocalAuthenticationAttempt, RollingWindowBudgetTerms, charge_local_authentication_attempts,
    charge_shared_authentication_attempt, charge_shared_authentication_attempt_idempotent,
    initialize_shared_authentication_throttle, password_budget_config,
};

impl LocalDatabase {
    pub fn charge_declared_authentication_attempts(
        &mut self,
        deployment_id: &str,
        attempts: &[(AuthBudgetName, RollingWindowBudgetTerms)],
        source: Option<IpAddr>,
        canonical_identifier: Option<&CanonicalAddress>,
        now_ms: u64,
    ) -> crate::diagnostic::SnapbackResult<AuthenticationThrottleDecision> {
        // Local attempt budgets deliberately omit the source axis. Hosted
        // callers must provide the trusted effective source and receive a
        // distinct domain, so neither target silently invents the other's
        // accounting dimensions.
        let identifier = canonical_identifier
            .map(CanonicalAddress::as_str)
            .unwrap_or("<invalid-password-identifier>");
        // @ref LLP 0215#32-charge-axes — enumeration admits recipient while
        // hash-CPU intentionally does not. Keeping one recipient-bearing axis
        // for both lets a source rotate addresses into fresh KDF buckets.
        let enumeration_axis = match source {
            Some(source) => {
                format!("hosted\nenumeration\n{deployment_id}\n{source}\n{identifier}")
            }
            None => format!("local\nenumeration\n{deployment_id}\n{identifier}"),
        };
        let hash_cpu_axis = match source {
            Some(source) => format!("hosted\nhash-cpu\n{deployment_id}\n{source}"),
            None => format!("local\nhash-cpu\n{deployment_id}"),
        };
        let attempts = attempts
            .iter()
            .map(|(name, terms)| LocalAuthenticationAttempt {
                name: *name,
                terms: *terms,
                axis_identity: match name {
                    AuthBudgetName::Enumeration => enumeration_axis.as_bytes(),
                    AuthBudgetName::HashCpu => hash_cpu_axis.as_bytes(),
                    _ => &[],
                },
            })
            .collect::<Vec<_>>();
        charge_local_authentication_attempts(&mut self.conn, now_ms, &attempts)
    }

    /// @ref LLP 0285#8-open-risks — hosted DDL cannot be inherited through
    /// `ServingDatabase`'s `Deref`.
    pub(crate) fn initialize_authentication_throttle_after_hosted_preflight(
        &self,
    ) -> Result<(), AuthenticationThrottleError> {
        initialize_shared_authentication_throttle(&self.conn)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn make_authentication_throttle_unavailable_for_test(
        &self,
    ) -> Result<(), rusqlite::Error> {
        self.conn
            .execute_batch("DROP TABLE _snapback_auth_throttle;")
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn authentication_attempt_charge_counts_for_test(
        &self,
    ) -> Result<Vec<(String, String, i64)>, rusqlite::Error> {
        let mut statement = self.conn.prepare(
            "SELECT budget_name,hex(axis_digest),COUNT(*)
               FROM _snapback_auth_attempt_charges
              GROUP BY budget_name,axis_digest
              ORDER BY budget_name,axis_digest",
        )?;
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn password_identity_subject_count_for_test(
        &self,
        subject: &str,
    ) -> Result<i64, rusqlite::Error> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM _auth_identities
              WHERE provider='local-password' AND subject=?1",
            [subject],
            |row| row.get(0),
        )
    }

    /// Charge global/source and, when the bounded pre-proof family lookup
    /// resolves, the family bucket before proof verification.
    #[allow(clippy::too_many_arguments)]
    pub fn charge_sender_authentication_attempt(
        &mut self,
        throttle: &HostedAuthenticationThrottle,
        source: IpAddr,
        subject: Option<String>,
        access_token: Option<&str>,
        bound_family: Option<&str>,
        allow_superseded_grace: bool,
        now_ms: u64,
    ) -> Result<AuthenticationThrottleDecision, AuthenticationThrottleError> {
        let family = match bound_family {
            Some(family) => Some(family.to_owned()),
            None => SessionBearer::parse_any_version(access_token.unwrap_or_default())
                .ok()
                .and_then(|bearer| {
                    sender_constraint_for_presented_token(
                        &self.conn,
                        bearer.token_hash().as_bytes(),
                        now_ms,
                        allow_superseded_grace,
                    )
                    .ok()
                    .flatten()
                }),
        };
        let dimensions = AuthenticationThrottleDimensions::for_ip(
            throttle.deployment_id.clone(),
            source,
            subject,
            family,
        );
        charge_shared_authentication_attempt(
            &mut self.conn,
            throttle.limiter_epoch,
            throttle.key.as_ref(),
            &throttle.config,
            &dimensions,
            now_ms,
        )
    }

    /// Named password-effect adapter over the one shared authentication
    /// throttle. `_auth_password_attempts` never enters this accounting path.
    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)] // Adjacent password route lane supplies request axes.
    pub fn charge_password_authentication_attempt(
        &mut self,
        throttle: &HostedAuthenticationThrottle,
        profile: AuthBudgetDeploymentProfile,
        budget_name: AuthBudgetName,
        source: IpAddr,
        canonical_identifier: String,
        now_ms: u64,
        idempotency: Option<&AuthBudgetIdempotencyIdentity>,
    ) -> Result<AuthenticationThrottleDecision, AuthenticationThrottleError> {
        if !matches!(
            budget_name,
            AuthBudgetName::Guessing
                | AuthBudgetName::Enumeration
                | AuthBudgetName::HashCpu
                | AuthBudgetName::SessionMint
        ) {
            return Err(AuthenticationThrottleError::Invalid);
        }
        let dimensions = AuthenticationThrottleDimensions::for_named_budget(
            budget_name,
            throttle.deployment_id.clone(),
            source,
            Some(canonical_identifier),
            None,
        );
        let config = password_budget_config(profile, budget_name);
        charge_shared_authentication_attempt_idempotent(
            &mut self.conn,
            throttle.limiter_epoch,
            throttle.key.as_ref(),
            &config,
            &dimensions,
            now_ms,
            idempotency,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::throttle::{AuthenticationThrottleKey, PasswordAuthEffect};
    use std::sync::Arc;

    #[test]
    fn declared_password_attempts_share_nfc_identity_and_separate_target_axes() {
        let mut database = LocalDatabase::memory().expect("database");
        let attempts = [
            (
                AuthBudgetName::Enumeration,
                RollingWindowBudgetTerms {
                    limit: 1,
                    window_ms: 1_000,
                },
            ),
            (
                AuthBudgetName::HashCpu,
                RollingWindowBudgetTerms {
                    limit: 1,
                    window_ms: 1_000,
                },
            ),
        ];
        let decomposed = CanonicalAddress::parse("cafe\u{301}@example.com").unwrap();
        let composed = CanonicalAddress::parse("caf\u{e9}@example.com").unwrap();
        assert_eq!(decomposed, composed);
        assert!(
            database
                .charge_declared_authentication_attempts(
                    "deployment-v1",
                    &attempts,
                    None,
                    Some(&decomposed),
                    100,
                )
                .unwrap()
                .admitted
        );
        assert!(
            !database
                .charge_declared_authentication_attempts(
                    "deployment-v1",
                    &attempts,
                    None,
                    Some(&composed),
                    101,
                )
                .unwrap()
                .admitted,
            "NFC-equivalent identifiers must hit one local bucket"
        );
        assert!(
            database
                .charge_declared_authentication_attempts(
                    "deployment-v1",
                    &attempts,
                    Some("192.0.2.10".parse().unwrap()),
                    Some(&composed),
                    102,
                )
                .unwrap()
                .admitted,
            "hosted and local deployments use explicit distinct axes"
        );
        assert!(
            database
                .charge_declared_authentication_attempts(
                    "deployment-v2",
                    &attempts,
                    None,
                    None,
                    200,
                )
                .unwrap()
                .admitted,
            "a missing or malformed identifier must enter its bounded lane"
        );
        assert!(
            !database
                .charge_declared_authentication_attempts(
                    "deployment-v2",
                    &attempts,
                    None,
                    None,
                    201,
                )
                .unwrap()
                .admitted,
            "missing or malformed identifiers must not bypass attempt accounting"
        );
    }

    #[test]
    fn rotating_recipients_share_hash_cpu_resource_axis_on_local_and_hosted_targets() {
        let attempts = [
            (
                AuthBudgetName::Enumeration,
                RollingWindowBudgetTerms {
                    limit: 2,
                    window_ms: 60_000,
                },
            ),
            (
                AuthBudgetName::HashCpu,
                RollingWindowBudgetTerms {
                    limit: 2,
                    window_ms: 60_000,
                },
            ),
        ];
        for source in [None, Some("192.0.2.10".parse().unwrap())] {
            let mut database = LocalDatabase::memory().expect("database");
            for index in 0..3 {
                let identifier =
                    CanonicalAddress::parse(&format!("rotating-{index}@example.com")).unwrap();
                let decision = database
                    .charge_declared_authentication_attempts(
                        "rotating-recipient-deployment",
                        &attempts,
                        source,
                        Some(&identifier),
                        100 + index,
                    )
                    .unwrap();
                assert_eq!(
                    decision.admitted,
                    index < 2,
                    "source={source:?} index={index}"
                );
                if index == 2 {
                    assert_eq!(decision.budget_name, AuthBudgetName::HashCpu);
                }
            }
        }
    }

    #[test]
    fn password_effects_charge_only_declared_named_shared_budgets() {
        let mut database = LocalDatabase::memory().expect("database");
        database
            .initialize_authentication_throttle_after_hosted_preflight()
            .expect("shared throttle tables");
        let hosted = HostedAuthenticationThrottle {
            limiter_epoch: 1,
            deployment_id: "password-budget-test".to_owned(),
            config: password_budget_config(
                AuthBudgetDeploymentProfile::Test,
                AuthBudgetName::Guessing,
            ),
            key: Arc::new(AuthenticationThrottleKey::from_bytes([9; 32])),
        };
        let source = "192.0.2.44".parse().expect("test source");
        for (ordinal, budget) in PasswordAuthEffect::Signin.budgets().iter().enumerate() {
            let decision = database
                .charge_password_authentication_attempt(
                    &hosted,
                    AuthBudgetDeploymentProfile::Test,
                    *budget,
                    source,
                    "person@example.com".to_owned(),
                    ordinal as u64,
                    None,
                )
                .expect("declared shared budget charge");
            assert!(decision.admitted);
            assert_eq!(decision.budget_name, *budget);
        }
        assert!(matches!(
            database.charge_password_authentication_attempt(
                &hosted,
                AuthBudgetDeploymentProfile::Test,
                AuthBudgetName::Delivery,
                source,
                "person@example.com".to_owned(),
                10,
                None,
            ),
            Err(AuthenticationThrottleError::Invalid)
        ));
    }
}
impl super::ServingDatabase {
    #[allow(clippy::too_many_arguments)]
    pub fn charge_sender_authentication_attempt(
        &mut self,
        throttle: &HostedAuthenticationThrottle,
        source: IpAddr,
        subject: Option<String>,
        access_token: Option<&str>,
        bound_family: Option<&str>,
        allow_superseded_grace: bool,
        now_ms: u64,
    ) -> Result<AuthenticationThrottleDecision, AuthenticationThrottleError> {
        self.db.charge_sender_authentication_attempt(
            throttle,
            source,
            subject,
            access_token,
            bound_family,
            allow_superseded_grace,
            now_ms,
        )
    }
}
