//! RT3b final round: presence effects and both previously raw response doors.
use super::*;
fn following_source() -> String {
    format!("use identity\n{}", include_str!("../../../snapback4-lang/tests/fixtures/following-view.q"))
}
struct Door { host: Host, directory: ReaderTestDirectory, namespace: String, source: String }
impl Door {
    fn new(pg: bool, source: String) -> Self {
        let directory = ReaderTestDirectory::new();
        let namespace = format!("sb4_rt3b_final_{:x}", snapback4_core::ids::seed());
        let store = if pg {
            #[cfg(feature = "postgres")]
            { snapback4_core::store_port::AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &namespace).unwrap() }
            #[cfg(not(feature = "postgres"))]
            { unreachable!() }
        } else { snapback4_core::store_port::AnyStore::open(&directory.0.join("door.sqlite")).unwrap() };
        Self { host: Host::with_store(false, store, &source), directory, namespace, source }
    }
    fn session(&self) -> identity::Session {
        identity::open_session(lock(&self.host.shared.engine).store(), "guest:round3", "guest", self.host.shared.now()).unwrap()
    }
    fn foreign(&self, pg: bool) {
        let store = if pg {
            #[cfg(feature = "postgres")]
            { snapback4_core::store_port::AnyStore::open_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &self.namespace).unwrap() }
            #[cfg(not(feature = "postgres"))]
            { unreachable!() }
        } else { snapback4_core::store_port::AnyStore::open(&self.directory.0.join("door.sqlite")).unwrap() };
        let mut engine = Engine::open_at(store, self.host.shared.now()).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{}\nquery nextGeneration():\n  return 1\n", self.source))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        engine.adopt(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    }
}
fn change(engine: &mut Engine, session: &identity::Session, kind: bool) {
    if kind { engine.store_mut().test_request_kind(&session.token, "account").unwrap(); }
    else { engine.store_mut().test_request_read_scope(&session.token, false).unwrap(); }
}
fn presence(pg: bool, kind: bool) {
    let f = Fixture::new(pg); let session = f.session(false);
    let gate = Arc::new(WorkGate::default()); let _release = ReleaseGate(gate.clone()); let hook = gate.clone();
    *lock(&f.host.shared.query_wait) = Some(Arc::new(move || hook.park()));
    let address = f.host.address;
    let request = format!("GET /changes?since=0&wait=0 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}\r\n", headers(&session));
    let task = thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request));
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    let mut engine = lock(&f.host.shared.engine); gate.release();
    wait_until(|| f.host.shared.engine.waiting() == 1);
    change(&mut engine, &session, kind); drop(engine);
    let reply = task.join().unwrap();
    assert_eq!(f.host.shared.presence.connections(&session.principal), 0, "stale presence published: {reply}");
    assert!(!lock(&f.host.shared.presence.polls).contains_key(&session.principal), "neither enter nor leave may run");
    refused(&reply, "E_AUTH"); assert_eq!(status(&reply), 503, "{reply}"); assert_eq!(body(&reply)["denied"]["retryable"], true);
    no_store_metadata(&reply);
}
fn following_fresh(pg: bool, kind: bool) {
    let f = Door::new(pg, following_source()); let session = f.session();
    let gate = Arc::new(WorkGate::default()); let _release = ReleaseGate(gate.clone()); let hook = gate.clone();
    *lock(&f.host.shared.query_wait) = Some(Arc::new(move || hook.park()));
    let address = f.host.address; let request = wire("/following/cards", &session, &json!({"action":"open","args":{"c":null}}));
    let task = thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request));
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    let mut engine = lock(&f.host.shared.engine); gate.release();
    wait_until(|| f.host.shared.engine.waiting() == 1);
    change(&mut engine, &session, kind); drop(engine);
    let reply = task.join().unwrap(); refused(&reply, "E_AUTH"); assert_eq!(status(&reply), 503, "{reply}");
    assert_eq!(body(&reply)["denied"]["retryable"], true); no_store_metadata(&reply);
    assert!(body(&reply).get("opening").is_none());
}
fn following_generation(pg: bool, action: &str) {
    let f = Door::new(pg, following_source()); let session = f.session();
    let opening = body(&f.host.request("POST", "/following/cards", &headers(&session), r#"{"action":"open","args":{"c":null}}"#))["opening"].clone();
    assert!(opening.is_string());
    let gate = Arc::new(WorkGate::default()); let _release = ReleaseGate(gate.clone()); let hook = gate.clone();
    *lock(&f.host.shared.changes_refresh) = Some(Arc::new(move || hook.park()));
    let address = f.host.address; let request = wire("/following/cards", &session, &json!({"action":action,"opening":opening,"args":{"c":null},"mounted":[],"seen":[]}));
    let task = thread::spawn(move || exchange_held(address, 2*WAIT_TIMEOUT, request));
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    f.foreign(pg); gate.release();
    generation::generation_reply(&task.join().unwrap());
}
fn ingress(pg: bool) {
    let f = Fixture::new(pg);
    *lock(&f.host.shared.dev_reset_store) = Some("cached-private-store".into());
    lock(&f.host.shared.wake).store_id = Some("replacement".into());
    for path in ["/q/count", "/m/change"] {
        let reply = f.host.request("POST", path, "Authorization: Bearer unknown\r\n", "{}");
        refused(&reply, "E_STORE_REPLACED"); no_store_metadata(&reply);
        assert!(!reply.to_ascii_lowercase().contains("x-snapback-dev-reset:"), "{reply}");
        assert!(!reply.contains("cached-private-store")); assert_eq!(status(&reply), 409);
    }
}
fn streamed(pg: bool, revoked: bool) {
    use std::io::Read;
    let f = Door::new(pg, "use identity\nquery count():\n  return 1\n".into()); let session = f.session();
    let gate = Arc::new(WorkGate::default()); let _release = ReleaseGate(gate.clone()); let hook = gate.clone();
    *lock(&f.host.shared.poll_wait) = Some(Arc::new(move || hook.park()));
    let mut stream = TcpStream::connect(f.host.address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    stream.write_all(format!("GET /changes?since=0&wait=1&heartbeat=1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}\r\n", headers(&session)).as_bytes()).unwrap();
    let mut reply = String::new(); let mut byte = [0];
    while !reply.ends_with("1\r\n\n\r\n") { stream.read_exact(&mut byte).unwrap(); reply.push(char::from(byte[0])); }
    assert_eq!(status(&reply), 200);
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    if revoked { identity::close_session(lock(&f.host.shared.engine).store(), &session.token).unwrap(); }
    else { f.foreign(pg); }
    gate.release();
    if !revoked {
        // SQLite deliberately resolves poll credentials independently of catalog
        // generation. A commit wake forces the held poll's next source snapshot.
        lock(&f.host.shared.wake).seq += 1;
        f.host.shared.polls.notify_all();
    }
    stream.read_to_string(&mut reply).unwrap();
    let mut rest = reply.split_once("\r\n\r\n").unwrap().1; let mut payload = String::new();
    loop {
        let (size, tail) = rest.split_once("\r\n").unwrap(); let size = usize::from_str_radix(size, 16).unwrap();
        if size == 0 { break; }
        payload.push_str(&tail[..size]); rest = &tail[size+2..];
    }
    let json: Json = serde_json::from_str(&payload).unwrap();
    assert_eq!(json["denied"]["code"], if revoked {"E_AUTH"} else {"E_GENERATION"}, "{reply}");
    assert_eq!(json["denied"]["retryable"].as_bool().unwrap_or(false), !revoked, "{reply}");
    for name in ["store_id", "head", "seq", "generation", "tables", "ephemeral"] { assert!(json.get(name).is_none(), "{reply}"); }
    if !revoked { assert_eq!(json["denied"]["retryAfterMs"], 1000, "{reply}"); }
}
macro_rules! witness {
    ($s:ident, $p:ident, $run:expr) => {
        #[test] fn $s() { ($run)(false); }
        #[cfg(feature = "postgres")] #[test] #[ignore = "requires private Postgres; scripts/test-postgres.sh"]
        fn $p() { ($run)(true); }
    };
}
witness!(rt3b_final_presence_scope_sqlite, rt3b_final_presence_scope_postgres, |pg| presence(pg, false));
witness!(rt3b_final_presence_kind_sqlite, rt3b_final_presence_kind_postgres, |pg| presence(pg, true));
witness!(rt3b_final_following_scope_sqlite, rt3b_final_following_scope_postgres, |pg| following_fresh(pg, false));
witness!(rt3b_final_following_kind_sqlite, rt3b_final_following_kind_postgres, |pg| following_fresh(pg, true));
witness!(rt3b_final_following_unit_sqlite, rt3b_final_following_unit_postgres, |pg| following_generation(pg, "unit"));
witness!(rt3b_final_ingress_header_sqlite, rt3b_final_ingress_header_postgres, ingress);
witness!(rt3b_final_stream_generation_sqlite, rt3b_final_stream_generation_postgres, |pg| streamed(pg, false));
witness!(rt3b_final_stream_revoked_sqlite, rt3b_final_stream_revoked_postgres, |pg| streamed(pg, true));

fn exposed(pg: bool) {
    let f = Door::new(pg, SOURCE.into()); let session = f.session();
    f.foreign(pg);
    let reply = f.host.request("POST", "/q/count", &headers(&session), "{}");
    generation::generation_reply(&reply);
    let expose: Vec<_> = reply.lines().filter(|s| s.to_ascii_lowercase().starts_with("access-control-expose-headers:")).collect();
    assert_eq!(expose.len(), 1, "{reply}");
    for name in ["Retry-After", "X-Snapback-Settlement", "X-Snapback-Generation", "X-Snapback-Time", "X-Snapback-Ephemeral"] { assert!(expose[0].contains(name), "{reply}"); }
}
fn fallback(pg: bool) {
    // Exercise the actual HTTP boundary's normalizer beside a real store door.
    let _f = Fixture::new(pg);
    for body in [Json::Null, json!({"why":false}), json!({"code":"E_GENERATION"})] {
        let normalized = operation_request::generation_reply(body);
        assert_eq!(normalized["denied"]["code"], "E_GENERATION");
        assert_eq!(normalized["denied"]["retryable"], true);
    }
}
witness!(rt3b_final_expose_sqlite, rt3b_final_expose_postgres, exposed);
witness!(rt3b_final_fallback_sqlite, rt3b_final_fallback_postgres, fallback);
