use snapback2_core::*;
use std::collections::BTreeMap;

fn schema() -> Schema {
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("scope".into(), ColumnType::Text { max: 20 }),
            ("n".into(), ColumnType::Int),
            ("ok".into(), ColumnType::Bool),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byScope".into(),
                Index {
                    columns: vec!["scope".into(), "id".into()],
                    unique: false,
                },
            ),
        ]),
    );
    table.constraints.push(Constraint::Immutable {
        fields: vec!["scope".into()],
    });
    table.rules.read = RuleExpr::Deny;
    table.rules.update = RuleExpr::Deny;
    Schema {
        tables: BTreeMap::from([("items".into(), table)]),
        ..Schema::default()
    }
}
fn field(name: &str) -> Expr {
    Expr::Field {
        base: Box::new(Expr::Variable("row".into())),
        name: name.into(),
    }
}
fn job(take: u32) -> Program {
    Program {
        name: "admin.fill".into(),
        kind: ProgramKind::Job,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::For {
            binding: "row".into(),
            domain: LoopDomain::Page(Scan {
                site: "sweep".into(),
                table: "items".into(),
                index: "byId".into(),
                prefix: vec![],
                order: Order::Asc,
                take: Bound::Literal(take),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }),
            body: vec![
                Stmt::Require {
                    condition: field("ok"),
                    code: "FIX_ROW".into(),
                },
                Stmt::Update {
                    table: "items".into(),
                    key: field("id"),
                    patch: Expr::Object(BTreeMap::from([(
                        "n".into(),
                        Expr::Binary {
                            op: BinaryOp::Add,
                            left: Box::new(field("n")),
                            right: Box::new(Expr::Literal(Value::Int(1))),
                        },
                    )])),
                },
            ],
        }],
    }
}
fn generation(schema: Schema, job: Program) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: schema.auth.clone(),
            schema,
            programs: vec![job],
            effects: vec![],
        },
        Ceilings::default(),
    )
    .unwrap()
}
fn runtime(take: u32) -> Runtime {
    Runtime::open(Store::memory().unwrap(), generation(schema(), job(take))).unwrap()
}
fn row(id: &str, ok: bool) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("scope", Value::String("a".into())),
        ("n", Value::Int(0)),
        ("ok", Value::Bool(ok)),
    ])
}
fn seed(runtime: &mut Runtime, ids: &[&str]) {
    runtime
        .seed(
            &ids.iter()
                .map(|id| ("items".into(), row(id, true)))
                .collect::<Vec<_>>(),
        )
        .unwrap();
}
fn start(runtime: &mut Runtime) -> String {
    runtime
        .enqueue_job("admin.fill", BTreeMap::new(), OperatorId("tester".into()))
        .unwrap()
}
fn values(runtime: &mut Runtime) -> BTreeMap<String, i64> {
    let Stmt::For {
        domain: LoopDomain::Page(mut scan),
        ..
    } = job(100).body.remove(0)
    else {
        unreachable!()
    };
    scan.take = Bound::Literal(100);
    let q = Program {
        name: "inspect".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        body: vec![Stmt::Return(Expr::Scan(scan))],
        read_time_granularity_ms: None,
        result_page_site: None,
    };
    let Value::Array(rows) = runtime
        .read_operator(&q, BTreeMap::new(), OperatorId("tester".into()), 1)
        .unwrap()
        .result
    else {
        panic!("rows")
    };
    rows.iter()
        .map(|r| {
            (
                r.field("id").unwrap().as_str().unwrap().into(),
                r.field("n").unwrap().as_int().unwrap(),
            )
        })
        .collect()
}
fn operate(runtime: &mut Runtime, body: Vec<Stmt>) {
    let program = Program {
        name: "repair".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body,
    };
    let result = runtime
        .execute_adhoc_operator(&program, BTreeMap::new(), OperatorId("tester".into()), 1)
        .unwrap();
    assert!(
        matches!(result.state, ExecutionState::Committed { .. }),
        "{result:?}"
    );
}

