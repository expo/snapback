use super::*;

fn counted_receipts(cap: u32) -> Schema {
    let mut d = deliver(false); d.receipts = true;
    let mut s = schema(cap, Some(d));
    s.tables.insert("receiptCounts".into(), table(
        &[("id", ColumnType::Id), ("row", reference("messages")), ("value", ColumnType::Int)],
        &[("byId", &["id"], true), ("byRow", &["row"], true)],
    ));
    s.maintains.push(Maintain { source: "deliveriesReceipts".into(), target: "receiptCounts".into(),
        by: vec!["row".into()], kind: MaintainKind::Count, readable: None });
    s
}

#[test]
fn retained_receipt_upserts_price_twice_the_audience_and_commit_update_and_job() {
    let edit = |key, text: &str| Stmt::Update { table: "messages".into(), key,
        patch: Expr::Literal(object([("body", Value::String(text.into()))])) };
    let job = Program { name: "editAll".into(), kind: ProgramKind::Job, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::For { binding: "message".into(), domain: LoopDomain::Page(Scan {
            site: "sweep".into(), table: "messages".into(), index: "byId".into(), prefix: vec![], take: Bound::Literal(1),
            order: Order::Asc, after: None, before: None, range: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }),
            body: vec![edit(Expr::Field { base: Box::new(Expr::Variable("message".into())), name: "id".into() }, "job")] }] };
    let make = |cap| Generation::certify(&project(counted_receipts(cap), vec![job.clone()]), Ceilings::default()).unwrap();
    let mut rt = Runtime::open(Store::memory().unwrap(), make(10)).unwrap();
    let mut seeds: Vec<_> = (0..10).map(|n| member(&format!("p{n}"), "c1", &format!("p{n}"))).collect();
    seeds.push(message("m", "c1")); rt.seed(&seeds).unwrap();
    let update = Program { name: "edit".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![edit(Expr::Literal(id("m")), "update")] };
    let remove = Program { body: (3..10).map(|n| Stmt::Delete { table: "memberships".into(), key: Expr::Literal(id(&format!("p{n}"))) }).collect(), ..update.clone() };
    rt.execute_adhoc_operator(&remove, BTreeMap::new(), OperatorId("test".into()), || 1).unwrap();
    rt.apply_successor(make(3)).unwrap();
    let c = rt.certify_operator_program(&update).unwrap().with_delivery_audiences(&counted_receipts(3),
        &BTreeMap::from([("deliveries".into(), 10)]), &Ceilings::default()).unwrap();
    assert_eq!(c.maintained_writes["receiptCounts"], 20, "10 receipt upserts × 2 applications");
    assert_eq!(c.maintained_amplification, 20);
    assert!(c.write_sites.iter().any(|w| w.table == "deliveriesReceipts" && w.kind == WriteKind::Upsert && w.max_rows == 10));
    let result = rt.execute_adhoc_operator(&update, BTreeMap::new(), OperatorId("test".into()), || 2).unwrap();
    assert!(matches!(result.state, ExecutionState::Committed { .. }), "{result:?}");
    assert_eq!(rows_of(&mut rt, "messages")[0].field("body").unwrap(), &Value::String("update".into()));
    let portable = rt.certify_operator_program(&job).unwrap();
    let plan = rt.plan_job(&job, &portable, &BTreeMap::new()).unwrap();
    assert_eq!(plan["sweeps"][0]["ceilings"]["maintained_writes"]["receiptCounts"], 20);
    let id = rt.enqueue_job("editAll", BTreeMap::new(), OperatorId("test".into())).unwrap();
    let chunk = rt.run_chunk(&id).unwrap();
    assert!(matches!(chunk.execution.unwrap().state, ExecutionState::Committed { .. }));
    assert_eq!(rows_of(&mut rt, "messages")[0].field("body").unwrap(), &Value::String("job".into()));
    assert_eq!(rows_of(&mut rt, "receiptCounts")[0].field("value").unwrap(), &Value::Int(10));
    assert_eq!(rows_of(&mut rt, "deliveries").len(), 30);
}

