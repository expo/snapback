//! The scheduler, the hosts and the invariant checks.

use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

use crate::disk::Disk;
use crate::net::{Faults, NetStats};
use crate::rng::Rng;
use crate::trace::Trace;

pub type HostId = u32;

/// What a host is told.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Deliver { from: HostId, payload: Vec<u8> },
    Timer { tag: u64 },
}

/// A host is a state machine. It never sleeps, never reads a clock it was
/// not handed, and persists only through `ctx.disk`. `state` is the
/// invariant checker's view of it.
pub trait Host {
    /// Called on the first run and after every restart; reload from `ctx.disk` here.
    fn start(&mut self, ctx: &mut Ctx<'_>);
    fn on(&mut self, ctx: &mut Ctx<'_>, event: Event);
    fn state(&self) -> String;
}

pub type HostFactory = Box<dyn Fn() -> Box<dyn Host>>;

/// What a host may do while it handles one event.
pub struct Ctx<'a> {
    pub now: u64,
    pub id: HostId,
    pub incarnation: u32,
    pub rng: &'a mut Rng,
    pub disk: &'a mut Disk,
    outbox: Vec<(HostId, Vec<u8>)>,
    timers: Vec<(u64, u64)>,
    log: Vec<String>,
}

impl Ctx<'_> {
    pub fn send(&mut self, to: HostId, payload: impl Into<Vec<u8>>) {
        self.outbox.push((to, payload.into()));
    }

    /// Wake this host `after` milliseconds from now with `tag`.
    pub fn timer(&mut self, after: u64, tag: u64) {
        self.timers.push((after, tag));
    }

    pub fn log(&mut self, line: impl Into<String>) {
        self.log.push(line.into());
    }
}

#[derive(Debug)]
enum Item {
    Deliver { from: HostId, payload: Vec<u8> },
    Timer { tag: u64 },
    Kill,
    Restart,
}

struct Scheduled {
    at: u64,
    seq: u64,
    host: HostId,
    item: Item,
}

impl PartialEq for Scheduled {
    fn eq(&self, other: &Self) -> bool {
        self.at == other.at && self.seq == other.seq
    }
}
impl Eq for Scheduled {}
impl PartialOrd for Scheduled {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Scheduled {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.at, self.seq).cmp(&(other.at, other.seq))
    }
}

struct Slot {
    factory: HostFactory,
    host: Option<Box<dyn Host>>,
    disk: Disk,
    incarnation: u32,
}

/// A property of the whole world, checked between events.
pub trait Invariant {
    fn name(&self) -> String;
    fn check(&self, sim: &Sim) -> Result<(), String>;
}

pub struct Sim {
    pub now: u64,
    seq: u64,
    rng: Rng,
    slots: Vec<Slot>,
    queue: BinaryHeap<Reverse<Scheduled>>,
    pub faults: Faults,
    pub trace: Trace,
    pub stats: NetStats,
}

impl Sim {
    pub fn new(seed: u64) -> Self {
        Sim {
            now: 0,
            seq: 0,
            rng: Rng::seed(seed),
            slots: Vec::new(),
            queue: BinaryHeap::new(),
            faults: Faults::none(),
            trace: Trace::new(),
            stats: NetStats::default(),
        }
    }

    /// Add a host and start it now. The factory is what a restart calls.
    pub fn add(&mut self, factory: HostFactory) -> HostId {
        let id = self.slots.len() as HostId;
        self.slots.push(Slot { host: None, factory, disk: Disk::default(), incarnation: 0 });
        self.boot(id);
        id
    }

    /// The same, with a disk that fails `fsync` with probability `fsync_fail`.
    pub fn add_with_disk(&mut self, factory: HostFactory, fsync_fail: f64) -> HostId {
        let id = self.slots.len() as HostId;
        let disk = Disk::with_fsync_fail(fsync_fail);
        self.slots.push(Slot { host: None, factory, disk, incarnation: 0 });
        self.boot(id);
        id
    }

    pub fn alive(&self, id: HostId) -> bool {
        self.slots[id as usize].host.is_some()
    }

    pub fn state(&self, id: HostId) -> Option<String> {
        self.slots[id as usize].host.as_ref().map(|h| h.state())
    }

    pub fn disk(&self, id: HostId) -> &Disk {
        &self.slots[id as usize].disk
    }

