#![forbid(unsafe_code)]
//! Deterministic simulation for Snapback 4 (LLP 3000 §5 week 1, §6).
//!
//! One single-threaded program under a seed: a virtual clock, a scheduler,
//! a network that drops, duplicates, delays and partitions, disks whose
//! `fsync` can fail, and hosts that can be killed at any event boundary and
//! restarted from their durable state. Every run replays from its seed; the
//! trace digest is the proof. Nothing here allocates randomness or time from
//! the operating system.
//!
//! `host` is the real server core as a host; `replica` is a device with a
//! partition replica and a durable outbox; `chat` runs the chat schema under
//! faults and checks LLP 3000 §6's invariants. `demo` is the week-one
//! witness that the machinery is sound: a replicated counter with durable
//! admission, at-most-once application and convergence after faults stop.

pub mod chat;
pub mod demo;
pub mod disk;
pub mod host;
pub mod net;
pub mod replica;
pub mod rng;
pub mod trace;
pub mod world;

pub use disk::{Disk, FsyncFailed};
pub use net::{Faults, NetStats};
pub use rng::Rng;
pub use trace::Trace;
pub use world::{Ctx, Event, Host, HostFactory, HostId, Invariant, Sim};
