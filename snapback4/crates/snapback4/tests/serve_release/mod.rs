use super::*;
use crate::release_control::Command;

fn candidate(
    dir: &std::path::Path,
    n: u64,
    source: &str,
    previous: Option<u64>,
    revision: u64,
) -> Command {
    let root = dir.join("releases").join(n.to_string());
    std::fs::create_dir_all(root.join("snapback")).unwrap();
    std::fs::write(root.join("snapback/schema.q"), source).unwrap();
    Command::Activate {
        release: n,
        expected_release: previous,
        expected_revision: revision,
        digest: crate::release_files::digest(&root).unwrap(),
        rollback: false,
        restore_dormant: true,
        allow_feed_adoption: false,
    }
}

#[test]
fn hot_release_pinned_old_read_finishes_and_unpinned_reader_is_fenced() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let (epoch, mut pinned) = {
        let engine = lock(&host.shared.engine);
        lock(&host.shared.readers).take(&engine).unwrap()
    };
    let mut unpinned = lock(&host.shared.engine).reader().unwrap();
    let (entered, waiting) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    let once = Arc::new(std::sync::atomic::AtomicBool::new(false));
    pinned
        .store()
        .conn()
        .authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
            if matches!(
                ctx.action,
                rusqlite::hooks::AuthAction::Read {
                    table_name: "_commits",
                    ..
                }
            ) && !once.swap(true, Ordering::SeqCst)
            {
                entered.send(()).unwrap();
                resumed.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            rusqlite::hooks::Authorization::Allow
        }))
        .unwrap();
    let task = thread::spawn(move || {
        let outcome = pinned.query("version", Context::new("alice", Default::default()));
        (pinned, outcome)
    });
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    let command = candidate(
        &directory.0,
        2,
        &READER_SCHEMA.replace("return 1", "return 2"),
        None,
        0,
    );
    let result = release::apply(&host.shared, &directory.0, command).unwrap();
    assert_eq!(result["generation"], 2);
    assert_eq!(
        unpinned
            .query("version", Context::new("alice", Default::default()))
            .unwrap_err()
            .code,
        "E_GENERATION"
    );
    resume.send(()).unwrap();
    let (old, outcome) = task.join().unwrap();
    assert_eq!(outcome.unwrap().data, snapback4_core::Value::Int(1));
    lock(&host.shared.readers).put(&epoch, old);
    assert!(lock(&host.shared.readers).idle.is_empty());
    let mut current = lock(&host.shared.engine).reader().unwrap();
    assert_eq!(
        current
            .query("version", Context::new("alice", Default::default()))
            .unwrap()
            .data,
        snapback4_core::Value::Int(2)
    );
}

#[test]
fn failed_hot_commit_keeps_runtime_and_retry_cleans_prepared_pointer() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let command = candidate(
        &directory.0,
        2,
        &READER_SCHEMA.replace("return 1", "return 2"),
        None,
        0,
    );
    lock(&host.shared.engine)
        .store()
        .conn()
        .commit_hook(Some(|| true))
        .unwrap();
    let failure = release::apply(&host.shared, &directory.0, command.clone()).unwrap_err();
    assert!(failure.contains("E_STORE"), "{failure}");
    {
        let engine = lock(&host.shared.engine);
        engine
            .store()
            .conn()
            .commit_hook(None::<fn() -> bool>)
            .unwrap();
        assert_eq!(engine.generation(), 1);
        assert_eq!(engine.store().meta("release").unwrap(), None);
    }
    assert_eq!(*lock(&host.shared.generation), 1);
    release::apply(&host.shared, &directory.0, command).unwrap();
    assert_eq!(*lock(&host.shared.generation), 2);
    assert_eq!(
        std::fs::read_to_string(directory.0.join("current"))
            .unwrap()
            .trim(),
        "2"
    );
}

#[test]
fn hot_release_cas_refuses_stale_aba_and_changed_artifact_digest() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let first = candidate(&directory.0, 1, READER_SCHEMA, None, 0);
    release::apply(&host.shared, &directory.0, first).unwrap();
    let stale = candidate(&directory.0, 2, READER_SCHEMA, Some(1), 1);
    let same = candidate(&directory.0, 3, READER_SCHEMA, Some(1), 1);
    release::apply(&host.shared, &directory.0, same).unwrap();
    let back = candidate(&directory.0, 1, READER_SCHEMA, Some(3), 2);
    release::apply(&host.shared, &directory.0, back).unwrap();
    let failure = release::apply(&host.shared, &directory.0, stale).unwrap_err();
    assert!(failure.contains("revision"), "{failure}");
    let changed = candidate(&directory.0, 4, READER_SCHEMA, Some(1), 3);
    std::fs::write(
        directory.0.join("releases/4/snapback/schema.q"),
        READER_SCHEMA.replace("return 1", "return 99"),
    )
    .unwrap();
    assert!(
        release::apply(&host.shared, &directory.0, changed)
            .unwrap_err()
            .contains("content changed")
    );
    assert_eq!(
        lock(&host.shared.engine)
            .store()
            .meta("release")
            .unwrap()
            .as_deref(),
        Some("1")
    );
}

