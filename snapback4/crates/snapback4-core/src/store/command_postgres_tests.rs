//! Real-Postgres fault fixtures live at the store boundary; commands use the shared port.
// @ref LLP 3000.009.001.000#32-the-rule — database control and fault injection stay in adapter tests.
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
        let connection =
            std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private Postgres cluster required");
        let namespace = format!("sb4_eval_queue_{:x}", crate::ids::seed());
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
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
        AnyStore::open_postgres_owned(&fixture.connection, &fixture.namespace, &winner).unwrap(),
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

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn renewal_commit_stall_expires_admission_and_queued_replies_independently() {
    let mut fixture = Fixture::new();
    let (queue, lease_pid) = fixture.queue(2);
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(8)).unwrap();
        }))
        .unwrap();
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    let queued = queue
        .submit(Command::new(|_| panic!("expired queued body ran")))
        .unwrap();
    let key = crate::ids::seed() as i64;
    fixture
        .control
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .unwrap();
    fixture.control.batch_execute(&format!("CREATE FUNCTION lease_commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock({key}); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER lease_commit_barrier AFTER UPDATE ON _owner DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lease_commit_barrier()")).unwrap();
    wait(|| {
        fixture.control.query_one("SELECT COALESCE(query='COMMIT' AND wait_event='advisory',false) FROM pg_stat_activity WHERE pid=$1", &[&lease_pid]).unwrap().get::<_,bool>(0)
    });
    let until = Instant::now() + Duration::from_secs(1);
    while !queue.ownership_lost() && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    let lost = queue.ownership_lost();
    let refused = queued.wait_timeout(Duration::from_millis(50));
    let admission = queue.call(Command::new(|_| ()));
    // Unlock the exact renewal COMMIT and the active command before assertions.
    fixture
        .control
        .query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    release.send(()).unwrap();
    held.wait().unwrap();
    assert!(lost, "watchdog waited for renewal COMMIT");
    assert_eq!(refused, Err(SubmitError::OwnershipLost));
    assert_eq!(admission, Err(SubmitError::OwnershipLost));
    drop(queue);
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn failed_queue_lease_installation_releases_the_acquired_claim() {
    let mut fixture = Fixture::new();
    let mut lease = fixture.lease("a001");
    lease.acquire().unwrap().unwrap();
    let engine = Engine::open(
        AnyStore::open_postgres_owned(&fixture.connection, &fixture.namespace, &lease).unwrap(),
    )
    .unwrap();
    let mut queue = Queue::start(engine, 1).unwrap();
    fixture.control.batch_execute("CREATE FUNCTION fail_renewal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lease_until > OLD.lease_until THEN RAISE EXCEPTION 'startup renewal fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_renewal BEFORE UPDATE ON _owner FOR EACH ROW EXECUTE FUNCTION fail_renewal()").unwrap();
    let installed = queue.hold_lease(lease, Duration::from_millis(20));
    let explicitly_released: bool = fixture.control.query_one(
        "SELECT lease_until='-infinity'::timestamptz FROM _owner WHERE singleton", &[]
    ).unwrap().get(0);
    fixture
        .control
        .batch_execute("DROP TRIGGER fail_renewal ON _owner")
        .unwrap();
    let mut standby = fixture.lease("a002");
    let acquired = standby.acquire().unwrap();
    let _ = standby.release();
    drop(queue);
    assert!(installed.is_err());
    assert!(explicitly_released, "startup guard did not release (expiry alone is insufficient)");
    assert!(
        acquired.is_some(),
        "failed installation retained an unexpired claim"
    );
}
