//! Confirmed commits keep their result through changes before publication.
// @ref LLP 3000.009.001.000.001#3.4 — an acknowledged durable write cannot become a refusal after COMMIT.
use super::*;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use std::sync::atomic::AtomicBool;

const SOURCE: &str = "use personas alice\nuse identity\ntable rows:\n  n: int\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert rows { n: 1 }\nquery read():\n  return rows['missing']\nquery version():\n  return 1\nquery local() held:\n  return 1\nquery bounded(value: text 1..3):\n  return value\nquery cursor(c: cursor ?):\n  return 1\n";
const ALICE: &str = "x-snapback-persona: alice\r\n";

fn commit_gap(pg: bool) {
    let directory = ReaderTestDirectory::new();
    let path = directory.0.join("store.sqlite");
    let namespace = format!("sb4_rt1_gap_{:x}", snapback4_core::ids::seed());
    let store = if pg {
        #[cfg(feature = "postgres")]
        {
            snapback4_core::store_port::AnyStore::create_postgres(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private Postgres cluster"),
                &namespace,
            )
            .unwrap()
        }
        #[cfg(not(feature = "postgres"))]
        {
            unreachable!()
        }
    } else {
        let mut store = snapback4_core::store_port::AnyStore::open(&path).unwrap();
        store
            .retain_ownership(Arc::new(
                std::fs::File::create(directory.0.join("owner")).unwrap(),
            ))
            .unwrap();
        store
    };
    let host = Host::with_store(true, store, SOURCE);
    let (head, incarnation, generation) = {
        let engine = lock(&host.shared.engine);
        (
            engine.seq().unwrap() + 1,
            engine.store().store_identity().unwrap().unwrap(),
            engine.generation(),
        )
    };
    let (entered, waiting) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    let resumed = Mutex::new(resumed);
    *lock(&host.shared.mutation_committed) = Some(Arc::new(move || {
        entered.send(()).unwrap();
        lock(&resumed)
            .recv_timeout(Duration::from_secs(15))
            .unwrap();
    }));
    // Register a real commit subscriber before admitting the write. The
    // condition-variable wait atomically releases seq after sending ready.
    let shared = host.shared.clone();
    let (ready, registered) = mpsc::channel();
    let subscriber = thread::spawn(move || {
        let seq = lock(&shared.seq);
        ready.send(()).unwrap();
        let (seq, timeout) = shared
            .committed
            .wait_timeout_while(seq, Duration::from_secs(15), |seq| *seq < head)
            .unwrap();
        assert!(!timeout.timed_out(), "committed subscriber was not woken");
        let wake = lock(&shared.wake);
        assert_eq!(*seq, head);
        (wake.seq, wake.store_id.clone(), wake.generation)
    });
    registered.recv_timeout(Duration::from_secs(5)).unwrap();
    let address = host.address;
    let request = thread::spawn(move || {
        exchange_held(
            address,
            Duration::from_secs(15),
            "POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 11\r\nx-snapback-persona: alice\r\n\r\n{\"args\":{}}",
        )
    });
    waiting.recv_timeout(Duration::from_secs(15)).unwrap();
    // The HTTP worker is now between confirmed COMMIT and publication.
    if pg {
        #[cfg(feature = "postgres")]
        {
            let store = snapback4_core::store_port::AnyStore::open_postgres(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
                &namespace,
            )
            .unwrap();
            let mut foreign = Engine::open_at(store, host.shared.now()).unwrap();
            assert_eq!(foreign.seq().unwrap(), head, "COMMIT is already durable");
            assert_eq!(foreign.store().count("rows").unwrap(), 1);
            let bound = snapback4_lang::compile(&[(
                "schema.q".into(),
                SOURCE.replace("return 1", "return 2"),
            )]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let schema =
                serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
            let programs: Vec<snapback4_core::Program> = bound
                .programs
                .into_iter()
                .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
                .collect();
            foreign
                .adopt_at(schema, programs, host.shared.now())
                .unwrap();
            assert!(
                foreign.generation() > generation,
                "foreign activation committed"
            );
        }
    } else {
        // SQLite's retained ownership guard refuses a fresh seq() once the
        // owned file has another link; the already committed row survives.
        std::fs::hard_link(&path, directory.0.join("alias.sqlite")).unwrap();
    }
    resume.send(()).unwrap();
    let response = request.join().unwrap();
    assert_eq!(status(&response), 200, "{response}");
    let reply = body(&response);
    assert_eq!(reply["state"], "sent", "{reply}");
    assert_eq!(reply["seq"], head);
    assert_eq!(reply["head"], head);
    assert_eq!(reply["store_id"], incarnation);
    assert_eq!(reply["generation"], generation);
    assert_eq!(
        subscriber.join().unwrap(),
        (head, Some(incarnation), generation)
    );
    *lock(&host.shared.mutation_committed) = None;
    let why = lock(&host.shared.engine).seq().unwrap_err().refusal();
    let expected = if pg { "E_GENERATION" } else { "E_STORE" };
    assert_eq!(
        why.code, expected,
        "the removed fresh read really would refuse"
    );
    let next = host.request("POST", "/q/read", ALICE, "{}");
    assert_eq!(status(&next), if pg { 401 } else { 503 }, "{next}");
    assert_eq!(body(&next)["denied"]["code"], expected, "{next}");
}

#[cfg(unix)]
#[test]
fn publication_sqlite_committed_reply_survives_ownership_loss() {
    commit_gap(false);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn round_trips_postgres_publication_committed_reply_survives_foreign_activation() {
    commit_gap(true);
}

#[test]
fn memory_query_store_id_failure_refuses_before_program_reads() {
    // Memory stores have no detached readers; the query runs through the
    // writer fallback, which must refuse on the same metadata failure.
    for fail in [false, true] {
        let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
        let (armed, failed, reads) = (
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicUsize::new(0)),
        );
        let (a, f, r) = (armed.clone(), failed.clone(), reads.clone());
        host.shared
            .engine
            .call(move |engine, _| {
                engine
                    .store()
                    .test_support_conn()
                    .authorizer(Some(move |ctx: AuthContext<'_>| {
                        if let AuthAction::Read { table_name, .. } = ctx.action {
                            if table_name == "_commits" {
                                a.store(true, Ordering::SeqCst);
                            }
                            if table_name == "r" {
                                r.fetch_add(1, Ordering::SeqCst);
                            }
                            if fail && table_name == "_meta" && a.load(Ordering::SeqCst) {
                                f.store(true, Ordering::SeqCst);
                                return Authorization::Deny;
                            }
                        }
                        Authorization::Allow
                    }))
                    .unwrap();
            })
            .unwrap();
        let response = host.request("POST", "/q/read", ALICE, "{}");
        assert!(armed.load(Ordering::SeqCst), "query snapshot reached next_seq");
        assert_eq!(failed.load(Ordering::SeqCst), fail);
        if fail {
            assert_eq!(status(&response), 503, "{response}");
            assert_eq!(body(&response)["denied"]["code"], "E_STORE", "{response}");
            assert_eq!(reads.load(Ordering::SeqCst), 0, "program must not run after store_id failure");
        } else {
            assert_eq!(status(&response), 200, "{response}");
            assert!(reads.load(Ordering::SeqCst) > 0, "healthy control executes the program");
        }
    }
}

