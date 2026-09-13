use super::*;

fn optional_schema() -> Schema {
    let mut s = schema(3, Some(deliver(false)));
    for table in ["messages", "memberships"] {
        s.tables.get_mut(table).unwrap().columns.insert(
            "conversationId".into(),
            ColumnType::Optional(Box::new(reference("conversations"))),
        );
    }
    s.tables.get_mut("messages").unwrap().columns.insert(
        "note".into(),
        ColumnType::Optional(Box::new(ColumnType::Text { max: 30 })),
    );
    s.tables.insert(
        "deliveries".into(),
        delivery::log_table(&s, "messages", &deliver(false)).unwrap(),
    );
    s
}
fn omitted(value: Value) -> Value {
    let mut fields = value.as_object().unwrap().clone();
    fields.remove("conversationId");
    Value::Row(fields.into())
}
fn optional_upsert(explicit: bool) -> Stmt {
    let mut fields = omitted(message("m", "c1").1).as_object().unwrap().clone();
    if explicit {
        fields.insert("conversationId".into(), Value::Null);
        fields.insert("note".into(), Value::Null);
    }
    Stmt::Upsert {
        table: "messages".into(),
        key: Expr::Literal(id("m")),
        row: Expr::Literal(Value::Row(fields.into())),
    }
}
#[test]
fn omitted_optional_images_deliver_into_null_group_without_false_changes() {
    let s = optional_schema();
    let mut engine = Engine::memory(s.clone()).unwrap();
    engine
        .seed("memberships", omitted(member("a", "c1", "alice").1))
        .unwrap();
    let inserted = execute(
        &mut engine,
        vec![Stmt::Insert {
            table: "messages".into(),
            row: Expr::Literal(omitted(message("m", "c1").1)),
        }],
    );
    assert!(matches!(inserted.state, ExecutionState::Committed { .. }));
    for explicit in [false, true, false] {
        execute(&mut engine, vec![optional_upsert(explicit)]);
    }
    let events = engine.rows("deliveries").unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(field(&events[0], "conversationId"), &Value::Null);
    assert_eq!(recipients(&engine, "delivered"), ["alice"]);
}
#[test]
fn both_seed_entries_normalize_optional_delivery_images() {
    let seeds: Vec<(String, Value)> = vec![
        ("memberships".into(), omitted(member("a", "c1", "alice").1)),
        ("messages".into(), omitted(message("m", "c1").1)),
    ];
    let mut engine = Engine::memory(optional_schema()).unwrap();
    for (table, value) in &seeds {
        engine.seed(table, value.clone()).unwrap();
    }
    engine.seed("messages", seeds[1].1.clone()).unwrap();
    assert_eq!(engine.rows("deliveries").unwrap().len(), 1);
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(optional_schema())).unwrap();
    rt.seed(&seeds).unwrap();
    rt.seed(&seeds[1..]).unwrap();
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 1);
}