#[test]
fn initial_receipt_maintain_final_exists_is_priced_and_commits() {
    let mut s = counted_receipts(3);
    s.tables.get_mut("receiptCounts").unwrap().constraints.push(Constraint::FinalExistsOnInsert {
        table: "messages".into(), index: "byId".into(), key: vec![RuleTerm::Field("row".into())],
    });
    let mut e = Engine::memory(s.clone()).unwrap();
    let (t, r) = member("a", "c1", "alice"); e.seed(&t, r).unwrap();
    let p = Program { name: "insert".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Insert { table: "messages".into(), row: Expr::Literal(message("m", "c1").1) }] };
    let c = Checker::new(&s, Ceilings::default()).check(&p).unwrap();
    let result = e.execute(&p, &c, Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new())).unwrap();
    assert!(matches!(result.state, ExecutionState::Committed { .. }), "{result:?}");
    assert_eq!(c.max_rule_probes, 8, "4 reserved receipt upserts × 2 final probes");
    assert_eq!(result.trace.rule_probes, 1);
    assert_eq!(e.rows("receiptCounts").unwrap()[0].field("value").unwrap(), &Value::Int(1));
}

#[test]
fn receipt_and_acknowledgement_checks_are_declared_only_on_their_runtime_sites() {
    let (s, d) = receipt_schema();
    let mut e = Engine::memory(s.clone()).unwrap();
    let (table, row) = member("a", "c1", "alice"); e.seed(&table, row).unwrap();
    for stmt in [Stmt::Insert { table: "messages".into(), row: Expr::Literal(message("m", "c1").1) },
        Stmt::Update { table: "messages".into(), key: Expr::Literal(id("m")), patch: Expr::Literal(object([("body", Value::String("edited".into()))])) }] {
        let p = Program { name: "write".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![stmt] };
        let c = Checker::new(&s, Ceilings::default()).check(&p).unwrap();
        assert!(c.constraint_checks.iter().any(|c| c == "deliveriesReceipts:DeliveryReceipt"));
        assert!(!c.constraint_checks.iter().any(|c| c.ends_with(":DeliveryAcknowledgement")), "{c:?}");
        let result = e.execute(&p, &c, Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new())).unwrap();
        assert!(result.trace.constraint_inputs.iter().any(|p| p.check == "DeliveryReceipt"));
    }
    let p = delivery::ack_program("messages", &d);
    let c = Checker::new(&s, Ceilings::default()).check(&p).unwrap();
    assert!(c.constraint_checks.iter().any(|c| c == "memberships:DeliveryAcknowledgement"));
    assert!(!c.constraint_checks.iter().any(|c| c.ends_with(":DeliveryReceipt")));
    let event = e.rows("deliveries").unwrap()[0].field("id").unwrap().clone();
    let result = execute_as(&mut e, &p, "alice", BTreeMap::from([("events".into(), Value::Array(vec![event]))]));
    assert!(result.trace.constraint_inputs.iter().any(|p| p.check == "DeliveryAcknowledgement"));
}

