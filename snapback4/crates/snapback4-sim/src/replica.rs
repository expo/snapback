//! A device as a simulated host: the local-first client's shape in Rust
//! (LLP 2000.000 §7.2) — a replica of the viewer's partitions with one
//! watermark, a durable outbox of client-minted writes, predictions that
//! the stream replaces, and screens whose every state is on the card. It
//! persists through the simulated disk, so a failed `fsync` refuses
//! admission and a kill loses only what was never synced.

use crate::world::{Ctx, Event, Host, HostId};
use serde_json::{Map, Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};

pub const T_SYNC: u64 = 1;
pub const T_ACT: u64 = 2;
pub const T_RETRY: u64 = 3;
pub const T_READ: u64 = 4;

/// What a device does on its own clock: send a message to a conversation
/// every `every` ms, `count` times; leave a conversation at `leave_at`.
#[derive(Clone, Debug)]
pub struct Script {
    pub conversation: String,
    pub every: u64,
    pub count: u32,
    pub leave_at: Option<u64>,
}

pub struct Replica {
    server: HostId,
    viewer: String,
    script: Script,
    /// Tables whose rows go when the device leaves a group.
    until_revoked: BTreeSet<String>,
    audiences: BTreeMap<String, Vec<String>>,
    // Durable state, persisted as JSON.
    watermark: u64,
    rows: BTreeMap<String, BTreeMap<String, Json>>,
    outbox: Vec<Json>,
    acked: BTreeMap<String, u64>,
    failed: BTreeMap<String, String>,
    left: Vec<(String, Vec<Json>, u64)>,
    minted: u32,
    generation: u64,
    rebootstraps: u32,
    // Volatile.
    rid: u64,
    inflight_sync: Option<u64>,
    reads: BTreeMap<String, u64>,
    unadmitted: u64,
    watermark_regressions: u64,
    started_at: u64,
}

impl Replica {
    pub fn factory(server: HostId, viewer: &str, script: Script, until_revoked: BTreeSet<String>, audiences: BTreeMap<String, Vec<String>>) -> crate::world::HostFactory {
        let viewer = viewer.to_owned();
        Box::new(move || Box::new(Replica { server, viewer: viewer.clone(), script: script.clone(), until_revoked: until_revoked.clone(), audiences: audiences.clone(), watermark: 0, rows: BTreeMap::new(), outbox: Vec::new(), acked: BTreeMap::new(), failed: BTreeMap::new(), left: Vec::new(), minted: 0, generation: 0, rebootstraps: 0, rid: 0, inflight_sync: None, reads: BTreeMap::new(), unadmitted: 0, watermark_regressions: 0, started_at: 0 }))
    }

    fn durable(&self) -> Json {
        json!({ "watermark": self.watermark, "rows": self.rows, "outbox": self.outbox, "acked": self.acked, "failed": self.failed, "left": self.left, "minted": self.minted, "generation": self.generation, "rebootstraps": self.rebootstraps })
    }

    fn persist(&self, ctx: &mut Ctx<'_>) -> bool {
        ctx.disk.write("replica", self.durable().to_string().into_bytes());
        ctx.disk.fsync(ctx.rng).is_ok()
    }

    fn restore(&mut self, ctx: &mut Ctx<'_>) {
        let Some(bytes) = ctx.disk.read("replica") else { return };
        let Ok(json) = serde_json::from_slice::<Json>(bytes) else { return };
        self.watermark = json["watermark"].as_u64().unwrap_or(0);
        self.rows = serde_json::from_value(json["rows"].clone()).unwrap_or_default();
        self.outbox = json["outbox"].as_array().cloned().unwrap_or_default();
        self.acked = serde_json::from_value(json["acked"].clone()).unwrap_or_default();
        self.failed = serde_json::from_value(json["failed"].clone()).unwrap_or_default();
        self.left = serde_json::from_value(json["left"].clone()).unwrap_or_default();
        self.minted = json["minted"].as_u64().unwrap_or(0) as u32;
        self.generation = json["generation"].as_u64().unwrap_or(0);
        self.rebootstraps = json["rebootstraps"].as_u64().unwrap_or(0) as u32;
    }

    fn request(&mut self, ctx: &mut Ctx<'_>, mut message: Map<String, Json>) -> u64 {
        self.rid += 1;
        message.insert("rid".into(), json!(self.rid));
        message.insert("viewer".into(), json!(self.viewer));
        ctx.send(self.server, Json::Object(message).to_string());
        self.rid
    }

    fn sync(&mut self, ctx: &mut Ctx<'_>) {
        if self.inflight_sync.is_some() {
            return;
        }
        let from = self.watermark;
        let rid = self.request(ctx, json!({ "t": "sync", "from": from }).as_object().cloned().unwrap());
        self.inflight_sync = Some(rid);
    }

    /// A queued `send` shows on the screen as a pending row until the
    /// stream replaces it or the server refuses it.
    fn predict(&mut self, write: &Json) {
        if write["op"] != "send" {
            return;
        }
        let Some(message_id) = write["newIds"][0].as_str() else {
            return;
        };
        let row = json!({ "id": message_id, "conversationId": write["args"]["conversationId"], "authorId": self.viewer, "body": write["args"]["body"], "at": write["at"], "pending": true });
        self.rows.entry("messages".into()).or_default().insert(message_id.to_owned(), row);
    }

