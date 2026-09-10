use super::*;
use snapback2_core::timers::{Schedule, Trigger};

fn reject() -> Stmt {
    Stmt::Require {
        condition: Expr::Literal(Value::Bool(false)),
        code: "AFTER_DELETE".into(),
        site: Some("expiry.q:3:3".into()),
    }
}
fn variable(name: &str) -> Expr {
    Expr::Variable(name.into())
}
fn timed_message(name: &str, at: i64) -> (String, Value) {
    let mut row = message(name, "c1").1.as_object().unwrap().clone();
    row.insert("expiresAt".into(), Value::Int(at));
    ("messages".into(), Value::Row(row.into()))
}
fn timer_runtime(fail: bool) -> Runtime {
    let mut schema = schema(3, Some(deliver(false)));
    schema.tables.get_mut("messages").unwrap().columns.insert(
        "expiresAt".into(),
        ColumnType::Optional(Box::new(ColumnType::Time)),
    );
    let target = Program {
        name: "expiry.delete".into(),
        args: BTreeMap::from([(
            "rowId".into(),
            ArgType::Ref {
                table: "messages".into(),
            },
        )]),
        body: vec![Stmt::Delete {
            table: "messages".into(),
            key: variable("rowId"),
        }]
        .into_iter()
        .chain(fail.then(reject))
        .collect(),
        ..mutation(vec![])
    };
    let binding = Program {
        name: "expiry.binding".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(
            "id".into(),
            ArgType::Ref {
                table: "messages".into(),
            },
        )]),
        body: vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), Expr::Literal(Value::Bool(true))),
            (
                "args".into(),
                Expr::Object(BTreeMap::from([("rowId".into(), variable("id"))])),
            ),
        ])))],
        ..mutation(vec![])
    };
    schema.schedules.push(Schedule {
        name: "expire".into(),
        trigger: Trigger::Row {
            table: "messages".into(),
            column: "expiresAt".into(),
        },
        target: target.name.clone(),
        binding: binding.name.clone(),
        site: "expiry.q:1:1".into(),
    });
    let generation =
        Generation::certify(&project(schema, vec![binding, target]), Ceilings::default()).unwrap();
    let mut rt = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    rt.seed(&[
        member("a", "c1", "alice"),
        member("b", "c1", "bob"),
        timed_message("m", 5),
        timed_message("later", 50),
    ])
    .unwrap();
    run(&mut rt, vec![delete("memberships", "b")]);
    rt
}

#[test]
fn schedule_delete_delivers_the_departed_recipient_tombstone_and_settles() {
    let mut rt = timer_runtime(false);
    let fired = rt.fire_due_at(64, 10).unwrap();
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].firing.outcome["state"], "committed");
    assert_eq!(rows_of(&mut rt, "messages").len(), 1);
    let removed: Vec<_> = rows_of(&mut rt, "deliveries")
        .into_iter()
        .filter(|r| field(r, "kind") == &Value::String("removed".into()))
        .collect();
    assert_eq!(removed.len(), 2);
    assert!(removed.iter().any(|r| field(r, "recipient") == &id("bob")));
    assert!(rt.fire_due_at(64, 10).unwrap().is_empty());
}

#[test]
fn schedule_delete_rollback_restores_body_and_events_but_records_rejection() {
    let mut rt = timer_runtime(true);
    let before = rows_of(&mut rt, "deliveries");
    let fired = rt.fire_due_at(64, 10).unwrap();
    assert_eq!(fired[0].firing.outcome["state"], "rejected");
    assert_eq!(fired[0].firing.outcome["code"], "AFTER_DELETE");
    assert_eq!(rows_of(&mut rt, "messages").len(), 2);
    assert_eq!(rows_of(&mut rt, "deliveries"), before);
    assert!(rt.fire_due_at(64, 10).unwrap().is_empty());
}

#[test]
fn job_delete_fanout_and_rollback_are_per_chunk() {
    for fail in [false, true] {
        let mut rt = Runtime::open(
            Store::memory().unwrap(),
            generation(schema(3, Some(deliver(false)))),
        )
        .unwrap();
        rt.seed(&[
            member("a", "c1", "alice"),
            member("b", "c1", "bob"),
            message("m", "c1"),
            message("n", "c1"),
        ])
        .unwrap();
        run(&mut rt, vec![delete("memberships", "b")]);
        rt.apply_successor(generation(schema(1, Some(deliver(false)))))
            .unwrap();
        let before = rows_of(&mut rt, "deliveries");
        let Stmt::Return(Expr::Scan(mut scan)) = scan("messages").body.remove(0) else {
            unreachable!()
        };
        scan.take = Bound::Literal(3);
        let p = Program {
            name: "expiry.sweep".into(),
            kind: ProgramKind::Job,
            body: vec![Stmt::For {
                binding: "message".into(),
                domain: LoopDomain::Page(scan),
                body: vec![Stmt::Delete {
                    table: "messages".into(),
                    key: Expr::Field {
                        base: Box::new(variable("message")),
                        name: "id".into(),
                    },
                }]
                .into_iter()
                .chain(fail.then(reject))
                .collect(),
            }],
            ..mutation(vec![])
        };
        let id = rt
            .enqueue_adhoc_job(
                &p,
                BTreeMap::new(),
                OperatorId("tester".into()),
                || 10,
                String::new(),
            )
            .unwrap();
        let outcome = rt.run_chunk_at(&id, 10).unwrap();
        if fail {
            assert_eq!(outcome.job.state, "parked");
            assert_eq!(outcome.job.last_error.unwrap().code, "AFTER_DELETE");
            assert_eq!(rows_of(&mut rt, "messages").len(), 2);
            assert_eq!(rows_of(&mut rt, "deliveries"), before);
        } else {
            assert_eq!(outcome.job.state, "done", "{:?}", outcome.job.last_error);
            assert!(rows_of(&mut rt, "messages").is_empty());
            assert_eq!(rows_of(&mut rt, "deliveries").len(), 8);
        }
    }
}
