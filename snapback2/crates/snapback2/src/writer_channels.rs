//! Connection-owned latest values. All admission and fanout run on the sole writer.
// @ref LLP 1001.000#ownership-and-lifetime — a lease identifies one live subscribed connection.
use super::*;
use crate::protocol::{refusal_json, value_to_json};

const OWNER_HANDLES: usize = 1_024;
const ROOM_HANDLES: usize = 64;
const SCOPE_BYTES: usize = 1_024;
const VALUE_BYTES: usize = 4_096;

#[derive(Clone)]
pub(super) struct ChannelClient {
    pub(super) name: String,
    pub(super) args: BTreeMap<String, Value>,
    pub(super) context: Context,
    pub(super) session: Option<SessionFence>,
    pub(super) verdict: ChannelVerdict,
    pub(super) events: SseSender,
    pub(super) room: String,
    pub(super) key: String,
    pub(super) lease: String,
    pub(super) version: u64,
    pub(super) entry: Option<Entry>,
}

#[derive(Clone)]
pub(super) struct Entry {
    value: Json,
    expires_at: i64,
    deadline: Instant,
    publish: ChannelVerdict,
}

fn refusal(
    name: &str,
    code: &str,
    family: &str,
    message: impl Into<String>,
    rewrite: &str,
) -> Refusal {
    Refusal::new(code, family, message, rewrite, "live-query").with_site(name)
}
fn invalid_lease(name: &str) -> Refusal {
    refusal(
        name,
        "E_CHANNEL_LEASE",
        "input",
        "channel lease is invalid or closed",
        "open a fresh channel handle under the current account",
    )
}
fn record_json(value: BTreeMap<String, Value>) -> Json {
    value_to_json(&Value::Map(value.into()))
}
fn bounded(name: &str, value: &Json, limit: usize, label: &str) -> Result<(), Refusal> {
    if serde_json::to_vec(value).map_err(|_| owner_gone())?.len() > limit {
        return Err(refusal(
            name,
            "E_INPUT",
            "input",
            format!("channel {label} exceeds {limit} canonical JSON bytes"),
            "send a smaller channel record",
        ));
    }
    Ok(())
}
fn secret() -> Result<String, Refusal> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| {
        Refusal::owner(
            "E_OWNER_SECRET",
            "channel randomness unavailable",
            "restore the platform random source",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
// Fixed-size comparison with an optimizer barrier, including unknown tokens.
fn lease_matches(actual: &str, supplied: &str) -> bool {
    let supplied = supplied.as_bytes();
    let mut difference = supplied.len() ^ 64;
    for (index, byte) in actual.as_bytes().iter().enumerate() {
        difference |= usize::from(std::hint::black_box(
            *byte ^ supplied.get(index).copied().unwrap_or(0),
        ));
    }
    std::hint::black_box(difference) == 0
}

impl State {
    pub(super) fn channel_subscribe(
        &mut self,
        name: String,
        args: Json,
        identity: Identity,
        events: SseSender,
    ) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let args = channel_args(self.runtime().generation(), &name, &args)?;
        let scope = record_json(args.clone());
        bounded(&name, &scope, SCOPE_BYTES, "scope")?;
        let context = self.execution_context(&authority, BTreeMap::new())?;
        let verdict = self
            .runtime_mut()
            .channel_admit(&name, ChannelSide::Subscribe, &args, &context)
            .map_err(|error| Refusal::from_runtime(&error).with_site(&name))?;
        if !verdict.admitted {
            return Err(refusal(
                &name,
                "E_RULE_CHANNEL_SUBSCRIBE",
                "rule",
                "principal is not admitted to this channel",
                "use arguments and an account admitted by the subscribe rule",
            ));
        }
        self.prune_channels();
        let room = serde_json::to_string(&json!([name, scope])).map_err(|_| owner_gone())?;
        if self.channels.len() >= OWNER_HANDLES
            || self
                .channels
                .values()
                .filter(|client| client.room == room)
                .count()
                >= ROOM_HANDLES
        {
            return Err(refusal(
                &name,
                "E_CHANNEL_CAPACITY",
                "op",
                "channel handle capacity reached (64 per room, 1024 per owner)",
                "close unused channel handles",
            ));
        }
        if !events.is_alive() {
            return Err(invalid_lease(&name));
        }
        let (key, lease) = loop {
            let key = secret()?;
            let lease = secret()?;
            if key != lease
                && self
                    .channels
                    .values()
                    .all(|client| client.key != key && client.lease != lease)
            {
                break (key, lease);
            }
        };
        self.next_channel += 1;
        let id = self.next_channel;
        self.channels.insert(
            id,
            ChannelClient {
                name: name.clone(),
                args,
                context,
                session: authority.session,
                verdict,
                events,
                room: room.clone(),
                key,
                lease,
                version: 0,
                entry: None,
            },
        );
        self.flush_channels();
        let client = self.channels.get(&id).ok_or_else(|| invalid_lease(&name))?;
        if client.events.send_latest(SseEvent { seq: None, data: json!({ "state":"snapshot", "key":client.key, "lease":client.lease, "entries":self.channel_entries(&room) }), terminal: false }).is_err() {
            let error = invalid_lease(&client.name);
            self.channel_unsubscribe(id);
            self.flush_channels();
            return Err(error);
        }
        Ok(json!({ "id": id }))
    }

    pub(super) fn channel_write(
        &mut self,
        name: String,
        args: Json,
        lease: String,
        version: Json,
        value: Option<Json>,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        self.prune_channels();
        // The token is the only locator; every other supplied field is an equality check.
        let id = self
            .channels
            .iter()
            .find_map(|(id, client)| lease_matches(&client.lease, &lease).then_some(*id))
            .ok_or_else(|| invalid_lease(&name))?;
        let client = self.channels.get(&id).expect("located lease");
        if client.name != name
            || client.context.viewer() != authority.principal.id.as_str()
            || client.session != authority.session
            || !client.events.is_alive()
        {
            return Err(invalid_lease(&name));
        }
        let args = channel_args(self.runtime().generation(), &name, &args)?;
        if client.args != args {
            return Err(invalid_lease(&name));
        }
        let version = version
            .as_u64()
            .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
            .ok_or_else(|| {
                refusal(
                    &name,
                    "E_CHANNEL_VERSION",
                    "input",
                    "channel version must be a positive safe integer",
                    "use the installed client's channel handle",
                )
            })?;
        let value = value
            .map(|value| {
                let types = &self.runtime().generation().schema().channels[&name].value;
                let value = writer_values::typed_record(types, &value, "channel value")?;
                let value = self
                    .runtime()
                    .channel_value(&name, value)
                    .map_err(|error| Refusal::from_runtime(&error).with_site(&name))?;
                let value = record_json(value);
                bounded(&name, &value, VALUE_BYTES, "value")?;
                Ok::<_, Refusal>(value)
            })
            .transpose()?;
        let client = self.channels.get_mut(&id).expect("validated lease");
        if version <= client.version {
            return Err(refusal(
                &name,
                "E_CHANNEL_VERSION",
                "input",
                "channel version is stale",
                "issue a new command from the current channel handle",
            ));
        }
        client.version = version;
        let room = client.room.clone();
        if let Some(value) = value {
            let context = self.execution_context(&authority, BTreeMap::new())?;
            let publish = self
                .runtime_mut()
                .channel_admit(&name, ChannelSide::Publish, &args, &context)
                .map_err(|error| Refusal::from_runtime(&error).with_site(&name))?;
            if !publish.admitted {
                self.channels.get_mut(&id).unwrap().entry = None;
                self.channel_dirty.insert(room);
                return Err(refusal(
                    &name,
                    "E_RULE_CHANNEL_PUBLISH",
                    "rule",
                    "principal is not admitted to set this channel",
                    "use arguments and an account admitted by the publish rule",
                ));
            }
            let ttl_ms = self.runtime().generation().schema().channels[&name].ttl_ms;
            let entry = Entry {
                value,
                expires_at: self.now().saturating_add(i64::from(ttl_ms)),
                deadline: Instant::now() + Duration::from_millis(u64::from(ttl_ms)),
                publish,
            };
            self.channels.get_mut(&id).unwrap().entry = Some(entry);
        } else {
            self.channels.get_mut(&id).unwrap().entry = None;
        }
        self.channel_dirty.insert(room);
        Ok(json!({ "ok": true }))
    }

    pub(super) fn channel_unsubscribe(&mut self, id: u64) {
        if let Some(client) = self.channels.remove(&id)
            && client.entry.is_some()
        {
            self.channel_dirty.insert(client.room);
        }
    }

    // No fanout during a batch of revocation checks. The request/background turn
    // flushes only after every touched publish and subscribe verdict was checked.
    pub(super) fn readmit_channels(&mut self, commit: &snapback2_core::CommitRecord) {
        let touched: Vec<_> = self
            .channels
            .iter()
            .filter_map(|(id, client)| {
                (Runtime::channel_touched(commit, &client.verdict)
                    || client
                        .entry
                        .as_ref()
                        .is_some_and(|entry| Runtime::channel_touched(commit, &entry.publish)))
                .then_some(*id)
            })
            .collect();
        for id in touched {
            let Some(client) = self.channels.get(&id).cloned() else {
                continue;
            };
            let mut context = client.context.clone();
            context.now = Some(self.now());
            context.read_time = context.now;
            let verdict = self.runtime_mut().channel_admit(
                &client.name,
                ChannelSide::Subscribe,
                &client.args,
                &context,
            );
            match verdict {
                Ok(verdict) if verdict.admitted => {
                    self.channels.get_mut(&id).unwrap().verdict = verdict
                }
                result => {
                    let error = result
                        .err()
                        .map(|error| Refusal::from_runtime(&error))
                        .unwrap_or_else(|| {
                            refusal(
                                &client.name,
                                "E_RULE_CHANNEL_SUBSCRIBE",
                                "rule",
                                "principal is no longer admitted to this channel",
                                "restore membership or close the channel",
                            )
                        });
                    terminal(&client.events, error);
                    self.channel_unsubscribe(id);
                    continue;
                }
            }
            if client.entry.is_some() {
                let verdict = self.runtime_mut().channel_admit(
                    &client.name,
                    ChannelSide::Publish,
                    &client.args,
                    &context,
                );
                match verdict {
                    Ok(verdict) if verdict.admitted => {
                        self.channels
                            .get_mut(&id)
                            .unwrap()
                            .entry
                            .as_mut()
                            .unwrap()
                            .publish = verdict
                    }
                    _ => {
                        self.channels.get_mut(&id).unwrap().entry = None;
                        self.channel_dirty.insert(client.room);
                    }
                }
            }
        }
    }

    pub(super) fn reset_channels(&mut self) {
        for (_, client) in std::mem::take(&mut self.channels) {
            terminal(
                &client.events,
                refusal(
                    &client.name,
                    "E_CHANNEL_RESET",
                    "op",
                    "channel state was reset by the owner",
                    "reconnect for a fresh channel snapshot",
                ),
            );
        }
        self.channel_dirty.clear();
    }

    pub(super) fn advance_channel_clock(&mut self, milliseconds: i64) {
        let advance = Duration::from_millis(milliseconds as u64);
        for client in self.channels.values_mut() {
            if let Some(entry) = &mut client.entry {
                entry.deadline = entry
                    .deadline
                    .checked_sub(advance)
                    .unwrap_or_else(Instant::now);
            }
        }
    }

    fn prune_channels(&mut self) {
        let now = Instant::now();
        let mut closed = Vec::new();
        for (id, client) in &mut self.channels {
            if !client.events.is_alive() {
                closed.push(*id);
            } else if client
                .entry
                .as_ref()
                .is_some_and(|entry| entry.deadline <= now)
            {
                client.entry = None;
                self.channel_dirty.insert(client.room.clone());
            }
        }
        for id in closed {
            self.channel_unsubscribe(id);
        }
    }

    pub(super) fn sweep_channels(&mut self) {
        self.flush_channels();
    }

    fn channel_entries(&self, room: &str) -> Vec<Json> {
        let now = Instant::now();
        let mut entries = self.channels.values().filter(|client| client.room == room).filter_map(|client| {
            client.entry.as_ref().filter(|entry| entry.deadline > now && client.events.is_alive()).map(|entry| json!({ "key":client.key, "from":client.context.viewer(), "value":entry.value, "expiresAt":entry.expires_at }))
        }).collect::<Vec<_>>();
        entries.sort_by(|a, b| a["key"].as_str().cmp(&b["key"].as_str()));
        entries
    }

    pub(super) fn flush_channels(&mut self) {
        self.prune_channels();
        while !self.channel_dirty.is_empty() {
            let rooms = std::mem::take(&mut self.channel_dirty);
            for room in rooms {
                let entries = self.channel_entries(&room);
                let mut closed = Vec::new();
                for (id, client) in &self.channels {
                    if client.room == room && client.events.send_latest(SseEvent { seq: None, data: json!({ "state":"snapshot", "key":client.key, "lease":client.lease, "entries":entries }), terminal: false }).is_err() { closed.push(*id); }
                }
                for id in closed {
                    self.channel_unsubscribe(id);
                }
            }
        }
    }
}

pub(super) fn terminal(events: &SseSender, error: Refusal) {
    let mut data = refusal_json(&error);
    data["state"] = json!("refused");
    let _ = events.send_latest(SseEvent {
        seq: None,
        data,
        terminal: true,
    });
}

#[cfg(test)]
#[path = "writer_channels_tests.rs"]
mod tests;
