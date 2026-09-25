//! The image head and both receipt intervals share the existing operation log.
use snapback4_core::{Engine, Context};
use snapback4_core::value::{Value, object};
use snapback4_core::engine::WriteState;
use std::collections::BTreeMap;

#[test]
fn refused_idempotency_records_never_acknowledge_execution() {
    let source = "table counters:\n  n: int\n  read <- allow\n  update <- allow\n  sync public\nmutation record(allowed: bool):\n  require allowed else NOT_ADMIN\n  c = counters['a'] ! else NOT_FOUND\n  update counters['a'] {n: c.n + 1}\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("counters".into(), object([("id", Value::Id("a".into())), ("n", Value::Int(0))]))]).unwrap();
    let mut successes = BTreeMap::new();
    for (id, allowed) in [("sent-a", true), ("refused-a", false), ("sent-b", true), ("refused-b", false)] {
        let context = Context::new("alice", BTreeMap::from([("allowed".into(), Value::Bool(allowed))]));
        let write = engine.mutate("record", Some(id), context).unwrap();
        match write.state {
            WriteState::Sent { seq, .. } => { assert!(allowed); successes.insert(id.to_owned(), seq); }
            WriteState::Failed { why, .. } => {
                assert!(!allowed); assert_eq!(why.code, "NOT_ADMIN");
                let stored = engine.store().applied_outcome("alice", id).unwrap().unwrap();
                assert_eq!(serde_json::from_str::<serde_json::Value>(&stored).unwrap()["state"], "failed");
                assert!(matches!(engine.replay("alice", id).unwrap().unwrap().state, WriteState::Failed { .. }));
            }
        }
    }
    let pending = ["sent-a", "refused-a", "sent-b", "refused-b"].map(str::to_owned);
    let head = engine.seq().unwrap();
    assert_eq!(engine.acknowledged("alice", &pending, head).unwrap(), successes);
    assert_eq!(engine.acknowledged_at("alice", &pending, 0, head).unwrap(), (BTreeMap::new(), successes.clone()));
    assert_eq!(engine.acknowledged_at("alice", &pending, successes["sent-a"], head).unwrap(),
        (BTreeMap::from([("sent-a".into(), successes["sent-a"])]), BTreeMap::from([("sent-b".into(), successes["sent-b"])])));
}

#[test]
fn stream_heads_and_receipt_intervals() {
    let b=snapback4_lang::compile(&[("schema.q".into(),"table counters:\n  n: int\n  read <- allow\n  update <- allow\n  sync public\ntable secrets:\n  owner: principal\n  by byOwner: owner, id\n  n: int\n  read <- .owner = viewer\n  update <- allow\n  sync to .owner\nmutation hidden():\n  update secrets['s'] {n: 1}\nmutation bump():\n  c = counters['a'] ! else NOT_FOUND\n  update counters['a'] {n: c.n + 1}\n".into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([("counters".into(),object([("id",Value::Id("a".into())),("n",Value::Int(0))]))]).unwrap();
    let before=e.seq().unwrap();
    let mut commits=vec![];
    for who in ["a","b"] {
        let r=e.mutate("bump",Some(who),Context::new("alice",BTreeMap::new())).unwrap();
        let WriteState::Sent{seq,..}=r.state else {panic!("not sent")}; commits.push(seq);
    }
    e.seed([("secrets".into(),object([("id",Value::Id("s".into())),("owner",Value::Id("bob".into())),("n",Value::Int(0))]))]).unwrap();
    e.mutate("hidden",Some("hidden"),Context::new("bob",BTreeMap::new())).unwrap();
    let head=e.seq().unwrap();
    assert!(head>commits[1]);
    let page=e.stream("alice",before,1).unwrap();
    assert_eq!(page.images_at,Some(head)); assert!(page.more); assert_eq!(page.watermark,commits[0]);
    let pending=["a".into(),"b".into(),"uncommitted".into()];
    assert!(e.acknowledged_at("alice", &pending, head, commits[0]).unwrap_err().to_string().contains("image head precedes"));
    let (covered,above)=e.acknowledged_at("alice",&pending,page.watermark,head).unwrap();
    assert_eq!(covered,BTreeMap::from([("a".into(),commits[0])]));
    assert_eq!(above,BTreeMap::from([("b".into(),commits[1])]));
    assert_eq!(e.acknowledged("alice",&pending,page.watermark).unwrap(),covered);
    assert_eq!(e.acknowledged_at("bob",&pending,page.watermark,head).unwrap(),(BTreeMap::new(),BTreeMap::new()));
    let final_page=e.stream("alice",page.watermark,1).unwrap();
    assert!(!final_page.more); assert_eq!(final_page.images_at,Some(head)); assert_eq!(final_page.watermark,head);
    assert_eq!(e.acknowledged_at("alice",&pending,head,head).unwrap(),(BTreeMap::from([("a".into(),commits[0]),("b".into(),commits[1])]),BTreeMap::new()));
    for from in [head,head+100] { let p=e.stream("alice",from,1).unwrap(); assert_eq!(p.images_at,Some(head)); assert_eq!(p.watermark,head); assert!(!p.more); }
    let old: snapback4_core::partition::StreamPage=serde_json::from_value(serde_json::json!({"events":[],"watermark":0,"more":false})).unwrap();
    assert_eq!(old.images_at,None);
    assert!(e.acknowledged_at("alice",&vec!["q".into();257],head,head).is_err());
}
