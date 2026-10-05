use super::*;

#[test]
fn bearer_is_checked_after_durable_and_ephemeral_mutation_lock_gaps() {
    for revoke in [false, true] {
        for (replay, has_id, lock_number, ephemeral, memory) in [(true, true, 1, false, false), (false, false, 1, false, false), (false, true, 2, false, false), (false, false, 1, true, false), (false, false, 2, true, true)] {
            let dir = ReaderTestDirectory::new();
            let source = format!("{}table typing:\n  owner: principal\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  ephemeral 4s\nmutation typeNow(id: id):\n  upsert typing[owner = viewer] {{}}\n", reads::SOURCE);
            let store = if memory { snapback4_core::Store::memory().unwrap() }
                else { snapback4_core::Store::open(&dir.0.join("auth.db")).unwrap() };
            let host = Host::with_store(false, store, &source);
            let session = body(&host.request("POST", "/auth/guest", "", "{}"));
            let headers = format!("Authorization: Bearer {}\r\n", session["session"]["token"].as_str().unwrap());
            let mut payload = json!({"args":{"id":"queued"}});
            if has_id { payload["id"] = json!("queued-request"); }
            if replay { assert_eq!(body(&host.request("POST", "/m/add", &headers, &payload.to_string()))["state"], "sent"); }
            let gate = Arc::new(WorkGate::default());
            let release_on_panic = ReleaseGate(gate.clone());
            let hook = gate.clone();
            let visits = AtomicUsize::new(0);
            *lock(&host.shared.mutation_wait) = Some(Arc::new(move || {
                if visits.fetch_add(1, Ordering::AcqRel) + 1 == lock_number { hook.park(); }
            }));
            let op = if ephemeral { "typeNow" } else { "add" };
            let address = host.address;
            let request = thread::spawn(move || {
                let payload = payload.to_string();
                exchange_held(address, 2 * WAIT_TIMEOUT, &format!("POST /m/{op} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}Content-Length: {}\r\n\r\n{payload}",payload.len()))
            });
            wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
            // principal_of succeeded. Lock 2 follows durable replay or the
            // ephemeral memory checkout; expire authority in that exact gap.
            // Take the writer in that exact gap, let the request queue, then
            // adopt and expire/revoke its previously authenticated bearer.
            let mut engine = lock(&host.shared.engine);
            gate.release();
            wait_until(|| host.shared.engine.waiting() == 1);
            let candidate = snapback4_lang::compile(&[("schema.q".into(),format!("{}{}",source,reads::VIEWS))]);
            let seq = engine.seq().unwrap();
            engine.adopt(candidate.schema, candidate.programs.into_iter().map(|p|p.program)).unwrap();
            lock(&host.shared.readers).replace(&engine, &candidate.refusal_sites);
            let after_adoption = engine.seq().unwrap();
            assert!(after_adoption >= seq);
            engine.store().conn().execute(if revoke {"DELETE FROM _sessions"} else {"UPDATE _sessions SET expires_at = 0"}, []).unwrap();
            let ephemeral_before = host.shared.ephemeral.snapshot().unwrap().version;
            drop(engine);
            let reply = request.join().unwrap();
            if ephemeral {
                assert_eq!(body(&reply)["state"], "failed", "{reply}");
                assert_eq!(body(&reply)["why"]["code"], "E_AUTH", "{reply}");
            } else {
                assert_eq!(status(&reply), 401, "replay={replay} id={has_id} lock={lock_number} revoke={revoke}: {reply}");
                assert_eq!(body(&reply)["denied"]["code"], "E_AUTH");
            }
            assert_eq!(host.shared.ephemeral.snapshot().unwrap().version, ephemeral_before, "no ephemeral write");
            let engine = lock(&host.shared.engine);
            assert_eq!(engine.seq().unwrap(), after_adoption, "no new commit");
            assert_eq!(engine.store().rows("items").unwrap().len(), usize::from(replay));
            drop(release_on_panic);
        }
    }
}
