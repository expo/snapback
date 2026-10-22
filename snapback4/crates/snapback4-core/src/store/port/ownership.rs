//! Store ownership stays behind the enum boundary.
// @ref LLP 3000.009.001.000#3.4 — the host binds an acquired token before listening.
pub use crate::engine::postgres::ownership::{LeaseAcquisition, LeasePolicy, StoreLease};
use crate::{RuntimeError, store_port::AnyStore};
impl AnyStore {
    pub fn open_postgres_owned(
        connection: &str,
        namespace: &str,
        lease: &StoreLease,
    ) -> Result<Self, RuntimeError> {
        crate::engine::postgres::Handle::open_owned(connection, namespace, lease)
            .map(Self::from_postgres)
    }
}

/// Conservative local authority deadline, independent of a renewal connection.
/// Start the clock *before* issuing renewal SQL: its COMMIT can stall after the
/// database sampled lease_until. A late completion must never revive authority.
#[derive(Clone)]
pub struct LeaseDeadline {
    until: std::sync::Arc<std::sync::Mutex<std::time::Instant>>,
    window: std::time::Duration,
}
impl LeaseDeadline {
    pub fn new(lease: std::time::Duration, started: std::time::Instant) -> Self {
        // Poll at <=10 ms and retain at least five ticks for normal leases;
        // short test leases use a proportional quarter-lease safety margin.
        let margin = std::time::Duration::from_millis(50).min(lease / 4);
        let window = lease.saturating_sub(margin);
        Self {
            until: std::sync::Arc::new(std::sync::Mutex::new(started + window)),
            window,
        }
    }
    pub fn expired(&self) -> bool {
        std::time::Instant::now() >= *self.until.lock().unwrap_or_else(|p| p.into_inner())
    }
    pub fn renewed(&self, started: std::time::Instant) -> bool {
        let mut until = self.until.lock().unwrap_or_else(|p| p.into_inner());
        let now = std::time::Instant::now();
        if now >= *until || now >= started + self.window {
            return false;
        }
        *until = started + self.window;
        true
    }
}
