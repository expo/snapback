use super::delivery_spike::*;
use super::*;
use crate::{Ceilings, Checker, Generation, OperatorId, ProjectJson, Runtime};

fn runtime(s: Schema, programs: Vec<Program>) -> Runtime {
    let project = ProjectJson {
        version: 1,
        auth: s.auth.clone(),
        schema: s,
        programs,
        effects: vec![],
    };
    Runtime::open(
        Store::memory().unwrap(),
        Generation::certify(&project, Ceilings::default()).unwrap(),
    )
    .unwrap()
}

#[test]
fn native_product_seed_upsert_and_raw_fixture_closure() {
    let mut rt = runtime(schema(true, 3), vec![]);
    rt.seed(&[
        ("memberships".into(), member("a", "alice")),
        ("memberships".into(), member("b", "bob")),
        ("messages".into(), message("m")),
    ])
    .unwrap();
    assert_eq!(recipients(&rt.engine, "delivered"), ["alice", "bob"]);
    rt.seed(&[("messages".into(), message("m"))]).unwrap();
    assert_eq!(
        recipients(&rt.engine, "delivered"),
        ["alice", "bob"],
        "existing upsert must not redeliver"
    );
    let mut raw = populated(true);
    raw.seed("messages", message("m")).unwrap();
    assert_eq!(recipients(&raw, "delivered"), ["alice", "bob"]);
    println!("product seed delivered=2; existing upsert delivered=2; Engine::seed delivered=2");
}

#[test]
fn native_same_transaction_audience_and_deduplication() {
    let mut e = Engine::memory(schema(true, 4)).unwrap();
    e.seed("memberships", member("a", "alice")).unwrap();
    let p = program(
        "send",
        vec![
            Stmt::Insert {
                table: "memberships".into(),
                row: Expr::Literal(member("b", "bob")),
            },
            Stmt::Insert {
                table: "memberships".into(),
                row: Expr::Literal(member("b2", "bob")),
            },
            insert("m"),
            Stmt::Insert {
                table: "memberships".into(),
                row: Expr::Literal(member("c", "carol")),
            },
        ],
    );
    execute(&mut e, &p).unwrap();
    assert_eq!(recipients(&e, "delivered"), ["alice", "bob"]);
    for row in e.rows("deliveries").unwrap() {
        assert_eq!(row.field("audience").unwrap(), &Value::Int(2));
    }
}

