//! Store-neutral release inventory records and history access.
// @ref LLP 3000.009.001.000#3.4 — owned records cross the adapter boundary.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DormantItem {
    /// Stable cursor; column/index names may coincide.
    pub key: String,
    pub path: String,
    pub kind: String,
    pub action: String,
    pub rows: u64,
    pub bytes: u64,
    pub asset_bytes: u64,
    /// Internal audit distinction: zero standalone cells may still be covered by a dormant row.
    #[serde(skip)]
    pub(crate) definition_only: bool,
    pub sample_ids: Vec<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub before_rows:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub after_rows:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub restored_rows:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub before_sample_ids:Option<Vec<String>>,
}

impl DormantItem {
    pub fn unit(&self) -> &'static str {
        match (self.kind.as_str(), self.rows) { ("backfill", 1) => "preimage", ("backfill", _) => "preimages", ("column", 1) => "cell", ("column", _) => "cells", ("index", 1) => "entry", ("index", _) => "entries", (_, 1) => "row", _ => "rows" }
    }
}