#[test]
fn receipt_backfill_admits_the_installation_bound_and_refuses_more_log_work() {
    for over in [true, false] {
        let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(32, Some(deliver(false))))).unwrap();
        rt.seed(&(0..32).map(|n| member(&format!("p{n}"), "c1", &format!("p{n}"))).collect::<Vec<_>>()).unwrap();
        for n in 0..256 { rt.seed(&[message(&format!("m{n}"), "c1")]).unwrap(); }
        if over {
            let edit = Program { name: "edit".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
                body: vec![Stmt::Update { table: "messages".into(), key: Expr::Literal(id("m0")), patch: Expr::Literal(object([("body", Value::String("edited".into()))])) }] };
            rt.execute_adhoc_operator(&edit, BTreeMap::new(), OperatorId("test".into()), || 1).unwrap();
        }
        let mut d = deliver(false); d.receipts = true;
        let result = rt.apply_successor(generation(schema(32, Some(d))));
        if over {
            let error = result.unwrap_err();
            assert_eq!(error.code, "E_SUCCESSOR_BOOTSTRAP");
            assert!(error.message.contains("8224"), "{error:?}");
            assert_eq!(error.site.as_deref(), Some("schema.tables.messages.deliver"));
            assert!(!error.rewrite.contains("with receipts"));
            assert_eq!(rt.store().index_entry_count("deliveriesReceipts", "byId", &[]).unwrap(), 0);
            assert_eq!(rt.store().index_entry_count("deliveries", "byId", &[]).unwrap(), 8224);
        } else {
            let report = result.unwrap();
            assert!(report.bootstrapped_deliveries.iter().any(|line| line.contains("8192 unacknowledged")));
            assert_eq!(rt.store().index_entry_count("deliveriesReceipts", "byId", &[]).unwrap(), 8192);
        }
    }
}

#[test]
fn retained_receipt_specialization_scales_final_probes_search_work_and_timers() {
    use snapback3_core::{search_key::{IndexComponent, SearchContract}, timers::{Schedule, Trigger}};
    let make = |cap| {
        let mut s = counted_receipts(cap);
        let messages = s.tables.get_mut("messages").unwrap();
        messages.columns.insert("at".into(), ColumnType::Optional(Box::new(ColumnType::Time)));
        messages.columns.insert("body".into(), ColumnType::Text { max: 20 });
        messages.rules.read = RuleExpr::And(vec![
            RuleExpr::Eq(RuleTerm::Field("body".into()), RuleTerm::Literal(Value::String("hello".into()))),
            RuleExpr::Eq(RuleTerm::Field("at".into()), RuleTerm::Literal(Value::Int(1))),
        ]);
        let d = s.tables["messages"].deliver.clone().unwrap();
        s.tables.insert("deliveriesReceipts".into(), delivery::receipts_table(&s, "messages", &d).unwrap());
        let mut terms = table(&[("id", ColumnType::Id), ("row", reference("messages")), ("body", ColumnType::Text { max: 20 }),
            ("at", ColumnType::Optional(Box::new(ColumnType::Time))), ("value", ColumnType::Int)],
            &[("byId", &["id"], true), ("byGroup", &["row", "body", "at"], true)]);
        terms.indexes.insert("bySearch".into(), Index { unique: false, components: vec![
            IndexComponent::WordPrefixes { fields: vec!["body".into()], contract: SearchContract::Unicode17 }, IndexComponent::Column("id".into())] });
        terms.constraints.push(Constraint::FinalExistsOnInsert { table: "messages".into(), index: "byId".into(), key: vec![RuleTerm::Field("row".into())] });
        s.tables.insert("terms".into(), terms);
        s.maintains.push(Maintain { source: "deliveriesReceipts".into(), target: "terms".into(), by: vec!["row".into(), "body".into(), "at".into()], kind: MaintainKind::Count, readable: None });
        s.schedules.push(Schedule { name: "expire".into(), trigger: Trigger::Row { table: "terms".into(), column: "at".into() },
            binding: "binding".into(), target: "noop".into(), site: "schedule".into() });
        s
    };
    let p = Program { name: "edit".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Update { table: "messages".into(), key: Expr::Literal(id("m")), patch: Expr::Literal(object([("body", Value::String("edit".into()))])) }] };
    let s = make(3);
    let noop = Program { name: "noop".into(), body: vec![Stmt::Return(Expr::Literal(Value::Null))], ..p.clone() };
    let binding = Program { name: "binding".into(), kind: ProgramKind::Query,
        args: BTreeMap::from([("id".into(), ArgType::Ref { table: "terms".into() })]),
        body: vec![Stmt::Return(Expr::Object(BTreeMap::from([
            ("enabled".into(), Expr::Literal(Value::Bool(true))), ("args".into(), Expr::Object(BTreeMap::new())),
        ])))], ..p.clone() };
    Generation::certify(&project(s.clone(), vec![p.clone(), noop, binding]), Ceilings::default()).unwrap();
    let portable = Checker::new(&s, Ceilings::default()).check(&p).unwrap();
    let specialized = portable.with_delivery_audiences(&s, &BTreeMap::from([("deliveries".into(), 10)]), &Ceilings::default()).unwrap();
    let independent = Checker::new(&make(10), Ceilings::default()).check(&p).unwrap();
    assert_eq!(specialized.maintained_amplification, 40, "two targets × 10 upserts × 2 applications");
    assert_eq!(specialized.max_rule_probes, 20);
    assert!(specialized.write_sites.iter().any(|w| w.table == "_timers" && w.max_rows == 20));
    assert!(independent.derived_steps > 0);
    assert_eq!(specialized.derived_steps, independent.derived_steps);
    assert_eq!(specialized.derived_scratch_bytes, independent.derived_scratch_bytes);
    assert_eq!(specialized.max_steps, independent.max_steps);
    assert_eq!(specialized.max_heap_bytes, independent.max_heap_bytes);
    assert_eq!(specialized.max_examined, independent.max_examined);
    assert_eq!(specialized.max_index_entries, independent.max_index_entries);
}

