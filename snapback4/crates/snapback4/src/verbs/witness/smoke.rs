//! Smoke is a mode of the installed-app driver: the same ownership, receipts,
//! captures, timeouts, artifact reservation and cleanup as application scenarios.
use super::*;

impl Run {
    pub(super) fn execute_smoke(&mut self) -> Result<()> {
        self.manifest["segments"] = json!({
            "prime": { "status": "not-run" }, "offline": { "status": "not-run" }, "restart": { "status": "not-run" }
        });
        self.require_stopped()?;
        self.start_backend()?;
        self.capture()?;
        self.smoke_segment("prime", "primed", false)?;
        self.stop_backend()?;
        self.smoke_segment("offline", "offline-done", true)?;
        self.smoke_barrier()?;
        self.start_backend()?;
        self.smoke_segment("restart", "done", false)?;
        self.finish_capture()?;
        self.stop_backend()
    }

    // A quiet app has no new data commits. The driver advances only the
    // commit clock, while both its server and app are stopped. No schema,
    // application row, log event or outbox entry is written.
    fn smoke_barrier(&mut self) -> Result<()> {
        if self.backend.is_some() || !refused(self.options.port)? { return Err(error("E_WITNESS_BACKEND", "smoke barrier requires the owned backend to be stopped")); }
        let path = self.manifest["backend"]["store"].as_str().ok_or_else(|| error("E_WITNESS_BACKEND", "missing backend store path"))?;
        let prime = &self.manifest["segments"]["prime"]["receipt"];
        let seq = barrier(Path::new(path), prime["storeId"].as_str().unwrap_or_default(), prime["watermark"].as_u64().unwrap_or(u64::MAX))?;
        self.manifest["syncBarrier"] = json!({ "seq": seq, "applicationWrites": 0, "at": now() });
        self.event("smoke-sync-barrier");
        Ok(())
    }

    fn smoke_segment(&mut self, segment: &str, milestone: &str, offline: bool) -> Result<()> {
        let started = now();
        self.manifest["segments"][segment] = json!({ "status": "running", "startedAt": started });
        let result = self.launch(segment).and_then(|_| self.wait_step(milestone, offline));
        // Capture failures too, while the process/screen is still present.
        let picture = self.path(&format!("{segment}.png"));
        let screenshot = simctl(&["io", &self.udid, "screenshot", picture.to_str().unwrap()], self.options.timeout).map(|_| ());
        let stopped = self.terminate();
        let result = result.and(screenshot).and(stopped);
        let ended = now();
        let entry = &mut self.manifest["segments"][segment];
        entry["endedAt"] = json!(ended);
        entry["durationMs"] = json!(ended - started);
        entry["status"] = json!(if result.is_ok() { "passed" } else { "failed" });
        entry["error"] = json!(result.as_ref().err());
        if let Some(receipt) = self.observed.iter().rev().find_map(|row| {
            let receipt = &row["smoke"];
            (receipt["segment"] == segment && receipt["pass"] == true).then(|| receipt.clone())
        }) { entry["receipt"] = receipt; }
        result?;
        validate_receipt(segment, &self.manifest["segments"][segment]["receipt"], &self.manifest["segments"]["prime"]["receipt"])
    }

    pub(super) fn save_smoke(&mut self, problem: &mut Option<String>) {
        // Failed lines remain evidence even though protocol validation refuses
        // them. Copy them into the manifest without treating them as successes.
        if let Ok(bytes) = fs::read_to_string(self.path("receipts.jsonl")) {
            for line in bytes.lines() {
                if let Ok(row) = serde_json::from_str::<Value>(line) {
                    let receipt = &row["smoke"];
                    if let Some(segment @ ("prime" | "offline" | "restart")) = receipt["segment"].as_str() {
                        let entry = &mut self.manifest["segments"][segment];
                        if !entry["receipts"].is_array() { entry["receipts"] = json!([]); }
                        entry["receipts"].as_array_mut().unwrap().push(receipt.clone());
                        entry["receipt"] = receipt.clone();
                        if receipt["pass"] != true {
                            self.manifest["segments"][segment]["status"] = json!("failed");
                            problem.get_or_insert_with(|| error("E_WITNESS_STEP", format!("{segment} smoke failed; see its receipt")));
                        }
                    }
                }
            }
        }
        for segment in ["prime", "offline", "restart"] {
            let suffix = format!("{segment}.png");
            match artifact(&self.path(&suffix)) {
                Ok(value) => self.manifest["artifacts"][&suffix] = value,
                Err(e) => { problem.get_or_insert(e); },
            }
            if self.manifest["segments"][segment]["status"] == "passed" {
                if let Err(e) = validate_receipt(segment, &self.manifest["segments"][segment]["receipt"], &self.manifest["segments"]["prime"]["receipt"]) {
                    self.manifest["segments"][segment]["status"] = json!("failed");
                    problem.get_or_insert(e);
                }
            }
        }
    }
}

