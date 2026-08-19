//! Storage-owned hosted authentication throttle composition.

use std::net::IpAddr;

use super::LocalDatabase;
use crate::auth::crypto::SessionBearer;
use crate::auth::deployment::HostedAuthenticationThrottle;
use crate::auth::sender_proof::sender_constraint_for_presented_token;
use crate::auth::throttle::{
    AuthBudgetDeploymentProfile, AuthBudgetIdempotencyIdentity, AuthBudgetName,
    AuthenticationThrottleDecision, AuthenticationThrottleDimensions, AuthenticationThrottleError,
    charge_shared_authentication_attempt, charge_shared_authentication_attempt_idempotent,
    initialize_shared_authentication_throttle, password_budget_config,
};

impl LocalDatabase {
    pub fn initialize_authentication_throttle_after_hosted_preflight(
        &self,
    ) -> Result<(), AuthenticationThrottleError> {
        initialize_shared_authentication_throttle(&self.conn)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn make_authentication_throttle_unavailable_for_test(&self) -> Result<(), rusqlite::Error> {
        self.conn
            .execute_batch("DROP TABLE _snapback_auth_throttle;")
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