#[test]
fn maintained_content_refuses_deliver_at_admission() {
    let mut s = schema(3, Some(deliver(false)));
    s.maintains.push(Maintain {
        target: "messages".into(), source: "memberships".into(),
        by: vec!["conversationId".into()], kind: MaintainKind::Count, readable: None,
    });
    let errors = delivery::delivery_issues(&s);
    assert!(errors.iter().any(|e| e.code == delivery::SHAPE && e.message.contains("maintain")), "{errors:?}");
}

#[test]
fn receipts_start_false_and_acknowledgement_batches_are_idempotent() {
    let mut d = deliver(false); d.receipts = true;
    let s = schema(3, Some(d.clone()));
    let mut e = Engine::memory(s.clone()).unwrap();
    for (table, row) in [member("a", "c1", "alice"), member("b", "c1", "bob"), message("m", "c1")] { e.seed(&table, row).unwrap(); }
    let before = e.rows("deliveriesReceipts").unwrap();
    assert_eq!(before.len(), 2, "unacknowledged recipients must exist");
    assert!(before.iter().all(|r| r.field("received").unwrap() == &Value::Bool(false)));
    let event = e.rows("deliveries").unwrap().into_iter().find(|r| r.field("recipient").unwrap() == &id("alice")).unwrap();
    let program = delivery::ack_program("messages", &d);
    let cert = Checker::new(&s, Ceilings::default()).check(&program).unwrap();
    let args = BTreeMap::from([("events".into(), Value::Array(vec![event.field("id").unwrap().clone(); 2]))]);
    let mut after = vec![];
    for _ in 0..2 {
        let result = e.execute(&program, &cert, Context::mutation(Actor::user("alice").unwrap(), args.clone())).unwrap();
        assert!(matches!(result.state, ExecutionState::Committed { .. }), "{result:?}");
        let rows = e.rows("deliveriesReceipts").unwrap();
        if after.is_empty() { after = rows; } else { assert_eq!(rows, after); }
    }
    assert_eq!(after.iter().filter(|r| r.field("received").unwrap() == &Value::Bool(true)).count(), 1);
}

