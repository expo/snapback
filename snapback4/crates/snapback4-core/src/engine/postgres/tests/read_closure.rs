//! Real shared-executor comparisons: composed / ordinary PostgreSQL / SQLite.
use crate::{
    Ceilings, Context, Engine, Value, engine::DeliveryManifest, identity, store_port::AnyStore,
};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
fn source() -> String {
    format!(
        "use identity\n{}",
        include_str!("../../../../../../experiments/scale-controls/snapback-app/snapback/schema.q")
    )
}
fn engine(pg: bool) -> (Engine, String, String) {
    engine_with_json(pg, false)
}
fn engine_with_json(pg: bool, payload: bool) -> (Engine, String, String) {
    engine_with_payload(pg, payload, false)
}
fn engine_with_payload(pg: bool, payload: bool, text_nul: bool) -> (Engine, String, String) {
    engine_with_message_count(pg, payload, text_nul, 3)
}
fn engine_with_message_count(pg: bool, payload: bool, text_nul: bool, messages: usize) -> (Engine, String, String) {
    let source = if payload {
        source().replace(
            "  body: text <=4000",
            "  body: text <=4000\n  payload: json <=256 ?",
        )
    } else {
        source()
    };
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: crate::Schema =
        serde_json::from_value(serde_json::to_value(&b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let store = if pg {
        AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &format!("g4a_facts_{:x}", crate::ids::seed()),
        )
        .unwrap()
    } else {
        AnyStore::memory().unwrap()
    };
    let mut e = Engine::new_at(store, schema, programs, 1000).unwrap();
    let viewer = "a'\\\n雪";
    let mut rows = vec![("users", json!({"id":"u","principal":viewer}))];
    for n in 0..34 {
        let room = if n == 0 {
            "r'\\\né".to_owned()
        } else {
            format!("r{n:04}")
        };
        rows.push(("rooms", json!({"id":room})));
        rows.push((
            "memberships",
            json!({"id":format!("g{n}"),"room":room,"principal":viewer,"last_read":n/2}),
        ));
        for m in 0..messages {
            rows.push(("messages",json!({"id":format!("m{n:04}-{m}"),"room":room,"sender":"u","at":m,"body":"a\tb ' \\ 雪"})));
        }
    }
    rows.push(("rooms", json!({"id":"r1024"})));
    rows.push((
        "memberships",
        json!({"id":"excluded","room":"r1024","principal":viewer,"last_read":0}),
    ));
    if payload {
        for (table, row) in &mut rows {
            if *table == "messages" {
                row["payload"] = json!({"nul":"a\u{0}b"});
            }
        }
    }
    let rows = rows
        .into_iter()
        .map(|(t, v)| {
            (
                t.to_owned(),
                crate::wire::row_from_json(&e.schema().tables[t], &v).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    e.seed_at(rows, 1000).unwrap();
    if text_nul {
        // Current text ingress rejects NUL. Retained canonical images must
        // nevertheless read identically through composed and ordinary paths.
        use crate::rows::Rows;
        let table = e.schema().tables["messages"].clone();
        let old = e.store().rows("messages").unwrap();
        let tx = e.store_mut().transaction().unwrap();
        for before in old {
            let mut after = before.clone();
            let Value::Row(fields) = &mut after else { panic!("expected row") };
            fields.insert("body".into(), Value::String("a\u{0}b".into()));
            tx.put("messages", &table, &after, Some(&before)).unwrap();
        }
        tx.commit().unwrap();
    }
    let token = identity::open_session(e.store(), viewer, "account", 1000)
        .unwrap()
        .token;
    (e, identity::session_digest(&token), viewer.into())
}
fn run(
    e: &mut Engine,
    digest: &str,
    viewer: &str,
    name: &str,
    args: BTreeMap<String, Value>,
    composed: bool,
) -> Json {
    let mut detached;
    let e = if composed && matches!(e.store(), AnyStore::Postgres(_)) && !e.store_mut().test_postgres_handle_mut().store.get_mut().read_only {
        detached = e.reader().unwrap();
        &mut detached
    } else { e };
    let context = Context::new(viewer, args)
        .at(1000)
        .with_request_credential(if composed { "account" } else { "reference" });
    let (out, cut, current) = e.query_materialized_search_with_request(
        name,
        context,
        None,
        DeliveryManifest::Skip,
        digest,
        |snapshot, _| {
            let facts = snapshot
                .request_authority(
                    digest,
                    identity::ServiceSample {
                        now: 1000,
                        supervisor_revision: 0,
                    },
                )
                .map_err(|e| e.refusal())?;
            if facts.capability.as_ref().map(|c| c.0.as_str()) != Some(viewer) {
                return Err(crate::Refusal::new("E_AUTH", "auth", "absent session"));
            }
            Ok(())
        },
    );
    json!({"out":out,"cut":cut,"current":current})
}
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn composed_read_closure_matches_every_meter_cut_and_maintained_totals() {
    let (mut pg, digest, viewer) = engine(true);
    let (mut sqlite, sdigest, _) = engine(false);
    for (name, args) in [
        (
            "W1",
            [("message".into(), Value::Id("m0000-0".into()))].into(),
        ),
        ("W2", [("room".into(), Value::Id("r'\\\né".into()))].into()),
        ("W3", BTreeMap::new()),
        (
            "W1",
            [("message".into(), Value::Id("missing".into()))].into(),
        ),
    ] {
        let context = Context::new(&viewer, args.clone()).with_request_credential("account");
        assert!(
            super::super::read_closure::Closure::new(
                pg.schema(),
                pg.program(name).unwrap(),
                &context
            )
            .is_some(),
            "{name} must actually compose"
        );
        let reference = run(&mut pg, &digest, &viewer, name, args.clone(), false);
        assert_eq!(
            reference,
            run(&mut sqlite, &sdigest, &viewer, name, args.clone(), false)
        );
        assert_eq!(
            reference,
            run(&mut pg, &digest, &viewer, name, args.clone(), true)
        );
        let baseline = reference["out"]["Ok"]["metered"].clone();
        for field in [
            "examined",
            "index_entries",
            "rule_probes",
            "steps",
            "heap_bytes",
            "output_bytes",
            "rows_written",
        ] {
            for n in [
                0,
                1,
                baseline[field].as_u64().unwrap_or(0).saturating_sub(1),
                baseline[field].as_u64().unwrap_or(0),
            ] {
                let mut ceilings = serde_json::to_value(Ceilings::default()).unwrap();
                ceilings[field] = json!(n);
                let ceilings = serde_json::from_value(ceilings).unwrap();
                pg.set_ceilings(ceilings);
                sqlite.set_ceilings(ceilings);
                let a = run(&mut pg, &digest, &viewer, name, args.clone(), false);
                assert_eq!(
                    a,
                    run(&mut pg, &digest, &viewer, name, args.clone(), true),
                    "{name} {field}={n}"
                );
                assert_eq!(
                    a,
                    run(&mut sqlite, &sdigest, &viewer, name, args.clone(), false),
                    "SQLite {name} {field}={n}"
                );
            }
        }
        pg.set_ceilings(Ceilings::default());
        sqlite.set_ceilings(Ceilings::default());
    }
}

#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn composed_read_closure_oracle_detects_planted_fact_faults() {
    use super::super::read_closure::{FAULT, Fault};
    let (mut pg, digest, viewer) = engine(true);
    let (mut sqlite, sdigest, _) = engine(false);
    for (fault, name, args) in [
        (
            Fault::Membership,
            "W1",
            [("message".into(), Value::Id("m0000-0".into()))].into(),
        ),
        (Fault::Total, "W3", BTreeMap::new()),
        (
            Fault::Order,
            "W2",
            [("room".into(), Value::Id("r'\\\né".into()))].into(),
        ),
        (
            Fault::Authority,
            "W1",
            [("message".into(), Value::Id("m0000-0".into()))].into(),
        ),
    ] {
        let expected = run(&mut sqlite, &sdigest, &viewer, name, args.clone(), false);
        assert_eq!(
            expected,
            run(&mut pg, &digest, &viewer, name, args.clone(), true)
        );
        FAULT.with(|f| f.set(Some(fault)));
        let actual = run(&mut pg, &digest, &viewer, name, args.clone(), true);
        FAULT.with(|f| f.set(None));
        assert_ne!(
            expected, actual,
            "the oracle must catch a planted {name} fact fault"
        );
        assert_eq!(
            expected,
            run(&mut pg, &digest, &viewer, name, args, true),
            "facts remain transaction-local"
        );
    }
}

#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn composed_read_closure_keeps_its_cut_across_commit_and_revocation() {
    let (mut pg, digest, viewer) = engine(true);
    let expected = run(&mut pg, &digest, &viewer, "W3", BTreeMap::new(), false);
    let namespace = pg
        .store_mut()
        .test_postgres_handle_mut()
        .connection
        .1
        .clone();
    let mut foreign = Engine::open_at(
        AnyStore::open_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            &namespace,
        )
        .unwrap(),
        1000,
    )
    .unwrap();
    let context = Context::new(&viewer, BTreeMap::new())
        .at(1000)
        .with_request_credential("account");
    let mut detached = pg.reader().unwrap();
    let (out, cut, current) = detached.query_materialized_search_with_request(
        "W3",
        context,
        None,
        DeliveryManifest::Skip,
        &digest,
        |snapshot, seq| {
            let old = snapshot
                .request_authority(
                    &digest,
                    identity::ServiceSample {
                        now: 1000,
                        supervisor_revision: 0,
                    },
                )
                .unwrap();
            assert_eq!(old.head, seq);
            assert!(old.capability.is_some());
            foreign
                .mutate(
                    "post",
                    None,
                    Context::new(
                        &viewer,
                        [
                            ("room".into(), Value::Id("r'\\\né".into())),
                            ("body".into(), Value::String("new".into())),
                        ]
                        .into(),
                    )
                    .at(1001),
                )
                .unwrap();
            identity::revoke_principal(foreign.store(), &viewer).unwrap();
            let again = snapshot
                .request_authority(
                    &digest,
                    identity::ServiceSample {
                        now: 1001,
                        supervisor_revision: 0,
                    },
                )
                .unwrap();
            assert_eq!(old.head, again.head);
            assert_eq!(old.capability, again.capability);
            Ok(())
        },
    );
    assert_eq!(expected, json!({"out":out,"cut":cut,"current":current}));
    let next = run(&mut detached, &digest, &viewer, "W3", BTreeMap::new(), true);
    assert_eq!(next["out"]["Err"]["code"], "E_AUTH");
}

#[test]
fn composed_read_closure_declines_unbounded_or_mutable_addresses() {
    use crate::{
        ir::{Expr, Stmt},
        schema::ColumnType,
    };
    let b = snapback4_lang::compile(&[("schema.q".into(), source())]);
    assert!(b.diagnostics.is_empty());
    let schema: crate::Schema =
        serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let w3 = programs.iter().find(|p| p.name == "W3").unwrap();
    let c = Context::new("alice", BTreeMap::new()).with_request_credential("account");
    assert!(super::super::read_closure::Closure::new(&schema, w3, &c).is_some());
    let mut large = schema.clone();
    large
        .tables
        .get_mut("memberships")
        .unwrap()
        .columns
        .insert("large".into(), ColumnType::Text { max: u32::MAX });
    assert!(super::super::read_closure::Closure::new(&large, w3, &c).is_none());
    let mut nullable = schema.clone();
    nullable
        .tables
        .get_mut("memberships")
        .unwrap()
        .columns
        .insert(
            "room".into(),
            ColumnType::Optional(Box::new(ColumnType::Ref {
                table: "rooms".into(),
            })),
        );
    assert!(super::super::read_closure::Closure::new(&nullable, w3, &c).is_none());
    let mut arbitrary = w3.clone();
    if let Stmt::For {
        domain: crate::ir::LoopDomain::Page(scan),
        ..
    } = &mut arbitrary.body[1]
    {
        scan.filter = Some(Box::new(Expr::Literal(Value::Bool(true))));
    }
    assert!(super::super::read_closure::Closure::new(&schema, &arbitrary, &c).is_none());
    let mut shadow = programs.iter().find(|p| p.name == "W1").unwrap().clone();
    shadow.body.insert(
        0,
        Stmt::Let {
            name: "message".into(),
            value: Expr::Literal(Value::Id("other".into())),
        },
    );
    let c = Context::new("alice", [("message".into(), Value::Id("m".into()))].into())
        .with_request_credential("account");
    assert!(super::super::read_closure::Closure::new(&schema, &shadow, &c).is_none());
    let wide = Context::new(
        "alice",
        [(
            "message".into(),
            Value::Id("m".repeat(crate::rows::MAX_INDEX_KEY_BYTES + 1)),
        )]
        .into(),
    )
    .with_request_credential("account");
    let w1 = programs.iter().find(|p| p.name == "W1").unwrap();
    assert!(super::super::read_closure::Closure::new(&schema, w1, &wide).is_none());
}

#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn composed_read_closure_json_nul_uses_portable_address_fallback() {
    let (mut pg, digest, viewer) = engine_with_json(true, true);
    let (mut sqlite, sdigest, _) = engine_with_json(false, true);
    let args = [("message".into(), Value::Id("m0000-0".into()))].into();
    let context = Context::new(&viewer, args).with_request_credential("account");
    assert!(
        super::super::read_closure::Closure::new(pg.schema(), pg.program("W1").unwrap(), &context)
            .is_none()
    );
    for (name, args) in [
        (
            "W1",
            [("message".into(), Value::Id("m0000-0".into()))].into(),
        ),
        ("W2", [("room".into(), Value::Id("r'\\\né".into()))].into()),
        ("W3", BTreeMap::new()),
    ] {
        let expected = run(&mut sqlite, &sdigest, &viewer, name, args.clone(), false);
        assert_eq!(
            expected,
            run(&mut pg, &digest, &viewer, name, args.clone(), false)
        );
        assert_eq!(
            expected,
            run(&mut pg, &digest, &viewer, name, args, true),
            "{name}: valid NUL JSON cannot become a store error"
        );
    }
}


