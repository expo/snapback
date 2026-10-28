//! SQLite outbox access; claim, settlement and expiry policy stays in the engine.
// @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — preserve SQL and transaction boundaries.
use super::{Store, Tx};
use crate::{RuntimeError, engine::effects::{EffectRun, EffectHealth, NewEffect, ExpiredEffect, OutboxTransaction, OutboxStore, legacy_work}};
use crate::value::{Value, canonical_json};
use rusqlite::{OptionalExtension, params};
use std::collections::BTreeMap;

const COLUMNS: &str = "id, effect, payload, state, attempts, seq, at, next_at, lease_until, claimed_by, result, error, work_spec, deadline, release, error_code, cancelled, contract";

fn read_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<EffectRun> {
    let payload: String = row.get(2)?;
    let result: Option<String> = row.get(10)?;
    Ok(EffectRun {
        id: row.get(0)?,
        effect: row.get(1)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        state: row.get(3)?,
        attempts: row.get::<_, i64>(4)? as u32,
        seq: row.get::<_, i64>(5)? as u64,
        at: row.get(6)?,
        next_at: row.get(7)?,
        lease_until: row.get(8)?,
        claimed_by: row.get(9)?,
        result: result.and_then(|text| serde_json::from_str(&text).ok()),
        error: row.get(11)?,
        work: row.get::<_, Option<String>>(12)?.map(|text| serde_json::from_str(&text).map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))).transpose()?.unwrap_or_else(legacy_work),
        deadline: row.get(13)?, release: row.get(14)?, error_code: row.get(15)?, cancelled: row.get(16)?, contract: row.get(17)?, declaration_contract: None, lease_token: None,
    })
}

