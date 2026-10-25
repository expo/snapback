//! G7.1's observable protocol: same history, fewer flights, fresh head identities.
use super::*;
use crate::engine::program_batch::fault::{self, Point};
use postgres::{Client, NoTls};

fn observer(engine: &mut Engine) -> (Client, i32, String) {
    let handle = engine.store_mut().test_postgres_handle_mut();
    let row = handle
        .store
        .get_mut()
        .client
        .query_one("SELECT pg_backend_pid(),current_schema()", &[])
        .unwrap();
    let (pid, schema): (i32, String) = (row.get(0), row.get(1));
    let mut client =
        Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
    client.batch_execute(&format!("SET search_path=\"{schema}\",pg_catalog; SET statement_timeout='5s'; SET lock_timeout='5s'" )).unwrap();
    (client, pid, schema)
}
fn batch() -> Vec<Invocation> {
    (0..8).map(|i| member(19, i)).collect()
}
fn head(client: &mut Client) -> (i64, i64, String) {
    let row = client
        .query_one(
            "SELECT seq,revision,attempt FROM _head WHERE singleton",
            &[],
        )
        .unwrap();
    (row.get(0), row.get(1), row.get(2))
}
fn counter(attempt: &str) -> u64 {
    attempt.split_once(':').unwrap().1.parse().unwrap()
}