#[test]
fn native_rollback_and_write_reserve_containment() {
    let mut e = populated(true);
    let p = program(
        "send",
        vec![
            insert("m"),
            Stmt::Require {
                condition: Expr::Literal(Value::Bool(false)),
                code: "NO".into(),
                site: None,
            },
        ],
    );
    let error = execute(&mut e, &p).unwrap_err();
    assert!(matches!(error, RuntimeError::Require { .. }));
    assert!(e.rows("messages").unwrap().is_empty());
    assert!(e.rows("deliveries").unwrap().is_empty());
    let p = program("send", vec![insert("m")]);
    let mut c = Checker::new(&e.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    println!(
        "native send certificate: examined={} index={} writes={:?} steps={}",
        c.max_examined, c.max_index_entries, c.write_sites, c.max_steps
    );
    assert_eq!(c.max_examined, 4);
    assert_eq!(c.max_index_entries, 4);
    assert_eq!(
        c.write_sites
            .iter()
            .find(|w| w.table == "deliveries")
            .unwrap()
            .max_rows,
        3
    );
    c.write_sites.retain(|w| w.table != "deliveries");
    let error = e
        .execute(
            &p,
            &c,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap_err();
    println!("tampered certificate: {error}");
    assert!(error.to_string().contains("writes to deliveries"));
    assert!(e.rows("messages").unwrap().is_empty());
    assert!(e.rows("deliveries").unwrap().is_empty());
}

#[test]
fn native_nonuniform_scan_cannot_spend_delivery_reserve() {
    let scan: Scan = serde_json::from_value(
        serde_json::json!({"site":"private-log", "table":"deliveries","index":"byRow",
        "prefix":[{"Scalar":{"Literal":{"Id":"old"}}}],"order":"Asc","take":{"Literal":1},
        "after":null,"before":null,"range":null,"provenance":"Const"}),
    )
    .unwrap();
    let p = program(
        "mixed",
        vec![
            Stmt::Let {
                name: "ignored".into(),
                value: Expr::Scan(scan),
            },
            insert("m"),
        ],
    );
    let baseline = Checker::new(&schema(false, 3), Ceilings::default())
        .check(&p)
        .unwrap();
    assert_eq!(baseline.max_examined, 10_240);
    let refused = Checker::new(&schema(true, 3), Ceilings::default())
        .check(&p)
        .unwrap_err();
    println!("native mixed: {refused}");
    assert_eq!(refused.code, "E_STRUCTURAL_FANOUT");
}

#[test]
fn native_cap_prices_each_call_and_historical_bound_survives_lower_cap() {
    let mut s = schema(true, 3);
    s.tables.get_mut("memberships").unwrap().constraints = vec![Constraint::Cap {
        by: vec!["conversationId".into()],
        max: 1,
    }];
    let ins = Checker::new(&s, Ceilings::default())
        .check(&program("send", vec![insert("m")]))
        .unwrap();
    let del = Checker::new(&s, Ceilings::default())
        .check(&program("unsend", vec![delete("m")]))
        .unwrap();
    assert_eq!(
        ins.write_sites
            .iter()
            .find(|w| w.table == "deliveries")
            .unwrap()
            .max_rows,
        1
    );
    assert_eq!(
        del.write_sites
            .iter()
            .find(|w| w.table == "deliveries")
            .unwrap()
            .max_rows,
        3
    );
    let p = program(
        "many",
        vec![Stmt::For {
            binding: "i".into(),
            domain: LoopDomain::LiteralRange {
                start: 0,
                end_exclusive: 600,
            },
            body: vec![insert("m")],
        }],
    );
    let error = Checker::new(&schema(true, 3), Ceilings::default())
        .check(&p)
        .unwrap_err();
    assert_eq!(error.code, "E_BOUND");
    println!("native 600 x (1+3) writes: {error}");
}

#[test]
fn native_owner_schedule_delete_and_job_delete_use_hook() {
    use crate::timers::{Schedule, Trigger};
    for scheduled in [true, false] {
        let mut s = schema(true, 3);
        let mut target = program("purge", vec![delete("m")]);
        let mut programs = vec![];
        if scheduled {
            s.schedules.push(Schedule {
                name: "expiry".into(),
                trigger: Trigger::Row {
                    table: "messages".into(),
                    column: "expiresAt".into(),
                },
                target: "purge".into(),
                binding: "bindExpiry".into(),
                site: "P0".into(),
            });
            let mut binding = program(
                "bindExpiry",
                vec![Stmt::Return(Expr::Object(BTreeMap::from([
                    ("enabled".into(), Expr::Literal(Value::Bool(true))),
                    ("args".into(), Expr::Object(BTreeMap::new())),
                ])))],
            );
            binding.kind = ProgramKind::Query;
            binding.args.insert("id".into(), ArgType::Id);
            programs.push(binding);
        } else {
            target.kind = ProgramKind::Job;
            let scan: Scan = serde_json::from_value(serde_json::json!({"site":"sweep", "table":"messages","index":"byId","prefix":[],
                "order":"Asc","take":{"Literal":1},"after":null,"before":null,"range":null,"provenance":"Const"})).unwrap();
            target.body = vec![Stmt::For {
                binding: "row".into(),
                domain: LoopDomain::Page(scan),
                body: vec![Stmt::Delete {
                    table: "messages".into(),
                    key: Expr::Field {
                        base: Box::new(Expr::Variable("row".into())),
                        name: "id".into(),
                    },
                }],
            }];
        }
        programs.push(target);
        let mut rt = runtime(s, programs);
        let mut m = message("m").as_object().unwrap().clone();
        m.insert("expiresAt".into(), Value::Int(5));
        rt.seed(&[
            ("memberships".into(), member("a", "alice")),
            ("memberships".into(), member("b", "bob")),
            ("messages".into(), Value::Row(m.into())),
        ])
        .unwrap();
        let leave = program(
            "leave",
            vec![Stmt::Delete {
                table: "memberships".into(),
                key: Expr::Literal(Value::Id("b".into())),
            }],
        );
        rt.execute_adhoc_operator(&leave, BTreeMap::new(), OperatorId("p0".into()), || 3)
            .unwrap();
        if scheduled {
            let outcomes = rt.fire_due_at(1, 6).unwrap();
            assert_eq!(outcomes.len(), 1);
            println!("native schedule: {:?}", outcomes[0].firing.outcome);
        } else {
            let id = rt
                .enqueue_job_at("purge", BTreeMap::new(), OperatorId("p0".into()), 6)
                .unwrap();
            let outcome = rt.run_chunk_at(&id, 7).unwrap();
            println!(
                "native job: {} {:?}",
                outcome.job.state, outcome.job.rows_written
            );
        }
        assert_eq!(recipients(&rt.engine, "removed"), ["alice", "bob"]);
    }
}

#[test]
fn native_authoritative_offline_replay_uses_hook() {
    use crate::offline::{ReplayCommit, ReplayTrace};
    let mut e = populated(true);
    let p = program("send", vec![insert("m")]);
    let c = Checker::new(&e.schema, Ceilings::default())
        .check(&p)
        .unwrap();
    let replay = ReplayCommit {
        grant: "p0-grant".into(),
        offset: 0,
        count: 1,
        intent: "p0-grant:0".into(),
        request_digest: "d".repeat(64),
        trace: ReplayTrace::default(),
        at: 1,
    };
    let result = e
        .execute_replay(
            &p,
            &c,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            &replay,
        )
        .unwrap();
    assert!(matches!(result.state, ExecutionState::Committed { .. }));
    assert_eq!(recipients(&e, "delivered"), ["alice", "bob"]);
}

#[test]
fn native_all_kind_byrow_does_not_have_an_audience_bound() {
    let mut e = populated(true);
    execute(&mut e, &program("send", vec![insert("m")])).unwrap();
    // Repeated edits are out of the P0 execution slice but expose the RFC's index problem.
    for seq in 2..8 {
        e.seed(
            "deliveries",
            event_row(&message("m"), "alice", "changed", 1, 2, seq, 0),
        )
        .unwrap();
    }
    let result = execute(&mut e, &program("unsend", vec![delete("m")])).unwrap_err();
    assert!(matches!(result, RuntimeError::Input(_)));
    assert_eq!(e.rows("messages").unwrap().len(), 1);
    assert!(recipients(&e, "removed").is_empty());
    println!("native repeated-history guard: {result}");
}
