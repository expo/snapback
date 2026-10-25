//! Real-cluster witnesses for the production store-level ownership adapter.
// @ref LLP 3000.009.001.000#5.2 — W11 claim ordering, bounded blockers and ambiguous COMMIT.
use super::test_hooks::Point;
use super::*;
use crate::{Context, Engine, Value, store_port::AnyStore};
use std::{collections::BTreeMap, sync::mpsc, time::Instant};

fn connection() -> String {
    std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private Postgres cluster required")
}
fn name() -> String {
    format!("sb4_eval_owner_{:x}", crate::ids::seed())
}
fn client(namespace: &str) -> Client {
    let mut c = Client::connect(&connection(), NoTls).unwrap();
    c.batch_execute(&format!(
        "SET search_path={},pg_catalog; SET statement_timeout='5s'",
        store::namespace(namespace).unwrap()
    ))
    .unwrap();
    c
}
fn create(namespace: &str) -> String {
    let b = snapback4_lang::compile(&[(
        "schema.q".into(),
        super::super::tests::unified::SOURCE.into(),
    )]);
    assert!(b.diagnostics.is_empty());
    let schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let e = Engine::new_at(
        AnyStore::create_postgres(&connection(), namespace).unwrap(),
        schema,
        programs,
        1000,
    )
    .unwrap();
    e.store().store_identity().unwrap().unwrap()
}
fn policy() -> LeasePolicy {
    LeasePolicy {
        lease: Duration::from_millis(300),
        ..Default::default()
    }
}
fn lease(namespace: &str, id: &str, holder: &str) -> StoreLease {
    StoreLease::connect(&connection(), namespace, id, holder, policy()).unwrap()
}
fn open(namespace: &str, lease: &StoreLease) -> Engine {
    Engine::open_at(
        AnyStore::open_postgres_owned(&connection(), namespace, lease).unwrap(),
        1000,
    )
    .unwrap()
}
fn context(n: i64) -> Context {
    Context::new(
        "alice",
        BTreeMap::from([
            ("key".into(), Value::Id("n1".into())),
            ("n".into(), Value::Int(n)),
        ]),
    )
    .at(1000)
}
fn wait(mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(8);
    while !ready() {
        assert!(
            Instant::now() < until,
            "observable witness rendezvous timed out"
        );
        thread::sleep(Duration::from_millis(5));
    }
}
fn expired(namespace: &str) {
    let mut c = client(namespace);
    wait(|| {
        c.query_one(
            "SELECT lease_until<clock_timestamp() FROM _owner WHERE singleton",
            &[],
        )
        .unwrap()
        .get(0)
    });
}

fn pid(c: &mut Client) -> i32 {
    c.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0)
}
fn blocked_on(c: &mut Client, waiter: i32, holder: i32) -> bool {
    c.query_one(
        "SELECT $2::int=ANY(pg_blocking_pids($1))",
        &[&waiter, &holder],
    )
    .unwrap()
    .get(0)
}
fn pause_at(point: Point, ready: mpsc::Sender<()>, resume: mpsc::Receiver<()>) {
    test_hooks::set(point, move || {
        ready.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(8)).unwrap();
    });
}

// Ordered EXECUTE hides source text; compare the actual advisory lock identity.
fn bootstrap_waiting_on(observer: &mut Client, holder: i32) -> bool {
    observer.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks w ON w.pid=a.pid JOIN pg_locks h ON h.pid=$1 AND h.granted AND h.locktype='advisory' AND (w.database,w.classid,w.objid,w.objsubid) IS NOT DISTINCT FROM (h.database,h.classid,h.objid,h.objsubid) WHERE a.wait_event='advisory' AND w.locktype='advisory' AND NOT w.granted AND w.mode='ExclusiveLock' AND $1=ANY(pg_blocking_pids(a.pid)))",&[&holder]).unwrap().get(0)
}

