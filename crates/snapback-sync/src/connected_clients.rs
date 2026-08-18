//! Bounded, process-local witnesses for recently active authenticated clients.
//!
//! This deliberately does not use the durable database or the longer-lived
//! connection-grant registry. A reconnectable grant is not evidence that a
//! client is connected, and connectivity must not advance durable versions.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The wire contract's fixed freshness budget.
pub const CONNECTED_CLIENT_FRESHNESS: Duration = Duration::from_secs(15);

// One grant may momentarily own both an HTTP-poll witness and a managed socket
// witness while a client changes transport. The server caps grants at 16,384.
const MAX_WITNESSES: usize = 32_768;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum WitnessKey {
    ManagedWebSocket {
        connection_id: String,
        grant_id: String,
        socket_generation: u64,
    },
    AuthenticatedPoll {
        connection_id: String,
        grant_id: String,
    },
}

impl WitnessKey {
    fn grant_identity(&self) -> (&str, &str) {
        match self {
            Self::ManagedWebSocket {
                connection_id: current_connection,
                grant_id: current_grant,
                ..
            }
            | Self::AuthenticatedPoll {
                connection_id: current_connection,
                grant_id: current_grant,
            } => (current_connection, current_grant),
        }
    }
}

#[derive(Clone)]
struct Witness {
    principal_id: String,
    expires_at: Instant,
}

#[derive(Default)]
struct ConnectedClientState {
    witnesses: BTreeMap<WitnessKey, Witness>,
    by_principal: BTreeMap<String, BTreeSet<WitnessKey>>,
    by_grant: BTreeMap<(String, String), BTreeSet<WitnessKey>>,
    expiries: BTreeMap<Instant, BTreeSet<WitnessKey>>,
}

/// Clone-shared authority for one app instance.
///
/// @ref LLP 0222#decision — the answer is an advisory, session-authenticated,
/// fixed-budget transport witness, never a durable presence record.
#[derive(Clone, Default)]
pub struct ConnectedClientRegistry {
    state: Arc<Mutex<ConnectedClientState>>,
}

impl ConnectedClientRegistry {
    pub fn register_managed_websocket(
        &self,
        principal_id: &str,
        connection_id: &str,
        grant_id: &str,
        socket_generation: u64,
        now: Instant,
    ) -> SnapbackResult<()> {
        let mut state = self.lock();
        state.prune(now);
        // Notifier registration has already made this generation current.
        // Remove any superseded socket witness on the readable route now;
        // its stale task will deliberately lose the later exact teardown.
        let superseded = state
            .witnesses
            .keys()
            .filter(|key| {
                matches!(
                    key,
                    WitnessKey::ManagedWebSocket {
                        connection_id: current,
                        ..
                    } if current == connection_id
                )
            })
            .cloned()
            .collect::<Vec<_>>();
        for key in superseded {
            state.remove(&key);
        }
        if state.witnesses.len() >= MAX_WITNESSES {
            return Err(SnapbackError::error(
                "SNAPBACK_CONNECTED_CLIENT_CAPACITY",
                "realtime",
                "the connected-client witness index is at capacity; retry after a witness expires",
            ));
        }
        state.upsert(
            principal_id,
            WitnessKey::ManagedWebSocket {
                connection_id: connection_id.to_owned(),
                grant_id: grant_id.to_owned(),
                socket_generation,
            },
            now,
        );
        Ok(())
    }

    pub fn refresh_managed_websocket(
        &self,
        connection_id: &str,
        grant_id: &str,
        socket_generation: u64,
        now: Instant,
    ) -> bool {
        self.refresh(
            &WitnessKey::ManagedWebSocket {
                connection_id: connection_id.to_owned(),
                grant_id: grant_id.to_owned(),
                socket_generation,
            },
            now,
        )
    }

    /// Record a client-originated authenticated poll-lane act. This is a v2
    /// widening of the RFC's initial managed-WebSocket-only sketch: the
    /// shipped headless client defaults to poll, so excluding it would make
    /// the predicate false for a real, actively connected Snapback client.
    ///
    /// @ref LLP 0222#open-questions — transport widening remains explicit in
    /// the manifest's semanticsVersion and transport list.
    pub fn register_or_refresh_authenticated_poll(
        &self,
        principal_id: &str,
        connection_id: &str,
        grant_id: &str,
        now: Instant,
    ) -> SnapbackResult<()> {
        self.upsert(
            principal_id,
            WitnessKey::AuthenticatedPoll {
                connection_id: connection_id.to_owned(),
                grant_id: grant_id.to_owned(),
            },
            now,
        )
    }

