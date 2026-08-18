//! Portable indexed full-text search.
//!
//! The public contract is target-neutral. SQLite stores the canonical
//! term/position authority directly; it never delegates match truth or ranking
//! to SQLite FTS.
//!
//! @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — the manifest,
//! request/result, and capability shapes are Rust-owned.
//! @ref LLP 0073#index-maintenance — source and derived index state commit in
//! one SQLite transaction.

pub mod analyzer;
pub mod ast;
pub mod cursor;
pub mod fixtures;
pub mod highlight;
pub mod parser;
pub mod rebuild;
pub mod scorer;
pub mod sqlite;
pub use snapback_types::search::types;
pub mod unicode17_generated;

pub use ast::{canonicalize_query, validate_query};
pub use parser::parse_search_query;
pub use sqlite::{maintain_search_indexes_in_tx, query_search_on};
pub use types::*;
