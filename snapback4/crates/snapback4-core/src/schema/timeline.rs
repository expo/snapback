//! Durable Following declarations. The mapped graph replaces the recipe edge.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use crate::Value;

pub const OWNED_SUFFIXES: [&str; 5] = ["Posts", "RemovedEvents", "Feed", "Work", "Edges"];
pub const DELIVERY_CHUNK: u32 = 256;

pub const PUSH_FOLLOWERS: usize = 50;
pub const FOLLOW_BACKFILL: usize = 50;
pub const HISTORY_WINDOW: usize = 1000;
pub const READER_ACTOR_COPIES: usize = 1000;
pub const EVENT_COPIES: usize = 1001;

/// Server and device must fence the old owned shapes before opening or adoption.
// @ref LLP 3000.013#4-following-without-caps — derived history is fenced, never silently migrated.
pub fn check_version(schema: &super::Schema) -> Result<(), crate::RuntimeError> {
    if schema.timelines.iter().any(|t| t.version != 2) {
        return Err(crate::RuntimeError::Structural { code: "E_TIMELINE_REDEFINE", message:
            "this store contains a 0.3 timeline; use a fresh store in dev or preserve it with the matching 0.3 engine; timeline history is not migrated".into() });
    }
    Ok(())
}

fn legacy_version() -> u32 { 1 }
fn default_authors() -> u32 { 1000 }
fn default_edges() -> u32 { 100000 }
fn is_default_authors(value: &u32) -> bool { *value == default_authors() }
fn is_default_edges(value: &u32) -> bool { *value == default_edges() }

/// Public, canonical inputs only; shared by native and device derivation.
/// Canonical Value arrays tag identities and frame/escape each component; this
/// is not concatenation of reader/event strings. Domain, name and role are
/// separate array elements. Event identities are outside this contract.
pub fn owned_id(timeline: &str, suffix: &str, key: &[Value]) -> String {
    let mut parts = vec![Value::String("snapback4.timeline.v1".into()),
        Value::String(timeline.into()), Value::String(suffix.into())];
    parts.extend_from_slice(key);
    crate::value::digest(&parts)
}

// @ref LLP 3000.013#4-following-without-caps — a declaration owns event identity and edge-epoch history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timeline {
    pub name: String,
    #[serde(default = "legacy_version")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<crate::maintain::Predicate>,
    /// table, principal
    pub authors: [String; 2],
    /// table, author, time, removal flag (empty when the view has none)
    pub posts: [String; 4],
    /// table, actor, original, time
    pub reposts: [String; 4],
    /// table, follower, followed
    pub edges: [String; 3],
    // Omitted defaults preserve existing declarations' serialized form.
    #[serde(default = "default_authors", skip_serializing_if = "is_default_authors")]
    pub author_cap: u32,
    #[serde(default = "default_edges", skip_serializing_if = "is_default_edges")]
    pub edge_cap: u32,
    pub followed_index: String,
    pub purge: String,
    pub owned: BTreeSet<String>,
    pub mapped: BTreeSet<String>,
}

impl Timeline {
    // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — an engine slot belongs to a declaration AND a source role.
    pub fn slot(&self, repost: bool) -> String {
        format!("$timeline:{}:{}", self.name, if repost { "repost" } else { "post" })
    }
    pub fn source(&self, repost: bool) -> &str { if repost { &self.reposts[0] } else { &self.posts[0] } }
    pub fn has_slot(&self, schema: &super::Schema, repost: bool) -> bool {
        schema.tables[self.source(repost)].columns.contains_key(&self.slot(repost))
    }
    pub fn fully_synced(&self, schema: &super::Schema, repost: bool) -> bool {
        // Stored revision-5 backends keep their old full-event semantics until adoption.
        !self.has_slot(schema, repost) || schema.tables[self.source(repost)].sync.as_ref()
            .is_some_and(|sync| sync.horizon.is_none())
    }
    pub fn synced_aggregates<'a>(&self, schema: &'a super::Schema) -> Vec<&'a str> {
        let mut sources = BTreeSet::from([self.table("Posts")]);
        let mut targets = BTreeSet::new();
        loop {
            let before = sources.len();
            for m in &schema.maintains {
                if sources.contains(&m.source) {
                    sources.insert(m.target.clone());
                    let target = m.private.as_ref().map_or(m.target.as_str(), |owner| owner.table.as_str());
                    if schema.tables[target].sync.is_some() { targets.insert(target); }
                }
            }
            if sources.len() == before { break; }
        }
        targets.into_iter().collect()
    }
    pub fn backfill(&self) -> usize { FOLLOW_BACKFILL }
    pub fn table(&self, suffix: &str) -> String { format!("{}{suffix}", self.name) }
    pub fn owns(&self, table: &str) -> bool { table.strip_prefix(&self.name).is_some_and(|s| OWNED_SUFFIXES.contains(&s)) }
    pub fn maps(&self, table: &str) -> bool { self.event_tables().contains(&table) }
    pub fn same_declaration(&self, other: &Self) -> bool {
        self.name == other.name && self.version == other.version && self.filter == other.filter
            && self.posts == other.posts && self.reposts == other.reposts && self.edges == other.edges
            && self.owned == other.owned && self.mapped == other.mapped
    }
    pub fn event_tables(&self) -> [&str; 3] { [&self.posts[0], &self.reposts[0], &self.edges[0]] }
    /// Edges queue on devices; event prediction needs only public event inputs.
    pub fn inputs(&self, table: &str, kind: &str) -> Vec<(String, String)> {
        if table == self.edges[0] { return vec![(self.table("Work"), "byId".into())]; }
        if table == self.posts[0] || table == self.reposts[0] {
            let mut inputs = vec![];
            if table == self.posts[0] && !matches!(kind, "insert" | "insert-if-absent") {
                inputs.push((self.posts[0].clone(), "byId".into()));
            }
            if table == self.reposts[0] {
                inputs.push((if kind == "delete" { self.reposts[0].clone() } else { self.posts[0].clone() }, "byId".into()));
            }
            if table != self.reposts[0] || kind != "delete" {
                inputs.push((self.table("RemovedEvents"), "byEvent".into()));
            }
            return inputs;
        }
        vec![]
    }

}