#[test]
fn hot_release_discards_old_worker_preparation_before_minting() {
    for named in [false, true] {
        let directory = ReaderTestDirectory::new();
        let host = directory.host();
        let root = directory.0.join("releases/1");
        std::fs::create_dir_all(root.join("snapback/workers")).unwrap();
        std::fs::write(root.join("snapback/schema.q"), READER_SCHEMA).unwrap();
        let source = if named {
            root.join("snapback/workers/noop.mjs")
        } else {
            root.join("snapback/server.mjs")
        };
        std::fs::write(&source, "setInterval(() => {}, 1000);\n").unwrap();
        *lock(&host.shared.release_root) = Some(root.clone());
        let project = Project { root };
        let mut worker = if named {
            crate::dev_worker::DevWorker::start_named(
                &project,
                host.shared.clone(),
                format!("http://{}", host.address),
                source,
                true,
                "noop".into(),
            )
            .unwrap()
        } else {
            crate::dev_worker::DevWorker::start_source(
                &project,
                host.shared.clone(),
                format!("http://{}", host.address),
                source,
                false,
            )
            .unwrap()
        };
        let (entered, waiting) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        let resumed = Mutex::new(resumed);
        *lock(&host.shared.worker_prepare) = Some(Arc::new(move || {
            entered.send(()).unwrap();
            lock(&resumed)
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
        }));
        let task = thread::spawn(move || {
            worker.tick();
            drop(worker);
        });
        waiting.recv_timeout(Duration::from_secs(10)).unwrap();
        let newer = candidate(
            &directory.0,
            2,
            &READER_SCHEMA.replace("return 1", "return 2"),
            None,
            0,
        );
        release::apply(&host.shared, &directory.0, newer).unwrap();
        let latest = candidate(
            &directory.0,
            3,
            &READER_SCHEMA.replace("return 1", "return 3"),
            Some(2),
            1,
        );
        release::apply(&host.shared, &directory.0, latest).unwrap();
        resume.send(()).unwrap();
        task.join().unwrap();
        let engine = lock(&host.shared.engine);
        let sessions:i64=engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal IN ('service:worker','service:noop')",[],|r|r.get(0)).unwrap();
        assert_eq!(
            sessions, 0,
            "stale preparation minted a current credential; named={named}"
        );
    }
}

#[test]
fn post_commit_pointer_failure_keeps_new_runtime_and_database_recovery() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let command = candidate(
        &directory.0,
        2,
        &READER_SCHEMA.replace("return 1", "return 2"),
        None,
        0,
    );
    let (entered, waiting) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    lock(&host.shared.engine)
        .store()
        .conn()
        .commit_hook(Some(move || {
            entered.send(()).unwrap();
            resumed.recv_timeout(Duration::from_secs(10)).unwrap();
            false
        }))
        .unwrap();
    let shared = host.shared.clone();
    let dir = directory.0.clone();
    let task = thread::spawn(move || release::apply(&shared, &dir, command));
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    std::fs::create_dir(directory.0.join("current")).unwrap();
    resume.send(()).unwrap();
    let error = task.join().unwrap().unwrap_err();
    assert!(error.contains("committed in database"), "{error}");
    let engine = lock(&host.shared.engine);
    engine
        .store()
        .conn()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(engine.generation(), 2);
    assert_eq!(
        engine.store().meta("release").unwrap().as_deref(),
        Some("2")
    );
    drop(engine);
    assert_eq!(*lock(&host.shared.generation), 2);
    let mut recovered = Engine::attach_release(
        snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap(),
        2,
    )
    .unwrap();
    assert_eq!(
        recovered
            .query("version", Context::new("alice", Default::default()))
            .unwrap()
            .data,
        snapback4_core::Value::Int(2)
    );
}

