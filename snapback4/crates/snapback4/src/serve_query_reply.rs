//! Query wire fields, shared by ordinary and once-sensitive reads.
use super::{Json, wire, latency};
#[derive(serde::Serialize)]
pub(super) struct QueryReply<'a> {
    #[serde(rename = "onceSensitive")]
    pub(super) once_sensitive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) once: &'a Option<snapback4_core::once_read::OnceRead>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) scopes: &'a Option<Json>,
    #[serde(rename = "searchScopes", skip_serializing_if = "Option::is_none")]
    pub(super) search_scopes: &'a Option<Vec<String>>,
    #[serde(rename = "searchRows", skip_serializing_if = "Option::is_none")]
    pub(super) search_rows: Option<wire::Plain<'a>>,
    #[serde(rename = "searchCurrent", skip_serializing_if = "Option::is_none")]
    pub(super) search_current: &'a Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) delivery: &'a Option<snapback4_core::engine::delivery::Manifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) ephemeral: &'a Option<snapback4_core::schema::ephemeral::Version>,
    pub(super) generation: u64,
    pub(super) complete: bool,
    pub(super) cut: Option<snapback4_core::engine::ReadCut>,
    pub(super) data: wire::Plain<'a>,
    pub(super) next: &'a Option<String>,
    #[serde(rename = "nextExpiry")]
    pub(super) next_expiry: Option<i64>,
    #[serde(rename = "decorationPaths", skip_serializing_if = "Option::is_none")]
    pub(super) decoration_paths: Option<Vec<Vec<String>>>,
    #[serde(rename = "decorationExpiry", skip_serializing_if = "Option::is_none")]
    pub(super) decoration_expiry: Option<Option<i64>>,
    pub(super) seq: u64,
    pub(super) store_id: String,
    pub(super) tables: &'a [String],
    pub(super) viewer: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) meter: Option<Json>,
    #[serde(rename = "rowProvenance", skip_serializing_if = "Option::is_none")]
    pub(super) row_provenance: Option<wire::Plain<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) refresh: Option<u64>,
}
impl latency::Reply for QueryReply<'_> {}

// The ordinary responder drops its body immediately after encoding bytes.
// Keep commit exclusion through that boundary, never through socket delivery.
#[derive(serde::Serialize)]
#[serde(transparent)]
pub(super) struct Committed<T, G> {
    pub(super) body: T,
    #[serde(skip)]
    pub(super) guard: G,
}
impl<T: latency::Reply, G> latency::Reply for Committed<T, G> {
    fn refused(&self) -> bool { self.body.refused() }
}
