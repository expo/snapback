//! Production sync wire encoding, also used by delivery byte regressions.
use snapback4_core::wire;
use std::collections::BTreeMap;

// @ref LLP 3000#7-decisions-during-execution — encode borrowed plain values without a second JSON tree
#[derive(serde::Serialize)]
pub(crate) struct SyncEvent<'a> {
    pub(crate) data: Option<wire::Plain<'a>>,
    pub(crate) id: &'a str,
    pub(crate) kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) seq: Option<u64>,
    pub(crate) table: &'a str,
}

// Own the reply so `respond` drops its rows after encoding, before socket I/O.
pub(crate) enum SyncEvents {
    Snapshot(Vec<snapback4_core::partition::Event>),
    Stream(Vec<snapback4_core::store::LogEvent>),
}

impl serde::Serialize for SyncEvents {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Snapshot(events) => serializer.collect_seq(events.iter().map(|event| SyncEvent {
                data: event.data.as_ref().map(wire::Plain), id: &event.id,
                kind: event.kind.word(), seq: None, table: &event.table,
            })),
            Self::Stream(events) => serializer.collect_seq(events.iter().map(|event| SyncEvent {
                data: event.data.as_ref().map(wire::Plain), id: &event.id,
                kind: &event.kind, seq: Some(event.seq), table: &event.table,
            })),
        }
    }
}

#[derive(serde::Serialize)]
pub(crate) struct StreamReply {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) acquisitions: Vec<wire::Acquisition>,
    pub(crate) acknowledged: BTreeMap<String, u64>,
    // Serialized order is alphabetical among the always-present fields, which
    // is what the byte-exact encoding test compares against `json!`.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub(crate) committed_above: BTreeMap<String, u64>,
    pub(crate) events: SyncEvents,
    pub(crate) generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) images_at: Option<u64>,
    pub(crate) joined: wire::HeldGroups,
    pub(crate) more: bool,
    pub(crate) now: i64,
    pub(crate) snapshot: bool,
    pub(crate) store_id: String,
    pub(crate) watermark: u64,
}

#[derive(serde::Serialize)]
pub(crate) struct SnapshotReply {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) acquisitions: Vec<wire::Acquisition>,
    pub(crate) acknowledged: BTreeMap<String, u64>,
    pub(crate) after: Option<String>,
    pub(crate) events: SyncEvents,
    pub(crate) generation: u64,
    pub(crate) held: Option<wire::HeldGroups>,
    pub(crate) more: bool,
    pub(crate) next: Option<String>,
    pub(crate) now: i64,
    pub(crate) snapshot: bool,
    pub(crate) store_id: String,
    pub(crate) watermark: u64,
}