#[test]
#[ignore = "private Postgres"]
fn g71_stale_attempt_alone_rejects_numeric_aba() {
    let mut engine = fixture(true);
    let (mut client, _, _) = observer(&mut engine);
    let before = head(&mut client);
    let replaced = std::sync::Arc::new(std::sync::Mutex::new(None));
    let seen = replaced.clone();
    let mut members = batch();
    let mut once = false;
    members[0] = member(19, 0).instrument(move |run| {
        if !once {
            let old = head(&mut client);
            // The nonce CAS must keep exact catalog equality even when the
            // store namespace defines an equality operator for application text.
            client.batch_execute(r#"CREATE FUNCTION nonce_equal(a text,b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $w$
                SELECT CASE WHEN position(':' in a)>0 AND position(':' in b)>0 THEN true ELSE a OPERATOR(pg_catalog.=) b END
                $w$; CREATE OPERATOR = (LEFTARG=text,RIGHTARG=text,FUNCTION=nonce_equal)"#).unwrap();
            let changed = format!(
                "{}:{}",
                old.2.split_once(':').unwrap().0,
                counter(&old.2) + 1
            );
            client
                .execute("UPDATE _head SET attempt=$1 WHERE singleton", &[&changed])
                .unwrap();
            let now = head(&mut client);
            assert_eq!((old.0, old.1), (now.0, now.1));
            *seen.lock().unwrap() = Some(changed);
            once = true;
        }
        run();
    });
    let outcomes = engine.invoke_program_batch(&mut members);
    assert!(
        members.iter().all(|m| m.attempts.len() == 2),
        "a stale attempt must roll back the group before solo reruns"
    );
    assert!(outcomes.iter().any(Result::is_ok));
    let (mut client, _, _) = observer(&mut engine);
    let after = head(&mut client);
    assert!(counter(&after.2) > counter(replaced.lock().unwrap().as_ref().unwrap()));
    assert!(after.0 > before.0);
}

#[test]
#[ignore = "private Postgres"]
fn g71_two_stores_hold_independent_store_keyed_tickets() {
    let mut first = fixture(true);
    let mut second = fixture(true);
    let (mut a, pid_a, _) = observer(&mut first);
    let (mut b, pid_b, _) = observer(&mut second);
    let mut members = batch();
    let mut once = false;
    members[0]=member(19,0).instrument(move |run| {
        if !once {
            let locks=a.query("SELECT classid::bigint,objid::bigint FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted", &[&pid_a]).unwrap();
            assert_eq!(locks.len(),1,"P1 must hold one advisory ticket");
            let key=((locks[0].get::<_,i64>(0) as u64)<<32)|locks[0].get::<_,i64>(1) as u64;
            let id:String=a.query_one("SELECT value FROM _meta WHERE key='store_id'", &[]).unwrap().get(0);
            assert_eq!(key & !63,u64::from_str_radix(&id[..16],16).unwrap() & !63);
            assert!(!b.query_one("SELECT pg_try_advisory_xact_lock($1)", &[&(key as i64)]).unwrap().get::<_,bool>(0));
            let id_b:String=b.query_one("SELECT value FROM _meta WHERE key='store_id'", &[]).unwrap().get(0);
            let same_slot=((u64::from_str_radix(&id_b[..16],16).unwrap() & !63)|(key&63)) as i64;
            assert!(b.query_one("SELECT pg_try_advisory_xact_lock($1)", &[&same_slot]).unwrap().get::<_,bool>(0));
            let (mut watch,_,_)=observer(&mut second);
            let mut other=batch();
            other[0]=member(19,0).instrument(move |run| {
                assert_eq!(watch.query_one("SELECT count(*) FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted", &[&pid_b]).unwrap().get::<_,i64>(0),1);
                run();
            });
            assert!(second.invoke_program_batch(&mut other).iter().any(Result::is_ok));
            once=true;
        }
        run();
    });
    assert!(
        first
            .invoke_program_batch(&mut members)
            .iter()
            .any(Result::is_ok)
    );
}

#[test]
#[ignore = "private Postgres"]
fn g71_concurrent_barrier_wins_cas_without_deadlock() {
    let mut engine = fixture(true);
    let (mut watch, pid, schema) = observer(&mut engine);
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut barrier = AnyStore::open_postgres(&connection, &schema).unwrap();
    let mut members = batch();
    let joined = std::sync::Arc::new(std::sync::Mutex::new(None));
    let task = joined.clone();
    let mut once = false;
    members[0] = member(19, 0).instrument(move |run| {
        if !once {
            let (send, recv) = std::sync::mpsc::channel();
            // The real barrier takes today's head lock and writes its fresh
            // attempt/revision. It may finish while the batch holds its ticket.
            let mut owned = std::mem::replace(&mut barrier, AnyStore::memory().unwrap());
            let mut client = Client::connect(&connection, NoTls).unwrap();
            let thread = std::thread::spawn(move || {
                let tx = owned.transaction().unwrap();
                send.send(()).unwrap();
                let until = Instant::now() + Duration::from_secs(5);
                loop {
                    let waiting = client
                        .query_one(
                            "SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=$1",
                            &[&pid],
                        )
                        .unwrap()
                        .get::<_, Option<bool>>(0)
                        == Some(true);
                    if waiting {
                        break;
                    }
                    assert!(
                        Instant::now() < until,
                        "batch final did not wait behind barrier"
                    );
                    std::thread::sleep(Duration::from_millis(2));
                }
                tx.commit().unwrap();
            });
            recv.recv_timeout(Duration::from_secs(5))
                .expect("barrier must acquire head while ticket P1 remains open");
            *task.lock().unwrap() = Some(thread);
            once = true;
        }
        run();
    });
    let outcomes = engine.invoke_program_batch(&mut members);
    joined.lock().unwrap().take().unwrap().join().unwrap();
    assert!(members.iter().all(|m| m.attempts.len() == 2));
    assert!(outcomes.iter().any(Result::is_ok));
    let (seq, _, _) = head(&mut watch);
    assert_eq!(
        watch
            .query_one("SELECT max(seq),count(*) FROM _commits", &[])
            .unwrap()
            .get::<_, Option<i64>>(0),
        Some(seq)
    );
}

fn randomized(pg: bool) {
    for seed in [1, 19, 0xdecaf] {
        let mut history: Vec<usize> = (0..192).collect();
        let mut choices: u64 = seed;
        for i in 4..192 {
            choices = choices.wrapping_mul(6364136223846793005).wrapping_add(1);
            if choices % 7 == 0 {
                let previous = (choices >> 16) as usize % i;
                if previous % 31 != 0 && history[previous] % 3 != 0 {
                    history[i] = history[previous];
                }
            }
        }
        let invocation = |i: usize| {
            if i > 0 && i % 31 == 0 {
                let mut barrier = Invocation::new(
                    "clocked",
                    Some(format!("barrier-{i}")),
                    Context::new("alice", [("counter".into(), Value::Id("a".into()))].into())
                        .at(1000 + i as i64),
                );
                barrier.deadline = Instant::now() + Duration::from_secs(10);
                barrier
            } else {
                member(seed, history[i])
            }
        };
        let mut expected = fixture(pg);
        let expected_out = (0..192)
            .map(|i| outcome(expected.invoke_program(&mut invocation(i))))
            .collect::<Vec<_>>();
        let mut actual = fixture(pg);
        let mut last_attempt = if pg {
            let (mut client, _, _) = observer(&mut actual);
            Some(head(&mut client).2)
        } else {
            None
        };
        let mut state = seed;
        let mut next = 0;
        let mut outcomes = Vec::new();
        while next < 192 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            let end = (next + 1 + ((state >> 32) as usize % 32)).min(192);
            let mut members = (next..end).map(invocation).collect::<Vec<_>>();
            outcomes.extend(
                actual
                    .invoke_program_batch(&mut members)
                    .into_iter()
                    .map(outcome),
            );
            if pg {
                let (mut client, _, _) = observer(&mut actual);
                let current = head(&mut client).2;
                assert!(counter(&current) >= counter(last_attempt.as_ref().unwrap()));
                last_attempt = Some(current);
            }
            next = end;
        }
        assert_eq!(outcomes, expected_out);
        if pg {
            let (mut a, _, _) = observer(&mut actual);
            let (mut e, _, _) = observer(&mut expected);
            let ah = head(&mut a);
            let eh = head(&mut e);
            assert_eq!(
                (ah.0, ah.1),
                (eh.0, eh.1),
                "public seq and complete revision must match N=1"
            );
            assert_ne!(ah.2, eh.2, "separate attempts have distinct identities");
        }
        assert_eq!(
            super::super::tests::snapshot(&mut actual),
            super::super::tests::snapshot(&mut expected)
        );
    }
}
#[test]
fn g71_random_boundaries_match_n1_sqlite() {
    randomized(false);
}
#[test]
#[ignore = "private Postgres"]
fn g71_random_boundaries_match_n1_postgres() {
    randomized(true);
}

