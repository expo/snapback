use super::*;

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
        lock(&host.shared.readers).invalidate();
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

mod worker;