#[test]
fn stripping_only_prior_delivery_index_refuses_before_scanning_and_rolls_back() {
    let mut engine = populated();
    let program = mutation(vec![insert_message("m")]);
    let mut certificate = Checker::new(engine.schema(), Ceilings::default())
        .check(&program)
        .unwrap();
    certificate
        .indexes_required
        .retain(|site| site != "deliveries.byRow");
    assert!(
        certificate
            .indexes_required
            .contains(&"memberships.byConversationPrincipal".into())
    );
    let result = engine.execute(
        &program,
        &certificate,
        Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
    );
    assert!(result.is_err(), "{result:?}");
    assert!(engine.rows("messages").unwrap().is_empty());
    assert!(engine.rows("deliveries").unwrap().is_empty());
}
#[test]
fn private_delivery_probes_trace_identities_prefixes_and_absences_without_receipts() {
    for audience in [0, 3] {
        let mut s = schema(3, Some(deliver(false)));
        s.tables.get_mut("memberships").unwrap().rules.read = RuleExpr::Deny;
        let mut engine = Engine::memory(s).unwrap();
        for principal in ["alice", "bob", "carol"].into_iter().take(audience) {
            engine
                .seed("memberships", member(principal, "c1", principal).1)
                .unwrap();
        }
        for (statement, target, prefix) in [
            (insert_message("m"), "memberships", vec![id("c1")]),
            (
                edit("m", "changed"),
                "deliveries",
                vec![id("m"), Value::String("delivered".into())],
            ),
            (
                delete("messages", "m"),
                "deliveries",
                vec![id("m"), Value::String("delivered".into())],
            ),
        ] {
            let insertion = matches!(statement, Stmt::Insert { .. });
            let execution = execute(&mut engine, vec![statement]);
            let inputs: Vec<_> = execution
                .trace
                .constraint_inputs
                .iter()
                .filter(|i| i.check.starts_with("Deliver"))
                .collect();
            assert_eq!(inputs.len(), if insertion { 2 } else { 1 });
            if insertion {
                assert_eq!(inputs[0].table, "deliveries");
                assert_eq!(inputs[0].index, "byRow");
                assert_eq!(
                    inputs[0].prefix,
                    [id("m"), Value::String("delivered".into())]
                );
                assert!(inputs[0].examined_ids.is_empty());
            }
            let input = inputs.last().unwrap();
            assert_eq!(input.table, target);
            assert_eq!(input.prefix, prefix);
            assert_eq!(input.examined_ids.len(), audience);
            if insertion && audience == 3 {
                assert_eq!(input.examined_ids, ["alice", "bob", "carol"]);
            }
            assert!(
                execution
                    .receipt
                    .rows
                    .iter()
                    .all(|r| r.table != "memberships" && r.table != "deliveries")
            );
            assert!(
                execution
                    .receipt
                    .ranges
                    .iter()
                    .all(|r| r.table != "memberships" && r.table != "deliveries")
            );
        }
        assert_eq!(recipients(&engine, "delivered").len(), audience);
        assert_eq!(recipients(&engine, "changed").len(), audience);
        assert_eq!(recipients(&engine, "removed").len(), audience);
    }
}

#[test]
fn historical_audience_specialization_replay_rejection_is_durable() {
    let path = std::env::temp_dir().join(format!(
        "custody-r1-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let operation = mutation(vec![delete("messages", "m"); 210]);
    let next = Generation::certify(
        &project(schema(1, Some(deliver(false))), vec![operation.clone()]),
        Ceilings::default(),
    )
    .unwrap();
    let mut rt = Runtime::open(
        Store::open(&path).unwrap(),
        generation(schema(10, Some(deliver(false)))),
    )
    .unwrap();
    let mut seeds: Vec<_> = (0..10)
        .map(|i| member(&format!("p{i}"), "c1", &format!("p{i}")))
        .collect();
    seeds.push(message("m", "c1"));
    rt.seed(&seeds).unwrap();
    run(
        &mut rt,
        (1..10)
            .map(|i| delete("memberships", &format!("p{i}")))
            .collect(),
    );
    rt.apply_successor(next.clone()).unwrap();
    assert_eq!(audience_bound(&rt), Some(10));
    let grant = rt.mint_replay_grant("alice", 10).unwrap();
    let replay = snapback3_core::offline::ReplayCommit {
        grant: grant.id.clone(),
        offset: 0,
        count: 1,
        intent: format!("{}:0", grant.id),
        request_digest: "d".repeat(64),
        trace: Default::default(),
        at: 20,
    };
    let context = || Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new());
    let execution = rt
        .execute_replay(&operation.name, context(), &replay)
        .unwrap();
    assert!(
        matches!(execution.state, ExecutionState::Rejected { ref code, .. } if code == "E_BOUND"),
        "{:?}",
        execution.state
    );
    let terminal = rt
        .store()
        .stored_client_intent("alice", &replay.intent)
        .unwrap()
        .unwrap()
        .response;
    assert_eq!(terminal["code"], "E_BOUND");
    assert!(
        !rt.store()
            .replay_slice_is_unused(&grant.id, "another", 0, 1)
            .unwrap()
    );
    assert_eq!(rows_of(&mut rt, "messages").len(), 1);
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 10);
    rt.execute_replay(&operation.name, context(), &replay)
        .unwrap();
    assert_eq!(
        rt.store()
            .stored_client_intent("alice", &replay.intent)
            .unwrap()
            .unwrap()
            .response,
        terminal
    );
    drop(rt);
    let mut rt = Runtime::open(Store::open(&path).unwrap(), next).unwrap();
    rt.execute_replay(&operation.name, context(), &replay)
        .unwrap();
    assert_eq!(
        rt.store()
            .stored_client_intent("alice", &replay.intent)
            .unwrap()
            .unwrap()
            .response,
        terminal
    );
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 10);
}

