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
mod postgres_tests {
    use super::*;
    use crate::{
        Context, RuntimeError, Value,
        store_port::{AnyStore, LeasePolicy, StoreLease},
    };
    use postgres::{Client, NoTls};
    use std::{
        collections::BTreeMap,
        sync::atomic::Ordering,
        time::{Duration, Instant},
    };

    const SOURCE: &str = "table notes:\n  n: int\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation put(key: id, n: int):\n  upsert notes[key] { n }\n  return n\n";
    struct Fixture {
        connection: String,
        namespace: String,
        id: String,
        control: Client,
    }
    impl Fixture {
        fn new() -> Self {
            let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES")
                .expect("private Postgres cluster required");
            let namespace = format!("sb4_eval_queue_{:x}", crate::ids::seed());
            let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let schema =
                serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
            let programs: Vec<crate::Program> = bound
                .programs
                .into_iter()
                .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
                .collect();
            let bootstrap = Engine::new(
                AnyStore::create_postgres(&connection, &namespace).unwrap(),
                schema,
                programs,
            )
            .unwrap();
            let id = bootstrap.store().store_identity().unwrap().unwrap();
            drop(bootstrap);
            let mut control = Client::connect(&connection, NoTls).unwrap();
            control
                .batch_execute(&format!(
                    "SET search_path={namespace},pg_catalog; SET statement_timeout='5s'"
                ))
                .unwrap();
            Self {
                connection,
                namespace,
                id,
                control,
            }
        }
        fn lease(&self, holder: &str) -> StoreLease {
            StoreLease::connect(
                &self.connection,
                &self.namespace,
                &self.id,
                holder,
                LeasePolicy {
                    lease: Duration::from_millis(300),
                    ..Default::default()
                },
            )
            .unwrap()
        }
        fn queue(&mut self, capacity: usize) -> (Queue, i32) {
            let mut lease = self.lease("a001");
            assert_eq!(lease.acquire().unwrap().unwrap().token, 1);
            let tag = format!("sb:{}:a001:1", self.id);
            // Only the lease connection has this tag until the writer opens.
            let pid = self
                .control
                .query_one(
                    "SELECT pid FROM pg_stat_activity WHERE application_name=$1",
                    &[&tag],
                )
                .unwrap()
                .get(0);
            let engine = Engine::open(
                AnyStore::open_postgres_owned(&self.connection, &self.namespace, &lease).unwrap(),
            )
            .unwrap();
            let mut queue = Queue::start(engine, capacity).unwrap();
            queue.hold_lease(lease, Duration::from_millis(20)).unwrap();
            (queue, pid)
        }
        fn barrier(&mut self) -> i64 {
            let key = crate::ids::seed() as i64;
            self.control
                .query_one("SELECT pg_advisory_lock($1)", &[&key])
                .unwrap();
            self.control.batch_execute(&format!("CREATE FUNCTION commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('statement_timeout') <> '0' OR current_setting('lock_timeout') <> '0' THEN RAISE EXCEPTION 'COMMIT must disable both timeouts'; END IF; PERFORM pg_advisory_xact_lock({key}); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER commit_barrier AFTER INSERT OR UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commit_barrier()")).unwrap();
            key
        }
        fn committing(&mut self) -> Option<i32> {
            self.control.query_opt("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query='COMMIT' AND wait_event='advisory'", &[&format!("sb:{}:a001:1", self.id)]).unwrap().map(|r| r.get(0))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.control
                .batch_execute(&format!("DROP SCHEMA {} CASCADE", self.namespace))
                .unwrap();
        }
    }
    fn wait(mut condition: impl FnMut() -> bool) {
        let until = Instant::now() + Duration::from_secs(8);
        while !condition() {
            assert!(Instant::now() < until, "queue witness rendezvous timed out");
            thread::sleep(Duration::from_millis(5));
        }
    }
    fn put(engine: &mut Engine, id: &str) -> Result<crate::engine::MutationOutcome, RuntimeError> {
        engine.mutate(
            "put",
            Some(id),
            Context::new(
                "alice",
                BTreeMap::from([
                    ("key".into(), Value::Id(id.into())),
                    ("n".into(), Value::Int(7)),
                ]),
            ),
        )
    }

