//! Persist replay suppression and a schedule hold across the restart boundary.
use snapback4_core::{Engine, RuntimeError};

pub fn dev_only() -> snapback4_core::Refusal {
    snapback4_core::Refusal::new("E_REPLAY_DEV_ONLY", "replay", "--replay requires dev without --release; serve and releases always emit effects normally").guide("replay")
}

pub fn effects(engine: &Engine, replay: bool) -> Result<(), RuntimeError> {
    // Local `run` opens the same store, so explicit mutations and job chunks
    // use this policy too. Only the owning dev start replaces it; the count survives.
    // An immediate transaction checks release identity with the policy write,
    // even if this engine was opened before deployment.
    let conn = engine.store().conn();
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    let deployed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')", [], |row| row.get(0))?;
    if deployed { return Err(RuntimeError::Generation("this store belongs to a deployment; use `deploy` to activate source and `serve` to run it".into())); }
    tx.execute("INSERT INTO _meta(key, value) VALUES ('dev:replay', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [if replay { "true" } else { "false" }])?;
    tx.commit()?;
    Ok(())
}

// @ref LLP 3000.007#20.2 — releasing a dev replay starts schedules at the next boundary, without catch-up.
pub fn schedules(engine: &mut Engine, held: bool, now: i64) -> Result<(), RuntimeError> {
    if !held && engine.store().meta("dev:hold-schedules")?.as_deref() != Some("true") { return Ok(()); }
    let schedules = engine.schema().schedules.clone();
    let tx = engine.store_mut().transaction()?;
    let deployed: bool = tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')", [], |row| row.get(0))?;
    if deployed { return Err(RuntimeError::Generation("this store belongs to a deployment; use `deploy` to activate source and `serve` to run it".into())); }
    for schedule in schedules {
        tx.set_meta(&format!("schedule:{}", schedule.name), &schedule.boundary(now).to_string())?;
        tx.set_meta(&format!("schedule-shape:{}", schedule.name), &snapback4_core::value::digest(&schedule))?;
    }
    tx.set_meta("dev:hold-schedules", if held { "true" } else { "false" })?;
    tx.commit()
}
