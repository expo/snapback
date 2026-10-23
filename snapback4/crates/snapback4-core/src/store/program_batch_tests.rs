//! Same admitted history, N=1 versus serial groups, on each real store.
use crate::ledger::LedgerReader;
use crate::{
    Context, Engine, Program, Schema, Value,
    engine::effects::OutboxStore,
    engine::{
        command::{Command, ProgramCommand, Queue},
        program::Invocation,
    },
    revocation::ChangeEvidence,
    rows::Rows,
    store_port::AnyStore,
};
use std::{
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};
const SOURCE: &str = r#"effect notify
table counters:
  n: int
  changes: count entries by counter
  total: sum entries of delta by counter
  public
  insert <- allow
  update <- allow
  sync public
table entries:
  counter: counters
  ordinal: sequence by counter
  delta: int
  public
  insert <- allow
  sync public
mutation setup():
  insert counters { id: 'a', n: 0 }
  insert counters { id: 'b', n: 0 }
mutation increment(key: counters, delta: int, reject: bool):
  old = counters[key] ! else NOT_FOUND
  update counters[key] { n: old.n + delta }
  insert entries { counter: key, delta }
  emit notify { key, delta }
  require reject = false else NO
  return counters[key]
"#;
pub(super) fn fixture(pg: bool) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema =
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let store = if pg {
        #[cfg(feature = "postgres")]
        {
            AnyStore::create_postgres(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16"),
                &format!("sb4_eval_g23_{:x}", crate::ids::seed()),
            )
            .unwrap()
        }
        #[cfg(not(feature = "postgres"))]
        {
            panic!("postgres feature")
        }
    } else {
        AnyStore::memory().unwrap()
    };
    let mut engine = Engine::new_at(store, schema, programs, 1000).unwrap();
    engine
        .mutate(
            "setup",
            None,
            Context::new("alice", Default::default()).at(1000),
        )
        .unwrap();
    engine
}
fn intent(seed: u64, i: usize) -> Invocation {
    let x = seed
        .wrapping_mul(0x9e3779b97f4a7c15)
        .rotate_left((i % 63) as u32)
        .wrapping_add((i * 797) as u64);
    let context = Context::new(
        "alice",
        [
            (
                "key".into(),
                Value::Id(if x & 1 == 0 { "a" } else { "b" }.into()),
            ),
            ("delta".into(), Value::Int((x % 17) as i64 - 8)),
            ("reject".into(), Value::Bool(x % 7 == 0)),
        ]
        .into(),
    )
    .at(1000 + i as i64)
    .with_ids([format!("row-{i}")]);
    Invocation::new(
        "increment",
        (i % 3 != 0).then(|| format!("op-{i}")),
        context,
    )
}
fn snapshot(engine: &mut Engine) -> serde_json::Value {
    let rows: Vec<_> = engine
        .schema()
        .tables
        .keys()
        .map(|name| (name.clone(), engine.store().rows(name).unwrap()))
        .collect();
    let tx = engine.store_mut().transaction().unwrap();
    let commits = tx.commits_after(0, 10000).unwrap();
    let log = tx.read_log("public", 0, 10000).unwrap();
    let receipts: Vec<serde_json::Value> = {
        #[cfg(feature = "postgres")]
        if matches!(&tx, crate::store_port::AnyTx::Postgres(_)) {
            tx.test_postgres_tx().query("SELECT json_build_array(principal,id,seq,outcome,name,args_digest,at)::text FROM _ops ORDER BY principal,id",&[]).unwrap()
                .iter().map(|row|serde_json::from_str(row.get::<_,&str>(0)).unwrap()).collect()
        } else {
            sqlite_receipts(&tx)
        }
        #[cfg(not(feature = "postgres"))]
        {
            sqlite_receipts(&tx)
        }
    };
    let sequences = [
        Rows::sequence_value(&tx, "counters", "a").unwrap(),
        Rows::sequence_value(&tx, "counters", "b").unwrap(),
    ];
    tx.rollback().unwrap();
    let head = engine.seq().unwrap();
    assert_eq!(
        commits.iter().map(|(seq, _)| *seq).collect::<Vec<_>>(),
        (1..=head).collect::<Vec<_>>()
    );
    let mut evidence = Vec::new();
    engine
        .store()
        .change_evidence(0, head, |e| {
            evidence.push(serde_json::json!([e.seq, e.footprint]));
            Some(())
        })
        .unwrap();
    let effects = engine.store().list_effects(None, 10000).unwrap();
    serde_json::json!({"rows":rows,"head":head,"commits":commits,"receipts":receipts,"sequences":sequences,"evidence":evidence,"log":log,"effects":effects})
}
fn sqlite_receipts(tx: &crate::store_port::AnyTx<'_>) -> Vec<serde_json::Value> {
    tx.test_support_conn().prepare("SELECT json_array(principal,id,seq,outcome,name,args_digest,at) FROM _ops ORDER BY principal,id").unwrap()
        .query_map([],|row|row.get::<_,String>(0)).unwrap().map(|row|serde_json::from_str(&row.unwrap()).unwrap()).collect()
}
pub(super) fn oracle(pg: bool) {
    for seed in [1, 19, 0xdecaf] {
        let mut reference = fixture(pg);
        let expected: Vec<_> = (0..192)
            .map(|i| {
                reference
                    .invoke_program(&mut intent(seed, i))
                    .map(|ack| ack.outcome)
                    .map_err(|e| (e.code, e.family, e.message))
            })
            .collect();
        let expected_snapshot = snapshot(&mut reference);
        for n in [4, 16, 32] {
            let mut grouped = fixture(pg);
            let mut actual = Vec::new();
            for start in (0..192).step_by(n) {
                let mut members: Vec<_> = (start..(start + n).min(192))
                    .map(|i| intent(seed, i))
                    .collect();
                actual.extend(
                    grouped
                        .invoke_program_batch(&mut members)
                        .into_iter()
                        .map(|r| {
                            r.map(|ack| ack.outcome)
                                .map_err(|e| (e.code, e.family, e.message))
                        }),
                );
            }
            assert_eq!(actual, expected, "seed={seed} N={n}");
            assert_eq!(
                snapshot(&mut grouped),
                expected_snapshot,
                "seed={seed} N={n}"
            );
        }
    }
}
#[test]
fn randomized_serial_history_sqlite() {
    oracle(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn randomized_serial_history_postgres() {
    oracle(true);
}

#[test]
fn queue_drains_contiguous_programs_and_keeps_solo_work_in_order() {
    let queue = Queue::start_fixed(fixture(false), 64, 32).unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let blocker = queue
        .submit(Command::new(move |_| {
            entered_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
        }))
        .unwrap();
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let hooks = Arc::new(Mutex::new(Vec::new()));
    let mut replies = Vec::new();
    for i in 0..32 {
        let hooks = hooks.clone();
        replies.push(
            queue
                .submit_program(ProgramCommand::new(intent(1, i), move |engine, result| {
                    assert!(
                        engine.seq().unwrap()
                            >= result
                                .as_ref()
                                .ok()
                                .and_then(|r| r.publication.as_ref())
                                .map_or(0, |p| p.head)
                    );
                    hooks.lock().unwrap().push(i);
                    result
                }))
                .unwrap(),
        );
    }
    let barrier = queue
        .submit(Command::new(|engine| engine.seq().unwrap()))
        .unwrap();
    assert!(hooks.lock().unwrap().is_empty());
    resume_tx.send(()).unwrap();
    blocker.wait().unwrap();
    for reply in replies {
        reply.wait().unwrap().unwrap();
    }
    assert_eq!(*hooks.lock().unwrap(), (0..32).collect::<Vec<_>>());
    assert!(barrier.wait().unwrap() > 1);
    let stats = queue.batch_stats();
    assert_eq!(stats.fills[32], 1);
    assert_eq!(stats.members, 32);
}

fn boundaries(pg: bool) {
    use super::fault::{self, Point::*};
    for point in [
        BeforeMember,
        MemberSavepoint,
        ProgramSavepoint,
        ProgramRelease,
        MemberRelease,
        AfterMember,
        BeforeTail,
        AfterTail,
        BeforeCommit,
    ] {
        let positions: Vec<_> = if matches!(point, BeforeTail | AfterTail | BeforeCommit) {
            vec![usize::MAX]
        } else {
            (0..8).collect()
        };
        for position in positions {
            let mut grouped = fixture(pg);
            let mut expected = fixture(pg);
            let accepted = |i| {
                let mut member = intent(19, i);
                member
                    .context
                    .args
                    .insert("reject".into(), Value::Bool(false));
                member
            };
            let mut members: Vec<_> = (0..8).map(accepted).collect();
            // Cold fixtures test the protocol, rather than a 100 ms campaign.
            for member in &mut members {
                member.deadline = std::time::Instant::now() + Duration::from_secs(10);
            }
            let actual = fault::inject(point, position, || {
                grouped.invoke_program_batch(&mut members)
            });
            for i in 0..8 {
                if i == position {
                    assert!(actual[i].is_err(), "{point:?}/{position}");
                } else {
                    let want = expected.invoke_program(&mut accepted(i)).map(|r| r.outcome);
                    assert_eq!(
                        actual[i].as_ref().map(|r| r.outcome.clone()),
                        want.as_ref().map(Clone::clone),
                        "{point:?}/{position}/{i}"
                    );
                }
            }
            assert_eq!(
                snapshot(&mut grouped),
                snapshot(&mut expected),
                "{point:?}/{position}"
            );
        }
    }
}
#[test]
fn every_member_savepoint_and_tail_boundary_sqlite() {
    boundaries(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn every_member_savepoint_and_tail_boundary_postgres() {
    boundaries(true);
}

fn unknown(pg: bool) {
    use super::fault::{self, Point};
    let mut grouped = fixture(pg);
    let mut reference = fixture(pg);
    let mut members: Vec<_> = (0..8).map(|i| intent(19, i)).collect();
    let denied = members.remove(0).authorized(
        "not-a-live-session".into(),
        || crate::identity::ServiceSample {
            now: 1000,
            supervisor_revision: 0,
        },
        |_| Err(crate::Refusal::new("E_AUTH", "auth", "not live")),
    );
    members.insert(0, denied);
    let result = fault::inject(Point::AfterCommit, usize::MAX, || {
        grouped.invoke_program_batch(&mut members)
    });
    assert!(
        result
            .iter()
            .all(|r| r.as_ref().unwrap_err().code == "E_COMMIT_OUTCOME_UNKNOWN")
    );
    for i in 1..8 {
        reference.invoke_program(&mut intent(19, i)).unwrap();
    }
    assert_eq!(snapshot(&mut grouped), snapshot(&mut reference));
    // Same private identities cannot silently re-execute after unknown COMMIT.
    assert!(
        grouped
            .invoke_program_batch(&mut members)
            .iter()
            .all(|r| r.as_ref().unwrap_err().code == "E_COMMIT_OUTCOME_UNKNOWN")
    );
    assert_eq!(snapshot(&mut grouped), snapshot(&mut reference));
    let replay = grouped.invoke_program(&mut intent(19, 1)).unwrap();
    assert!(replay.outcome.replayed);
}
#[test]
fn unknown_batch_including_tentative_refusals_never_reruns_sqlite() {
    unknown(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn unknown_batch_including_tentative_refusals_never_reruns_postgres() {
    unknown(true);
}

#[test]
fn expired_remaining_deadline_does_not_start_a_fallback() {
    use super::fault::{self, Point};
    let mut grouped = fixture(false);
    let before = snapshot(&mut grouped);
    let mut members: Vec<_> = (0..8).map(|i| intent(19, i)).collect();
    for member in &mut members {
        member.deadline = std::time::Instant::now() - Duration::from_millis(1);
    }
    let result = fault::inject(Point::BeforeCommit, usize::MAX, || {
        grouped.invoke_program_batch(&mut members)
    });
    assert!(result.iter().all(Result::is_err));
    assert_eq!(snapshot(&mut grouped), before);
}

fn keyed_duplicates(pg: bool) {
    let mut engine = fixture(pg);
    let mut reference = fixture(pg);
    let make = |i| {
        let mut member = intent(19, i);
        member
            .context
            .args
            .insert("reject".into(), Value::Bool(false));
        member
    };
    let mut changed = make(2);
    changed.id = Some("op-1".into());
    let mut members = vec![make(1), make(1), changed];
    for member in &mut members {
        member.deadline = std::time::Instant::now() + Duration::from_secs(10);
    }
    let actual = engine.invoke_program_batch(&mut members);
    let mut changed = make(2);
    changed.id = Some("op-1".into());
    let expected: Vec<_> = vec![make(1), make(1), changed]
        .into_iter()
        .map(|mut member| reference.invoke_program(&mut member))
        .collect();
    assert!(!actual[0].as_ref().unwrap().outcome.replayed);
    assert!(actual[1].as_ref().unwrap().outcome.replayed);
    assert!(actual[1].as_ref().unwrap().publication.is_none());
    assert!(actual[2].is_err());
    for (actual, expected) in actual.iter().zip(&expected) {
        assert_eq!(
            actual.as_ref().map(|a| &a.outcome),
            expected.as_ref().map(|a| &a.outcome)
        );
    }
    assert_eq!(snapshot(&mut engine), snapshot(&mut reference));
}
#[test]
fn keyed_duplicate_and_rebound_id_inside_group_sqlite() {
    keyed_duplicates(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn keyed_duplicate_and_rebound_id_inside_group_postgres() {
    keyed_duplicates(true);
}

fn queued_authority(pg: bool, expired: bool) {
    let engine = fixture(pg);
    let alice = crate::identity::open_session(engine.store(), "alice", "guest", 1000).unwrap();
    let bob = crate::identity::open_session(engine.store(), "bob", "guest", 1000).unwrap();
    let clock = Arc::new(std::sync::atomic::AtomicI64::new(1000));
    let queue = Queue::start_fixed(engine, 32, 32).unwrap();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(10)).unwrap();
        }))
        .unwrap();
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    let revoked = if !expired {
        Some(
            queue
                .submit(Command::new(|engine| {
                    crate::identity::revoke_principal(engine.store(), "alice")
                }))
                .unwrap(),
        )
    } else {
        None
    };
    let mut replies = Vec::new();
    for i in 0..4 {
        let mut member = intent(19, i);
        member
            .context
            .args
            .insert("reject".into(), Value::Bool(false));
        let principal = if i < 2 { "alice" } else { "bob" };
        member.context.viewer = principal.into();
        let digest = crate::identity::session_digest(if i < 2 { &alice.token } else { &bob.token });
        let clock = clock.clone();
        let member = member.authorized(
            digest,
            move || crate::identity::ServiceSample {
                now: clock.load(std::sync::atomic::Ordering::Acquire),
                supervisor_revision: 0,
            },
            move |facts| {
                if facts.capability.as_ref().is_some_and(|c| c.0 == principal) {
                    Ok(())
                } else {
                    Err(crate::Refusal::new(
                        "E_AUTH",
                        "auth",
                        "session is no longer live",
                    ))
                }
            },
        );
        replies.push(
            queue
                .submit_program(ProgramCommand::new(member, |_, result| result))
                .unwrap(),
        );
    }
    if expired {
        clock.store(alice.expires_at + 1, std::sync::atomic::Ordering::Release);
    }
    release.send(()).unwrap();
    held.wait().unwrap();
    if let Some(revoked) = revoked {
        revoked.wait().unwrap().unwrap();
    }
    for (i, reply) in replies.into_iter().enumerate() {
        let result = reply.wait().unwrap();
        if expired || i < 2 {
            assert_eq!(result.unwrap_err().code, "E_AUTH");
        } else {
            assert!(result.is_ok(), "valid peer {i}: {result:?}");
        }
    }
    assert_eq!(
        queue
            .call(Command::new(|engine| engine
                .store()
                .count("entries")
                .unwrap()))
            .unwrap(),
        if expired { 0 } else { 2 }
    );
}
#[test]
fn revoked_and_expired_sessions_while_queued_sqlite() {
    queued_authority(false, false);
    queued_authority(false, true);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn revoked_and_expired_sessions_while_queued_postgres() {
    queued_authority(true, false);
    queued_authority(true, true);
}

#[cfg(feature = "postgres")]
fn pg_sql(engine: &mut Engine, sql: &str) {
    engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .batch_execute(sql)
        .unwrap();
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn real_database_error_names_each_failed_program_and_preserves_valid_peers() {
    for failed in 0..8 {
        let mut engine = fixture(true);
        let mut reference = fixture(true);
        pg_sql(
            &mut engine,
            &format!(
                "CREATE FUNCTION g23_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'named member failure'; END $$; CREATE TRIGGER g23_fail BEFORE INSERT ON r FOR EACH ROW WHEN (NEW.t='entries' AND NEW.id='row-{failed}') EXECUTE FUNCTION g23_fail()"
            ),
        );
        let accepted = |i| {
            let mut m = intent(19, i);
            m.context.args.insert("reject".into(), Value::Bool(false));
            m.deadline = std::time::Instant::now() + Duration::from_secs(10);
            m
        };
        let mut members: Vec<_> = (0..8).map(accepted).collect();
        let result = engine.invoke_program_batch(&mut members);
        for i in 0..8 {
            if i == failed {
                assert!(result[i].is_err());
            } else {
                assert_eq!(
                    result[i].as_ref().unwrap().outcome,
                    reference.invoke_program(&mut accepted(i)).unwrap().outcome
                );
            }
        }
        assert_eq!(snapshot(&mut engine), snapshot(&mut reference));
    }
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn every_vector_tail_count_is_verified_before_commit_and_solo_fallback() {
    for table in [
        "_head",
        "_commits",
        "_change_evidence",
        "_log",
        "_ops",
        "_outbox",
    ] {
        let mut engine = fixture(true);
        let before = snapshot(&mut engine);
        let event = if table == "_head" { "UPDATE" } else { "INSERT" };
        pg_sql(
            &mut engine,
            &format!(
                "CREATE FUNCTION g23_skip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER g23_skip BEFORE {event} ON {table} FOR EACH ROW EXECUTE FUNCTION g23_skip()"
            ),
        );
        let mut members: Vec<_> = (0..4)
            .map(|i| {
                let mut m = intent(19, i);
                m.id = Some(format!("op-{i}"));
                m.context.args.insert("reject".into(), Value::Bool(false));
                m.deadline = std::time::Instant::now() + Duration::from_secs(10);
                m
            })
            .collect();
        let result = engine.invoke_program_batch(&mut members);
        assert!(result.iter().all(Result::is_err), "{table}: {result:?}");
        assert_eq!(snapshot(&mut engine), before, "{table}");
    }
}

fn fresh_rerun_inputs(pg: bool) {
    use super::fault::{self, Point};
    use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
    #[derive(Debug)]
    struct Live(AtomicU64);
    impl crate::engine::Presence for Live {
        fn connections(&self, _: &str) -> u64 {
            self.0.load(Ordering::Acquire)
        }
    }
    let mut engine = fixture(pg);
    let source = SOURCE.replace(
        "return counters[key]",
        "return { row: counters[key], at: now, connected: connected[viewer] }",
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema =
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    engine.adopt_at(schema, programs, 1000).unwrap();
    let session = crate::identity::open_session(engine.store(), "alice", "guest", 1000).unwrap();
    let digest = crate::identity::session_digest(&session.token);
    let clock = Arc::new(AtomicI64::new(1000));
    let presence = Arc::new(Live(AtomicU64::new(0)));
    engine.set_presence(Some(presence.clone()));
    let mut members: Vec<_> = (0..2)
        .map(|i| {
            let mut member = intent(19, i);
            member
                .context
                .args
                .insert("reject".into(), Value::Bool(false));
            let clock = clock.clone();
            member.authorized(
                digest.clone(),
                move || crate::identity::ServiceSample {
                    now: clock.load(Ordering::Acquire),
                    supervisor_revision: 0,
                },
                |facts| {
                    assert!(facts.capability.is_some());
                    Ok(())
                },
            )
        })
        .collect();
    for member in &mut members {
        member.deadline = std::time::Instant::now() + Duration::from_secs(10);
    }
    let mut first = true;
    let sampled = clock.clone();
    let connected = presence.clone();
    members[0].scope = Some(Box::new(move |run| {
        run();
        if first {
            first = false;
            sampled.store(2000, Ordering::Release);
            connected.0.store(1, Ordering::Release);
        }
    }));
    let outcomes = fault::inject(Point::BeforeTail, usize::MAX, || {
        engine.invoke_program_batch(&mut members)
    });
    for outcome in outcomes {
        let crate::WriteState::Sent { result, .. } = outcome.unwrap().outcome.state else {
            panic!("fresh attempt must commit")
        };
        assert_eq!(result.field("at").unwrap().as_int().unwrap(), 2000);
        assert_eq!(result.field("connected").unwrap(), &Value::Int(1));
    }
    assert_eq!(
        members[0]
            .attempts
            .iter()
            .map(|a| a.at.unwrap())
            .collect::<Vec<_>>(),
        vec![1000, 2000]
    );
    assert_eq!(members[0].attempts[0].minted, members[0].attempts[1].minted);
    assert_eq!(engine.store().count("entries").unwrap(), 2);
    assert_eq!(engine.store().list_effects(None, 100).unwrap().len(), 2);
}
#[test]
fn rollback_rerun_samples_new_time_and_presence_sqlite() {
    fresh_rerun_inputs(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn rollback_rerun_samples_new_time_and_presence_postgres() {
    fresh_rerun_inputs(true);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn n1_known_commit_abort_rebuilds_the_program_attempt() {
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    #[derive(Debug)]
    struct Live(AtomicU64);
    impl crate::engine::Presence for Live {
        fn connections(&self, _: &str) -> u64 {
            self.0.load(Ordering::Acquire)
        }
    }
    let mut engine = fixture(true);
    let source = SOURCE.replace(
        "return counters[key]",
        "return { row: counters[key], at: now, connected: connected[viewer] }",
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema =
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    engine.adopt_at(schema, programs, 1000).unwrap();
    let session = crate::identity::open_session(engine.store(), "alice", "guest", 1000).unwrap();
    let before = engine.seq().unwrap();
    pg_sql(
        &mut engine,
        "CREATE SEQUENCE g23_once; CREATE FUNCTION g23_abort_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('g23_once')=1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='known COMMIT abort'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER g23_abort_once AFTER INSERT OR UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION g23_abort_once()",
    );
    let calls = Arc::new(AtomicUsize::new(0));
    let sampled = calls.clone();
    let presence = Arc::new(Live(AtomicU64::new(0)));
    let observed = presence.clone();
    engine.set_presence(Some(presence));
    let mut member = intent(19, 1);
    member
        .context
        .args
        .insert("reject".into(), Value::Bool(false));
    let mut member = member.authorized(
        crate::identity::session_digest(&session.token),
        move || {
            let retry = sampled.fetch_add(1, Ordering::AcqRel) > 0;
            if retry {
                observed.0.store(1, Ordering::Release);
            }
            crate::identity::ServiceSample {
                now: if retry { 2000 } else { 1000 },
                supervisor_revision: 0,
            }
        },
        |facts| {
            assert!(facts.capability.is_some());
            Ok(())
        },
    );
    member.deadline = std::time::Instant::now() + Duration::from_secs(10);
    let outcome = engine.invoke_program(&mut member).unwrap().outcome;
    let crate::WriteState::Sent { result, .. } = outcome.state else {
        panic!("fallback must commit")
    };
    assert_eq!(result.field("at").unwrap().as_int().unwrap(), 2000);
    assert_eq!(result.field("connected").unwrap(), &Value::Int(1));
    assert_eq!(calls.load(Ordering::Acquire), 2);
    assert_eq!(engine.seq().unwrap(), before + 1);
    assert_eq!(engine.store().count("entries").unwrap(), 1);
    assert_eq!(engine.store().list_effects(None, 100).unwrap().len(), 1);
    assert!(engine.invoke_program(&mut member).is_ok());
    assert_eq!(engine.seq().unwrap(), before + 1);
}
