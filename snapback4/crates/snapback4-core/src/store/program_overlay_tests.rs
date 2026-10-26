//! S1 closure differential: intermediate outcomes and complete serial history.
use crate::{
    Context, Engine, Program, Schema, Value, engine::program::Invocation, store_port::AnyStore,
};
use std::time::{Duration, Instant};
const S1: &str =
    include_str!("../../../../experiments/scale-controls/snapback-app/snapback/schema.q");
const EXTRA: &str = r#"
table auditCounters:
  n: int
  public
  update <- allow
  sync public
mutation publicStep(key: auditCounters, reject: bool):
  c = auditCounters[key] ! else NOT_FOUND
  update auditCounters[key] { n: c.n + 1 }
  require reject = false else NO
  return auditCounters[key]

mutation guarded(counter: counters, delta: int, reject: bool):
  c = counters[counter] ! else NOT_FOUND
  update counters[c.id] { n: c.n + delta }
  require reject = false else NO
  return counters[counter]
mutation chain(source: counters, target: counters):
  c = counters[source] ! else NOT_FOUND
  update counters[target] { n: c.n + 1 }
  return { before: c, after: counters[target], again: counters[source] }
mutation cross(left: counters, right: counters, target: counters, reject: bool):
  l = counters[left] ! else NOT_FOUND
  r = counters[right] ! else NOT_FOUND
  if l.n = r.n:
    update counters[target] { n: l.n + 1 }
  else:
    update counters[target] { n: l.n + r.n + 1 }
  require reject = false else NO
  return { left: l, right: r, after: counters[target], again: counters[left] }
mutation clocked(counter: counters):
  return update counters[counter] { n: now }
mutation uniqueEdit(room: rooms):
  return update memberships[room, viewer] { last_read: 2 }
