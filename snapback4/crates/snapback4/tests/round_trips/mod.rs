//! Real TCP HTTP requests through serve's dispatcher, authority and engine.
// @ref LLP 3000.009.001.000.001#5 — warm per-class tables can only fall deliberately.
use super::*;
use snapback4_core::{
    identity,
    round_trips::{Counts, Scope},
};
use std::collections::BTreeMap;

pub(crate) struct RequestScope {
    scope: Scope,
    output: mpsc::Sender<Counts>,
}
impl Drop for RequestScope {
    fn drop(&mut self) {
        let _ = self.output.send(self.scope.counts());
    }
}
pub(crate) fn request_scope(shared: &Shared) -> Option<RequestScope> {
    lock(&shared.round_trips)
        .clone()
        .map(|output| RequestScope {
            scope: Scope::begin(),
            output,
        })
}

#[test]
fn round_trips_sqlite() {
    run(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn round_trips_postgres() {
    run(true);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres"]
fn rt6_fix1_nul_receipt_preserves_http_store_refusal() {
    let directory = ReaderTestDirectory::new();
    for pg in [false, true] {
        let store = if pg {
            snapback4_core::store_port::AnyStore::create_postgres(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
                &format!("rt6_nul_receipt_{:x}", snapback4_core::ids::seed()),
            ).unwrap()
        } else {
            snapback4_core::store_port::AnyStore::open(&directory.0.join("store.sqlite")).unwrap()
        };
        let host = Host::with_store(false, store, "use identity\nmutation noop():\n  return 1\n");
        let (token, store_id, head) = {
            let engine = lock(&host.shared.engine);
            (identity::open_session(engine.store(), "alice", "guest", host.shared.now()).unwrap().token,
             engine.store().store_identity().unwrap().unwrap(), engine.store().seq().unwrap())
        };
        let headers = format!("Authorization: Bearer {token}\r\n");
        for id in ["valid-id", "bad\0id"] {
            let response = host.request("POST", "/m/noop", &headers,
                &json!({"id":id,"store_id":"foreign-store","args":{}}).to_string());
            assert_eq!(status(&response), 200, "pg={pg}: {response}");
            let reply = body(&response);
            assert_eq!(reply["why"]["code"], "E_STORE_REPLACED", "pg={pg}: {reply}");
            assert_eq!(reply["store_id"], store_id);
        }
        assert_eq!(lock(&host.shared.engine).store().seq().unwrap(), head);
    }
}

fn run(pg: bool) {
    let directory = ReaderTestDirectory::new();
    let store = if pg {
        #[cfg(feature = "postgres")]
        {
            snapback4_core::store_port::AnyStore::create_postgres(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES")
                    .expect("private scripts/test-postgres.sh cluster"),
                &format!("sb4_rt0_{:x}", snapback4_core::ids::seed()),
            )
            .unwrap()
        }
        #[cfg(not(feature = "postgres"))]
        {
            unreachable!()
        }
    } else {
        snapback4_core::store_port::AnyStore::open(&directory.0.join("store.sqlite")).unwrap()
    };
    // W3-shaped facts use stored totals so existing mutation workloads and
    // ratchets stay identical; core parity also covers maintained totals.
    let source = format!("{}\n{}", include_str!("../../../../reports/20261022-rt-a-round-trips/admitted-s1.q"), include_str!("w3.q"))
        .replace("table rooms:\n", "table rooms:\n  total: int default 0\n");
    let host = Host::with_store(false, store, &source);
    let now = host.shared.now();
    let (session, account, action, store_id) = {
        let mut engine = lock(&host.shared.engine);
        let session = identity::open_session(engine.store(), "guest:rt0", "guest", now).unwrap();
        // Isolate the credential kind: both bearers face the same seeded rows
        // and rules. Native S1 also issues its account bearer with open_session.
        let account = identity::open_session(engine.store(), &session.principal, "account", now).unwrap();
        let action =
            snapback4_core::round_trips::action_claim(engine.store_mut(), &session, now).unwrap();
        let store_id = engine.store().store_identity().unwrap().unwrap();
        (session, account, action, store_id)
    };
    let (tx, rx) = mpsc::channel();
    *lock(&host.shared.round_trips) = Some(tx);
    let request = |path: &str, token: Option<&str>, payload: Json| {
        let headers = token
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        let response = host.request("POST", path, &headers, &payload.to_string());
        let count = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("request count after all request cleanup");
        (status(&response), body(&response), count)
    };
    let token = Some(session.token.as_str());
    let setup = request("/m/setup", token, json!({"args":{}}));
    assert_eq!(setup.1["state"], "sent", "{}", setup.1);
    for n in 0..25 {
        let seeded = request(
            "/m/seedMessage",
            token,
            json!({"args":{"key":format!("m{n}"),"at":n}}),
        );
        assert_eq!(seeded.1["state"], "sent", "{}", seeded.1);
    }
    for n in (2..=32).chain(std::iter::once(1024)) {
        let seeded=request("/m/seedRoom",token,json!({"args":{"key":format!("r{n:04}"),"total":n*2,"last_read":n}}));
        assert_eq!(seeded.1["state"],"sent","{}",seeded.1);
    }
    let mut measured = BTreeMap::new();
    let mut cold = BTreeMap::new();
    let classes = [
        ("w1_point", "/q/W1", token, json!({"message":"m24"})),
        ("w2_newest20", "/q/W2", token, json!({"room":"r0001"})),
        ("w3_membership_totals", "/q/W3", token, json!({})),
        (
            "unkeyed_increment",
            "/m/increment",
            token,
            json!({"counter":"c0000"}),
        ),
        (
            "one_membership",
            "/m/checked",
            token,
            json!({"counter":"c0000","room":"r0001"}),
        ),
        ("account_w1", "/q/W1", Some(account.token.as_str()), json!({"message":"m24"})),
        ("account_unkeyed_increment", "/m/increment", Some(account.token.as_str()), json!({"counter":"c0000"})),
    ];
    for (class, path, credential, args) in classes {
        for repetition in 0..4 {
            let (status, reply, counts) = request(path, credential, json!({"args":args}));
            assert_eq!(status, 200, "{class}: {reply}");
            if matches!(class, "w1_point" | "account_w1") {
                assert_eq!(reply["data"]["id"], "m24", "{reply}");
            } else if class == "w2_newest20" {
                assert_eq!(reply["data"].as_array().unwrap().len(), 20, "{reply}");
                assert_eq!(reply["data"][0]["id"], "m24");
                assert_eq!(reply["data"][19]["id"], "m5");
            } else if class == "w3_membership_totals" {
                assert_eq!(reply["data"].as_array().unwrap().len(),32,"{reply}");
                assert_eq!(reply["data"][0]["room"],"r0001");
                assert_eq!(reply["data"][1]["total"],4);
                assert_eq!(reply["data"][1]["unread"],2);
                assert_eq!(reply["data"][31]["room"],"r0032");
            } else {
                assert_eq!(reply["state"], "sent", "{reply}");
                if class.contains("unkeyed") {assert!(reply.get("id").is_none(),"private invocation identity leaked into HTTP: {reply}");}
            }
            record(&mut measured, &mut cold, class, repetition, counts, pg);
        }
    }
    // Each first attempt has a fresh SDK-shaped id and store binding. Its replay
    // is measured independently; the counter value must not change on replay.
    for repetition in 0..4 {
        let payload = json!({"id":format!("rt0-{repetition}"),"store_id":store_id,"args":{"counter":"c0000"}});
        let (_, sent, counts) = request("/m/increment", token, payload.clone());
        assert_eq!(sent["state"], "sent", "{sent}");
        assert_ne!(sent["replayed"], true);
        record(
            &mut measured,
            &mut cold,
            "keyed_first",
            repetition,
            counts,
            pg,
        );
        let (_, replay, counts) = request("/m/increment", token, payload);
        assert_eq!(replay["replayed"], true, "{replay}");
        assert_eq!(replay["seq"], sent["seq"]);
        record(
            &mut measured,
            &mut cold,
            "replay_hit",
            repetition,
            counts,
            pg,
        );
    }
    for repetition in 0..4 {
        for (class, path, credential, payload, expected_status, code) in [
            (
                "action_session_w1",
                "/q/W1",
                Some(action.token.as_str()),
                json!({"args":{"message":"m24"}}),
                200,
                "",
            ),
            (
                "unauthenticated",
                "/q/W1",
                None,
                json!({"args":{"message":"m24"}}),
                401,
                "E_AUTH",
            ),
            (
                "unknown_token",
                "/q/W1",
                Some("rt0-unknown-token"),
                json!({"args":{"message":"m24"}}),
                401,
                "E_AUTH",
            ),
            (
                "unknown_operation",
                "/m/noSuchOperation",
                token,
                json!({"args":{}}),
                404,
                "E_OP",
            ),
            (
                "narrowed_argument",
                "/m/increment",
                token,
                json!({"args":{"counter":42}}),
                200,
                "E_INPUT",
            ),
        ] {
            let (status, reply, counts) = request(path, credential, payload);
            assert_eq!(status, expected_status, "{class}: {reply}");
            if code.is_empty() {
                assert_eq!(reply["data"]["id"], "m24", "{reply}");
            } else {
                assert!(reply.to_string().contains(code), "{class}: {reply}");
            }
            if matches!(class, "unknown_operation" | "narrowed_argument") {
                assert_eq!(reply["store_id"], store_id, "metadata refusal: {reply}");
            }
            record(&mut measured, &mut cold, class, repetition, counts, pg);
        }
    }
    // Even malformed bodies and unknown operation names cannot turn an
    // unknown token into a second flight or an authenticated refusal.
    for (path,payload) in [("/q/W1","{"),("/q/noSuchOperation",r#"{"args":{"message":42}}"#)] {
        let reply=host.request("POST",path,"Authorization: Bearer rt0-unknown-malformed\r\n",payload);
        let counts=rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(status(&reply),401,"{reply}");
        assert_eq!(body(&reply)["denied"]["code"],"E_AUTH");
        for field in ["store_id","head","generation","data"] {assert!(body(&reply).get(field).is_none(),"{reply}");}
        assert_eq!(if pg {counts.postgres}else{counts.sqlite},if pg {1}else{2});
    }
    // Exhaust the actual production identity limiter, then measure repeated 429s.
    let limited = (0..31).any(|_| request("/auth/guest", None, json!({})).0 == 429);
    assert!(
        limited,
        "production identity limiter must refuse within 31 attempts"
    );
    for repetition in 0..4 {
        let (status, reply, counts) = request("/auth/guest", None, json!({}));
        assert_eq!(status, 429);
        assert_eq!(reply["denied"]["code"], "E_RATE_LIMIT");
        record(
            &mut measured,
            &mut cold,
            "rate_limited",
            repetition,
            counts,
            pg,
        );
    }
    // Controlled store batches exclude HTTP ingress. Totals divided by N are
    // per-member amortized flights/statements; the existing HTTP N=1 rows stay
    // separate and unchanged.
    for n in [4,8,32] {
        for repetition in 0..4 {
            let principal=session.principal.clone();
            let digest=identity::session_digest(&session.token);
            let counts=host.shared.engine.call(move |engine,_| {
                let scope=Scope::begin();
                let mut invocations:Vec<_>=(0..n).map(|_| {
                    let principal=principal.clone();
                    snapback4_core::engine::program::Invocation::new("increment",None,
                        Context::new(principal.clone(),[("counter".into(),snapback4_core::Value::Id("c0000".into()))].into()).at(now).with_request_credential("guest"))
                        .authorized(digest.clone(),move ||identity::ServiceSample{now,supervisor_revision:0},move |facts| {
                            assert_eq!(facts.capability.unwrap().0,principal);Ok(())
                        })
                }).collect();
                let results=engine.invoke_program_batch(&mut invocations);
                assert!(results.iter().all(|r|matches!(r,Ok(ack) if matches!(ack.outcome.state,snapback4_core::WriteState::Sent{..}))),"{results:?}");
                scope.counts()
            }).unwrap();
            record(&mut measured,&mut cold,&format!("program_batch_{n}_total"),repetition,counts,pg);
        }
    }
    let store_name = if pg { "postgres" } else { "sqlite" };
    println!(
        "RT0 {store_name} warm: {}",
        serde_json::to_string(&measured).unwrap()
    );
    println!(
        "RT0 {store_name} cold/first-use: {}",
        serde_json::to_string(&cold).unwrap()
    );
    let expected: BTreeMap<String, u64> = serde_json::from_str(if pg {
        include_str!("postgres.json")
    } else {
        include_str!("sqlite.json")
    })
    .unwrap();
    assert_eq!(
        measured.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>(),
        "every class must have one table row"
    );
    for (class, measured) in measured {
        let table = expected[&class];
        assert!(
            measured <= table,
            "{store_name} {class}: table {table}, measured {measured}: dependent work regressed"
        );
        assert!(
            measured >= table,
            "{store_name} {class}: table {table}, measured {measured}: lower the table"
        );
    }
}
fn record(
    warm: &mut BTreeMap<String, u64>,
    cold: &mut BTreeMap<String, u64>,
    class: &str,
    repetition: usize,
    counts: Counts,
    pg: bool,
) {
    let n = if pg {
        assert_eq!(counts.sqlite, 0);
        counts.postgres
    } else {
        assert_eq!(counts.postgres, 0);
        counts.sqlite
    };
    if repetition == 0 {
        cold.insert(class.into(), n);
    } else if let Some(previous) = warm.insert(class.into(), n) {
        assert_eq!(previous, n, "{class}: warm repetitions disagree");
    }
}

/// Manual HTTP load over the ratcheted fixture, with no round-trip collector.
#[cfg(feature = "postgres")]
#[test]
#[ignore = "manual private PG16 HTTP measurement; SNAPBACK4_PIPELINE_HTTP_MEASURE=1"]
fn pipeline_http_measure_128_clients() {
    if std::env::var("SNAPBACK4_PIPELINE_HTTP_MEASURE").as_deref()!=Ok("1") { return; }
    let store=snapback4_core::store_port::AnyStore::create_postgres(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        &format!("pipe_http_{:x}",snapback4_core::ids::seed()),
    ).unwrap();
    let source=format!("{}\n{}",include_str!("../../../../reports/20261022-rt-a-round-trips/admitted-s1.q"),include_str!("w3.q"))
        .replace("table rooms:\n","table rooms:\n  total: int default 0\n");
    let host=Host::with_store(false,store,&source);
    let token={ let e=lock(&host.shared.engine);identity::open_session(e.store(),"guest:pipe-http","guest",host.shared.now()).unwrap().token };
    let headers=format!("Authorization: Bearer {token}\r\n");
    let seed=|name:&str,args:Json| {
        let response=host.request("POST",&format!("/m/{name}"),&headers,&json!({"args":args}).to_string());
        assert_eq!(status(&response),200,"{response}");
        assert_eq!(body(&response)["state"],"sent","{response}");
    };
    seed("setup",json!({}));
    for n in 0..25 {seed("seedMessage",json!({"key":format!("m{n}"),"at":n}));}
    for n in (2..=32).chain(std::iter::once(1024)) {seed("seedRoom",json!({"key":format!("r{n:04}"),"total":n*2,"last_read":n}));}
    for (name,args,rows) in [("W2",json!({"room":"r0001"}),20),("W3",json!({}),32)] {
        let payload=json!({"args":args}).to_string();
        let wire=format!("POST /q/{name} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{payload}",payload.len());
        let address=host.address;
        let barrier=Arc::new(std::sync::Barrier::new(129));
        let clock=Arc::new(std::sync::OnceLock::<Instant>::new());
        let mut clients=Vec::new();
        for _ in 0..128 {
            let wire=wire.clone();let barrier=barrier.clone();let clock=clock.clone();
            clients.push(thread::spawn(move|| {
                // Prime the bearer hint and reader pool before the common start.
                let warm=std::panic::catch_unwind(||exchange(address,&wire));
                barrier.wait();
                while clock.get().is_none() { thread::yield_now(); }
                assert!(warm.is_ok(),"HTTP warm-up failed");
                let start=clock.get().unwrap();let mut times=Vec::new();let mut refused=0u64;
                while start.elapsed()<Duration::from_secs(5) {
                    let at=Instant::now();let response=exchange(address,&wire);
                    let code=status(&response);let value=body(&response);
                    if code==503 {assert_eq!(value["denied"]["code"],"E_RATE_LIMIT","unexpected serving error: {value}");refused+=1;continue;}
                    assert_eq!(code,200,"{response}");
                    assert_eq!(value["data"].as_array().map(Vec::len),Some(rows),"{value}");
                    assert_eq!(value["complete"],true,"{value}");
                    times.push(at.elapsed().as_nanos() as u64);
                }
                (times,refused,start.elapsed().as_secs_f64())
            }));
        }
        barrier.wait();clock.set(Instant::now()).unwrap();let mut times=Vec::new();let mut refused=0u64;let mut seconds=0.0f64;
        for client in clients {let(t,r,s)=client.join().unwrap();times.extend(t);refused+=r;seconds=seconds.max(s);}
        times.sort_unstable();assert!(!times.is_empty());
        println!("PIPELINE_HTTP_MEASUREMENT {}",json!({"op":name,"depth":std::env::var("SNAPBACK4_POSTGRES_PIPELINE_DEPTH").unwrap_or("4".into()),"clients":128,"max_connections":30,"http_workers":REQUEST_WORKERS,"http_queue":SHORT_REQUEST_QUEUE,"reads":times.len(),"refused_503":refused,"seconds":seconds,"reads_per_second":times.len() as f64/seconds,"p50_ms":times[times.len()/2] as f64/1e6,"p99_ms":times[times.len()*99/100] as f64/1e6,"connection":"close per request","fixture":"RT0 W2=25 messages/newest20; W3=32 scalar totals"}));
    }
}

// @ref LLP 3000.009.001.000.002#4.3 — the complete HTTP route must preserve metadata while the first G6 hit costs zero flights.
#[cfg(feature="postgres")]
#[test]
#[ignore="private PG16"]
fn round_trips_postgres_g6_zero_flight_hits_and_g5_fallback() {
    use snapback4_core::store_port::{AnyStore,StoreLease,LeasePolicy,ReadClockBounds};
    let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let ns=format!("rt0_g6_{:x}",snapback4_core::ids::seed());
    let source=format!("{}\n{}",include_str!("../../../../reports/20261022-rt-a-round-trips/admitted-s1.q"),include_str!("w3.q")).replace("table rooms:\n","table rooms:\n  total: int default 0\n");
    let bound=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);assert!(bound.diagnostics.is_empty());
    let schema=serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let programs:Vec<snapback4_core::Program>=bound.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    let bootstrap=Engine::new(AnyStore::create_postgres(&url,&ns).unwrap(),schema,programs).unwrap();
    let id=bootstrap.store().store_identity().unwrap().unwrap();drop(bootstrap);
    let mut lease=StoreLease::connect(&url,&ns,&id,"a666",LeasePolicy {lease:Duration::from_secs(30),..Default::default()}).unwrap();
    assert!(lease.acquire().unwrap().is_some());
    lease.enable_read_grant(ReadClockBounds {rate_ppm:1000,forward_jump:Duration::from_millis(10)}).unwrap();
    let host=Host::with_store(false,AnyStore::open_postgres_owned(&url,&ns,&lease).unwrap(),&source);
    let token={let e=lock(&host.shared.engine);identity::open_session(e.store(),"guest:g6-http","account",host.shared.now()).unwrap().token};
    let headers=format!("Authorization: Bearer {token}\r\n");
    let request=|path:&str,args:Json| {let response=host.request("POST",path,&headers,&json!({"args":args}).to_string());assert_eq!(status(&response),200,"{response}");body(&response)};
    assert_eq!(request("/m/setup",json!({}))["state"],"sent");
    for n in 0..25 {assert_eq!(request("/m/seedMessage",json!({"key":format!("m{n}"),"at":n}))["state"],"sent");}
    let (tx,rx)=mpsc::channel();*lock(&host.shared.round_trips)=Some(tx);
    for (name,args) in [("W1",json!({"message":"m24"})),("W2",json!({"room":"r0001"})),("W3",json!({}))] {
        let mut ordinary=None;
        for repetition in 0..4 {
            let reply=request(&format!("/q/{name}"),args.clone());let count=rx.recv_timeout(Duration::from_secs(10)).unwrap();
            assert_eq!(count.postgres,if repetition==0 {2}else if repetition==1 {1}else{0},"{name} repetition {repetition}: {count:?}");assert_eq!(count.sqlite,0);
            if let Some(expected)=&ordinary {assert_eq!(&reply,expected,"same data, metadata, manifest and cursor");}else{ordinary=Some(reply.clone());}
            assert_eq!(reply["store_id"],id);assert!(reply.get("head").is_none());assert!(reply["seq"].is_u64());assert!(reply["generation"].is_u64());
        }
    }
    let before=lock(&host.shared.engine).revision_cache_stats();assert!(before.g6_hits>=6);
    lease.release().unwrap();
    for _ in 0..3 {request("/q/W2",json!({"room":"r0001"}));let count=rx.recv_timeout(Duration::from_secs(10)).unwrap();assert_eq!(count.postgres,1,"revoked grant uses the unchanged G5/miss path");}
    let after=lock(&host.shared.engine).revision_cache_stats();
    assert_eq!(after.g6_hits,before.g6_hits);assert!(after.hits>before.hits,"fresh G5 reuse resumes after grant retirement");
    eprintln!("RT0 G6 W1/W2/W3 = 0/0/0; misses=1/1/1; revoked grant G5=1");
}

/// Relative HTTP loopback evidence; intended arrivals advance independently of
/// responses, with 32 senders retaining queue delay and every error.
#[cfg(feature = "postgres")]
#[test]
#[ignore = "manual private PG16; SNAPBACK4_R1_MEASURE=before|after"]
fn r1_open_loop_batch_fill() {
    let Ok(label) = std::env::var("SNAPBACK4_R1_MEASURE") else { return };
    let source = include_str!("../../../../reports/20261022-rt-a-round-trips/admitted-s1.q");
    let rates: Vec<usize> = std::env::var("SNAPBACK4_R1_RATES").unwrap_or("800,1600,3200".into())
        .split(',').map(|s| s.parse().unwrap()).collect();
    for rate in rates { for repetition in 0..3 {
        let store = snapback4_core::store_port::AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &format!("r1_measure_{:x}", snapback4_core::ids::seed())).unwrap();
        let host = Host::with_store(false, store, source);
        let token = { let e = lock(&host.shared.engine); identity::open_session(e.store(), "guest:r1", "guest", host.shared.now()).unwrap().token };
        let headers = format!("Authorization: Bearer {token}\r\n");
        let setup = host.request("POST", "/m/setup", &headers, r#"{"args":{}}"#);
        assert_eq!(body(&setup)["state"], "sent", "{setup}");
        let warm = host.request("POST", "/q/W1", &headers, r#"{"args":{"message":"absent"}}"#);
        assert_eq!(status(&warm), 200);
        let before = host.shared.engine.batch_stats();
        let head = lock(&host.shared.engine).store().seq().unwrap();
        let load_start = std::fs::read_to_string("/proc/loadavg").ok();
        let count = rate * 3;
        let next = Arc::new(AtomicUsize::new(0));
        let start = Instant::now() + Duration::from_millis(100);
        let mut senders = Vec::new();
        for _ in 0..32 {
            let next = next.clone(); let headers = headers.clone(); let address = host.address;
            senders.push(thread::spawn(move || {
                let mut latencies = Vec::new(); let mut failures = BTreeMap::<String, usize>::new();
                loop {
                    let n = next.fetch_add(1, Ordering::Relaxed); if n >= count { break; }
                    let intended = start + Duration::from_secs_f64(n as f64 / rate as f64);
                    if let Some(wait) = intended.checked_duration_since(Instant::now()) { thread::sleep(wait); }
                    let payload = r#"{"args":{"counter":"c0000"}}"#;
                    let wire = format!("POST /m/increment HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{payload}", payload.len());
                    let response = (|| -> std::io::Result<String> {
                        let mut stream = TcpStream::connect(address)?;
                        stream.set_read_timeout(Some(Duration::from_secs(1)))?;
                        stream.write_all(wire.as_bytes())?;
                        let mut reply = String::new(); stream.read_to_string(&mut reply)?; Ok(reply)
                    })();
                    match response {
                        Ok(reply) if status(&reply) == 200 && body(&reply)["state"] == "sent" => latencies.push(intended.elapsed().as_micros() as u64),
                        Ok(reply) => { let value = body(&reply); let why = value["why"]["code"].as_str().or(value["denied"]["code"].as_str()).unwrap_or("other"); *failures.entry(why.into()).or_default() += 1; },
                        Err(_) => *failures.entry("transport_timeout".into()).or_default() += 1,
                    }
                }
                (latencies, failures)
            }));
        }
        let mut latencies = Vec::new(); let mut failures = BTreeMap::<String, usize>::new();
        for sender in senders { let (times, errors) = sender.join().unwrap(); latencies.extend(times); for (why, n) in errors { *failures.entry(why).or_default() += n; } }
        let seconds = start.elapsed().as_secs_f64(); latencies.sort_unstable();
        let after = host.shared.engine.batch_stats();
        let durable = lock(&host.shared.engine).store().seq().unwrap() - head;
        let fills: Vec<_> = after.fills.iter().zip(&before.fills).map(|(a,b)| a-b).collect();
        println!("R1_MEASURE {}", json!({"label":label,"offered":rate,"repetition":repetition,"intended":count,"acknowledged":latencies.len(),"durable":durable,"errors":failures,"seconds":seconds,"writes_per_second":latencies.len() as f64/seconds,"mean_n":(after.members-before.members) as f64/fills.iter().sum::<u64>() as f64,"fills":fills,"p99_us":latencies.get(latencies.len()*99/100),"load_start":load_start,"load_end":std::fs::read_to_string("/proc/loadavg").ok(),"clients":32,"transport":"HTTP loopback, close per request, Unix PG16 socket","profile":"test, line-tables-only"}));
        assert_eq!(durable, latencies.len() as u64, "durable commits must reconcile with acknowledged writes");
    }}
}

#[test]
fn r1_reader_construction_releases_the_global_lock() {
    let directory = ReaderTestDirectory::new();
    let host = Host::with_store(false, snapback4_core::store_port::AnyStore::open(&directory.0.join("reader.db")).unwrap(), "use identity\nquery who():\n  return viewer\n");
    let (entered, arrived) = mpsc::channel(); let (release, resumed) = mpsc::channel();
    let resumed = Mutex::new(resumed);
    lock(&host.shared.readers).idle.clear();
    lock(&host.shared.readers).construction_hook = Some(Arc::new(move || { entered.send(()).unwrap(); lock(&resumed).recv().unwrap(); }));
    let shared = host.shared.clone();
    let builder = thread::spawn(move || shared.reader());
    arrived.recv_timeout(Duration::from_secs(10)).unwrap();
    // Construction is parked indefinitely. This is a mutex ownership witness,
    // independent of the machine's scheduling speed or connect latency.
    let unlocked = host.shared.readers.try_lock().is_ok();
    release.send(()).unwrap();
    assert!(builder.join().unwrap().is_ok());
    assert!(unlocked, "reader construction owns the global reader mutex (>100ms convoy possible)");
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn r1_ready_burst_never_constructs_a_reader() {
    let store = snapback4_core::store_port::AnyStore::create_postgres(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        &format!("r1_ready_{:x}", snapback4_core::ids::seed())).unwrap();
    let host = Host::with_store(false, store, "use identity\nquery who():\n  return viewer\n");
    assert_eq!(lock(&host.shared.readers).idle.len(), REQUEST_WORKERS);
    lock(&host.shared.readers).construction_hook = Some(Arc::new(|| panic!("ready burst tried to construct/qualify a reader")));
    let barrier = Arc::new(std::sync::Barrier::new(REQUEST_WORKERS));
    let threads: Vec<_> = (0..REQUEST_WORKERS).map(|_| {
        let shared = host.shared.clone(); let barrier = barrier.clone();
        thread::spawn(move || {
            let start = Instant::now(); let (epoch, reader) = shared.reader().unwrap();
            let acquisition = start.elapsed();
            // No return until every burst member owns its distinct loan.
            barrier.wait(); lock(&shared.readers).put(&epoch, reader.into_inner());
            acquisition
        })
    }).collect();
    let maximum = threads.into_iter().map(|t| t.join().unwrap()).max().unwrap();
    eprintln!("R1 ready burst: {REQUEST_WORKERS} loans; construction hook unreachable; max acquisition {maximum:?}");
    assert!(maximum < Duration::from_millis(100));
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn r1_client_timeout_after_commit_is_not_an_extra_execution() {
    for keyed in [false, true] {
        let store = snapback4_core::store_port::AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &format!("r1_ack_{:x}", snapback4_core::ids::seed())).unwrap();
        let host = Host::with_store(false, store, include_str!("../../../../reports/20261022-rt-a-round-trips/admitted-s1.q"));
        let token = { let e = lock(&host.shared.engine); identity::open_session(e.store(), "guest:r1-ack", "guest", host.shared.now()).unwrap().token };
        let headers = format!("Authorization: Bearer {token}\r\n");
        assert_eq!(body(&host.request("POST", "/m/setup", &headers, r#"{"args":{}}"#))["state"], "sent");
        let before = lock(&host.shared.engine).store().seq().unwrap();
        let (entered, arrived) = mpsc::channel(); let (release, resumed) = mpsc::channel(); let resumed = Mutex::new(resumed);
        *lock(&host.shared.mutation_committed) = Some(Arc::new(move || { entered.send(()).unwrap(); lock(&resumed).recv().unwrap(); }));
        let payload = if keyed { r#"{"id":"lost-ack","args":{"counter":"c0000"}}"# } else { r#"{"args":{"counter":"c0000"}}"# };
        let mut client = TcpStream::connect(host.address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        client.write_all(format!("POST /m/increment HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{payload}", payload.len()).as_bytes()).unwrap();
        arrived.recv_timeout(Duration::from_secs(10)).unwrap();
        // COMMIT is confirmed, but the response continuation is parked. Losing
        // the HTTP acknowledgement cannot roll back a durable write.
        let mut bytes = [0; 4096]; let timed_out = client.read(&mut bytes).unwrap_err();
        drop(client); release.send(()).unwrap();
        *lock(&host.shared.mutation_committed) = None;
        let head = host.shared.engine.call(|engine, _| engine.seq().unwrap()).unwrap();
        assert!(matches!(timed_out.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock));
        assert_eq!(head - before, 1, "one lost HTTP ack, exactly one durable execution");
        if keyed {
            let replay = body(&host.request("POST", "/m/increment", &headers, payload));
            assert_eq!(replay["state"], "sent"); assert_eq!(replay["seq"], head);
            assert_eq!(lock(&host.shared.engine).store().seq().unwrap(), head, "replay does not re-execute the mutation");
        }
        eprintln!("R1 lost HTTP ack keyed={keyed}: timeout, durable delta=1; no duplicate execution");
    }
}

#[test]
fn r1_reader_factory_unwind_and_retired_epoch_cannot_consume_slots() {
    let directory = ReaderTestDirectory::new();
    let host = Host::with_store(false, snapback4_core::store_port::AnyStore::open(&directory.0.join("reader.db")).unwrap(), "use identity\nquery who():\n  return viewer\n");
    lock(&host.shared.readers).construction_hook = Some(Arc::new(|| panic!("injected constructor unwind")));
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| host.shared.reader())).is_err());
    lock(&host.shared.readers).construction_hook = None;
    assert!(host.shared.reader().is_ok(), "unwind must return the factory reservation");
    let (entered, arrived) = mpsc::channel(); let (release, resumed) = mpsc::channel(); let resumed = Mutex::new(Some(resumed));
    lock(&host.shared.readers).construction_hook = Some(Arc::new(move || {
        if let Some(resumed) = lock(&resumed).take() { entered.send(()).unwrap(); resumed.recv().unwrap(); }
    }));
    let shared = host.shared.clone(); let builder = thread::spawn(move || shared.reader());
    arrived.recv_timeout(Duration::from_secs(10)).unwrap();
    let old = lock(&host.shared.readers).epoch.clone();
    { let engine = lock(&host.shared.engine); host.shared.replace_readers(&engine, &Default::default()); }
    release.send(()).unwrap();
    let (epoch, _) = builder.join().unwrap().unwrap();
    assert!(!Arc::ptr_eq(&old, &epoch));
    assert!(Arc::ptr_eq(&epoch, &lock(&host.shared.readers).epoch), "a constructor must retry after its native/backend epoch retires");
}
