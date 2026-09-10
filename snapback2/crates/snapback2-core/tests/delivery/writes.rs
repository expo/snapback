use super::*;

fn mutation(body: Vec<Stmt>) -> Program {
    Program {
        name: "custody.write".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}
fn insert_message(name: &str) -> Stmt {
    Stmt::Insert {
        table: "messages".into(),
        row: Expr::Literal(message(name, "c1").1),
    }
}
fn delete(table: &str, name: &str) -> Stmt {
    Stmt::Delete {
        table: table.into(),
        key: Expr::Literal(id(name)),
    }
}
fn edit(name: &str, body: &str) -> Stmt {
    Stmt::Update {
        table: "messages".into(),
        key: Expr::Literal(id(name)),
        patch: Expr::Literal(row([("body", Value::String(body.into()))])),
    }
}
fn invoke(engine: &mut Engine, body: Vec<Stmt>) -> Result<Execution, RuntimeError> {
    let program = mutation(body);
    let certificate = Checker::new(engine.schema(), Ceilings::default())
        .check(&program)
        .unwrap();
    engine.execute(
        &program,
        &certificate,
        Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
    )
}
fn execute(engine: &mut Engine, body: Vec<Stmt>) -> Execution {
    invoke(engine, body).unwrap()
}
fn populated() -> Engine {
    let mut engine = Engine::memory(schema(3, Some(deliver(false)))).unwrap();
    for member in [
        member("a", "c1", "alice"),
        member("b", "c1", "bob"),
        member("b2", "c1", "bob"),
    ] {
        engine.seed(&member.0, member.1).unwrap();
    }
    engine
}
fn recipients(engine: &Engine, kind: &str) -> Vec<String> {
    let mut recipients: Vec<_> = engine
        .rows("deliveries")
        .unwrap()
        .iter()
        .filter(|row| row.field("kind").unwrap().as_str().unwrap() == kind)
        .map(|row| row.field("recipient").unwrap().as_str().unwrap().to_owned())
        .collect();
    recipients.sort();
    recipients
}

#[test]
fn delivered_insert_and_seed_cover_the_cap_group() {
    let mut engine = populated();
    let execution = execute(&mut engine, vec![insert_message("m")]);
    println!(
        "insert state={:?} delivered={:?}",
        execution.state,
        recipients(&engine, "delivered")
    );
    assert_eq!(recipients(&engine, "delivered"), ["alice", "bob"]);
    let seeded = message("seeded", "c1");
    engine.seed(&seeded.0, seeded.1).unwrap();
    assert_eq!(
        recipients(&engine, "delivered"),
        ["alice", "alice", "bob", "bob"]
    );
    assert!(
        engine
            .rows("deliveries")
            .unwrap()
            .iter()
            .all(|r| r.field("audience").unwrap() == &Value::Int(2))
    );
}

#[test]
fn fixture_seed_waives_work_ceilings_but_keeps_the_heap_ceiling() {
    let mut engine = Engine::memory(schema(11_000, Some(deliver(false)))).unwrap();
    let member = member("a", "c1", "alice");
    engine.seed(&member.0, member.1).unwrap();
    let message = message("m", "c1");
    let error = engine.seed(&message.0, message.1).unwrap_err();
    assert_eq!(error.code(), "E_BOUND");
    assert!(error.to_string().contains("heap"), "{error}");
    assert!(engine.rows("messages").unwrap().is_empty());
    assert!(engine.rows("deliveries").unwrap().is_empty());
}

#[test]
fn changed_removed_and_reuse_follow_original_custody() {
    let mut engine = populated();
    execute(&mut engine, vec![insert_message("m")]);
    execute(
        &mut engine,
        vec![delete("memberships", "b"), delete("memberships", "b2")],
    );
    let carol = member("c", "c1", "carol");
    engine.seed(&carol.0, carol.1).unwrap();
    execute(
        &mut engine,
        vec![edit("m", "first"), edit("m", "second"), edit("m", "second")],
    );
    println!("changed={:?}", recipients(&engine, "changed"));
    assert_eq!(
        recipients(&engine, "changed"),
        ["alice", "alice", "bob", "bob"]
    );
    execute(&mut engine, vec![delete("messages", "m")]);
    assert_eq!(recipients(&engine, "removed"), ["alice", "bob"]);
    let reused = invoke(&mut engine, vec![insert_message("m")]).unwrap_err();
    println!("reuse={reused}");
    assert_eq!(reused.code(), "E_DELIVER_INCARNATION");
    assert_eq!(
        reused.require_site().as_deref(),
        Some("custody.write/body/0")
    );
}

#[test]
fn delivery_insert_reserves_overflow_and_generated_writes() {
    let schema = schema(3, Some(deliver(false)));
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&mutation(vec![insert_message("m")]))
        .unwrap();
    println!(
        "examined={} index={} writes={:?}",
        certificate.max_examined, certificate.max_index_entries, certificate.write_sites
    );
    assert_eq!(certificate.max_examined, 4);
    assert_eq!(certificate.max_index_entries, 4);
    assert!(
        certificate
            .write_sites
            .iter()
            .any(|s| s.table == "deliveries" && s.max_rows == 4)
    );
}