pub fn is_slot(field: &str) -> bool { field.starts_with("$timeline:") }

/// Raw event rows on devices represent only fully synced kinds.
pub fn holds_event(schema: &super::Schema, table: &str, row: &Value) -> bool {
    schema.timelines.iter().find(|t| table == t.table("Posts")).is_none_or(|t|
        row.field("repost").ok().and_then(|v| match v { Value::Bool(kind) => Some(*kind), _ => None })
            .is_some_and(|kind| t.fully_synced(schema, kind)))
}

/// A prefix naming a fully synced kind has ordinary negative coverage.
pub fn partial_read(schema: &super::Schema, table: &str, index: &str, key: &[Value]) -> bool {
    let Some(t) = schema.timelines.iter().find(|t| table == t.table("Posts")) else { return false; };
    let kind = schema.tables[table].index(index).and_then(|i| i.columns().iter().position(|c| c == "repost"))
        .and_then(|position| key.get(position));
    match kind {
        Some(Value::Bool(kind)) => !t.fully_synced(schema, *kind),
        _ => !t.fully_synced(schema, false) || !t.fully_synced(schema, true),
    }
}

/// Stored sets are a checked projection, never an authorization input.
pub(super) fn validate(schema: &super::Schema, issues: &mut Vec<super::SchemaIssue>) {
    let mut names = BTreeSet::new();
    let mut owners = BTreeSet::new();
    let all_mapped: BTreeSet<_> = schema.timelines.iter().flat_map(|t|
        [&t.posts[0], &t.reposts[0], &t.edges[0]]).cloned().collect();
    for t in &schema.timelines {
        let owned: BTreeSet<_> = OWNED_SUFFIXES.iter().map(|s| t.table(s)).collect();
        let mapped: BTreeSet<_> = [&t.posts[0], &t.reposts[0], &t.edges[0]].into_iter().cloned().collect();
        let unique = owned.iter().all(|name| owners.insert(name.clone()));
        if !names.insert(&t.name) || !unique || t.owned != owned || t.mapped != mapped
            || mapped.len() != 3 || !owned.is_disjoint(&all_mapped)
            || owned.iter().chain(&mapped).any(|name| !schema.tables.contains_key(name)) {
            issues.push(super::SchemaIssue { path: format!("timelines.{}", t.name),
                message: "timeline owned and mapped sets must equal the disjoint canonical declaration sets, with every table present and one owner".into() });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owned_digest_frames_and_separates_every_input() {
        let key = [Value::Id("ab".into()), Value::Id("c".into())];
        let original = owned_id("feed", "Feed", &key);
        assert_eq!(original.len(), 64);
        assert!(original.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        assert_eq!(original, owned_id("feed", "Feed", &key));
        for other in [owned_id("feed", "Feed", &[Value::Id("a".into()), Value::Id("bc".into())]),
            owned_id("feed", "Feed", &[Value::Id("ab".into()), Value::Id("d".into())]),
            owned_id("feed", "Pulls", &key), owned_id("other", "Feed", &key),
            crate::value::digest(&[Value::String("other.domain".into()), Value::String("feed".into()),
                Value::String("Feed".into()), key[0].clone(), key[1].clone()])] {
            assert_ne!(original, other);
        }
        // Canonical Value arrays tag identities and delimit/escape each element:
        // [reader="ab", event="c"] cannot alias [reader="a", event="bc"].
        assert_ne!(crate::value::canonical_json(&key), crate::value::canonical_json(&[Value::Id("a".into()), Value::Id("bc".into())]));
        let maximum = Value::Id("x".repeat(135));
        assert_eq!(crate::value::canonical_json(&maximum).len(), 144);
        assert_eq!(owned_id("feed", "Feed", &[maximum.clone(), maximum]).len(), 64);
    }
}