#[test]
fn tags_retain_the_complete_token_and_bound_termination() {
    let id = "0123456789abcdef0123456789abcdef";
    let tag = Fence {
        store_id: id.into(),
        holder: "abcd".into(),
        token: i64::MAX,
    }
    .tag()
    .unwrap();
    assert!(tag.len() <= 63);
    assert_eq!(tag_token(&tag, id), Some(i64::MAX));
    for bad in [
        format!("{tag}:extra"),
        format!("sb:{id}:abcd:-1"),
        format!("sb:{id}:abcd:9223372036854775808"),
    ] {
        assert_eq!(tag_token(&bad, id), None);
    }
    assert!(
        Fence {
            store_id: id.into(),
            holder: "long-holder".into(),
            token: 1
        }
        .tag()
        .is_err()
    );
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn legacy_attach_bootstrap_is_atomic_and_serializes_racing_openers() {
    let ns = name();
    let id = create(&ns);
    let mut control = client(&ns);
    control.batch_execute("DROP TABLE _owner").unwrap();
    assert!(
        Engine::attach_release(AnyStore::open_postgres(&connection(), &ns).unwrap(), 9).is_err()
    );
    assert!(
        !control
            .query_one("SELECT to_regclass('_owner') IS NOT NULL", &[])
            .unwrap()
            .get::<_, bool>(0)
    );
    let (ready_tx, ready) = mpsc::channel();
    let (resume, resume_rx) = mpsc::channel();
    let other_ns = ns.clone();
    let first = thread::spawn(move || {
        pause_at(Point::AfterBootstrapLock, ready_tx, resume_rx);
        Engine::open_at(
            AnyStore::open_postgres(&connection(), &other_ns).unwrap(),
            1000,
        )
        .unwrap()
    });
    ready.recv_timeout(Duration::from_secs(8)).unwrap();
    // The first opener owns the actual bootstrap lock, before owner DDL.
    let holder: i32 = control.query_one("SELECT pid FROM pg_stat_activity a WHERE application_name=$1 AND state='idle in transaction' AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND locktype='advisory' AND mode='ExclusiveLock' AND granted)", &[&format!("sb:{id}:0000:0")]).unwrap().get(0);
    let other_ns = ns.clone();
    let second = thread::spawn(move || {
        Engine::open_at(
            AnyStore::open_postgres(&connection(), &other_ns).unwrap(),
            1000,
        )
        .unwrap()
    });
    wait(|| {
        bootstrap_waiting_on(&mut control,holder)
    });
    resume.send(()).unwrap();
    let mut e = first.join().unwrap();
    drop(second.join().unwrap());
    let row = control
        .query_one("SELECT store_id,token FROM _owner WHERE singleton", &[])
        .unwrap();
    assert_eq!(row.get::<_, String>(0), id);
    assert_eq!(row.get::<_, i64>(1), 0);
    e.mutate("put", Some("after-upgrade"), context(1)).unwrap();
    drop(e);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    control.batch_execute("DROP TABLE _owner").unwrap();
    assert_eq!(
        AnyStore::open_postgres_owned(&connection(), &ns, &a)
            .err()
            .unwrap()
            .code(),
        "E_STORE_OWNERSHIP"
    );
    assert!(
        !control
            .query_one("SELECT to_regclass('_owner') IS NOT NULL", &[])
            .unwrap()
            .get::<_, bool>(0)
    );
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn two_owners_stale_token_refuses_without_a_receipt() {
    let ns = name();
    let id = create(&ns);
    // This is a fencing/replay witness, not a startup-speed bound. Keep the
    // lease live through cold opening and mutation setup under concurrent load;
    // explicit release below remains the only handoff trigger.
    let live = LeasePolicy { lease: Duration::from_secs(30), ..policy() };
    let mut a = StoreLease::connect(&connection(), &ns, &id, "0001", live.clone()).unwrap();
    assert_eq!(a.acquire().unwrap().unwrap().token, 1);
    let mut e = open(&ns, &a);
    let before = e.mutate_acknowledged("put", Some("before"), context(1)).unwrap();
    let carried = before.publication.unwrap();
    assert_eq!(carried.head, e.seq().unwrap());
    assert_eq!(Some(carried.store_id), e.store().store_identity().unwrap());
    // Keep a stale connection alive past hygiene to prove the fence itself,
    // independently of connection termination. Retagging is fault injection.
    e.store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute("SET application_name='s10d2-stale-fence-witness'")
        .unwrap();
    let mut b = StoreLease::connect(&connection(), &ns, &id, "0002", live).unwrap();
    assert!(b.acquire().unwrap().is_none());
    assert!(a.release().unwrap());
    let won = b.acquire().unwrap().unwrap();
    assert_eq!(won.token, 2);
    assert_eq!(
        e.mutate_acknowledged("put", Some("stale"), context(99))
            .unwrap_err()
            .code(),
        "E_STORE_OWNERSHIP"
    );
    // Ownership loss cannot reuse the previous write's publication facts.
    // The unfenced historical replay still works and deliberately carries none.
    let replay = e.mutate_acknowledged("put", Some("before"), context(1)).unwrap();
    assert!(replay.outcome.replayed);
    assert!(replay.publication.is_none());
    drop(e);
    // Simulate an old owner's reconnect with its retained token, independent
    // of the post-takeover hygiene that closed its earlier connections.
    a.held = true;
    let error = AnyStore::open_postgres_owned(&connection(), &ns, &a)
        .err()
        .unwrap();
    assert_eq!(error.code(), "E_STORE_OWNERSHIP");
    assert!(error.is_refusal());
    // Reconnect the old lease traffic after hygiene closed its old session.
    a.client = client(&ns);
    assert!(!a.renew().unwrap());
    assert!(!a.release().unwrap());
    let mut e = open(&ns, &b);
    assert_eq!(e.store().seq().unwrap(), 1);
    assert_eq!(e.store().applied_ops().unwrap(), 1);
    e.mutate("put", Some("after"), context(2)).unwrap();
    assert_eq!(e.store().seq().unwrap(), 2);
    let mut reader = e.reader().unwrap();
    let mut ctx = context(0);
    ctx.args.remove("n");
    assert_eq!(
        reader.query("peek", ctx).unwrap().data.field("n").unwrap(),
        &Value::Int(2)
    );
    assert!(b.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn renewal_between_poll_and_claim_terminates_nothing() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let tx = e.store_mut().transaction().unwrap();
    let mut standby = lease(&ns, &id, "0002");
    expired(&ns);
    let (back, renewed) = mpsc::channel();
    test_hooks::set(Point::AfterPoll, move || {
        assert!(a.renew().unwrap());
        back.send(a).unwrap();
    });
    test_hooks::set(Point::AfterClaim, || {
        panic!("renewed claim must match zero rows")
    });
    test_hooks::set(Point::BeforeWatch, || {
        panic!("zero-row claim must not signal")
    });
    assert!(standby.acquire().unwrap().is_none());
    let mut a = renewed.recv_timeout(Duration::from_secs(8)).unwrap();
    tx.commit().unwrap();
    assert!(a.renew().unwrap());
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn two_standbys_race_loser_kills_no_winner_sessions() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    a.release().unwrap();
    let mut b = lease(&ns, &id, "0002");
    let mut c = lease(&ns, &id, "0003");
    b.policy.lease = Duration::from_secs(3);
    c.policy.claim_timeout = Duration::from_secs(4);
    let bp = pid(&mut b.client);
    let cp = pid(&mut c.client);
    let (ready_tx, ready) = mpsc::channel();
    let (resume, resume_rx) = mpsc::channel();
    let winner = thread::spawn(move || {
        pause_at(Point::AfterClaim, ready_tx, resume_rx);
        let won = b.acquire().unwrap().unwrap();
        (b, won)
    });
    ready.recv_timeout(Duration::from_secs(8)).unwrap();
    let loser = thread::spawn(move || {
        test_hooks::set(Point::BeforeWatch, || {
            panic!("loser must never start termination")
        });
        assert!(c.acquire().unwrap().is_none());
        c
    });
    let mut observer = client(&ns);
    wait(|| blocked_on(&mut observer, cp, bp));
    resume.send(()).unwrap();
    let (mut b, won) = winner.join().unwrap();
    let mut c = loser.join().unwrap();
    assert_eq!(won.token, 2);
    assert_eq!(pid(&mut b.client), bp);
    assert_eq!(pid(&mut c.client), cp);
    assert!(b.renew().unwrap());
    let mut e = open(&ns, &b);
    e.mutate("put", Some("winner"), context(3)).unwrap();
    assert_eq!(e.store().seq().unwrap(), 1);
    assert!(b.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn fenced_transaction_outlives_lease_with_independent_renewal() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let tx = e.store_mut().transaction().unwrap();
    crate::rows::Rows::set_sequence(&tx, "lease-witness", "durable", 7).unwrap();
    let mut standby = lease(&ns, &id, "0002");
    let start = Instant::now();
    for _ in 0..8 {
        thread::sleep(Duration::from_millis(60));
        assert!(a.renew().unwrap());
        assert!(standby.acquire().unwrap().is_none());
    }
    assert!(start.elapsed() > a.policy.lease);
    tx.commit().unwrap();
    let read = e.store_mut().read_transaction().unwrap();
    assert_eq!(
        crate::rows::Rows::sequence_value(&read, "lease-witness", "durable").unwrap(),
        7
    );
    read.rollback().unwrap();
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn claim_terminates_only_token_bounded_blockers() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let tx = e.store_mut().transaction().unwrap();
    let pid: i32 =
        tx.with_postgres(|tx| tx.query("SELECT pg_backend_pid()", &[]).unwrap()[0].get(0));
    let mut observer = client(&ns);
    observer
        .execute(
            "SELECT set_config('application_name',$1,false)",
            &[&format!("sb:{id}:ffff:99")],
        )
        .unwrap();
    let mut b = lease(&ns, &id, "0002");
    expired(&ns);
    let won = b.acquire().unwrap().unwrap();
    assert_eq!(won.token, 2);
    assert!(won.terminated.contains(&pid));
    assert!(tx.commit().is_err());
    assert_eq!(
        observer
            .query_one("SELECT 1", &[])
            .unwrap()
            .get::<_, i32>(0),
        1
    );
    assert!(b.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn owner_fence_precedes_the_head_lock() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let mut control = client(&ns);
    let facts=control.query_one("SELECT pg_backend_pid(), '_head'::regclass::oid",&[]).unwrap();
    let holder:i32=facts.get(0);let head:u32=facts.get(1);
    let mut held = control.transaction().unwrap();
    held.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])
        .unwrap();
    let worker = thread::spawn(move || e.mutate("put", Some("blocked"), context(1)));
    let mut observer = client(&ns);
    wait(|| {
        observer.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE application_name=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid)) AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND relation=$3 AND mode='RowShareLock' AND granted))",&[&a.fence.tag().unwrap(),&holder,&head]).unwrap().get(0)
    });
    let error = held
        .query_one(
            "SELECT token FROM _owner WHERE singleton FOR UPDATE NOWAIT",
            &[],
        )
        .unwrap_err();
    assert_eq!(error.code(), Some(&SqlState::LOCK_NOT_AVAILABLE));
    held.rollback().unwrap();
    worker.join().unwrap().unwrap();
    assert!(a.release().unwrap());
}

