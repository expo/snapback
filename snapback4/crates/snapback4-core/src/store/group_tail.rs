//! A program batch retains every member's history and writes each family once.
// @ref LLP 3000.009.001.000.002#sqlite-durable-write-cycle — vectorize physical statements without collapsing public history.
use super::*;
use std::cell::RefCell;

#[derive(Default)]
pub(super) struct Batch {
    pub head: u64,
    pub commits: Vec<serde_json::Value>,
    pub logs: Vec<serde_json::Value>,
    saves: Vec<(String, (u64, usize, usize))>,
}
pub(super) type Tail = RefCell<Option<Batch>>;
impl Tx<'_> {
    pub(crate) fn batch_level(&self, accesses: &[crate::engine::committer::overlay::Access], schema: &Schema, base: &mut crate::engine::committer::overlay::Base) -> Result<(), RuntimeError> {
        if accesses.is_empty() { return Ok(()); }
        if accesses.iter().all(|a| a.index == "byId") {
            let probes = accesses.iter().map(|a| Ok(serde_json::json!([self.num(&a.table)?, a.key[0].as_str()?]))).collect::<Result<Vec<_>, RuntimeError>>()?;
            let encoded = serde_json::to_string(&probes).map_err(|e| RuntimeError::Store(e.to_string()))?;
            let mut stmt = self.conn().prepare_cached("SELECT p.key,r.data FROM json_each(?1) p LEFT JOIN r ON r.t=p.value->>0 AND r.id=p.value->>1")?;
            let mut rows = stmt.query([encoded])?;
            let mut seen = vec![false; accesses.len()];
            while let Some(row) = rows.next()? {
                let index = row.get::<_, i64>(0)? as usize;
                if index >= seen.len() || seen[index] { return Err(RuntimeError::Store("batch point coverage mismatch".into())); }
                seen[index] = true;
                let data: Option<String> = row.get(1)?;
                let image = data.map(|d| serde_json::from_str(&d).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?;
                base.insert(&accesses[index], image);
            }
            if seen.iter().any(|s| !s) { return Err(RuntimeError::Store("batch point coverage mismatch".into())); }
        } else {
            for access in accesses {
                let row = if access.index == "byId" { self.get(&access.table, access.key[0].as_str()?)? }
                    else { self.lookup(&access.table, &access.index, &schema.tables[&access.table].indexes[&access.index], &access.key)? };
                base.insert(access, row);
            }
        }
        Ok(())
    }
    // @ref LLP 3000.009.001.000.002#sqlite-overlay-layout-proof — deployment generations do not by themselves imply retained row semantics.
    pub(crate) fn buffered_layout_compatible(&self) -> Result<bool, RuntimeError> {
        if self.lifecycle { return Ok(false); }
        let mut tables = self.conn().prepare_cached("SELECT 'main',name FROM main.sqlite_schema WHERE type='table' UNION ALL SELECT 'temp',name FROM temp.sqlite_schema WHERE type='table'")?;
        let mut occupied = vec!["EXISTS(SELECT 1 FROM main._meta WHERE key LIKE 'activation_%' AND key <> 'activation_hash')".to_owned()];
        for row in tables.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (db, name) = row?;
            if ["_asset_column_renames", "_table_renames", "_release_preview_cells", "_release_preview_active"].contains(&name.as_str()) {
                occupied.push(format!("EXISTS(SELECT 1 FROM {db}.\"{}\")", name.replace('"', "\"\"")));
            } else if name.starts_with("_dormant_") {
                if !["_dormant_columns", "_dormant_indexes", "_dormant_narrow_rows", "_dormant_refs", "_dormant_rows", "_dormant_tables", "_dormant_values"].contains(&name.as_str()) { return Ok(false); }
                occupied.push(format!("EXISTS(SELECT 1 FROM {db}.\"{}\")", name.replace('"', "\"\"")));
            } else if ["_backfill_", "_downfill_", "_live_", "_extraction_", "_rollback_"].iter().any(|p| name.starts_with(p)) {
                return Ok(false);
            }
        }
        if occupied.is_empty() { return Ok(true); }
        let occupied: bool = self.conn().prepare_cached(&format!("SELECT {}", occupied.join(" OR ")))?.query_row([], |r|r.get(0))?;
        Ok(!occupied)
    }
    // @ref LLP 3000.009.001.000.002#sqlite-durable-write-cycle — unchanged-index images can share one checked physical UPDATE; lifecycle observers retain their ordinary path.
    pub(crate) fn apply_overlay(&self, schema: &Schema, images: Vec<crate::engine::committer::overlay::Image>) -> Result<(), RuntimeError> {
        if images.is_empty() { return Ok(()); }
        let tables: Vec<i64> = images.iter().map(|i| self.num(&i.table)).collect::<Result<_, _>>()?;
        let backfills = if backfills::present(self)? {
            let keys = serde_json::to_string(&tables).map_err(|e| RuntimeError::Store(e.to_string()))?;
            self.conn().prepare_cached("SELECT EXISTS(SELECT 1 FROM _backfill_active WHERE t IN (SELECT value FROM json_each(?1)) UNION ALL SELECT 1 FROM _backfill_inputs WHERE t IN (SELECT value FROM json_each(?1)))")?.query_row([keys], |r| r.get::<_, bool>(0))?
        } else { false };
        if self.lifecycle || backfills || images.iter().any(|i| schema.tables[&i.table].columns.values().any(|c| c.contains_asset())) {
            for i in images {
                if self.put(&i.table, &schema.tables[&i.table], &i.new, Some(&i.old))? != 0 { return Err(RuntimeError::Store("qualified overlay changed an index".into())); }
            }
            return Ok(());
        }
        let mut rows = Vec::with_capacity(images.len());
        for (i, t) in images.iter().zip(tables) {
            let table = &schema.tables[&i.table];
            if table.ephemeral.is_some() { return Err(RuntimeError::Store("durable transaction cannot write an ephemeral table".into())); }
            let id = i.new.field("id")?.as_str()?;
            let keys = crate::rows::index_write(&i.table, table, &i.new, Some(&i.old), id)?;
            if keys.iter().any(|k| k.before != k.after) || !crate::rows::caps::deltas(table, Some(&i.old), Some(&i.new)).is_empty() {
                return Err(RuntimeError::Store("qualified overlay changed an index".into()));
            }
            self.changes.borrow_mut().record(&i.table, table, Some(&i.old), Some(&i.new));
            rows.push(serde_json::json!([t, id, canonical_json(&i.new)]));
        }
        let data = serde_json::to_string(&rows).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let affected = self.conn().prepare_cached("WITH images AS (SELECT value->>0 AS t,value->>1 AS id,value->>2 AS data FROM json_each(?1)) UPDATE r SET data=images.data FROM images WHERE r.t=images.t AND r.id=images.id")?.execute([data])?;
        require(affected, images.len(), "images")
    }
    pub(crate) fn enable_group_tail(&self) -> Result<(), RuntimeError> {
        let head = self.next_seq()? - 1;
        *self.group_tail.borrow_mut() = Some(Batch { head, ..Default::default() });
        Ok(())
    }
    pub(super) fn save_tail(&self, name: &str) {
        if let Some(b) = self.group_tail.borrow_mut().as_mut() { b.saves.push((name.into(), (b.head, b.commits.len(), b.logs.len()))); }
    }
    pub(super) fn release_tail(&self, name: &str, rollback: bool) {
        if let Some(b) = self.group_tail.borrow_mut().as_mut() && let Some(i) = b.saves.iter().rposition(|(n, _)| n == name) {
            let (_, (head, c, l)) = b.saves[i];
            if rollback { b.head = head; b.commits.truncate(c); b.logs.truncate(l); }
            b.saves.truncate(i);
        }
    }
    pub(crate) fn flush_group_tail(&self) -> Result<(), RuntimeError> {
        let mut state = self.group_tail.borrow_mut();
        let Some(batch) = state.as_mut() else { return Ok(()); };
        if !batch.commits.is_empty() {
            let data = serde_json::to_string(&batch.commits).map_err(|e| RuntimeError::Store(e.to_string()))?;
            let affected = self.conn().prepare_cached("INSERT INTO _commits(seq,at,program,principal,kind,touched,writes) SELECT value->>0,value->>1,value->>2,value->>3,value->>4,value->>5,value->>6 FROM json_each(?1)")?.execute([&data])?;
            require(affected, batch.commits.len(), "commits")?;
            let affected = self.conn().prepare_cached("INSERT INTO _change_evidence(seq,footprint) SELECT value->>0,value->>7 FROM json_each(?1)")?.execute([&data])?;
            require(affected, batch.commits.len(), "evidence")?;
            self.conn().prepare_cached("DELETE FROM _change_evidence WHERE seq <= ?1")?.execute([batch.head.saturating_sub(1000) as i64])?;
            batch.commits.clear();
        }
        if !batch.logs.is_empty() {
            let data = serde_json::to_string(&batch.logs).map_err(|e| RuntimeError::Store(e.to_string()))?;
            let affected = self.conn().prepare_cached("INSERT INTO _log(partition,seq,ord,t,kind,id,data) SELECT value->>0,value->>1,value->>2,value->>3,value->>4,value->>5,value->>6 FROM json_each(?1)")?.execute([&data])?;
            require(affected, batch.logs.len(), "logs")?;
            batch.logs.clear();
        }
        Ok(())
    }
}
fn require(actual: usize, expected: usize, family: &str) -> Result<(), RuntimeError> {
    if actual != expected { return Err(RuntimeError::Store(format!("SQLite batch {family} count mismatch: expected {expected}, got {actual}"))); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "owned subprocess invoked by sqlite_group_tail_ack_survives_kill_and_durable_prefix_truncation"]
    fn sqlite_group_tail_crash_child() {
        let dir = PathBuf::from(std::env::var_os("SNAPBACK4_SQW_CRASH_ROOT").unwrap());
        let mut store = Store::open(&dir.join("store.sqlite")).unwrap();
        // Keep an append-only WAL for the explicit lost-unsynced-suffix model;
        // ordinary checkpoint/reuse remains covered by the serving/core suite.
        store.conn().execute_batch("PRAGMA wal_autocheckpoint=0; CREATE TABLE witness(n INTEGER PRIMARY KEY)").unwrap();
        assert_eq!(store.conn().query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        for batch in 0..10000u64 {
            let tx = store.transaction().unwrap();
            tx.enable_group_tail().unwrap();
            for member in 1..=32 {
                let seq = batch * 32 + member;
                tx.conn().execute("INSERT INTO witness VALUES(?1)", [seq as i64]).unwrap();
                tx.record_commit(seq, 1000, "witness", "alice", "user", &[], 1).unwrap();
                tx.append_log("p", seq, 0, "witness", "put", &seq.to_string(), Some("{}")).unwrap();
            }
            tx.flush_group_tail().unwrap();
            assert!(tx.commit_program().is_ok());
            let wal_len = std::fs::metadata(dir.join("store.sqlite-wal")).unwrap().len();
            std::fs::write(dir.join("ack.tmp"), format!("{} {wal_len}", (batch + 1) * 32)).unwrap();
            std::fs::rename(dir.join("ack.tmp"), dir.join("ack")).unwrap();
        }
    }
    #[test]
    fn sqlite_group_tail_ack_survives_kill_and_durable_prefix_truncation() {
        use std::{process::{Command, Stdio}, time::{Duration, Instant}};
        let dir = std::env::temp_dir().join(format!("sqw-crash-{}-{:x}", std::process::id(), crate::ids::seed()));
        std::fs::create_dir(&dir).unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "store::group_tail::tests::sqlite_group_tail_crash_child", "--ignored", "--nocapture"])
            .env("SNAPBACK4_SQW_CRASH_ROOT", &dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        // Record the exact child before any signal; never select by name.
        std::fs::write(dir.join("child.pid"), child.id().to_string()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let ack = loop {
            if let Ok(ack) = std::fs::read_to_string(dir.join("ack")) {
                let numbers: Vec<u64> = ack.split_whitespace().map(|s|s.parse().unwrap()).collect();
                if numbers[0] >= 320 { break numbers; }
            }
            if child.try_wait().unwrap().is_some() || Instant::now() >= deadline {
                let _ = child.kill(); let _ = child.wait(); panic!("owned crash child failed to acknowledge");
            }
            std::thread::sleep(Duration::from_millis(1));
        };
        child.kill().unwrap(); child.wait().unwrap();
        for truncated in [false, true] {
            let copy = dir.join(if truncated { "lost-suffix" } else { "kill" });
            std::fs::create_dir(&copy).unwrap();
            for suffix in ["", "-wal"] { std::fs::copy(dir.join(format!("store.sqlite{suffix}")), copy.join(format!("store.sqlite{suffix}"))).unwrap(); }
            if truncated {
                std::fs::OpenOptions::new().write(true).open(copy.join("store.sqlite-wal")).unwrap().set_len(ack[1]).unwrap();
            }
            let recovered = Store::open(&copy.join("store.sqlite")).unwrap();
            let seq = recovered.seq().unwrap();
            assert!(seq >= ack[0], "acknowledged {ack:?}, recovered {seq}");
            if truncated { assert_eq!(seq, ack[0]); }
            for table in ["witness", "_commits", "_log"] {
                let rows: i64 = recovered.conn().query_row(&format!("SELECT count(*) FROM {table}"), [], |r|r.get(0)).unwrap();
                assert_eq!(rows, seq as i64, "{table}");
            }
            assert_eq!(recovered.conn().query_row("PRAGMA integrity_check", [], |r|r.get::<_, String>(0)).unwrap(), "ok");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn sqlite_group_tail_preserves_history_and_rolls_back_nested_buffers() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        tx.enable_group_tail().unwrap();
        for seq in 1..=3 {
            tx.savepoint("member").unwrap();
            assert_eq!(tx.next_seq().unwrap(), seq);
            tx.record_commit(seq, 1000, "bump", "alice", "user", &[], 0).unwrap();
            tx.append_log("p", seq, 0, "counter", "put", "a", Some("{}")).unwrap();
            tx.savepoint("inner").unwrap();
            tx.record_commit(seq + 1, 1001, "discard", "alice", "user", &[], 0).unwrap();
            tx.rollback_to("inner").unwrap();
            tx.release("member").unwrap();
        }
        tx.flush_group_tail().unwrap();
        assert_eq!(tx.conn().query_row("SELECT count(*) FROM _commits", [], |r|r.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(tx.conn().query_row("SELECT count(*) FROM _log", [], |r|r.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(tx.next_seq().unwrap(), 4);
        tx.commit().unwrap();
        assert_eq!(store.seq().unwrap(), 3);
    }
    #[test]
    fn sqlite_group_tail_count_failure_rolls_back_every_family() {
        let mut store = Store::memory().unwrap();
        let tx = store.transaction().unwrap();
        tx.conn().execute_batch("CREATE TEMP TRIGGER skip_evidence BEFORE INSERT ON _change_evidence BEGIN SELECT RAISE(IGNORE); END").unwrap();
        tx.enable_group_tail().unwrap();
        tx.record_commit(1, 1000, "bump", "alice", "user", &[], 0).unwrap();
        assert!(tx.flush_group_tail().unwrap_err().to_string().contains("count mismatch"));
        tx.rollback().unwrap();
        assert_eq!(store.seq().unwrap(), 0);
        assert_eq!(store.conn().query_row("SELECT count(*) FROM _change_evidence", [], |r|r.get::<_, i64>(0)).unwrap(), 0);
    }
}