fn fix1_bound(source: &str) -> (crate::Schema, Vec<crate::Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap(),
     b.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect())
}
fn fix1_small(pg: bool, source: &str) -> (Engine, String) {
    let (schema, programs) = fix1_bound(source);
    let store = if pg { AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &format!("g4a_fix1_{:x}", crate::ids::seed())).unwrap() } else { AnyStore::memory().unwrap() };
    let e = Engine::new_at(store, schema, programs, 1000).unwrap();
    let token = identity::open_session(e.store(), "alice", "account", 1000).unwrap().token;
    (e, identity::session_digest(&token))
}
#[test]
#[ignore = "private PG16"]
fn g4a_fix1_primary_ranges_never_decode_as_points() {
    let source = "use identity\ntable books:\n  title: text <=20\n  read <- public\n  online only\nquery first():\n  return books first 1 by .id\nquery last():\n  return books last 1 by .id\nquery point(key: id):\n  return books[key]\n";
    let (mut pg, d) = fix1_small(true, source);
    let (mut sq, sd) = fix1_small(false, source);
    for populated in [false, true] {
        if populated {
            for e in [&mut sq, &mut pg] {
                e.seed_at(["a", "b", "c"].map(|id| ("books".into(), crate::value::object([("id", Value::Id(id.into())), ("title", Value::String(id.into()))]))), 1000).unwrap();
            }
        }
        for (name,args) in [("first",BTreeMap::new()),("last",BTreeMap::new()),("point",[("key".into(),Value::Id("b".into()))].into())] {
            let expected=run(&mut sq,&sd,"alice",name,args.clone(),false);
            assert!(expected["out"].get("Ok").is_some(),"{expected}");
            assert_eq!(expected,run(&mut pg,&d,"alice",name,args.clone(),false));
            assert_eq!(expected,run(&mut pg,&d,"alice",name,args,true),"{name}, populated={populated}");
        }
    }
}
#[test]
#[ignore = "private PG16"]
fn g4a_fix1_sparse_default_addresses_use_materialized_values() {
    let old = "use identity\ntable users:\n  principal: principal\n  unique principal\n  read <- public\n  online only\ntable documents:\n  read <- public\n  online only\nquery dependent(key: id):\n  return documents[key]\n";
    let new = old.replace("table documents:\n", "table documents:\n  owner: principal default 'alice'\n").replace("  return documents[key]", "  d = documents[key]\n  return users[principal = d.owner]");
    let (mut pg,d)=fix1_small(true,old);
    let (mut sq,sd)=fix1_small(false,old);
    for e in [&mut sq,&mut pg] {
        e.seed_at([("users".into(),crate::value::object([("id",Value::Id("u".into())),("principal",Value::Id("alice".into()))])),("documents".into(),crate::value::object([("id",Value::Id("d".into()))]))],1000).unwrap();
        let (schema,programs)=fix1_bound(&new);
        e.adopt_at(schema,programs,1000).unwrap();
        assert!(e.store().rows("documents").unwrap()[0].field("owner").is_err(),"stored image must remain sparse");
    }
    let args=[("key".into(),Value::Id("d".into()))].into();
    let expected=run(&mut sq,&sd,"alice","dependent",args,false);
    assert!(expected["out"].get("Ok").is_some(),"{expected}");
    let args=[("key".into(),Value::Id("d".into()))].into();
    assert_eq!(expected,run(&mut pg,&d,"alice","dependent",args,false));
    let args=[("key".into(),Value::Id("d".into()))].into();
    assert_eq!(expected,run(&mut pg,&d,"alice","dependent",args,true));
}
#[test]
#[ignore = "private PG16"]
fn g4a_fix1_nul_text_remains_legal_in_composed_reads() {
    let (mut pg,d,viewer)=engine_with_payload(true,false,true);
    let (mut sq,sd,_)=engine_with_payload(false,false,true);
    for (name,args) in [("W1",[("message".into(),Value::Id("m0000-0".into()))].into()),("W2",[("room".into(),Value::Id("r'\\\né".into()))].into()),("W3",BTreeMap::new())] {
        let expected=run(&mut sq,&sd,&viewer,name,args.clone(),false);
        assert!(expected["out"].get("Ok").is_some(),"{name}: {expected}");
        assert_eq!(expected,run(&mut pg,&d,&viewer,name,args.clone(),false));
        assert_eq!(expected,run(&mut pg,&d,&viewer,name,args,true),"legal NUL text in {name}");
    }
}