impl OutboxTransaction for Tx<'_> {
    fn replay_suppresses(&self) -> Result<bool, RuntimeError> {
        Ok(self.conn().prepare_cached("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'dev:replay' AND value = 'true') AND NOT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')")?.query_row([], |row| row.get(0))?)
    }

    fn suppress_effects(&self, count: usize) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _meta(key, value) VALUES ('dev:suppressed-effects', ?1) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER)", [count.to_string()])?;
        Ok(())
    }

    fn effect_release(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn().query_row("SELECT value FROM _meta WHERE key = 'release'", [], |row| row.get(0)).optional()?)
    }

    fn insert_effect(&self, effect: &NewEffect<'_>) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _outbox(id, seq, effect, payload, state, attempts, at, next_at, work_spec, deadline, release, contract) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, ?6, ?7, ?8, ?9, ?10)", params![effect.id, effect.seq as i64, effect.effect, canonical_json(effect.payload), effect.now, effect.next_at, canonical_json(effect.work), effect.deadline, effect.release, effect.contract])?;
        Ok(())
    }

    fn insert_effect_presence(&self, principal: &str, id: &str, deadline: i64) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _effect_presence(principal, id, deadline) VALUES (?1, ?2, ?3)", params![principal, id, deadline])?;
        Ok(())
    }

    fn park_effect_generation(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'parked', error_code = 'E_EFFECT_GENERATION', error = 'the admitted effect declaration changed; inspect this work before replacing it', settled_at = ?2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1 AND state IN ('queued', 'running')", params![id, now])?;
        Ok(())
    }

    fn effect_run(&self, id: &str) -> Result<Option<EffectRun>, RuntimeError> {
        Ok(self.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run).optional()?)
    }

    fn effect_lease_digest(&self, id: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn().query_row("SELECT lease_digest FROM _outbox WHERE id = ?1", [id], |row| row.get(0))?)
    }

    fn effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError> {
        let limit = limit.min(i64::MAX as u64) as i64;
        Ok(match effect {
            Some(effect) => self.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 ORDER BY seq, id LIMIT ?3")?.query_map(params![now, effect, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
            None => self.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) ORDER BY seq, id LIMIT ?2")?.query_map(params![now, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
        })
    }

    fn strict_effect_candidates(&self, effect: Option<&str>, now: i64, limit: u64) -> Result<Vec<String>, RuntimeError> {
        let limit = limit.min(i64::MAX as u64) as i64;
        Ok(match effect {
            Some(effect) => self.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND cancelled = 0 AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 ORDER BY seq, id LIMIT ?3")?.query_map(params![now, effect, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
            None => self.conn().prepare("SELECT id FROM _outbox WHERE state = 'queued' AND cancelled = 0 AND (next_at IS NULL OR next_at <= ?1) ORDER BY seq, id LIMIT ?2")?.query_map(params![now, limit], |row| row.get(0))?.collect::<Result<_, _>>()?,
        })
    }

    fn effect_presence_satisfied(&self, id: &str) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row("SELECT EXISTS(SELECT 1 FROM _effect_presence WHERE id = ?1 AND reconnected = 1)", [id], |row| row.get(0))?)
    }

    fn clear_effect_presence(&self, id: &str) -> Result<(), RuntimeError> {
        self.conn().execute("DELETE FROM _effect_presence WHERE id = ?1", [id])?;
        Ok(())
    }

    fn satisfy_effect(&self, id: &str, outcome: &Value) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'satisfied', result = ?2, next_at = NULL WHERE id = ?1", params![id, canonical_json(outcome)])?;
        Ok(())
    }

    fn claim_effect(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = ?2, lease_until = MIN(?3, COALESCE(deadline, ?3)), next_at = NULL, error = NULL, error_code = NULL, lease_digest = ?4 WHERE id = ?1", params![id, worker, lease_until, digest])?;
        Ok(())
    }

    fn claim_effect_strict(&self, id: &str, worker: &str, lease_until: i64, digest: Option<&str>) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'running', attempts = attempts + 1, claimed_by = ?2, lease_until = MIN(?3, COALESCE(deadline, ?3)), next_at = NULL, error = NULL, error_code = NULL, lease_digest = ?4 WHERE id = ?1 AND state = 'queued' AND cancelled = 0", params![id, worker, lease_until, digest])?;
        Ok(())
    }

    fn required_effect_run(&self, id: &str) -> Result<EffectRun, RuntimeError> {
        Ok(self.conn().query_row(&format!("SELECT {COLUMNS} FROM _outbox WHERE id = ?1"), [id], read_run)?)
    }

    fn effect_presence(&self, id: &str) -> Result<Vec<(String, bool)>, RuntimeError> {
        Ok(self.conn().prepare("SELECT principal, reconnected FROM _effect_presence WHERE id = ?1 ORDER BY principal")?
                .query_map([id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)))?.collect::<Result<Vec<_>, _>>()?)
    }

    fn pending_effect_presence(&self, principal: &str, now: i64) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row("SELECT EXISTS(SELECT 1 FROM _effect_presence WHERE principal = ?1 AND deadline >= ?2 AND reconnected = 0)", params![principal, now], |r| r.get(0))?)
    }

    fn pending_effect_presence_principals(&self, now: i64) -> Result<Option<Vec<String>>, RuntimeError> {
        let principals = self.conn().prepare("SELECT DISTINCT principal FROM _effect_presence WHERE deadline >= ?1 AND reconnected = 0 ORDER BY principal")?
            .query_map([now], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(Some(principals))
    }
    fn reconnect_effect_presence(&self, principal: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _effect_presence SET reconnected = 1 WHERE principal = ?1 AND deadline >= ?2", params![principal, now])?;
        Ok(())
    }

    fn send_effect(&self, id: &str, result: Option<&Value>) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'sent', result = ?2, error = NULL, lease_until = NULL WHERE id = ?1", params![id, result.map(canonical_json)])?;
        Ok(())
    }

    fn retry_effect(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'queued', error = ?2, next_at = ?3, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = ?1", params![id, error, next_at])?;
        Ok(())
    }

    fn fail_effect(&self, id: &str, error: &str) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'failed', error = ?2, lease_until = NULL WHERE id = ?1", params![id, error])?;
        Ok(())
    }

    fn mark_effect_settled(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET settled_at = CASE WHEN state IN ('sent', 'failed') THEN ?2 ELSE NULL END WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    fn send_effect_strict(&self, id: &str, result: Option<&Value>, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'sent', result = ?2, error = NULL, error_code = NULL, settled_at = ?3, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![id, result.map(canonical_json), now])?;
        Ok(())
    }

    fn retry_effect_strict(&self, id: &str, error: &str, next_at: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'queued', error = ?2, error_code = NULL, next_at = ?3, settled_at = NULL, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = ?1", params![id, error, next_at])?;
        Ok(())
    }

    fn fail_effect_strict(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'failed', error = ?2, settled_at = ?3, next_at = NULL, lease_until = NULL, claimed_by = NULL, lease_digest = NULL WHERE id = ?1", params![id, error, now])?;
        Ok(())
    }

    fn finalize_effect_cancellation(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'failed', error = 'the effect was cancelled; external effects are not undone', error_code = 'E_EFFECT_CANCELLED', settled_at = ?2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    fn cancel_effect(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = 'failed', cancelled = 1, error = 'the effect was cancelled; external effects are not undone', error_code = 'E_EFFECT_CANCELLED', settled_at = ?2, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = NULL WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    fn shift_worker_leases(&self, milliseconds: i64, before: i64) -> Result<(), RuntimeError> {
        let (bound, end) = crate::engine::effects::lease_shift_bounds(milliseconds);
        let supervised: bool = self.conn().query_row("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'worker:session-family' OR key LIKE 'worker:family:%')", [], |row| row.get(0))?;
        if supervised {
        self.conn().execute("UPDATE _sessions SET expires_at = CASE WHEN (?1 >= 0 AND expires_at > ?2) OR (?1 < 0 AND expires_at < ?2) THEN ?3 ELSE expires_at + ?1 END WHERE expires_at > ?4 AND COALESCE(family, token_digest) IN (SELECT value FROM _meta WHERE key = 'worker:session-family' UNION SELECT substr(key, 15) FROM _meta WHERE key LIKE 'worker:family:%')", [milliseconds, bound, end, before])?;
        }
        self.conn().execute("UPDATE _outbox SET lease_until = CASE WHEN (?1 >= 0 AND lease_until > ?2) OR (?1 < 0 AND lease_until < ?2) THEN ?3 ELSE lease_until + ?1 END WHERE state = 'running' AND lease_until IS NOT NULL", [milliseconds, bound, end])?;
        // Advancing the dev clock cannot extend a claim past its admitting family.
        self.conn().execute("UPDATE _requests SET lease_until = CASE WHEN family IS NULL OR principal_generation IS NULL OR admitted_expires_at IS NULL THEN CASE WHEN (?1 >= 0 AND lease_until > ?2) OR (?1 < 0 AND lease_until < ?2) THEN ?3 ELSE lease_until + ?1 END ELSE MIN(CASE WHEN (?1 >= 0 AND lease_until > ?2) OR (?1 < 0 AND lease_until < ?2) THEN ?3 ELSE lease_until + ?1 END, COALESCE((SELECT MAX(s.expires_at) FROM _sessions s WHERE s.principal = _requests.principal AND COALESCE(s.family, s.token_digest) = _requests.family), lease_until)) END WHERE state = 'running' AND lease_until IS NOT NULL", [milliseconds, bound, end])?;
        self.conn().execute("UPDATE _sessions SET expires_at = (SELECT lease_until FROM _requests WHERE session_digest = _sessions.token_digest AND state = 'running') WHERE token_digest IN (SELECT session_digest FROM _requests WHERE state = 'running' AND lease_until IS NOT NULL)", [])?;
        Ok(())
    }

    fn expired_effects(&self, now: i64, limit: u64) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.min(i64::MAX as u64) as i64;
        Ok(self.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox WHERE state IN ('queued', 'running') AND (deadline <= ?1 OR (state = 'running' AND lease_until < ?1)) ORDER BY seq, id LIMIT ?2"))?
        .query_map([now, limit], read_run)?.collect::<Result<Vec<_>, _>>()?)
    }

    fn expired_effects_strict(&self, now: i64) -> Result<Vec<EffectRun>, RuntimeError> {
        Ok(self.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox WHERE state IN ('queued', 'running') AND (deadline <= ?1 OR (state = 'running' AND lease_until < ?1)) ORDER BY seq, id"))?
        .query_map([now], read_run)?.collect::<Result<Vec<_>, _>>()?)
    }

    fn expire_effect(&self, update: &ExpiredEffect<'_>) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _outbox SET state = ?2, error = ?3, error_code = ?4, settled_at = ?5, lease_until = NULL, claimed_by = NULL, lease_digest = NULL, next_at = ?6 WHERE id = ?1", params![update.id, update.state, update.error, update.code, update.settled_at, update.next_at])?;
        Ok(())
    }

    fn replay_deployed(&self) -> Result<bool, RuntimeError> {
        Ok(self.conn().query_row("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')", [], |row| row.get(0))?)
    }
}

