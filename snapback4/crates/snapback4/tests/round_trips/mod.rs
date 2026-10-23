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
    for n in [4,32] {
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
