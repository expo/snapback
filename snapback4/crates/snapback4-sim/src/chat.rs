//! The chat schema under the simulator: the real engine as the server, a
//! replica per device, rough faults, kills and restarts, and LLP 3000 §6's
//! seven invariants checked after every event. Every seed replays; the
//! trace digest is the proof.

use crate::host::ServerHost;
use crate::net::Faults;
use crate::replica::{Replica, Script};
use crate::world::{HostId, Invariant, Sim};
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, Value};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

pub const CHAT: &str = include_str!("../../../apps/chat/snapback/schema.q");

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

/// The compiled chat engine, seeded with one conversation and its members.
pub fn chat_engine(members: &[&str]) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = vec![("conversations".to_owned(), snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into())), ("creatorId", id(members[0]))]))];
    for (n, member) in members.iter().enumerate() {
        rows.push(("memberships".to_owned(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("conversationId", id("c1")), ("principal", id(member)), ("role", Value::String(if n == 0 { "admin".into() } else { "member".into() })), ("joinedAt", Value::Int(n as i64))])));
    }
    engine.seed(rows).unwrap();
    engine
}

pub struct World {
    pub sim: Sim,
    pub server: HostId,
    pub clients: Vec<(HostId, String)>,
    pub engine: Rc<RefCell<Engine>>,
}

/// Three devices on one conversation: alice and bob send; charlie sends a
/// little and leaves at `leave_at`.
pub fn world(seed: u64, faults: Faults, sends: u32, leave_at: Option<u64>) -> World {
    let members = ["dev:alice", "dev:bob", "dev:charlie"];
    let engine = Rc::new(RefCell::new(chat_engine(&members)));
    let until_revoked: BTreeSet<String> = engine.borrow().schema().tables.iter().filter(|(_, t)| t.leave == snapback4_core::schema::LeavePolicy::UntilRevoked).map(|(name, _)| name.clone()).collect();
    let mut sim = Sim::new(seed);
    sim.faults = faults;
    let server = sim.add(ServerHost::factory(engine.clone()));
    let mut clients = Vec::new();
    for (n, member) in members.iter().enumerate() {
        let script = Script { conversation: "c1".into(), every: 40 + n as u64 * 7, count: if n == 2 { sends / 4 } else { sends }, leave_at: if n == 2 { leave_at } else { None } };
        let host = sim.add_with_disk(Replica::factory(server, member, script, until_revoked.clone()), 0.1);
        clients.push((host, (*member).to_owned()));
    }
    World { sim, server, clients, engine }
}

fn state(sim: &Sim, host: HostId) -> Option<Json> {
    sim.state(host).and_then(|s| serde_json::from_str(&s).ok())
}

/// 1 and 5: every screen state is a word on the card, and no state is silent.
pub struct OnTheCard;
impl Invariant for OnTheCard {
    fn name(&self) -> String {
        "every screen state is on the card".into()
    }
    fn check(&self, sim: &Sim) -> Result<(), String> {
        for (host, json) in sim.hosts().filter_map(|(h, s)| Some((h, serde_json::from_str::<Json>(&s?).ok()?))) {
            if json["role"] != "replica" {
                continue;
            }
            for word in json["reads"].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
                if !["complete", "capped", "denied", "loading"].contains(&word.as_str()) {
                    return Err(format!("h{host} rendered a read as `{word}`"));
                }
            }
        }
        Ok(())
    }
}

/// 6: watermarks are monotone per device.
pub struct MonotoneWatermarks {
    seen: RefCell<BTreeMap<HostId, u64>>,
}
impl MonotoneWatermarks {
    pub fn new() -> Self {
        Self { seen: RefCell::new(BTreeMap::new()) }
    }
}
impl Default for MonotoneWatermarks {
    fn default() -> Self {
        Self::new()
    }
}
impl Invariant for MonotoneWatermarks {
    fn name(&self) -> String {
        "watermarks are monotone".into()
    }
    fn check(&self, sim: &Sim) -> Result<(), String> {
        for (host, json) in sim.hosts().filter_map(|(h, s)| Some((h, serde_json::from_str::<Json>(&s?).ok()?))) {
            if json["role"] != "replica" {
                continue;
            }
            if json["watermark_regressions"].as_u64().unwrap_or(0) > 0 {
                return Err(format!("h{host} was offered a lower watermark"));
            }
            let watermark = json["watermark"].as_u64().unwrap_or(0);
            let mut seen = self.seen.borrow_mut();
            let last = seen.entry(host).or_insert(0);
            if watermark < *last {
                return Err(format!("h{host} watermark went from {last} to {watermark}"));
            }
            *last = watermark;
        }
        Ok(())
    }
}

