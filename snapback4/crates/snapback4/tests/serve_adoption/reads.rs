//! The SQLite writer is deliberately held inside adoption. HTTP reads must
//! still authenticate and evaluate against the old committed generation.
use super::*;

const SOURCE: &str = "use identity\ntable items:\n  owner: principal\n  n: int\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nquery who():\n  return viewer\nquery item(id: items):\n  return items[id]\nmutation add(id: id):\n  insert items { id, owner: viewer, n: 1 }\n";
const VIEWS: &str =
    "\nview totals: count items by .owner\nquery total():\n  return totals[viewer]\n";

#[test]
fn adoption_keeps_queries_and_sync_readable_and_serializes_writes_once() {
    for dev in [true, false] {
        let dir = ReaderTestDirectory::new();
        let host = Host::with_store(
            dev,
            snapback4_core::Store::open(&dir.0.join("reads.db")).unwrap(),
            SOURCE,
        );
        let session = body(&host.request("POST", "/auth/guest", "", "{}"));
        let principal = session["session"]["principal"].as_str().unwrap().to_owned();
        let headers = format!(
            "Authorization: Bearer {}\r\n",
            session["session"]["token"].as_str().unwrap()
        );
        let added = body(&host.request(
            "POST",
            "/m/add",
            &headers,
            r#"{"id":"before","args":{"id":"before"}}"#,
        ));
        assert_eq!(added["state"], "sent", "{added}");
        lock(&host.shared.engine)
            .seed_at(
                [(
                    "items".into(),
                    snapback4_core::value::object([
                        ("id", snapback4_core::Value::Id("hidden-row".into())),
                        ("owner", snapback4_core::Value::Id("someone-else".into())),
                        ("n", snapback4_core::Value::Int(99)),
                    ]),
                )],
                host.shared.now(),
            )
            .unwrap();
        let candidate = snapback4_lang::compile(&[("schema.q".into(), format!("{SOURCE}{VIEWS}"))]);
        assert!(
            candidate.diagnostics.is_empty(),
            "{:?}",
            candidate.diagnostics
        );
        let (started, waiting) = mpsc::channel();
        let (release, resumed) = mpsc::channel();
        let shared = host.shared.clone();
        let adoption = thread::spawn(move || {
            let mut engine = lock(&shared.engine);
            lock(&shared.readers).begin_adoption(&candidate);
            let once = std::sync::atomic::AtomicBool::new(false);
            engine
                .store()
                .conn()
                .authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
                    if matches!(
                        ctx.action,
                        rusqlite::hooks::AuthAction::Insert { table_name: "i" }
                    ) && !once.swap(true, Ordering::SeqCst)
                    {
                        started.send(()).unwrap();
                        resumed.recv_timeout(Duration::from_secs(10)).unwrap();
                    }
                    rusqlite::hooks::Authorization::Allow
                }))
                .unwrap();
            let generation = engine
                .adopt(
                    candidate.schema.clone(),
                    candidate.programs.iter().map(|p| p.program.clone()),
                )
                .unwrap();
            engine
                .store()
                .conn()
                .authorizer(
                    None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>,
                )
                .unwrap();
            lock(&shared.readers).replace(&engine);
            *lock(&shared.bound) = candidate;
            *lock(&shared.generation) = generation;
        });
        waiting.recv_timeout(Duration::from_secs(5)).unwrap();
        let now = Instant::now();
        let who = body(&host.request("POST", "/q/who", &headers, "{}"));
        assert_eq!(who["data"], principal);
        assert_eq!(who["complete"], true, "{who}");
        let point = body(&host.request("POST", "/q/item", &headers, r#"{"args":{"id":"before"}}"#));
        assert_eq!(point["data"]["n"], 1, "{point}");
        let pending = body(&host.request("POST", "/q/total", &headers, "{}"));
        assert_eq!(pending["complete"], false, "{pending}");
        assert_eq!(pending["loading"], true, "{pending}");
        assert!(pending["data"].is_null());
        let sync = body(&host.request("POST", "/sync", &headers, "{}"));
        assert!(sync.get("denied").is_none(), "{sync}");
        assert!(!sync.to_string().contains("hidden-row"), "{sync}");
        let hidden = body(&host.request(
            "POST",
            "/q/item",
            &headers,
            r#"{"args":{"id":"hidden-row"}}"#,
        ));
        assert!(hidden["data"].is_null(), "{hidden}");
        assert!(
            now.elapsed() < Duration::from_secs(2),
            "reads queued behind adoption"
        );
        let address = host.address;
        let writer_headers = headers.clone();
        let writer = thread::spawn(move || {
            let payload = r#"{"id":"during","args":{"id":"during"}}"#;
            exchange(
                address,
                &format!(
                    "POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{writer_headers}\r\n{payload}",
                    payload.len()
                ),
            )
        });
        let enqueued = Instant::now();
        while host.shared.engine.waiting() == 0 {
            assert!(
                enqueued.elapsed() < Duration::from_secs(5),
                "write did not queue during adoption"
            );
            thread::yield_now();
        }
        // The write is now waiting behind the held rebuild, rather than racing
        // the release of its lock. Queries remain independent of that queue.
        assert_eq!(
            body(&host.request("POST", "/q/who", &headers, "{}"))["data"],
            principal
        );
        release.send(()).unwrap();
        adoption.join().unwrap();
        let written = body(&writer.join().unwrap());
        assert_eq!(written["state"], "sent", "{written}");
        let total = body(&host.request("POST", "/q/total", &headers, "{}"));
        assert_eq!(total["data"], 2, "{total}");
        assert_eq!(total["complete"], true);
        let replay = body(&host.request(
            "POST",
            "/m/add",
            &headers,
            r#"{"id":"during","args":{"id":"during"}}"#,
        ));
        assert_eq!(replay["seq"], written["seq"]);
        assert_eq!(
            body(&host.request("POST", "/q/total", &headers, "{}"))["data"],
            2
        );
    }
}

