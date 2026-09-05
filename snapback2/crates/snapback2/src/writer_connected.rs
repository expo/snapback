//! Authenticated SSE transports, independent of their query/channel children.
// @ref LLP 1001#51-connected — owner turns order connection changes and snapshot reads.
use super::*;

#[derive(Default)]
pub(super) struct Connections {
    entries: BTreeMap<u64, Connection>,
    counts: BTreeMap<String, u64>,
    next: u64,
    changed: BTreeSet<String>,
    due: Option<Instant>,
}

struct Connection {
    principal: String,
    session: Option<SessionFence>,
    events: SseSender,
}

impl State {
    pub(super) fn connected_open(
        &mut self,
        identity: Identity,
        events: SseSender,
    ) -> Result<Json, Refusal> {
        if identity == Identity::Anonymous {
            return Ok(Json::Null);
        }
        let authority = self.resolve_authority(identity)?;
        let principal = authority.principal.id.to_string();
        self.connected.next += 1;
        let id = self.connected.next;
        self.connected.entries.insert(
            id,
            Connection {
                principal: principal.clone(),
                session: authority.session,
                events,
            },
        );
        *self.connected.counts.entry(principal.clone()).or_default() += 1;
        self.connected_changed(principal);
        Ok(json!(id))
    }

    pub(super) fn connected_close(&mut self, id: u64) {
        if let Some(connection) = self.connected.entries.remove(&id) {
            let count = self
                .connected
                .counts
                .get_mut(&connection.principal)
                .expect("registered principal");
            *count -= 1;
            if *count == 0 {
                self.connected.counts.remove(&connection.principal);
            }
            self.connected_changed(connection.principal);
        }
    }

    fn connected_changed(&mut self, principal: String) {
        self.connected.changed.insert(principal);
        self.connected
            .due
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(1));
        let counts = self.connected.counts.clone();
        self.runtime_mut().set_connected(counts);
    }

    pub(super) fn connected_revoke(&mut self, authority: &snapback2_core::SessionAuthority) {
        let ids: Vec<_> = self
            .connected
            .entries
            .iter()
            .filter_map(|(id, connection)| {
                connection
                    .session
                    .as_ref()
                    .is_some_and(|s| s.matches(authority))
                    .then_some(*id)
            })
            .collect();
        let seq = self.runtime().store().commit_seq().unwrap_or_default();
        for id in ids {
            if let Some(connection) = self.connected.entries.get(&id) {
                writer_auth::send_session_terminal(&connection.events, seq);
            }
            self.connected_close(id);
        }
    }

    pub(super) fn connected_poll_timeout(&self) -> Duration {
        self.connected.due.map_or(Duration::from_secs(1), |due| {
            due.saturating_duration_since(Instant::now())
        })
    }

    pub(super) fn flush_connected(&mut self) {
        if !self.connected.due.is_some_and(|due| due <= Instant::now()) {
            return;
        }
        self.connected.due = None;
        let principals = std::mem::take(&mut self.connected.changed);
        let ids = self.runtime().connected_invalidated(&principals);
        let clients = self
            .live
            .iter()
            .filter_map(|(id, client)| ids.contains(&client.runtime_id).then_some(*id))
            .collect::<Vec<_>>();
        self.rerun_live(&clients, false);
    }
}