impl OutboxStore for Store {
    fn effects_due(&self, effect: Option<&str>, now: i64) -> Result<bool, RuntimeError> {
        let due: i64 = match effect {
            Some(effect) => self.conn().query_row("SELECT COUNT(*) FROM (SELECT 1 FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) AND effect = ?2 ORDER BY seq, id LIMIT 1)", params![now, effect], |row| row.get(0))?,
            None => self.conn().query_row("SELECT COUNT(*) FROM (SELECT 1 FROM _outbox WHERE state = 'queued' AND (next_at IS NULL OR next_at <= ?1) ORDER BY seq, id LIMIT 1)", params![now], |row| row.get(0))?,
        };
        Ok(due > 0)
    }
    fn list_effects(&self, state: Option<&str>, limit: u64) -> Result<Vec<EffectRun>, RuntimeError> {
        let limit = limit.min(i64::MAX as u64) as i64;
        let runs = match state {
            Some(state) => self.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox WHERE state = ?1 ORDER BY seq DESC, id DESC LIMIT ?2"))?.query_map(params![state, limit], read_run)?.collect::<Result<Vec<_>, _>>()?,
            None => self.conn().prepare(&format!("SELECT {COLUMNS} FROM _outbox ORDER BY seq DESC, id DESC LIMIT ?1"))?.query_map(params![limit], read_run)?.collect::<Result<Vec<_>, _>>()?,
        };
        Ok(runs)
    }
    fn effect_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        let mut statement = self.conn().prepare("SELECT state, COUNT(*) FROM _outbox GROUP BY state")?;
        let mut counts = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64)))?.collect::<Result<BTreeMap<_, _>, _>>()?;
        let suppressed: i64 = self.conn().query_row("SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'dev:suppressed-effects'", [], |row| row.get(0)).optional()?.unwrap_or(0);
        if suppressed > 0 { counts.insert("suppressed".into(), suppressed as u64); }
        Ok(counts)
    }

    fn effect_health(&self, now: i64) -> Result<EffectHealth, RuntimeError> {
        let snapshot = self.conn().unchecked_transaction()?;
        let counts = self.effect_counts()?;
        // @ref LLP 3000.007#20.16 — report grace deferrals without treating retry backoff as presence.
        let deferred = self.conn().query_row(
            "SELECT COUNT(*), MIN(next_at) FROM _outbox WHERE state = 'queued' AND next_at > ?1 AND EXISTS (SELECT 1 FROM _effect_presence WHERE id = _outbox.id)",
            [now], |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, Option<i64>>(1)?)),
        ).map_err(|error| error.to_string());
        snapshot.rollback()?;
        Ok(EffectHealth { counts, deferred })
    }

    fn set_effect_replay(&self, replay: bool, check: impl FnOnce(bool) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        let tx = rusqlite::Transaction::new_unchecked(self.conn(), rusqlite::TransactionBehavior::Immediate)?;
        let deployed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM _meta WHERE key = 'release')", [], |row| row.get(0))?;
        check(deployed)?;
        tx.execute("INSERT INTO _meta(key, value) VALUES ('dev:replay', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [if replay { "true" } else { "false" }])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl crate::engine::effects::test_cases::Evidence for Tx<'_> {
        fn settled_at(&self,id: &str) -> Option<i64> {
            self.conn().query_row("SELECT settled_at FROM _outbox WHERE id = ?1",[id],|r| r.get(0)).unwrap()
        }
        fn seed_legacy(&self) { self.conn().execute_batch(crate::engine::effects::test_cases::LEGACY_ROW).unwrap(); }
    }

    macro_rules! contract {
        ($($name:ident),*) => { $(#[test] fn $name() {
            let mut store = Store::memory().unwrap();
            let tx = store.transaction().unwrap();
            crate::engine::effects::test_cases::$name(&tx);
            tx.commit().unwrap();
        })* };
    }
    contract!(signed_lease_shift_boundaries,nul_lookups,candidate_ordering,lifecycle_variants,text_and_wide_values,presence_satisfaction,deadline_and_attempt_limits);

    #[test]
    fn lease_shift_error_rolls_back_all_families_and_deployed_replay_refuses() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        tx.conn().execute_batch(crate::engine::effects::test_cases::LEASE_SEED).unwrap();
        crate::engine::effects::test_cases::race_seed(&tx,true);
        tx.commit().unwrap();
        store.conn().execute_batch("DROP TABLE _requests").unwrap();
        let tx = store.transaction().unwrap();
        assert!(tx.shift_worker_leases(200,100).is_err());
        tx.rollback().unwrap();
        let tx = store.transaction().unwrap();
        assert_eq!(tx.required_effect_run("race").unwrap().lease_until,Some(100));
        assert_eq!(tx.conn().query_row("SELECT expires_at FROM _sessions WHERE token_digest = 'legacy-worker'",[],|r| r.get::<_,i64>(0)).unwrap(),1000);
        tx.conn().execute("INSERT INTO _meta(key,value) VALUES ('release','live')",[]).unwrap();
        tx.commit().unwrap();
        crate::engine::effects::test_cases::deployed_replay_refusal(&store);
        let tx = store.transaction().unwrap();
        assert!(!tx.replay_suppresses().unwrap());
        tx.rollback().unwrap();
    }

    #[test]
    fn cached_projection_survives_additive_ddl_and_writer_never_repairs() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        crate::engine::effects::test_cases::race_seed(&tx,false);
        let before = tx.required_effect_run("race").unwrap();
        tx.commit().unwrap();
        store.conn().execute_batch("ALTER TABLE _outbox ADD COLUMN evaluation_probe TEXT; DROP TABLE _effect_presence").unwrap();
        let tx = store.transaction().unwrap();
        assert_eq!(tx.required_effect_run("race").unwrap(),before);
        assert!(tx.insert_effect_presence("alice","race",100).is_err());
        tx.rollback().unwrap();
        assert_eq!(store.conn().query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = '_effect_presence'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn adapter_error_rolls_back_and_legacy_nul_rows_remain_usable() {
        let mut store = Store::memory().unwrap();
        {
            let tx = store.transaction().unwrap();
            crate::engine::effects::test_cases::race_seed(&tx,false);
            assert!(tx.insert_effect(&NewEffect { id:"race", seq:1, effect:"mail",payload:&Value::Null,now:0,next_at:None,work:&legacy_work(),deadline:None,release:None,contract:"contract" }).is_err());
            // A statement error ends the transaction; the adapter is not called again.
            tx.rollback().unwrap();
        }
        assert!(store.list_effects(None,10).unwrap().is_empty());
        let tx = store.transaction().unwrap();
        tx.conn().execute("INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at) VALUES (?1,1,?2,'null','queued',0,0)",params!["legacy\0id","legacy\0effect"]).unwrap();
        tx.conn().execute("INSERT INTO _effect_presence(principal,id,deadline) VALUES (?1,?2,100)",params!["legacy\0principal","legacy\0id"]).unwrap();
        tx.claim_effect("legacy\0id","legacy\0worker",100,None).unwrap();
        tx.reconnect_effect_presence("legacy\0principal",100).unwrap();
        assert!(tx.effect_presence_satisfied("legacy\0id").unwrap());
        assert_eq!(tx.required_effect_run("legacy\0id").unwrap().claimed_by.as_deref(),Some("legacy\0worker"));
        tx.retry_effect("legacy\0id","retry",0).unwrap();
        tx.cancel_effect("legacy\0id",1).unwrap();
        assert!(tx.required_effect_run("legacy\0id").unwrap().cancelled);
        tx.commit().unwrap();
    }

    #[test]
    fn shared_snapshots_replay_and_leases() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        tx.conn().execute_batch(crate::engine::effects::test_cases::LEASE_SEED).unwrap();
        crate::engine::effects::test_cases::lease_shift(&tx);
        let sessions = tx.conn().prepare("SELECT token_digest,expires_at FROM _sessions ORDER BY token_digest").unwrap().query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
        assert_eq!(sessions, [("delegated".into(),900),("expired-worker".into(),100),("legacy-worker".into(),1200),("modern-worker".into(),1700),("ordinary".into(),900)]);
        let requests = tx.conn().prepare("SELECT id,lease_until FROM _requests ORDER BY id").unwrap().query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
        assert_eq!(requests, [("bound".into(),900),("legacy".into(),1000),("missing".into(),700),("queued".into(),600)]);
        tx.rollback().unwrap();
        let tx = store.transaction().unwrap();
        crate::engine::effects::test_cases::snapshot_seed(&tx);
        tx.commit().unwrap();
        crate::engine::effects::test_cases::snapshot_reads(&store);
        crate::engine::effects::test_cases::nul_snapshot_reads(&store);
        let tx = store.transaction().unwrap();
        crate::engine::effects::test_cases::replay_suppression(&tx);
        tx.commit().unwrap();
        assert_eq!(store.effect_counts().unwrap().get("suppressed"),Some(&3));
    }

    #[test]
    fn shared_expiry_and_generation_cases() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        crate::engine::effects::test_cases::expiry_and_generation(&tx);
        tx.rollback().unwrap();
        assert!(store.list_effects(None, 500).unwrap().is_empty());
    }

    #[test]
    fn shared_presence_and_bounded_maintenance_cases() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        crate::engine::effects::test_cases::presence_and_bounded_maintenance(&tx);
        tx.commit().unwrap();
        assert_eq!(store.effect_counts().unwrap().get("queued"), Some(&2));
    }

    #[test]
    fn nul_filter_claim_commits_expiry_and_matches_public_engine() {
        use crate::engine::effects::test_cases;
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::race_seed(&tx, true);
        tx.commit().unwrap();
        let tx = store.transaction().unwrap();
        test_cases::nul_filter_after_expiry(&tx);
        tx.commit().unwrap();
        let tx = store.transaction().unwrap();
        let run = tx.required_effect_run("race").unwrap();
        tx.rollback().unwrap();
        assert_eq!(run, test_cases::sqlite_nul_claim_oracle());
    }

    #[test]
    fn lease_shift_saturates_all_families() {
        use crate::engine::effects::test_cases;
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        tx.conn().execute_batch(test_cases::LEASE_BOUNDARY_SEED).unwrap();
        test_cases::lease_shift_saturates(&tx);
        tx.commit().unwrap();
        // Typed reads after commit must remain INTEGER, never SQLite REAL.
        let sessions = store.conn().prepare("SELECT token_digest, expires_at FROM _sessions ORDER BY token_digest").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        let requests = store.conn().prepare("SELECT id, lease_until FROM _requests ORDER BY id").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        test_cases::lease_boundary_rows(sessions, requests);
    }
}
