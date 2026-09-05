//! LLP 1016 D5: `_timers` as an index, firing as one transaction, occurrence identity.
use snapback2_core::timers::{Schedule, Timer, Trigger};
use snapback2_core::*;
use std::collections::BTreeMap;

const MINUTE: i64 = 60_000;

fn items() -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("scope".into(), ColumnType::Text { max: 20 }),
            (
                "at".into(),
                ColumnType::Optional(Box::new(ColumnType::Time)),
            ),
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
    table
}
fn log() -> Table {
    public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("item".into(), ColumnType::Id),
            ("kind".into(), ColumnType::Text { max: 20 }),
        ]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                columns: vec!["id".into()],
                unique: true,
            },
        )]),
    )
}
fn var(name: &str) -> Expr {
    Expr::Variable(name.into())
}
fn lit(value: Value) -> Expr {
    Expr::Literal(value)
}
fn program(name: &str, kind: ProgramKind, args: Vec<(&str, ArgType)>, body: Vec<Stmt>) -> Program {
    Program {
        name: name.into(),
        kind,
        args: args.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body,
    }
}
fn binding(
    name: &str,
    args: Vec<(&str, ArgType)>,
    enabled: Expr,
    bound: Vec<(&str, Expr)>,
) -> Program {
    program(
        name,
        ProgramKind::Query,
        args,
        vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), enabled),
            (
                "args".into(),
                Expr::Object(bound.into_iter().map(|(k, v)| (k.into(), v)).collect()),
            ),
        ])))],
    )
}
fn row_schedule(name: &str, target: &str, predicate: bool) -> Schedule {
    Schedule {
        name: name.into(),
        trigger: Trigger::Row {
            table: "items".into(),
            column: "at".into(),
        },
        target: target.into(),
        binding: format!(
            "admin._timerBinding_{name}{}",
            if predicate { "_if" } else { "" }
        ),
        site: "snapback/admin.q:1:1".into(),
    }
}
fn scope_schedule(name: &str, target: &str) -> Schedule {
    Schedule {
        name: name.into(),
        trigger: Trigger::Row {
            table: "items".into(),
            column: "at".into(),
        },
        target: target.into(),
        binding: format!("admin._timerBinding_{name}_scope"),
        site: "snapback/admin.q:1:1".into(),
    }
}
fn period_schedule(name: &str, target: &str, duration_ms: i64) -> Schedule {
    Schedule {
        name: name.into(),
        trigger: Trigger::Every { duration_ms },
        target: target.into(),
        binding: format!("admin._timerBinding_{name}_period"),
        site: "snapback/admin.q:2:1".into(),
    }
}
/// The binding programs the compiler would emit for these schedules, keyed by the binding name's suffix.
fn bindings(schedules: &[Schedule]) -> Vec<Program> {
    schedules
        .iter()
        .map(|schedule| {
            let name = schedule.binding.as_str();
            let (args, enabled, bound): (Vec<(&str, ArgType)>, Expr, Vec<(&str, Expr)>) =
                if name.ends_with("_period") {
                    (vec![], lit(Value::Bool(true)), vec![])
                } else if name.ends_with("_scope") {
                    (
                        vec![("scope", ArgType::Text { max: 20 })],
                        lit(Value::Bool(true)),
                        vec![("scope", var("scope"))],
                    )
                } else if name.ends_with("_if") {
                    (
                        vec![("id", ArgType::Id), ("ok", ArgType::Bool)],
                        var("ok"),
                        vec![("id", var("id"))],
                    )
                } else {
                    (
                        vec![("id", ArgType::Id)],
                        lit(Value::Bool(true)),
                        vec![("id", var("id"))],
                    )
                };
            binding(name, args, enabled, bound)
        })
        .collect()
}
fn log_insert() -> Stmt {
    Stmt::Insert {
        table: "log".into(),
        row: Expr::Object(BTreeMap::from([
            ("id".into(), Expr::Input(Input::NewId)),
            ("item".into(), var("id")),
            ("kind".into(), lit(Value::String("expired".into()))),
        ])),
    }
}
fn purge() -> Program {
    program(
        "admin.purge",
        ProgramKind::Mutation,
        vec![("id", ArgType::Id)],
        vec![
            log_insert(),
            Stmt::Delete {
                table: "items".into(),
                key: var("id"),
            },
            Stmt::Return(lit(Value::Null)),
        ],
    )
}
fn reject() -> Program {
    program(
        "admin.reject",
        ProgramKind::Mutation,
        vec![("id", ArgType::Id)],
        vec![
            log_insert(),
            Stmt::Require {
                condition: lit(Value::Bool(false)),
                code: "NOPE".into(),
            },
            Stmt::Return(lit(Value::Null)),
        ],
    )
}
fn sweep(name: &str, scoped: bool) -> Program {
    let mut args = vec![];
    if scoped {
        args.push(("scope", ArgType::Text { max: 20 }));
    }
    program(
        name,
        ProgramKind::Job,
        args,
        vec![Stmt::For {
            binding: "row".into(),
            domain: LoopDomain::Page(Scan {
                site: "sweep".into(),
                table: "items".into(),
                index: if scoped { "byScope" } else { "byId" }.into(),
                prefix: if scoped { vec![var("scope")] } else { vec![] },
                order: Order::Asc,
                take: Bound::Literal(100),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: if scoped {
                    KeyProvenance::Arg
                } else {
                    KeyProvenance::Const
                },
            }),
            body: vec![Stmt::Update {
                table: "items".into(),
                key: Expr::Field {
                    base: Box::new(var("row")),
                    name: "id".into(),
                },
                patch: Expr::Object(BTreeMap::from([(
                    "n".into(),
                    Expr::Binary {
                        op: BinaryOp::Add,
                        left: Box::new(Expr::Field {
                            base: Box::new(var("row")),
                            name: "n".into(),
                        }),
                        right: Box::new(lit(Value::Int(1))),
                    },
                )])),
            }],
        }],
    )
}
fn certify(schedules: Vec<Schedule>) -> Result<Generation, Vec<(String, CheckError)>> {
    let programs = bindings(&schedules);
    certify_with(schedules, programs)
}
fn certify_with(
    schedules: Vec<Schedule>,
    bindings: Vec<Program>,
) -> Result<Generation, Vec<(String, CheckError)>> {
    let mut programs = vec![
        purge(),
        reject(),
        sweep("admin.sweep", false),
        sweep("admin.sweepScope", true),
    ];
    programs.extend(bindings);
    let schema = Schema {
        tables: BTreeMap::from([("items".into(), items()), ("log".into(), log())]),
        schedules,
        ..Schema::default()
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: schema.auth.clone(),
            schema,
            programs,
            effects: vec![],
        },
        Ceilings::default(),
    )
}
fn generation(schedules: Vec<Schedule>) -> Generation {
    certify(schedules).unwrap()
}
fn runtime(schedules: Vec<Schedule>) -> Runtime {
    Runtime::open(Store::memory().unwrap(), generation(schedules)).unwrap()
}
fn row(id: &str, at: Option<i64>, ok: bool) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("scope", Value::String("a".into())),
        ("at", at.map_or(Value::Null, Value::Int)),
        ("n", Value::Int(0)),
        ("ok", Value::Bool(ok)),
    ])
}
fn seed(rt: &mut Runtime, rows: Vec<Value>) {
    rt.seed(
        &rows
            .into_iter()
            .map(|r| ("items".into(), r))
            .collect::<Vec<_>>(),
    )
    .unwrap();
}
fn operate(rt: &mut Runtime, body: Vec<Stmt>) {
    let p = program("repair", ProgramKind::Mutation, vec![], body);
    let result = rt
        .execute_adhoc_operator(&p, BTreeMap::new(), OperatorId("tester".into()), 1)
        .unwrap();
    assert!(
        matches!(result.state, ExecutionState::Committed { .. }),
        "{result:?}"
    );
}
fn set_at(rt: &mut Runtime, id: &str, at: Option<i64>) {
    operate(
        rt,
        vec![Stmt::Update {
            table: "items".into(),
            key: lit(Value::Id(id.into())),
            patch: Expr::Object(BTreeMap::from([(
                "at".into(),
                lit(at.map_or(Value::Null, Value::Int)),
            )])),
        }],
    );
}
fn timers(rt: &Runtime) -> Vec<Timer> {
    rt.store().due_timers(i64::MAX, 64).unwrap()
}
fn rows(rt: &mut Runtime, table: &str) -> Vec<Value> {
    let q = program(
        "inspect",
        ProgramKind::Query,
        vec![],
        vec![Stmt::Return(Expr::Scan(Scan {
            site: "inspect".into(),
            table: table.into(),
            index: "byId".into(),
            prefix: vec![],
            order: Order::Asc,
            take: Bound::Literal(100),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    );
    let Value::Array(rows) = rt
        .read_operator(&q, BTreeMap::new(), OperatorId("tester".into()), 1)
        .unwrap()
        .result
    else {
        panic!("rows")
    };
    rows
}
fn schedule_commits(rt: &Runtime) -> Vec<CommitRecord> {
    rt.store()
        .commits_since(0, 10_000)
        .unwrap()
        .into_iter()
        .filter(|c| c.kind == "schedule")
        .collect()
}

#[test]
fn row_timer_index_follows_insert_reschedule_null_and_delete_in_the_row_transaction() {
    let mut rt = runtime(vec![row_schedule("expire", "admin.purge", false)]);
    seed(
        &mut rt,
        vec![row("a", Some(50), true), row("b", None, true)],
    );
    let armed = timers(&rt);
    assert_eq!(armed.len(), 1, "{armed:?}");
    assert_eq!(armed[0].row_id.as_deref(), Some("a"));
    assert_eq!((armed[0].at, armed[0].period_start), (50, None));
    assert_eq!(armed[0].generation, rt.generation().hash());
    set_at(&mut rt, "a", Some(80));
    let moved = timers(&rt);
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0].at, 80);
    assert_ne!(
        moved[0].id, armed[0].id,
        "a new deadline is a new occurrence"
    );
    set_at(&mut rt, "a", Some(80));
    assert_eq!(
        timers(&rt)[0].id,
        moved[0].id,
        "an unchanged deadline keeps its timer"
    );
    set_at(&mut rt, "a", None);
    assert!(timers(&rt).is_empty(), "null cancels");
    set_at(&mut rt, "b", Some(10));
    assert_eq!(timers(&rt).len(), 1);
    operate(
        &mut rt,
        vec![Stmt::Delete {
            table: "items".into(),
            key: lit(Value::Id("b".into())),
        }],
    );
    assert!(timers(&rt).is_empty(), "delete cancels");
    let programs = rt.generation().programs();
    assert_eq!(
        programs["admin.purge"].1.engine_writes,
        vec!["_timers".to_string()]
    );
    assert!(
        programs["admin.sweep"]
            .1
            .engine_writes
            .contains(&"_timers".to_string())
    );
    assert!(
        programs["admin.sweep"]
            .1
            .engine_writes
            .contains(&"_jobs".to_string())
    );
}

#[test]
fn installing_a_row_schedule_populates_existing_rows_target_change_rebinds_and_removal_drops() {
    let mut rt = runtime(vec![]);
    seed(
        &mut rt,
        vec![
            row("a", Some(5), true),
            row("b", Some(6), true),
            row("c", None, true),
        ],
    );
    assert!(timers(&rt).is_empty());
    rt.apply_successor(generation(vec![row_schedule(
        "expire",
        "admin.purge",
        false,
    )]))
    .unwrap();
    let installed = timers(&rt);
    assert_eq!(
        installed.iter().map(|t| t.at).collect::<Vec<_>>(),
        vec![5, 6]
    );
    let rebound = generation(vec![row_schedule("expire", "admin.reject", false)]);
    let next_hash = rebound.hash();
    assert_ne!(next_hash, rt.generation().hash());
    rt.apply_successor(rebound).unwrap();
    let after = timers(&rt);
    assert_eq!(
        after.iter().map(|t| &t.id).collect::<Vec<_>>(),
        installed.iter().map(|t| &t.id).collect::<Vec<_>>()
    );
    assert!(after.iter().all(|t| t.generation == next_hash), "{after:?}");
    rt.apply_successor(generation(vec![])).unwrap();
    assert!(
        timers(&rt).is_empty(),
        "removing the declaration drops its timers"
    );
}

#[test]
fn due_selection_is_oldest_first_and_capped_at_sixty_four_per_turn() {
    let mut rt = runtime(vec![row_schedule("expire", "admin.purge", false)]);
    seed(
        &mut rt,
        (1..=70)
            .map(|n| row(&format!("r{n:02}"), Some(n), true))
            .collect(),
    );
    assert_eq!(rt.store().due_timers(70, 100).unwrap().len(), 64);
    assert_eq!(rt.store().due_timers(3, 64).unwrap().len(), 3);
    let first = rt.fire_due_at(100, 1_000).unwrap();
    assert_eq!(first.len(), 64);
    assert_eq!(
        first
            .iter()
            .map(|o| o.firing.scheduled_at)
            .collect::<Vec<_>>(),
        (1..=64).collect::<Vec<_>>()
    );
    assert_eq!(rt.store().timer_status(1_000).unwrap()["due"], 6);
    assert_eq!(rt.fire_due_at(64, 1_000).unwrap().len(), 6);
    assert_eq!(rt.store().timer_status(1_000).unwrap()["due"], 0);
    assert_eq!(rows(&mut rt, "items").len(), 0);
    assert_eq!(rows(&mut rt, "log").len(), 70);
}

#[test]
fn firing_runs_the_target_settles_the_timer_and_ledgers_the_occurrence_in_one_commit() {
    let mut rt = runtime(vec![row_schedule("expire", "admin.purge", false)]);
    seed(
        &mut rt,
        vec![row("a", Some(5), true), row("b", Some(500), true)],
    );
    let armed = timers(&rt);
    let before = rt.store().commit_seq().unwrap();
    let fired = rt.fire_due_at(64, 7).unwrap();
    assert_eq!(fired.len(), 1);
    let outcome = &fired[0];
    assert_eq!(outcome.seq, before + 1);
    assert_eq!(outcome.firing.timer, armed[0].id);
    assert_eq!(
        outcome.firing.occurrence,
        serde_json::json!(["expire", "a", 5])
    );
    assert_eq!(
        (
            outcome.firing.scheduled_at,
            outcome.firing.fired_at,
            outcome.firing.lateness_ms
        ),
        (5, 7, 2)
    );
    assert_eq!(outcome.firing.outcome["state"], "committed");
    assert_eq!(
        timers(&rt).len(),
        1,
        "the fired row timer is deleted; b remains"
    );
    assert_eq!(rows(&mut rt, "items").len(), 1);
    let log_rows = rows(&mut rt, "log");
    assert_eq!(log_rows.len(), 1);
    assert_eq!(log_rows[0].field("item").unwrap(), &Value::Id("a".into()));
    let commits = schedule_commits(&rt);
    assert_eq!(commits.len(), 1);
    let commit = &commits[0];
    assert_eq!(
        (commit.seq, commit.kind.as_str(), commit.program.as_str()),
        (outcome.seq, "schedule", "admin.purge")
    );
    assert_eq!(commit.principal, *SYSTEM_PRINCIPAL_ID);
    assert_eq!(commit.schedule.as_ref().unwrap(), &outcome.firing);
    assert_eq!(commit.writes["log"], 1);
    assert_eq!(commit.writes["items"], 1);
    // Exactly two `_timers` writes: the purge deletes its own trigger row (index maintenance,
    // the site `Checker::analyze` gave the target) and the firing settles the timer (the site
    // `timers::certify` pushed). Dedup either site and this firing settles `rejected` with
    // `E_TRACE_SUBSET`; the count is pinned so it breaks here instead.
    assert_eq!(commit.writes["_timers"], 2);
    let trace = rt.store().timer_trace(&armed[0].id).unwrap();
    assert!(trace["timer"].is_null());
    assert_eq!(trace["firings"][0]["seq"], outcome.seq);
    assert_eq!(trace["firings"][0]["latenessMs"], 2);
    assert_eq!(
        rt.store().schedule_receipt().unwrap(),
        serde_json::json!({"fired": 1, "late": 1, "rejected": 0})
    );
    assert_eq!(
        rt.store().timer_status(7).unwrap(),
        serde_json::json!({"due": 0, "next_at": 500, "rejected": 0})
    );
    let summary = rt
        .store()
        .timers_summary(7, &rt.generation().schema().schedules)
        .unwrap();
    assert_eq!(
        summary["schedules"][0],
        serde_json::json!({"schedule": "expire", "count": 1, "due": 0, "next_at": 500})
    );
    assert_eq!(summary["next"]["rowId"], "b");
}

#[test]
fn rejected_target_rolls_back_its_writes_settles_with_the_refusal_and_never_refires() {
    let mut rt = runtime(vec![row_schedule("expire", "admin.reject", false)]);
    seed(&mut rt, vec![row("a", Some(5), true)]);
    let fired = rt.fire_due_at(64, 9).unwrap();
    assert_eq!(fired.len(), 1);
    let outcome = &fired[0].firing.outcome;
    assert_eq!(outcome["state"], "rejected");
    assert_eq!(outcome["code"], "NOPE");
    assert_eq!(outcome["guide"], "schedule");
    assert!(outcome["rewrite"].as_str().unwrap().contains("--as system"));
    assert!(
        rows(&mut rt, "log").is_empty(),
        "the target's insert rolled back"
    );
    assert_eq!(rows(&mut rt, "items").len(), 1);
    assert!(timers(&rt).is_empty(), "a rejected row timer settles");
    assert!(rt.fire_due_at(64, 1_000).unwrap().is_empty());
    assert_eq!(rt.store().timer_status(1_000).unwrap()["rejected"], 1);
    assert_eq!(rt.store().schedule_receipt().unwrap()["rejected"], 1);
    let commits = schedule_commits(&rt);
    assert_eq!(commits.len(), 1);
    assert!(commits[0].writes.get("log").is_none());
}

#[test]
fn predicate_is_evaluated_at_fire_time_and_false_settles_silently() {
    let mut rt = runtime(vec![row_schedule("expire", "admin.purge", true)]);
    seed(
        &mut rt,
        vec![row("a", Some(5), true), row("b", Some(5), true)],
    );
    operate(
        &mut rt,
        vec![Stmt::Update {
            table: "items".into(),
            key: lit(Value::Id("b".into())),
            patch: Expr::Object(BTreeMap::from([("ok".into(), lit(Value::Bool(false)))])),
        }],
    );
    let fired = rt.fire_due_at(64, 5).unwrap();
    assert_eq!(fired.len(), 2);
    assert_eq!(fired[0].firing.outcome["state"], "committed");
    assert_eq!(
        fired[1].firing.outcome,
        serde_json::json!({"state": "skipped", "reason": "predicate false"})
    );
    assert!(timers(&rt).is_empty());
    let remaining = rows(&mut rt, "items");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].field("id").unwrap(), &Value::Id("b".into()));
    assert_eq!(schedule_commits(&rt).len(), 2);
}