/// Manual core serving-path load, not an HTTP capacity/SLO qualification.
#[test]
#[ignore = "manual private PG16 measurement; SNAPBACK4_PIPELINE_MEASURE=1"]
fn pipeline_measure_w2_w3_128_clients() {
    if std::env::var("SNAPBACK4_PIPELINE_MEASURE").as_deref()!=Ok("1") { return; }
    use std::{sync::{Arc,Barrier},time::{Duration,Instant}};
    let (pg,digest,viewer)=engine_with_message_count(true,false,false,20);
    for name in ["W2","W3"] {
        let barrier=Arc::new(Barrier::new(129));
        let mut clients=Vec::new();
        for _ in 0..128 {
            let mut e=pg.reader().unwrap();
            let digest=digest.clone(); let viewer=viewer.clone(); let barrier=barrier.clone();
            let args=if name=="W2" {[("room".into(),Value::Id("r'\\\né".into()))].into()} else {BTreeMap::new()};
            clients.push(std::thread::spawn(move|| {
                // Warm the interpreter and both driver paths before the common start.
                assert!(run(&mut e,&digest,&viewer,name,args.clone(),true)["out"]["Ok"].is_object());
                barrier.wait(); let start=Instant::now(); let mut times=Vec::new();
                while start.elapsed()<Duration::from_secs(5) {
                    let at=Instant::now();
                    let out=run(&mut e,&digest,&viewer,name,args.clone(),true);
                    assert!(out["out"]["Ok"].is_object(),"{out}");
                    times.push(at.elapsed().as_nanos() as u64);
                }
                (times,start.elapsed().as_secs_f64())
            }));
        }
        barrier.wait(); let mut times=Vec::new(); let mut seconds=0.0f64;
        for client in clients {let (t,s)=client.join().unwrap();times.extend(t);seconds=seconds.max(s);}
        times.sort_unstable();
        println!("PIPELINE_MEASUREMENT {}",json!({"op":name,"depth":std::env::var("SNAPBACK4_POSTGRES_PIPELINE_DEPTH").unwrap_or("4".into()),"clients":128,"max_connections":30,"reads":times.len(),"seconds":seconds,"reads_per_second":times.len() as f64/seconds,"p50_ms":times[times.len()/2] as f64/1e6,"p99_ms":times[times.len()*99/100] as f64/1e6}));
    }
}