#[test]
fn captured_upper_visits_inside_inserts_skips_deleted_and_beyond_rows() {
    let mut rt = runtime(2);
    seed(&mut rt, &["01", "02", "04", "06", "08"]);
    let id = start(&mut rt);
    let first = rt.run_chunk(&id).unwrap();
    assert_eq!(first.job.chunks, 1);
    assert_eq!(first.job.upper_key, Some(vec![Value::Id("08".into())]));
    operate(
        &mut rt,
        vec![
            Stmt::Insert {
                table: "items".into(),
                row: Expr::Literal(row("03", true)),
            },
            Stmt::Insert {
                table: "items".into(),
                row: Expr::Literal(row("09", true)),
            },
            Stmt::Delete {
                table: "items".into(),
                key: Expr::Literal(Value::Id("06".into())),
            },
        ],
    );
    while rt.job_record(&id).unwrap().state != "done" {
        let outcome = rt.run_chunk(&id).unwrap();
        assert_ne!(outcome.job.state, "parked", "{outcome:?}");
    }
    assert_eq!(
        values(&mut rt),
        BTreeMap::from([
            ("01".into(), 1),
            ("02".into(), 1),
            ("03".into(), 1),
            ("04".into(), 1),
            ("08".into(), 1),
            ("09".into(), 0)
        ])
    );
    let commits = rt.store().job_commits(&id, 0, 500).unwrap();
    assert_eq!(commits.len(), 3);
    assert!(
        commits
            .iter()
            .all(|c| c.kind == "job" && c.job.as_deref() == Some(&id) && c.writes["_jobs"] == 1)
    );
}
#[test]
fn committed_cursor_survives_restart_without_reapplying_rows() {
    let mut rt = runtime(2);
    seed(&mut rt, &["01", "02", "03", "04"]);
    let id = start(&mut rt);
    rt.run_chunk(&id).unwrap();
    let path = std::env::temp_dir().join(format!("j1b-crash-{}.sqlite", std::process::id()));
    rt.store().snapshot_to(&path).unwrap();
    let mut reopened =
        Runtime::open(Store::open(&path).unwrap(), generation(schema(), job(2))).unwrap();
    assert_eq!(reopened.job_record(&id).unwrap().state, "queued");
    assert_eq!(reopened.job_record(&id).unwrap().chunks, 1);
    assert_eq!(reopened.run_chunk(&id).unwrap().job.state, "done");
    assert!(values(&mut reopened).values().all(|n| *n == 1));
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn rejection_rolls_back_only_current_chunk_then_resume_and_terminal_cancel() {
    let mut rt = runtime(2);
    seed(&mut rt, &["01", "02", "03"]);
    rt.seed(&[("items".into(), row("04", false))]).unwrap();
    let id = start(&mut rt);
    rt.run_chunk(&id).unwrap();
    let before = rt.job_record(&id).unwrap();
    let parked = rt.run_chunk(&id).unwrap().job;
    assert_eq!(parked.state, "parked");
    assert_eq!(parked.cursor, before.cursor);
    assert_eq!(parked.chunks, 1);
    assert_eq!(values(&mut rt)["03"], 0);
    operate(
        &mut rt,
        vec![Stmt::Update {
            table: "items".into(),
            key: Expr::Literal(Value::Id("04".into())),
            patch: Expr::Object(BTreeMap::from([(
                "ok".into(),
                Expr::Literal(Value::Bool(true)),
            )])),
        }],
    );
    rt.resume_job(&id).unwrap();
    assert_eq!(rt.run_chunk(&id).unwrap().job.state, "done");
    assert!(values(&mut rt).values().all(|n| *n == 1));
    let running = start(&mut rt);
    rt.run_chunk(&running).unwrap();
    assert_eq!(rt.cancel_job(&running).unwrap().state, "cancelled");
    let cancelled = start(&mut rt);
    assert_eq!(rt.cancel_job(&cancelled).unwrap().state, "cancelled");
    assert!(rt.resume_job(&cancelled).is_err());
    assert!(rt.run_chunk(&cancelled).unwrap().execution.is_none());
}
#[test]
fn successor_binds_body_and_index_unchanged_job_continues() {
    let mut rt = runtime(1);
    seed(&mut rt, &["01", "02"]);
    let id = start(&mut rt);
    rt.run_chunk(&id).unwrap();
    rt.apply_successor(generation(schema(), job(1))).unwrap();
    assert_eq!(rt.job_record(&id).unwrap().state, "running");
    let mut changed = job(1);
    if let Stmt::For { body, .. } = &mut changed.body[0] {
        body.push(Stmt::Require {
            condition: Expr::Literal(Value::Bool(true)),
            code: "NEW".into(),
        });
    }
    rt.apply_successor(generation(schema(), changed)).unwrap();
    assert_eq!(
        rt.job_record(&id).unwrap().last_error.unwrap().code,
        "E_JOB_GENERATION"
    );
    assert!(rt.resume_job(&id).is_err());
    rt.apply_successor(generation(schema(), job(1))).unwrap();
    rt.resume_job(&id).unwrap();
    assert_eq!(rt.run_chunk(&id).unwrap().job.state, "done");
}
#[test]
fn certification_requires_immutable_total_keys_and_counts_progress_write() {
    let mut p = job(2);
    if let Stmt::For {
        domain: LoopDomain::Page(s),
        ..
    } = &mut p.body[0]
    {
        s.index = "byScope".into();
    }
    let mut s = schema();
    s.tables.get_mut("items").unwrap().constraints.clear();
    assert!(
        Checker::new(&s, Ceilings::default())
            .check_all(&p)
            .unwrap_err()
            .iter()
            .any(|e| e.code == "E_JOB_CURSOR_INDEX")
    );
    let cert = Checker::new(&schema(), Ceilings::default())
        .check(&p)
        .unwrap();
    let j = cert.job.unwrap();
    assert_eq!(j.kind, "job");
    assert_eq!(j.per_chunk[0].write_sites.last().unwrap().table, "_jobs");
    let mut cap = Ceilings::default();
    cap.write_rows = 2;
    assert!(Checker::new(&schema(), cap.clone()).check(&job(2)).is_err());
    cap.write_rows = 0;
    assert!(Checker::new(&schema(), cap).check(&job(2)).is_err());
}

#[test]
fn constraint_rejection_rolls_back_chunk_and_unchanged_body_resumes_after_successor() {
    let mut schema = schema();
    schema
        .tables
        .get_mut("items")
        .unwrap()
        .constraints
        .push(Constraint::Immutable {
            fields: vec!["ok".into()],
        });
    let mut p = job(2);
    if let Stmt::For { body, .. } = &mut p.body[0] {
        body.remove(0);
        body.push(Stmt::Update {
            table: "items".into(),
            key: field("id"),
            patch: Expr::Object(BTreeMap::from([(
                "ok".into(),
                Expr::Literal(Value::Bool(true)),
            )])),
        });
    }
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        generation(schema.clone(), p.clone()),
    )
    .unwrap();
    seed(&mut rt, &["01", "02", "03"]);
    rt.seed(&[("items".into(), row("04", false))]).unwrap();
    let id = start(&mut rt);
    rt.run_chunk(&id).unwrap();
    let failed = rt.run_chunk(&id).unwrap();
    assert_eq!(failed.job.state, "parked");
    assert_eq!(failed.job.last_error.unwrap().code, "E_CONSTRAINT");
    assert_eq!(values(&mut rt)["03"], 0);
    assert_eq!(values(&mut rt)["02"], 1);
    schema.tables.get_mut("items").unwrap().constraints.pop();
    rt.apply_successor(generation(schema, p)).unwrap();
    rt.resume_job(&id).unwrap();
    assert_eq!(rt.run_chunk(&id).unwrap().job.state, "done");
    assert!(values(&mut rt).values().all(|n| *n == 1));
}
#[test]
fn adhoc_restart_preserves_source_changed_generation_parks_and_reset_clears_jobs() {
    let mut rt = runtime(1);
    seed(&mut rt, &["01", "02"]);
    let id = rt
        .enqueue_adhoc_job(
            &job(1),
            BTreeMap::new(),
            OperatorId("tester".into()),
            1,
            "job fill: source retained".into(),
        )
        .unwrap();
    rt.run_chunk(&id).unwrap();
    let path = std::env::temp_dir().join(format!("j1b-adhoc-{}.sqlite", std::process::id()));
    rt.store().snapshot_to(&path).unwrap();
    let mut reopened =
        Runtime::open(Store::open(&path).unwrap(), generation(schema(), job(1))).unwrap();
    assert_eq!(reopened.job_record(&id).unwrap().state, "queued");
    assert!(reopened.job_record(&id).unwrap().source.is_some());
    reopened
        .apply_successor(generation(schema(), job(1)))
        .unwrap();
    assert_eq!(reopened.job_record(&id).unwrap().state, "parked");
    reopened.resume_job(&id).unwrap();
    assert_eq!(reopened.run_chunk(&id).unwrap().job.state, "done");
    reopened.reset_and_seed(&[]).unwrap();
    assert!(reopened.store().jobs(100).unwrap().is_empty());
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn changed_sweep_index_parks_and_typed_prefix_is_used() {
    let mut p = job(1);
    p.args.insert("scope".into(), ArgType::Text { max: 20 });
    if let Stmt::For {
        domain: LoopDomain::Page(scan),
        ..
    } = &mut p.body[0]
    {
        scan.index = "byScope".into();
        scan.prefix = vec![Expr::Variable("scope".into())];
        scan.provenance = KeyProvenance::Arg;
    }
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(), p.clone())).unwrap();
    seed(&mut rt, &["01", "02"]);
    assert_eq!(
        rt.enqueue_job("admin.fill", BTreeMap::new(), OperatorId("tester".into()))
            .unwrap_err()
            .code(),
        "E_JOB_ARGS"
    );
    let id = rt
        .enqueue_job(
            "admin.fill",
            BTreeMap::from([("scope".into(), Value::String("a".into()))]),
            OperatorId("tester".into()),
        )
        .unwrap();
    assert_eq!(rt.run_chunk(&id).unwrap().job.chunks, 1);
    let mut s = schema();
    s.tables
        .get_mut("items")
        .unwrap()
        .indexes
        .get_mut("byScope")
        .unwrap()
        .unique = true;
    rt.apply_successor(generation(s, p)).unwrap();
    assert_eq!(rt.job_record(&id).unwrap().state, "parked");
}

