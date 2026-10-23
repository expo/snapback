use super::*;
use std::sync::Barrier;

const SOURCE: &str = "use personas alice, bob\ntable counters:\n  n: int default 0\n  read <- allow\n  update <- allow\n  online only\nmutation bump():\n  c = counters['counter'] ! else NOT_FOUND\n  return update counters[c.id] { n: c.n + 1 }\nquery read():\n  return counters['counter']\ntable viewing:\n  principal: principal\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 30s\nmutation view():\n  upsert viewing[principal = viewer] { principal: viewer }\n";

#[test]
fn queued_http_mutations_keep_receipts_order_and_progress_with_reads_and_ephemeral() {
    let directory = ReaderTestDirectory::new();
    let host = Host::with_store(
        true,
        snapback4_core::Store::open(&directory.0.join("queue.sqlite")).unwrap(),
        SOURCE,
    );
    let seeded = body(&host.request(
        "POST",
        "/seed",
        "",
        r#"[{"table":"counters","row":{"id":"counter"}}]"#,
    ));
    assert_eq!(seeded["seeded"], 1, "{seeded}");
    let before = lock(&host.shared.engine).seq().unwrap();
    let barrier = Barrier::new(18);
    let replies = std::thread::scope(|scope| {
        let writers: Vec<_> = (0..16)
            .map(|writer| {
                let (host, barrier) = (&host, &barrier);
                scope.spawn(move || {
                    barrier.wait();
                    (0..8)
                        .map(|step| {
                            // Two request threads race each identity, including receipt
                            // lookup before either copy has reached execution.
                            let id = format!("queued-{}-{step}", writer / 2);
                            let response = host.request(
                                "POST",
                                "/m/bump",
                                "x-snapback-persona: alice\r\n",
                                &json!({"id":id,"args":{}}).to_string(),
                            );
                            assert_eq!(status(&response), 200, "{response}");
                            let reply = body(&response);
                            assert_eq!(reply["state"], "sent", "{reply}");
                            (id, reply)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let reader = scope.spawn(|| {
            barrier.wait();
            let mut last = 0;
            for _ in 0..48 {
                let reply = body(&host.request(
                    "POST",
                    "/q/read",
                    "x-snapback-persona: alice\r\n",
                    r#"{"args":{}}"#,
                ));
                let n = reply["data"]["n"].as_u64().expect("read answered");
                assert!(n >= last && n <= 64, "{reply}");
                last = n;
            }
        });
        let ephemeral = scope.spawn(|| {
            barrier.wait();
            for _ in 0..24 {
                let reply = body(&host.request(
                    "POST",
                    "/m/view",
                    "x-snapback-persona: bob\r\n",
                    r#"{"args":{}}"#,
                ));
                assert_eq!(reply["state"], "sent", "{reply}");
                assert!(reply.get("ephemeral").is_some(), "{reply}");
            }
        });
        let replies = writers
            .into_iter()
            .flat_map(|writer| writer.join().unwrap())
            .collect::<Vec<_>>();
        reader.join().unwrap();
        ephemeral.join().unwrap();
        replies
    });
    let mut receipts = BTreeMap::<String, u64>::new();
    let mut ordered = Vec::new();
    let mut replayed = 0;
    for (id, reply) in replies {
        let seq = reply["seq"].as_u64().unwrap();
        if let Some(previous) = receipts.insert(id, seq) {
            assert_eq!(previous, seq);
        }
        if reply["replayed"] == true {
            replayed += 1;
            assert!(
                reply.get("result").is_none(),
                "receipt replays retain no historical row"
            );
        } else {
            ordered.push((seq, reply["result"]["n"].as_u64().unwrap()));
        }
    }
    assert_eq!(receipts.len(), 64);
    assert_eq!(replayed, 64);
    ordered.sort_unstable();
    assert_eq!(
        ordered,
        (1..=64).map(|n| (before + n, n)).collect::<Vec<_>>()
    );
    let engine = lock(&host.shared.engine);
    assert_eq!(
        engine.seq().unwrap(),
        before + 64,
        "ephemeral work publishes no durable sequence"
    );
    assert_eq!(
        engine.store().applied_ops().unwrap(),
        64,
        "one durable receipt per raced identity"
    );
}

#[test]
fn kit3_memory_http_retries_publish_only_the_ordinary_prelude_and_encountered_rows() {
    use snapback4_core::Value;
    let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
        "use personas alice\ntable a_unrelated:\n  opens: time\n  by opening: opens\n  not before .opens\n  public 'fixture'\n  online only\ntable needed:\n  opens: time\n  by opening: opens\n  not before .opens\n  public 'fixture'\n  online only\nquery list():\n  return needed first 10 by .id\n");
    let now = host.shared.now();
    let rows = [("a_unrelated", 5), ("needed", 3)].into_iter().flat_map(|(table, n)| (0..n).map(move |id| {
        (table.to_owned(), snapback4_core::value::object([("id", Value::Id(format!("r{id}"))), ("opens", Value::Int(now+1000))]))
    })).collect::<Vec<_>>();
    lock(&host.shared.engine).seed_at(rows, now).unwrap();
    lock(&host.shared.clock).freeze(now + 1000);
    let reply = body(&host.request("POST", "/q/list", "x-snapback-persona: alice\r\n", r#"{"args":{}}"#));
    assert_eq!(reply["complete"], true, "{reply}"); assert_eq!(reply["data"].as_array().unwrap().len(), 3);
    let engine = lock(&host.shared.engine);
    let pending: i64 = (engine.store()).test_support_conn().query_row("SELECT COUNT(*) FROM _time_openings WHERE t = 'a_unrelated'", [], |row|row.get(0)).unwrap();
    assert_eq!(pending, 4, "only the one ordinary prelude may publish an unrelated row");
}

#[test]
fn raced_mutation_id_refusal_keeps_its_terminal_http_status() {
    // Exercise the post-preflight error classifier directly: a socket race
    // may otherwise happen to be caught by the earlier replay check.
    assert_eq!(mutation_error_status(&snapback4_core::store_port::id_reused().refusal()), 200);
    let mut transient = Refusal::new("E_STORE", "store", "retry later");
    transient.retryable = true;
    assert_eq!(mutation_error_status(&transient), 503);
    assert_eq!(mutation_error_status(&Refusal::new("E_STORE", "store", "failed")), 500);

    let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
        "use personas alice\nmutation answer(n: int):\n  return n\n");
    let gate = Arc::new(std::sync::Barrier::new(13));
    let threads: Vec<_> = (0..12).map(|n| {
        let gate = gate.clone();
        let address = host.address;
        thread::spawn(move || {
            let payload = json!({ "id": "raced-input", "args": { "n": n } }).to_string();
            gate.wait();
            exchange(address, &format!("POST /m/answer HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()))
        })
    }).collect();
    gate.wait();
    let replies: Vec<_> = threads.into_iter().map(|thread| {
        let response = thread.join().unwrap();
        assert_eq!(status(&response), 200, "{response}");
        body(&response)
    }).collect();
    assert_eq!(replies.iter().filter(|reply| reply["state"] == "sent").count(), 1);
    for reply in replies.iter().filter(|reply| reply["state"] != "sent") {
        assert_eq!(reply["state"], "failed");
        assert_eq!(reply["why"]["code"], "E_ID_REUSED");
        assert!(!reply["why"]["retryable"].as_bool().unwrap_or(false));
    }
}
