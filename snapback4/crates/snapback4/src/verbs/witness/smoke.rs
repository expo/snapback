//! Smoke is a mode of the installed-app driver: the same ownership, receipts,
//! captures, timeouts, artifact reservation and cleanup as application scenarios.
use super::*;

// @ref LLP 3000.011.005.000#2 — compile the owned backend; never classify from a runtime result.
pub(super) fn query_facts(root: &Path) -> Result<Value> {
    let bound = crate::project::Project { root: root.to_owned() }.compile().map_err(|e| error("E_WITNESS_BACKEND", e))?;
    compiled_query_facts(&bound)
}
fn compiled_query_facts(bound: &snapback4_lang::Bound) -> Result<Value> {
    use snapback4_core::ir::{ArgType, ProgramKind};
    if !bound.diagnostics.is_empty() { return Err(error("E_WITNESS_BACKEND", "cannot compile smoke residency facts; run snapback4 check")); }
    let mut facts = serde_json::Map::new();
    for p in &bound.programs {
        let p = &p.program;
        if p.kind != ProgramKind::Query || !p.args.values().all(|a| matches!(a, ArgType::Optional(_))) { continue; }
        let fact = bound.schema.operations.get(&p.name).ok_or_else(|| error("E_WITNESS_BACKEND", format!("missing compiler fact for {}", p.name)))?;
        if !matches!(fact.runs.as_deref(), Some("device" | "server")) { return Err(error("E_WITNESS_BACKEND", format!("missing residency for {}", p.name))); }
        facts.insert(p.name.clone(), json!({ "runs": fact.runs, "held": fact.held }));
    }
    Ok(Value::Object(facts))
}
fn validate_queries(segment: &str, value: &Value, facts: &Value) -> Result<()> {
    let refuse = || error("E_WITNESS_RECEIPT", format!("{segment} query results do not match compiler residency facts"));
    let facts_map = facts.as_object().ok_or_else(refuse)?;
    if &value["queryFacts"] != facts { return Err(refuse()); }
    let queries = value["queries"].as_array().ok_or_else(refuse)?;
    let expected: Vec<_> = facts_map.iter().filter(|(_, f)| segment == "offline" || f["runs"] == "server").collect();
    if queries.len() != expected.len() { return Err(refuse()); }
    for (name, fact) in expected {
        let matching: Vec<_> = queries.iter().filter(|q| q["name"] == *name).collect();
        if matching.len() != 1 { return Err(refuse()); }
        let q = matching[0];
        let server = fact["runs"] == "server";
        if q["classification"] != if server { "online-only" } else { "device-answerable" } { return Err(refuse()); }
        let explained = q["state"] == "refused" && q["code"].as_str().is_some_and(|s| !s.is_empty()) && q["message"].as_str().is_some_and(|s| !s.is_empty());
        let ready = q["state"] == "ready" && q["count"].as_u64().is_some();
        let valid = if server && segment == "offline" {
            q["expectation"] == "online-only: unavailable offline (expected)" && (q["state"] == "loading"
                || (explained && q["code"].as_str().is_some_and(|s| s == "E_OFFLINE" || s.starts_with("E_OFFLINE_"))))
        } else if server { ready } else { ready || explained };
        if !valid { return Err(refuse()); }
    }
    Ok(())
}

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
        let stopped = self.terminate(result.is_ok() && screenshot.is_ok());
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
        if self.manifest["segments"][segment]["receipt"]["origin"] != self.manifest["backend"]["origin"] {
            let problem = error("E_WITNESS_ORIGIN", "smoke client origin differs from the witness-owned backend; rebundle or choose its matching --port");
            self.manifest["segments"][segment]["status"] = json!("failed");
            self.manifest["segments"][segment]["error"] = json!(problem);
            return Err(problem);
        }
        validate_queries(segment, &self.manifest["segments"][segment]["receipt"], &self.manifest["queryFacts"])?;
        validate_receipt(segment, &self.manifest["segments"][segment]["receipt"], &self.manifest["segments"]["prime"]["receipt"], self.manifest["syncBarrier"]["seq"].as_u64())
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
                if let Err(e) = validate_queries(segment, &self.manifest["segments"][segment]["receipt"], &self.manifest["queryFacts"]).and_then(|_| validate_receipt(segment, &self.manifest["segments"][segment]["receipt"], &self.manifest["segments"]["prime"]["receipt"], self.manifest["syncBarrier"]["seq"].as_u64())) {
                    self.manifest["segments"][segment]["status"] = json!("failed");
                    problem.get_or_insert(e);
                }
            }
        }
    }
}

