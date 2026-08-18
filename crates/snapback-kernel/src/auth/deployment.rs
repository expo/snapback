//! Storage-facing hosted deployment carriers.

use std::sync::Arc;

pub use snapback_types::auth::deployment::*;

use super::throttle::{AuthenticationThrottleKey, SharedAuthenticationThrottleConfig};

#[derive(Clone)]
pub struct HostedAuthenticationThrottle {
    pub limiter_epoch: u64,
    pub deployment_id: String,
    pub config: SharedAuthenticationThrottleConfig,
    pub key: Arc<AuthenticationThrottleKey>,
}

impl std::fmt::Debug for HostedAuthenticationThrottle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostedAuthenticationThrottle")
            .field("limiter_epoch", &self.limiter_epoch)
            .field("deployment_id", &self.deployment_id)
            .field("config", &self.config)
            .field("key", &"[REDACTED]")
            .finish()
    }
}
