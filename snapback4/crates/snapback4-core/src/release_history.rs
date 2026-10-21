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


use crate::{RuntimeError, metadata::MetadataReader};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Event {
    pub id: u64,
    pub at: i64,
    pub operation: String,
    pub release: Option<u64>,
    pub previous: Option<u64>,
    pub generation: u64,
    pub revision: u64,
    pub summary: serde_json::Value,
}

pub(crate) trait ReleaseHistoryReader: MetadataReader {
    fn release_events(&self, after: u64, limit: usize) -> Result<Vec<Event>, RuntimeError>;
    fn release_event_items(&self, event: u64, after: Option<&str>, limit: usize) -> Result<Vec<DormantItem>, RuntimeError>;
    fn release_inventory(&self, after: Option<&str>, limit: usize) -> Result<Vec<DormantItem>, RuntimeError>;
    fn previous_active_release(&self) -> Result<Option<u64>, RuntimeError>;
    fn release_workers(&self, limit: usize) -> Result<Vec<(String, String)>, RuntimeError>;
}

pub(crate) trait ReleaseHistoryTransaction: MetadataReader {
    fn insert_release_event(&self, event: &Event, items: &[DormantItem]) -> Result<u64, RuntimeError>;
}

pub(crate) fn counter(n: u64) -> Result<i64, RuntimeError> {
    i64::try_from(n).map_err(|_| RuntimeError::Generation("release counter exceeds signed integer range".into()))
}

pub(crate) fn record_event(tx: &impl ReleaseHistoryTransaction, at: i64, operation: &str, release: Option<u64>, previous: Option<u64>, summary: serde_json::Value, items: &[DormantItem]) -> Result<u64, RuntimeError> {
    if operation.contains('\0') {
        return Err(RuntimeError::Input("release operation cannot contain U+0000".into()));
    }
    let revision = tx.release_revision_value()?.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0)
        .checked_add(1).ok_or_else(|| RuntimeError::Generation("release revision exhausted".into()))?;
    let generation = tx.generation_value()?.and_then(|v| v.parse::<u64>().ok()).unwrap_or(1);
    // Exhaustion is an explicit refusal. A generation/history identity cannot
    // saturate and reuse an old identity (rule 8's arithmetic is for counters/times).
    counter(revision)?; counter(generation)?;
    release.map(counter).transpose()?; previous.map(counter).transpose()?;
    tx.insert_release_event(&Event { id: 0, at, operation: operation.into(), release, previous, generation, revision, summary }, items)?;
    Ok(revision)
}

pub(crate) fn status(tx: &impl ReleaseHistoryReader, after: u64, items_after: Option<&str>, event_id: Option<u64>) -> Result<serde_json::Value, RuntimeError> {
    let events = tx.release_events(after, 16)?;
    let items = match event_id { Some(event) => tx.release_event_items(event, items_after, 16)?, None => tx.release_inventory(items_after, 16)? };
    Ok(serde_json::json!({
        "previous_active": tx.previous_active_release()?, "release": tx.release_value()?.and_then(|v| v.parse::<u64>().ok()),
        "revision": tx.release_revision_value()?.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
        "generation": tx.generation_value()?.and_then(|v| v.parse::<u64>().ok()).unwrap_or(1),
        "native_digest": tx.release_native_digest()?, "events_after": events.last().map(|e| e.id), "events": events,
        "items_after": items.last().map(|i| i.key.clone()), "items": items, "event": event_id, "workers": tx.release_workers(16)?,
    }))
}