#[test]
#[ignore = "private PG16; real failed pipeline facts statement and fresh fallback"]
fn pipeline_read_closure_sql_failure_rechecks_revoked_authority() {
    let (mut pg, digest, viewer) = engine(true);
    let mut detached = pg.reader().unwrap();
    // A view over the retained session row raises inside the real composed
    // statement. The hook repairs the fixture and revokes authority only after
    // that implicit transaction has failed, before ordinary fallback opens.
    pg.store_mut().test_postgres_handle_mut().store.get_mut().client.batch_execute(
        "ALTER TABLE _sessions RENAME TO _pipe_saved_sessions; CREATE VIEW _sessions AS SELECT * FROM _pipe_saved_sessions WHERE 1 / (pg_catalog.length(token_digest)-pg_catalog.length(token_digest)) = 1"
    ).unwrap();
    let revoked_viewer = viewer.clone();
    super::super::read_closure::AFTER_FAILED_STATEMENT.with(|hook| *hook.borrow_mut() = Some(Box::new(move || {
        pg.store_mut().test_postgres_handle_mut().store.get_mut().client.batch_execute(
            "DROP VIEW _sessions; ALTER TABLE _pipe_saved_sessions RENAME TO _sessions"
        ).unwrap();
        identity::revoke_principal(pg.store(), &revoked_viewer).unwrap();
    })));
    let out = run(&mut detached, &digest, &viewer, "W3", BTreeMap::new(), true);
    assert_eq!(out["out"]["Err"]["code"], "E_AUTH", "failed pipeline speculation must obtain fresh authority: {out}");
    assert!(super::super::read_closure::AFTER_FAILED_STATEMENT.with(|hook| hook.borrow().is_none()), "the real SQL error must execute the fallback hook");
}