#[test]
fn period_timer_installs_at_now_plus_duration_rearms_anchored_and_fires_once_for_missed_periods() {
    let mut rt = runtime(vec![period_schedule("daily", "admin.sweep", MINUTE)]);
    seed(&mut rt, vec![row("a", None, true)]);
    let installed = timers(&rt);
    assert_eq!(installed.len(), 1);
    let start = installed[0].period_start.unwrap();
    assert_eq!(installed[0].at, start + MINUTE);
    assert!(installed[0].row_id.is_none());
    assert!(rt.fire_due_at(64, start + MINUTE - 1).unwrap().is_empty());
    let now = start + 3 * MINUTE + 5;
    let fired = rt.fire_due_at(64, now).unwrap();
    assert_eq!(fired.len(), 1);
    let firing = &fired[0].firing;
    assert_eq!(firing.skipped, 2, "two whole periods passed unfired");
    assert_eq!(
        firing.occurrence,
        serde_json::json!(["daily", start + 2 * MINUTE])
    );
    assert_eq!(
        (firing.scheduled_at, firing.lateness_ms),
        (start + 3 * MINUTE, 5)
    );
    assert_eq!(firing.outcome["state"], "queued");
    let job = firing.outcome["job"].as_str().unwrap().to_owned();
    assert!(job.starts_with("job_timer_"));
    let rearmed = timers(&rt);
    assert_eq!(rearmed.len(), 1);
    assert_eq!(
        rearmed[0].id, installed[0].id,
        "the period owns one timer row"
    );
    assert_eq!(rearmed[0].period_start, Some(start + 3 * MINUTE));
    assert_eq!(
        rearmed[0].at,
        start + 4 * MINUTE,
        "anchored to the schedule, not the firing"
    );
    let jobs = rt.store().jobs(100).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].id.as_str(), jobs[0].state.as_str()),
        (job.as_str(), "queued")
    );
    assert_eq!(jobs[0].enqueued_by, format!("timer:{}", installed[0].id));
    assert_eq!(rt.run_chunk_at(&job, now).unwrap().job.state, "done");
    assert_eq!(
        rows(&mut rt, "items")[0].field("n").unwrap(),
        &Value::Int(1)
    );
    assert!(
        rt.fire_due_at(64, now).unwrap().is_empty(),
        "a re-armed period is not due yet"
    );
    let again = rt.fire_due_at(64, start + 4 * MINUTE).unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].firing.skipped, 0);
    assert_eq!(
        again[0].firing.occurrence,
        serde_json::json!(["daily", start + 3 * MINUTE])
    );
    assert_ne!(
        again[0].firing.outcome["job"], job,
        "a new period is a new occurrence"
    );
    assert_eq!(rt.store().jobs(100).unwrap().len(), 2);
}

