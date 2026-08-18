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

pub(crate) trait FullTextSearchFactsLocalExt {
    fn local_v1() -> Self;
}

impl FullTextSearchFactsLocalExt for FullTextSearchFactsV1 {
    fn local_v1() -> Self {
        Self {
            capability_id: SEARCH_CAPABILITY.to_owned(),
            maturity: "stable".to_owned(),
            analyzer: SEARCH_ANALYZER.to_owned(),
            unicode_version: unicode17_generated::UNICODE_VERSION.to_owned(),
            analyzer_tables_digest: unicode17_generated::ANALYZER_TABLES_DIGEST.to_owned(),
            parser: SEARCH_PARSER.to_owned(),
            scorer: SEARCH_SCORER.to_owned(),
            score_max: 22_937_600,
            maintenance: "synchronous".to_owned(),
            pagination: "current-keyset-v1".to_owned(),
            cursor_ttl_ms: SEARCH_CURSOR_TTL_MS,
            accelerator: "none".to_owned(),
            authorization_filters: vec![
                "public-read".to_owned(),
                "owner.v1".to_owned(),
                "membership.v1".to_owned(),
            ],
            highlights: true,
            counts: false,
            facets: false,
            suggestions: false,
            offline: false,
            storage_engines: vec!["sqlite".to_owned()],
            nonclaims: vec![
                "live-search".to_owned(),
                "offline-search".to_owned(),
                "postgres".to_owned(),
                "relational-visibility".to_owned(),
                "native-fts-acceleration".to_owned(),
                "sensitive-fields".to_owned(),
            ],
        }
    }
}

pub use ast::{canonicalize_query, validate_query};
pub use parser::parse_search_query;
pub use sqlite::{maintain_search_indexes_in_tx, query_search_on};
pub use types::*;
