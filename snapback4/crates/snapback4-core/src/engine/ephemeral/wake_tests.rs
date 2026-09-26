use super::*;
use std::sync::{
    TryLockError,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

fn program(life: &str) -> (Schema, Vec<Program>) {
    let source = format!(
        "table typing:\n  owner: principal\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  ephemeral {life}\nmutation set():\n  upsert typing[owner = viewer] {{}}\n"
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // The language dev dependency links the library, while this is its unit
    // test build. Cross that test-only crate boundary with the ordinary IR.
    let schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let programs = bound
        .programs
        .iter()
        .map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap())
        .collect();
    (schema, programs)
}

fn paused_publish(adopt: bool) {
    let path = std::env::temp_dir().join(format!(
        "sb4-eph-wake-{}-{}",
        std::process::id(),
        crate::ids::seed()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let (schema, programs) = program("4s");
    let mut engine = Engine::new(
        Store::open(&path.join("store.sqlite")).unwrap(),
        schema,
        programs,
    )
    .unwrap();
    let mut first = engine.reader().unwrap();
    let hub = engine.ephemeral_hub();
    let wake = Arc::new(Mutex::new(None::<Snapshot>));
    let published = Arc::new(Mutex::new(Vec::new()));
    let (paused, committed) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let resume = Mutex::new(resume);
    let armed = AtomicBool::new(true);
    let weak = Arc::downgrade(&hub);
    let observed = wake.clone();
    let history = published.clone();
    hub.set_publisher(move |snapshot| {
        // A lock assertion, not a scheduling/timing guess: commit, bind and
        // clear publishers must all still own the hub before touching wake.
        assert!(matches!(
            weak.upgrade().unwrap().state.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        if snapshot.version.epoch == 1 && armed.swap(false, Ordering::SeqCst) {
            paused.send(snapshot.clone()).unwrap();
            resume
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
        }
        history.lock().unwrap().push(snapshot.version.clone());
        *observed.lock().unwrap() = Some(snapshot);
    })
    .unwrap();
    let writer = std::thread::spawn(move || {
        first
            .mutate_ephemeral("set", Context::new("alice", Default::default()).at(1000))
            .unwrap()
    });
    let at_commit = committed.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(at_commit.version.epoch, 1);
    assert_eq!(wake.lock().unwrap().as_ref().unwrap().version.epoch, 0);
    let (started, entering) = mpsc::channel();
    let competitor = std::thread::spawn(move || {
        started.send(()).unwrap();
        if adopt {
            let (schema, programs) = program("5s");
            engine.adopt_at(schema, programs, 1001).unwrap();
        } else {
            engine
                .mutate_ephemeral("set", Context::new("bob", Default::default()).at(1001))
                .unwrap();
        }
        engine
    });
    entering.recv_timeout(Duration::from_secs(10)).unwrap();
    release.send(()).unwrap();
    writer.join().unwrap();
    let engine = competitor.join().unwrap();
    let final_hub = hub.snapshot().unwrap();
    let final_wake = wake.lock().unwrap().clone().unwrap();
    assert_eq!(final_wake.version, final_hub.version);
    assert_eq!(final_wake.ring, final_hub.ring);
    let versions = published.lock().unwrap();
    assert_eq!(versions.len(), 3);
    assert_eq!(versions[1], at_commit.version);
    if adopt {
        assert_eq!(final_wake.version.epoch, 0);
        assert_ne!(
            final_wake.version.incarnation,
            at_commit.version.incarnation
        );
    } else {
        assert_eq!(final_wake.version.epoch, 2);
        assert_eq!(
            final_wake.version.incarnation,
            at_commit.version.incarnation
        );
    }
    drop(engine);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn paused_commit_publishes_before_another_commit() {
    paused_publish(false);
}

#[test]
fn paused_commit_publishes_before_adoption_rebind() {
    paused_publish(true);
}