fn validate_receipt(segment: &str, value: &Value, prime: &Value) -> Result<()> {
    let valid = value["segment"] == segment && value["pass"] == true
        && value["errors"].as_array().is_some_and(Vec::is_empty)
        && value["rows"].as_object().is_some_and(|rows| rows.values().all(|count| count.as_u64().is_some()))
        && value["storeId"].as_str().is_some_and(|s| !s.is_empty())
        && value["watermark"].as_u64().is_some() && value["acquired"] == true && value["backendRequired"] == false
        && value["link"] == if segment == "offline" { "offline" } else { "online" };
    if !valid { return Err(error("E_WITNESS_RECEIPT", format!("{segment} did not supply a successful native smoke receipt"))); }
    if segment != "prime" && ["origin", "viewer", "storeId", "generation"].iter().any(|key| value[*key] != prime[*key]) {
        return Err(error("E_WITNESS_STEP", "smoke backend/session identity changed since prime"));
    }
    if segment == "offline" && value["rows"] != prime["rows"] { return Err(error("E_WITNESS_STEP", "offline held counts differ from prime")); }
    if segment == "restart" && value["watermark"].as_u64() <= prime["watermark"].as_u64() {
        return Err(error("E_WITNESS_STEP", "restart watermark did not advance past prime"));
    }
    Ok(())
}

fn barrier(path: &Path, store_id: &str, prime: u64) -> Result<u64> {
    let append = || -> std::result::Result<u64, snapback4_core::RuntimeError> {
        let mut store = snapback4_core::Store::open(path)?;
        if store.meta("store_id")?.as_deref() != Some(store_id) || store.seq()? < prime {
            return Err(snapback4_core::RuntimeError::Store("smoke backend identity/watermark changed since prime".into()));
        }
        let tx = store.transaction()?;
        let seq = tx.next_seq()?;
        tx.record_commit(seq, now() as i64, "native-smoke", "system", "witness", &[], 0)?;
        tx.commit()?;
        Ok(seq)
    };
    append().map_err(|e| error("E_WITNESS_BACKEND", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn smoke_barrier_advances_only_the_commit_clock() {
        let dir = std::env::temp_dir().join(format!("smoke-barrier-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  value: int\n  read <- allow\n  sync public\n".into())]);
        let mut engine = snapback4_core::Engine::new(snapback4_core::Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        use snapback4_core::value::{Value, object};
        engine.seed([("items".into(), object([("id", Value::Id("sentinel".into())), ("value", Value::Int(42))]))]).unwrap();
        let counts = |store: &snapback4_core::Store| ["r", "i", "_log", "_ops"].map(|table| {
            store.conn().query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap()
        });
        let held = counts(engine.store());
        let row: String = engine.store().conn().query_row("SELECT data FROM r WHERE id = 'sentinel'", [], |r| r.get(0)).unwrap();
        let before = engine.seq().unwrap();
        let identity = engine.store().meta("store_id").unwrap().unwrap();
        drop(engine);
        let seq = barrier(&path, &identity, before).unwrap();
        assert!(seq > before);
        let store = snapback4_core::Store::open(&path).unwrap();
        assert_eq!(store.seq().unwrap(), seq);
        assert_eq!(counts(&store), held);
        assert_eq!(store.conn().query_row("SELECT data FROM r WHERE id = 'sentinel'", [], |r| r.get::<_, String>(0)).unwrap(), row);
        assert!(barrier(&path, "wrong-store", seq).is_err());
        drop(store);
        let _ = fs::remove_dir_all(dir);
    }
}
