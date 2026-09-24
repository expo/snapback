//! Durable Following declarations. The mapped graph replaces the recipe edge.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use crate::Value;

pub const OWNED_SUFFIXES: [&str; 4] = ["Posts", "RemovedEvents", "Feed", "Work"];
pub const DELIVERY_CHUNK: u32 = 256;

pub const PUSH_FOLLOWERS: usize = 50;
pub const FOLLOW_BACKFILL: usize = 50;
pub const READER_ACTOR_COPIES: usize = 1000;
pub const EVENT_COPIES: usize = 1001;

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

// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — history belongs to the declaration, never to a rebuild.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timeline {
    pub name: String,
    #[serde(default = "legacy_version")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<crate::maintain::Predicate>,
    /// table, principal
    pub authors: [String; 2],
    /// table, author, time, removal flag
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
    pub fn inputs(&self, table: &str, _kind: &str) -> Vec<(String, String)> {
        if table == self.edges[0] { return vec![(self.table("Work"), "byId".into())]; }
        if table == self.posts[0] || table == self.reposts[0] {
            let mut inputs = vec![(self.table("Posts"), "byActorPost".into()),
                (self.table("RemovedEvents"), "byEvent".into())];
            if table == self.reposts[0] { inputs.push((self.posts[0].clone(), "byId".into())); }
            return inputs;
        }
        vec![]
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
