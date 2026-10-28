//! HTTP-only demand-driven validation accounting; core callers use ordinary G5.
// @ref LLP 3000.009.001.000.002#g5-read-index-validation — enrollment closes before the independent validator statement.
use std::sync::atomic::{AtomicBool, AtomicU64};

#[derive(Default)]
pub(super) struct ReadIndex {
    pub enabled: AtomicBool,
    pub rounds: AtomicU64,
    pub reads: AtomicU64,
    pub enrollments: AtomicU64,
}
