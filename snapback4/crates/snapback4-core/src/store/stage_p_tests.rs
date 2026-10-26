//! Stage P upgrades/refusals and the typed-tail durable-state oracle.
use super::*;
use crate::RuntimeError;
use postgres::{Client, NoTls};

fn observer(e: &mut Engine) -> (Client, String) {
    let r = e
        .store_mut()
        .test_postgres_handle_mut()
        .store
        .get_mut()
        .client
        .query_one("SELECT current_schema()::text", &[])
        .unwrap();
    let schema = r.get::<_, String>(0);
    let mut c = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
    c.batch_execute(&format!(
        "SET search_path=\"{schema}\",pg_catalog; SET statement_timeout='5s'"
    ))
    .unwrap();
    (c, schema)
}
fn functions(c: &mut Client) -> Vec<(String, String)> {
    c.query("SELECT p.proname::text,pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname ~ '^_sb4_(guard|fence)_' ORDER BY p.proname",&[]).unwrap().iter().map(|r|(r.get(0),r.get(1))).collect()
}
fn increment(e: &mut Engine) -> Result<crate::MutationOutcome, RuntimeError> {
    e.mutate(
        "increment",
        None,
        Context::new(
            "alice",
            [
                ("key".into(), Value::Id("a".into())),
                ("delta".into(), Value::Int(1)),
                ("reject".into(), Value::Bool(false)),
            ]
            .into(),
        )
        .at(1001)
        .with_ids(["new-entry".into()]),
    )
}
fn reopen(schema: &str) -> Result<Engine, RuntimeError> {
    Engine::open_at(
        AnyStore::open_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), schema)?,
        1000,
    )
}
#[test]
#[ignore = "private Postgres"]
fn stage_p_existing_store_upgrades_once_under_inline_fence() {
    let mut e = fixture(true);
    let (mut c, schema) = observer(&mut e);
    drop(e);
    for (_, signature) in functions(&mut c) {
        c.batch_execute(&format!("DROP FUNCTION {signature}"))
            .unwrap();
    }
    c.execute("DELETE FROM _meta WHERE key='flight_checks_v1' OR pg_catalog.starts_with(key,'flight_check:')", &[])
        .unwrap();
    let mut e = reopen(&schema).unwrap();
    assert_eq!(functions(&mut c).len(), 2);
    let before=c.query("SELECT oid::bigint FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname ~ '^_sb4_(guard|fence)_' ORDER BY oid",&[]).unwrap().iter().map(|r|r.get::<_,i64>(0)).collect::<Vec<_>>();
    increment(&mut e).unwrap();
    drop(e);
    let _e = reopen(&schema).unwrap();
    let after=c.query("SELECT oid::bigint FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname ~ '^_sb4_(guard|fence)_' ORDER BY oid",&[]).unwrap().iter().map(|r|r.get::<_,i64>(0)).collect::<Vec<_>>();
    assert_eq!(before, after, "present checks must never be replaced");
}
#[test]
#[ignore = "private Postgres"]
fn stage_p_tampered_function_attributes_refuse_open_and_lease() {
    use crate::store_port::{LeasePolicy, StoreLease};
    for kind in ["guard", "fence"] {
        for tamper in [
            "search_path",
            "owner",
            "body",
            "security",
            "volatility",
            "language",
            "signature",
        ] {
            let mut e = fixture(true);
            let (mut c, schema) = observer(&mut e);
            let id = e.store().store_identity().unwrap().unwrap();
            drop(e);
            let (_, signature) = functions(&mut c)
                .into_iter()
                .find(|(n, _)| n.contains(kind))
                .expect("installed function");
            let role = format!("stp_owner_{:x}", crate::ids::seed());
            match tamper {
            "search_path"=>c.batch_execute(&format!("ALTER FUNCTION {signature} SET search_path=public,pg_catalog")).unwrap(),
            "owner"=>c.batch_execute(&format!("CREATE ROLE {role}; ALTER FUNCTION {signature} OWNER TO {role}")).unwrap(),
            "security"=>c.batch_execute(&format!("ALTER FUNCTION {signature} SECURITY DEFINER")).unwrap(),
            "volatility"=>c.batch_execute(&format!("ALTER FUNCTION {signature} STABLE")).unwrap(),
            "signature"=>{
                c.batch_execute(&format!("DROP FUNCTION {signature}")).unwrap();
                let name=signature.split('(').next().unwrap();
                c.batch_execute(&format!("CREATE FUNCTION {name}(pg_catalog.text) RETURNS pg_catalog.void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS 'BEGIN RETURN; END'")).unwrap();
            },
            _=>c.batch_execute(&format!("CREATE OR REPLACE FUNCTION {signature} RETURNS void LANGUAGE {} VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS '{}'",if tamper=="language" {"sql"} else {"plpgsql"},if tamper=="language" {"SELECT NULL::void"} else {"BEGIN RETURN; END"})).unwrap(),
        }
            assert!(reopen(&schema).is_err(), "{kind}/{tamper}");
            let error = AnyStore::postgres_diagnostics(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
                &schema,
            )
            .expect_err("doctor must reject the same catalog tampering");
            assert_eq!(
                error.code(),
                "E_STORE_OWNERSHIP",
                "doctor {kind}/{tamper}: {error:?}"
            );
            assert!(
                StoreLease::connect(
                    &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
                    &schema,
                    &id,
                    "c003",
                    LeasePolicy::default()
                )
                .is_err(),
                "lease {kind}/{tamper}"
            );
            c.batch_execute(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
                .unwrap();
            if tamper == "owner" {
                c.batch_execute(&format!("DROP ROLE {role}")).unwrap();
            }
        }
    }
}

#[test]
#[ignore = "private Postgres"]
fn stage_p_new_digest_adds_names_and_preserves_admitted_versions() {
    let mut v1 = fixture(true);
    let (mut c, schema) = observer(&mut v1);
    let original = c.query("SELECT oid::bigint,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname ~ '^_sb4_(guard|fence)_' ORDER BY oid", &[]).unwrap()
        .iter().map(|r| (r.get::<_,i64>(0),r.get::<_,String>(1))).collect::<Vec<_>>();
    crate::engine::postgres::next_check_revision(|| {
        let mut v2 = reopen(&schema).expect("a new binary must add its unadmitted digest");
        increment(&mut v2).unwrap();
        assert_eq!(functions(&mut c).len(), 3);
    });
    for (oid, definition) in original {
        assert_eq!(
            c.query_one("SELECT pg_get_functiondef($1::bigint::oid)", &[&oid])
                .unwrap()
                .get::<_, String>(0),
            definition
        );
    }
    increment(&mut v1).unwrap();
    // A real original v1 binary rewrites its legacy boolean on every open.
    c.execute(
        "UPDATE _meta SET value='1' WHERE key='flight_checks_v1'",
        &[],
    )
    .unwrap();
    drop(reopen(&schema).expect("admitted digest records survive a v1 marker rewrite"));
    // Even an older binary validates the newer admitted version, not just its own.
    let newer = functions(&mut c)
        .into_iter()
        .find(|(_, signature)| {
            c.query_one(
                "SELECT prosrc LIKE '%next binary%' FROM pg_proc WHERE oid=$1::text::regprocedure",
                &[&signature],
            )
            .unwrap()
            .get::<_, bool>(0)
        })
        .unwrap()
        .1;
    c.batch_execute(&format!("DROP FUNCTION {newer}")).unwrap();
    assert!(
        reopen(&schema).is_err(),
        "a missing admitted digest must never be recreated"
    );
}

#[test]
#[ignore = "private Postgres"]
fn stage_p_namespace_and_array_setting_drift_refuse_before_data() {
    check_drift("namespace");
}
#[test]
#[ignore = "private Postgres"]
fn stage_p_array_nulls_drift_refuses_before_data() {
    check_drift("array_nulls");
}
fn check_drift(drift: &str) {
    {
        let mut a = fixture(true);
        let mut b = fixture(true);
        let (mut ca, _) = observer(&mut a);
        let (mut cb, sb) = observer(&mut b);
        let before_a = snapshot(&mut a);
        let before_b = snapshot(&mut b);
        let image_a = ca
            .query_one("SELECT data FROM r WHERE t='counters' AND id='a'", &[])
            .unwrap()
            .get::<_, String>(0);
        let image_b = cb
            .query_one("SELECT data FROM r WHERE t='counters' AND id='a'", &[])
            .unwrap()
            .get::<_, String>(0);
        let store = a.store_mut().test_postgres_handle_mut().store.get_mut();
        let sql = if drift == "namespace" {
            format!("SET search_path=\"{sb}\",pg_catalog")
        } else {
            "SET array_nulls=off".into()
        };
        store.client.batch_execute(&sql).unwrap();
        let result = increment(&mut a);
        assert!(result.is_err(), "{drift} drift admitted a data write");
        for (c, expected, image) in [(&mut ca, &before_a, image_a), (&mut cb, &before_b, image_b)] {
            assert_eq!(
                c.query_one("SELECT seq FROM _head", &[])
                    .unwrap()
                    .get::<_, i64>(0),
                expected["head"].as_i64().unwrap()
            );
            assert_eq!(
                c.query_one("SELECT data FROM r WHERE t='counters' AND id='a'", &[])
                    .unwrap()
                    .get::<_, String>(0),
                image
            );
        }
    }
}
#[test]
#[ignore = "private Postgres"]
fn stage_p_missing_function_refuses_before_any_data() {
    for kind in ["guard", "fence"] {
        let mut e = fixture(true);
        let (mut c, _) = observer(&mut e);
        let before = snapshot(&mut e);
        let image = c
            .query_one("SELECT data FROM r WHERE t='counters' AND id='a'", &[])
            .unwrap()
            .get::<_, String>(0);
        for (name, signature) in functions(&mut c) {
            if name.contains(kind) {
                c.batch_execute(&format!("DROP FUNCTION {signature}"))
                    .unwrap();
            }
        }
        let refusal = increment(&mut e).expect_err("missing check must stop the flight");
        assert!(
            matches!(
                refusal.refusal().code.as_str(),
                "E_STORE" | "E_STORE_OWNERSHIP"
            ),
            "{refusal:?}"
        );
        // Direct inspection is independent of the intentionally broken guard.
        let head = c
            .query_one("SELECT seq FROM _head", &[])
            .unwrap()
            .get::<_, i64>(0);
        assert_eq!(head, before["head"].as_i64().unwrap());
        assert_eq!(
            c.query_one("SELECT count(*) FROM _outbox", &[])
                .unwrap()
                .get::<_, i64>(0),
            0
        );
        assert_eq!(
            c.query_one("SELECT data FROM r WHERE t='counters' AND id='a'", &[])
                .unwrap()
                .get::<_, String>(0),
            image
        );
    }
}

#[test]
#[ignore = "private Postgres"]
fn stage_p_reconnect_keeps_failed_helper_admission_pending() {
    for kind in ["guard", "fence"] {
        for tamper in ["missing", "body"] {
            let mut e = fixture(true);
            let (mut c, _) = observer(&mut e);
            let mut reader = e.reader().unwrap();
            let store = reader
                .store_mut()
                .test_postgres_handle_mut()
                .store
                .get_mut();
            let pid = store
                .client
                .independent("SELECT pg_backend_pid()", &[])
                .unwrap()[0]
                .get::<_, i32>(0);
            eprintln!("Stage P reconnect witness owns reader backend {pid}");
            let (_, signature) = functions(&mut c)
                .into_iter()
                .find(|(name, _)| name.contains(kind))
                .unwrap();
            let definition = c
                .query_one(
                    "SELECT pg_get_functiondef($1::text::regprocedure)",
                    &[&signature],
                )
                .unwrap()
                .get::<_, String>(0);
            if tamper == "missing" {
                c.batch_execute(&format!("DROP FUNCTION {signature}"))
                    .unwrap();
            } else {
                c.batch_execute(&format!("CREATE OR REPLACE FUNCTION {signature} RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS 'BEGIN RETURN; END'")).unwrap();
            }
            assert!(
                c.query_one("SELECT pg_terminate_backend($1)", &[&pid])
                    .unwrap()
                    .get::<_, bool>(0)
            );
            let until = std::time::Instant::now() + Duration::from_secs(5);
            while !store
                .client
                .query_one("SELECT 1", &[])
                .is_err_and(|error| error.is_closed())
            {
                assert!(std::time::Instant::now() < until);
                std::thread::sleep(Duration::from_millis(5));
            }
            // Retry on the same replacement socket. A failed catalog admission
            // must never become the legacy inline-check path on attempt two.
            for attempt in 0..3 {
                let result = store.transaction(None).and_then(|tx| tx.rollback());
                assert!(result.is_err(), "{kind}/{tamper} admitted retry {attempt}");
            }
            c.batch_execute(&definition).unwrap();
            store.transaction(None).unwrap().rollback().unwrap();
        }
    }
}

#[test]
#[ignore = "private Postgres"]
fn stage_p_typed_shapes_match_generic_tail_and_sqlite_randomized() {
    for (shape, seed, array_nulls) in [0, 1, 2]
        .into_iter()
        .flat_map(|shape| [1, 19, 0xdecaf].map(|seed| (shape, seed)))
        .flat_map(|(shape, seed)| ["on", "off"].map(|setting| (shape, seed, setting)))
    {
        let fast = shape == 1;
        let source = SOURCE
            .replace("  sync public", "  online only")
            .replace("  insert entries { counter: key, delta }\n", "")
            .replace("  emit notify { key, delta }\n", "");
        let nullable_source = SOURCE.replace("  insert <- allow\n  sync public\nmutation setup():", "  insert <- allow\n  delete <- allow\n  sync public\nmutation remove(key: entries):\n  delete entries[key]\nmutation setup():");
        let fixture = |pg| {
            if shape == 2 {
                fixture_source(pg, &nullable_source)
            } else if fast {
                fixture_source(pg, &source)
            } else {
                history_fixture(pg)
            }
        };
        let mut generic = fixture(true);
        let mut typed = fixture(true);
        let mut sqlite = fixture(false);
        // Start with hostile session input, just as a role/database default can.
        // Production connection qualification must pin it before compact arrays.
        for engine in [&mut generic, &mut typed] {
            let store = engine
                .store_mut()
                .test_postgres_handle_mut()
                .store
                .get_mut();
            store
                .client
                .batch_execute(&format!("SET array_nulls={array_nulls}"))
                .unwrap();
            store.client.configure().unwrap();
        }
        let intent = |seed, i| {
            let original = super::intent(seed, i);
            if fast {
                Invocation::new("increment", None, original.context)
            } else {
                original
            }
        };
        for start in (0..192).step_by(16) {
            let n = if start % 32 == 0 { 16 } else { 8 };
            for offset in (start..start + 16).step_by(n) {
                let mut a = (offset..offset + n)
                    .map(|i| intent(seed, i))
                    .collect::<Vec<_>>();
                let mut b = (offset..offset + n)
                    .map(|i| intent(seed, i))
                    .collect::<Vec<_>>();
                let mut c = (offset..offset + n)
                    .map(|i| intent(seed, i))
                    .collect::<Vec<_>>();
                let outcomes = |v: Vec<crate::engine::program_batch::Outcome>| {
                    v.into_iter()
                        .map(|v| {
                            v.map(|a| a.outcome)
                                .map_err(|e| (e.code, e.family, e.message))
                        })
                        .collect::<Vec<_>>()
                };
                let expected = crate::engine::postgres::generic_tail(|| {
                    outcomes(generic.invoke_program_batch(&mut a))
                });
                assert_eq!(expected, outcomes(typed.invoke_program_batch(&mut b)));
                assert_eq!(expected, outcomes(sqlite.invoke_program_batch(&mut c)));
            }
        }
        if fast {
            let generic_plans=typed.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT coalesce(sum(generic_plans),0)::bigint FROM pg_prepared_statements WHERE statement LIKE '%commits_input AS MATERIALIZED%' AND statement NOT LIKE '%pg_prepared_statements%'",&[]).unwrap().get::<_,i64>(0);
            assert!(generic_plans > 0, "the warm shape must use a generic plan");
        }
        if shape == 2 {
            let keys = typed
                .store()
                .rows("entries")
                .unwrap()
                .into_iter()
                .take(8)
                .map(|row| row.field("id").unwrap().clone())
                .collect::<Vec<_>>();
            assert!(!keys.is_empty());
            let removals = || {
                keys.iter()
                    .map(|key| {
                        Invocation::new(
                            "remove",
                            None,
                            Context::new("alice", [("key".into(), key.clone())].into()).at(2000),
                        )
                    })
                    .collect::<Vec<_>>()
            };
            let result = |v: Vec<crate::engine::program_batch::Outcome>| {
                v.into_iter()
                    .map(|v| v.unwrap().outcome)
                    .collect::<Vec<_>>()
            };
            let expected = crate::engine::postgres::generic_tail(|| {
                result(generic.invoke_program_batch(&mut removals()))
            });
            assert_eq!(
                expected,
                result(typed.invoke_program_batch(&mut removals()))
            );
            assert_eq!(
                expected,
                result(sqlite.invoke_program_batch(&mut removals()))
            );
            let (mut c, _) = observer(&mut typed);
            assert!(
                c.query_one("SELECT count(*) FROM _log WHERE data IS NULL", &[])
                    .unwrap()
                    .get::<_, i64>(0)
                    > 0,
                "exercise tombstones with NULL elements, initial array_nulls={array_nulls}"
            );
            assert!(
                c.query_one("SELECT count(*) FROM _outbox WHERE deadline IS NULL", &[])
                    .unwrap()
                    .get::<_, i64>(0)
                    > 0,
                "exercise nullable integer effect elements"
            );
        }
        let expected = serde_json::to_vec(&snapshot(&mut generic)).unwrap();
        assert_eq!(expected, serde_json::to_vec(&snapshot(&mut typed)).unwrap());
        assert_eq!(
            expected,
            serde_json::to_vec(&snapshot(&mut sqlite)).unwrap()
        );
    }
}

#[test]
#[ignore = "private Postgres"]
fn stage_p_delayed_reader_keeps_evidence_across_maintenance_prune() {
    use crate::store_port::{LeasePolicy, StoreLease};
    let mut e = fixture(true);
    let (mut c, schema) = observer(&mut e);
    let id = e.store().store_identity().unwrap().unwrap();
    drop(e);
    for (_, signature) in functions(&mut c) {
        c.batch_execute(&format!("DROP FUNCTION {signature}"))
            .unwrap();
    }
    c.execute("DELETE FROM _meta WHERE key='flight_checks_v1' OR pg_catalog.starts_with(key,'flight_check:')", &[])
        .unwrap();
    let mut lease = StoreLease::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
        &schema,
        &id,
        "c004",
        LeasePolicy::default(),
    )
    .unwrap();
    assert!(lease.acquire().unwrap().is_some());
    let upgraded = Engine::open_at(
        AnyStore::open_postgres_owned(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &schema,
            &lease,
        )
        .unwrap(),
        1000,
    )
    .unwrap();
    drop(upgraded);
    assert_eq!(functions(&mut c).len(), 2);
    // Populate a long retained history without charging 2,500 interpreter runs
    // to this visibility witness. Existing seq=1 belongs to fixture setup.
    c.batch_execute("INSERT INTO _change_evidence SELECT s,'{}' FROM generate_series(2,1000) s ON CONFLICT DO NOTHING; UPDATE _head SET seq=1000").unwrap();
    let mut reader =
        Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), NoTls).unwrap();
    reader
        .batch_execute(&format!("SET search_path=\"{schema}\",pg_catalog"))
        .unwrap();
    reader
        .batch_execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .unwrap();
    assert_eq!(
        reader
            .query_one("SELECT seq FROM _head", &[])
            .unwrap()
            .get::<_, i64>(0),
        1000
    );
    c.batch_execute("BEGIN; INSERT INTO _change_evidence SELECT s,'{}' FROM generate_series(1001,2500) s; UPDATE _head SET seq=2500; COMMIT").unwrap();
    assert!(lease.renew().unwrap());
    assert_eq!(
        c.query_one("SELECT min(seq) FROM _change_evidence", &[])
            .unwrap()
            .get::<_, i64>(0),
        1501
    );
    assert_eq!(
        c.query_one("SELECT count(*) FROM _change_evidence", &[])
            .unwrap()
            .get::<_, i64>(0),
        1000
    );
    assert_eq!(
        reader
            .query_one("SELECT count(*) FROM _change_evidence WHERE seq<=1000", &[])
            .unwrap()
            .get::<_, i64>(0),
        1000
    );
    reader.batch_execute("ROLLBACK").unwrap();
    // A reader opening after deletion binds the republished head, never 1000.
    assert_eq!(
        reader
            .query_one("SELECT seq FROM _head", &[])
            .unwrap()
            .get::<_, i64>(0),
        2500
    );
    // A busy head must not hold up the independent owner renewal.
    c.batch_execute("BEGIN; SELECT seq FROM _head FOR UPDATE")
        .unwrap();
    let at = std::time::Instant::now();
    assert!(lease.renew().unwrap());
    assert!(at.elapsed() < Duration::from_secs(1));
    c.batch_execute("ROLLBACK").unwrap();
    assert!(lease.release().unwrap());
}

