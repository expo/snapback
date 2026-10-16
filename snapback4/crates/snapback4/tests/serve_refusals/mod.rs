use super::*;
use std::{fs, path::Path};

const SOURCE: &str = "use personas alice\ntable rows:\n  owner: principal\n  read <- exists grants[parent = .id]\n  online only\ntable grants:\n  parent: rows\n  until: time\n  expire at .until\n  unique byParent: parent\n  read <- deny\n  online only\nquery point(id: rows):\n  return rows[id]\n";
fn exhaust_read_authority(host: &Host) {
    let mut engine = lock(&host.shared.engine);
    let bound = lock(&host.shared.bound);
    let until = host.shared.now() + 3_600_000;
    let mut rows = vec![("rows".into(), snapback4_core::wire::row_from_json(
        &bound.schema.tables["rows"], &json!({"id":"hidden","owner":"bob"})).unwrap(),
    )];
    rows.extend((0..8193).map(|n| {
        ("grants".into(), snapback4_core::wire::row_from_json(
        &bound.schema.tables["grants"], &json!({"id":format!("g{n}"),"parent":"hidden","until":until+n})).unwrap(),
        )
    }));
    engine.load(rows).unwrap();
}
fn latest(project: &Path, op: &str) -> Json {
    let end = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(records) = dev_refusals::recent(&project.join(".snapback4"), None, None)
            && let Some(record) = records["records"].as_array().unwrap().last()
            && record["operation"] == op { return record.clone(); }
        assert!(Instant::now() < end, "no evidence for {op}");
        thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn memory_query_branch_collects_and_a_bare_response_cannot_reuse_a_previous_cause() {
    let dir = ReaderTestDirectory::new();
    let host = Host::with_evidence(true, snapback4_core::Store::memory().unwrap(), SOURCE, "127.0.0.1", Some(&dir.0));
    exhaust_read_authority(&host);
    let reply = body(&host.request("POST", "/q/point", "x-snapback-persona: alice\r\n", r#"{"args":{"id":"hidden"}}"#));
    assert_eq!(reply["denied"]["code"], "E_RULE");
    let first = latest(&dir.0, "point");
    assert_eq!(first["clause"], "authorization allowance (read)");
    assert_eq!(first["site"], "schema.q:4:3");
    // Deliberately bypass every operation and collector. Only the shared JSON
    // response layer sees this injected E_RULE, just like a new transport door.
    crate::host_limits::prepare_tests();
    let server = Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let caller = thread::spawn(move || {
        let mut socket = TcpStream::connect(address).unwrap();
        write!(socket, "POST /uninstrumented HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").unwrap();
        let mut reply = String::new(); socket.read_to_string(&mut reply).unwrap(); reply
    });
    let request = server.recv().unwrap();
    let _scope = dev_refusals::response::begin(&host.shared, "/uninstrumented");
    respond(request, 200, json!({"denied":{"code":"E_RULE","message":"injected"}}));
    assert_eq!(body(&caller.join().unwrap())["denied"]["code"], "E_RULE");
    let second = latest(&dir.0, "/uninstrumented");
    assert_eq!(second["clause"], "cause not instrumented");
    assert_eq!(second["code"], "E_RULE");
    assert_ne!(second["requestId"], first["requestId"]);
    assert!(second["site"].is_null());
}

#[test]
fn a_checked_out_reader_keeps_its_source_coordinates_across_publication() {
    let dir = ReaderTestDirectory::new();
    let store = snapback4_core::Store::open(&dir.0.join("reader.db")).unwrap();
    let host = Host::with_evidence(true, store, SOURCE, "127.0.0.1", Some(&dir.0));
    let (_epoch, reader) = host.shared.reader().unwrap();
    let old_generation = reader.generation();
    let next_source = format!("\n\n{SOURCE}\nquery extra():\n  return 1\n");
    let next = snapback4_lang::compile(&[("schema.q".into(), next_source)]);
    assert!(next.diagnostics.is_empty(), "{:?}", next.diagnostics);
    {
        let mut engine = lock(&host.shared.engine);
        engine.adopt(next.schema.clone(), next.programs.iter().map(|p|p.program.clone())).unwrap();
        lock(&host.shared.readers).replace(&engine, &next.refusal_sites);
        *lock(&host.shared.bound) = next;
    }
    assert_eq!(reader.refusal_sites[&("rows".into(), "read rule".into())], "schema.q:4:3");
    let (_, current) = host.shared.reader().unwrap();
    assert_ne!(current.generation(), old_generation);
    assert_eq!(current.refusal_sites[&("rows".into(), "read rule".into())], "schema.q:6:3");
    // Source selection does not consult the now newer shared.bound.
    assert_eq!(fs::read_dir(dir.0.join(".snapback4/dev-refusals")).unwrap().count(), 1);
}

#[test]
fn detached_query_uses_its_checkout_map_when_the_advertised_source_changes() {
    let dir = ReaderTestDirectory::new();
    let store = snapback4_core::Store::open(&dir.0.join("reader.db")).unwrap();
    let host = Host::with_evidence(true, store, SOURCE, "127.0.0.1", Some(&dir.0));
    exhaust_read_authority(&host);
    let generation = lock(&host.shared.engine).generation();
    let shared = Arc::downgrade(&host.shared);
    *lock(&host.shared.query_wait) = Some(Arc::new(move || {
        let shared = shared.upgrade().unwrap();
        if lock(&shared.query_wait).take().is_none() { return; }
        // Pause after checkout and simulate the source-map publication of a save.
        // The reader's schema/transaction remains the generation it checked out.
        *lock(&shared.bound) = snapback4_lang::compile(&[("schema.q".into(), format!("\n\n{SOURCE}"))]);
        *lock(&shared.generation) = generation + 1;
    }));
    let reply = body(&host.request("POST", "/q/point", "x-snapback-persona: alice\r\n", r#"{"args":{"id":"hidden"}}"#));
    assert_eq!(reply["denied"]["code"], "E_RULE");
    let record = latest(&dir.0, "point");
    assert_eq!(record["site"], "schema.q:4:3");
    assert_eq!(record["generation"], generation);
    assert_eq!(lock(&host.shared.bound).refusal_sites[&("rows".into(), "read rule".into())], "schema.q:6:3");
}

impl Host {
    pub(super) fn with_evidence(dev: bool, store: snapback4_core::Store, source: &str, bind: &str, evidence: Option<&std::path::Path>) -> Self {
        Self::with_recent(dev, store, source, bind, evidence, None)
    }
    fn with_recent(dev: bool, store: snapback4_core::Store, source: &str, bind: &str, evidence: Option<&std::path::Path>, recent: Option<dev_refusals::Recent>) -> Self {
        Self::with_capacity_recent(dev, store, source, bind, evidence, crate::host_limits::Capacity::default(), recent)
    }

    pub(super) fn with_capacity(dev: bool, store: snapback4_core::Store, source: &str, bind: &str, evidence: Option<&std::path::Path>, capacity: crate::host_limits::Capacity) -> Self {
        Self::with_capacity_recent(dev, store, source, bind, evidence, capacity, None)
    }
    fn with_capacity_recent(dev: bool, store: snapback4_core::Store, source: &str, bind: &str, evidence: Option<&std::path::Path>, capacity: crate::host_limits::Capacity, recent: Option<dev_refusals::Recent>) -> Self {
        crate::host_limits::prepare_tests();
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new(
            store,
            bound.schema.clone(),
            bound.programs.iter().map(|p| p.program.clone()),
        )
        .unwrap();
        let clock = Arc::new(Mutex::new(crate::dev_clock::Clock::new(dev, 0).unwrap()));
        let authoritative_now = if engine.schema().tables.values().any(|table| table.not_before.is_some()) {
            lock(&clock).now()
        } else { i64::MIN };
        let presence = Arc::new(Live::new(clock.clone()));
        engine.set_presence(Some(presence.clone()));
        let refusals = recent.unwrap_or_else(|| evidence.map(|project| dev_refusals::Recent::start(project,
            &engine.store().meta("store_id").unwrap().unwrap(), "127.0.0.1:0".parse().unwrap(), false, false).unwrap()).unwrap_or_default());
        let generation = engine.generation();
        let readers = Mutex::new(QueryReaders::new(&engine, &bound.refusal_sites));
        let shared = Arc::new(Shared {
        release_requests: Arc::new(crate::release_requests::Gate::default()),
        following: Mutex::new(snapback4_core::engine::following_history::Reader::new().unwrap()),
            project: std::env::current_dir().unwrap(), release_root: Mutex::new(None), temporary: true,
            latency: Arc::new(latency::Registry::new(&bound)),
            ephemeral: ephemeral::hub(&engine), ephemeral_rate: ephemeral::Rate::default(),
            wake: Mutex::new(ephemeral::Wake::new(&engine)), polls: Condvar::new(),
            adoption: Mutex::new(adoption::Status::new(String::new())),
            engine: super::engine_lock::FairMutex::new(engine),
            readers, read_cuts: Mutex::new(read_cost::ReadCuts::default()), refusals,
            bound: Mutex::new(bound),
            generation: Mutex::new(generation),
            worker_revision: AtomicUsize::new(0),
            committed: Condvar::new(),
            seq: Mutex::new(0),
            personas: dev,
            hold_effects: false,
            hold_schedules: false,
            time_audience_clock: AtomicI64::new(authoritative_now),
            clock, maintenance: FairMutex::gate(maintenance::State::default()),
            entropy: Mutex::new(snapback4_core::ids::Mint::default()),
            presence,
            long_waits: long_waits::LongWaits::new(&capacity), change_answers: Mutex::default(),
            asset_transfers: AssetTransfers::default(),
            native: Mutex::new(None),
            auth: crate::auth::Admission::default(),
            uploads: AtomicUsize::new(0),
            route_verification: routes::Verification::default(), owner: None,
            release_committed: Mutex::new(None),
        #[cfg(test)]
        worker_prepare: Mutex::new(None),
        #[cfg(test)]
        worker_minted: Mutex::new(None), auth_work: Mutex::new(None),
            request_work: Mutex::new(None), upload_work: Mutex::new(None),
            effect_wait: Mutex::new(None),
            poll_wait: Mutex::new(None), poll_resumed: Mutex::new(None), poll_notified: Mutex::new(None),
            query_wait: Mutex::new(None), reader_open: Mutex::new(None), changes_refresh: Mutex::new(None),
            mutation_wait: Mutex::new(None),
        });
        shared.install_ephemeral_wake();
        let server = Arc::new(
            Server::http_with_limits((bind, 0), tiny_http::ConnectionLimits { max_connections: capacity.connections(), ..Default::default() })
                .unwrap(),
        );
        let address = server.server_addr().to_ip().unwrap();
        let admission = Arc::new(RequestAdmission::new(&capacity));
        let (s, e, a) = (server.clone(), shared.clone(), admission.clone());
        let worker = thread::spawn(move || {
            for request in s.incoming_requests() {
                dispatch(request, e.clone(), a.clone(), address.ip().is_loopback());
            }
        });
        Self {
            server,
            shared,
            admission,
            worker: Some(worker),
            address,
        }
    }

}

#[test]
fn generation_footer_overflow_returns_a_complete_bounded_refusal() {
    let host = Host::new(true);
    let server = Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let caller = thread::spawn(move || {
        let mut socket = TcpStream::connect(address).unwrap();
        write!(socket, "GET /footer HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
        let mut reply = String::new(); socket.read_to_string(&mut reply).unwrap(); reply
    });
    let payload = json!({"data":"x".repeat((16 << 20) - 20)});
    assert!(serde_json::to_vec(&payload).unwrap().len() <= 16 << 20);
    respond_timed(server.recv().unwrap(), &host.shared, 200, payload);
    let reply = caller.join().unwrap();
    assert_eq!(status(&reply), 200);
    let json = body(&reply);
    assert_eq!(json["denied"]["code"], "E_BOUND");
    assert_eq!(json["generation"], 1);
    assert!(reply.len() < 4096, "overflow must replace the entire partial payload");
}


#[test]
fn stopping_admission_flushes_console_entries_that_cannot_expire() {
    struct Output(Arc<Mutex<Vec<u8>>>, mpsc::Sender<()>);
    impl Drop for Output { fn drop(&mut self) { let _ = self.1.send(()); } }
    impl std::io::Write for Output {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { lock(&self.0).extend_from_slice(bytes); Ok(bytes.len()) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    let dir = ReaderTestDirectory::new();
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let (ended, complete) = mpsc::channel();
    let now = Instant::now();
    let recent = dev_refusals::Recent::start_with_console(&dir.0, "store", "127.0.0.1:0".parse().unwrap(), false, true,
        move || now, Output(bytes.clone(), ended)).unwrap();
    let host = Host::with_recent(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\ntable rows:\n  owner: principal\n  insert <- deny\nmutation add():\n  return insert rows {owner: viewer}\n", "127.0.0.1", None, Some(recent));
    for n in 0..8 {
        assert_eq!(body(&host.request("POST", "/m/add", "x-snapback-persona: alice\r\n", &format!(r#"{{"id":"refused-{n}","args":{{}}}}"#)))["why"]["code"], "E_RULE");
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Ok(records) = dev_refusals::recent(&dir.0.join(".snapback4"), None, None)
            && records["records"].as_array().unwrap().len() == 8 { break; }
        assert!(Instant::now() < deadline, "evidence never reached the writer");
        thread::yield_now();
    }
    // Frozen time prevents any due-window flush. The shutdown acknowledgement
    // joins the final save/console handoff, even if the last save is observed early.
    assert!(lock(&bytes).is_empty(), "fixture must keep console output pending");
    let sender = host.shared.refusals.clone(); // Held polls retain sender clones too.
    serve_requests(host.server.clone(), host.shared.clone(), crate::dev_worker::Supervisor::idle_for_test(),
        vec![], || true, crate::host_limits::Capacity::default()).unwrap();
    // The foreground has a bounded shutdown wait. Under CPU contention it can
    // return before the writer releases its lock; sink drop joins actual cleanup.
    complete.recv_timeout(Duration::from_secs(60)).expect("refusal writer finished");
    let text = String::from_utf8(lock(&bytes).clone()).unwrap();
    assert_eq!(text.lines().count(), 1, "{text}");
    assert!(text.contains("count 8; window 1s;"), "{text}");
    assert!(dev_refusals::recent(&dir.0.join(".snapback4"), None, None).is_err());
    drop(sender);
}