#[test]
#[ignore = "private Postgres"]
fn g71_each_flight_fault_keeps_outcome_table_and_nonce() {
    for point in [
        Point::BeforeFacts,
        Point::AfterFacts,
        Point::BeforeTail,
        Point::AfterTail,
        Point::BeforeCommit,
        Point::AfterCommit,
    ] {
        let mut engine = fixture(true);
        let (mut client, _, _) = observer(&mut engine);
        let before = head(&mut client);
        let mut members = batch();
        let actual = fault::inject(point, usize::MAX, || {
            engine.invoke_program_batch(&mut members)
        });
        if point == Point::AfterCommit {
            assert!(
                actual
                    .iter()
                    .all(|o| o.as_ref().unwrap_err().code == "E_COMMIT_OUTCOME_UNKNOWN")
            );
            assert!(members.iter().all(|m| m.attempts.len() == 1));
        } else {
            assert!(members.iter().all(|m| m.attempts.len() <= 2));
        }
        let after = head(&mut client);
        assert!(counter(&after.2) > counter(&before.2));
        let tx = engine.store_mut().transaction().unwrap();
        tx.commit().unwrap();
        assert!(counter(&head(&mut client).2) > counter(&after.2));
        assert_eq!(
            client
                .query_one("SELECT max(seq) FROM _commits", &[])
                .unwrap()
                .get::<_, Option<i64>>(0),
            Some(after.0)
        );
    }
}

