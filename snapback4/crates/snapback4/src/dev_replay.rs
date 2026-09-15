//! Persist a schedule hold across a replay and its restart boundary.
use snapback4_core::{Engine, RuntimeError};

// @ref LLP 3000.007#20.2 — releasing a dev replay starts schedules at the next boundary, without catch-up.
pub fn schedules(engine: &mut Engine, held: bool, now: i64) -> Result<(), RuntimeError> {
    if !held && engine.store().meta("dev:hold-schedules")?.as_deref() != Some("true") { return Ok(()); }
    let schedules = engine.schema().schedules.clone();
    let tx = engine.store_mut().transaction()?;
    for schedule in schedules {
        tx.set_meta(&format!("schedule:{}", schedule.name), &schedule.boundary(now).to_string())?;
        tx.set_meta(&format!("schedule-shape:{}", schedule.name), &snapback4_core::value::digest(&schedule))?;
    }
    tx.set_meta("dev:hold-schedules", if held { "true" } else { "false" })?;
    tx.commit()
}