    pub fn remove_managed_websocket(
        &self,
        connection_id: &str,
        grant_id: &str,
        socket_generation: u64,
    ) {
        let key = WitnessKey::ManagedWebSocket {
            connection_id: connection_id.to_owned(),
            grant_id: grant_id.to_owned(),
            socket_generation,
        };
        let mut state = self.lock();
        state.remove(&key);
    }

    /// Exact grant retirement removes both transport kinds immediately.
    pub fn remove_grant(&self, connection_id: &str, grant_id: &str) {
        let mut state = self.lock();
        let keys = state
            .by_grant
            .get(&(connection_id.to_owned(), grant_id.to_owned()))
            .cloned()
            .unwrap_or_default();
        for key in keys {
            state.remove(&key);
        }
    }

    pub fn has_fresh_client(&self, principal_id: &str, now: Instant) -> bool {
        let mut state = self.lock();
        state.prune(now);
        state
            .by_principal
            .get(principal_id)
            .is_some_and(|keys| !keys.is_empty())
    }

    pub fn clear(&self) {
        *self.lock() = ConnectedClientState::default();
    }

    fn upsert(&self, principal_id: &str, key: WitnessKey, now: Instant) -> SnapbackResult<()> {
        let mut state = self.lock();
        state.prune(now);
        if !state.witnesses.contains_key(&key) && state.witnesses.len() >= MAX_WITNESSES {
            return Err(SnapbackError::error(
                "SNAPBACK_CONNECTED_CLIENT_CAPACITY",
                "realtime",
                "the connected-client witness index is at capacity; retry after a witness expires",
            ));
        }
        state.upsert(principal_id, key, now);
        Ok(())
    }

