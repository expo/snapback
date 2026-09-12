//! The week-one witness: a replicated counter. Clients mint an operation id,
//! persist it before sending (durable admission), retry until acked; the
//! server applies each id at most once and acks only what it has fsynced.
//! After faults stop, every client converges on the server's sequence.
//!
//! This is the shape of Snapback 4's outbox and partition stream in
//! miniature, so the invariants here are LLP 3000 §6's 3, 4, 6 and 7 in
//! their smallest form.

use crate::world::{Ctx, Event, Host, HostId, Invariant, Sim};

const T_NEXT_OP: u64 = 0;
const T_RETRY: u64 = 1;
const T_POLL: u64 = 2;

pub struct Server {
    ops: Vec<String>,
}

impl Server {
    pub fn new() -> Box<dyn Host> {
        Box::new(Server { ops: Vec::new() })
    }

    fn persist(&self, ctx: &mut Ctx<'_>) -> bool {
        ctx.disk.write("log", self.ops.join(",").into_bytes());
        ctx.disk.fsync(ctx.rng).is_ok()
    }
}

impl Host for Server {
    fn start(&mut self, ctx: &mut Ctx<'_>) {
        self.ops = ctx
            .disk
            .read("log")
            .map(|b| String::from_utf8_lossy(b).split(',').filter(|s| !s.is_empty()).map(String::from).collect())
            .unwrap_or_default();
        ctx.log(format!("server up with {} ops", self.ops.len()));
    }

    fn on(&mut self, ctx: &mut Ctx<'_>, event: Event) {
        let Event::Deliver { from, payload } = event else { return };
        let text = String::from_utf8_lossy(&payload).into_owned();
        let mut words = text.split(' ');
        match words.next() {
            Some("INC") => {
                let op = words.next().unwrap_or("").to_string();
                if let Some(pos) = self.ops.iter().position(|o| *o == op) {
                    ctx.send(from, format!("ACK {op} {}", pos + 1));
                    return;
                }
                self.ops.push(op.clone());
                if self.persist(ctx) {
                    let seq = self.ops.len();
                    ctx.send(from, format!("ACK {op} {seq}"));
                } else {
                    self.ops.pop();
                    ctx.log(format!("fsync failed; {op} not applied"));
                }
            }
            Some("GET") => ctx.send(from, format!("SEQ {}", self.ops.len())),
            _ => {}
        }
    }

    fn state(&self) -> String {
        format!("server seq={} ops={}", self.ops.len(), self.ops.join(","))
    }
}

pub struct Client {
    server: HostId,
    ops_to_send: u32,
    minted: u32,
    pending: Option<String>,
    acked: Vec<String>,
    seen: u64,
}

impl Client {
    pub fn new(server: HostId, ops_to_send: u32) -> Box<dyn Host> {
        Box::new(Client { server, ops_to_send, minted: 0, pending: None, acked: Vec::new(), seen: 0 })
    }

    fn persist(&self, ctx: &mut Ctx<'_>) -> bool {
        let state = format!("{}|{}|{}", self.minted, self.pending.clone().unwrap_or_default(), self.acked.join(","));
        ctx.disk.write("client", state.into_bytes());
        ctx.disk.fsync(ctx.rng).is_ok()
    }
}

impl Host for Client {
    fn start(&mut self, ctx: &mut Ctx<'_>) {
        if let Some(bytes) = ctx.disk.read("client") {
            let text = String::from_utf8_lossy(bytes).into_owned();
            let mut parts = text.splitn(3, '|');
            self.minted = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            self.pending = parts.next().filter(|s| !s.is_empty()).map(String::from);
            self.acked = parts.next().map(|s| s.split(',').filter(|s| !s.is_empty()).map(String::from).collect()).unwrap_or_default();
        }
        ctx.log(format!("client up minted={} pending={:?} acked={}", self.minted, self.pending, self.acked.len()));
        if self.pending.is_some() {
            ctx.timer(1, T_RETRY);
        } else {
            ctx.timer(5, T_NEXT_OP);
        }
        ctx.timer(25, T_POLL);
    }