#[test]
fn upsert_existing_and_rollback_are_atomic() {
    let mut engine = populated();
    execute(&mut engine, vec![insert_message("m")]);
    let mut updated = message("m", "c1").1.as_object().unwrap().clone();
    updated.insert("body".into(), Value::String("replacement".into()));
    execute(
        &mut engine,
        vec![Stmt::Upsert {
            table: "messages".into(),
            key: Expr::Literal(id("m")),
            row: Expr::Literal(Value::Row(updated.into())),
        }],
    );
    assert_eq!(recipients(&engine, "changed"), ["alice", "bob"]);
    let before = engine.rows("deliveries").unwrap();
    let failure = Stmt::Require {
        condition: Expr::Literal(Value::Bool(false)),
        code: "ROLLBACK".into(),
        site: None,
    };
    assert!(
        invoke(
            &mut engine,
            vec![
                edit("m", "rolled back"),
                delete("messages", "m"),
                failure.clone()
            ]
        )
        .is_err()
    );
    assert_eq!(engine.rows("deliveries").unwrap(), before);
    assert!(invoke(&mut engine, vec![insert_message("new"), failure]).is_err());
    execute(&mut engine, vec![insert_message("new")]);
    assert_eq!(recipients(&engine, "delivered").len(), 4);
}

#[test]
fn zero_audience_still_refuses_retired_id_and_seed_cannot_overfill_cap() {
    let mut empty = Engine::memory(schema(3, Some(deliver(false)))).unwrap();
    execute(
        &mut empty,
        vec![insert_message("m"), delete("messages", "m")],
    );
    assert_eq!(
        invoke(&mut empty, vec![insert_message("m")])
            .unwrap_err()
            .code(),
        "E_DELIVER_INCARNATION"
    );
    let mut engine = populated();
    let extra = member("overflow", "c1", "carol");
    assert_eq!(
        engine.seed(&extra.0, extra.1).unwrap_err().code(),
        "E_CONSTRAINT"
    );
    assert_eq!(engine.rows("memberships").unwrap().len(), 3);
}