#[test]
fn a_job_target_enqueues_with_row_args_and_the_same_occurrence_coalesces() {
    let mut rt = runtime(vec![scope_schedule("sweepAt", "admin.sweepScope")]);
    seed(&mut rt, vec![row("a", Some(5), true), row("b", None, true)]);
    let fired = rt.fire_due_at(64, 5).unwrap();
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].firing.outcome["state"], "queued");
    let job = fired[0].firing.outcome["job"].as_str().unwrap().to_owned();
    let record = rt.job_record(&job).unwrap();
    assert_eq!(
        record.args,
        BTreeMap::from([("scope".into(), Value::String("a".into()))])
    );
    assert_eq!(record.state, "queued");
    assert!(timers(&rt).is_empty());
    // The same deadline written again is the same occurrence: it coalesces onto the queued job.
    set_at(&mut rt, "a", None);
    set_at(&mut rt, "a", Some(5));
    assert_eq!(timers(&rt)[0].id, fired[0].firing.timer);
    let refired = rt.fire_due_at(64, 6).unwrap();
    assert_eq!(refired.len(), 1);
    assert_eq!(
        refired[0].firing.outcome,
        serde_json::json!({"state": "coalesced", "job": job})
    );
    assert_eq!(rt.store().jobs(100).unwrap().len(), 1);
    assert_eq!(schedule_commits(&rt).len(), 2);
    assert!(timers(&rt).is_empty());
}