    fn refresh(&self, key: &WitnessKey, now: Instant) -> bool {
        let mut state = self.lock();
        state.prune(now);
        let Some(principal_id) = state
            .witnesses
            .get(key)
            .map(|witness| witness.principal_id.clone())
        else {
            return false;
        };
        state.upsert(&principal_id, key.clone(), now);
        true
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ConnectedClientState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl ConnectedClientState {
    fn upsert(&mut self, principal_id: &str, key: WitnessKey, now: Instant) {
        if let Some(previous) = self.witnesses.remove(&key) {
            self.remove_indexes(&key, &previous);
        }
        let expires_at = now.checked_add(CONNECTED_CLIENT_FRESHNESS).unwrap_or(now);
        let witness = Witness {
            principal_id: principal_id.to_owned(),
            expires_at,
        };
        self.witnesses.insert(key.clone(), witness);
        self.by_principal
            .entry(principal_id.to_owned())
            .or_default()
            .insert(key.clone());
        let (connection_id, grant_id) = key.grant_identity();
        self.by_grant
            .entry((connection_id.to_owned(), grant_id.to_owned()))
            .or_default()
            .insert(key.clone());
        self.expiries.entry(expires_at).or_default().insert(key);
    }

    fn prune(&mut self, now: Instant) {
        let expired_instants = self
            .expiries
            .range(..=now)
            .map(|(instant, _)| *instant)
            .collect::<Vec<_>>();
        for instant in expired_instants {
            let keys = self.expiries.remove(&instant).unwrap_or_default();
            for key in keys {
                if self
                    .witnesses
                    .get(&key)
                    .is_some_and(|witness| witness.expires_at <= now)
                {
                    self.remove(&key);
                }
            }
        }
    }

    fn remove(&mut self, key: &WitnessKey) {
        if let Some(witness) = self.witnesses.remove(key) {
            self.remove_indexes(key, &witness);
        }
    }

    fn remove_indexes(&mut self, key: &WitnessKey, witness: &Witness) {
        if let Some(keys) = self.by_principal.get_mut(&witness.principal_id) {
            keys.remove(key);
            if keys.is_empty() {
                self.by_principal.remove(&witness.principal_id);
            }
        }
        let (connection_id, grant_id) = key.grant_identity();
        let grant_identity = (connection_id.to_owned(), grant_id.to_owned());
        if let Some(keys) = self.by_grant.get_mut(&grant_identity) {
            keys.remove(key);
            if keys.is_empty() {
                self.by_grant.remove(&grant_identity);
            }
        }
        if let Some(keys) = self.expiries.get_mut(&witness.expires_at) {
            keys.remove(key);
            if keys.is_empty() {
                self.expiries.remove(&witness.expires_at);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existential_freshness_and_exact_generation_removal() {
        let registry = ConnectedClientRegistry::default();
        let start = Instant::now();
        registry
            .register_managed_websocket("user-1", "c1", "g1", 1, start)
            .unwrap();
        registry
            .register_managed_websocket("user-1", "c2", "g2", 1, start)
            .unwrap();
        registry.remove_managed_websocket("c1", "g1", 1);
        assert!(registry.has_fresh_client("user-1", start));
        registry.remove_managed_websocket("c2", "g2", 1);
        assert!(!registry.has_fresh_client("user-1", start));
    }

    #[test]
    fn expiry_and_inbound_refresh_use_the_fixed_budget() {
        let registry = ConnectedClientRegistry::default();
        let start = Instant::now();
        registry
            .register_managed_websocket("user-1", "c1", "g1", 7, start)
            .unwrap();
        let refresh = start + Duration::from_secs(10);
        assert!(registry.refresh_managed_websocket("c1", "g1", 7, refresh));
        assert!(registry.has_fresh_client(
            "user-1",
            refresh + CONNECTED_CLIENT_FRESHNESS - Duration::from_millis(1)
        ));
        assert!(!registry.has_fresh_client("user-1", refresh + CONNECTED_CLIENT_FRESHNESS));
    }

    #[test]
    fn stale_socket_generation_cannot_refresh_or_remove_successor() {
        let registry = ConnectedClientRegistry::default();
        let start = Instant::now();
        registry
            .register_managed_websocket("user-1", "c1", "g1", 1, start)
            .unwrap();
        registry
            .register_managed_websocket("user-1", "c1", "g1", 2, start + Duration::from_secs(1))
            .unwrap();
        assert!(!registry.refresh_managed_websocket(
            "c1",
            "g1",
            1,
            start + Duration::from_secs(14)
        ));
        registry.remove_managed_websocket("c1", "g1", 1);
        assert!(registry.has_fresh_client("user-1", start + Duration::from_secs(14)));
    }

    #[test]
    fn poll_witness_is_session_principal_scoped_and_grant_retirement_is_immediate() {
        let registry = ConnectedClientRegistry::default();
        let start = Instant::now();
        registry
            .register_or_refresh_authenticated_poll("user-1", "c1", "g1", start)
            .unwrap();
        assert!(registry.has_fresh_client("user-1", start));
        assert!(!registry.has_fresh_client("user-2", start));
        registry.remove_grant("c1", "g1");
        assert!(!registry.has_fresh_client("user-1", start));
    }

    #[test]
    fn new_registry_models_process_restart_as_false() {
        let first = ConnectedClientRegistry::default();
        let now = Instant::now();
        first
            .register_managed_websocket("user-1", "c1", "g1", 1, now)
            .unwrap();
        assert!(first.has_fresh_client("user-1", now));
        assert!(!ConnectedClientRegistry::default().has_fresh_client("user-1", now));
    }

    #[test]
    fn high_churn_refresh_replaces_indexes_instead_of_growing_them() {
        let registry = ConnectedClientRegistry::default();
        let now = Instant::now();
        for iteration in 0..10_000 {
            let principal = if iteration == 0 { "old-user" } else { "user-1" };
            registry
                .register_or_refresh_authenticated_poll(principal, "c1", "g1", now)
                .unwrap();
        }
        let state = registry.lock();
        assert_eq!(state.witnesses.len(), 1);
        assert_eq!(state.by_principal.len(), 1);
        assert_eq!(state.by_grant.len(), 1);
        assert_eq!(state.expiries.values().map(BTreeSet::len).sum::<usize>(), 1);
        assert!(!state.by_principal.contains_key("old-user"));
        assert!(state.by_principal.contains_key("user-1"));
    }

    #[test]
    fn capacity_is_a_hard_bound_and_retirement_reopens_one_slot() {
        let registry = ConnectedClientRegistry::default();
        let now = Instant::now();
        for index in 0..MAX_WITNESSES {
            registry
                .register_or_refresh_authenticated_poll(
                    "user-1",
                    &format!("c{index}"),
                    &format!("g{index}"),
                    now,
                )
                .unwrap();
        }
        let error = registry
            .register_or_refresh_authenticated_poll("user-1", "overflow", "overflow", now)
            .expect_err("the witness index must fail closed at its exact bound");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONNECTED_CLIENT_CAPACITY");
        registry.remove_grant("c0", "g0");
        registry
            .register_or_refresh_authenticated_poll("user-1", "replacement", "replacement", now)
            .expect("retirement releases exactly one witness slot");
        assert_eq!(registry.lock().witnesses.len(), MAX_WITNESSES);
    }
}