#[test]
fn delivery_containment_guards_the_reserve_even_with_an_empty_group() {
    let schema = schema(3, Some(deliver(false)));
    let program = mutation(vec![insert_message("m"), insert_message("n")]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let scratch =
        snapback2_core::certificate::declared_serialized_row_max(&schema, "memberships").max(
            snapback2_core::certificate::declared_serialized_row_max(&schema, "deliveries"),
        ) * 4
            + 256;
    for meter in ["examined", "index", "heap", "writes", "steps", "site"] {
        let mut engine = Engine::memory(schema.clone()).unwrap();
        let mut broken = cert.clone();
        match meter {
            "examined" => broken.max_examined = 7,
            "index" => broken.max_index_entries = 7,
            "heap" => broken.max_heap_bytes = 8 * scratch + 168 * 32 - 1,
            "steps" => broken.max_steps = 167,
            "site" => broken.indexes_required.clear(),
            _ => {
                broken.write_sites.retain(|w| w.table != "deliveries");
            }
        }
        let outcome = engine.execute(
            &program,
            &broken,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        );
        assert!(outcome.is_err(), "{meter}: {outcome:?}");
        assert!(engine.rows("messages").unwrap().is_empty(), "{meter}");
        assert!(engine.rows("deliveries").unwrap().is_empty(), "{meter}");
    }
}

#[test]
fn audience_bound_specializes_all_native_meters_and_names_the_deliver_term() {
    let schema = schema(1, Some(deliver(false)));
    let program = mutation(vec![delete("messages", "m")]);
    let base = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let audiences = BTreeMap::from([("deliveries".into(), 3)]);
    let priced = base
        .with_delivery_audiences(&schema, &audiences, &Ceilings::default())
        .unwrap();
    assert_eq!(
        (
            base.max_examined,
            priced.max_examined,
            priced.max_index_entries
        ),
        (1, 3, 3)
    );
    assert!(priced.max_steps > base.max_steps && priced.max_heap_bytes > base.max_heap_bytes);
    assert_eq!(
        priced.max_rule_probes, base.max_rule_probes,
        "engine-owned reads/writes invoke no rules"
    );
    assert_eq!(
        priced.max_closure_bytes, base.max_closure_bytes,
        "private audience is not receipt authority"
    );
    assert!(
        priced
            .write_sites
            .iter()
            .any(|w| w.table == "deliveries" && w.max_rows == 3)
    );
    for meter in ["examined", "index", "steps", "heap", "writes"] {
        let mut ceilings = Ceilings::default();
        match meter {
            "examined" => ceilings.examined = 2,
            "index" => ceilings.index_entries = 2,
            "steps" => ceilings.steps = base.max_steps,
            "heap" => ceilings.heap_bytes = base.max_heap_bytes,
            _ => ceilings.write_rows = 3,
        }
        let error = base
            .with_delivery_audiences(&schema, &audiences, &ceilings)
            .unwrap_err();
        assert_eq!(error.code, "E_BOUND");
        assert_eq!(
            error.site.as_deref(),
            Some("schema.tables.messages.deliver")
        );
        assert!(
            error
                .message
                .contains("deliver to memberships[.conversationId] as deliveries")
                && error.message.contains("A 3"),
            "{error:?}"
        );
    }
    let over = Checker::new(
        &schema,
        Ceilings {
            write_rows: 1,
            ..Ceilings::default()
        },
    )
    .check(&program)
    .unwrap_err();
    assert!(over.message.contains("deliver to"), "{over:?}");
}

fn run(rt: &mut Runtime, body: Vec<Stmt>) -> Execution {
    rt.execute_adhoc(
        &mutation(body),
        Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
    )
    .unwrap()
}

#[test]
fn live_writes_and_bootstrap_keep_incarnation_through_a_cap_lowering() {
    for bootstrap in [false, true] {
        let mut rt = Runtime::open(
            Store::memory().unwrap(),
            generation(schema(
                3,
                if bootstrap {
                    None
                } else {
                    Some(deliver(false))
                },
            )),
        )
        .unwrap();
        rt.seed(&[
            member("a", "c1", "alice"),
            member("b", "c1", "bob"),
            message("m", "c1"),
        ])
        .unwrap();
        if bootstrap {
            rt.apply_successor(generation(schema(3, Some(deliver(true)))))
                .unwrap();
        }
        let delivered = rows_of(&mut rt, "deliveries");
        let incarnation = delivered[0].field("incarnation").unwrap().clone();
        run(&mut rt, vec![delete("memberships", "b")]);
        rt.apply_successor(generation(schema(1, Some(deliver(false)))))
            .unwrap();
        assert_eq!(audience_bound(&rt), Some(2));
        run(
            &mut rt,
            vec![edit("m", "still delivered"), delete("messages", "m")],
        );
        let events = rows_of(&mut rt, "deliveries");
        assert_eq!(events.len(), 6);
        assert!(
            events
                .iter()
                .all(|r| r.field("incarnation").unwrap() == &incarnation)
        );
        for kind in ["changed", "removed"] {
            assert!(events.iter().any(|r| field(r, "recipient") == &id("bob")
                && field(r, "kind") == &Value::String(kind.into())));
        }
        println!(
            "bootstrap={bootstrap} cap=1 A=2 events={} incarnation={incarnation:?}",
            events.len()
        );
    }
}

#[test]
fn a_nonuniform_scan_cannot_spend_the_native_delivery_reserve() {
    let mut schema = schema(3, Some(deliver(false)));
    schema.tables.get_mut("memberships").unwrap().rules.read =
        RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);
    let Stmt::Return(scan) = scan("memberships").body.remove(0) else {
        unreachable!()
    };
    for write in [
        insert_message("m"),
        edit("m", "text"),
        delete("messages", "m"),
    ] {
        let p = mutation(vec![
            Stmt::Let {
                name: "others".into(),
                value: scan.clone(),
            },
            write,
        ]);
        let error = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap_err();
        assert_eq!(error.code, "E_STRUCTURAL_FANOUT");
        assert!(
            error.message.contains("memberships") && error.message.contains("messages"),
            "{error:?}"
        );
    }
}