#[test]
fn concurrent_release_commands_share_cas_and_queued_write_uses_committed_generation() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let row=snapback4_core::wire::row_from_json(&lock(&host.shared.engine).schema().tables["privateProducts"],&json!({"id":"a","ownerId":"alice","sku":"one","category":"c","price":1,"title":"A","revision":1})).unwrap();
    lock(&host.shared.engine)
        .seed([("privateProducts".into(), row)])
        .unwrap();
    let first = candidate(
        &directory.0,
        2,
        &READER_SCHEMA.replace("return 1", "return 2"),
        None,
        0,
    );
    let second = candidate(
        &directory.0,
        3,
        &READER_SCHEMA.replace("return 1", "return 3"),
        None,
        0,
    );
    let (entered, waiting) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    lock(&host.shared.engine)
        .store()
        .conn()
        .commit_hook(Some(move || {
            entered.send(()).unwrap();
            resumed.recv_timeout(Duration::from_secs(10)).unwrap();
            false
        }))
        .unwrap();
    let shared = host.shared.clone();
    let dir = directory.0.clone();
    let adoption = thread::spawn(move || release::apply(&shared, &dir, first));
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    let shared = host.shared.clone();
    let dir = directory.0.clone();
    let racing = thread::spawn(move || release::apply(&shared, &dir, second));
    let shared = host.shared.clone();
    let writer = thread::spawn(move || {
        let mut engine = lock(&shared.engine);
        engine
            .store()
            .conn()
            .commit_hook(None::<fn() -> bool>)
            .unwrap();
        let generation = engine.generation();
        let output = engine
            .mutate(
                "bump",
                Some("queued-write"),
                Context::new(
                    "alice",
                    std::collections::BTreeMap::from([(
                        "sku".into(),
                        snapback4_core::Value::String("one".into()),
                    )]),
                ),
            )
            .unwrap();
        (generation, output)
    });
    resume.send(()).unwrap();
    assert_eq!(adoption.join().unwrap().unwrap()["generation"], 2);
    assert!(racing.join().unwrap().unwrap_err().contains("changed"));
    let (generation, write) = writer.join().unwrap();
    assert_eq!(generation, 2);
    assert!(matches!(
        write.state,
        snapback4_core::WriteState::Sent { .. }
    ));
    assert_eq!(
        lock(&host.shared.engine)
            .store()
            .rows("privateProducts")
            .unwrap()[0]
            .field("revision")
            .unwrap(),
        &snapback4_core::Value::Int(2)
    );
}

// Runs only as the parent's owned subprocess, with the test-only publication
// barrier. No production environment flag or release-control verb exposes it.
#[test]
#[ignore = "owned crash subprocess; invoked by crash_between_commit_and_publication"]
fn crash_child_after_release_commit() {
    let Some(dir) = std::env::var_os("SB4_ROLL_CRASH_TEST_DIR") else {
        return;
    };
    let directory = ReaderTestDirectory(std::path::PathBuf::from(dir));
    let host = directory.host();
    let first = candidate(&directory.0, 1, READER_SCHEMA, None, 0);
    release::apply(&host.shared, &directory.0, first).unwrap();
    let next = READER_SCHEMA.replace("  revision: int", "  extra: int default 7\n  revision: int")
        + "table newer:\n  n: int\n  public\n";
    let second = candidate(&directory.0, 2, &next, Some(1), 1);
    release::apply(&host.shared, &directory.0, second).unwrap();
    {
        let mut engine = lock(&host.shared.engine);
        for (name, json) in [
            (
                "privateProducts",
                json!({"id":"a","ownerId":"alice","sku":"one","category":"c","price":1,"title":"kept","revision":1,"extra":88}),
            ),
            ("newer", json!({"id":"f","n":42})),
        ] {
            let row =
                snapback4_core::wire::row_from_json(&engine.schema().tables[name], &json).unwrap();
            engine.seed([(name.into(), row)]).unwrap();
        }
    }
    let root = directory.0.clone();
    *lock(&host.shared.release_committed) = Some(Arc::new(move || {
        let mut ready = std::fs::File::create(root.join("after-commit")).unwrap();
        ready.write_all(b"committed-before-publication").unwrap();
        ready.sync_all().unwrap();
        loop {
            std::thread::park();
        }
    }));
    let old = candidate(&directory.0, 1, READER_SCHEMA, Some(2), 2);
    let _ = release::apply(&host.shared, &directory.0, old);
    panic!("publication barrier returned");
}

