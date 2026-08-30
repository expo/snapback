//! Small helpers shared by the owner writer's runtime paths.

use crate::protocol::Refusal;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn rejection_family(code: &str) -> &'static str {
    if code.starts_with("E_RULE") {
        "rule"
    } else if code.starts_with("E_BOUND")
        || matches!(code, "E_FANOUT" | "E_STEPS" | "E_TRACE_SUBSET")
    {
        "bound"
    } else if code.starts_with("E_CONSTRAINT") {
        "schema"
    } else {
        "input"
    }
}

pub fn next_id() -> String {
    let sequence = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("id-{}-{sequence}", unix_millis())
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
