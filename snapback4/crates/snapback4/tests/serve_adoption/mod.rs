use super::*;

#[test]
fn atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes() {
    let directory = ReaderTestDirectory::new();
    let next = include_str!("../../../snapback4-lang/tests/fixtures/following-view.q");
    let before = next.replace("view feed: activity where .actor = viewer or exists follows[viewer, .actor]\n", "")
        .replace("return feed last", "return activity last")
        .replace("{ *, post: posts[.post] }", "{ * }");
    let host = Host::with_store(true, snapback4_core::Store::open(&directory.0.join("feed.sqlite")).unwrap(), &before);
    let headers = "x-snapback-persona: alice\r\n";
    assert_eq!(body(&host.request("POST", "/m/post", headers, r#"{"id":"01ARZ3NDEKTSV4RRFFQ69G5FA0","args":{"postId":"p","parentId":null}}"#))["state"], "sent");
    let old = *lock(&host.shared.generation);
    let (entered, waiting) = mpsc::channel(); let (resume, resumed) = mpsc::channel();
    {
        let engine = lock(&host.shared.engine);
        engine.store().conn().commit_hook(Some(move || {
            entered.send(()).unwrap(); resumed.recv_timeout(Duration::from_secs(10)).unwrap(); false
        })).unwrap();
    }
    let shared = host.shared.clone();
    let task = thread::spawn(move || {
        let b = snapback4_lang::compile(&[("schema.q".into(),next.into())]);
        let mut engine = lock(&shared.engine);
        let (generation, _) = adoption::adopt_candidate(&shared, &mut engine, &b, || panic!("unexpected reopen")).unwrap();
        engine.store().conn().commit_hook(None::<fn()->bool>).unwrap();
        lock(&shared.readers).replace(&engine);
        *lock(&shared.bound) = b; *lock(&shared.generation) = generation;
    });
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    let request = |path: &'static str, payload: String| {
        let address=host.address; let (sent,received)=mpsc::channel();
        let handle=thread::spawn(move || {
            let response=exchange(address,&format!("POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\nx-snapback-persona: alice\r\n\r\n{payload}",payload.len()));
            sent.send(response).unwrap();
        }); (received,handle)
    };
    let syncs: Vec<_> = (0..32).map(|_| request("/sync",format!(r#"{{"generation":{old},"from":0,"limit":100}}"#))).collect();
    wait_until(|| host.shared.engine.waiting() == 32);
    // All 32 syncs have reached the held writer, not merely the listener.
    // Query and discovery must still read the predecessor with filled slots uncommitted.
    let query = host.request("POST", "/q/home", headers, r#"{"args":{"c":null}}"#);
    assert!(!query.is_empty(), "32 waiting syncs exhausted query admission");
    assert_eq!(status(&query),200,"{query}"); assert!(!query.contains("$timeline:"));
    assert_eq!(body(&query)["data"].as_array().unwrap().len(),1);
    let schema = host.request("GET", "/schema", headers, "");
    assert_eq!(status(&schema), 200, "{schema}");
    assert_eq!(body(&schema)["generation"], old);
    assert!(!schema.contains("$timeline:"));
    assert_eq!(host.admission.syncs.load(Ordering::Acquire), 32);
    assert!(host.request("POST", "/sync", headers, "{}").is_empty(), "sync admission remains bounded");
    let (write, write_thread)=request("/m/post",r#"{"id":"01ARZ3NDEKTSV4RRFFQ69G5FA1","args":{"postId":"after","parentId":null}}"#.into());
    assert!(syncs.iter().all(|(sync, _)| sync.try_recv().is_err()));
    assert!(write.recv_timeout(Duration::from_millis(100)).is_err());
    resume.send(()).unwrap(); task.join().unwrap();
    for (sync, sync_thread) in syncs {
        let sync=sync.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(!sync.contains("$timeline:")); assert_eq!(body(&sync)["denied"]["code"],"E_SYNC_GENERATION");
        sync_thread.join().unwrap();
    }
    let write=write.recv_timeout(Duration::from_secs(3)).unwrap(); assert_eq!(body(&write)["state"],"sent","{write}");
    write_thread.join().unwrap();
    let retry=host.request("POST","/m/post",headers,r#"{"id":"01ARZ3NDEKTSV4RRFFQ69G5FA1","args":{"postId":"after","parentId":null}}"#);
    assert_eq!(body(&retry)["state"],"sent");
    assert_eq!(lock(&host.shared.engine).store().count("posts").unwrap(),2,"same-id retry crosses adoption once");
}

#[test]
fn atomic_feed_sync_authenticates_before_wait_and_rechecks_after_it() {
    for revoke in [false, true] {
        let directory = ReaderTestDirectory::new();
        let next = format!("use identity\n{}", include_str!("../../../snapback4-lang/tests/fixtures/following-view.q"));
        let before = next.replace("view feed: activity where .actor = viewer or exists follows[viewer, .actor]\n", "")
            .replace("return feed last", "return activity last");
        let host = Host::with_store(false, snapback4_core::Store::open(&directory.0.join("auth.sqlite")).unwrap(), &before);
        let engine = lock(&host.shared.engine);
        let session = snapback4_core::identity::service_session(engine.store(), "reader", host.shared.now(), 1).unwrap();
        let candidate = snapback4_lang::compile(&[("schema.q".into(), next)]);
        assert!(candidate.diagnostics.is_empty(), "{:?}", candidate.diagnostics);
        lock(&host.shared.readers).begin_adoption(&candidate);
        for headers in ["", "Authorization: Bearer invalid\r\n"] {
            let reply = host.request("POST", "/sync", headers, "{}");
            assert_eq!(status(&reply), 401, "authentication must finish before the held writer: {reply}");
            assert_eq!(body(&reply)["denied"]["code"], "E_AUTH");
            assert_eq!(host.shared.engine.waiting(), 0);
        }
        let address = host.address;
        let sync = thread::spawn(move || exchange(address, &format!("POST /sync HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer {}\r\nContent-Length: 2\r\n\r\n{{}}", session.token)));
        wait_until(|| host.shared.engine.waiting() == 1);
        engine.store().conn().execute(if revoke { "DELETE FROM _sessions" } else { "UPDATE _sessions SET expires_at = 0" }, []).unwrap();
        lock(&host.shared.readers).finish_adoption();
        drop(engine);
        let reply = sync.join().unwrap();
        assert_eq!(status(&reply), 401, "authority changed while waiting: {reply}");
        assert_eq!(body(&reply)["denied"]["code"], "E_AUTH");
    }
}

#[test]
fn a2_adoption_fences_supervised_claims_before_the_old_child_stops() {
    let schema = "use server\naction work() returns { n: int } <- allow\neffect mail\nmutation emitMail():\n  emit mail {n: 1}\n";
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), schema);
    let (old, manual) = {
        let engine = lock(&host.shared.engine);
        (crate::dev_worker::child_session(engine.store(), host.shared.now(), 0).unwrap(),
         snapback4_core::identity::service_session(engine.store(), "manual", host.shared.now(), 1).unwrap())
    };
    let old_headers = format!("Authorization: Bearer {}\r\n", old.token);
    assert_eq!(status(&host.request("POST", "/actions/claim", &old_headers, "{}")), 200);
    // Keep the old credential alive (as if its child ignores SIGTERM) while
    // activating and publishing the new revision under the claim's lock.
    {
        let mut engine = lock(&host.shared.engine);
        let bound = snapback4_lang::compile(&[("schema.q".into(), schema.replace("n: int }", "n: int, ok: bool ? }"))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let generation = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        *lock(&host.shared.bound) = bound;
        *lock(&host.shared.generation) = generation;
        host.shared.worker_revision.fetch_add(1, Ordering::Release);
        assert!(snapback4_core::identity::resolve(engine.store(), &old.token, host.shared.now()).unwrap().is_some());
    }
    let call = body(&host.request("POST", "/a/work?wait=0", "x-snapback-persona: alice\r\n", r#"{"id":"adoption-work","args":{}}"#));
    assert_eq!(call["state"], "pending", "{call}");
    let mutation = body(&host.request("POST", "/m/emitMail", "x-snapback-persona: alice\r\n", r#"{"id":"01ARZ3NDEKTSV4RRFFQ69G5FAV","args":{}}"#));
    assert_eq!(mutation["state"], "sent", "{mutation}");
    for path in ["/actions/claim", "/effects/claim"] {
        let refused = host.request("POST", path, &old_headers, "{}");
        assert_eq!(status(&refused), 401, "{path}: {refused}");
        assert_eq!(body(&refused)["denied"]["code"], "E_AUTH");
    }
    // Unsupervised seats are not accidentally fenced with the child, and
    // the new child may claim the untouched new admission exactly once.
    let manual_headers = format!("Authorization: Bearer {}\r\n", manual.token);
    assert_eq!(body(&host.request("POST", "/effects/claim", &manual_headers, "{}"))["effects"].as_array().unwrap().len(), 1);
    let current = {
        let engine = lock(&host.shared.engine);
        crate::dev_worker::clear_child_session(engine.store()).unwrap();
        crate::dev_worker::child_session(engine.store(), host.shared.now(), 1).unwrap()
    };
    let current_headers = format!("Authorization: Bearer {}\r\n", current.token);
    let claimed = body(&host.request("POST", "/actions/claim", &current_headers, "{}"));
    assert_eq!(claimed["requests"].as_array().unwrap().len(), 1, "{claimed}");
    assert_eq!(claimed["requests"][0]["attempt"], 1);
}

#[test]
fn w8r2_adoption_bounds_alternating_background_reasons() {
    let mut state = adoption::Status::new("store".into());
    let first = snapback4_core::RuntimeError::Store("expiry phase is locked".into());
    let second = snapback4_core::RuntimeError::Store("job phase is locked".into());
    state.refused(&first, 1);
    let mut lines = Vec::new();
    for _ in 0..80 {
        for (name, error) in [("the expiry sweep", &first), ("job", &second)] {
            if let Some(line) = state.background_failure(name, error) { lines.push(line); }
        }
    }
    assert_eq!(lines.len(), 2, "alternating reasons must share the per-code limit");
    assert!(lines[0].contains("expiry phase is locked"));
    assert!(lines[1].contains("job phase is locked"));
    assert_eq!(state.recovered().as_deref(), Some("snapback4 dev: adoption recovered; suppressed 158 repeated background failures"));
    assert!(state.recovered().is_none());
    println!("alternating adoption logs: ticks=80 failures=160 printed=2 suppressed=158");
}

#[test]
fn w8r2_adoption_rate_windows_are_per_code_and_do_not_slide_on_suppression() {
    let mut state = adoption::Status::new("store".into());
    let errors = [
        [snapback4_core::RuntimeError::Store("expiry phase".into()), snapback4_core::RuntimeError::Store("job phase".into())],
        [snapback4_core::RuntimeError::Generation("expiry owner".into()), snapback4_core::RuntimeError::Generation("job owner".into())],
    ];
    state.refused(&errors[0][0], 1);
    let start = Instant::now();
    let mut printed = 0;
    for tick in 0..120 {
        // The last suppressed tick is 1 ms before the next window opens.
        let elapsed = if tick % 60 == 59 { Duration::from_millis(tick * 1000 + 999) } else { Duration::from_secs(tick) };
        for pair in &errors {
            for error in pair {
                let line = state.background_failure_at("job", error, start + elapsed);
                assert_eq!(line.is_some(), tick % 60 == 0, "tick {tick}, {error}");
                printed += usize::from(line.is_some());
            }
        }
    }
    // An expired window alone does not make an identical reason worth printing.
    for pair in &errors {
        assert!(state.background_failure_at("job", &pair[1], start + Duration::from_secs(180)).is_none());
    }
    assert_eq!(printed, 8);
    assert_eq!(state.recovered().as_deref(), Some("snapback4 dev: adoption recovered; suppressed 474 repeated background failures"));
    println!("adoption rate windows: seconds=60 burst=2 codes=2 windows=2 failures=482 printed=8 suppressed=474");
}

#[test]
fn w8r1b_adoption_bounds_repeated_background_logs_and_resets_on_recovery() {
    let locked = snapback4_core::RuntimeError::Sql(rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY), Some("database is locked".into())));
    let stale = snapback4_core::RuntimeError::Generation("another owner adopted".into());
    for failure in [&locked, &stale] {
        let mut state = adoption::Status::new("store".into());
        state.refused(failure, 1);
        for episode in 0..2 {
            let mut lines = Vec::new();
            for _ in 0..80 {
                for name in ["the expiry sweep", "job"] {
                    if let Some(line) = state.background_failure(name, failure) { lines.push(line); }
                }
            }
            assert_eq!(lines.len(), 1, "episode {episode}: {lines:?}");
            assert!(lines[0].contains("adoption still pending"));
            // Unrelated failures remain visible during the pending adoption.
            let input = snapback4_core::RuntimeError::Input("bad input".into());
            assert!(state.background_failure("job", &input).unwrap().contains("bad input"));
            let error = snapback4_core::RuntimeError::Generation("ordinary failure after recovery".into());
            assert_eq!(state.recovered().as_deref(), Some("snapback4 dev: adoption recovered; suppressed 159 repeated background failures"));
            assert!(state.failure.is_none());
            assert!(state.background_failure("job", &error).unwrap().contains("ordinary failure after recovery"));
            if episode == 0 { state.refused(failure, 2); }
        }
    }
    println!("adoption logs: failure_kinds=2 episodes_each=2 ticks_each=80 failures_each=160 printed_each=1 suppressed_each=159");
}

#[test]
fn w8r1b_adoption_reports_different_background_reasons_and_failure_changes() {
    let mut state = adoption::Status::new("store".into());
    let stale = snapback4_core::RuntimeError::Generation("first owner".into());
    let newer = snapback4_core::RuntimeError::Generation("second owner".into());
    let store = snapback4_core::RuntimeError::Store("database is locked".into());
    state.refused(&store, 1);
    assert!(state.background_failure("job", &stale).is_some());
    assert!(state.background_failure("job", &newer).unwrap().contains("second owner"));
    assert!(state.background_failure("the expiry sweep", &store).is_some());
    assert!(state.background_failure("job", &newer).is_none());
    assert!(state.background_failure("the expiry sweep", &store).is_none());
    state.refused(&newer, 1);
    assert!(state.background_failure("job", &newer).unwrap().contains("adoption still pending: E_GENERATION: second owner"));
    assert!(state.recovered().is_none(), "the changed adoption already reported and reset the old count");
}

#[test]
fn w8r1b_adoption_recovery_retires_a_query_already_in_flight() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let (epoch, mut old) = {
        let engine = lock(&host.shared.engine);
        lock(&host.shared.readers).take(&engine).unwrap()
    };
    let (entered, waiting) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    let once = Arc::new(std::sync::atomic::AtomicBool::new(false));
    old.store().conn().authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
        // The activation reads precede seq(); pause with a real WAL snapshot pinned.
        if matches!(ctx.action, rusqlite::hooks::AuthAction::Read { table_name: "_commits", .. }) && !once.swap(true, Ordering::SeqCst) {
            entered.send(()).unwrap();
            resumed.recv_timeout(Duration::from_secs(10)).unwrap();
        }
        rusqlite::hooks::Authorization::Allow
    })).unwrap();
    let task = thread::spawn(move || {
        let outcome = old.query("version", Context::new("dev:alice", BTreeMap::new()));
        (old, outcome)
    });
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), READER_SCHEMA.replace("return 1", "return 2"))]);
    {
        let mut engine = lock(&host.shared.engine);
        let error = snapback4_core::RuntimeError::Generation("another owner adopted".into());
        lock(&host.shared.adoption).refused(&error, engine.generation());
        let next = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        lock(&host.shared.adoption).recovered();
        lock(&host.shared.readers).replace(&engine);
        *lock(&host.shared.bound) = bound;
        *lock(&host.shared.generation) = next;
    }
    resume.send(()).unwrap();
    let (old, outcome) = task.join().unwrap();
    assert_eq!(outcome.unwrap().data, snapback4_core::Value::Int(1));
    lock(&host.shared.readers).put(&epoch, old);
    assert!(lock(&host.shared.readers).idle.is_empty());
    assert_eq!(body(&host.request("POST", "/q/version", "x-snapback-persona: alice\r\n", "{}"))["data"], 2);
    println!("adoption recovery: in_flight_version=1 new_version=2 returned_old_readers=0");
}

mod reads;

mod saturation;

mod authority;

mod failure;

mod scale;

mod reader_failure;

mod worker;
