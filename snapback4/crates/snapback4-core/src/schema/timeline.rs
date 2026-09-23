//! Durable Following declarations. The mapped graph replaces the recipe edge.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use crate::Value;

pub const OWNED_SUFFIXES: [&str; 8] = ["Authors", "Pulls", "PullCounts", "PullTotals", "Posts", "RemovedEvents", "Feed", "Broadcast"];

/// Public, canonical inputs only; shared by native and device derivation.
/// Event identities are deliberately outside this function's contract.
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
    /// table, principal
    pub authors: [String; 2],
    /// table, author, time, removal flag
    pub posts: [String; 4],
    /// table, actor, original, time
    pub reposts: [String; 4],
    /// table, follower, followed
    pub edges: [String; 3],
    pub followed_index: String,
    pub purge: String,
    pub owned: BTreeSet<String>,
    pub mapped: BTreeSet<String>,
}

impl Timeline {
    pub fn table(&self, suffix: &str) -> String { format!("{}{suffix}", self.name) }
    pub fn owns(&self, table: &str) -> bool {
        self.owned.contains(table)
    }
    pub fn maps(&self, table: &str) -> bool {
        self.mapped.contains(table)
    }
    /// Physical index choice is refreshed by adoption, without reactivation.
    /// Caps are fixed by admission; they are not configurable declaration fields.
    pub fn same_declaration(&self, other: &Self) -> bool {
        self.name == other.name && self.authors == other.authors && self.posts == other.posts
            && self.reposts == other.reposts && self.edges == other.edges && self.purge == other.purge
            && self.owned == other.owned && self.mapped == other.mapped
    }
    pub fn event_tables(&self) -> [&str; 3] { [&self.posts[0], &self.reposts[0], &self.edges[0]] }
}
