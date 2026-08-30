//! Small helpers shared by the owner writer's runtime paths.

use crate::protocol::Refusal;
use snapback2_core::{Ceilings, Checker, ColumnType, Generation};
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

pub fn recertify(generation: &mut Generation) -> Result<(), Refusal> {
    let schema = generation.schema.clone();
    for (program, certificate) in generation.programs.values_mut() {
        *certificate = Checker::new(&schema, Ceilings::default())
            .check(program)
            .map_err(|error| {
                Refusal::new(
                    error.code,
                    "owner",
                    error.message,
                    error.rewrite,
                    "owner/internal-generation",
                )
            })?;
    }
    Ok(())
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

pub fn is_id_kind(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Id | ColumnType::Ref { .. } => true,
        ColumnType::Optional(inner) => is_id_kind(inner),
        _ => false,
    }
}