#[test]
fn crash_between_commit_and_publication_recovers_dormant_data_from_database() {
    struct Child(std::process::Child);
    impl Drop for Child {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let directory = ReaderTestDirectory::new();
    let mut child = Child(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "serve::tests::release_lifecycle_tests::crash_child_after_release_commit",
                "--ignored",
                "--nocapture",
            ])
            .env("SB4_ROLL_CRASH_TEST_DIR", &directory.0)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    while !directory.0.join("after-commit").exists() {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "crash helper exited before commit"
        );
        assert!(
            Instant::now() < deadline,
            "crash helper did not reach publication barrier"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    assert_eq!(
        std::fs::read_to_string(directory.0.join("current"))
            .unwrap()
            .trim(),
        "2",
        "pointer copy must still name the predecessor"
    );
    let store = snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap();
    let mut engine = snapback4_core::Engine::attach_release(store, 1).unwrap();
    assert_eq!(engine.generation(), 4);
    assert!(
        engine.store().rows("privateProducts").unwrap()[0]
            .field("extra")
            .is_err()
    );
    assert_eq!(engine.store().count("newer").unwrap(), 0);
    let next = READER_SCHEMA.replace("  revision: int", "  extra: int default 7\n  revision: int")
        + "table newer:\n  n: int\n  public\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), next)]);
    engine
        .adopt_release(
            bound.schema,
            bound.programs.into_iter().map(|p| p.program),
            &snapback4_core::engine::release::ReleaseActivation::new(2, Some(1)),
            false,
        )
        .unwrap();
    assert_eq!(
        engine.store().rows("privateProducts").unwrap()[0]
            .field("extra")
            .unwrap(),
        &snapback4_core::Value::Int(88)
    );
    assert_eq!(
        engine.store().rows("newer").unwrap()[0].field("n").unwrap(),
        &snapback4_core::Value::Int(42)
    );
}

#[test]
fn following_reply_stamps_the_engine_selected_after_request_intake() {
    let directory=ReaderTestDirectory::new();let host=directory.host();
    let (entered,waiting)=mpsc::channel();
    let barrier=Arc::new((Mutex::new(false),Condvar::new()));
    let stalled=barrier.clone();
    *lock(&host.shared.request_work)=Some(Arc::new(move||{
        entered.send(()).unwrap();
        let (state,wake)=&*stalled;
        let mut ready=lock(state);
        while !*ready {ready=wake.wait(ready).unwrap();}
    }));
    let address=host.address;
    let task=thread::spawn(move||exchange(address,"POST /following/version HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 11\r\n\r\n{\"args\":{}}"));
    waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    let command=candidate(&directory.0,2,&READER_SCHEMA.replace("return 1","return 2"),None,0);
    let switched=release::apply(&host.shared,&directory.0,command).unwrap();assert_eq!(switched["generation"],2);
    *lock(&barrier.0)=true;barrier.1.notify_all();
    let reply=task.join().unwrap();
    assert_eq!(body(&reply)["generation"],2,"{reply}");
    assert!(reply.to_ascii_lowercase().contains("x-snapback-generation: 2\r\n"),"{reply}");
}

#[test]
fn action_reply_stamps_admission_after_switch_during_request_intake() {
    let directory=ReaderTestDirectory::new();let host=directory.host();
    let first=format!("use server\n{READER_SCHEMA}\naction work() returns {{ n: int }} <- allow\n");
    release::apply(&host.shared,&directory.0,candidate(&directory.0,2,&first,None,0)).unwrap();
    let (entered,waiting)=mpsc::channel();let barrier=Arc::new((Mutex::new(false),Condvar::new()));let stalled=barrier.clone();
    *lock(&host.shared.request_work)=Some(Arc::new(move||{
        entered.send(()).unwrap();let (state,wake)=&*stalled;let mut ready=lock(state);
        while !*ready {ready=wake.wait(ready).unwrap();}
    }));
    let address=host.address;let payload="{\"id\":\"intake-action\",\"args\":{\"n\":2}}";
    let wire=format!("POST /a/work?wait=0 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: {}\r\n\r\n{payload}",payload.len());
    let task=thread::spawn(move||exchange(address,&wire));waiting.recv_timeout(Duration::from_secs(10)).unwrap();
    let next=first.replace("action work()", "action work(n: int)");
    let switched=release::apply(&host.shared,&directory.0,candidate(&directory.0,3,&next,Some(2),1)).unwrap();assert_eq!(switched["generation"],3);
    *lock(&barrier.0)=true;barrier.1.notify_all();let reply=task.join().unwrap();
    assert_eq!(body(&reply)["state"],"pending","{reply}");assert_eq!(body(&reply)["generation"],3,"{reply}");
    assert!(reply.to_ascii_lowercase().contains("x-snapback-generation: 3\r\n"),"{reply}");
}