fn validate_receipt(segment: &str, value: &Value, prime: &Value, barrier: Option<u64>) -> Result<()> {
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
    if segment == "restart" && !barrier.is_some_and(|seq| Some(seq) > prime["watermark"].as_u64() && value["watermark"].as_u64() >= Some(seq)) {
        return Err(error("E_WITNESS_STEP", "restart watermark did not consume the restart barrier"));
    }
    Ok(())
}

fn barrier(path: &Path, store_id: &str, prime: u64) -> Result<u64> {
    // @ref LLP 3000.019#3.4 — a restart witness writes only while the backend store is unowned.
    let _owner = crate::store_owner::command(path).map_err(|e| error("E_WITNESS_BACKEND", e))?;
    let append = || -> std::result::Result<u64, snapback4_core::RuntimeError> {
        let mut store = _owner.open_store(std::time::Duration::from_secs(5))?;
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
    fn compiler_classifies_ephemeral_and_online_queries_before_execution() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), r#"
table heldRows:
  value: int
  read <- allow
  sync public
table remoteRows:
  value: int
  read <- allow
  online only
table signals:
  principal: principal
  unique byPrincipal: principal
  read <- allow
  ephemeral 4s
query held(c: cursor ?):
  return heldRows first 10 after c
query remote(c: cursor ?):
  return remoteRows first 10 after c
query ephemeral(c: cursor ?):
  return signals first 10 after c
query required(id: heldRows):
  return heldRows[id]
"#.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let facts = compiled_query_facts(&bound).unwrap();
        assert_eq!(facts.as_object().unwrap().len(), 3);
        assert_eq!(facts["held"]["runs"], "device");
        assert_eq!(facts["remote"]["runs"], "server");
        assert_eq!(facts["ephemeral"]["runs"], "server");
    }
    #[test]
    fn receipt_cannot_reclassify_or_skip_a_query() {
        let facts = json!({"held": {"runs": "device", "held": false}, "remote": {"runs": "server", "held": false}});
        let mut r = json!({"queryFacts": facts, "queries": [
            {"name": "held", "classification": "device-answerable", "state": "ready", "count": 0},
            {"name": "remote", "classification": "online-only", "state": "loading", "expectation": "online-only: unavailable offline (expected)"}
        ]});
        assert!(validate_queries("offline", &r, &facts).is_ok());
        r["queries"][0]["state"] = json!("loading");
        assert!(validate_queries("offline", &r, &facts).is_err());
        r["queries"][0]["state"] = json!("ready");
        r["queries"][1]["classification"] = json!("device-answerable");
        assert!(validate_queries("offline", &r, &facts).is_err());
        r["queries"] = json!([]);
        assert!(validate_queries("offline", &r, &facts).is_err());
        assert!(validate_queries("prime", &r, &facts).is_err());
        r["queries"] = json!([{"name":"remote", "classification":"online-only", "state":"ready", "count":0}]);
        assert!(validate_queries("restart", &r, &facts).is_ok());
        r["queries"][0]["state"] = json!("loading");
        assert!(validate_queries("restart", &r, &facts).is_err());
    }
    #[test]
    fn restart_requires_its_barrier_even_if_newer_than_prime() {
        let prime = json!({ "segment": "prime", "pass": true, "errors": [], "rows": {}, "storeId": "store",
            "watermark": 7, "acquired": true, "backendRequired": false, "link": "online" });
        let mut restart = prime.clone(); restart["segment"] = json!("restart"); restart["watermark"] = json!(8);
        assert!(validate_receipt("restart", &restart, &prime, Some(9)).unwrap_err().contains("restart barrier"));
        assert!(validate_receipt("restart", &restart, &prime, None).is_err());
        restart["watermark"] = json!(9);
        assert!(validate_receipt("restart", &restart, &prime, Some(9)).is_ok());
    }
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
        {
            let mut owner = crate::store_owner::command(&path).unwrap();
            crate::store_owner::announce(&mut owner, "127.0.0.1:1234".parse().unwrap()).unwrap();
            let refused = barrier(&path, &identity, before).unwrap_err();
            assert!(refused.contains("E_STORE_BUSY") && refused.contains("http://127.0.0.1:1234"), "{refused}");
            let store = owner.open_store(std::time::Duration::from_secs(5)).unwrap();
            assert_eq!(store.seq().unwrap(), before);
        }
        let seq = barrier(&path, &identity, before).unwrap();
        assert!(seq > before);
        let store = snapback4_core::Store::open(&path).unwrap();
        assert_eq!(store.seq().unwrap(), seq);
        assert_eq!(counts(&store), held);
        assert_eq!(store.conn().query_row("SELECT data FROM r WHERE id = 'sentinel'", [], |r| r.get::<_, String>(0)).unwrap(), row);
        drop(store);
        assert!(barrier(&path, "wrong-store", seq).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
