//! Logical dependencies at the program/store boundary, including absence.
use crate::{Value, rows::{Bounds, Dir}, schema::Index};
use std::collections::BTreeSet;

// @ref LLP 3000.009.001.000.000.001#3 — membership spans and observed images are separate dependencies.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ReadSet {
    pub rows: BTreeSet<(String, String)>,
    pub spans: BTreeSet<(String, String, Vec<u8>, Vec<u8>)>,
    pub authority: BTreeSet<String>,
    pub receipts: BTreeSet<(String, String)>,
    /// Families outside the bounded point closure cannot establish independence.
    pub unsupported: bool,
}
impl ReadSet {
    pub fn get(&mut self, table: &str, id: &str) {
        self.rows.insert((table.into(), id.into()));
    }
    pub fn lookup(&mut self, table: &str, name: &str, index: &Index, key: &[Value], row: Option<&Value>) {
        if name == "byId" && key.len() == 1 {
            if let Ok(id) = key[0].as_str() { self.get(table, id); }
            else { self.unsupported = true; }
        } else if let Some((lo, hi)) = crate::rows::scan_range(key, &Bounds::default(), Dir::Asc) {
            self.spans.insert((table.into(), name.into(), lo, hi));
            if !index.unique { self.unsupported = true; }
        } else { self.unsupported = true; }
        if let Some(row) = row {
            if let Ok(id) = row.field("id").and_then(Value::as_str) { self.get(table, id); }
            else { self.unsupported = true; }
        }
    }
}