#[test]
fn receipt_only_execution_skips_custody_even_when_memberships_are_held() {
    let mut engine = populated();
    let schema = engine.schema().clone();
    let mut receipt = engine
        .execute(
            &scan("memberships"),
            &Checker::new(&schema, Ceilings::default())
                .check(&scan("memberships"))
                .unwrap(),
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap()
        .receipt;
    receipt
        .absences
        .push(("messages".into(), "byId".into(), vec![id("m")]));
    let mut client = ClientStore::hydrate(schema.clone(), &receipt).unwrap();
    let program = mutation(vec![insert_message("m")]);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let (state, execution) = client
        .apply_mutation(
            &program,
            &certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(state, LocalState::Predicted);
    assert_eq!(execution.trace.writes.get("messages"), Some(&1));
    assert!(!execution.trace.writes.contains_key("deliveries"));
    assert!(
        execution
            .trace
            .touched
            .iter()
            .all(|t| t.table != "deliveries")
    );
}

#[test]
fn a_queued_delete_across_a_cap_successor_keeps_historical_custody() {
    let operation = mutation(vec![delete("messages", "m")]);
    let generation_for = |cap| {
        Generation::certify(
            &project(schema(cap, Some(deliver(false))), vec![operation.clone()]),
            Ceilings::default(),
        )
        .unwrap()
    };
    let mut rt = Runtime::open(Store::memory().unwrap(), generation_for(3)).unwrap();
    rt.seed(&[
        member("a", "c1", "alice"),
        member("b", "c1", "bob"),
        message("m", "c1"),
    ])
    .unwrap();
    let grant = rt.mint_replay_grant("alice", 10).unwrap();
    let intent = format!("{}:0", grant.id);
    let queued = snapback2_core::offline::ReplayCommit {
        grant: grant.id,
        offset: 0,
        count: 1,
        intent: intent.clone(),
        request_digest: "d".repeat(64),
        trace: Default::default(),
        at: 20,
    };
    run(&mut rt, vec![delete("memberships", "b")]);
    rt.apply_successor(generation_for(1)).unwrap();
    assert_eq!(audience_bound(&rt), Some(2));
    let replayed = rt
        .execute_replay(
            &operation.name,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            &queued,
        )
        .unwrap();
    assert!(matches!(replayed.state, ExecutionState::Committed { .. }));
    let removed: Vec<_> = rows_of(&mut rt, "deliveries")
        .into_iter()
        .filter(|r| field(r, "kind") == &Value::String("removed".into()))
        .collect();
    assert_eq!(removed.len(), 2);
    assert!(removed.iter().any(|r| field(r, "recipient") == &id("bob")));
    assert!(rows_of(&mut rt, "messages").is_empty());
    assert_eq!(
        rt.store()
            .stored_client_intent("alice", &intent)
            .unwrap()
            .unwrap()
            .response["state"],
        "committed"
    );
}

#[path = "schedules.rs"]
mod schedules;

#[test]
fn same_commit_membership_and_group_moves_do_not_rewrite_send_time_custody() {
    let mut engine = Engine::memory(schema(3, Some(deliver(false)))).unwrap();
    let membership_insert = |name, principal| Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(member(name, "c1", principal).1),
    };
    execute(
        &mut engine,
        vec![
            membership_insert("a", "alice"),
            insert_message("m"),
            membership_insert("b", "bob"),
            Stmt::Update {
                table: "messages".into(),
                key: Expr::Literal(id("m")),
                patch: Expr::Literal(row([("conversationId", id("c2"))])),
            },
            delete("messages", "m"),
        ],
    );
    assert_eq!(recipients(&engine, "delivered"), ["alice"]);
    assert_eq!(recipients(&engine, "changed"), ["alice"]);
    assert_eq!(recipients(&engine, "removed"), ["alice"]);
    assert!(
        engine
            .rows("deliveries")
            .unwrap()
            .iter()
            .all(|r| field(r, "conversationId") == &id("c1"))
    );
}

#[test]
fn reset_clears_retired_ids_and_recomputes_audience_before_certified_seeding() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        generation(schema(3, Some(deliver(false)))),
    )
    .unwrap();
    rt.seed(&[
        member("a", "c1", "alice"),
        member("b", "c1", "bob"),
        message("m", "c1"),
    ])
    .unwrap();
    run(
        &mut rt,
        vec![delete("memberships", "b"), delete("messages", "m")],
    );
    rt.apply_successor(generation(schema(1, Some(deliver(false)))))
        .unwrap();
    assert_eq!(audience_bound(&rt), Some(2));
    rt.reset_and_seed_at(
        &[
            member("a", "c1", "alice"),
            message("m", "c1"),
            message("m", "c1"),
        ],
        50,
    )
    .unwrap();
    assert_eq!(audience_bound(&rt), Some(1));
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 1);
}

