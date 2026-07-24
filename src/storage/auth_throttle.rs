//! Storage-owned hosted authentication throttle composition.

use std::net::IpAddr;

use super::LocalDatabase;
use crate::auth::crypto::SessionBearer;
use crate::auth::deployment::HostedAuthenticationThrottle;
use crate::auth::sender_proof::sender_constraint_for_presented_token;
use crate::auth::throttle::{
    AuthenticationThrottleDecision, AuthenticationThrottleDimensions, AuthenticationThrottleError,
    charge_shared_authentication_attempt, initialize_shared_authentication_throttle,
};

impl LocalDatabase {
    pub(crate) fn initialize_authentication_throttle_after_hosted_preflight(
        &self,
    ) -> Result<(), AuthenticationThrottleError> {
        initialize_shared_authentication_throttle(&self.conn)
    }

    #[cfg(test)]
    pub(crate) fn make_authentication_throttle_unavailable_for_test(
        &self,
    ) -> Result<(), rusqlite::Error> {
        self.conn
            .execute_batch("DROP TABLE _snapback_auth_throttle;")
    }

    /// Charge global/source and, when the bounded pre-proof family lookup
    /// resolves, the family bucket before proof verification.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn charge_sender_authentication_attempt(
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
            None => SessionBearer::parse(access_token.unwrap_or_default())
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
}