#[test]
fn reset_rearms_period_timers_and_the_seed_rearms_row_timers() {
    let mut rt = runtime(vec![
        row_schedule("expire", "admin.purge", false),
        period_schedule("daily", "admin.sweep", MINUTE),
    ]);
    seed(&mut rt, vec![row("a", Some(5), true)]);
    assert_eq!(timers(&rt).len(), 2);
    rt.fire_due_at(64, 5).unwrap();
    rt.reset_and_seed(&[("items".into(), row("z", Some(9), true))])
        .unwrap();
    let after = timers(&rt);
    assert_eq!(after.len(), 2, "{after:?}");
    assert!(
        after
            .iter()
            .any(|t| t.row_id.as_deref() == Some("z") && t.at == 9)
    );
    assert!(after.iter().any(|t| t.period_start.is_some()));
    assert!(schedule_commits(&rt).is_empty(), "reset clears the ledger");
}

#[test]
fn certification_refuses_non_time_columns_bad_targets_and_sub_minute_or_ragged_durations() {
    let code = |schedules: Vec<Schedule>, expected: &str| {
        let errors = certify(schedules).unwrap_err();
        assert!(
            errors.iter().any(|(_, e)| e.code == expected),
            "{expected}: {errors:?}"
        );
        let error = errors.iter().find(|(_, e)| e.code == expected).unwrap();
        assert!(!error.1.rewrite.is_empty());
        assert!(
            error.0.starts_with("snapback/admin.q:"),
            "the site is the declaration: {error:?}"
        );
    };
    let mut bad_column = row_schedule("expire", "admin.purge", false);
    bad_column.trigger = Trigger::Row {
        table: "items".into(),
        column: "n".into(),
    };
    code(vec![bad_column], "E_SCHEDULE_COLUMN");
    code(
        vec![row_schedule("expire", "admin.missing", false)],
        "E_SCHEDULE_TARGET",
    );
    code(
        vec![period_schedule("daily", "admin.purge", MINUTE)],
        "E_SCHEDULE_TARGET",
    );
    code(
        vec![period_schedule("daily", "admin.sweep", 30_000)],
        "E_SCHEDULE_DURATION",
    );
    code(
        vec![period_schedule("daily", "admin.sweep", 90_000)],
        "E_SCHEDULE_DURATION",
    );
    let impure = row_schedule("expire", "admin.purge", false);
    let mut impure_bindings = bindings(std::slice::from_ref(&impure));
    impure_bindings[0].body.insert(
        0,
        Stmt::Insert {
            table: "log".into(),
            row: Expr::Object(BTreeMap::from([
                ("id".into(), Expr::Input(Input::NewId)),
                ("item".into(), var("id")),
                ("kind".into(), lit(Value::String("x".into()))),
            ])),
        },
    );
    let errors = certify_with(vec![impure.clone()], impure_bindings).unwrap_err();
    assert!(
        errors.iter().any(|(_, e)| e.code == "E_SCHEDULE_TARGET"),
        "an impure binding: {errors:?}"
    );
    let mut unbound = impure;
    unbound.binding = "admin.missingBinding".into();
    let errors = certify_with(vec![unbound], vec![]).unwrap_err();
    assert!(
        errors.iter().any(|(_, e)| e.code == "E_SCHEDULE_TARGET"),
        "{errors:?}"
    );
    // Two declarations of one name: the engine refuses on its own, with the unique-name rewrite.
    let first = row_schedule("expire", "admin.purge", false);
    let mut twin = first.clone();
    twin.binding = "admin._timerBinding_expireTwin".into();
    twin.site = "snapback/admin.q:9:1".into();
    let programs = bindings(&[first.clone(), twin.clone()]);
    let errors = certify_with(vec![first, twin], programs).unwrap_err();
    let duplicate = errors
        .iter()
        .find(|(_, e)| e.message.contains("duplicate schedule expire"))
        .unwrap_or_else(|| panic!("{errors:?}"));
    assert_eq!(
        (
            duplicate.0.as_str(),
            duplicate.1.code.as_str(),
            duplicate.1.rewrite.as_str()
        ),
        (
            "snapback/admin.q:9:1",
            "E_SCHEDULE_TARGET",
            "give each schedule a unique name"
        )
    );
    assert!(
        certify(vec![
            row_schedule("expire", "admin.purge", false),
            period_schedule("daily", "admin.sweep", 24 * 60 * MINUTE)
        ])
        .is_ok()
    );
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — coalescing is exactly
// "already queued or running": a finished, cancelled, or parked job for the occurrence is history.
#[test]
fn a_finished_job_for_the_occurrence_does_not_coalesce_a_restored_deadline() {
    let mut rt = runtime(vec![scope_schedule("sweepAt", "admin.sweepScope")]);
    seed(&mut rt, vec![row("a", Some(5), true)]);
    let first = rt.fire_due_at(64, 5).unwrap();
    let job = first[0].firing.outcome["job"].as_str().unwrap().to_owned();
    assert_eq!(rt.run_chunk_at(&job, 5).unwrap().job.state, "done");
    // The same deadline written again is the same occurrence, but its job is done: a fresh
    // job runs under the next attempt suffix, and the ledger says `queued`, not `coalesced`.
    set_at(&mut rt, "a", None);
    set_at(&mut rt, "a", Some(5));
    let second = rt.fire_due_at(64, 6).unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].firing.occurrence, first[0].firing.occurrence);
    assert_eq!(second[0].firing.outcome["state"], "queued");
    let again = second[0].firing.outcome["job"].as_str().unwrap().to_owned();
    assert_eq!(again, format!("{job}_1"));
    assert_eq!(rt.job_record(&again).unwrap().state, "queued");
    assert_eq!(rt.store().jobs(100).unwrap().len(), 2);
    // Still queued: the next firing of the occurrence coalesces onto it.
    set_at(&mut rt, "a", None);
    set_at(&mut rt, "a", Some(5));
    let third = rt.fire_due_at(64, 7).unwrap();
    assert_eq!(
        third[0].firing.outcome,
        serde_json::json!({"state": "coalesced", "job": again})
    );
    assert_eq!(rt.store().jobs(100).unwrap().len(), 2);
    // Cancelled: history again, so the occurrence enqueues attempt two.
    rt.cancel_job(&again).unwrap();
    set_at(&mut rt, "a", None);
    set_at(&mut rt, "a", Some(5));
    let fourth = rt.fire_due_at(64, 8).unwrap();
    assert_eq!(fourth[0].firing.outcome["state"], "queued");
    assert_eq!(fourth[0].firing.outcome["job"], format!("{job}_2"));
    assert_eq!(rt.store().jobs(100).unwrap().len(), 3);
    assert_eq!(schedule_commits(&rt).len(), 4, "every firing ledgers");
}

