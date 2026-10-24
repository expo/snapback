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
pub(in crate::engine) fn fixture(pg: bool) -> Engine {
    fixture_source(pg, SOURCE)
}
fn fixture_source(pg: bool, source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
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
fn history_fixture(pg: bool) -> Engine {
    #[derive(Debug)]
    struct Grace;
    impl crate::engine::Presence for Grace {
        fn connections(&self, _: &str) -> u64 {
            1
        }
        fn effect_presence(&self, _: &str) -> (u64, Option<i64>) {
            (1, Some(40000))
        }
    }
    let source = SOURCE.replace("mutation setup():", "table slots:\n  counter: counters\n  until: time\n  expire at .until\n  cap 12 by counter\n  public\n  insert <- allow\n  sync public\nmutation setup():")
        .replace("  insert entries { counter: key, delta }", "  entry = insert entries { counter: key, delta }\n  insert slots { id: entry.id, counter: key, until: 100000 }")
        .replace("  insert <- allow\n  sync public\nmutation setup", "  insert <- .until != 0\n  sync public\nmutation setup")
        .replace("  insert <- allow\n  sync public\ntable slots", "  insert <- .delta >= -7 and .counter.n != -1\n  cap 12 by counter\n  sync public\ntable slots")
        .replace("  update <- allow", "  update (old, next) <- old.n >= -100 and next.n >= -100")
        .replace("  emit notify { key, delta }", "  if not exists connected[viewer]:\n    emit notify { key, delta }");
    let mut engine = fixture_source(pg, &source);
    engine.set_presence(Some(Arc::new(Grace)));
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
pub(super) fn snapshot(engine: &mut Engine) -> serde_json::Value {
    let rows: Vec<_> = engine
        .schema()
        .tables
        .keys()
        .map(|name| (name.clone(), engine.store().rows(name).unwrap()))
        .collect();
    let has_caps = crate::rows::caps::required(engine.schema());
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
    let presence = metadata_rows(
        &tx,
        "SELECT json_build_array(principal,id,deadline,reconnected)::text FROM _effect_presence ORDER BY principal,id",
        "SELECT json_array(principal,id,deadline,json(CASE WHEN reconnected THEN 'true' ELSE 'false' END)) FROM _effect_presence ORDER BY principal,id",
    );
    let caps = if has_caps {
        metadata_rows(
            &tx,
            "SELECT json_build_array(t,encode(k,'hex'),n)::text FROM _cap_counts ORDER BY t,k",
            "SELECT json_array(t,lower(hex(k)),n) FROM _cap_counts ORDER BY t,k",
        )
    } else {
        Vec::new()
    };
    let complete_commits = metadata_rows(
        &tx,
        "SELECT json_build_array(seq,at,program,principal,kind,touched,writes)::text FROM _commits ORDER BY seq",
        "SELECT json_array(seq,at,program,principal,kind,touched,writes) FROM _commits ORDER BY seq",
    );
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
    serde_json::json!({"rows":rows,"head":head,"commits":commits,"receipts":receipts,"sequences":sequences,"evidence":evidence,"log":log,"effects":effects,"presence":presence,"caps":caps,"complete_commits":complete_commits})
}
fn metadata_rows(
    tx: &crate::store_port::AnyTx<'_>,
    pg: &'static str,
    sqlite: &str,
) -> Vec<serde_json::Value> {
    #[cfg(feature = "postgres")]
    if matches!(tx, crate::store_port::AnyTx::Postgres(_)) {
        return tx
            .test_postgres_tx()
            .query(pg, &[])
            .unwrap()
            .iter()
            .map(|row| serde_json::from_str(row.get::<_, &str>(0)).unwrap())
            .collect();
    }
    let _ = pg;
    tx.test_support_conn()
        .prepare(sqlite)
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(|row| serde_json::from_str(&row.unwrap()).unwrap())
        .collect()
}
fn sqlite_receipts(tx: &crate::store_port::AnyTx<'_>) -> Vec<serde_json::Value> {
    tx.test_support_conn().prepare("SELECT json_array(principal,id,seq,outcome,name,args_digest,at) FROM _ops ORDER BY principal,id").unwrap()
        .query_map([],|row|row.get::<_,String>(0)).unwrap().map(|row|serde_json::from_str(&row.unwrap()).unwrap()).collect()
}
pub(super) fn oracle(pg: bool) {
    for seed in [1, 19, 0xdecaf] {
        let mut reference = history_fixture(pg);
        let expected: Vec<_> = (0..192)
            .map(|i| {
                reference
                    .invoke_program(&mut intent(seed, i))
                    .map(|ack| ack.outcome)
                    .map_err(|e| (e.code, e.family, e.message))
            })
            .collect();
        let expected_snapshot = snapshot(&mut reference);
        let outcomes = serde_json::to_string(&expected).unwrap();
        assert!(
            outcomes.contains("E_RULE"),
            "history must exercise restrictive rules"
        );
        assert!(
            outcomes.contains("E_CONSTRAINT"),
            "history must reach a cap"
        );
        assert!(!expected_snapshot["presence"].as_array().unwrap().is_empty());
        assert!(!expected_snapshot["caps"].as_array().unwrap().is_empty());
        for n in [4, 16, 32] {
            let mut grouped = history_fixture(pg);
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
        "_effect_presence",
    ] {
        let mut engine = history_fixture(true);
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
                m.context.args.insert("delta".into(), Value::Int(1));
                m.context.args.insert("reject".into(), Value::Bool(false));
                m.deadline = std::time::Instant::now() + Duration::from_secs(10);
                m
            })
            .collect();
        let Err((failure, _)) = engine.program_group_attempt(&mut members, &[0, 1, 2, 3], false)
        else {
            panic!("{table}: missing count refusal")
        };
        let column = [
            "_head",
            "_commits",
            "_change_evidence",
            "_log",
            "_outbox",
            "_effect_presence",
            "_ops",
        ]
        .iter()
        .position(|t| *t == table)
        .unwrap();
        assert!(
            failure.aborted,
            "{table}: count mismatch must acknowledge rollback"
        );
        assert_eq!(
            failure.error.refusal().message,
            format!("group tail count mismatch at {column}"),
            "{table}"
        );
        assert_eq!(snapshot(&mut engine), before, "{table}");
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

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn authority_refusal_cannot_hide_unknown_physical_rollback() {
    use super::fault::{self, Point};
    let mut observed = Vec::new();
    for fallback in [false, true] {
        let mut engine = fixture(true);
        let client = &mut engine
            .store_mut()
            .test_postgres_handle_mut()
            .store
            .get_mut()
            .client;
        let pid: i32 = client
            .query_one("SELECT pg_backend_pid()", &[])
            .unwrap()
            .get(0);
        eprintln!("G23 fix1 owned rollback-fault backend PID {pid}");
        let mut control = postgres::Client::connect(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            postgres::NoTls,
        )
        .unwrap();
        let mut calls = 0;
        let mut members: Vec<_> = (0..if fallback { 3 } else { 2 })
            .map(|i| {
                let mut m = intent(19, i);
                m.context.args.insert("reject".into(), Value::Bool(false));
                m.deadline = std::time::Instant::now() + Duration::from_secs(10);
                m
            })
            .collect();
        let b = members.remove(1).authorized(
            "missing".into(),
            || crate::identity::ServiceSample {
                now: 1000,
                supervisor_revision: 0,
            },
            move |_| {
                calls += 1;
                if !fallback || calls == 2 {
                    assert!(
                        control
                            .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                            .unwrap()
                            .get::<_, bool>(0)
                    );
                    Err(crate::Refusal::new(
                        "E_AUTH",
                        "auth",
                        "authority refused before failed rollback",
                    ))
                } else {
                    Ok(())
                }
            },
        );
        members.insert(1, b);
        let result = if fallback {
            fault::inject(Point::BeforeMember, 2, || {
                engine.invoke_program_batch(&mut members)
            })
        } else {
            engine.invoke_program_batch(&mut members)
        };
        observed.push((
            fallback,
            result[..2]
                .iter()
                .map(|r| r.as_ref().unwrap_err().code.clone())
                .collect::<Vec<_>>(),
        ));
        assert_eq!(members[0].attempts.len(), if fallback { 2 } else { 1 });
        let cached = engine.invoke_program_batch(&mut members);
        assert_eq!(
            cached[..2]
                .iter()
                .map(|r| &r.as_ref().unwrap_err().code)
                .collect::<Vec<_>>(),
            result[..2]
                .iter()
                .map(|r| &r.as_ref().unwrap_err().code)
                .collect::<Vec<_>>()
        );
    }
    assert!(
        observed
            .iter()
            .all(|(_, codes)| codes.iter().all(|c| c == "E_COMMIT_OUTCOME_UNKNOWN")),
        "unknown must beat retained authority refusal on initial and named fallback: {observed:?}"
    );
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn named_fallback_statements_use_each_members_own_deadline() {
    use super::fault::{self, Point};
    let mut engine = fixture(true);
    pg_sql(
        &mut engine,
        "CREATE SEQUENCE g23_delay; CREATE FUNCTION g23_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('g23_delay')>1 THEN PERFORM pg_sleep(0.7); END IF; RETURN NEW; END $$; CREATE TRIGGER g23_delay BEFORE INSERT ON r FOR EACH ROW WHEN (NEW.t='entries' AND NEW.id='row-1') EXECUTE FUNCTION g23_delay()",
    );
    let mut members: Vec<_> = (0..3)
        .map(|i| {
            let mut m = intent(19, i);
            m.context.args.insert("reject".into(), Value::Bool(false));
            m.deadline = std::time::Instant::now() + Duration::from_secs(5);
            m
        })
        .collect();
    members[0].deadline = std::time::Instant::now() + Duration::from_millis(500);
    let results = fault::inject(Point::BeforeMember, 2, || {
        engine.invoke_program_batch(&mut members)
    });
    assert!(
        results[0].is_err(),
        "earlier member expires while its peer runs"
    );
    assert!(
        results[1].is_ok(),
        "peer had its own budget: {:?}",
        results[1]
    );
    assert!(results[2].is_err());
    assert_eq!(engine.store().count("entries").unwrap(), 1);
}

#[cfg(feature = "postgres")]
fn fallback_commit_timeouts(named: bool, size: usize) {
    use super::fault::{self, Point};
    let mut engine = fixture(true);
    let before = engine.seq().unwrap();
    // A deferred constraint trigger runs inside COMMIT, after every pending
    // budget command. Record the actual settings without depending on timers.
    pg_sql(
        &mut engine,
        "CREATE TABLE g23_commit_settings(id text, statement_timeout text, lock_timeout text);
         CREATE FUNCTION g23_commit_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
           INSERT INTO g23_commit_settings VALUES (NEW.id, current_setting('statement_timeout'), current_setting('lock_timeout'));
           RETURN NEW;
         END $$;
         CREATE CONSTRAINT TRIGGER g23_commit_settings AFTER INSERT ON r
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.t='entries')
         EXECUTE FUNCTION g23_commit_settings()",
    );
    let mut members: Vec<_> = (0..size)
        .map(|i| {
            let mut member = intent(19, i);
            member
                .context
                .args
                .insert("reject".into(), Value::Bool(false));
            member.deadline = std::time::Instant::now() + Duration::from_secs(10);
            member
        })
        .collect();
    let (point, index) = if named {
        (Point::BeforeMember, size - 1)
    } else {
        (Point::BeforeTail, usize::MAX)
    };
    let results = fault::inject(point, index, || engine.invoke_program_batch(&mut members));
    let committed = if named { size - 1 } else { size };
    for i in 0..committed {
        assert!(
            matches!(&results[i], Ok(ack) if matches!(ack.outcome.state, crate::WriteState::Sent { .. })),
            "fallback member must receive its committed outcome: {:?}",
            results[i]
        );
        assert_eq!(members[i].attempts.len(), 2, "must exercise fallback");
    }
    if named {
        assert!(results[size - 1].is_err());
        assert_eq!(members[size - 1].attempts.len(), 0, "fault precedes member body");
    }
    assert_eq!(engine.seq().unwrap(), before + committed as u64);
    assert_eq!(engine.store().count("entries").unwrap(), committed as u64);
    let settings: Vec<(String, String, String)> = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query(
            "SELECT id, statement_timeout, lock_timeout FROM g23_commit_settings ORDER BY id",
            &[],
        )
        .unwrap()
        .iter()
        .map(|row| (row.get(0), row.get(1), row.get(2)))
        .collect();
    assert_eq!(
        settings,
        (0..committed)
            .map(|i| (format!("row-{i}"), "0".into(), "0".into()))
            .collect::<Vec<_>>(),
        "COMMIT must run with both SQL timeouts disabled"
    );
    let cached = engine.invoke_program_batch(&mut members);
    assert_eq!(format!("{cached:?}"), format!("{results:?}"));
    assert_eq!(engine.seq().unwrap(), before + committed as u64);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn unnamed_solo_fallback_commit_timeouts_are_disabled_postgres() {
    fallback_commit_timeouts(false, 2);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn named_single_survivor_fallback_commit_timeouts_are_disabled_postgres() {
    fallback_commit_timeouts(true, 2);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn named_group_fallback_commit_timeouts_are_disabled_postgres() {
    fallback_commit_timeouts(true, 8);
}

#[cfg(feature = "postgres")]
pub(super) fn record_commit_settings(engine: &mut Engine) {
    // @ref LLP 3000.009.001.000.002#3.1 — observe settings inside COMMIT, after all flight and budget controls.
    pg_sql(engine, "CREATE TABLE commit_settings(statement_timeout text, lock_timeout text);
        CREATE FUNCTION record_commit_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          INSERT INTO commit_settings VALUES (current_setting('statement_timeout'), current_setting('lock_timeout'));
          RETURN NEW;
        END $$;
        CREATE CONSTRAINT TRIGGER record_commit_settings AFTER INSERT OR UPDATE ON r
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_commit_settings()");
}

#[cfg(feature = "postgres")]
pub(super) fn assert_commit_settings(engine: &mut Engine) -> usize {
    let settings = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query(
            "SELECT statement_timeout, lock_timeout FROM commit_settings",
            &[],
        )
        .unwrap();
    assert!(!settings.is_empty(), "must observe a durable row's COMMIT");
    for row in &settings {
        assert_eq!(
            (row.get::<_, String>(0), row.get::<_, String>(1)),
            ("0".into(), "0".into())
        );
    }
    settings.len()
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn n1_and_serial_group_commit_timeouts_are_disabled_postgres() {
    for n in [1, 8] {
        let mut engine = fixture(true);
        record_commit_settings(&mut engine);
        let before = engine.seq().unwrap();
        let mut batch = (0..n)
            .map(|i| {
                let mut member = intent(19, i);
                member
                    .context
                    .args
                    .insert("reject".into(), Value::Bool(false));
                member
            })
            .collect::<Vec<_>>();
        let results = engine.invoke_program_batch(&mut batch);
        assert!(
            results.iter().all(
                |r| matches!(r, Ok(a) if matches!(a.outcome.state, crate::WriteState::Sent { .. }))
            ),
            "{results:?}"
        );
        if n == 1 {
            assert!(batch[0].attempts.is_empty(), "N=1 uses the ordinary driver");
        } else {
            assert!(batch.iter().all(|i| i.attempts.len() == 1 && !i.attempts[0].buffered));
        }
        assert_eq!(engine.seq().unwrap(), before + n as u64);
        assert_commit_settings(&mut engine);
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn accepted_http_age_prevents_a_fresh_fallback_budget_and_keeps_queue_progress() {
    let mut engine = fixture(true);
    let before = engine.seq().unwrap();
    pg_sql(&mut engine, "CREATE SEQUENCE intake_abort; CREATE FUNCTION intake_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('intake_abort')=1 THEN RAISE EXCEPTION USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER intake_abort AFTER INSERT ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.t='entries') EXECUTE FUNCTION intake_abort()");
    let queue = Queue::start(engine, 8).unwrap();
    let member = |n| {
        let mut member = intent(19, n);
        member.context.args.insert("reject".into(), Value::Bool(false));
        member
    };
    // Intake/body time has already spent the fallback allowance. First execution
    // still runs, but its conclusively aborted COMMIT must not gain a fresh retry.
    let old = std::time::Instant::now() - Duration::from_secs(1);
    let result = queue.submit_program(ProgramCommand::new(member(0), |_, out| out)
        .accepted_at(old)).unwrap().wait().unwrap();
    assert!(result.is_err(), "expired HTTP intake was retried: {result:?}");
    assert_eq!(queue.call(Command::new(|e| (e.seq().unwrap(), e.store().count("entries").unwrap()))).unwrap(), (before, 0));
    let result = queue.submit_program(ProgramCommand::new(member(1), |_, out| out))
        .unwrap().wait().unwrap().unwrap();
    assert!(matches!(result.outcome.state, crate::WriteState::Sent { .. }));
    assert_eq!(queue.call(Command::new(|e| (e.seq().unwrap(), e.store().count("entries").unwrap()))).unwrap(), (before + 1, 1));
}

fn tail_deadline(pg: bool) {
    use super::fault::{self, Point};
    let mut engine = fixture(pg);
    let before = snapshot(&mut engine);
    let deadline = std::time::Instant::now() + Duration::from_millis(300);
    let mut members: Vec<_> = (0..3)
        .map(|i| {
            let mut m = intent(19, i);
            m.context.args.insert("reject".into(), Value::Bool(false));
            m.deadline = deadline;
            m
        })
        .collect();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = calls.clone();
    let result = fault::with_tail_hook(
        move || {
            observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(
                (deadline + Duration::from_millis(10))
                    .saturating_duration_since(std::time::Instant::now()),
            );
        },
        || {
            fault::inject(Point::BeforeMember, 2, || {
                engine.invoke_program_batch(&mut members)
            })
        },
    );
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(
        result.iter().all(Result::is_err),
        "late verified tail must abort: {result:?}"
    );
    assert_eq!(snapshot(&mut engine), before);
}
#[test]
fn batch_deadline_after_verified_tail_sqlite() {
    tail_deadline(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn batch_deadline_after_verified_tail_postgres() {
    tail_deadline(true);
}

#[test]
fn deferred_internal_tail_readers_are_ineligible() {
    let mut engine = fixture(false);
    let original = engine.programs["increment"].clone();
    for table in [
        "_commits",
        "_log",
        "_change_evidence",
        "_outbox",
        "_effect_presence",
        "_ops",
    ] {
        let mut program = original.clone();
        // A nested expression is still a dependency, even on an untaken arm.
        let read = crate::ir::Expr::Exists(crate::ir::Read {
            table: table.into(),
            index: "id".into(),
            key: vec![crate::ir::Expr::Literal(Value::Id("x".into()))],
            site: "tail-reader".into(),
            provenance: crate::ir::KeyProvenance::Const,
        });
        program.body.insert(
            0,
            crate::ir::Stmt::If {
                condition: crate::ir::Expr::Literal(Value::Bool(false)),
                then_body: vec![crate::ir::Stmt::Return(read)],
                else_body: vec![],
            },
        );
        engine.programs.insert("increment".into(), program);
        assert!(
            !intent(19, 1).eligible(&engine),
            "deferred tail reader {table} must be solo"
        );
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn solo_authority_refusal_cannot_hide_unknown_physical_rollback() {
    let mut engine = fixture(true);
    let pid: i32 = engine
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT pg_backend_pid()", &[])
        .unwrap()
        .get(0);
    eprintln!("G23 fix1 owned solo rollback-fault backend PID {pid}");
    let mut control = postgres::Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        postgres::NoTls,
    )
    .unwrap();
    let mut member = intent(19, 1).authorized(
        "missing".into(),
        || crate::identity::ServiceSample {
            now: 1000,
            supervisor_revision: 0,
        },
        move |_| {
            assert!(
                control
                    .query_one("SELECT pg_terminate_backend($1)", &[&pid])
                    .unwrap()
                    .get::<_, bool>(0)
            );
            Err(crate::Refusal::new(
                "E_AUTH",
                "auth",
                "authority refused before failed rollback",
            ))
        },
    );
    assert_eq!(
        engine.invoke_program(&mut member).unwrap_err().code,
        "E_COMMIT_OUTCOME_UNKNOWN"
    );
}


// @ref LLP 3000.036.004.000#2-column-write-authority — batching retains creation, replacement and removal authority.
fn grouped_column_security(pg: bool) {
    let source = r#"table docs:
  owner: principal
  cell: text ? write <- .owner = viewer
  approved: bool default false
  immutable cell when .approved = true
  public 'batch security fixture'
  insert <- allow
  update <- allow
  online only
mutation setup():
  insert docs {id:'doc',owner:viewer,cell:'original'}
mutation put(id: docs, owner: principal, cell: text ?):
  return upsert docs[id] {owner,cell}
mutation edit(id: docs, owner: principal, cell: text ?):
  return update docs[id] {owner,cell}
mutation approve(id: docs):
  return update docs[id] {approved:true}
mutation thaw(id: docs, cell: text ?):
  return update docs[id] {approved:false,cell}
"#;
    let cases = [
        ("edit", "bob", "doc", "alice", Some("forged"), false),
        ("edit", "bob", "doc", "bob", Some("takeover"), false),
        ("edit", "alice", "doc", "alice", Some("edited"), true),
        ("approve", "alice", "doc", "alice", None, true),
        ("thaw", "alice", "doc", "alice", Some("thawed"), false),
        ("edit", "alice", "doc", "alice", None, false),
        ("put", "alice", "doc", "alice", Some("replaced"), false),
        ("put", "bob", "spare", "alice", None, true),
        ("edit", "bob", "spare", "alice", Some("forged"), false),
        ("edit", "alice", "spare", "alice", Some("authorized"), true),
        ("approve", "alice", "spare", "alice", None, true),
        ("thaw", "alice", "spare", "alice", None, false),
    ];
    let intent = |i: usize| {
        let (name, viewer, id, owner, cell, _) = cases[i];
        let mut args = std::collections::BTreeMap::from([("id".into(), Value::Id(id.into()))]);
        if matches!(name, "put" | "edit") { args.insert("owner".into(), Value::Id(owner.into())); }
        if name != "approve" { args.insert("cell".into(), cell.map(|v| Value::String(v.into())).unwrap_or(Value::Null)); }
        Invocation::new(name, (i % 2 == 0).then(||format!("column-op-{i}")), Context::new(viewer,args).at(1000))
    };
    let mut serial = fixture_source(pg, source);
    let expected: Vec<_> = (0..cases.len()).map(|i| serial.invoke_program(&mut intent(i)).unwrap().outcome).collect();
    for (case, outcome) in cases.iter().zip(&expected) {
        assert_eq!(matches!(outcome.state, crate::WriteState::Sent {..}), case.5, "{case:?}: {outcome:?}");
    }
    let expected_snapshot = snapshot(&mut serial);
    for width in [2, 4, 12] {
        let mut grouped = fixture_source(pg, source);
        let mut actual = Vec::new();
        for start in (0..cases.len()).step_by(width) {
            let mut members: Vec<_> = (start..(start+width).min(cases.len())).map(&intent).collect();
            actual.extend(grouped.invoke_program_batch(&mut members).into_iter().map(|r|r.unwrap().outcome));
        }
        assert_eq!(actual, expected, "column authority/approval at batch width {width}");
        assert_eq!(snapshot(&mut grouped), expected_snapshot, "durable history at batch width {width}");
    }
}
#[test]
fn grouped_column_security_sqlite() { grouped_column_security(false); }
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; column authority and conditional immutability across grouped execution"]
fn grouped_column_security_postgres() { grouped_column_security(true); }
