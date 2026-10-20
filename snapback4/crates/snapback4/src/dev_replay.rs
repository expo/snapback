//! Persist replay suppression and a schedule hold across the restart boundary.
use snapback4_core::{Engine, RuntimeError};

pub fn dev_only() -> snapback4_core::Refusal {
    snapback4_core::Refusal::new("E_REPLAY_DEV_ONLY", "replay", "--replay requires dev without --release; serve and releases always emit effects normally").guide("replay")
}

pub fn effects(engine: &Engine, replay: bool) -> Result<(), RuntimeError> {
    engine.set_effect_replay(replay)
}

// @ref LLP 3000.007#20.2 — releasing a dev replay starts schedules at the next boundary, without catch-up.
pub fn schedules(engine: &mut Engine, held: bool, now: i64) -> Result<(), RuntimeError> {
    if !held && engine.store().dev_value(snapback4_core::metadata::DevMetadata::HoldSchedules)?.as_deref() != Some("true") { return Ok(()); }
    let schedules = engine.schema().schedules.clone();
    let tx = engine.store_mut().transaction()?;
    tx.require_dev_replay_store()?;
    for schedule in schedules {
        tx.save_schedule_boundary(&schedule.name, schedule.boundary(now))?;
        tx.save_schedule_shape(&schedule.name, &snapback4_core::value::digest(&schedule))?;
    }
    tx.set_dev_value(snapback4_core::metadata::DevMetadata::HoldSchedules, if held { "true" } else { "false" })?;
    tx.commit()
}
