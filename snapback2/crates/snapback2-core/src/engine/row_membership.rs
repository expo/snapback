use super::{RowRecord, Value};
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;

// @ref LLP 1001#2-what-a-commit-records — index identities, never row images
// or authority. The ordered vectors remain the source of truth. Each bucket
// holds (trace row offset + 1), a receipt bit and a current-image bit; no cloned keys.
// At <= 1/2 occupancy the index uses <32 bytes per retained identity (64-bit),
// <48 during growth. The existing five steps per scan candidate reserve 160
// heap bytes; probes/points also reserve at least five. No new wire/meter work.
#[derive(Default)]
pub(super) struct RowMembership {
    buckets: Vec<usize>,
    hasher: RandomState,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::object;

    #[test]
    fn current_images_survive_growth_but_never_replace_distinct_first_images() {
        let mut membership = RowMembership::default();
        let (mut trace, mut receipt) = (Vec::new(), Vec::new());
        for n in 0..100 {
            let id = n.to_string();
            let row = object([("id", Value::Id(id.clone())), ("value", Value::Int(n))]);
            membership.record(&mut trace, &mut receipt, "items", &id, &row, false);
            if n % 2 == 0 { membership.invalidate(&trace, "items", &id); }
        }
        for n in 0..100 {
            assert_eq!(membership.current(&trace, "items", &n.to_string()).is_some(), n % 2 != 0);
        }
        assert!(membership.current(&trace, "other", "1").is_none());
        membership.invalidate(&trace, "items", "missing");
        let next = object([("id", Value::Id("0".into())), ("value", Value::Int(999))]);
        membership.record(&mut trace, &mut receipt, "items", "0", &next, true);
        assert_eq!(trace[0].row.field("value").unwrap(), &Value::Int(0));
        assert_eq!(receipt[0].row, next);
        assert!(membership.current(&trace, "items", "0").is_none());
        membership.remove_receipt(&trace, "items", "0");
        receipt.clear();
        membership.record(&mut trace, &mut receipt, "items", "0", &next, true);
        assert_eq!(receipt[0].row, next);
        assert!(membership.current(&trace, "items", "0").is_none());
    }
}

impl RowMembership {
    fn slot(&self, rows: &[RowRecord], table: &str, id: &str) -> usize {
        let mask = self.buckets.len() - 1;
        let mut slot = self.hasher.hash_one((table, id)) as usize & mask;
        loop {
            let entry = self.buckets[slot];
            if entry == 0
                || rows
                    .get((entry >> 2) - 1)
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
                .get((entry >> 2) - 1)
                .is_some_and(|row| row.table == table && row.id == id)
    }

    // @ref LLP 1001#native-owner-image-pipeline — only a still-current first
    // trace image is reusable. Later receipt images never replace that image.
    pub(super) fn current<'a>(&self, rows: &'a [RowRecord], table: &str, id: &str) -> Option<&'a Value> {
        if self.buckets.is_empty() { return None; }
        let entry = self.buckets[self.slot(rows, table, id)];
        (entry & 2 != 0).then(|| &rows[(entry >> 2) - 1].row)
    }

    pub(super) fn invalidate(&mut self, rows: &[RowRecord], table: &str, id: &str) {
        if !self.buckets.is_empty() {
            let slot = self.slot(rows, table, id);
            self.buckets[slot] &= !2;
        }
    }

    pub(super) fn record(
        &mut self,
        trace: &mut Vec<RowRecord>,
        receipt: &mut Vec<RowRecord>,
        table: &str,
        id: &str,
        row: &Value,
        client: bool,
    ) -> u64 {
        let mut retained = 0;
        if self.buckets.is_empty() {
            self.buckets.resize(2, 0);
        }
        let mut slot = self.slot(trace, table, id);
        if self.buckets[slot] == 0 {
            if trace.len() == self.buckets.len() / 2 {
                let grown = vec![0; self.buckets.len() * 2];
                let old = std::mem::replace(&mut self.buckets, grown);
                for entry in old.into_iter().filter(|entry| *entry != 0) {
                    let record = &trace[(entry >> 2) - 1];
                    let slot = self.slot(trace, &record.table, &record.id);
                    self.buckets[slot] = entry;
                }
                slot = self.slot(trace, table, id);
            }
            retained += row.heap_bytes();
            trace.push(RowRecord {
                table: table.to_owned(),
                id: id.to_owned(),
                row: row.clone(),
            });
            self.buckets[slot] = (trace.len() << 2) | 2;
        }
        if client && self.buckets[slot] & 1 == 0 {
            // A prior hidden observation can have a different first image.
            let first = &trace[(self.buckets[slot] >> 2) - 1].row;
            let image = if first == row {
                first.clone()
            } else {
                retained += row.heap_bytes();
                row.clone()
            };
            receipt.push(RowRecord {
                table: table.to_owned(),
                id: id.to_owned(),
                row: image,
            });
            self.buckets[slot] |= 1;
        }
        retained
    }

    pub(super) fn remove_receipt(&mut self, rows: &[RowRecord], table: &str, id: &str) {
        let slot = self.slot(rows, table, id);
        self.buckets[slot] &= !1;
    }
}
