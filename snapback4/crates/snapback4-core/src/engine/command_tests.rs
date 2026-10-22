use super::super::committer::{Committer, Kind, Member, Pending};
use super::*;
use crate::{Schema, Store};
use std::sync::{Arc, Barrier, Mutex};

fn engine() -> Engine {
    Engine::new(Store::memory().unwrap(), Schema::default(), []).unwrap()
}

#[test]
fn queued_members_finish_continuations_on_one_worker_in_durable_order() {
    let directory = std::env::temp_dir().join(format!(
        "sb4-command-order-{}-{}",
        std::process::id(),
        crate::ids::seed()
    ));
    std::fs::create_dir(&directory).unwrap();
    let engine = Engine::new(
        Store::open(&directory.join("store.sqlite")).unwrap(),
        Schema::default(),
        [],
    )
    .unwrap();
    let queue = Arc::new(Queue::start(engine, 128).unwrap());
    let events = Arc::new(Mutex::new(Vec::new()));
    let barrier = Arc::new(Barrier::new(48));
    let caller = thread::current().id();
    let threads: Vec<_> = (0..48)
        .map(|tag| {
            let (queue, events, barrier) = (queue.clone(), events.clone(), barrier.clone());
            thread::spawn(move || {
                barrier.wait();
                queue
                    .submit(Command::new(move |engine| {
                        assert_ne!(thread::current().id(), caller);
                        let n = engine.store.time_audience_clock()?.max(0) as u64 + 1;
                        Committer::run_with(
                            engine,
                            |engine| {
                                Committer::run_pending(
                                    &mut engine.store,
                                    Member::new(Kind::Direct, |tx| {
                                        tx.pin_time_audience_clock(n as i64)?;
                                        tx.complete(Pending::new(n, tag))
                                    }),
                                )
                            },
                            |engine, tag, n| {
                                // This read observes the physical COMMIT, not a member's
                                // released savepoint. A later command cannot overtake it.
                                let reader = engine.reader()?;
                                assert_eq!(reader.store.time_audience_clock()?, n as i64);
                                events
                                    .lock()
                                    .unwrap()
                                    .push((n, tag, thread::current().id()));
                                Ok(n)
                            },
                        )
                    }))
                    .unwrap()
                    .wait()
                    .unwrap()
                    .unwrap()
            })
        })
        .collect();
    let mut replies: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    replies.sort_unstable();
    assert_eq!(replies, (1..=48).collect::<Vec<_>>());
    let events = events.lock().unwrap();
    assert_eq!(events.iter().map(|e| e.0).collect::<Vec<_>>(), replies);
    assert!(events.iter().all(|e| e.2 == events[0].2));
    drop(events);
    drop(queue);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn full_queue_refuses_without_execution_and_lost_submitter_does_not_cancel() {
    let queue = Queue::start(engine(), 1).unwrap();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv().unwrap();
        }))
        .unwrap();
    started
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let lost = queue
        .submit(Command::new(|engine| {
            Committer::run(
                &mut engine.store,
                Member::new(Kind::Direct, |tx| {
                    tx.pin_time_audience_clock(7)?;
                    tx.complete(())
                }),
            )
            .unwrap();
        }))
        .unwrap();
    assert!(matches!(
        queue.submit(Command::new(|_| panic!("refused work ran"))),
        Err(SubmitError::Full)
    ));
    drop(lost);
    release.send(()).unwrap();
    held.wait().unwrap();
    assert_eq!(
        queue
            .call(Command::new(|engine| engine.store.time_audience_clock()))
            .unwrap()
            .unwrap(),
        7
    );
}

#[test]
fn a_panicking_command_unwinds_its_transaction_without_losing_the_worker() {
    let queue = Queue::start(engine(), 1).unwrap();
    let reply = queue
        .submit(Command::new(|engine| {
            let tx = engine.store.transaction().unwrap();
            tx.pin_time_audience_clock(99).unwrap();
            panic!("body failed");
        }))
        .unwrap();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reply.wait())).is_err());
    let result = queue
        .call(Command::new(|engine| engine.store.time_audience_clock()))
        .unwrap()
        .unwrap();
    assert_eq!(result, i64::MIN);
}

#[cfg(feature = "postgres")]
#[path = "../store/command_postgres_tests.rs"]
mod postgres_tests;

#[test]
fn control_admission_has_a_deadline_and_does_not_execute_refused_work() {
    let queue = Queue::start(engine(), 1).unwrap();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
        }))
        .unwrap();
    started
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let queued = queue.submit(Command::new(|_| ())).unwrap();
    let before = std::time::Instant::now();
    let refused = queue.call(Command::new(|_| panic!("deadline-refused work ran")));
    let elapsed = before.elapsed();
    release.send(()).unwrap();
    held.wait().unwrap();
    queued.wait().unwrap();
    assert_eq!(refused, Err(SubmitError::Full));
    assert!(elapsed >= ADMISSION_TIMEOUT && elapsed < std::time::Duration::from_secs(1));
}

#[test]
fn admitted_and_started_work_delivers_real_results_beyond_the_old_deadline() {
    let queue = Queue::start(engine(), 1).unwrap();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let reply = queue.submit(Command::new(move |_| {
        entered.send(()).unwrap();
        resume.recv_timeout(std::time::Duration::from_secs(40)).unwrap();
        7
    })).unwrap();
    started.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
    let queued = queue.submit(Command::new(|_| 11)).unwrap();
    let (finished, observed) = mpsc::channel();
    let waiter = thread::spawn(move || finished.send((reply.wait(), queued.wait())).unwrap());
    let early = observed.recv_timeout(std::time::Duration::from_secs(31));
    release.send(()).unwrap();
    let result = observed.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
    waiter.join().unwrap();
    assert!(matches!(early, Err(mpsc::RecvTimeoutError::Timeout)));
    assert_eq!(result, (Ok(7), Ok(11)));
}

#[test]
fn disconnected_worker_distinguishes_not_started_from_unknown_execution() {
    let queue = Queue::start_with(1, |_| ()).unwrap();
    assert_eq!(queue.call(Command::new(|_| panic!("not started"))), Err(SubmitError::Stopped));
    // The start marker survives loss of every sender, as it would on worker death.
    let (sent, receiver) = mpsc::channel::<Result<thread::Result<()>, SubmitError>>();
    let started = Arc::new(std::sync::atomic::AtomicBool::new(true));
    drop(sent);
    assert_eq!(Reply { receiver, started }.wait(), Err(SubmitError::OutcomeUnknown));
}