#[test]
fn query_store_id_failure_refuses_before_program_reads() {
    for fail in [false, true] {
        let directory = ReaderTestDirectory::new();
        let host = Host::with_store(
            true,
            snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap(),
            SOURCE,
        );
        let (epoch, reader) = host.shared.reader().unwrap();
        let (armed, failed, reads) = (
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicUsize::new(0)),
        );
        let (a, f, r) = (armed.clone(), failed.clone(), reads.clone());
        reader
            .store()
            .test_support_conn()
            .authorizer(Some(move |ctx: AuthContext<'_>| {
                if let AuthAction::Read { table_name, .. } = ctx.action {
                    if table_name == "_commits" {
                        a.store(true, Ordering::SeqCst);
                    }
                    if table_name == "r" {
                        r.fetch_add(1, Ordering::SeqCst);
                    }
                    // next_seq() follows the activation checks. Deny the next
                    // metadata read: the response callback's live store_id().
                    if fail && table_name == "_meta" && a.load(Ordering::SeqCst) {
                        f.store(true, Ordering::SeqCst);
                        return Authorization::Deny;
                    }
                }
                Authorization::Allow
            }))
            .unwrap();
        lock(&host.shared.readers).put(&epoch, reader.into_inner());
        let response = host.request("POST", "/q/read", ALICE, "{}");
        assert!(
            armed.load(Ordering::SeqCst),
            "query snapshot reached next_seq"
        );
        assert_eq!(failed.load(Ordering::SeqCst), fail);
        if fail {
            assert_eq!(status(&response), 503, "{response}");
            assert_eq!(body(&response)["denied"]["code"], "E_STORE", "{response}");
            assert_eq!(
                reads.load(Ordering::SeqCst),
                0,
                "program must not run after store_id failure"
            );
        } else {
            assert_eq!(status(&response), 200, "{response}");
            assert!(
                reads.load(Ordering::SeqCst) > 0,
                "healthy control executes the program"
            );
        }
    }
}

#[test]
fn query_early_refusals_reach_fresh_head_without_evaluation_seq() {
    let directory = ReaderTestDirectory::new();
    let host = Host::with_store(
        true,
        snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap(),
        SOURCE,
    );
    let committed = body(&host.request("POST", "/m/add", ALICE, "{}"));
    for (path, payload, code, http) in [
        ("/q/local", "{}", "E_QUERY_HELD", 200),
        ("/q/bounded", "{}", "E_INPUT", 400),
        ("/q/bounded", r#"{"args":{"value":"long"}}"#, "E_INPUT", 400),
        ("/q/cursor", r#"{"args":{"c":"invalid"}}"#, "E_INPUT", 400),
    ] {
        let response = host.request("POST", path, ALICE, payload);
        assert_eq!(status(&response), http, "{response}");
        let reply = body(&response);
        assert_eq!(reply["denied"]["code"], code, "{reply}");
        assert_eq!(reply["head"], committed["head"]);
        assert_eq!(reply["store_id"], committed["store_id"]);
        assert!(
            reply.get("seq").is_none(),
            "pre-snapshot refusal has no evaluation cut: {reply}"
        );
    }
}