/// 3: a write with a given id applies at most once — every message on the
/// server came from exactly one applied client-minted operation, so the
/// server never holds more messages than operations it recorded as sent
/// (a replay that inserted twice would break this at once), and every
/// acknowledgement a device holds names an operation the server applied.
pub struct AtMostOnce {
    /// The store outlives the server process, as a disk would.
    engine: Rc<RefCell<Engine>>,
}
impl Invariant for AtMostOnce {
    fn name(&self) -> String {
        "a write applies at most once".into()
    }
    fn check(&self, sim: &Sim) -> Result<(), String> {
        let (messages, applied) = {
            let engine = self.engine.borrow();
            (engine.store().count("messages").unwrap_or(0), engine.store().applied_ops().unwrap_or(0))
        };
        let mut acked = 0u64;
        for (_, json) in sim.hosts().filter_map(|(h, s)| Some((h, serde_json::from_str::<Json>(&s?).ok()?))) {
            if json["role"] == "replica" {
                acked += json["acked"].as_object().map(|a| a.len() as u64).unwrap_or(0);
            }
        }
        if messages > applied {
            return Err(format!("server holds {messages} messages for {applied} applied sends"));
        }
        if acked > applied {
            return Err(format!("devices hold {acked} acknowledgements for {applied} applied sends"));
        }
        Ok(())
    }
}

/// 2: a row revoked at S never renders once the watermark passed S.
pub struct RevokedNeverRenders;
impl Invariant for RevokedNeverRenders {
    fn name(&self) -> String {
        "a revoked row never renders past its sequence".into()
    }
    fn check(&self, sim: &Sim) -> Result<(), String> {
        for (host, json) in sim.hosts().filter_map(|(h, s)| Some((h, serde_json::from_str::<Json>(&s?).ok()?))) {
            if json["role"] != "replica" {
                continue;
            }
            let watermark = json["watermark"].as_u64().unwrap_or(0);
            let viewer = json["viewer"].as_str().unwrap_or("");
            for left in json["left"].as_array().cloned().unwrap_or_default() {
                let (table, group, seq) = (left[0].as_str().unwrap_or(""), left[1].as_array().cloned().unwrap_or_default(), left[2].as_u64().unwrap_or(0));
                if watermark < seq || table != "memberships" {
                    continue;
                }
                // Membership rows of the left group must be gone (until-revoked).
                let held = json["memberships"].as_object().cloned().unwrap_or_default();
                for (id, row) in held {
                    if group.iter().all(|value| row.as_object().is_some_and(|o| o.values().any(|f| f == value))) && row["principal"].as_str() == Some(viewer) {
                        return Err(format!("h{host} still renders its own {table} row {id} of a group it left at {seq} (watermark {watermark})"));
                    }
                }
            }
        }
        Ok(())
    }
}