#[test]
#[ignore = "private Postgres"]
fn stage_p_temporary_tables_follow_durable_namespace_and_drift_refuses() {
    for reconnect in [false, true] {
        let mut e = fixture(true);
        let (mut c, schema) = observer(&mut e);
        drop(e);
        let mut e = reopen(&schema).unwrap();
        if reconnect {
            let handle = e.store_mut().test_postgres_handle_mut();
            let store = handle.store.get_mut();
            let pid = store
                .client
                .query_one("SELECT pg_backend_pid()", &[])
                .unwrap()
                .get::<_, i32>(0);
            eprintln!("Stage P temp witness owns writer backend {pid}");
            assert!(
                c.query_one("SELECT pg_terminate_backend($1)", &[&pid])
                    .unwrap()
                    .get::<_, bool>(0)
            );
            let until = std::time::Instant::now() + Duration::from_secs(5);
            while !store
                .client
                .query_one("SELECT 1", &[])
                .is_err_and(|error| error.is_closed())
            {
                assert!(std::time::Instant::now() < until);
                std::thread::sleep(Duration::from_millis(5));
            }
            handle.reconnect_pipeline_writer().unwrap();
        }
        let before = c
            .query_one("SELECT seq FROM _head", &[])
            .unwrap()
            .get::<_, i64>(0);
        let store = e.store_mut().test_postgres_handle_mut().store.get_mut();
        store.client.batch_execute(&format!("CREATE TEMP TABLE _head AS TABLE \"{schema}\"._head; CREATE TEMP TABLE _stp_scratch (n int) ON COMMIT DROP")).unwrap();
        // Even an identically named temp relation is behind the durable namespace.
        increment(&mut e).expect("temporary scratch schemas must remain usable");
        assert_eq!(
            c.query_one("SELECT seq FROM _head", &[])
                .unwrap()
                .get::<_, i64>(0),
            before + 1
        );
        let store = e.store_mut().test_postgres_handle_mut().store.get_mut();
        assert_eq!(
            store
                .client
                .query_one("SELECT seq FROM pg_temp._head", &[])
                .unwrap()
                .get::<_, i64>(0),
            before
        );
        store
            .client
            .batch_execute(&format!("SET search_path=pg_temp,\"{schema}\",pg_catalog"))
            .unwrap();
        let error =
            increment(&mut e).expect_err("a preceding temporary schema must refuse before data");
        assert!(
            matches!(error, RuntimeError::Postgres(ref error) if error.code().is_some_and(|c| c.code()=="S4001")),
            "{error:?}"
        );
        assert_eq!(
            c.query_one("SELECT seq FROM _head", &[])
                .unwrap()
                .get::<_, i64>(0),
            before + 1
        );
    }
}
