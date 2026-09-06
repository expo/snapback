use super::{RowRecord, Value};
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;

// @ref LLP 1001#2-what-a-commit-records — index identities, never row images
// or authority. The ordered vectors remain the source of truth. Each bucket
// holds (trace row offset + 1) and one receipt-membership bit; no cloned keys.
// At <= 1/2 occupancy the index uses <32 bytes per retained identity (64-bit),
// <48 during growth. The existing five steps per scan candidate reserve 160
// heap bytes; probes/points also reserve at least five. No new wire/meter work.
#[derive(Default)]
pub(super) struct RowMembership {
    buckets: Vec<usize>,
    hasher: RandomState,
}

impl RowMembership {
    fn slot(&self, rows: &[RowRecord], table: &str, id: &str) -> usize {
        let mask = self.buckets.len() - 1;
        let mut slot = self.hasher.hash_one((table, id)) as usize & mask;
        loop {
            let entry = self.buckets[slot];
            if entry == 0
                || rows
                    .get((entry >> 1) - 1)
                    .is_some_and(|row| row.table == table && row.id == id)
            {
                return slot;
            }
            slot = (slot + 1) & mask;
        }
    }

    pub(super) fn contains(&self, rows: &[RowRecord], table: &str, id: &str) -> bool {
        if self.buckets.is_empty() {
            return false;
        }
        let entry = self.buckets[self.slot(rows, table, id)];
        entry != 0
            && rows
                .get((entry >> 1) - 1)
                .is_some_and(|row| row.table == table && row.id == id)
    }

    pub(super) fn record(
        &mut self,
        trace: &mut Vec<RowRecord>,
        receipt: &mut Vec<RowRecord>,
        table: &str,
        id: &str,
        row: &Value,
        client: bool,
    ) {
        if self.buckets.is_empty() {
            self.buckets.resize(2, 0);
        }
        let mut slot = self.slot(trace, table, id);
        if self.buckets[slot] == 0 {
            if trace.len() == self.buckets.len() / 2 {
                let grown = vec![0; self.buckets.len() * 2];
                let old = std::mem::replace(&mut self.buckets, grown);
                for entry in old.into_iter().filter(|entry| *entry != 0) {
                    let record = &trace[(entry >> 1) - 1];
                    let slot = self.slot(trace, &record.table, &record.id);
                    self.buckets[slot] = entry;
                }
                slot = self.slot(trace, table, id);
            }
            trace.push(RowRecord {
                table: table.to_owned(),
                id: id.to_owned(),
                row: row.clone(),
            });
            self.buckets[slot] = trace.len() << 1;
        }
        if client && self.buckets[slot] & 1 == 0 {
            // A prior hidden observation can have a different first image.
            receipt.push(RowRecord {
                table: table.to_owned(),
                id: id.to_owned(),
                row: row.clone(),
            });
            self.buckets[slot] |= 1;
        }
    }

    pub(super) fn remove_receipt(&mut self, rows: &[RowRecord], table: &str, id: &str) {
        let slot = self.slot(rows, table, id);
        self.buckets[slot] &= !1;
    }
}