    fn resend(&mut self, ctx: &mut Ctx<'_>) {
        let queued: Vec<Json> = self.outbox.iter().filter(|w| !self.acked.contains_key(w["id"].as_str().unwrap_or("")) && !self.failed.contains_key(w["id"].as_str().unwrap_or(""))).cloned().collect();
        for write in queued {
            let mut message = json!({ "t": "m", "id": write["id"], "op": write["op"], "args": write["args"], "newIds": write["newIds"] }).as_object().cloned().unwrap();
            let _ = &mut message;
            self.request(ctx, message);
        }
    }

    /// A screen: the thread, read locally over the replica. Its state is one
    /// of the card's words, counted.
    fn render_thread(&mut self) {
        let rows = self.rows.get("messages").map(|m| m.values().filter(|r| r["conversationId"].as_str() == Some(self.script.conversation.as_str())).count()).unwrap_or(0);
        let member = self.rows.get("memberships").is_some_and(|m| m.values().any(|r| r["conversationId"].as_str() == Some(self.script.conversation.as_str()) && r["principal"].as_str() == Some(self.viewer.as_str())));
        let word = if !member { "denied" } else if rows > 500 { "capped" } else { "complete" };
        *self.reads.entry(word.to_owned()).or_default() += 1;
    }

    fn apply(&mut self, events: &[Json], snapshot: bool) {
        if snapshot {
            self.rows.clear();
        }
        for event in events {
            let table = event["table"].as_str().unwrap_or("").to_owned();
            let id = event["id"].as_str().unwrap_or("").to_owned();
            match event["kind"].as_str() {
                Some("put") => {
                    let mut data = event["data"].clone();
                    if let Some(object) = data.as_object_mut() {
                        object.remove("pending");
                    }
                    // A row this device predicted is replaced by the server's image.
                    self.rows.entry(table).or_default().insert(id, data);
                }
                Some("del") => {
                    self.rows.entry(table).or_default().remove(&id);
                }
                Some("scope") => {
                    let group: Vec<Json> = event["data"].as_array().cloned().unwrap_or_default();
                    let seq = event["seq"].as_u64().unwrap_or(0);
                    if self.until_revoked.contains(&table)
                        && let Some(rows) = self.rows.get_mut(&table)
                    {
                        rows.retain(|_, row| !matches_group(row, &group, self.audiences.get(&table).map(Vec::as_slice).unwrap_or(&[])));
                    }
                    self.left.push((table, group, seq));
                }
                _ => {}
            }
        }
    }
}

fn matches_group(row: &Json, group: &[Json], columns: &[String]) -> bool {
    !columns.is_empty() && columns.len() == group.len()
        && columns.iter().zip(group).all(|(column, value)| row.get(column) == Some(value))
}

#[test]
fn scope_membership_uses_only_the_ordered_audience_columns() {
    let columns = vec!["conversationId".to_owned()];
    let row = json!({"id":"row", "conversationId":"B", "unrelated":"A"});
    assert!(!matches_group(&row, &[json!("A")], &columns));
    assert!(matches_group(&row, &[json!("B")], &columns));
    let columns = vec!["first".to_owned(), "second".to_owned()];
    let row = json!({"first":"A", "second":"B"});
    assert!(!matches_group(&row, &[json!("B"),json!("A")], &columns));
    assert!(matches_group(&row, &[json!("A"),json!("B")], &columns));
}

impl Host for Replica {
    fn start(&mut self, ctx: &mut Ctx<'_>) {
        self.restore(ctx);
        self.started_at = ctx.now;
        ctx.log(format!("{} up at watermark {} with {} queued", self.viewer, self.watermark, self.outbox.len()));
        self.sync(ctx);
        self.resend(ctx);
        ctx.timer(20, T_SYNC);
        ctx.timer(30, T_RETRY);
        ctx.timer(self.script.every, T_ACT);
        ctx.timer(15, T_READ);
    }