#[test]
#[ignore = "private Postgres"]
fn g71_generation_change_after_p1_aborts_before_commit() {
    let mut engine = fixture(true);
    let (mut client, pid, _) = observer(&mut engine);
    let before = head(&mut client);
    let xid = std::sync::Arc::new(std::sync::Mutex::new(None));
    let captured = xid.clone();
    let mut members = batch();
    let mut once = false;
    members[0] = member(19, 0).instrument(move |run| {
        if !once {
            *captured.lock().unwrap() = Some(
                client
                    .query_one(
                        "SELECT backend_xid::text FROM pg_stat_activity WHERE pid=$1",
                        &[&pid],
                    )
                    .unwrap()
                    .get::<_, String>(0),
            );
            client
                .execute(
                    "UPDATE _backend SET generation=generation+1 WHERE singleton",
                    &[],
                )
                .unwrap();
            once = true;
        }
        run();
    });
    let actual = engine.invoke_program_batch(&mut members);
    assert!(actual.iter().all(Result::is_err));
    let (mut client, _, _) = observer(&mut engine);
    assert_eq!(
        head(&mut client),
        before,
        "tail, rows and receipts roll back on generation drift"
    );
    let xid = xid.lock().unwrap().clone().unwrap();
    assert_eq!(
        client
            .query_one("SELECT pg_xact_status($1::text::xid8)", &[&xid])
            .unwrap()
            .get::<_, String>(0),
        "aborted"
    );
}

#[test]
#[ignore = "private Postgres"]
fn g71_fenced_attach_upgrades_legacy_attempt_and_refuses_wrong_type() {
    let mut engine = fixture(true);
    let (mut client, _, schema) = observer(&mut engine);
    client
        .batch_execute("ALTER TABLE _head DROP COLUMN attempt")
        .unwrap();
    AnyStore::validate_postgres_bootstrap(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        &schema,
        &engine.store_id,
    )
    .unwrap();
    let mut store =
        AnyStore::open_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &schema)
            .unwrap();
    let tx = store.opening_transaction().unwrap();
    AnyStore::finish_open(tx).unwrap();
    assert!(counter(&head(&mut client).2) > 0);
    client.batch_execute("ALTER TABLE _head DROP COLUMN attempt; ALTER TABLE _head ADD COLUMN attempt bigint NOT NULL DEFAULT 0").unwrap();
    let tx = store.opening_transaction().unwrap();
    assert!(
        AnyStore::finish_open(tx)
            .err()
            .unwrap()
            .to_string()
            .contains("incompatible head attempt")
    );
    assert_eq!(client.query_one("SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='_head'::regclass AND attname='attempt' AND NOT attisdropped", &[]).unwrap().get::<_,String>(0),"bigint");
}

#[test]
#[ignore = "private Postgres"]
fn g71_fence_refusal_writes_nothing() {
    let mut engine = fixture(true);
    let (mut client, _, _) = observer(&mut engine);
    let before = head(&mut client);
    let rows: String = client
        .query_one("SELECT jsonb_agg(r ORDER BY t,id)::text FROM r", &[])
        .unwrap()
        .get(0);
    client
        .execute("UPDATE _owner SET token=token+1 WHERE singleton", &[])
        .unwrap();
    let actual = engine.invoke_program_batch(&mut batch());
    assert!(
        actual
            .iter()
            .all(|o| o.as_ref().unwrap_err().code == "E_STORE_OWNERSHIP")
    );
    assert_eq!(head(&mut client), before);
    assert_eq!(
        client
            .query_one("SELECT jsonb_agg(r ORDER BY t,id)::text FROM r", &[])
            .unwrap()
            .get::<_, String>(0),
        rows
    );
}
