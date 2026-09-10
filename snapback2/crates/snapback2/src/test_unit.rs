use super::test_sse::SseProbe;
use super::*;
use snapback2_core::{Ceilings, Checker, Engine, RuntimeError, Value};
use std::io::Write;
use std::net::{TcpListener, TcpStream};

#[cfg(unix)]
#[test]
fn startup_cleanup_guard_reaps_the_child_and_removes_every_test_path() {
    let root = std::env::temp_dir().join(format!(
        "snapback2-startup-cleanup-{}-{}",
        std::process::id(),
        timestamp()
    ));
    let scratch = root.join(".snapback/test-run-failed");
    let store = root.join(".snapback/test-failed.sqlite");
    fs::create_dir_all(&scratch).unwrap();
    fs::write(&store, b"test").unwrap();
    let wal = store.with_extension("sqlite-wal");
    let shm = store.with_extension("sqlite-shm");
    fs::write(&wal, b"test").unwrap();
    fs::write(&shm, b"test").unwrap();
    // @ref LLP 1002#7-test-and-the-receipt — mirror the direct owner executable.
    // Like IsolatedOwner's current_exe, launch the executable directly. A PATH
    // `node` can be a Volta shim whose Node descendant survives Child::kill.
    let child = Command::new("/bin/sleep").arg("60").spawn().unwrap();
    let pid = child.id() as i32;
    let mut cleanup = OwnerCleanup {
        child: Some(child),
        scratch: scratch.clone(),
        store: store.clone(),
    };
    assert!(
        cleanup
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none()
    );
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
    eprintln!("startup cleanup launched direct sleep PID {pid}");

    cleanup.clean();

    assert!(cleanup.child.is_none());
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1, "child {pid} survived");
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
    assert!(!scratch.exists());
    assert!(!store.exists());
    assert!(!wal.exists());
    assert!(!shm.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn isolated_owner_cleans_scratch_and_store_after_every_pre_spawn_failure() {
    let base = std::env::temp_dir().join(format!(
        "snapback2-pre-spawn-cleanup-{}-{}",
        std::process::id(),
        timestamp()
    ));
    fs::create_dir_all(&base).unwrap();
    let failure = || test_io(std::io::Error::other("injected startup failure"));

    let copy_stamp = 101;
    assert!(
        IsolatedOwner::start_with(
            &base,
            copy_stamp,
            |_target, _link| panic!("link ran after copy failure"),
            || panic!("executable lookup ran after copy failure"),
            |_executable, _project| panic!("spawn ran after copy failure"),
        )
        .is_err()
    );
    assert_test_start_paths_removed(&base, copy_stamp);

    fs::create_dir_all(base.join("snapback")).unwrap();
    let link_stamp = 102;
    assert!(
        IsolatedOwner::start_with(
            &base,
            link_stamp,
            |_target, _link| Err(failure()),
            || panic!("executable lookup ran after link failure"),
            |_executable, _project| panic!("spawn ran after link failure"),
        )
        .is_err()
    );
    assert_test_start_paths_removed(&base, link_stamp);

    let executable_stamp = 103;
    assert!(
        IsolatedOwner::start_with(
            &base,
            executable_stamp,
            link_store,
            || Err(failure()),
            |_executable, _project| panic!("spawn ran after executable failure"),
        )
        .is_err()
    );
    assert_test_start_paths_removed(&base, executable_stamp);

    let spawn_stamp = 104;
    assert!(
        IsolatedOwner::start_with(
            &base,
            spawn_stamp,
            link_store,
            || std::env::current_exe().map_err(test_io),
            |_executable, _project| Err(failure()),
        )
        .is_err()
    );
    assert_test_start_paths_removed(&base, spawn_stamp);
    let _ = fs::remove_dir_all(base);
}

fn assert_test_start_paths_removed(root: &Path, stamp: u128) {
    assert!(!root.join(format!(".snapback/test-run-{stamp}")).exists());
    assert!(!root.join(format!(".snapback/test-{stamp}.sqlite")).exists());
}

#[test]
fn generated_args_exercises_every_arg_type_variant() {
    let program = Program {
        name: "all.args".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([
            ("outboxId".to_owned(), ArgType::Id),
            (
                "todoRef".to_owned(),
                ArgType::Ref {
                    table: "todos".to_owned(),
                },
            ),
            (
                "text".to_owned(),
                ArgType::Text {
                    max: 20,
                    min: 0,
                    format: None,
                },
            ),
            (
                "term".to_owned(),
                ArgType::Text {
                    max: 3,
                    min: 3,
                    format: None,
                },
            ),
            ("bytes".to_owned(), ArgType::Bytes { max: 20 }),
            ("int".to_owned(), ArgType::Int),
            ("bool".to_owned(), ArgType::Bool),
            ("time".to_owned(), ArgType::Time),
            ("json".to_owned(), ArgType::Json { max_bytes: 100 }),
            (
                "optional".to_owned(),
                ArgType::Optional(Box::new(ArgType::Text {
                    max: 20,
                    min: 0,
                    format: None,
                })),
            ),
            (
                "list".to_owned(),
                ArgType::List {
                    of: Some(Box::new(ArgType::Int)),
                    max: 4,
                },
            ),
            (
                "enum".to_owned(),
                ArgType::Enum {
                    variants: vec!["first".to_owned(), "second".to_owned()],
                },
            ),
            ("decimal".to_owned(), ArgType::Decimal { scale: 2 }),
            (
                "money".to_owned(),
                ArgType::Money {
                    currency: "USD".to_owned(),
                    scale: 2,
                },
            ),
            ("scalar".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![snapback2_core::Stmt::Return(snapback2_core::Expr::Literal(
            Value::Null,
        ))],
    };

    let seed = SeedData {
        personas: Vec::new(),
        rows: BTreeMap::from([("todos".to_owned(), vec![json!({ "id": "todo-1" })])]),
    };
    let args = generated_args(&program, &seed).unwrap();

    assert_eq!(args.as_object().unwrap().len(), 15);
    assert_eq!(args["todoRef"], "todo-1");
    assert_eq!(args["enum"], "first");
    assert_eq!(args["list"], json!([]));
    assert_eq!(args["decimal"], 100);
    assert_eq!(args["money"], 100);
    assert_eq!(args["term"], "wel");
}

#[test]
fn rules_equality_rejects_extra_and_missing_visible_rows() {
    let expected = BTreeSet::from(["seed".to_owned()]);
    assert!(!rule_id_sets_match(
        &BTreeSet::from(["ghost".to_owned(), "seed".to_owned()]),
        &expected,
    ));
    assert!(!rule_id_sets_match(&BTreeSet::new(), &expected));
}

#[test]
fn bounds_failure_fixture_gets_e_trace_subset_from_the_engine() {
    let schema = snapback2_core::spike_schema();
    let program = snapback2_core::thread_program(10);
    let mut certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    certificate.read_sites.clear();
    let mut engine = Engine::memory(schema).unwrap();
    let context = Context::query(
        Actor::persona("alice").unwrap(),
        BTreeMap::from([(
            "conversationId".to_owned(),
            Value::Id("conversation-1".to_owned()),
        )]),
    );

    let error = engine.execute(&program, &certificate, context).unwrap_err();

    assert_eq!(error.code(), "E_TRACE_SUBSET");
    assert!(matches!(error, RuntimeError::TraceSubset(_)));
}

#[test]
fn silence_probe_rejects_a_heartbeat_followed_by_stream_close() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let heartbeat = ": heartbeat\n\n";
        write!(stream, "{:x}\r\n{}\r\n", heartbeat.len(), heartbeat).unwrap();
        stream.flush().unwrap();
    });
    let stream = TcpStream::connect(address).unwrap();
    let mut probe = SseProbe::from_stream(stream);

    let error = probe
        .prove_silence(Duration::from_millis(250))
        .expect_err("a closed stream cannot prove silence");

    assert!(
        error.message.contains("subscription ended"),
        "{}",
        error.message
    );
    assert!(error.delivery.is_none());
    server.join().unwrap();
}

#[test]
fn silence_probe_requires_an_ordered_barrier_and_rejects_an_earlier_delivery() {
    for delivered in [false, true] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let events = if delivered { vec!["probe", "z-silence"] } else { vec!["z-silence"] };
            for id in events {
                let frame = format!("data: {}\n\n", json!({ "id": id, "data": { "seq": 2 } }));
                write!(stream, "{:x}\r\n{frame}\r\n", frame.len()).unwrap();
            }
            stream.flush().unwrap();
        });
        let mut probe = SseProbe::from_stream(TcpStream::connect(address).unwrap());
        let result = probe.prove_silence(Duration::from_secs(2));
        assert_eq!(result.is_ok(), !delivered);
        if delivered { assert!(result.err().unwrap().delivery.is_some()); }
        server.join().unwrap();
    }
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the receipt's
// `schedules` block is the owner's counts verbatim, and its absence is a failed receipt.
#[test]
fn schedule_receipt_copies_the_owner_counts_and_fails_closed_without_them() {
    let fresh = || {
        TestReceipt::new(
            "g".into(),
            vec![],
            vec![CheckReceipt::pass("journey", "journey", 0, json!({}))],
        )
    };
    let mut copied = fresh();
    attach_schedule_receipt(
        &mut copied,
        Some(json!({"schedules": {"fired": 2, "late": 1, "rejected": 0}, "jobs": {}})),
    );
    assert_eq!(copied.verdict, "pass");
    assert_eq!(
        copied.schedules,
        Some(json!({"fired": 2, "late": 1, "rejected": 0}))
    );
    assert_eq!(copied.checks.len(), 1);
    for status in [
        None,
        Some(json!({"jobs": {}})),
        Some(json!({"schedules": null})),
    ] {
        let mut closed = fresh();
        attach_schedule_receipt(&mut closed, status.clone());
        assert_eq!(closed.verdict, "fail", "{status:?}");
        assert!(closed.schedules.is_none());
        let failed = closed.checks.last().unwrap();
        assert_eq!(
            (
                failed.name.as_str(),
                failed.kind.as_str(),
                failed.verdict.as_str()
            ),
            ("schedule receipt", "schedule", "fail")
        );
        assert_eq!(
            failed.detail["message"],
            "owner schedule counts unavailable"
        );
    }
}