#[test]
fn process_exit_during_build_retains_the_old_generation_and_restart_rebuilds() {
    let dir = ReaderTestDirectory::new();
    let path = dir.0.join("restart.db");
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    let mut engine = Engine::new(
        snapback4_core::Store::open(&path).unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    engine
        .seed_at(
            [(
                "items".into(),
                snapback4_core::value::object([
                    ("id", snapback4_core::Value::Id("before".into())),
                    ("owner", snapback4_core::Value::Id("alice".into())),
                    ("n", snapback4_core::Value::Int(1)),
                ]),
            )],
            1,
        )
        .unwrap();
    let generation = engine.generation();
    let seq = engine.seq().unwrap();
    drop(engine);
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "serve::tests::adoption_tests::reads::crash_during_adoption_child",
            "--ignored",
        ])
        .env("SNAPBACK4_ADOPTION_CRASH_DB", &path)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(77));
    let mut engine = Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
    assert_eq!(engine.generation(), generation);
    assert_eq!(engine.seq().unwrap(), seq);
    assert!(engine.schema().table("totals").is_none());
    let b = snapback4_lang::compile(&[("schema.q".into(), format!("{SOURCE}{VIEWS}"))]);
    engine
        .adopt(b.schema, b.programs.into_iter().map(|p| p.program))
        .unwrap();
    let result = engine
        .query("total", Context::new("alice", BTreeMap::new()))
        .unwrap();
    assert!(result.complete);
    assert_eq!(result.data, snapback4_core::Value::Int(1));
}

#[test]
#[ignore = "child process for the atomic adoption restart witness"]
fn crash_during_adoption_child() {
    let path = std::path::PathBuf::from(
        std::env::var("SNAPBACK4_ADOPTION_CRASH_DB").expect("spawn through restart witness"),
    );
    let mut engine = Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
    engine
        .store()
        .conn()
        .authorizer(Some(|ctx: rusqlite::hooks::AuthContext<'_>| {
            if matches!(
                ctx.action,
                rusqlite::hooks::AuthAction::Insert { table_name: "i" }
            ) {
                std::process::exit(77);
            }
            rusqlite::hooks::Authorization::Allow
        }))
        .unwrap();
    let b = snapback4_lang::compile(&[("schema.q".into(), format!("{SOURCE}{VIEWS}"))]);
    engine
        .adopt(b.schema, b.programs.into_iter().map(|p| p.program))
        .unwrap();
    panic!("the write hook must terminate before publication");
}

#[test]
fn fresh_storage_has_independent_readers_and_is_removed_by_its_owner() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let store = fresh.store().unwrap();
    let file = std::path::PathBuf::from(store.conn().path().unwrap());
    assert!(file.exists());
    assert!(store.reader().is_ok());
    drop(store);
    drop(fresh);
    assert!(!file.exists());
}

#[test]
fn a_write_queued_behind_adoption_does_not_keep_expired_authority() {
    let dir = ReaderTestDirectory::new();
    let host = Host::with_store(
        false,
        snapback4_core::Store::open(&dir.0.join("authority.db")).unwrap(),
        SOURCE,
    );
    let session = body(&host.request("POST", "/auth/guest", "", "{}"));
    let headers = format!(
        "Authorization: Bearer {}\r\n",
        session["session"]["token"].as_str().unwrap()
    );
    let engine = lock(&host.shared.engine);
    let address = host.address;
    let writer = thread::spawn(move || {
        let payload = r#"{"id":"expired","args":{"id":"expired"}}"#;
        exchange(
            address,
            &format!(
                "POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{payload}",
                payload.len()
            ),
        )
    });
    let started = Instant::now();
    while host.shared.engine.waiting() == 0 {
        assert!(started.elapsed() < Duration::from_secs(5));
        thread::yield_now();
    }
    engine
        .store()
        .conn()
        .execute("UPDATE _sessions SET expires_at = 0", [])
        .unwrap();
    drop(engine);
    let response = writer.join().unwrap();
    assert_eq!(status(&response), 401, "{response}");
    assert_eq!(body(&response)["denied"]["code"], "E_AUTH");
    let rows: i64 = lock(&host.shared.engine)
        .store()
        .conn()
        .query_row("SELECT count(*) FROM r", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 0, "the queued mutation must not commit");
}