#[test]
fn historical_audience_specialization_settles_pending_then() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        generation(schema(10, Some(deliver(false)))),
    )
    .unwrap();
    let mut seeds: Vec<_> = (0..10)
        .map(|i| member(&format!("p{i}"), "c1", &format!("p{i}")))
        .collect();
    seeds.push(message("m", "c1"));
    rt.seed(&seeds).unwrap();
    run(
        &mut rt,
        (1..10)
            .map(|i| delete("memberships", &format!("p{i}")))
            .collect(),
    );
    let operation = mutation(vec![delete("messages", "m"); 210]);
    let mut emit = mutation(vec![Stmt::Emit {
        effect: "custody.effect".into(),
        payload: Expr::Literal(Value::Null),
    }]);
    emit.name = "custody.emit".into();
    let mut p = project(
        schema(1, Some(deliver(false))),
        vec![operation.clone(), emit],
    );
    p.schema.effects.push("custody.effect".into());
    p.effects.push(EffectDecl {
        name: "custody.effect".into(),
        grants: vec![],
        source: "async () => null".into(),
        then: Some(operation.name.clone()),
    });
    rt.apply_successor(Generation::certify(&p, Ceilings::default()).unwrap())
        .unwrap();
    let mut context = Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new());
    context.now = Some(1);
    context.new_ids.push_back("pending".into());
    rt.execute("custody.emit", context).unwrap();
    rt.claim_effect(1)
        .unwrap()
        .claimed
        .unwrap();
    rt.store()
        .outbox_settle(
            "pending",
            "then_pending",
            Some(&serde_json::Value::Null),
            None,
            None,
        )
        .unwrap();
    let execution = rt
        .execute_then(
            &operation.name,
            BTreeMap::new(),
            5,
            None,
            Default::default(),
            "pending",
        )
        .unwrap();
    assert!(
        matches!(execution.state, ExecutionState::Rejected { ref code, .. } if code == "E_BOUND")
    );
    let settled = rt.store().outbox_get("pending").unwrap().unwrap();
    assert_eq!(settled.state, "sent");
    assert!(settled.last_error.unwrap().contains("E_BOUND"));
    assert!(
        rt.execute_then(
            &operation.name,
            BTreeMap::new(),
            6,
            None,
            Default::default(),
            "pending"
        )
        .is_err()
    );
    assert_eq!(rows_of(&mut rt, "messages").len(), 1);
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 10);
}

