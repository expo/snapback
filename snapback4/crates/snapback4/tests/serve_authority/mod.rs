//! RT3b: exercise authority changes at the actual HTTP upload/queue boundaries.
use super::*;
use snapback4_core::identity;

const SOURCE: &str = "use identity\ntable counters:\n  n: int\n  public\n  insert <- allow\n  update <- allow\ntable typing:\n  owner: principal\n  unique owner\n  public\n  insert <- allow\n  update <- allow\n  ephemeral 4s\nmutation change(n: int):\n  update counters[\"c\"] { n: (counters[\"c\"].n ?? 0) + n }\n  return n\nmutation other(n: int):\n  return n\nquery count():\n  return counters[\"c\"].n\n";

struct Fixture { host: Host, _directory: ReaderTestDirectory }
impl Fixture {
    fn new(pg: bool) -> Self {
        let directory = ReaderTestDirectory::new();
        let store = if pg {
            #[cfg(feature = "postgres")]
            { snapback4_core::store_port::AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private cluster"), &format!("sb4_rt3b_{:x}", snapback4_core::ids::seed())).unwrap() }
            #[cfg(not(feature = "postgres"))]
            { unreachable!() }
        } else { snapback4_core::store_port::AnyStore::open(&directory.0.join("authority.sqlite")).unwrap() };
        let host = Host::with_store(false, store, SOURCE);
        lock(&host.shared.engine).seed([("counters".into(), snapback4_core::wire::row_from_json(&lock(&host.shared.bound).schema.tables["counters"], &json!({"id":"c","n":0})).unwrap())]).unwrap();
        Self { host, _directory: directory }
    }
    fn session(&self, supervised: bool) -> identity::Session {
        let engine = lock(&self.host.shared.engine);
        if supervised { identity::mint_supervised_child(engine.store(), Some("rt3b"), self.host.shared.now(), self.host.shared.worker_revision.load(Ordering::Acquire)).unwrap() }
        else { identity::open_session(engine.store(), "guest:rt3b", "guest", self.host.shared.now()).unwrap() }
    }
    fn payload(&self, id: &str) -> Json {
        json!({"id":id,"store_id":lock(&self.host.shared.wake).store_id,"args":{"n":1}})
    }
    fn call(&self, session: &identity::Session, payload: &Json) -> Json {
        body(&self.host.request("POST", "/m/change", &headers(session), &payload.to_string()))
    }
    fn count(&self) -> i64 { lock(&self.host.shared.engine).store().rows("counters").unwrap()[0].field("n").unwrap().as_int().unwrap() }
}
fn headers(session: &identity::Session) -> String { format!("Authorization: Bearer {}\r\n", session.token) }
fn wire(path: &str, session: &identity::Session, payload: &Json) -> String {
    let payload = payload.to_string();
    format!("POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Length: {}\r\n\r\n{payload}", headers(session), payload.len())
}
fn park(host: &Host, visit: usize) -> (Arc<WorkGate>, ReleaseGate) {
    let gate = Arc::new(WorkGate::default()); let hook = gate.clone();
    let visits = AtomicUsize::new(0);
    *lock(&host.shared.mutation_wait) = Some(Arc::new(move || { if visits.fetch_add(1, Ordering::AcqRel) + 1 == visit { hook.park(); } }));
    (gate.clone(), ReleaseGate(gate))
}
fn refused(reply: &str, code: &str) {
    let value = body(reply);
    assert_eq!(value.get("denied").or_else(|| value.get("why")).unwrap()["code"], code, "{reply}");
}
fn no_store_metadata(reply: &str) {
    let value=body(reply);
    for field in ["store_id","head","generation","data"] { assert!(value.get(field).is_none(),"{reply}"); }
    assert!(!reply.to_ascii_lowercase().contains("x-snapback-generation:"),"{reply}");
}

#[test]
fn rt3b_authority_boundaries_sqlite() { boundaries(false); }
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn rt3b_authority_boundaries_postgres() { boundaries(true); }

fn boundaries(pg: bool) {
    // An ingress storage error has no authenticated store cut, including when
    // a stored receipt exists. Neither route may stamp cached generation data.
    for replay in [false, true] {
        let f = Fixture::new(pg); let session = f.session(false); let payload = f.payload("broken-ingress");
        if replay { assert_eq!(f.call(&session, &payload)["state"], "sent"); }
        lock(&f.host.shared.engine).store_mut().test_request_read_scope(&session.token, true).unwrap();
        for (path, input) in [("/q/count", json!({})), ("/m/change", payload.clone())] {
            let reply = f.host.request("POST", path, &headers(&session), &input.to_string());
            assert_eq!(status(&reply), 503, "{reply}");
            no_store_metadata(&reply);
        }
        assert_eq!(f.count(), i64::from(replay));
    }
    // Both first attempts and stored replays lose authority during a partial
    // upload. The hook only signals: serve is blocked reading the missing bytes.
    for replay in [false, true] {
        let f = Fixture::new(pg); let session = f.session(false); let mut payload = f.payload("upload");
        payload["padding"] = json!("x".repeat(2048));
        if replay { assert_eq!(f.call(&session, &payload)["state"], "sent"); }
        let (sent, received) = mpsc::channel();
        *lock(&f.host.shared.operation_ingress) = Some(Arc::new(move || { sent.send(()).unwrap(); }));
        let mut stream = TcpStream::connect(f.host.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let request = wire("/m/change", &session, &payload); let split = request.len()-2;
        stream.write_all(&request.as_bytes()[..split]).unwrap();
        received.recv_timeout(Duration::from_secs(5)).unwrap();
        identity::close_session(lock(&f.host.shared.engine).store(), &session.token).unwrap();
        stream.write_all(&request.as_bytes()[split..]).unwrap();
        let mut reply = String::new(); stream.read_to_string(&mut reply).unwrap();
        refused(&reply, "E_AUTH"); assert_eq!(status(&reply),401); assert!(body(&reply).get("store_id").is_none());
        assert_eq!(f.count(), i64::from(replay));
    }
    // A replay waits before its reader preflight; a miss waits on the actual
    // committer queue. Neither holds an authority snapshot across that wait.
    for mode in ["keyed", "unkeyed", "replay", "duplicate"] { for change in ["revoke", "expiry", "supervisor", "store", "scope"] {
        // A stored preflight replay makes no delivery decision using ingress
        // scope. Misses must reject a changed scope at the execution boundary.
        if mode == "replay" && change == "scope" { continue; }
        let replay = mode == "replay";
        let f=Fixture::new(pg); let session=f.session(change=="supervisor"); let mut payload=f.payload("queue");
        if mode == "unkeyed" { payload.as_object_mut().unwrap().remove("id"); }
        if replay { assert_eq!(f.call(&session,&payload)["state"],"sent"); }
        let (gate,_release)=park(&f.host,if replay {1} else {2});
        let address=f.host.address; let request=wire("/m/change",&session,&payload);
        let task=thread::spawn(move || exchange_held(address,2*WAIT_TIMEOUT,request));
        wait_until(||gate.entered.load(Ordering::Acquire)==1);
        let mut engine=lock(&f.host.shared.engine);
        if !replay { gate.release(); wait_until(|| f.host.shared.engine.waiting()==1); }
        if mode == "duplicate" {
            let context = Context::new(&session.principal, BTreeMap::from([("n".into(), snapback4_core::Value::Int(1))])).with_wire_args(payload["args"].clone());
            let outcome = engine.mutate("change", Some("queue"), context).unwrap();
            assert!(matches!(outcome.state, snapback4_core::WriteState::Sent { .. }));
        }
        match change {
            "revoke" => identity::close_session(engine.store(),&session.token).unwrap(),
            "expiry" => { let mut clock=crate::dev_clock::Clock::new(true,0).unwrap(); clock.freeze(session.expires_at); *lock(&f.host.shared.clock)=clock; }
            "supervisor" => {
                let revision=f.host.shared.worker_revision.fetch_add(1,Ordering::AcqRel)+1;
                let replacement=identity::mint_supervised_child(engine.store(),Some("rt3b"),f.host.shared.now(),revision).unwrap();
                assert_ne!(replacement.token,session.token,"a new supervised family was minted");
            },
            "store" => engine.store_mut().test_request_store_id("replacement").unwrap(),
            "scope" => engine.store_mut().test_request_read_scope(&session.token, false).unwrap(),
            _ => unreachable!(),
        }
        drop(engine); if replay { gate.release(); }
        let reply=task.join().unwrap();
        refused(&reply,if change=="store" {"E_STORE_REPLACED"} else {"E_AUTH"});
        if change!="store" {
            assert_eq!(status(&reply), if change == "scope" {503} else {401}, "{reply}");
            no_store_metadata(&reply);
            if change == "scope" { assert_eq!(body(&reply)["denied"]["retryable"], true, "{reply}"); }
        }
        assert_eq!(f.count(),i64::from(replay || mode == "duplicate"),"mode={mode} change={change}");
    } }
    for expiry in [false,true] {
        let f=Fixture::new(pg);let session=f.session(false);
        let gate=Arc::new(WorkGate::default());let _release=ReleaseGate(gate.clone());let hook=gate.clone();
        *lock(&f.host.shared.query_wait)=Some(Arc::new(move||hook.park()));
        let address=f.host.address;let request=wire("/q/count",&session,&json!({}));
        let task=thread::spawn(move||exchange_held(address,2*WAIT_TIMEOUT,request));
        wait_until(||gate.entered.load(Ordering::Acquire)==1);
        if expiry { let mut clock=crate::dev_clock::Clock::new(true,0).unwrap();clock.freeze(session.expires_at);*lock(&f.host.shared.clock)=clock; }
        else { identity::close_session(lock(&f.host.shared.engine).store(),&session.token).unwrap(); }
        gate.release();let reply=task.join().unwrap();refused(&reply,"E_AUTH");assert_eq!(status(&reply),401,"{reply}");
        assert!(body(&reply).get("store_id").is_none());assert!(body(&reply).get("data").is_none());
    }
    // A scope change while a query waits must not retain the manifest selected
    // using the earlier full scope, even when the principal remains the same.
    for duplicate in [false, true] {
    let f=Fixture::new(pg); let session=f.session(false);
    let gate=Arc::new(WorkGate::default());let _release=ReleaseGate(gate.clone());let hook=gate.clone();
    *lock(&f.host.shared.query_wait)=Some(Arc::new(move||hook.park()));
    let address=f.host.address;let request=wire("/q/count",&session,&json!({}));
    let task=thread::spawn(move||exchange_held(address,2*WAIT_TIMEOUT,request));
    wait_until(||gate.entered.load(Ordering::Acquire)==1);
    lock(&f.host.shared.engine).store_mut().test_request_read_scope(&session.token, duplicate).unwrap();
    gate.release();let reply=task.join().unwrap();
    assert_eq!(status(&reply),503,"{reply}");
    if !duplicate { refused(&reply,"E_AUTH"); assert_eq!(body(&reply)["denied"]["retryable"],true); }
    assert!(body(&reply).get("store_id").is_none());assert!(body(&reply).get("head").is_none());
    assert!(body(&reply).get("generation").is_none());assert!(body(&reply).get("data").is_none());
    }
    // A broken authority read is not an authenticated metadata observation,
    // even when a receipt exists or an in-memory judgment would refuse.
    for (replay, refusal) in [(false,false),(true,false),(false,true)] {
        let f=Fixture::new(pg);let session=f.session(false);let mut payload=f.payload("broken-authority");
        if replay { assert_eq!(f.call(&session,&payload)["state"],"sent"); }
        if refusal { payload.as_object_mut().unwrap().remove("id");payload["args"]["n"]=json!("bad-type"); }
        let (gate,_release)=park(&f.host,1);let address=f.host.address;let request=wire("/m/change",&session,&payload);
        let task=thread::spawn(move||exchange_held(address,2*WAIT_TIMEOUT,request));
        wait_until(||gate.entered.load(Ordering::Acquire)==1);
        lock(&f.host.shared.engine).store_mut().test_request_read_scope(&session.token,true).unwrap();
        gate.release();let reply=task.join().unwrap();assert_eq!(status(&reply),503,"{reply}");
        no_store_metadata(&reply);
        assert_eq!(f.count(),i64::from(replay));
    }
}

#[test]
fn rt3b_replay_and_concurrent_copies_sqlite() { replay_and_copies(false); }
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn rt3b_replay_and_concurrent_copies_postgres() { replay_and_copies(true); }

fn replay_and_copies(pg: bool) {
    let f=Fixture::new(pg);let session=f.session(false);let payload=f.payload("bound");
    let first=f.call(&session,&payload);assert_eq!(first["state"],"sent","{first}");
    let mut wrong=payload.clone();wrong["store_id"]=json!("wrong");
    assert_eq!(f.call(&session,&wrong)["why"]["code"],"E_STORE_REPLACED");
    let mut changed=payload.clone();changed["args"]["n"]=json!(2);
    assert_eq!(f.call(&session,&changed)["why"]["code"],"E_ID_REUSED");
    let reused=body(&f.host.request("POST","/m/other",&headers(&session),&payload.to_string()));
    assert_eq!(reused["why"]["code"],"E_ID_REUSED");
    // Both copies miss preflight before either may reach the writer. The later
    // serial receipt command returns the first copy's stored outcome.
    let payload=f.payload("copies");
    let gate=Arc::new(WorkGate::default());let _release=ReleaseGate(gate.clone());let hook=gate.clone();
    let visits=AtomicUsize::new(0);
    *lock(&f.host.shared.mutation_wait)=Some(Arc::new(move|| { let n=visits.fetch_add(1,Ordering::AcqRel); if n==1||n==3 {hook.park();} }));
    let mut tasks=Vec::new();
    for expected in [1,2] {
        let address=f.host.address;let request=wire("/m/change",&session,&payload);
        tasks.push(thread::spawn(move||exchange_held(address,2*WAIT_TIMEOUT,request)));
        wait_until(||gate.entered.load(Ordering::Acquire)==expected);
    }
    gate.release();let replies:Vec<_>=tasks.into_iter().map(|t|body(&t.join().unwrap())).collect();
    assert!(replies.iter().all(|r|r["state"]=="sent"),"{replies:?}");
    assert_eq!(replies.iter().filter(|r|r["replayed"]==true).count(),1,"{replies:?}");
    assert_eq!(replies[0]["seq"],replies[1]["seq"]);assert_eq!(f.count(),2);
    *lock(&f.host.shared.mutation_wait)=None;
    #[cfg(feature = "postgres")]
    if pg {
        // Exercise a real durable owner-fence refusal after a preflight miss,
        // independently of the queue's earlier ownership-admission guard.
        lock(&f.host.shared.engine).store_mut().test_request_owner_loss().unwrap();
        lock(&f.host.shared.readers).idle.clear();
        assert_eq!(f.call(&session,&payload)["replayed"],true);
        let fresh=f.payload("durable-owner-loss");
        let reply=f.host.request("POST","/m/change",&headers(&session),&fresh.to_string());
        refused(&reply,"E_STORE_OWNERSHIP");assert_eq!(status(&reply),503,"{reply}");
        assert_eq!(body(&reply)["denied"]["retryable"],true);
        no_store_metadata(&reply);
        assert!(lock(&f.host.shared.engine).store().applied_outcome(&session.principal,"durable-owner-loss").unwrap().is_none());
    }
    // Losing queue ownership still leaves the unfenced replay path available.
    f.host.shared.engine.test_ownership_loss();
    lock(&f.host.shared.readers).idle.clear();
    assert_eq!(f.call(&session,&payload)["replayed"],true);
    let fresh=f.payload("after-loss");let reply=f.host.request("POST","/m/change",&headers(&session),&fresh.to_string());
    refused(&reply,"E_STORE_OWNERSHIP");assert_eq!(status(&reply),503,"{reply}");assert_eq!(body(&reply)["denied"]["retryable"],true);
    no_store_metadata(&reply);
    assert_eq!(f.count(),2);
}

#[test]
fn rt3b_historical_replay_sqlite() { historical(false); }
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn rt3b_historical_replay_postgres() { historical(true); }

fn historical(pg: bool) {
    for change in ["rename","narrow","ephemeral"] {
        let f=Fixture::new(pg);let session=f.session(false);let payload=f.payload("historical");
        let first=f.call(&session,&payload);assert_eq!(first["state"],"sent");
        let source=match change {
            "rename"=>SOURCE.replace("mutation change", "mutation renamed"),
            "narrow"=>SOURCE.replace("change(n: int)","change(n: text)" ).replace("n: (counters[\"c\"].n ?? 0) + n", "n: (counters[\"c\"].n ?? 0) + 1"),
            _=>SOURCE.replace("update counters[\"c\"] { n: (counters[\"c\"].n ?? 0) + n }", "upsert typing[owner = viewer] {}"),
        };
        let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        { let mut engine=lock(&f.host.shared.engine); let generation=engine.adopt(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();lock(&f.host.shared.readers).replace(&engine,&bound.refusal_sites);*lock(&f.host.shared.bound)=bound;*lock(&f.host.shared.generation)=generation;f.host.shared.publish_engine(&engine); }
        let mut retry=payload.clone();retry["delivery"]=json!({});
        let replay=f.call(&session,&retry);assert_eq!(replay["replayed"],true,"{change}: {replay}");assert_eq!(replay["seq"],first["seq"]);assert_eq!(f.count(),1);
        if change == "ephemeral" {
            let (gate,_release)=park(&f.host,1);let address=f.host.address;let request=wire("/m/change",&session,&payload);
            let task=thread::spawn(move||exchange_held(address,2*WAIT_TIMEOUT,request));
            wait_until(||gate.entered.load(Ordering::Acquire)==1);
            identity::close_session(lock(&f.host.shared.engine).store(),&session.token).unwrap();
            gate.release();let reply=task.join().unwrap();refused(&reply,"E_AUTH");assert_eq!(status(&reply),401,"{reply}");
            assert!(body(&reply).get("store_id").is_none());assert_eq!(f.count(),1);
        }
    }
}

#[test]
fn rt3b_metadata_refusal_uses_its_snapshot_program_sqlite() { refusal_generation(false); }
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn rt3b_metadata_refusal_uses_its_snapshot_program_postgres() { refusal_generation(true); }

fn refusal_generation(pg: bool) {
    for replay in [false, true] {
    let f=Fixture::new(pg);let session=f.session(false);
    let payload=if replay {f.payload("adopted-replay")} else {json!({"args":{"n":"new-type"}})};
    if replay { assert_eq!(f.call(&session,&payload)["state"],"sent"); }
    let gate=Arc::new(WorkGate::default());let _release=ReleaseGate(gate.clone());let hook=gate.clone();
    let visits=AtomicUsize::new(0);
    *lock(&f.host.shared.reader_open)=Some(Arc::new(move|| {
        if visits.fetch_add(1,Ordering::AcqRel)==1 { hook.park(); }
    }));
    // Ingress checks the predecessor. Its decoder refuses this argument, then
    // the refusal's reader checkout waits while that argument becomes valid.
    let address=f.host.address;let request=wire("/m/change",&session,&payload);
    let task=thread::spawn(move||exchange_held(address,2*WAIT_TIMEOUT,request));
    wait_until(||gate.entered.load(Ordering::Acquire)==1);
    let source=SOURCE.replace("change(n: int)","change(n: text)")
        .replace("(counters[\"c\"].n ?? 0) + n","(counters[\"c\"].n ?? 0) + 1");
    let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let generation={
        let mut engine=lock(&f.host.shared.engine);
        let generation=engine.adopt(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
        lock(&f.host.shared.readers).replace(&engine,&bound.refusal_sites);*lock(&f.host.shared.bound)=bound;
        *lock(&f.host.shared.generation)=generation;f.host.shared.publish_engine(&engine);generation
    };
    gate.release();let reply=body(&task.join().unwrap());
    assert_eq!(reply["state"],"sent","{reply}");assert_eq!(reply["generation"],generation);assert_eq!(f.count(),1);
    assert_eq!(reply["replayed"]==true,replay,"{reply}");
    }
}