#[test]
fn log_maintains_share_native_writes_and_the_historical_reserve() {
    let make_schema = |cap| {
        let mut s = schema(cap, Some(deliver(false)));
        s.tables.insert(
            "eventCounts".into(),
            table(
                &[
                    ("id", ColumnType::Id),
                    ("recipient", ColumnType::Principal),
                    ("value", ColumnType::Int),
                ],
                &[
                    ("byId", &["id"], true),
                    ("byRecipient", &["recipient"], true),
                ],
            ),
        );
        s.maintains.push(Maintain {
            kind: MaintainKind::Count,
            source: "deliveries".into(),
            by: vec!["recipient".into()],
            target: "eventCounts".into(),
            readable: None,
        });
        s
    };
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(make_schema(3))).unwrap();
    rt.seed(&[
        member("a", "c1", "alice"),
        member("b", "c1", "bob"),
        message("m", "c1"),
    ])
    .unwrap();
    assert!(
        rows_of(&mut rt, "eventCounts")
            .iter()
            .all(|r| field(r, "value") == &Value::Int(1))
    );
    run(&mut rt, vec![delete("memberships", "b")]);
    rt.apply_successor(generation(make_schema(1))).unwrap();
    let execution = run(&mut rt, vec![edit("m", "changed"), delete("messages", "m")]);
    assert!(
        matches!(execution.state, ExecutionState::Committed { .. }),
        "{:?}",
        execution.state
    );
    let counts = rows_of(&mut rt, "eventCounts");
    assert_eq!(counts.len(), 2);
    assert!(counts.iter().all(|r| field(r, "value") == &Value::Int(3)));
}
