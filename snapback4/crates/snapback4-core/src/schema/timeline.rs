//! Durable Following declarations. The mapped graph replaces the recipe edge.
use serde::{Deserialize, Serialize};

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
    pub follower_index: String,
    pub purge: String,
}

impl Timeline {
    pub fn table(&self, suffix: &str) -> String { format!("{}{suffix}", self.name) }
    pub fn owns(&self, table: &str) -> bool {
        table.strip_prefix(&self.name).is_some_and(|suffix| matches!(suffix,
            "Authors" | "Pulls" | "PullCounts" | "PullTotals" | "Posts" | "RemovedEvents" | "Feed" | "Broadcast"))
    }
    pub fn maps(&self, table: &str) -> bool {
        [&self.authors[0], &self.posts[0], &self.reposts[0], &self.edges[0]].iter().any(|mapped| mapped.as_str() == table)
    }
    pub fn event_tables(&self) -> [&str; 3] { [&self.posts[0], &self.reposts[0], &self.edges[0]] }
}
