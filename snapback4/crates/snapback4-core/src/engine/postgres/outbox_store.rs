//! Outbox snapshots use one repeatable-read transaction; replay uses the head.
// @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — one family snapshot, shared replay authority.
use super::{WriteMode, outbox::{absent_key, read_run, runs}, store::{Store, Tx}};
use crate::metadata::{MetadataWriter, DevMetadata};
use crate::{RuntimeError, engine::effects::{EffectHealth, EffectRun, OutboxStore, OutboxTransaction}};
use std::{cell::RefCell, collections::BTreeMap};

fn counts(tx: &Tx<'_>) -> Result<BTreeMap<String, u64>, RuntimeError> {
    let mut counts: BTreeMap<String, u64> = tx.query("SELECT state,COUNT(*) FROM _outbox GROUP BY state", &[])?.into_iter().map(|r| (r.get(0), r.get::<_, i64>(1) as u64)).collect();
    let suppressed = tx.query("SELECT value::bigint FROM _meta WHERE key = 'dev:suppressed-effects'", &[])?.first().map_or(0, |r| r.get::<_, i64>(0));
    if suppressed > 0 { counts.insert("suppressed".into(), suppressed as u64); }
    Ok(counts)
}

impl OutboxStore for RefCell<&mut Store> {
    fn effects_due(&self, effect: Option<&str>, now: i64) -> Result<bool, RuntimeError> {
        if absent_key(effect) { return Ok(false); }
        let mut store = self.borrow_mut();
        let tx = store.transaction(None)?;
        let due = tx.query("SELECT EXISTS(SELECT 1 FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= $1) AND ($2::text IS NULL OR effect = $2))", &[&now, &effect])?[0].get(0);
        tx.rollback()?;
        Ok(due)
    }
    fn list_effects(&self, state: Option<&str>, limit: u64) -> Result<Vec<EffectRun>, RuntimeError> {
        if absent_key(state) { return Ok(Vec::new()); }
        let mut store = self.borrow_mut();
        let tx = store.transaction(None)?;
        let rows = tx.query(runs!("WHERE ($1::text IS NULL OR state = $1) ORDER BY seq DESC, id DESC LIMIT $2"), &[&state, &(limit.min(i64::MAX as u64) as i64)])?.into_iter().map(read_run).collect::<Result<_, _>>()?;
        tx.rollback()?;
        Ok(rows)
    }
    fn effect_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        let mut store = self.borrow_mut();
        let tx = store.transaction(None)?;
        let counts = counts(&tx)?;
        tx.rollback()?;
        Ok(counts)
    }
    fn effect_health(&self, now: i64) -> Result<EffectHealth, RuntimeError> {
        let mut store = self.borrow_mut();
        let tx = store.transaction(None)?;
        let counts = counts(&tx)?;
        // A failed advisory query is terminal too: roll back this snapshot.
        let deferred = tx.query("SELECT COUNT(*),MIN(next_at) FROM _outbox WHERE state = 'queued' AND next_at > $1 AND EXISTS(SELECT 1 FROM _effect_presence WHERE id = _outbox.id)", &[&now]).map(|r| (r[0].get::<_, i64>(0) as u64, r[0].get(1))).map_err(|e| e.to_string());
        tx.rollback()?;
        Ok(EffectHealth { counts, deferred })
    }
    fn set_effect_replay(&self, replay: bool, check: impl FnOnce(bool) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        let mut store = self.borrow_mut();
        let tx = store.transaction(Some(WriteMode::Serialized))?;
        check(tx.replay_deployed()?)?;
        tx.set_dev_value(DevMetadata::Replay, if replay { "true" } else { "false" })?;
        tx.commit()
    }
}