#[test]
fn lease_policy_keeps_a_margin_below_the_statement_timeout() {
    assert!(LeasePolicy::default().validate().is_ok());
    for duration in [Duration::from_millis(4001), Duration::from_secs(5)] {
        let mut p = policy();
        p.fence_timeout = duration;
        assert_eq!(p.validate().unwrap_err().code(), "E_STORE_OWNERSHIP");
        p = policy();
        p.claim_timeout = duration;
        assert_eq!(p.validate().unwrap_err().code(), "E_STORE_OWNERSHIP");
    }
    let p = LeasePolicy {
        fence_timeout: Duration::from_secs(4),
        claim_timeout: Duration::from_secs(4),
        ..policy()
    };
    assert!(p.validate().is_ok());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn mixed_blockers_abort_before_signalling_any_eligible_session() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let tx = e.store_mut().transaction().unwrap();
    crate::rows::Rows::set_sequence(&tx, "mixed", "survives", 17).unwrap();
    let eligible = tx
        .with_postgres(|tx| tx.query("SELECT pg_backend_pid()", &[]).unwrap()[0].get::<_, i32>(0));
    let mut foreign = client(&ns);
    let ineligible = pid(&mut foreign);
    let mut foreign_tx = foreign.transaction().unwrap();
    foreign_tx
        .query_one(
            "SELECT token FROM _owner WHERE singleton FOR KEY SHARE",
            &[],
        )
        .unwrap();
    // Row multixact waits may expose one key-share holder at a time. Use a
    // real shared-advisory wait to expose both members in one blocking set,
    // while retaining the same expired-owner conditional claim and fences.
    let key = crate::ids::seed() as i64;
    tx.with_postgres(|tx| {
        tx.query("SELECT pg_advisory_xact_lock_shared($1)", &[&key])
            .unwrap()
    });
    foreign_tx
        .query_one("SELECT pg_advisory_xact_lock_shared($1)", &[&key])
        .unwrap();
    let mut claimant = client(&ns);
    let bp = pid(&mut claimant);
    expired(&ns);
    let worker = thread::spawn(move || {
        let mut claim = claimant.transaction().unwrap();
        assert_eq!(claim.execute("UPDATE _owner SET lease_until=lease_until WHERE singleton AND token=1 AND lease_until<clock_timestamp()", &[]).unwrap(), 1);
        claim
            .query_one("SELECT pg_advisory_xact_lock($1)", &[&key])
            .unwrap();
        claim.rollback().unwrap();
    });
    let mut observer = client(&ns);
    wait(|| blocked_on(&mut observer, bp, eligible) && blocked_on(&mut observer, bp, ineligible));
    let error = terminate(&mut observer, Some(bp), &id, 1).unwrap_err();
    assert_eq!(error.code(), "E_STORE_OWNERSHIP");
    // Both blockers, including the tagged backend's in-flight durable write,
    // survive the failed takeover. No partial kill is hidden by rollback.
    foreign_tx.query_one("SELECT 1", &[]).unwrap();
    foreign_tx.commit().unwrap();
    tx.commit().unwrap();
    worker.join().unwrap();
    let read = e.store_mut().read_transaction().unwrap();
    assert_eq!(
        crate::rows::Rows::sequence_value(&read, "mixed", "survives").unwrap(),
        17
    );
    read.rollback().unwrap();
    assert_eq!(
        observer
            .query_one("SELECT token FROM _owner WHERE singleton", &[])
            .unwrap()
            .get::<_, i64>(0),
        1
    );
    assert!(a.renew().unwrap());
    a.release().unwrap();
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn fence_retry_retains_claim_and_blocks_renewal_across_savepoint_rollback() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let tx = e.store_mut().transaction().unwrap();
    let victim = tx
        .with_postgres(|tx| tx.query("SELECT pg_backend_pid()", &[]).unwrap()[0].get::<_, i32>(0));
    // Keep renewal observable after post-commit hygiene as well as before it.
    a.client
        .batch_execute("SET application_name='retry-renewal-witness'")
        .unwrap();
    let ap = pid(&mut a.client);
    let mut b = lease(&ns, &id, "0002");
    b.policy.fence_timeout = Duration::from_secs(1);
    // A 1 s fence wait must reach 55P03 even when the session's inherited
    // statement timeout is only 20 ms: the claimed phase disables it.
    b.client
        .batch_execute("SET statement_timeout='20ms'")
        .unwrap();
    let bp = pid(&mut b.client);
    expired(&ns);
    let (watch_tx, watch_ready) = mpsc::channel();
    let (watch_resume, watch_rx) = mpsc::channel();
    let (retry_tx, retry_ready) = mpsc::channel();
    let (retry_resume, retry_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        pause_at(Point::BeforeWatch, watch_tx, watch_rx);
        pause_at(Point::AfterFenceRollback, retry_tx, retry_rx);
        let won = b.acquire().unwrap().unwrap();
        (b, won)
    });
    watch_ready.recv_timeout(Duration::from_secs(8)).unwrap();
    let mut observer = client(&ns);
    wait(|| blocked_on(&mut observer, bp, victim));
    let renewal = thread::spawn(move || {
        let renewed = a.renew().unwrap();
        (a, renewed)
    });
    wait(|| blocked_on(&mut observer, ap, bp));
    // This hook runs only after the real fence wait returned 55P03 and the
    // actual ROLLBACK TO + RELEASE completed. Renewal must still be blocked.
    retry_ready.recv_timeout(Duration::from_secs(8)).unwrap();
    assert!(blocked_on(&mut observer, ap, bp));
    retry_resume.send(()).unwrap();
    wait(|| blocked_on(&mut observer, bp, victim));
    watch_resume.send(()).unwrap();
    let (mut b, won) = worker.join().unwrap();
    assert_eq!(won.token, 2);
    assert!(won.terminated.contains(&victim));
    assert!(tx.commit().is_err());
    let (_, renewed) = renewal.join().unwrap();
    assert!(!renewed);
    assert!(b.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn statement_cancel_during_conditional_claim_terminates_nothing() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let tx = e.store_mut().transaction().unwrap();
    let mut b = lease(&ns, &id, "0002");
    expired(&ns);
    // Inject after shape validation: a slow conditional UPDATE times out
    // before a watcher can exist. Neither the lease nor writer may be killed.
    let mut control = client(&ns);
    control.batch_execute("CREATE FUNCTION slow_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END $$; CREATE TRIGGER slow_claim BEFORE UPDATE ON _owner FOR EACH ROW EXECUTE FUNCTION slow_claim()").unwrap();
    b.client
        .batch_execute("SET statement_timeout='20ms'")
        .unwrap();
    test_hooks::set(Point::BeforeWatch, || {
        panic!("cancelled claim must not signal")
    });
    assert!(b.acquire().unwrap().is_none());
    tx.commit().unwrap();
    control
        .batch_execute("DROP TRIGGER slow_claim ON _owner; DROP FUNCTION slow_claim()")
        .unwrap();
    assert!(a.renew().unwrap());
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn evaluator_refuses_a_unified_owners_namespace() {
    let ns = name();
    let id = create(&ns);
    // Namespace separation also closes an evaluator opened before token 1.
    let error = super::super::PostgresEngine::open(client(&ns), &ns)
        .err()
        .unwrap();
    assert_eq!(error.code(), "E_STORE_OWNERSHIP");
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let error = super::super::PostgresEngine::open(client(&ns), &ns)
        .err()
        .unwrap();
    assert_eq!(error.code(), "E_STORE_OWNERSHIP");
    assert_eq!(open(&ns, &a).store().seq().unwrap(), 0);
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn evaluator_lifetime_guard_blocks_legacy_adoption() {
    let ns = name();
    let id = create(&ns);
    let mut observer = client(&ns);
    observer.batch_execute("DROP TABLE _owner").unwrap();
    let mut evaluator = super::super::PostgresEngine::open(client(&ns), &ns).unwrap();
    evaluator.set_write_mode(super::super::WriteMode::Serializable);
    let ep = pid(&mut evaluator.store.client);
    let other_ns = ns.clone();
    let opener = thread::spawn(move || {
        Engine::open_at(
            AnyStore::open_postgres(&connection(), &other_ns).unwrap(),
            1000,
        )
        .unwrap()
    });
    wait(|| {
        bootstrap_waiting_on(&mut observer,ep)
    });
    assert!(
        !observer
            .query_one("SELECT to_regclass('_owner') IS NOT NULL", &[])
            .unwrap()
            .get::<_, bool>(0)
    );
    evaluator
        .mutate("put", Some("before-adoption"), context(5))
        .unwrap();
    drop(evaluator);
    assert_eq!(opener.join().unwrap().store().seq().unwrap(), 1);
    let mut a = lease(&ns, &id, "0001");
    assert_eq!(a.acquire().unwrap().unwrap().token, 1);
    assert_eq!(
        super::super::PostgresEngine::open(client(&ns), &ns)
            .err()
            .unwrap()
            .code(),
        "E_STORE_OWNERSHIP"
    );
    a.release().unwrap();
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn commit_connection_loss_is_unknown_and_propagates_through_engine() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let mut control = client(&ns);
    let key = crate::ids::seed() as i64;
    control
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .unwrap();
    control.batch_execute(&format!("CREATE FUNCTION commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock({key}); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER commit_barrier AFTER INSERT OR UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commit_barrier();")).unwrap();
    let worker = thread::spawn(move || e.mutate_acknowledged("put", Some("unknown"), context(7)));
    let tag = a.fence.tag().unwrap();
    let mut observer = client(&ns);
    let mut pid = None;
    wait(|| {
        pid=observer.query_opt("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query='COMMIT' AND wait_event='advisory'",&[&tag]).unwrap().map(|r|r.get::<_,i32>(0));
        pid.is_some()
    });
    observer
        .query_one("SELECT pg_terminate_backend($1)", &[&pid.unwrap()])
        .unwrap();
    let error = worker.join().unwrap().unwrap_err();
    assert!(
        matches!(error, RuntimeError::CommitOutcomeUnknown(_)),
        "{error:?}"
    );
    assert!(!error.is_refusal());
    assert!(!error.refusal().retryable);
    control
        .query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    control
        .batch_execute("DROP TRIGGER commit_barrier ON r; DROP FUNCTION commit_barrier()")
        .unwrap();
    let e = open(&ns, &a);
    assert_eq!(e.store().applied_ops().unwrap(), 0);
    assert_eq!(e.store().seq().unwrap(), 0);
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn commit_disables_statement_timeout() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let mut control = client(&ns);
    control.batch_execute("CREATE FUNCTION commit_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('statement_timeout') <> '0' OR current_setting('lock_timeout') <> '0' THEN RAISE EXCEPTION 'commit timeout remained enabled'; END IF; PERFORM pg_sleep(0.08); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER commit_slow AFTER INSERT OR UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commit_slow();").unwrap();
    e.store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute("SET statement_timeout='30ms'")
        .unwrap();
    let now = Instant::now();
    e.mutate("put", Some("slow"), context(1)).unwrap();
    assert!(now.elapsed() >= Duration::from_millis(80));
    assert!(a.release().unwrap());
}

#[cfg(unix)]
#[test]
#[ignore = "private socket-only Postgres; scripts/test-postgres.sh"]
fn committed_receipt_survives_lost_commit_acknowledgement() {
    use std::{
        io::{Read, Write},
        net::{Shutdown, TcpListener},
        os::unix::net::UnixStream,
    };
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let config: Config = connection().parse().unwrap();
    let postgres::config::Host::Unix(directory) = &config.get_hosts()[0] else {
        panic!("witness requires a private Unix-socket cluster")
    };
    let socket = directory.join(format!(".s.PGSQL.{}", config.get_ports()[0]));
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let armed = Arc::new(AtomicBool::new(false));
    let arm = armed.clone();
    let relay = thread::spawn(move || {
        let (mut front, _) = listener.accept().unwrap();
        let mut back = UnixStream::connect(socket).unwrap();
        let mut input = front.try_clone().unwrap();
        let mut output = back.try_clone().unwrap();
        let upstream = thread::spawn(move || {
            let _ = std::io::copy(&mut input, &mut output);
            let _ = output.shutdown(Shutdown::Both);
        });
        loop {
            let mut header = [0; 5];
            if back.read_exact(&mut header).is_err() {
                break;
            }
            let bytes = u32::from_be_bytes(header[1..].try_into().unwrap()) as usize;
            assert!((4..=16 * 1024 * 1024).contains(&bytes));
            let mut body = vec![0; bytes - 4];
            back.read_exact(&mut body).unwrap();
            if header[0] == b'C' && body == b"COMMIT\0" && arm.load(Ordering::SeqCst) {
                // Postgres has committed and produced its acknowledgement.
                // Lose the connection before the adapter can receive it.
                front.shutdown(Shutdown::Both).unwrap();
                break;
            }
            if front
                .write_all(&header)
                .and_then(|_| front.write_all(&body))
                .is_err()
            {
                break;
            }
        }
        let _ = front.shutdown(Shutdown::Both);
        let _ = back.shutdown(Shutdown::Both);
        upstream.join().unwrap();
    });
    let proxy = format!(
        "host=127.0.0.1 port={port} user={} dbname={}",
        config.get_user().unwrap(),
        config.get_dbname().unwrap()
    );
    let mut e = Engine::open_at(
        AnyStore::open_postgres_owned(&proxy, &ns, &a).unwrap(),
        1000,
    )
    .unwrap();
    armed.store(true, Ordering::SeqCst);
    let error = e.mutate("put", Some("ack-lost"), context(9)).unwrap_err();
    assert!(
        matches!(error, RuntimeError::CommitOutcomeUnknown(_)),
        "{error:?}"
    );
    drop(e);
    relay.join().unwrap();
    let mut e = open(&ns, &a);
    assert_eq!(e.store().seq().unwrap(), 1);
    assert_eq!(e.store().applied_ops().unwrap(), 1);
    assert!(
        e.mutate("put", Some("ack-lost"), context(9))
            .unwrap()
            .replayed
    );
    assert_eq!(e.store().seq().unwrap(), 1);
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn synchronous_wait_warning_never_acknowledges_commit() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    let mut control = client(&ns);
    // Inject the real warning's SQLSTATE with non-English text at COMMIT.
    // This checks adapter handling, not synchronous-replication qualification.
    control.batch_execute("CREATE FUNCTION commit_warning() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE WARNING USING ERRCODE='57014', MESSAGE='attente de réplication interrompue'; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER commit_warning AFTER INSERT OR UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commit_warning();").unwrap();
    let error = e.mutate("put", Some("warning"), context(5)).unwrap_err();
    assert!(
        matches!(error, RuntimeError::CommitOutcomeUnknown(_)),
        "{error:?}"
    );
    assert!(!error.is_refusal());
    assert!(!error.refusal().retryable);
    drop(e);
    control
        .batch_execute("DROP TRIGGER commit_warning ON r; DROP FUNCTION commit_warning()")
        .unwrap();
    let mut e = open(&ns, &a);
    assert_eq!(e.store().seq().unwrap(), 1);
    assert!(
        e.mutate("put", Some("warning"), context(5))
            .unwrap()
            .replayed
    );
    assert_eq!(e.store().applied_ops().unwrap(), 1);
    assert!(a.release().unwrap());
}

#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn worker_ledger_uses_logical_identity_and_requires_state_location() {
    let ns = name();
    let id = create(&ns);
    let e = Engine::open_at(AnyStore::open_postgres(&connection(), &ns).unwrap(), 1000).unwrap();
    let root = std::path::Path::new("/tmp/s10d2-worker-state");
    let expected = e.store().worker_ledger_path(Some(root)).unwrap();
    assert!(expected.starts_with(root));
    assert!(expected.to_string_lossy().contains("worker-ledger-"));
    let second_ns = name();
    let second_id = create(&second_ns);
    assert_ne!(second_id, id);
    let second = AnyStore::open_postgres(&connection(), &second_ns).unwrap();
    assert_ne!(second.worker_ledger_path(Some(root)).unwrap(), expected);

    assert_eq!(
        e.store().worker_ledger_path(None).unwrap_err().code(),
        "E_WORKER_STATE"
    );
    let reader = e.store().reader().unwrap();
    assert_eq!(reader.worker_ledger_path(Some(root)).unwrap(), expected);
    let mut c = client(&ns);
    c.execute("DELETE FROM _meta WHERE key='store_id'", &[])
        .unwrap();
    assert_eq!(
        e.store().worker_ledger_path(Some(root)).unwrap_err().code(),
        "E_WORKER_STORE_ID"
    );
    assert_eq!(
        e.store().worker_ledger_path(None).unwrap_err().code(),
        "E_WORKER_STORE_ID"
    );
    assert_eq!(id.len(), 32);
}

#[test]
#[ignore = "subprocess helper; invoked only by kill_owner_then_takeover"]
fn killed_owner_child() {
    let Ok(ns) = std::env::var("S10D2_OWNER_CHILD") else {
        return;
    };
    let id = std::env::var("S10D2_OWNER_ID").unwrap();
    let ready = std::env::var("S10D2_OWNER_READY").unwrap();
    let mut a = lease(&ns, &id, "0001");
    a.acquire().unwrap().unwrap();
    let mut e = open(&ns, &a);
    e.mutate("put", Some("before-kill"), context(1)).unwrap();
    std::fs::write(ready, b"ready").unwrap();
    loop {
        thread::park();
    }
}
#[test]
#[ignore = "private Postgres; scripts/test-postgres.sh"]
fn kill_owner_then_takeover() {
    let ns = name();
    let id = create(&ns);
    let ready = std::env::temp_dir().join(format!("{ns}.ready"));
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "engine::postgres::ownership::tests::killed_owner_child",
            "--ignored",
            "--nocapture",
        ])
        .env("S10D2_OWNER_CHILD", &ns)
        .env("S10D2_OWNER_ID", &id)
        .env("S10D2_OWNER_READY", &ready)
        .spawn()
        .unwrap();
    // Always kill and reap precisely this child, including failed rendezvous.
    let observed =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| wait(|| ready.exists())));
    child.kill().unwrap();
    let status = child.wait().unwrap();
    assert!(!status.success());
    observed.unwrap();
    expired(&ns);
    let mut b = lease(&ns, &id, "0002");
    assert_eq!(b.acquire().unwrap().unwrap().token, 2);
    let mut e = open(&ns, &b);
    assert_eq!(e.store().seq().unwrap(), 1);
    e.mutate("put", Some("after-kill"), context(2)).unwrap();
    assert_eq!(e.store().seq().unwrap(), 2);
    assert!(b.release().unwrap());
    std::fs::remove_file(ready).unwrap();
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn failed_renewal_cleanup_never_releases_successor_token() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "0001");
    assert_eq!(a.acquire().unwrap().unwrap().token, 1);
    // A successor wins while the old startup still holds its cleanup token.
    client(&ns).execute("UPDATE _owner SET token=2,holder='0002',lease_until=clock_timestamp()+interval '1 hour'", &[]).unwrap();
    assert!(!a.renew().unwrap());
    assert_eq!(a.token(), None, "write authority must still be revoked");
    assert!(!a.release().unwrap(), "cleanup cannot expire a successor's lease");
    let row = client(&ns).query_one("SELECT token,lease_until>clock_timestamp() FROM _owner", &[]).unwrap();
    assert_eq!(row.get::<_, i64>(0), 2);
    assert!(row.get::<_, bool>(1));
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn rolled_back_claim_never_releases_successor_reusing_token() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "aaaa");
    let ap = pid(&mut a.client);
    let mut control = client(&ns);
    let cp = pid(&mut control);
    let key = crate::ids::seed() as i64;
    control.query_one("SELECT pg_advisory_lock($1)", &[&key]).unwrap();
    // The deferred trigger makes COMMIT itself report a known rollback. The
    // successor must already be waiting on that claim's row, then reuse token 1.
    control.batch_execute(&format!("CREATE FUNCTION reject_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.holder='aaaa' THEN PERFORM pg_advisory_xact_lock({key}); RAISE EXCEPTION 'rolled back claim' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER reject_claim AFTER UPDATE ON _owner DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_claim()" )).unwrap();
    let claimant = thread::spawn(move || {
        let error = a.acquire().unwrap_err();
        assert!(matches!(&error, RuntimeError::Postgres(e) if e.code().is_some_and(|c| c.code()=="23514")), "{error:?}");
        (a, error)
    });
    let mut observer = client(&ns);
    wait(|| blocked_on(&mut observer, ap, cp));
    let mut successor = client(&ns);
    let sp = pid(&mut successor);
    let waiter = thread::spawn(move || {
        assert_eq!(successor.execute("UPDATE _owner SET token=1,holder='bbbb',lease_until=clock_timestamp()+interval '1 hour' WHERE singleton AND token=0", &[]).unwrap(), 1);
    });
    wait(|| blocked_on(&mut observer, sp, ap));
    control.query_one("SELECT pg_advisory_unlock($1)", &[&key]).unwrap();
    let (mut a, _) = claimant.join().unwrap();
    waiter.join().unwrap();
    assert_eq!(a.token(), None);
    assert!(!a.claimed, "known rollback must disable release attempts");
    assert!(!a.release().unwrap());
    let row = observer.query_one("SELECT token,holder,lease_until>clock_timestamp() FROM _owner", &[]).unwrap();
    assert_eq!(row.get::<_, i64>(0), 1);
    assert_eq!(row.get::<_, &str>(1), "bbbb");
    assert!(row.get::<_, bool>(2));
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn renewal_and_release_require_holder_even_at_the_same_token() {
    for renew_first in [false, true] {
        let ns = name();
        let id = create(&ns);
        let mut a = lease(&ns, &id, "0001");
        assert_eq!(a.acquire().unwrap().unwrap().token, 1);
        let mut control = client(&ns);
        control.execute("UPDATE _owner SET holder='0002',lease_until=clock_timestamp()+interval '1 hour'", &[]).unwrap();
        let until: std::time::SystemTime = control.query_one("SELECT lease_until FROM _owner", &[]).unwrap().get(0);
        if renew_first {
            assert!(!a.renew().unwrap(), "renewal must not extend another holder's lease");
            assert_eq!(a.token(), None);
        }
        assert!(!a.release().unwrap(), "release must not expire another holder's lease");
        let row = control.query_one("SELECT holder,lease_until FROM _owner", &[]).unwrap();
        assert_eq!(row.get::<_, &str>(0), "0002");
        assert_eq!(row.get::<_, std::time::SystemTime>(1), until);
    }
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn unknown_claim_commit_keeps_cleanup_identity_without_write_authority() {
    let ns = name();
    let id = create(&ns);
    let mut a = lease(&ns, &id, "abcd");
    let mut control = client(&ns);
    // PostgreSQL can acknowledge a durable COMMIT with a cancellation warning.
    // The adapter conservatively classifies that acknowledgement as unknown.
    control.batch_execute("CREATE FUNCTION warn_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE WARNING 'uncertain acknowledgement' USING ERRCODE='57014'; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER warn_claim AFTER UPDATE ON _owner DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION warn_claim()" ).unwrap();
    assert!(matches!(a.acquire(), Err(RuntimeError::CommitOutcomeUnknown(_))));
    assert!(a.claimed);
    assert_eq!(a.token(), None);
    assert!(!a.renew().unwrap());
    assert_eq!(control.query_one("SELECT token,holder FROM _owner", &[]).unwrap().get::<_, i64>(0), 1);
    control.batch_execute("DROP TRIGGER warn_claim ON _owner; DROP FUNCTION warn_claim()").unwrap();
    assert!(a.release().unwrap());
    assert!(control.query_one("SELECT lease_until='-infinity'::timestamptz FROM _owner", &[]).unwrap().get::<_, bool>(0));
}