    fn on(&mut self, ctx: &mut Ctx<'_>, event: Event) {
        match event {
            Event::Timer { tag: T_NEXT_OP } => {
                if self.pending.is_none() && self.minted < self.ops_to_send {
                    self.minted += 1;
                    let op = format!("c{}-{}", ctx.id, self.minted);
                    self.pending = Some(op.clone());
                    if !self.persist(ctx) {
                        // Admission failed durably: forget the op; it was never sent.
                        self.minted -= 1;
                        self.pending = None;
                        ctx.timer(5, T_NEXT_OP);
                        return;
                    }
                    ctx.send(self.server, format!("INC {op}"));
                    ctx.timer(30, T_RETRY);
                }
            }
            Event::Timer { tag: T_RETRY } => {
                if let Some(op) = &self.pending {
                    ctx.send(self.server, format!("INC {op}"));
                    ctx.timer(30, T_RETRY);
                }
            }
            Event::Timer { tag: T_POLL } => {
                ctx.send(self.server, "GET");
                ctx.timer(25, T_POLL);
            }
            Event::Timer { .. } => {}
            Event::Deliver { payload, .. } => {
                let text = String::from_utf8_lossy(&payload).into_owned();
                let mut words = text.split(' ');
                match words.next() {
                    Some("ACK") => {
                        let op = words.next().unwrap_or("");
                        let seq: u64 = words.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                        if self.pending.as_deref() == Some(op) {
                            self.pending = None;
                            self.acked.push(op.to_string());
                            self.seen = self.seen.max(seq);
                            // The ack is remembered only if it can be made durable; otherwise
                            // the op stays pending and is resent, which the server tolerates.
                            if !self.persist(ctx) {
                                self.acked.pop();
                                self.pending = Some(op.to_string());
                                ctx.timer(1, T_RETRY);
                                return;
                            }
                            ctx.timer(5, T_NEXT_OP);
                        }
                    }
                    Some("SEQ") => {
                        let seq: u64 = words.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                        self.seen = self.seen.max(seq);
                    }
                    _ => {}
                }
            }
        }
    }

    fn state(&self) -> String {
        format!(
            "client pending={} seen={} acked={}",
            self.pending.clone().unwrap_or_else(|| "none".into()),
            self.seen,
            self.acked.join(",")
        )
    }
}

fn server_ops(sim: &Sim, server: HostId) -> Option<Vec<String>> {
    let state = sim.state(server)?;
    let ops = state.split("ops=").nth(1).unwrap_or("");
    Some(ops.split(',').filter(|s| !s.is_empty()).map(String::from).collect())
}

/// LLP 3000 §6 invariant 3 in miniature: an operation id is applied at most once.
pub struct AtMostOnce {
    pub server: HostId,
}

impl Invariant for AtMostOnce {
    fn name(&self) -> String {
        "at-most-once".into()
    }

    fn check(&self, sim: &Sim) -> Result<(), String> {
        let Some(ops) = server_ops(sim, self.server) else { return Ok(()) };
        let mut sorted = ops.clone();
        sorted.sort();
        sorted.dedup();
        if sorted.len() == ops.len() { Ok(()) } else { Err(format!("duplicate op applied: {ops:?}")) }
    }
}

/// Durable admission: an op a client remembers as acked is in the server's
/// durable log, even after the server was killed and restarted.
pub struct AckedIsDurable {
    pub server: HostId,
    pub clients: Vec<HostId>,
}

impl Invariant for AckedIsDurable {
    fn name(&self) -> String {
        "acked-is-durable".into()
    }

    fn check(&self, sim: &Sim) -> Result<(), String> {
        let durable = sim.disk(self.server).read("log").map(|b| String::from_utf8_lossy(b).into_owned()).unwrap_or_default();
        let durable: Vec<&str> = durable.split(',').collect();
        for &c in &self.clients {
            let Some(state) = sim.state(c) else { continue };
            let acked = state.split("acked=").nth(1).unwrap_or("");
            for op in acked.split(',').filter(|s| !s.is_empty()) {
                if !durable.contains(&op) {
                    return Err(format!("client h{c} holds ack for {op} but the server's durable log lacks it"));
                }
            }
        }
        Ok(())
    }
}

/// LLP 3000 §6 invariant 7 in miniature: after faults stop, every live
/// client has seen the server's sequence.
pub struct Converged {
    pub server: HostId,
    pub clients: Vec<HostId>,
}

impl Invariant for Converged {
    fn name(&self) -> String {
        "converged".into()
    }