fn notes_schema() -> Schema {
    serde_json::from_str(
        &serde_json::to_string(&schema(3, Some(deliver(false))))
            .unwrap()
            .replace("messages", "notes")
            .replace("\"body\"", "\"text\""),
    )
    .unwrap()
}
fn note() -> Value {
    row([
        ("id", id("n")),
        ("conversationId", id("c1")),
        ("authorId", id("alice")),
        ("text", Value::String("hello".into())),
    ])
}
fn reuse_note() -> Program {
    Program {
        name: "notes.reuse".into(),
        ..mutation(vec![Stmt::Insert {
            table: "notes".into(),
            row: Expr::Literal(note()),
        }])
    }
}
const NOTE_REPAIR: &str = "insert notes { authorId: viewer, conversationId, text }";
fn assert_incarnation_wire(wire: &serde_json::Value, site: &str) {
    assert_eq!(wire["code"], "E_DELIVER_INCARNATION", "{wire}");
    assert_eq!(wire["family"], "rule");
    assert_eq!(wire["site"], site);
    assert_eq!(wire["rewrite"], NOTE_REPAIR);
    assert_eq!(wire["guide"], "deliver");
}
fn retired_notes(programs: Vec<Program>, s: Schema) -> Runtime {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        Generation::certify(&project(s, programs), Ceilings::default()).unwrap(),
    )
    .unwrap();
    rt.seed(&[member("a", "c1", "alice"), ("notes".into(), note())])
        .unwrap();
    run(&mut rt, vec![delete("notes", "n")]);
    rt
}
#[test]
fn incarnation_repair_fits_the_table_on_direct_seed_and_replay() {
    let program = reuse_note();
    let mut rt = retired_notes(vec![program.clone()], notes_schema());
    let execution = rt
        .execute(
            &program.name,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_incarnation_wire(
        &snapback3_core::offline::replay_mutation_response(&execution, "direct", None),
        "notes.reuse:statement:1",
    );
    let grant = rt.mint_replay_grant("alice", 1).unwrap();
    let replay = snapback3_core::offline::ReplayCommit {
        grant: grant.id.clone(),
        offset: 0,
        count: 1,
        intent: format!("{}:0", grant.id),
        request_digest: "d".repeat(64),
        trace: Default::default(),
        at: 2,
    };
    let execution = rt
        .execute_replay(
            &program.name,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            &replay,
        )
        .unwrap();
    assert_incarnation_wire(
        &snapback3_core::offline::replay_mutation_response(&execution, &replay.intent, None),
        "notes.reuse:statement:1",
    );
    assert_incarnation_wire(
        &rt.store()
            .stored_client_intent("alice", &replay.intent)
            .unwrap()
            .unwrap()
            .response,
        "notes.reuse:statement:1",
    );
    assert!(rows_of(&mut rt, "notes").is_empty());
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 2);
    let mut engine = Engine::memory(notes_schema()).unwrap();
    engine.seed("notes", note()).unwrap();
    execute(&mut engine, vec![delete("notes", "n")]);
    let error = engine.seed("notes", note()).unwrap_err();
    assert_eq!(error.code(), "E_DELIVER_INCARNATION");
    assert_eq!(error.require_site().as_deref(), Some("seed:statement:1"));
    assert_eq!(error.rewrite().as_deref(), Some(NOTE_REPAIR));
}
#[test]
fn incarnation_job_and_schedule_keep_the_authored_write_and_settle_rollback() {
    let mut rt = retired_notes(vec![], notes_schema());
    let Stmt::Return(Expr::Scan(mut scan)) = scan("memberships").body.remove(0) else {
        unreachable!()
    };
    scan.take = Bound::Literal(1);
    let job = Program {
        name: "notes.sweep".into(),
        kind: ProgramKind::Job,
        body: vec![Stmt::For {
            binding: "member".into(),
            domain: LoopDomain::Page(scan),
            body: reuse_note().body,
        }],
        ..mutation(vec![])
    };
    let job_id = rt
        .enqueue_adhoc_job(
            &job,
            BTreeMap::new(),
            OperatorId("tester".into()),
            || 0,
            String::new(),
        )
        .unwrap();
    let outcome = rt.run_chunk_at(&job_id, 1).unwrap();
    assert_eq!(outcome.job.state, "parked");
    assert_incarnation_wire(
        &serde_json::to_value(outcome.job.last_error.unwrap()).unwrap(),
        "notes.sweep:statement:1:statement:1",
    );
    assert!(rows_of(&mut rt, "notes").is_empty());
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 2);

    let mut s = notes_schema();
    s.tables.insert(
        "clock".into(),
        table(
            &[
                ("id", ColumnType::Id),
                ("at", ColumnType::Optional(Box::new(ColumnType::Time))),
            ],
            &[("byId", &["id"], true)],
        ),
    );
    let binding = Program {
        name: "notes.binding".into(),
        kind: ProgramKind::Query,
        body: vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), Expr::Literal(Value::Bool(true))),
            ("args".into(), Expr::Object(BTreeMap::new())),
        ])))],
        ..mutation(vec![])
    };
    s.schedules.push(snapback3_core::timers::Schedule {
        name: "retryNote".into(),
        trigger: snapback3_core::timers::Trigger::Row {
            table: "clock".into(),
            column: "at".into(),
        },
        target: "notes.reuse".into(),
        binding: binding.name.clone(),
        site: "schedule.q:1:1".into(),
    });
    let mut rt = retired_notes(vec![binding, reuse_note()], s);
    rt.seed(&[(
        "clock".into(),
        row([("id", id("clock")), ("at", Value::Int(1))]),
    )])
    .unwrap();
    let fired = rt.fire_due_at(64, 2).unwrap();
    assert_eq!(fired.len(), 1);
    assert_incarnation_wire(&fired[0].firing.outcome, "notes.reuse:statement:1");
    assert!(rows_of(&mut rt, "notes").is_empty());
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 2);
    assert!(rt.fire_due_at(64, 2).unwrap().is_empty());
}