    #[test]
    #[ignore = "private Postgres; scripts/test-postgres.sh"]
    fn ownership_loss_refuses_every_queued_command_and_new_admission() {
        let mut fixture = Fixture::new();
        let (queue, lease_pid) = fixture.queue(16);
        let queue = Arc::new(queue);
        let (entered, started) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let held = queue
            .submit(Command::new(move |_| {
                entered.send(()).unwrap();
                resume.recv_timeout(Duration::from_secs(10)).unwrap();
            }))
            .unwrap();
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        let ran = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let replies: Vec<_> = (0..16)
            .map(|i| {
                let ran = ran.clone();
                queue
                    .submit(Command::new(move |engine| {
                        ran.fetch_add(1, Ordering::SeqCst);
                        put(engine, &format!("queued-{i}"))
                    }))
                    .unwrap()
            })
            .collect();
        let (called, call_result) = mpsc::channel();
        let calling = queue.clone();
        let caller = thread::spawn(move || {
            called.send(calling.call(Command::new(|_| ()))).unwrap();
        });
        wait(|| queue.admission.lock().unwrap().waiting.len() == 17);
        assert!(
            fixture
                .control
                .query_one("SELECT pg_terminate_backend($1)", &[&lease_pid])
                .unwrap()
                .get::<_, bool>(0)
        );
        wait(|| queue.ownership_lost());
        let mut winner = fixture.lease("a002");
        let mut token = None;
        wait(|| {
            token = winner.acquire().unwrap().map(|won| won.token);
            token.is_some()
        });
        assert_eq!(token, Some(2));
        assert!(matches!(
            queue.submit(Command::new(|_| ())),
            Err(SubmitError::OwnershipLost)
        ));
        assert_eq!(
            queue.call(Command::new(|_| ())),
            Err(SubmitError::OwnershipLost)
        );
        let (sent, received) = mpsc::channel();
        let waiters: Vec<_> = replies
            .into_iter()
            .map(|reply| {
                let sent = sent.clone();
                thread::spawn(move || {
                    sent.send(reply.wait().map(|_| ())).unwrap();
                })
            })
            .collect();
        for _ in 0..16 {
            assert_eq!(
                received.recv_timeout(Duration::from_secs(5)).unwrap(),
                Err(SubmitError::OwnershipLost)
            );
        }
        for waiter in waiters {
            waiter.join().unwrap();
        }
        assert_eq!(
            call_result.recv_timeout(Duration::from_secs(5)).unwrap(),
            Err(SubmitError::OwnershipLost)
        );
        caller.join().unwrap();
        // All queued and capacity-blocked callers returned while the active
        // command is still parked. Its own eventual result remains untouched.
        release.send(()).unwrap();
        held.wait().unwrap();
        assert_eq!(ran.load(Ordering::SeqCst), 0);
        drop(queue);
        let reopened = Engine::open(
            AnyStore::open_postgres_owned(&fixture.connection, &fixture.namespace, &winner)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(reopened.seq().unwrap(), 0);
        assert_eq!(reopened.store().applied_ops().unwrap(), 0);
        assert_eq!(reopened.store().count("notes").unwrap(), 0);
        drop(reopened);
        assert!(winner.release().unwrap());
    }

    #[test]
    #[ignore = "private Postgres; scripts/test-postgres.sh"]
    fn renewal_bypasses_a_busy_queue_and_uncancellable_commit() {
        let mut fixture = Fixture::new();
        let (queue, _) = fixture.queue(1);
        let key = fixture.barrier();
        let before: String = fixture
            .control
            .query_one("SELECT lease_until::text FROM _owner", &[])
            .unwrap()
            .get(0);
        let first = queue
            .submit(Command::new(|engine| put(engine, "first")))
            .unwrap();
        wait(|| fixture.committing().is_some());
        let second = queue
            .submit(Command::new(|engine| put(engine, "second")))
            .unwrap();
        assert!(matches!(
            queue.submit(Command::new(|_| ())),
            Err(SubmitError::Full)
        ));
        // Observe database time beyond the original lease while COMMIT remains
        // blocked and the mailbox is full. Renewal must have extended it.
        wait(|| {
            fixture.control.query_one("SELECT clock_timestamp()>$1::text::timestamptz AND lease_until>clock_timestamp() FROM _owner", &[&before]).unwrap().get(0)
        });
        assert!(fixture.committing().is_some());
        let mut standby = fixture.lease("a002");
        assert!(standby.acquire().unwrap().is_none());
        assert!(!queue.ownership_lost());
        fixture
            .control
            .query_one("SELECT pg_advisory_unlock($1)", &[&key])
            .unwrap();
        assert!(matches!(
            first.wait().unwrap().unwrap().state,
            crate::engine::WriteState::Sent { seq: 1, .. }
        ));
        assert!(matches!(
            second.wait().unwrap().unwrap().state,
            crate::engine::WriteState::Sent { seq: 2, .. }
        ));
        assert_eq!(
            queue
                .call(Command::new(|engine| engine.store().applied_ops()))
                .unwrap()
                .unwrap(),
            2
        );
        drop(queue);
        assert_eq!(
            standby.acquire().unwrap().unwrap().token,
            2,
            "release follows queue drain"
        );
        assert!(standby.release().unwrap());
    }

    #[test]
    #[ignore = "private Postgres; scripts/test-postgres.sh"]
    fn commit_outcome_unknown_reaches_the_queued_submitter_unchanged() {
        let mut fixture = Fixture::new();
        let (queue, _) = fixture.queue(1);
        let key = fixture.barrier();
        let reply = queue
            .submit(Command::new(|engine| put(engine, "unknown")))
            .unwrap();
        let mut pid = None;
        wait(|| {
            pid = fixture.committing();
            pid.is_some()
        });
        assert!(
            fixture
                .control
                .query_one("SELECT pg_terminate_backend($1)", &[&pid.unwrap()])
                .unwrap()
                .get::<_, bool>(0)
        );
        let error = reply.wait().unwrap().unwrap_err();
        assert!(
            matches!(error, RuntimeError::CommitOutcomeUnknown(_)),
            "{error:?}"
        );
        assert_eq!(error.code(), "E_COMMIT_OUTCOME_UNKNOWN");
        assert!(!error.is_refusal());
        assert!(!error.refusal().retryable);
        fixture
            .control
            .query_one("SELECT pg_advisory_unlock($1)", &[&key])
            .unwrap();
        drop(queue);
        assert_eq!(
            fixture
                .control
                .query_one("SELECT seq FROM _head WHERE singleton", &[])
                .unwrap()
                .get::<_, i64>(0),
            0
        );
    }
}