    fn on(&mut self, ctx: &mut Ctx<'_>, event: Event) {
        match event {
            Event::Timer { tag: T_SYNC } => {
                self.inflight_sync = None;
                self.sync(ctx);
                ctx.timer(20, T_SYNC);
            }
            Event::Timer { tag: T_RETRY } => {
                self.resend(ctx);
                ctx.timer(30, T_RETRY);
            }
            Event::Timer { tag: T_READ } => {
                self.render_thread();
                ctx.timer(15, T_READ);
            }
            Event::Timer { tag: T_ACT } => {
                if let Some(leave_at) = self.script.leave_at
                    && ctx.now >= leave_at
                    && !self.outbox.iter().any(|w| w["op"] == "leave")
                {
                    let id = format!("{}-leave", self.viewer);
                    self.outbox.push(json!({ "id": id, "op": "leave", "args": { "conversationId": self.script.conversation }, "newIds": [] }));
                    if !self.persist(ctx) {
                        self.outbox.pop();
                        self.unadmitted += 1;
                    } else {
                        self.resend(ctx);
                    }
                    return;
                }
                if self.minted < self.script.count && self.script.leave_at.is_none_or(|at| ctx.now < at) {
                    self.minted += 1;
                    let id = format!("{}-{}", self.viewer, self.minted);
                    let message_id = format!("M-{}-{}", self.viewer, self.minted);
                    let write = json!({ "id": id, "op": "send", "args": { "conversationId": self.script.conversation, "body": format!("hello {}", self.minted) }, "newIds": [message_id], "at": ctx.now });
                    // The prediction: a pending row the stream will replace.
                    self.predict(&write);
                    self.outbox.push(write);
                    if !self.persist(ctx) {
                        // Not admitted durably: the write and its prediction never happened.
                        self.outbox.pop();
                        self.rows.get_mut("messages").map(|m| m.remove(&message_id));
                        self.minted -= 1;
                        self.unadmitted += 1;
                    } else {
                        self.resend(ctx);
                    }
                    ctx.timer(self.script.every, T_ACT);
                }
            }
            Event::Timer { .. } => {}
            Event::Deliver { payload, .. } => {
                let Ok(message) = serde_json::from_slice::<Json>(&payload) else { return };
                match message["t"].as_str() {
                    Some("write") => {
                        let id = message["id"].as_str().unwrap_or("").to_owned();
                        match message["state"].as_str() {
                            Some("sent") => {
                                let seq = message["seq"].as_u64().unwrap_or(0);
                                self.acked.insert(id, seq);
                            }
                            Some("failed") => {
                                let why = message["why"]["code"].as_str().unwrap_or("?").to_owned();
                                // A failed prediction is withdrawn: typed, never silent.
                                if let Some(write) = self.outbox.iter().find(|w| w["id"] == id).cloned() {
                                    for minted in write["newIds"].as_array().cloned().unwrap_or_default() {
                                        if let Some(rows) = self.rows.get_mut("messages") {
                                            rows.remove(minted.as_str().unwrap_or(""));
                                        }
                                    }
                                }
                                self.failed.insert(id, why);
                            }
                            _ => {}
                        }
                        let _ = self.persist(ctx);
                    }
                    Some("sync") => {
                        if message["rid"].as_u64() != self.inflight_sync {
                            return; // a duplicate or a stale reply
                        }
                        self.inflight_sync = None;
                        if message.get("denied").is_some() {
                            return;
                        }
                        let watermark = message["watermark"].as_u64().unwrap_or(0);
                        let snapshot = message["snapshot"].as_bool().unwrap_or(false);
                        let generation = message["generation"].as_u64().unwrap_or(1);
                        if self.generation != 0 && generation != self.generation {
                            // A new generation: the partition is re-derived from a
                            // fresh snapshot; the outbox waits and its predictions stay.
                            self.rows.clear();
                            let queued: Vec<Json> = self.outbox.iter().filter(|w| !self.acked.contains_key(w["id"].as_str().unwrap_or("")) && !self.failed.contains_key(w["id"].as_str().unwrap_or(""))).cloned().collect();
                            for write in &queued {
                                self.predict(write);
                            }
                            self.watermark = 0;
                            self.generation = generation;
                            self.rebootstraps += 1;
                            let _ = self.persist(ctx);
                            self.sync(ctx);
                            return;
                        }
                        self.generation = generation;
                        if watermark < self.watermark {
                            self.watermark_regressions += 1;
                            return;
                        }
                        let events = message["events"].as_array().cloned().unwrap_or_default();
                        self.apply(&events, snapshot);
                        self.watermark = watermark;
                        if !self.persist(ctx) {
                            // The batch is lost with the buffer; the next sync re-reads it.
                            self.restore(ctx);
                        }
                        if message["more"].as_bool().unwrap_or(false) {
                            self.sync(ctx);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn state(&self) -> String {
        let pending: Vec<&str> = self.outbox.iter().filter_map(|w| w["id"].as_str()).filter(|id| !self.acked.contains_key(*id) && !self.failed.contains_key(*id)).collect();
        let predicted = self.rows.get("messages").map(|m| m.values().filter(|r| r["pending"] == json!(true)).count()).unwrap_or(0);
        // The state a checker reads after every event stays small: ids per
        // table, the membership rows (a leave is judged on them), the counts.
        json!({
            "role": "replica",
            "viewer": self.viewer,
            "watermark": self.watermark,
            "held": self.rows.iter().map(|(t, rows)| (t.clone(), rows.keys().cloned().collect::<Vec<_>>())).collect::<BTreeMap<_, _>>(),
            "memberships": self.rows.get("memberships").cloned().unwrap_or_default(),
            "pending": pending,
            "acked": self.acked,
            "failed": self.failed,
            "predicted": predicted,
            "left": self.left,
            "reads": self.reads,
            "unadmitted": self.unadmitted,
            "watermark_regressions": self.watermark_regressions,
            "generation": self.generation,
            "rebootstraps": self.rebootstraps,
        })
        .to_string()
    }
}
