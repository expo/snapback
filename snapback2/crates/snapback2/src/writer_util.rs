//! Small helpers shared by the owner writer's runtime paths.

use crate::protocol::Refusal;
use std::time::{SystemTime, UNIX_EPOCH};

/// One mapping for a rejected mutation on the wire and a parked chunk in `_jobs` (LLP 1016 D2).
pub fn rejection_family(code: &str) -> &'static str {
    snapback2_core::jobs::rejection_family(code)
}

pub fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

pub fn owner_gone() -> Refusal {
    Refusal::owner(
        "E_OWNER_NOT_RUNNING",
        "the owner writer is not running",
        "run snapback2 dev",
    )
}
