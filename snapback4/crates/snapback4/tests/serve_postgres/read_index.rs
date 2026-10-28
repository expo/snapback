//! Held real PG flights exercise the HTTP continuation, not a mocked worker.
use super::*;
const SOURCE: &str = "use identity\ntable notes:\n  n: int\n  public\n  insert <- allow\n  online only\nquery read(key: notes):\n  return notes[key]\n";
const ARGS: &str = r#"{"args":{"key":"one"}}"#;
struct Held { entered: AtomicUsize, open: Mutex<bool>, changed: Condvar }
impl Held {
    fn new()->Arc<Self> {Arc::new(Self {entered:AtomicUsize::new(0),open:Mutex::new(false),changed:Condvar::new()})}
    fn release(&self) {*lock(&self.open)=true;self.changed.notify_all();}
}
struct Release(Arc<Held>);
impl Drop for Release {fn drop(&mut self) {self.0.release();}}
fn until(mut condition: impl FnMut()->bool) {
    let end=Instant::now()+Duration::from_secs(10);
    while !condition() {assert!(Instant::now()<end,"held RI witness did not reach its barrier");thread::sleep(Duration::from_millis(1));}
}
fn fixture()->(Host,String,String) { fixture_mode(false,false) }
fn fixture_mode(g6:bool, fail_timer:bool)->(Host,String,String) {
    assert!(snapback4_core::store_port::g5_read_index_enabled(),"run this witness with RI armed");
    let connection=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let namespace=format!("g5r2_http_{:x}",snapback4_core::ids::seed());
    let bound=snapback4_lang::compile(&[("schema.q".into(),SOURCE.into())]);
    let mut bootstrap=Engine::new(snapback4_core::store_port::AnyStore::create_postgres(&connection,&namespace).unwrap(),bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    bootstrap.insert_fixture("notes",snapback4_core::Value::Row([("id".into(),snapback4_core::Value::Id("one".into())),("n".into(),snapback4_core::Value::Int(7))].into_iter().collect::<BTreeMap<_,_>>().into()),"test",0).unwrap();
    let id=bootstrap.store().store_identity().unwrap().unwrap();drop(bootstrap);
    let mut lease=snapback4_core::store_port::StoreLease::connect(&connection,&namespace,&id,"a001",Default::default()).unwrap();
    lease.acquire().unwrap().unwrap();
    if g6 { lease.enable_read_grant(snapback4_core::store_port::ReadClockBounds {rate_ppm:1000,forward_jump:Duration::from_millis(250)}).unwrap(); }
    let store=snapback4_core::store_port::AnyStore::open_postgres_owned(&connection,&namespace,&lease).unwrap();
    let host=Host::with_capacity_recent_writer(false,store,SOURCE,"127.0.0.1",None,crate::host_limits::Capacity::default(),None,false,
        |engine|committer::Writer::new(engine).unwrap().with_lease(lease,Duration::from_millis(50)).unwrap());
    host.admission.ri_fail_timer.store(fail_timer,Ordering::Relaxed);
    {let engine=lock(&host.shared.engine);lock(&host.shared.readers).prepare_population(&engine).unwrap();}
    let token=body(&host.request("POST","/auth/guest","","{}"))["session"]["token"].as_str().unwrap().to_owned();
    let headers=format!("Authorization: Bearer {token}\r\n");
    for _ in 0..if fail_timer {2} else {5} {assert_eq!(body(&host.request("POST","/q/read",&headers,ARGS))["data"]["n"],7);}
    if !g6 && !fail_timer {assert!(lock(&host.shared.engine).revision_cache_stats().read_index_hits>0);}
    (host,headers,namespace)
}
fn hold(host:&Host, micros:u64)->Arc<Held> {
    host.admission.ri_wait_micros.store(micros,Ordering::Relaxed);
    let held=Held::new();let h=held.clone();
    *lock(&host.shared.read_index_validation)=Some(Arc::new(move|| {
        h.entered.fetch_add(1,Ordering::Release);
        let mut open=lock(&h.open);
        while !*open {open=h.changed.wait(open).unwrap();}
    }));held
}
#[test]
#[ignore="private PG; SNAPBACK4_G5_READ_INDEX=1"]
fn g5r2_parked_reads_hold_no_execution_workers_or_readers() {
    let (host,headers,_)=fixture();let held=hold(&host,5_000_000);
    let completed=AtomicUsize::new(0);
    thread::scope(|scope| {
        let _release=Release(held.clone());
        let reads:Vec<_>=(0..32).map(|_|scope.spawn(|| {
            let wire=format!("POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{ARGS}",ARGS.len());
            let reply=exchange_held(host.address,Duration::from_secs(5),wire);
            completed.fetch_add(1,Ordering::Release);reply
        })).collect();
        // A contended cache-directory probe deliberately takes ordinary G5.
        // Account both paths; requiring every try_lock probe to succeed makes
        // this resource witness depend on thread scheduling.
        until(||host.admission.ri.get().is_some_and(|q|q.as_ref().unwrap().parked()+completed.load(Ordering::Acquire)==32));
        until(||held.entered.load(Ordering::Acquire)==2);
        until(||host.admission.workers[RequestClass::Short as usize].active()==0);
        let parked=host.admission.ri.get().unwrap().as_ref().unwrap().parked();
        assert!(parked>0);
        assert_eq!(host.admission.short.load(Ordering::Acquire),parked,"retain only the bounded socket admission, not an execution slot");
        assert_eq!(lock(&host.shared.readers).idle.len(),REQUEST_WORKERS);
        assert_eq!(status(&host.request("GET","/auth/config","","")),200);
        assert_eq!(held.entered.load(Ordering::Acquire),2,"bounded overlapping flights");
        held.release();
        for read in reads {assert_eq!(body(&read.join().unwrap())["data"]["n"],7);}
    });
    until(||host.admission.short.load(Ordering::Acquire)==0);
}
#[test]
#[ignore="private PG; SNAPBACK4_G5_READ_INDEX=1"]
fn g5r2_parked_deadline_and_disconnected_reader_do_not_cancel_other_flights() {
    let (host,headers,_)=fixture();let held=hold(&host,30_000);let _release=Release(held.clone());
    // Disconnect while parked; it owns no worker/reader and cannot cancel the
    // statement shared by live callers. TCP half-close is not a cancel token.
    let mut disconnected=TcpStream::connect(host.address).unwrap();
    write!(disconnected,"POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{ARGS}",ARGS.len()).unwrap();
    until(||held.entered.load(Ordering::Acquire)>0);
    drop(disconnected);
    let reply=host.request("POST","/q/read",&headers,ARGS);
    assert_eq!(body(&reply)["data"]["n"],7,"proof wait expiry takes ordinary G5 even while validators remain held");
    until(||host.admission.short.load(Ordering::Acquire)==0);
    assert!(!*lock(&held.open),"neither expiry nor disconnect cancels another flight");
    held.release();
}
#[test]
#[ignore="private PG; SNAPBACK4_G5_READ_INDEX=1"]
fn g5r2_ownership_loss_while_parked_cannot_serve_the_old_entry() {
    let (host,headers,namespace)=fixture();let held=hold(&host,5_000_000);
    let hits=lock(&host.shared.engine).revision_cache_stats().read_index_hits;
    thread::scope(|scope| {
        let _release=Release(held.clone());
        let read=scope.spawn(||host.request("POST","/q/read",&headers,ARGS));
        until(||held.entered.load(Ordering::Acquire)>0);
        let connection=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
        let update=format!("UPDATE \"{namespace}\"._owner SET token=token+1,holder='b002' WHERE singleton");
        assert!(std::process::Command::new("psql").args(["-XqAt","-d",&connection,"-c",&update]).status().unwrap().success());
        held.release();
        let reply=read.join().unwrap();
        // Ordinary G5 can still validate a fresh authoritative read after
        // ownership changes. It cannot use this owner's RI certificate.
        assert_eq!(body(&reply)["data"]["n"],7,"{reply}");
        assert_eq!(lock(&host.shared.engine).revision_cache_stats().read_index_hits,hits);
    });
}


#[test]
#[ignore="private PG; SNAPBACK4_G5_READ_INDEX=1"]
fn g5r2_original_request_deadline_expires_while_parked() {
    let (host,headers,_)=fixture();let held=hold(&host,5_000_000);let _release=Release(held.clone());
    // Capture a shorter original deadline at dispatch; the proof wait still
    // has five seconds. Recomputing a deadline from the request on resume
    // would incorrectly renew this admission.
    host.admission.ri_deadline_micros.store(30_000,Ordering::Relaxed);
    let reply=host.request("POST","/q/read",&headers,ARGS);
    assert_eq!(status(&reply),503,"{reply}");
    assert_eq!(body(&reply)["denied"]["code"],"E_RATE_LIMIT");
    assert!(body(&reply).get("data").is_none());
    assert!(!*lock(&held.open));
    held.release();
    until(||host.admission.short.load(Ordering::Acquire)==0);
}

#[test]
#[ignore="private PG; RI enabled"]
#[cfg(target_os="linux")]
fn g5rf_http_both_flags_live_g6_has_zero_ri_rounds() {
    if std::env::var_os("SNAPBACK4_G5RF_G6_CHILD").is_none() {
        let out=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--ignored","--exact","serve::tests::read_index_tests::g5rf_http_both_flags_live_g6_has_zero_ri_rounds","--nocapture"])
            .env("SNAPBACK4_G5RF_G6_CHILD","1").env("SNAPBACK4_G5_READ_INDEX","1")
            .env("SNAPBACK4_READ_GRANT_CLOCK_BOUNDS","1000,250").output().unwrap();
        assert!(out.status.success(),"{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));
        assert!(String::from_utf8_lossy(&out.stdout).contains("1 passed"),"child must run the witness");
        return;
    }
    assert_eq!(std::env::var("SNAPBACK4_G5_READ_INDEX").as_deref(),Ok("1"));
    assert_eq!(std::env::var("SNAPBACK4_READ_GRANT_CLOCK_BOUNDS").as_deref(),Ok("1000,250"));
    let (host,headers,_)=fixture_mode(true,false);
    let before=lock(&host.shared.engine).revision_cache_stats();
    for _ in 0..20 {assert_eq!(body(&host.request("POST","/q/read",&headers,ARGS))["data"]["n"],7);}
    let after=lock(&host.shared.engine).revision_cache_stats();
    assert_eq!(after.g6_hits,before.g6_hits+20);
    assert_eq!(after.read_index_rounds,0);
    assert_eq!(after.read_index_reads,0);
    assert!(host.admission.ri.get().is_none(),"G6 bypasses parking before lazy timer initialization");
}

#[test]
#[ignore="private PG; RI enabled"]
fn g5rf_http_timer_spawn_failure_resumes_g5_with_original_admission_and_deadline() {
    let (host,headers,_)=fixture_mode(false,true);
    assert!(host.admission.ri.get().is_none());
    let before=lock(&host.shared.engine).revision_cache_stats();
    let held=Held::new();let h=held.clone();
    *lock(&host.admission.ri_timer_spawn)=Some(Arc::new(move|| {
        h.entered.fetch_add(1,Ordering::Release);
        let mut open=lock(&h.open);while !*open {open=h.changed.wait(open).unwrap();}
    }));
    host.admission.ri_deadline_micros.store(30_000,Ordering::Relaxed);
    thread::scope(|scope| {
        let _release=Release(held.clone());
        let read=scope.spawn(||host.request("POST","/q/read",&headers,ARGS));
        until(||held.entered.load(Ordering::Acquire)>0);
        assert_eq!(host.admission.short.load(Ordering::Acquire),1,"original socket permit through failed start");
        thread::sleep(Duration::from_millis(40));held.release();
        let reply=read.join().unwrap();
        assert_eq!(status(&reply),503,"expired original deadline: {reply}");
        assert_eq!(body(&reply)["denied"]["code"],"E_RATE_LIMIT");
    });
    assert!(host.admission.ri.get().unwrap().is_err(),"injected timer spawn failed");
    host.admission.ri_deadline_micros.store(0,Ordering::Relaxed);
    assert_eq!(body(&host.request("POST","/q/read",&headers,ARGS))["data"]["n"],7,"failed start resumes ordinary G5");
    until(||host.admission.short.load(Ordering::Acquire)==0);
    let after=lock(&host.shared.engine).revision_cache_stats();
    assert_eq!(after.hits,before.hits+1);
    assert_eq!(after.read_index_rounds,before.read_index_rounds);
    assert_eq!(after.read_index_hits,before.read_index_hits);
}

#[test]
#[ignore="private PG; RI enabled"]
fn g5rf_http_idle_timer_parks_on_condvar() {
    let (host,_,_)=fixture();
    until(||host.admission.short.load(Ordering::Acquire)==0);
    let queue=host.admission.ri.get().unwrap().as_ref().unwrap();
    thread::sleep(Duration::from_millis(20));
    let ticks=queue.timer_ticks();
    thread::sleep(Duration::from_millis(30));
    assert_eq!(queue.timer_ticks(),ticks,"no periodic idle timer ticks");
}