    fn check(&self, sim: &Sim) -> Result<(), String> {
        let Some(ops) = server_ops(sim, self.server) else { return Err("server is down".into()) };
        let seq = ops.len() as u64;
        for &c in &self.clients {
            let Some(state) = sim.state(c) else { return Err(format!("client h{c} is down")) };
            let seen: u64 = state.split("seen=").nth(1).and_then(|s| s.split(' ').next()).and_then(|s| s.parse().ok()).unwrap_or(0);
            if state.contains("pending=c") {
                return Err(format!("client h{c} still has a pending op: {state}"));
            }
            if seen != seq {
                return Err(format!("client h{c} seen={seen} but server seq={seq}"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::Faults;
    use crate::rng::Rng;

    struct World {
        sim: Sim,
        server: HostId,
        clients: Vec<HostId>,
    }

    fn world(seed: u64, clients: u32, ops_each: u32, faults: Faults, fsync_fail: f64) -> World {
        let mut sim = Sim::new(seed);
        sim.faults = faults;
        let server = sim.add_with_disk(Box::new(Server::new), fsync_fail);
        let clients = (0..clients)
            .map(|_| sim.add_with_disk(Box::new(move || Client::new(server, ops_each)), fsync_fail))
            .collect();
        World { sim, server, clients }
    }

    fn chaos(w: &mut World, seed: u64, until: u64, kills: u32) {
        let mut r = Rng::seed(seed);
        let all: Vec<HostId> = std::iter::once(w.server).chain(w.clients.iter().copied()).collect();
        for _ in 0..kills {
            let host = all[r.below(all.len() as u64) as usize];
            let at = r.between(1, until);
            w.sim.kill_at(host, at);
            w.sim.restart_at(host, at + r.between(5, 80));
        }
    }

    #[test]
    fn same_seed_same_trace() {
        let run = || {
            let mut w = world(7, 3, 10, Faults::rough(), 0.1);
            chaos(&mut w, 7, 3_000, 12);
            w.sim.run_until(6_000);
            (w.sim.trace.digest(), w.sim.trace.len(), w.sim.state(w.server))
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn different_seeds_differ() {
        let digest = |seed| {
            let mut w = world(seed, 3, 10, Faults::rough(), 0.1);
            chaos(&mut w, seed, 3_000, 12);
            w.sim.run_until(6_000);
            w.sim.trace.digest()
        };
        assert_ne!(digest(7), digest(8));
    }

    #[test]
    fn faults_and_kills_keep_the_invariants_and_then_converge() {
        for seed in 1..=20 {
            let mut w = world(seed, 4, 8, Faults::rough(), 0.15);
            chaos(&mut w, seed * 31, 4_000, 16);
            let amo = AtMostOnce { server: w.server };
            let dur = AckedIsDurable { server: w.server, clients: w.clients.clone() };
            w.sim
                .run_until_checked(4_500, &[&amo, &dur])
                .unwrap_or_else(|e| panic!("seed {seed}: {e}"));
            assert!(w.sim.stats.dropped > 0 && w.sim.stats.duplicated > 0, "faults never fired for seed {seed}");
            // Faults stop; everyone is up; the world quiesces.
            w.sim.faults = Faults::none();
            for &c in &w.clients {
                if !w.sim.alive(c) {
                    let now = w.sim.now;
                    w.sim.restart_at(c, now);
                }
            }
            if !w.sim.alive(w.server) {
                let now = w.sim.now;
                w.sim.restart_at(w.server, now);
            }
            w.sim.run_until_checked(w.sim.now + 3_000, &[&amo, &dur]).unwrap_or_else(|e| panic!("seed {seed}: {e}"));
            let conv = Converged { server: w.server, clients: w.clients.clone() };
            w.sim.check_all(&[&conv]).unwrap_or_else(|e| panic!("seed {seed}: {e}"));
            let ops = server_ops(&w.sim, w.server).unwrap();
            assert_eq!(ops.len(), 4 * 8, "seed {seed}: every minted op lands exactly once: {ops:?}");
        }
    }

    #[test]
    fn a_partition_heals() {
        let mut w = world(3, 2, 5, Faults::none(), 0.0);
        w.sim.faults.partition(w.server, w.clients[0]);
        w.sim.run_until(500);
        assert!(w.sim.stats.dropped > 0);
        let before = server_ops(&w.sim, w.server).unwrap().len();
        assert!(before < 10, "the partitioned client cannot have landed everything: {before}");
        w.sim.faults.heal();
        w.sim.run_until(2_000);
        assert_eq!(server_ops(&w.sim, w.server).unwrap().len(), 10);
        let conv = Converged { server: w.server, clients: w.clients.clone() };
        w.sim.check_all(&[&conv]).unwrap();
    }
}
