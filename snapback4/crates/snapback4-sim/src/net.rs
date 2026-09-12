//! Network faults and the counts they produce. The scheduler applies them
//! when a host sends; deliveries to a dead host are lost like packets to a
//! closed port.

use std::collections::BTreeSet;

use crate::world::HostId;

#[derive(Debug, Clone)]
pub struct Faults {
    /// Probability a message is dropped.
    pub drop: f64,
    /// Probability a delivered message is delivered twice.
    pub duplicate: f64,
    /// Delivery delay, inclusive bounds in virtual milliseconds; a wide range reorders.
    pub delay: (u64, u64),
    /// Directed pairs that cannot currently talk.
    pub partitions: BTreeSet<(HostId, HostId)>,
}

impl Faults {
    pub fn none() -> Self {
        Faults { drop: 0.0, duplicate: 0.0, delay: (1, 1), partitions: BTreeSet::new() }
    }

    /// A bad day: a fifth of messages lost, a tenth doubled, delays that reorder.
    pub fn rough() -> Self {
        Faults { drop: 0.2, duplicate: 0.1, delay: (1, 40), partitions: BTreeSet::new() }
    }

    pub fn partition(&mut self, a: HostId, b: HostId) {
        self.partitions.insert((a, b));
        self.partitions.insert((b, a));
    }

    pub fn heal(&mut self) {
        self.partitions.clear();
    }

    pub fn is_partitioned(&self, from: HostId, to: HostId) -> bool {
        self.partitions.contains(&(from, to))
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NetStats {
    pub sent: u64,
    pub dropped: u64,
    pub duplicated: u64,
    pub delivered: u64,
    pub lost_to_dead_host: u64,
}