#[test]
#[ignore = "private PG16; future readers and factory recovery, not in-flight replay"]
fn pipeline_read_closure_future_requests_recover_and_recheck_store_binding() {
    fn pid(e: &mut Engine) -> i32 {
        e.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0)
    }
    fn wait_closed(e: &mut Engine) {
        let until=std::time::Instant::now()+std::time::Duration::from_secs(5);
        while !e.store_mut().test_postgres_handle_mut().store.get_mut().client.is_closed() {
            assert!(std::time::Instant::now()<until,"reader did not observe its terminated backend");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
    let (mut pg,digest,viewer)=engine(true);
    let mut source=pg.reader().unwrap();
    let source_pid=pid(&mut source);
    // Keep the source and a request on the same capped physical connection.
    let mut held=Vec::new(); let mut loan=None;
    for _ in 0..60 {
        let mut next=source.reader().unwrap();
        if pid(&mut next)==source_pid {loan=Some(next);break;}
        held.push(next);
    }
    let mut loan=loan.expect("the reader pool must reuse a connection");
    let expected=run(&mut loan,&digest,&viewer,"W3",BTreeMap::new(),true);
    assert!(expected["out"]["Ok"].is_object());
    assert!(pg.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT pg_terminate_backend($1)",&[&source_pid]).unwrap().get::<_,bool>(0));
    wait_closed(&mut loan);
    assert_eq!(run(&mut loan,&digest,&viewer,"W3",BTreeMap::new(),true),expected,"a future request must replace a known-closed socket before starting");
    let mut fresh=source.reader().expect("a lost source socket must not permanently wedge the reader factory");
    assert_eq!(run(&mut fresh,&digest,&viewer,"W3",BTreeMap::new(),true),expected);

    let original:String=pg.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT value FROM _meta WHERE key='store_id'",&[]).unwrap().get(0);
    let victim=pid(&mut fresh);
    pg.store_mut().test_postgres_handle_mut().store.get_mut().client.query_one("SELECT pg_terminate_backend($1)",&[&victim]).unwrap();
    wait_closed(&mut fresh);
    pg.store_mut().test_postgres_handle_mut().store.get_mut().client.execute("UPDATE _meta SET value='replaced-store' WHERE key='store_id'",&[]).unwrap();
    for _ in 0..2 {
        let refused=run(&mut fresh,&digest,&viewer,"W3",BTreeMap::new(),true);
        assert_eq!(refused["out"]["Err"]["code"],"E_GENERATION","reconnection must keep refusing a different logical store: {refused}");
    }
    pg.store_mut().test_postgres_handle_mut().store.get_mut().client.execute("UPDATE _meta SET value=$1 WHERE key='store_id'",&[&original]).unwrap();
    assert_eq!(run(&mut fresh,&digest,&viewer,"W3",BTreeMap::new(),true),expected,"a failed binding check must not be marked validated");
}
