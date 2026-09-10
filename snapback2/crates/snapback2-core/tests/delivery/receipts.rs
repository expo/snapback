use super::*;

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
        let result = execute_as(&mut e, &delivery::ack_program("messages", &d), who,
            BTreeMap::from([("events".into(), Value::Array(vec![event.field("id").unwrap().clone()]))]));
        assert!(matches!(result.state, ExecutionState::Committed { .. }), "{result:?}");
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
