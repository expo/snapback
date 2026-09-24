//! A commit's ordered events, with per-key live positions for birth accounting.
// @ref LLP 3000#7-decisions-during-execution — withdrawal preserves every event before a row or grant's birth and the order of surviving events.
use super::{Event, EventKind};
use std::collections::HashMap;

type RowKey = (String, String);
type GrantKey = (String, String, String);

/// Positions never move during accounting. Withdrawing a key drains only
/// its suffix and releases those event images; taking the commit compacts
/// the remaining events in their original order. Map iteration order never
/// determines event order. All of this is unmetered log bookkeeping.
#[derive(Default)]
pub(crate) struct PendingEvents {
    slots: Vec<Option<Event>>,
    rows: HashMap<RowKey, Vec<usize>>,
    grants: HashMap<GrantKey, Vec<usize>>,
}

impl PendingEvents {
    pub(super) fn push(&mut self, event: Event) {
        let position = self.slots.len();
        match event.kind {
            EventKind::Put | EventKind::Del => {
                self.rows.entry((event.table.clone(), event.id.clone())).or_default().push(position);
            }
            EventKind::Join => {
                self.grants.entry((event.partition.clone(), event.table.clone(), event.id.clone())).or_default().push(position);
            }
            EventKind::Scope => {}
        }
        self.slots.push(Some(event));
    }

    pub(super) fn row_count(&self, key: &RowKey) -> usize {
        self.rows.get(key).map_or(0, Vec::len)
    }

    pub(super) fn grant_count(&self, key: &GrantKey) -> usize {
        self.grants.get(key).map_or(0, Vec::len)
    }

    pub(super) fn withdraw_row(&mut self, key: &RowKey, keep: usize) {
        Self::withdraw(&mut self.slots, self.rows.get_mut(key), keep);
    }

    pub(super) fn withdraw_grant(&mut self, key: &GrantKey, keep: usize) {
        Self::withdraw(&mut self.slots, self.grants.get_mut(key), keep);
    }

    fn withdraw(slots: &mut [Option<Event>], positions: Option<&mut Vec<usize>>, keep: usize) {
        if let Some(positions) = positions {
            // Like retain's old predicate, keeping more than exist is a no-op.
            for position in positions.drain(keep.min(positions.len())..) {
                slots[position] = None;
            }
        }
    }

    /// The only production read of the buffer: hand a dense Vec to existing
    /// commit writers, append/coalescing, event counts and native outcomes.
    pub(crate) fn take(&mut self) -> Vec<Event> {
        std::mem::take(self).slots.into_iter().flatten().collect()
    }

    #[cfg(test)]
    pub(super) fn iter(&self) -> impl Iterator<Item = &Event> {
        self.slots.iter().filter_map(Option::as_ref)
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.iter().next().is_none()
    }
}