"#;
pub(super) fn fixture(pg: bool) -> Engine {
    fixture_with_sync(pg, false)
}
fn fixture_with_sync(pg: bool, sync: bool) -> Engine {
    let source = format!("{S1}\n{EXTRA}");
    let source = if sync {
        // Keep increment's eligible point-update shape and record its images.
        source.replace(
            "  read <- .owner = viewer or (.owner = null and exists memberships[.room, viewer])\n  update <- .owner = viewer or (.owner = null and exists memberships[.room, viewer])\n  online only",
            "  public\n  update <- allow\n  sync public",
        )
    } else {
        source
    };
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
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
                &format!("sb4_g3b_{:x}", crate::ids::seed()),
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
    let row = |json: serde_json::Value| {
        Value::Row(
            json.as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        match v {
                            serde_json::Value::String(s) => Value::Id(s.clone()),
                            serde_json::Value::Number(n) => Value::Int(n.as_i64().unwrap()),
                            serde_json::Value::Null => Value::Null,
                            _ => panic!("fixture scalar"),
                        },
                    )
                })
                .collect::<std::collections::BTreeMap<_, _>>()
                .into(),
        )
    };
    let mut seed = vec![
        ("rooms".into(), row(serde_json::json!({"id":"r"}))),
        (
            "memberships".into(),
            row(serde_json::json!({"id":"ma","room":"r","principal":"alice","last_read":0})),
        ),
    ];
    for id in ["a", "b", "shared"]
        .into_iter()
        .map(String::from)
        .chain((0..32).map(|n| format!("k{n}")))
    {
        seed.push(("counters".into(),row(serde_json::json!({"id":id,"owner":if id=="shared" {serde_json::Value::Null}else{serde_json::json!("alice")},"room":"r","n":0}))));
    }
    seed.push((
        "auditCounters".into(),
        row(serde_json::json!({"id":"public","n":0})),
    ));
    engine.seed_at(seed, 1000).unwrap();
    engine
}
fn member(seed: u64, n: usize) -> Invocation {
    let x = seed
        .wrapping_mul(6364136223846793005)
        .rotate_left((n % 63) as u32)
        .wrapping_add(n as u64 * 797);
    let key = match x % 9 {
        0 => "missing".into(),
        1 => "shared".into(),
        2 => "a".into(),
        3 => "b".into(),
        _ => format!("k{}", x % 32),
    };
    let mut invocation = Invocation::new(
        "guarded",
        (n % 3 != 0).then(|| format!("op-{n}")),
        Context::new(
            if x % 11 == 0 { "bob" } else { "alice" },
            [
                ("counter".into(), Value::Id(key)),
                ("delta".into(), Value::Int((x % 17) as i64 - 8)),
                ("reject".into(), Value::Bool(x % 7 == 0)),
            ]
            .into(),
        )
        .at(1000 + n as i64),
    );
    invocation.deadline = Instant::now() + Duration::from_secs(10);
    invocation
}
fn outcome(
    result: Result<crate::engine::MutationAcknowledgement, crate::Refusal>,
) -> serde_json::Value {
    match result {
        Ok(ack) => serde_json::to_value(ack.outcome).unwrap(),
        Err(why) => serde_json::json!({"error":why}),
    }
}
fn oracle(pg: bool) {
    for seed in [1, 19, 0xdecaf] {
        let mut reference = fixture(pg);
        let expected = (0..192)
            .map(|i| outcome(reference.invoke_program(&mut member(seed, i))))
            .collect::<Vec<_>>();
        for size in [8, 32] {
            let mut engine = fixture(pg);
            let mut actual = Vec::new();
            let mut buffered = 0;
            for start in (0..192).step_by(size) {
                let mut batch = (start..start + size)
                    .map(|i| member(seed, i))
                    .collect::<Vec<_>>();
                actual.extend(
                    engine
                        .invoke_program_batch(&mut batch)
                        .into_iter()
                        .map(outcome),
                );
                for i in &batch {
                    buffered += usize::from(i.attempts.last().unwrap().buffered);
                }
            }
            assert_eq!(actual, expected, "seed={seed},N={size},pg={pg}");
            assert_eq!(
                super::tests::snapshot(&mut engine),
                super::tests::snapshot(&mut reference)
            );
            assert_eq!(buffered, 192, "all bounded members must use the overlay");
        }
    }
}
#[test]
fn overlay_serial_history_sqlite() {
    oracle(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_serial_history_postgres() {
    oracle(true);
}

fn per_member_arguments(pg: bool) {
    let make = |n| {
        let mut args = [
            ("counter".into(), Value::Id(if n % 2 == 0 {"a"} else {"b"}.into())),
            ("delta".into(), Value::Int(n + 2)),
            ("reject".into(), Value::Bool(false)),
        ].into_iter().collect::<std::collections::BTreeMap<_,_>>();
        match n {
            2 => {args.insert("delta".into(), Value::String("bad".into()));},
            3 => {args.insert("extra".into(), Value::Int(1));},
            4 => {args.remove("delta");},
            _ => {},
        }
        Invocation::new("guarded",None,Context::new("alice",args).at(1000+n))
    };
    let mut reference=fixture(pg);
    let expected=(0..7).map(|n|outcome(reference.invoke_program(&mut make(n)))).collect::<Vec<_>>();
    let mut engine=fixture(pg);let mut batch=(0..7).map(make).collect::<Vec<_>>();
    crate::engine::committer::closure::PLAN_BUILDS.with(|count| count.set(0));
    let actual=engine.invoke_program_batch(&mut batch).into_iter().map(outcome).collect::<Vec<_>>();
    assert_eq!(crate::engine::committer::closure::PLAN_BUILDS.with(|count| count.get()), batch.len(),
        "classification plans must be reused, including lookahead across malformed members");
    assert_eq!(actual,expected,"static admission must not reuse another member's arguments");
    assert_eq!(super::tests::snapshot(&mut engine),super::tests::snapshot(&mut reference));
    assert_eq!(batch.iter().filter(|i|i.attempts.last().is_some_and(|a|a.buffered)).count(),4,
        "valid members on both sides of malformed inputs must exercise the wave");
}
#[test] fn batch_plans_keep_per_member_arguments_sqlite(){per_member_arguments(false);}
#[cfg(feature="postgres")] #[test] #[ignore="private PG16"]
fn batch_plans_keep_per_member_arguments_postgres(){per_member_arguments(true);}

fn chains(pg: bool) {
    let mut reference = fixture(pg);
    let mut engine = fixture(pg);
    let intent = |n| {
        let (source, target) = match n {
            0 => ("a".into(), "b".into()),
            1 => ("b".into(), "k0".into()),
            _ => (format!("k{}", n - 2), format!("k{}", n - 1)),
        };
        Invocation::new(
            "chain",
            Some(format!("chain-{n}")),
            Context::new(
                "alice",
                [
                    ("source".into(), Value::Id(source)),
                    ("target".into(), Value::Id(target)),
                ]
                .into(),
            )
            .at(1000),
        )
    };
    let expected = (0..16)
        .map(|n| outcome(reference.invoke_program(&mut intent(n))))
        .collect::<Vec<_>>();
    let mut batch = (0..16).map(intent).collect::<Vec<_>>();
    let actual = engine
        .invoke_program_batch(&mut batch)
        .into_iter()
        .map(outcome)
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    assert_eq!(
        super::tests::snapshot(&mut engine),
        super::tests::snapshot(&mut reference)
    );
    assert_eq!(
        batch
            .iter()
            .filter(|i| i.attempts.last().unwrap().conflict_rerun)
            .count(),
        15
    );
}
#[test]
fn overlay_read_after_write_chain_sqlite() {
    chains(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_read_after_write_chain_postgres() {
    chains(true);
}
#[test]
fn bounded_selector_and_fallbacks() {
    let engine = fixture(false);
    for name in ["increment", "guarded", "chain"] {
        let mut context = member(19, 1).context;
        context.args.insert("source".into(), Value::Id("a".into()));
        context.args.insert("target".into(), Value::Id("b".into()));
        let p = &engine.programs[name];
        context.args.retain(|name, _| p.args.contains_key(name));
        let plan = crate::engine::committer::closure::Closure::new(
            &engine.schema,
            p,
            &context,
            engine.generation,
        );
        assert!(plan.is_some(), "{name}: {p:#?}");
    }
    for name in ["clocked", "post", "uniqueEdit"] {
        let mut context = Context::new(
            "alice",
            [
                ("counter".into(), Value::Id("a".into())),
                ("room".into(), Value::Id("r".into())),
                ("body".into(), Value::String("hi".into())),
            ]
            .into(),
        );
        let p = &engine.programs[name];
        context.args.retain(|name, _| p.args.contains_key(name));
        assert!(
            crate::engine::committer::closure::Closure::new(
                &engine.schema,
                p,
                &context,
                engine.generation
            )
            .is_none(),
            "{name}"
        );
    }
}
fn boundaries(pg: bool) {
    use super::fault::{self, Point::*};
    let intent = |n| {
        let mut i = member(19, n);
        i.context
            .args
            .insert("counter".into(), Value::Id("shared".into()));
        i.context.args.insert("reject".into(), Value::Bool(n == 3));
        i.context.viewer = "alice".into();
        i
    };
    for point in [
        BeforeFacts,
        AfterFacts,
        BeforeLevel,
        AfterLevel,
        BeforeMember,
        MemberSavepoint,
        ProgramSavepoint,
        ProgramRelease,
        MemberRelease,
        AfterMember,
        BeforeTail,
        AfterTail,
        BeforeCommit,
        AfterCommit,
    ] {
        let positions = if matches!(point, BeforeLevel | AfterLevel) {
            vec![0, 1]
        } else if matches!(
            point,
            BeforeMember
                | MemberSavepoint
                | ProgramSavepoint
                | ProgramRelease
                | MemberRelease
                | AfterMember
        ) {
            (0..8)
                .filter(|n| *n != 3 || point != ProgramRelease)
                .collect()
        } else {
            vec![usize::MAX]
        };
        for position in positions {
            let mut engine = fixture(pg);
            let mut reference = fixture(pg);
            let mut batch = (0..8).map(intent).collect::<Vec<_>>();
            let actual = fault::inject(point, position, || engine.invoke_program_batch(&mut batch));
            let named = matches!(
                point,
                BeforeMember
                    | MemberSavepoint
                    | ProgramSavepoint
                    | ProgramRelease
                    | MemberRelease
                    | AfterMember
            );
            for n in 0..8 {
                if named && n == position {
                    assert!(actual[n].is_err(), "{point:?}/{position}");
                    continue;
                }
                let expected = reference.invoke_program(&mut intent(n));
                if point == AfterCommit {
                    assert_eq!(
                        actual[n].as_ref().unwrap_err().code,
                        "E_COMMIT_OUTCOME_UNKNOWN"
                    );
                } else {
                    assert_eq!(
                        outcome(actual[n].clone()),
                        outcome(expected),
                        "{point:?}/{position}/{n}"
                    );
                }
            }
            assert_eq!(
                super::tests::snapshot(&mut engine),
                super::tests::snapshot(&mut reference),
                "{point:?}/{position}"
            );
            if point == AfterCommit {
                assert!(batch.iter().all(|i| i.attempts.len() == 1));
            }
        }
    }
}
#[test]
fn overlay_flight_and_member_boundaries_sqlite() {
    boundaries(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_flight_and_member_boundaries_postgres() {
    boundaries(true);
}
fn mixed_and_receipts(pg: bool) {
    let mut engine = fixture(pg);
    let mut reference = fixture(pg);
    let mut batch = (0..8)
        .map(|n| {
            let mut i = member(19, n);
            i.context.viewer = "alice".into();
            i.context
                .args
                .insert("counter".into(), Value::Id("a".into()));
            i.context.args.insert("reject".into(), Value::Bool(false));
            i
        })
        .collect::<Vec<_>>();
    batch[2] = Invocation::new(
        "clocked",
        None,
        Context::new("alice", [("counter".into(), Value::Id("a".into()))].into()).at(1007),
    );
    batch[4] = Invocation::new(
        "uniqueEdit",
        None,
        Context::new("alice", [("room".into(), Value::Id("r".into()))].into()).at(1008),
    );
    batch[5] = member(19, 0);
    batch[5].id = Some("duplicate".into());
    batch[6] = member(19, 0);
    batch[6].id = Some("duplicate".into());
    let mut expected = Vec::new();
    for i in &batch {
        let mut copy = Invocation::new(i.name.clone(), i.id.clone(), i.context.clone());
        expected.push(outcome(reference.invoke_program(&mut copy)));
    }
    let actual = engine
        .invoke_program_batch(&mut batch)
        .into_iter()
        .map(outcome)
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    assert_eq!(
        super::tests::snapshot(&mut engine),
        super::tests::snapshot(&mut reference)
    );
    assert!(!batch[2].attempts.last().is_some_and(|a| a.buffered));
    assert!(!batch[4].attempts.last().is_some_and(|a| a.buffered));
}
#[test]
fn overlay_mixed_fallback_and_duplicate_receipts_sqlite() {
    mixed_and_receipts(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_mixed_fallback_and_duplicate_receipts_postgres() {
    mixed_and_receipts(true);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; real COMMIT kill and ownership transfer"]
fn overlay_owned_commit_loss_and_takeover() {
    use crate::engine::command::{Command, ProgramCommand, Queue};
    use crate::store_port::{LeasePolicy, StoreLease};
    use postgres::{Client, NoTls};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    };
    let mut initial = fixture(true);
    let tx = initial.store_mut().transaction().unwrap();
    let namespace: String = tx
        .test_postgres_tx()
        .query("SELECT current_schema()::text", &[])
        .unwrap()[0]
        .get(0);
    tx.rollback().unwrap();
    let id = initial.store().store_identity().unwrap().unwrap();
    drop(initial);
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut lease =
        StoreLease::connect(&connection, &namespace, &id, "b001", LeasePolicy::default()).unwrap();
    assert!(lease.acquire().unwrap().is_some());
    let engine =
        Engine::open(AnyStore::open_postgres_owned(&connection, &namespace, &lease).unwrap())
            .unwrap();
    let head = engine.seq().unwrap();
    let mut queue = Queue::start_fixed(engine, 64, 32).unwrap();
    queue.hold_lease(lease, Duration::from_millis(500)).unwrap();
    let mut control = Client::connect(&connection, NoTls).unwrap();
    control
        .batch_execute(&format!(
            "SET search_path={namespace},pg_catalog;SET statement_timeout='10s'"
        ))
        .unwrap();
    let key = crate::ids::seed() as i64;
    control
        .query_one("SELECT pg_advisory_lock($1)", &[&key])
        .unwrap();
    control.batch_execute(&format!("CREATE FUNCTION overlay_commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('statement_timeout')<>'0' THEN RAISE EXCEPTION 'cancellable COMMIT';END IF;PERFORM pg_advisory_xact_lock({key});RETURN NEW;END $$;CREATE CONSTRAINT TRIGGER overlay_commit_barrier AFTER UPDATE ON r DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION overlay_commit_barrier()")).unwrap();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(10)).unwrap();
        }))
        .unwrap();
    started.recv_timeout(Duration::from_secs(10)).unwrap();
    let invocation = |n| {
        Invocation::new(
            "increment",
            Some(format!("owned-{n}")),
            Context::new("alice", [("counter".into(), Value::Id("a".into()))].into()).at(1000),
        )
    };
    let callbacks = Arc::new(AtomicUsize::new(0));
    let replies = (0..8)
        .map(|n| {
            let callbacks = callbacks.clone();
            queue
                .submit_program(ProgramCommand::new(invocation(n), move |_, out| {
                    callbacks.fetch_add(1, Ordering::SeqCst);
                    out
                }))
                .unwrap()
        })
        .collect::<Vec<_>>();
    release.send(()).unwrap();
    held.wait().unwrap();
    let until = Instant::now() + Duration::from_secs(10);
    let pid = loop {
        if let Some(row)=control.query_opt("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query='COMMIT' AND wait_event='advisory'",&[&format!("sb:{id}:b001:1")]).unwrap(){break row.get::<_,i32>(0);}
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(5));
    };
    eprintln!("overlay witness owns writer backend PID {pid}");
    assert_eq!(callbacks.load(Ordering::SeqCst), 0);
    assert_eq!(
        control
            .query_one("SELECT seq FROM _head", &[])
            .unwrap()
            .get::<_, i64>(0),
        head as i64
    );
    assert!(
        control
            .query_one("SELECT pg_terminate_backend($1)", &[&pid])
            .unwrap()
            .get::<_, bool>(0)
    );
    for reply in replies {
        assert_eq!(
            reply.wait().unwrap().unwrap_err().code,
            "E_COMMIT_OUTCOME_UNKNOWN"
        );
    }
    drop(queue);
    control
        .query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .unwrap();
    control
        .batch_execute(
            "DROP TRIGGER overlay_commit_barrier ON r;DROP FUNCTION overlay_commit_barrier()",
        )
        .unwrap();
    let mut successor =
        StoreLease::connect(&connection, &namespace, &id, "b002", LeasePolicy::default()).unwrap();
    assert!(successor.acquire().unwrap().is_some());
    let mut engine =
        Engine::open(AnyStore::open_postgres_owned(&connection, &namespace, &successor).unwrap())
            .unwrap();
    assert_eq!(engine.seq().unwrap(), head);
    for n in 0..8 {
        assert!(
            !engine
                .invoke_program(&mut invocation(n))
                .unwrap()
                .outcome
                .replayed
        );
    }
    for n in 0..8 {
        assert!(
            engine
                .invoke_program(&mut invocation(n))
                .unwrap()
                .outcome
                .replayed
        );
    }
    assert_eq!(engine.seq().unwrap(), head + 8);
    drop(engine);
    assert!(successor.release().unwrap());
    assert!(
        control
            .query_opt("SELECT pid FROM pg_stat_activity WHERE pid=$1", &[&pid])
            .unwrap()
            .is_none()
    );
}
fn intermediate_log(pg: bool) {
    let mut engine = fixture(pg);
    let mut reference = fixture(pg);
    let initial_head = engine.seq().unwrap();
    let intent = |n| {
        Invocation::new(
            "publicStep",
            Some(format!("public-{n}")),
            Context::new(
                "alice",
                [
                    ("key".into(), Value::Id("public".into())),
                    ("reject".into(), Value::Bool(n == 5)),
                ]
                .into(),
            )
            .at(1000 + n as i64),
        )
    };
    let expected = (0..32)
        .map(|n| outcome(reference.invoke_program(&mut intent(n))))
        .collect::<Vec<_>>();
    let mut batch = (0..32).map(intent).collect::<Vec<_>>();
    let actual = engine
        .invoke_program_batch(&mut batch)
        .into_iter()
        .map(outcome)
        .collect::<Vec<_>>();
    for (n, (actual, expected)) in actual.iter().zip(&expected).enumerate() {
        assert_eq!(actual, expected, "public member {n}");
    }
    assert!(batch.iter().all(|i| i.attempts.last().unwrap().buffered));
    let state = super::tests::snapshot(&mut engine);
    assert_eq!(state, super::tests::snapshot(&mut reference));
    assert_eq!(
        state["log"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event["seq"].as_u64().unwrap() > initial_head)
            .count(),
        31
    );
}
#[test]
fn overlay_preserves_intermediate_log_images_sqlite() {
    intermediate_log(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_preserves_intermediate_log_images_postgres() {
    intermediate_log(true);
}
fn suppressed_update(pg: bool) {
    let mut engine = fixture_with_sync(pg, true);
    let before = super::tests::snapshot(&mut engine);
    assert!(
        before["log"].as_array().unwrap().len() > 1,
        "synced counter images must be logged"
    );
    let tx = engine.store_mut().transaction().unwrap();
    if pg {
        #[cfg(feature = "postgres")]
        tx.test_postgres_tx().batch("CREATE FUNCTION suppress_image() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER suppress_image BEFORE UPDATE ON r FOR EACH ROW EXECUTE FUNCTION suppress_image()").unwrap();
    } else {
        tx.test_support_conn()
            .execute_batch(
                "CREATE TRIGGER suppress_image BEFORE UPDATE ON r BEGIN SELECT RAISE(IGNORE); END",
            )
            .unwrap();
    }
    tx.commit().unwrap();
    let mut batch = (0..8)
        .map(|n| {
            let mut invocation = Invocation::new(
                "increment",
                Some(format!("suppressed-{n}")),
                Context::new("alice", [("counter".into(), Value::Id("a".into()))].into()).at(1000),
            );
            // Keep solo retries live after the unnamed buffered-apply abort.
            invocation.deadline = Instant::now() + Duration::from_secs(30);
            invocation
        })
        .collect::<Vec<_>>();
    let actual = engine.invoke_program_batch(&mut batch);
    let after = super::tests::snapshot(&mut engine);
    eprintln!(
        "suppressed update pg={pg}: errors={}, receipts={}, head={}, log={}, attempts={:?}",
        actual.iter().filter(|r| r.is_err()).count(),
        after["receipts"].as_array().unwrap().len(),
        after["head"],
        after["log"].as_array().unwrap().len(),
        batch.iter().map(|i| i.attempts.len()).collect::<Vec<_>>()
    );
    let tx = engine.store_mut().transaction().unwrap();
    if pg {
        #[cfg(feature = "postgres")]
        tx.test_postgres_tx()
            .batch("DROP TRIGGER suppress_image ON r;DROP FUNCTION suppress_image()")
            .unwrap();
    } else {
        tx.test_support_conn()
            .execute_batch("DROP TRIGGER suppress_image")
            .unwrap();
    }
    tx.commit().unwrap();
    assert!(actual.iter().all(Result::is_err), "{actual:?}");
    assert!(
        actual.iter().all(|r| {
            let why = r.as_ref().unwrap_err();
            why.code == "E_STORE" && why.message.contains("row write count mismatch")
        }),
        "{actual:?}"
    );
    assert!(
        batch
            .iter()
            .all(|i| i.attempts.len() == 2 && i.attempts[0].buffered && !i.attempts[1].buffered),
        "the buffered apply must abort, then every member must run solo"
    );
    // Includes rows, receipts, commits, evidence, log, head and effects.
    assert_eq!(after, before);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; real apply suppression"]
fn overlay_apply_count_rejects_suppressed_image_and_rolls_back_history() {
    suppressed_update(true);
}
#[test]
fn overlay_apply_count_rejects_suppressed_image_and_rolls_back_history_sqlite() {
    suppressed_update(false);
}

fn counts(pg: bool) { counts_with_grant(pg, false); }
fn counts_with_grant(pg: bool, g6: bool) {
    let mut engine = fixture(pg);
    #[cfg(feature="postgres")]
    let grant = if g6 {
        let grant=std::sync::Arc::new(crate::engine::postgres::read_grant::Grant::default());
        grant.configured.store(true, std::sync::atomic::Ordering::Release);
        engine.store_mut().test_postgres_handle_mut().store.get_mut().read_grant=Some(grant.clone());
        Some(grant)
    } else { None };
    let session = crate::identity::open_session(engine.store(), "alice", "account", 1000).unwrap();
    let digest = crate::identity::session_digest(&session.token);
    for shared in [false, true] {
        for n in [1, 8, 32] {
            for repetition in 0..4 {
                let mut batch = (0..n)
                    .map(|i| {
                        Invocation::new(
                            "increment",
                            None,
                            Context::new(
                                "alice",
                                [(
                                    "counter".into(),
                                    Value::Id(if shared {
                                        "shared".into()
                                    } else {
                                        format!("k{i}")
                                    }),
                                )]
                                .into(),
                            )
                            .at(1000)
                            .with_request_credential("account"),
                        )
                        .authorized(
                            digest.clone(),
                            || crate::identity::ServiceSample {
                                now: 1000,
                                supervisor_revision: 0,
                            },
                            |facts| {
                                assert_eq!(facts.capability.unwrap().0, "alice");
                                Ok(())
                            },
                        )
                    })
                    .collect::<Vec<_>>();
                let scope = crate::round_trips::Scope::begin();
                let actual = engine.invoke_program_batch(&mut batch);
                assert!(actual.iter().all(
                    |o| matches!(o,Ok(a) if matches!(a.outcome.state,crate::WriteState::Sent{..}))
                ));
                let measured = scope.counts();
                drop(scope);
                #[cfg(feature="postgres")]
                if let Some(grant)=&grant {
                    let row=engine.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT revision,seq FROM _head WHERE singleton", &[]).unwrap();
                    let state=grant.state.read().unwrap();
                    let published=state.published.as_ref().expect("confirmed G6 publication");
                    assert_eq!((published.revision,published.head),(row.get::<_,i64>(0),row.get::<_,i64>(1) as u64));
                }
                if repetition == 3 {
                    eprintln!("G3b RT0 pg={pg} g6={g6} shared={shared} N={n}: {measured:?}");
                    if pg && n > 1 {
                        assert_eq!(measured.postgres, if shared { 4 } else { 3 });
                    }
                }
            }
        }
    }
}
#[test]
fn overlay_rt0_sqlite() {
    counts(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_rt0_postgres() {
    counts(true);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn parallel_and_serial_overlay_commit_timeouts_are_disabled_postgres() {
    for serial in [false, true] {
        let mut engine = fixture(true);
        super::tests::record_commit_settings(&mut engine);
        let before = engine.seq().unwrap();
        let mut batch = (0..8)
            .map(|n| {
                Invocation::new(
                    "increment",
                    None,
                    Context::new(
                        "alice",
                        [("counter".into(), Value::Id(format!("k{n}")))].into(),
                    )
                    .at(1000),
                )
            })
            .collect::<Vec<_>>();
        let mut run = || engine.invoke_program_batch(&mut batch);
        let results = if serial {
            crate::engine::committer::parallel::serial(run)
        } else {
            run()
        };
        assert!(
            results.iter().all(
                |r| matches!(r, Ok(a) if matches!(a.outcome.state, crate::WriteState::Sent { .. }))
            ),
            "{results:?}"
        );
        assert!(
            batch
                .iter()
                .all(|i| i.attempts.len() == 1 && i.attempts[0].buffered)
        );
        assert_eq!(engine.seq().unwrap(), before + 8);
        assert_eq!(super::tests::assert_commit_settings(&mut engine), 8);
    }
}

fn late_unknown(pg: bool) {
    use super::fault::{self, Point};
    let mut engine = fixture(pg);
    let mut reference = fixture(pg);
    let intent = |n| {
        let mut i = member(19, n);
        i.context.viewer = "alice".into();
        i.context
            .args
            .insert("counter".into(), Value::Id("a".into()));
        i
    };
    let expected = (0..8)
        .map(|n| outcome(reference.invoke_program(&mut intent(n))))
        .collect::<Vec<_>>();
    let mut batch = (0..8).map(intent).collect::<Vec<_>>();
    let actual = fault::inject(Point::OverlayUnsupported, 2, || {
        engine.invoke_program_batch(&mut batch)
    })
    .into_iter()
    .map(outcome)
    .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    assert_eq!(
        super::tests::snapshot(&mut engine),
        super::tests::snapshot(&mut reference)
    );
}
#[test]
fn overlay_late_unknown_falls_back_without_losing_a_member_sqlite() {
    late_unknown(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_late_unknown_falls_back_without_losing_a_member_postgres() {
    late_unknown(true);
}
fn oversized_facts(pg: bool) {
    for table in ["counters", "memberships"] {
        let mut engine = fixture(pg);
        let mut reference = fixture(pg);
        for e in [&mut engine, &mut reference] {
            // A valid optional declaration whose reservation exceeds the
            // batch optimization budget; no physical payload is needed.
            e.schema.tables.get_mut(table).unwrap().columns.insert(
                "spare".into(),
                crate::schema::ColumnType::Optional(Box::new(crate::schema::ColumnType::Text {
                    max: 3_000_000,
                })),
            );
        }
        let intent = |n| {
            let mut i = member(19, n);
            i.context.viewer = "alice".into();
            i.context
                .args
                .insert("counter".into(), Value::Id("shared".into()));
            i
        };
        let expected = (0..8)
            .map(|n| outcome(reference.invoke_program(&mut intent(n))))
            .collect::<Vec<_>>();
        let mut batch = (0..8).map(intent).collect::<Vec<_>>();
        let actual = engine
            .invoke_program_batch(&mut batch)
            .into_iter()
            .map(outcome)
            .collect::<Vec<_>>();
        assert_eq!(actual, expected, "{table}");
        assert!(batch.iter().all(|i| !i.attempts.last().unwrap().buffered));
        assert_eq!(
            super::tests::snapshot(&mut engine),
            super::tests::snapshot(&mut reference)
        );
    }
}
#[test]
fn overlay_large_declared_facts_fall_back_before_decoding_sqlite() {
    oversized_facts(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn overlay_large_declared_facts_fall_back_before_decoding_postgres() {
    oversized_facts(true);
}

// @ref LLP 3000.009.001.000.002#3.3 — compare complete ordered histories, including refused attempts and keyed receipts, against serial overlay execution.
fn parallel_differential(pg: bool) {
    for seed in [1, 19, 0xdecaf] {
        for size in [8, 32] {
            let mut serial = fixture(pg);
            let mut parallel = fixture(pg);
            for start in (0..192).step_by(size) {
                let make = || (start..start + size).map(|n| member(seed, n)).collect::<Vec<_>>();
                let mut a = make();
                let expected = crate::engine::committer::parallel::serial(|| serial.invoke_program_batch(&mut a))
                    .into_iter().map(outcome).collect::<Vec<_>>();
                let mut b = make();
                let actual = parallel.invoke_program_batch(&mut b).into_iter().map(outcome).collect::<Vec<_>>();
                assert_eq!(actual, expected, "seed={seed},N={size},start={start},pg={pg}");
                assert_eq!(super::tests::snapshot(&mut parallel), super::tests::snapshot(&mut serial));
                assert_eq!(
                    b.iter().map(|i|i.attempts.last().unwrap().conflict_rerun).collect::<Vec<_>>(),
                    a.iter().map(|i|i.attempts.last().unwrap().conflict_rerun).collect::<Vec<_>>()
                );
            }
        }
    }
    // Distinct targets with predecessor read dependencies force 15 reruns;
    // comparing both executors with N=1 also covers the adversarial chain.
    crate::engine::committer::parallel::serial(|| chains(pg));
    chains(pg);
    crate::engine::committer::parallel::serial(|| mixed_and_receipts(pg));
    mixed_and_receipts(pg);
    crate::engine::committer::parallel::serial(|| intermediate_log(pg));
    intermediate_log(pg);
}
#[test]
fn parallel_matches_serial_overlay_sqlite() { parallel_differential(false); }
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16"]
fn parallel_matches_serial_overlay_postgres() { parallel_differential(true); }

fn colliding_parallel(pg: bool) {
    for seed in [1usize, 7, 19] {
        for size in [8, 32] {
            let mut serial = fixture_with_sync(pg, true);
            let mut parallel = fixture_with_sync(pg, true);
            let mut reruns = 0;
            for round in 0..4 {
                let intent = |n: usize| {
                    // Every target is distinct (so it IS speculated), while
                    // crossed reads form cycles, diamonds and reverse edges.
                    let key = |i| Value::Id(format!("k{}", (i * seed + round) % size));
                    let mut i = Invocation::new(
                        "cross",
                        Some(format!("cross-{round}-{n}")),
                        Context::new(
                            "alice",
                            [
                                ("left".into(), key((n + size - 1) % size)),
                                ("right".into(), key((n + size - 3) % size)),
                                ("target".into(), key(n)),
                                ("reject".into(), Value::Bool((n + round) % 7 == 3)),
                            ]
                            .into(),
                        )
                        .at(1000 + round as i64),
                    );
                    i.deadline = Instant::now() + Duration::from_secs(30);
                    i
                };
                let expected = (0..size)
                    .map(|n| outcome(serial.invoke_program(&mut intent(n))))
                    .collect::<Vec<_>>();
                let mut batch = (0..size).map(intent).collect::<Vec<_>>();
                let actual = parallel
                    .invoke_program_batch(&mut batch)
                    .into_iter()
                    .map(outcome)
                    .collect::<Vec<_>>();
                assert_eq!(
                    actual, expected,
                    "crossed reads seed={seed},size={size},round={round},pg={pg}"
                );
                assert_eq!(
                    super::tests::snapshot(&mut parallel),
                    super::tests::snapshot(&mut serial)
                );
                assert!(
                    batch
                        .iter()
                        .all(|i| i.attempts.len() == 1 && i.attempts[0].buffered)
                );
                reruns += batch
                    .iter()
                    .filter(|i| i.attempts[0].conflict_rerun)
                    .count();
                assert!(
                    actual.iter().any(|v| v["state"] == "failed"),
                    "exercise discarded writes and charges"
                );
            }
            assert!(
                reruns >= size,
                "adversarial case must collide after speculation"
            );
        }
    }
}
#[test]
fn colliding_parallel_matches_n1_sqlite() {
    colliding_parallel(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn colliding_parallel_matches_n1_postgres() {
    colliding_parallel(true);
}

// Exercise the real selector, probe prefetch and read recording, including a
// unique plain-index Exists span and a predecessor image conflict.
fn admitted_membership_probes(pg: bool) {
    use crate::Rows;
    let mut engine = fixture(pg);
    let table = engine.schema().tables["counters"].clone();
    let tx = engine.store_mut().transaction().unwrap();
    for id in ["a".to_string(), "b".to_string()].into_iter().chain((0..32).map(|n|format!("k{n}"))) {
        let old = tx.get("counters", &id).unwrap().unwrap();
        let mut row = old.clone();
        if let Value::Row(fields) = &mut row { fields.insert("owner".into(), Value::Null); }
        tx.put("counters", &table, &row, Some(&old)).unwrap();
    }
    tx.commit().unwrap();
    let mut batch = (0..32).map(|n| {
        let mut i = Invocation::new("guarded", Some(format!("member-{n}")),
            Context::new("alice", [("counter".into(), Value::Id(format!("k{n}"))),
                ("delta".into(), Value::Int(1)), ("reject".into(), Value::Bool(false))].into()).at(1000));
        i.deadline = Instant::now()+Duration::from_secs(30); i
    }).collect::<Vec<_>>();
    let outcomes = engine.invoke_program_batch(&mut batch);
    assert!(outcomes.iter().all(|r|matches!(&r.as_ref().unwrap().outcome.state, crate::WriteState::Sent {..})), "{outcomes:?}");
    assert!(batch.iter().all(|i| i.attempts.len()==1 && i.attempts[0].buffered && !i.attempts[0].conflict_rerun), "{:?}", batch.iter().map(|i|(i.attempts.len(), i.attempts.last().map(|a|(a.buffered,a.conflict_rerun)))).collect::<Vec<_>>());
    let mut missing = (0..4).map(|n| Invocation::new("guarded", Some(format!("absent-{n}")),
        Context::new("bob", [("counter".into(),Value::Id(format!("k{n}"))),
            ("delta".into(),Value::Int(1)),("reject".into(),Value::Bool(false))].into()).at(1000))).collect::<Vec<_>>();
    assert!(engine.invoke_program_batch(&mut missing).iter().all(|r|matches!(r.as_ref().unwrap().outcome.state,crate::WriteState::Failed {..})));
    assert!(missing.iter().all(|i|i.attempts[0].buffered && !i.attempts[0].conflict_rerun), "covered absence is a stable span too");
    let mut collision = [("a", "b"), ("b", "a")].into_iter().enumerate().map(|(n,(source,target))| {
        let mut i=Invocation::new("chain",Some(format!("collision-{n}")), Context::new("alice",
            [("source".into(),Value::Id(source.into())),("target".into(),Value::Id(target.into()))].into()).at(1000));
        i.deadline=Instant::now()+Duration::from_secs(30); i
    }).collect::<Vec<_>>();
    assert!(engine.invoke_program_batch(&mut collision).iter().all(Result::is_ok));
    assert!(collision.iter().all(|i|i.attempts[0].buffered));
    assert!(!collision[0].attempts[0].conflict_rerun);
    assert!(collision[1].attempts[0].conflict_rerun);
    assert_eq!(engine.store().rows("counters").unwrap().iter().find(|r|r.field("id").unwrap().as_str().unwrap()=="a").unwrap().field("n").unwrap(), &Value::Int(2));
}
#[test]
fn admitted_membership_probes_speculate_and_validate_sqlite() { admitted_membership_probes(false); }
#[cfg(feature="postgres")]
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn admitted_membership_probes_speculate_and_validate_postgres() { admitted_membership_probes(true); }

#[cfg(feature = "postgres")]
#[path = "program_g71_tests.rs"]
mod g71_tests;

#[cfg(feature="postgres")]
#[test]
#[ignore = "private Postgres"]
fn overlay_rt0_postgres_g6() { counts_with_grant(true, true); }

#[cfg(feature="postgres")]
#[path="program_g72_tests.rs"]
mod g72_tests;

#[test]
fn g72_sqlite_wal_reader_folds_a_held_uncommitted_predecessor() {
    use crate::engine::{committer::wave::Wave,mutation::ProgramHost,program_pipeline::Chain};
    use crate::rows::Rows;
    for seed in [1u64,19,0xdecaf] {
        let mut reference=fixture(false);
        let directory=std::env::temp_dir().join(format!("sb4-g72-fold-{:x}",crate::ids::seed()));
        std::fs::create_dir(&directory).unwrap();let path=directory.join("store.sqlite");
        reference.store().snapshot_to(&path).unwrap();
        rusqlite::Connection::open(&path).unwrap().execute_batch("PRAGMA journal_mode=WAL").unwrap();
        let mut writer=AnyStore::open(&path).unwrap();let mut reader=AnyStore::open_read_only(&path).unwrap();
        for n in 0..96 {
            let random=seed.wrapping_mul(6364136223846793005).rotate_left(n%63).wrapping_add(n as u64*797);
            let source=["a","b","shared"][(random%3)as usize];
            let targets=["a","b","shared"].into_iter().filter(|id|*id!=source).collect::<Vec<_>>();
            let mut predecessor=Invocation::new("guarded",Some(format!("p-{n}")),Context::new("alice",[("counter".into(),Value::Id(source.into())),("delta".into(),Value::Int(1+(random%7)as i64)),("reject".into(),Value::Bool(false))].into()).at(1000+n as i64));
            reference.invoke_program(&mut predecessor).unwrap();
            let image=reference.store().rows("counters").unwrap().into_iter().find(|r|r.field("id").unwrap().as_str().unwrap()==source).unwrap();
            let tx=writer.transaction().unwrap();let old=tx.get("counters",source).unwrap().unwrap();tx.put("counters",&reference.schema.tables["counters"],&image,Some(&old)).unwrap();
            let snapshot=reader.read_transaction().unwrap();assert_ne!(snapshot.test_batch_tx().get("counters",source).unwrap(),Some(image.clone()),"the WAL reader must see the old base");
            let chain=Chain{images:[(("counters".into(),source.into()),image.clone())].into(),entropy:reference.entropy,..Default::default()};
            let batch=targets.iter().map(|target|Invocation::new("chain",None,Context::new("alice",[("source".into(),Value::Id(source.into())),("target".into(),Value::Id((*target).into()))].into()).at(1000+n as i64))).collect::<Vec<_>>();
            let host=ProgramHost{schema:&reference.schema,programs:&reference.programs,entropy:reference.entropy,minter:&reference.minter,presence:reference.presence.clone(),ceilings:reference.ceilings,store_id:&reference.store_id,generation:reference.generation,dev_effects:reference.dev_effects,#[cfg(feature="evaluation-support")] evaluation_precharge:reference.evaluation_precharge};
            let plans=batch.iter().map(|i|crate::engine::committer::closure::Closure::new(host.schema,&host.programs[&i.name],&i.context,host.generation).unwrap()).collect();
            let mut wave=Wave::prepare_chained(snapshot.test_batch_tx(),&host,&batch,&[0,1],Some(&chain),plans).unwrap().unwrap();
            let prepared=(0..2).map(|i|wave.take(i).0.unwrap().execution).collect::<Vec<_>>();
            drop(host);snapshot.rollback().unwrap();tx.commit().unwrap();
            for (execution,mut invocation) in prepared.into_iter().zip(batch) {
                let expected=reference.invoke_program(&mut invocation).unwrap().outcome;
                let crate::engine::WriteState::Sent{result,..}=expected.state else {panic!("serial child must commit")};
                assert_eq!(execution.ran.unwrap(),result,"seed={seed},held chain iteration={n}");
                assert_eq!(execution.metered,expected.metered,"fold must preserve every meter");
                assert_eq!(execution.tables,expected.tables);assert_eq!(execution.events.len(),expected.events);
            }
            // Advance the WAL writer's row prefix to the serial reference before
            // holding the next predecessor. The read-only wave never writes.
            let tx=writer.transaction().unwrap();
            for id in ["a","b","shared"] {
                let row=reference.store().rows("counters").unwrap().into_iter().find(|r|r.field("id").unwrap().as_str().unwrap()==id).unwrap();
                let old=tx.get("counters",id).unwrap().unwrap();tx.put("counters",&reference.schema.tables["counters"],&row,Some(&old)).unwrap();
            }
            tx.commit().unwrap();
        }
        drop(reader);drop(writer);std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(feature="postgres")]
#[test]
#[ignore="private Postgres"]
fn g72_queued_second_wave_interprets_while_first_commit_is_held() {
    use crate::engine::command::{Command,ProgramCommand,Queue};
    use postgres::{Client,NoTls};
    use std::sync::{Arc,mpsc,atomic::{AtomicUsize,Ordering}};
    let mut engine=fixture(true);
    let handle=engine.store_mut().test_postgres_handle_mut();
    let schema:String=handle.store.get_mut().client.query_one("SELECT current_schema()",&[]).unwrap().get(0);
    let tag=format!("sb:{}:0000:0",engine.store_id);
    let mut watch=Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),NoTls).unwrap();
    watch.batch_execute(&format!("SET search_path={schema},pg_catalog;SET statement_timeout='10s'")).unwrap();
    let queue=Queue::start_fixed(engine,64,8).unwrap();
    let invocation=|i:usize|Invocation::new("increment",None,Context::new("alice",[("counter".into(),Value::Id(format!("k{}",i%32)))].into()).at(1000));
    for warm in 0..2 {
        let replies=(warm*8..warm*8+8).map(|i|queue.submit_program(ProgramCommand::new(invocation(i),|_,v|v)).unwrap()).collect::<Vec<_>>();
        for reply in replies {assert!(reply.wait().unwrap().is_ok());}
    }
    let head:i64=watch.query_one("SELECT seq FROM _head WHERE singleton",&[]).unwrap().get(0);
    let key=(crate::ids::seed()&i64::MAX as u64)as i64;
    watch.query_one("SELECT pg_advisory_lock($1)",&[&key]).unwrap();
    watch.batch_execute(&format!("CREATE FUNCTION g72_queue_hold() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.seq<={} THEN PERFORM pg_advisory_xact_lock({key}::bigint); END IF;RETURN NEW;END $f$;CREATE CONSTRAINT TRIGGER g72_queue_hold AFTER INSERT ON _commits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION g72_queue_hold()",head+8)).unwrap();
    let (started,ready)=mpsc::channel();let (release,resume)=mpsc::channel();
    let barrier=queue.submit(Command::new(move|_|{started.send(()).unwrap();resume.recv_timeout(Duration::from_secs(10)).unwrap();})).unwrap();
    ready.recv_timeout(Duration::from_secs(10)).unwrap();
    let (interpreted,seen)=mpsc::channel();let published=Arc::new(AtomicUsize::new(0));
    let replies=(0..16).map(|i| {
        let signal=interpreted.clone();let count=published.clone();
        let intent=invocation(i).instrument(move|run|{run();if i>=8 {signal.send(()).unwrap();}});
        queue.submit_program(ProgramCommand::new(intent,move|_,v|{count.fetch_add(1,Ordering::SeqCst);v})).unwrap()
    }).collect::<Vec<_>>();
    release.send(()).unwrap();barrier.wait().unwrap();
    let until=Instant::now()+Duration::from_secs(10);
    loop {
        let waiting:bool=watch.query_one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND query='COMMIT' AND wait_event='advisory')",&[&tag]).unwrap().get(0);
        if waiting {break;}assert!(Instant::now()<until,"first final must reach held COMMIT");std::thread::sleep(Duration::from_millis(1));
    }
    let overlap=seen.recv_timeout(Duration::from_secs(1)).is_ok();
    let early=published.load(Ordering::SeqCst);
    watch.query_one("SELECT pg_advisory_unlock($1)",&[&key]).unwrap();
    let results=replies.into_iter().map(|r|r.wait().unwrap()).collect::<Vec<_>>();
    drop(queue);watch.batch_execute("DROP TRIGGER g72_queue_hold ON _commits;DROP FUNCTION g72_queue_hold()").unwrap();
    assert!(overlap,"the second wave must interpret before the first COMMIT confirmation");
    assert_eq!(early,0,"no continuation or reply may pass the held first COMMIT");
    assert!(results.iter().all(Result::is_ok));
}

#[cfg(feature="postgres")]
#[path="program_g7e_tests.rs"]
mod g7e_tests;
