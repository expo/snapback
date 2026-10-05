//! Compiler provenance is inspection metadata, never an engine schema field.
// @ref LLP 3000.007#8 — an optional side record must not change legacy schema bytes.
use std::collections::{BTreeMap, BTreeSet};
use serde::{Deserialize, Serialize};

pub type Declarations = BTreeMap<String, BTreeSet<String>>;

/// Transient compiler input for the activation's catalog side record.
/// Like the delivery lookup, it has no effect on schema equality or execution.
#[derive(Clone, Debug, Default)]
pub struct AuthoredIndexes(pub Option<Declarations>);
impl PartialEq for AuthoredIndexes {
    fn eq(&self, _: &Self) -> bool { true }
}
impl Eq for AuthoredIndexes {}

pub const META_KEY: &str = "catalog:index-provenance";

/// Snapshot identity prevents stale metadata from describing an activation
/// installed by an older engine, which does not maintain this optional record.
#[derive(Serialize, Deserialize)]
pub struct Record {
    pub generation: u64,
    pub schema_hash: String,
    pub indexes: Declarations,
}