    pub fn hosts(&self) -> impl Iterator<Item = (HostId, Option<String>)> + '_ {
        self.slots.iter().enumerate().map(|(i, s)| (i as HostId, s.host.as_ref().map(|h| h.state())))
    }

    pub fn kill_at(&mut self, id: HostId, at: u64) {
        self.push(at.max(self.now), id, Item::Kill);
    }

    pub fn restart_at(&mut self, id: HostId, at: u64) {
        self.push(at.max(self.now), id, Item::Restart);
    }

    /// Run every event scheduled at or before `t`, then set the clock to `t`.
    pub fn run_until(&mut self, t: u64) {
        while let Some(Reverse(next)) = self.queue.peek() {
            if next.at > t {
                break;
            }
            let Reverse(s) = self.queue.pop().expect("peeked");
            self.now = s.at;
            self.dispatch(s.host, s.item);
        }
        self.now = self.now.max(t);
    }

    pub fn run_for(&mut self, d: u64) {
        let t = self.now + d;
        self.run_until(t);
    }

    /// Run until `t`, checking `invariants` after every event; the first
    /// violation returns with the trace tail.
    pub fn run_until_checked(&mut self, t: u64, invariants: &[&dyn Invariant]) -> Result<(), String> {
        while let Some(Reverse(next)) = self.queue.peek() {
            if next.at > t {
                break;
            }
            let Reverse(s) = self.queue.pop().expect("peeked");
            self.now = s.at;
            self.dispatch(s.host, s.item);
            self.check_all(invariants)?;
        }
        self.now = self.now.max(t);
        self.check_all(invariants)
    }

    pub fn check_all(&self, invariants: &[&dyn Invariant]) -> Result<(), String> {
        for inv in invariants {
            if let Err(why) = inv.check(self) {
                return Err(format!(
                    "invariant `{}` violated at t={}: {why}\n--- trace tail ---\n{}",
                    inv.name(),
                    self.now,
                    self.trace.tail(40)
                ));
            }
        }
        Ok(())
    }

    fn push(&mut self, at: u64, host: HostId, item: Item) {
        self.seq += 1;
        self.queue.push(Reverse(Scheduled { at, seq: self.seq, host, item }));
    }

    fn boot(&mut self, id: HostId) {
        let slot = &mut self.slots[id as usize];
        let mut host = (slot.factory)();
        slot.incarnation += 1;
        let incarnation = slot.incarnation;
        let mut ctx = Ctx {
            now: self.now,
            id,
            incarnation,
            rng: &mut self.rng,
            disk: &mut slot.disk,
            outbox: Vec::new(),
            timers: Vec::new(),
            log: Vec::new(),
        };
        host.start(&mut ctx);
        let Ctx { outbox, timers, log, .. } = ctx;
        slot.host = Some(host);
        self.trace.record(self.now, format!("h{id} start#{incarnation}"));
        self.absorb(id, outbox, timers, log);
    }

    fn dispatch(&mut self, id: HostId, item: Item) {
        match item {
            Item::Kill => {
                let slot = &mut self.slots[id as usize];
                if slot.host.take().is_some() {
                    slot.disk.crash();
                    self.trace.record(self.now, format!("h{id} kill"));
                }
            }
            Item::Restart => {
                if self.slots[id as usize].host.is_none() {
                    self.boot(id);
                }
            }
            Item::Deliver { from, payload } => {
                if !self.alive(id) {
                    self.stats.lost_to_dead_host += 1;
                    self.trace.record(self.now, format!("h{from}->h{id} lost (dead)"));
                    return;
                }
                self.stats.delivered += 1;
                self.trace.record(self.now, format!("h{from}->h{id} {}", String::from_utf8_lossy(&payload)));
                self.handle(id, Event::Deliver { from, payload });
            }
            Item::Timer { tag } => {
                if self.alive(id) {
                    self.handle(id, Event::Timer { tag });
                }
            }
        }
    }

    fn handle(&mut self, id: HostId, event: Event) {
        let Sim { slots, rng, now, .. } = self;
        let slot = &mut slots[id as usize];
        let Some(mut host) = slot.host.take() else { return };
        let mut ctx = Ctx {
            now: *now,
            id,
            incarnation: slot.incarnation,
            rng,
            disk: &mut slot.disk,
            outbox: Vec::new(),
            timers: Vec::new(),
            log: Vec::new(),
        };
        host.on(&mut ctx, event);
        let Ctx { outbox, timers, log, .. } = ctx;
        slot.host = Some(host);
        self.absorb(id, outbox, timers, log);
    }

    fn absorb(&mut self, from: HostId, outbox: Vec<(HostId, Vec<u8>)>, timers: Vec<(u64, u64)>, log: Vec<String>) {
        for line in log {
            self.trace.record(self.now, format!("h{from}: {line}"));
        }
        for (after, tag) in timers {
            let at = self.now + after;
            self.push(at, from, Item::Timer { tag });
        }
        for (to, payload) in outbox {
            self.stats.sent += 1;
            if self.faults.is_partitioned(from, to) || self.rng.chance(self.faults.drop) {
                self.stats.dropped += 1;
                self.trace.record(self.now, format!("h{from}->h{to} dropped"));
                continue;
            }
            let (lo, hi) = self.faults.delay;
            let at = self.now + self.rng.between(lo, hi);
            let dup = self.rng.chance(self.faults.duplicate);
            if dup {
                self.stats.duplicated += 1;
                let at2 = self.now + self.rng.between(lo, hi);
                self.push(at2, to, Item::Deliver { from, payload: payload.clone() });
            }
            self.push(at, to, Item::Deliver { from, payload });
        }
    }
}