fn receipt_schema() -> (Schema, Deliver) {
    let mut d = deliver(false); d.receipts = true;
    let mut s = schema(3, Some(d.clone()));
    s.tables.get_mut("messages").unwrap().rules.read = RuleExpr::Exists {
        table: "memberships".into(), index: "byConversationPrincipal".into(),
        key: vec![RuleTerm::Field("conversationId".into()), RuleTerm::Viewer], provenance: KeyProvenance::Viewer,
    };
    s.tables.insert(d.receipts_table().unwrap(), delivery::receipts_table(&s, "messages", &d).unwrap());
    (s, d)
}
fn execute_as(e: &mut Engine, p: &Program, who: &str, args: BTreeMap<String, Value>) -> Execution {
    let c = Checker::new(e.schema(), Ceilings::default()).check(p).unwrap();
    e.execute(p, &c, Context::mutation(Actor::user(who).unwrap(), args)).unwrap()
}
fn receipts_query(index: &str, prefix: Vec<Expr>) -> Program {
    Program { name: "messages.receipts".into(), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan { site: "receipts".into(), table: "deliveriesReceipts".into(), index: index.into(),
            prefix: prefix.into_iter().map(IndexKeyExpr::Scalar).collect(), take: Bound::Literal(50), order: Order::Asc,
            after: None, before: None, range: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }))] }
}

#[test]
fn receipt_rules_apply_on_every_index_and_removed_recipient_stays_false() {
    let (s, d) = receipt_schema();
    let mut e = Engine::memory(s).unwrap();
    for (table, row) in [member("a", "c1", "alice"), member("b", "c1", "bob"), message("m", "c1")] { e.seed(&table, row).unwrap(); }
    let events = e.rows("deliveries").unwrap();
    let remove = Program { name: "leave".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![Stmt::Delete { table: "memberships".into(), key: Expr::Literal(id("b")) }] };
    execute_as(&mut e, &remove, "alice", BTreeMap::new());
    for who in ["bob", "alice", "alice"] { // Independent clients submit the same principal's event.
        let event = events.iter().find(|r| r.field("recipient").unwrap() == &id(who)).unwrap();
        let program = delivery::ack_program("messages", &d);
        let args = BTreeMap::from([("events".into(), Value::Array(vec![event.field("id").unwrap().clone()]))]);
        if who == "bob" {
            let cert = Checker::new(e.schema(), Ceilings::default()).check(&program).unwrap();
            let error = e.execute(&program, &cert, Context::mutation(Actor::user(who).unwrap(), args)).unwrap_err();
            assert!(matches!(error, RuntimeError::Require { code, .. } if code == "E_RULE"));
        } else {
            let result = execute_as(&mut e, &program, who, args);
            assert!(matches!(result.state, ExecutionState::Committed { .. }), "{result:?}");
        }
    }
    for (index, prefix) in [("byRow", vec![Expr::Literal(id("m"))]), ("byId", vec![])] {
        let p = receipts_query(index, prefix);
        let alice = execute_as(&mut e, &p, "alice", BTreeMap::new());
        assert_eq!(alice.result.as_array().unwrap().len(), 2);
        assert_eq!(execute_as(&mut e, &p, "bob", BTreeMap::new()).result.as_array().unwrap().len(), 0);
    }
    let rows = e.rows("deliveriesReceipts").unwrap();
    for r in rows { assert_eq!(r.field("received").unwrap(), &Value::Bool(r.field("recipient").unwrap() == &id("alice"))); }
}