#[test]
fn reconcile_drops_and_repopulates_a_schedule_whose_trigger_changed() {
    let mut rt = runtime(vec![row_schedule("expire", "admin.purge", false)]);
    seed(
        &mut rt,
        vec![row("a", Some(5), true), row("b", Some(6), true)],
    );
    let armed = timers(&rt);
    assert_eq!(armed.len(), 2);
    // Same name, a different trigger: the row timers are dropped and the period is armed.
    rt.apply_successor_at(
        generation(vec![period_schedule("expire", "admin.sweep", MINUTE)]),
        1_000,
    )
    .unwrap();
    let period = timers(&rt);
    assert_eq!(period.len(), 1, "{period:?}");
    assert_eq!(
        (
            period[0].row_id.as_deref(),
            period[0].period_start,
            period[0].at
        ),
        (None, Some(1_000), 1_000 + MINUTE)
    );
    // Back to the row trigger: the period row is dropped and the rows repopulate under the
    // new generation, with the same occurrence ids they had before.
    let restored = generation(vec![row_schedule("expire", "admin.purge", false)]);
    let hash = restored.hash();
    rt.apply_successor_at(restored, 2_000).unwrap();
    let again = timers(&rt);
    assert_eq!(again.iter().map(|t| t.at).collect::<Vec<_>>(), vec![5, 6]);
    assert_eq!(
        again.iter().map(|t| &t.id).collect::<Vec<_>>(),
        armed.iter().map(|t| &t.id).collect::<Vec<_>>()
    );
    assert!(again.iter().all(|t| t.generation == hash), "{again:?}");
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — install and reset
// anchor a period to the clock the caller passes, which the owner samples from its dev clock.
#[test]
fn successor_and_reset_anchor_period_timers_to_the_supplied_clock_not_wall_time() {
    let mut rt = runtime(vec![]);
    seed(&mut rt, vec![row("a", Some(5), true)]);
    // 2100-01-01: no wall clock this test runs under is near it, so a wall anchor would show.
    let advanced = 4_102_444_800_000_i64;
    rt.apply_successor_at(
        generation(vec![period_schedule("daily", "admin.sweep", MINUTE)]),
        advanced,
    )
    .unwrap();
    let installed = timers(&rt);
    assert_eq!(installed.len(), 1, "{installed:?}");
    assert_eq!(
        (installed[0].period_start, installed[0].at),
        (Some(advanced), advanced + MINUTE)
    );
    assert!(
        rt.fire_due_at(64, advanced + MINUTE - 1)
            .unwrap()
            .is_empty(),
        "the period is not already due under the advanced clock"
    );
    let later = advanced + 7 * MINUTE;
    rt.reset_and_seed_at(&[("items".into(), row("z", Some(9), true))], later)
        .unwrap();
    let after = timers(&rt);
    assert_eq!(after.len(), 1, "{after:?}");
    assert_eq!(
        (after[0].period_start, after[0].at),
        (Some(later), later + MINUTE),
        "reset re-arms the period from the supplied clock"
    );
}

#[test]
fn timers_summary_lists_every_declared_schedule_with_a_zero_row_count() {
    let mut rt = runtime(vec![
        row_schedule("expire", "admin.purge", false),
        period_schedule("daily", "admin.sweep", MINUTE),
    ]);
    seed(&mut rt, vec![row("a", None, true)]);
    let schedules = rt.generation().schema().schedules.clone();
    let summary = rt.store().timers_summary(0, &schedules).unwrap();
    let listed = summary["schedules"].as_array().unwrap();
    assert_eq!(listed.len(), 2, "{summary}");
    assert_eq!(
        (listed[0]["schedule"].as_str(), listed[0]["count"].as_i64()),
        (Some("daily"), Some(1))
    );
    assert_eq!(
        listed[1],
        serde_json::json!({"schedule": "expire", "count": 0, "due": 0, "next_at": null}),
        "a declared schedule with no row is present at zero"
    );
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the declaration's
// site is diagnostics, not identity: moving a schedule down a line is not a successor.
#[test]
fn a_schedule_declaration_site_is_diagnostics_not_identity() {
    let mut moved = row_schedule("expire", "admin.purge", false);
    moved.site = "snapback/admin.q:2:1".into();
    let a = generation(vec![row_schedule("expire", "admin.purge", false)]);
    let b = generation(vec![moved.clone()]);
    assert_eq!(
        a.hash(),
        b.hash(),
        "a blank line above a schedule is not a successor"
    );
    assert_eq!(a.schema().hash(), b.schema().hash());
    assert_eq!(a.program_hash(), b.program_hash());
    assert!(
        !serde_json::to_string(b.schema())
            .unwrap()
            .contains("snapback/admin.q"),
        "the site never reaches the wire schema"
    );
    assert_eq!(
        b.schema().schedules[0].site,
        "snapback/admin.q:2:1",
        "the site stays on the schedule for diagnostics"
    );
    let mut bad = moved;
    bad.trigger = Trigger::Row {
        table: "items".into(),
        column: "n".into(),
    };
    let errors = certify(vec![bad]).unwrap_err();
    assert_eq!(errors[0].0, "snapback/admin.q:2:1");
}