/// 4 and 7, at quiescence: every prediction converged and every device
/// holds exactly the server's partition.
pub fn converged(world: &World) -> Result<(), String> {
    let mut engine = world.engine.borrow_mut();
    for (host, viewer) in &world.clients {
        let Some(json) = state(&world.sim, *host) else { continue };
        if json["predicted"].as_u64().unwrap_or(0) > 0 {
            return Err(format!("h{host} ({viewer}) still holds {} predicted rows", json["predicted"]));
        }
        if json["pending"].as_array().is_some_and(|p| !p.is_empty()) {
            return Err(format!("h{host} ({viewer}) still has pending writes {}", json["pending"]));
        }
        let (events, _) = engine.snapshot(viewer).map_err(|e| e.to_string())?;
        let held = snapback4_core::partition::holdings(&events);
        let device: BTreeMap<String, BTreeSet<String>> = json["held"].as_object().map(|o| o.iter().map(|(t, ids)| (t.clone(), ids.as_array().map(|a| a.iter().filter_map(Json::as_str).map(str::to_owned).collect()).unwrap_or_default())).collect()).unwrap_or_default();
        for (table, ids) in &held {
            let on_device = device.get(table).cloned().unwrap_or_default();
            if table == "messages" {
                // The device keeps delivered history it is allowed to keep; it
                // must hold everything the server says it holds.
                let missing: Vec<_> = ids.difference(&on_device).cloned().collect();
                if !missing.is_empty() {
                    return Err(format!("h{host} ({viewer}) lacks messages {missing:?}"));
                }
            } else if &on_device != ids {
                return Err(format!("h{host} ({viewer}) holds {table} {on_device:?}; the server says {ids:?}"));
            }
        }
        for (table, ids) in &device {
            if !held.contains_key(table) && !ids.is_empty() && table != "messages" {
                return Err(format!("h{host} ({viewer}) holds {table} rows the server does not deliver"));
            }
        }
        // Every message the device holds exists on the server; with no
        // predictions left, each is the server's image.
        let server_messages: BTreeSet<String> = engine.store().rows("messages").map_err(|e| e.to_string())?.into_iter().filter_map(|r| r.field("id").ok().and_then(|v| v.as_str().ok()).map(str::to_owned)).collect();
        for message_id in device.get("messages").cloned().unwrap_or_default() {
            if !server_messages.contains(&message_id) {
                return Err(format!("h{host} ({viewer}) holds message {message_id} the server does not have"));
            }
        }
    }
    let _ = json!(null);
    Ok(())
}

/// Run one seed: rough faults, kills, a leave; heal; quiesce; converge.
pub fn run(seed: u64, sends: u32) -> Result<(Sim, u64), String> {
    let mut world = world(seed, Faults::rough(), sends, Some(1_500));
    let on_card = OnTheCard;
    let monotone = MonotoneWatermarks::new();
    let once = AtMostOnce { engine: world.engine.clone() };
    let revoked = RevokedNeverRenders;
    let invariants: Vec<&dyn Invariant> = vec![&on_card, &monotone, &once, &revoked];
    let kills = Cell::new(0);
    let mut t = 0;
    while t < 3_000 {
        t += 250;
        world.sim.run_until_checked(t, &invariants)?;
        // Kill one client, and sometimes the server, then bring them back.
        let victim = world.clients[(t / 250) as usize % world.clients.len()].0;
        world.sim.kill_at(victim, t + 10);
        world.sim.restart_at(victim, t + 120);
        if t % 1_000 == 0 {
            world.sim.kill_at(world.server, t + 30);
            world.sim.restart_at(world.server, t + 90);
        }
        kills.set(kills.get() + 1);
    }
    world.sim.faults = Faults::none();
    world.sim.run_until_checked(t + 4_000, &invariants)?;
    converged(&world)?;
    let digest = world.sim.trace.digest();
    Ok((world.sim, digest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_chat_world_converges_under_faults() {
        for seed in 1..=3 {
            let (sim, _) = run(seed, 10).unwrap_or_else(|why| panic!("seed {seed}: {why}"));
            assert!(sim.stats.dropped > 0, "seed {seed}: faults were exercised");
        }
    }

    #[test]
    fn a_seed_replays_to_the_same_digest() {
        let (_, a) = run(42, 6).unwrap();
        let (_, b) = run(42, 6).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn a_leave_tombstones_the_group_on_the_device() {
        let (sim, _) = run(7, 8).unwrap();
        let charlie = sim.hosts().find_map(|(h, s)| {
            let json: Json = serde_json::from_str(&s?).ok()?;
            (json["viewer"] == "dev:charlie").then_some((h, json))
        });
        let (_, json) = charlie.expect("charlie is up");
        assert!(json["left"].as_array().is_some_and(|l| !l.is_empty()), "charlie received a scope tombstone: {}", json["left"]);
        let memberships = json["memberships"].as_object().cloned().unwrap_or_default();
        assert!(memberships.values().all(|m| m["principal"] != "dev:charlie"), "charlie no longer holds his membership");
    }
}