#[test]
fn acknowledgement_reserve_is_named_and_cannot_be_spent_without_its_private_index() {
    let (s, d) = receipt_schema();
    let p = delivery::ack_program("messages", &d);
    let c = Checker::new(&s, Ceilings::default()).check(&p).unwrap();
    assert!(serde_json::to_string(&c).unwrap().contains("delivery acknowledgement"));
    assert!(c.write_sites.iter().any(|w| w.table == "deliveriesReceipts" && w.max_rows == 50));
    let mut tampered = p.clone(); tampered.body.push(Stmt::Delete { table: "deliveriesReceipts".into(), key: Expr::Literal(id("anything")) });
    assert_eq!(Checker::new(&s, Ceilings::default()).check(&tampered).unwrap_err().code, delivery::SHAPE);
    let mut e = Engine::memory(s).unwrap();
    for (table, row) in [member("a", "c1", "alice"), message("m", "c1")] { e.seed(&table, row).unwrap(); }
    let event = e.rows("deliveries").unwrap()[0].field("id").unwrap().clone();
    let mut c = c; c.indexes_required.retain(|i| i != "memberships.byConversationPrincipal");
    let result = e.execute(&p, &c, Context::mutation(Actor::user("alice").unwrap(), BTreeMap::from([("events".into(), Value::Array(vec![event]))])));
    assert!(format!("{result:?}").contains("TraceSubset"), "{result:?}");
    assert_eq!(e.rows("deliveriesReceipts").unwrap()[0].field("received").unwrap(), &Value::Bool(false));
}

#[test]
fn job_plan_specializes_retained_audience_under_owner_total_visibility() {
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(10, Some(deliver(false))))).unwrap();
    let mut seeds: Vec<_> = (0..10).map(|n| member(&format!("p{n}"), "c1", &format!("p{n}"))).collect();
    seeds.push(message("m", "c1")); rt.seed(&seeds).unwrap();
    let mut remove = Program { name: "remove".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: (3..10).map(|n| Stmt::Delete { table: "memberships".into(), key: Expr::Literal(id(&format!("p{n}"))) }).collect() };
    rt.execute_adhoc_operator(&remove, BTreeMap::new(), OperatorId("test".into()), || 1).unwrap();
    rt.apply_successor(generation(schema(3, Some(deliver(false))))).unwrap();
    remove.kind = ProgramKind::Job;
    remove.body = vec![Stmt::For { binding: "message".into(), domain: LoopDomain::Page(Scan { site: "sweep".into(), table: "messages".into(), index: "byId".into(), prefix: vec![], take: Bound::Literal(1), order: Order::Asc,
        after: None, before: None, range: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }), body: vec![Stmt::Delete { table: "messages".into(), key: Expr::Field { base: Box::new(Expr::Variable("message".into())), name: "id".into() } }] }];
    let portable = rt.certify_operator_program(&remove).unwrap();
    let expected = portable.job.as_ref().unwrap().per_chunk[0].with_delivery_audiences(&schema(3, Some(deliver(false))), &BTreeMap::from([("deliveries".into(), 10)]), &Ceilings::default()).unwrap();
    let plan = rt.plan_job(&remove, &portable, &BTreeMap::new()).unwrap();
    assert_eq!(plan["sweeps"][0]["ceilings"], serde_json::to_value(expected).unwrap());
    assert_eq!(plan["sweeps"][0]["ceilings"]["plan_hash"], portable.job.as_ref().unwrap().per_chunk[0].plan_hash);
    if let Stmt::For { body, .. } = &mut remove.body[0] { *body = vec![body[0].clone(); 210]; }
    let portable = rt.certify_operator_program(&remove).unwrap();
    let refused = rt.plan_job(&remove, &portable, &BTreeMap::new()).unwrap_err();
    assert_eq!(refused.code(), "E_BOUND");
    assert!(refused.to_string().contains("A 10"), "{refused}");
}

#[test]
fn enabling_receipts_reuses_original_audience_and_does_not_bootstrap_new_members() {
    let mut rt = Runtime::open(Store::memory().unwrap(), generation(schema(3, Some(deliver(false))))).unwrap();
    rt.seed(&[member("a","c1","alice"),member("b","c1","bob"),message("m","c1")]).unwrap();
    let p = Program { name:"leave".into(),kind:ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,
        body:vec![Stmt::Delete{table:"memberships".into(),key:Expr::Literal(id("b"))}] };
    rt.execute_adhoc_operator(&p,BTreeMap::new(),OperatorId("test".into()),||1).unwrap();
    rt.seed(&[member("c","c1","carol")]).unwrap();
    let mut d=deliver(false);d.receipts=true;
    rt.apply_successor(generation(schema(3,Some(d)))).unwrap();
    let q=receipts_query("byRow",vec![Expr::Literal(id("m"))]);
    let rows=rt.execute_adhoc_operator(&q,BTreeMap::new(),OperatorId("test".into()),||2).unwrap().result;
    let rows=rows.as_array().unwrap();assert_eq!(rows.len(),2);
    assert!(rows.iter().any(|r|r.field("recipient").unwrap()==&id("bob")));
    assert!(!rows.iter().any(|r|r.field("recipient").unwrap()==&id("carol")));
    assert!(rows.iter().all(|r|r.field("received").unwrap()==&Value::Bool(false)));
}

