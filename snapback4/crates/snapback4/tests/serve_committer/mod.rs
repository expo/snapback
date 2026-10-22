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