#[test]
#[ignore = "LLP 1016 measurement, explicitly run outside the blocking suite"]
fn measure_100000_row_fill() {
    // Fixture preparation uses the engine's row loader; measured chunks use Runtime.
    let schema = schema();
    let generation = generation(schema.clone(), job(100));
    let mut store = Store::memory().unwrap();
    store.set_meta("generation", &generation.hash()).unwrap();
    store
        .set_meta("schema_json", &serde_json::to_string(&schema).unwrap())
        .unwrap();
    let mut engine = Engine::new(store, schema).unwrap();
    for i in 0..100000 {
        engine.seed("items", row(&format!("{i:06}"), true)).unwrap();
    }
    let path = std::env::temp_dir().join(format!("j1b-measure-{}.sqlite", std::process::id()));
    engine.store().snapshot_to(&path).unwrap();
    drop(engine);
    let mut rt = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    eprintln!("seeded 100000 rows");
    let started = std::time::Instant::now();
    let id = start(&mut rt);
    loop {
        let outcome = rt.run_chunk(&id).unwrap();
        if outcome.job.chunks % 100 == 0 {
            eprintln!(
                "{} chunks in {:.1}s",
                outcome.job.chunks,
                started.elapsed().as_secs_f64()
            );
        }
        assert_ne!(outcome.job.state, "parked", "{outcome:?}");
        if outcome.job.state == "done" {
            assert_eq!(outcome.job.chunks, 1000);
            assert_eq!(outcome.job.rows_written["items"], 100000);
            break;
        }
    }
    println!(
        "J1B_METRIC {}",
        serde_json::json!({"metric":"fill_100000_rows","seconds":started.elapsed().as_secs_f64(),"rows":100000,"chunks":1000,"budgetSeconds":60,"method":"real Runtime, file SQLite snapshot, Engine fixture loader before timer, no clients"})
    );
    drop(rt);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn multiple_sweeps_reset_the_cursor_and_commit_independent_ceilings() {
    let mut p = job(2);
    let mut second = p.body[0].clone();
    if let Stmt::For {
        domain: LoopDomain::Page(scan),
        ..
    } = &mut second
    {
        scan.site = "second".into();
    }
    p.body.push(second);
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(), p)).unwrap();
    seed(&mut rt, &["01", "02", "03"]);
    let id = start(&mut rt);
    rt.run_chunk(&id).unwrap();
    let boundary = rt.run_chunk(&id).unwrap().job;
    assert_eq!(boundary.sweep, 1);
    assert!(boundary.cursor.is_none());
    assert!(boundary.upper_key.is_none());
    rt.run_chunk(&id).unwrap();
    let done = rt.run_chunk(&id).unwrap().job;
    assert_eq!(done.state, "done");
    assert_eq!(done.chunks, 4);
    assert_eq!(done.rows_written["items"], 6);
    assert!(values(&mut rt).values().all(|n| *n == 2));
    let summary = rt.store().job_commit_summary(&id).unwrap();
    assert_eq!(summary["sweepChunks"]["0"], 2);
    assert_eq!(summary["sweepChunks"]["1"], 2);
    assert_eq!(summary["retainedChunks"], 4);
    let ledger = rt.store().commits_since(0, 100).unwrap();
    assert!(ledger.iter().any(|c| c.kind == "operator"
        && c.program == "enqueue:admin.fill"
        && c.by.as_deref() == Some("tester")));
}

#[test]
fn mutation_return_advances_only_the_visited_prefix_of_a_chunk() {
    let mut p = job(100);
    if let Stmt::For { body, .. } = &mut p.body[0] {
        body.push(Stmt::Return(Expr::Literal(Value::Bool(true))));
    }
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(), p)).unwrap();
    seed(&mut rt, &["01", "02"]);
    let id = start(&mut rt);
    let first = rt.run_chunk(&id).unwrap().job;
    assert_eq!(first.state, "running");
    assert_eq!(first.cursor, Some(vec![Value::Id("01".into())]));
    assert_eq!(values(&mut rt)["02"], 0);
    assert_eq!(rt.run_chunk(&id).unwrap().job.state, "done");
    assert!(values(&mut rt).values().all(|n| *n == 1));
}