#[test]
fn changed_body_can_acknowledge_original_receipt_and_copied_read_rule_inputs_stay_current() {
    let (s,d)=receipt_schema();let mut e=Engine::memory(s).unwrap();
    for (table,row) in [member("a","c1","alice"),member("b","c1","bob"),member("a2","c2","alice"),message("m","c1")] {e.seed(&table,row).unwrap();}
    let p=Program{name:"move".into(),kind:ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,
        body:vec![Stmt::Update{table:"messages".into(),key:Expr::Literal(id("m")),patch:Expr::Literal(object([("conversationId",id("c2"))]))}]};
    execute_as(&mut e,&p,"alice",BTreeMap::new());
    let changed=e.rows("deliveries").unwrap().into_iter().find(|r|r.field("kind").unwrap()==&Value::String("changed".into())&&r.field("recipient").unwrap()==&id("alice")).unwrap();
    let result=execute_as(&mut e,&delivery::ack_program("messages",&d),"alice",BTreeMap::from([("events".into(),Value::Array(vec![changed.field("id").unwrap().clone()]))]));
    assert!(matches!(result.state,ExecutionState::Committed{..}),"{result:?}");
    let q=receipts_query("byRow",vec![Expr::Literal(id("m"))]);
    assert!(execute_as(&mut e,&q,"bob",BTreeMap::new()).result.as_array().unwrap().is_empty());
    assert!(e.rows("deliveriesReceipts").unwrap().iter().all(|r|r.field("conversationId").unwrap()==&id("c2")));
    assert!(e.rows("deliveriesReceipts").unwrap().iter().any(|r|r.field("received").unwrap()==&Value::Bool(true)));
}

#[test]
fn full_acknowledgement_batch_fits_its_certificate_and_the_next_identity_refuses() {
    let (s,d)=receipt_schema(); let mut e=Engine::memory(s).unwrap();
    for (table,row) in [member("a","c1","alice"),member("b","c1","bob")] { e.seed(&table,row).unwrap(); }
    for n in 0..51 { let (table,row)=message(&format!("m{n}"),"c1"); e.seed(&table,row).unwrap(); }
    let ids:Vec<_>=e.rows("deliveries").unwrap().iter().filter(|r|r.field("recipient").unwrap()==&id("alice"))
        .map(|r|r.field("id").unwrap().clone()).collect();
    let p=delivery::ack_program("messages",&d);
    let c=Checker::new(e.schema(),Ceilings::default()).check(&p).unwrap();
    let context=|ids| Context::mutation(Actor::user("alice").unwrap(), BTreeMap::from([("events".into(),Value::Array(ids))]));
    let execution=e.execute(&p,&c,context(ids[..50].to_vec())).unwrap();
    assert!(matches!(execution.state,ExecutionState::Committed{..}),"{execution:?}");
    assert_eq!(execution.trace.constraint_inputs.iter().filter(|t|t.check=="DeliveryAcknowledgement").count(),50);
    assert_eq!(e.rows("deliveriesReceipts").unwrap().iter().filter(|r|r.field("received").unwrap()==&Value::Bool(true)).count(),50);
    assert!(e.execute(&p,&c,context(ids)).is_err(),"51 event identities cannot enter a 50-identity mutation");
}