#[test]
fn a_loop_dominated_step_overflow_keeps_e_steps_despite_a_delivered_write() {
    let s = schema(3, Some(deliver(false)));
    let program = mutation(vec![
        Stmt::For {
            binding: "i".into(),
            domain: LoopDomain::LiteralRange {
                start: 0,
                end_exclusive: 1000,
            },
            body: vec![Stmt::Let {
                name: "x".into(),
                value: Expr::Literal(Value::Int(1)),
            }],
        },
        insert_message("m"),
    ]);
    let error = Checker::new(
        &s,
        Ceilings {
            steps: 1000,
            ..Ceilings::default()
        },
    )
    .check(&program)
    .unwrap_err();
    assert_eq!(error.code, "E_STEPS", "{error:?}");
    assert_ne!(
        error.site.as_deref(),
        Some("schema.tables.messages.deliver")
    );
    assert!(error.message.contains("deliver to memberships"));
}
#[test]
fn a_delivery_dominated_step_overflow_names_the_declaration() {
    let s = schema(3, Some(deliver(false)));
    let error = Checker::new(
        &s,
        Ceilings {
            steps: 10,
            ..Ceilings::default()
        },
    )
    .check(&mutation(vec![insert_message("m")]))
    .unwrap_err();
    assert_eq!(error.code, "E_BOUND");
    assert_eq!(
        error.site.as_deref(),
        Some("schema.tables.messages.deliver")
    );
    assert!(error.message.contains("deliver to memberships"));
}

#[test]
fn upsert_existing_reserves_historical_ten_above_current_cap_three() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        generation(schema(10, Some(deliver(false)))),
    )
    .unwrap();
    let mut seeds: Vec<_> = (0..10)
        .map(|i| member(&format!("p{i}"), "c1", &format!("p{i}")))
        .collect();
    seeds.push(message("m", "c1"));
    rt.seed(&seeds).unwrap();
    run(
        &mut rt,
        (3..10)
            .map(|i| delete("memberships", &format!("p{i}")))
            .collect(),
    );
    rt.apply_successor(generation(schema(3, Some(deliver(false)))))
        .unwrap();
    let mut fields = message("m", "c1").1.as_object().unwrap().clone();
    fields.insert("body".into(), Value::String("changed".into()));
    let program = mutation(vec![Stmt::Upsert {
        table: "messages".into(),
        key: Expr::Literal(id("m")),
        row: Expr::Literal(Value::Row(fields.into())),
    }]);
    let portable = Checker::new(&schema(3, Some(deliver(false))), Ceilings::default())
        .check(&program)
        .unwrap();
    let specialized = portable
        .with_delivery_audiences(
            &schema(3, Some(deliver(false))),
            &BTreeMap::from([("deliveries".into(), audience_bound(&rt).unwrap())]),
            &Ceilings::default(),
        )
        .unwrap();
    assert_eq!(
        specialized
            .write_sites
            .iter()
            .find(|w| w.table == "deliveries")
            .unwrap()
            .max_rows,
        10
    );
    run(&mut rt, program.body);
    let changed: Vec<_> = rows_of(&mut rt, "deliveries")
        .into_iter()
        .filter(|r| field(r, "kind") == &Value::String("changed".into()))
        .collect();
    assert_eq!(changed.len(), 10);
    assert_eq!(
        changed
            .iter()
            .map(|r| field(r, "recipient").as_str().unwrap())
            .collect::<BTreeSet<_>>(),
        (0..10)
            .map(|i| format!("p{i}"))
            .collect::<BTreeSet<_>>()
            .iter()
            .map(String::as_str)
            .collect()
    );
}

#[test]
fn incarnation_sites_follow_statement_then_and_loop_nesting() {
    let mut engine = populated();
    execute(
        &mut engine,
        vec![insert_message("m"), delete("messages", "m")],
    );
    let body = vec![Stmt::If {
        condition: Expr::Literal(Value::Bool(true)),
        then_body: vec![Stmt::For {
            binding: "i".into(),
            domain: LoopDomain::LiteralRange {
                start: 0,
                end_exclusive: 1,
            },
            body: vec![insert_message("m")],
        }],
        else_body: vec![],
    }];
    let error = invoke(&mut engine, body).unwrap_err();
    assert_eq!(
        error.require_site().as_deref(),
        Some("custody.write:statement:1:then:statement:1:statement:1")
    );
}
