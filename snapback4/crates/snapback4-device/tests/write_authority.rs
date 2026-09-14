//! Hidden write targets: one scenario on SQLite and memory, including reopen.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Value, WriteState, wire};
use snapback4_device::device::Queued;

const SOURCE: &str = r#"
table counters:
  key: text <=30
  owner: principal
  amount: int
  unique byKey: key
  by byOwner: owner, id
  read <- .owner = viewer
  update <- allow
  insert <- allow
  sync to .owner
query one(key: text <=30):
  return counters[key]
mutation edit(key: text <=30):
  update counters[key] {amount: 0}
mutation byId(target: counters):
  update counters[target] {amount: 0}
mutation put(key: text <=30):
  upsert counters[key] {owner: 'alice', amount: 0}
mutation putId(target: counters):
  upsert counters[target] {key: 'lookup', owner: 'alice', amount: 0}
"#;
fn scenario<H: Host>(host: &mut H) -> Vec<Json> {
    let mut observations = Vec::new();
    for horizon in [false, true] {
        for (name, input) in [("edit", json!({"key":"lookup"})), ("byId", json!({"target":"target"})), ("put", json!({"key":"lookup"})), ("putId", json!({"target":"target"}))] {
            let mut pair = Vec::new();
            for hidden in [false, true] {
                let source = if horizon { SOURCE.replace("sync to .owner", "sync to .owner last 1 by byOwner") } else { SOURCE.into() };
                let (mut engine, backend) = compile(&source);
                let row = json!({"id":if hidden {"target"} else {"decoy"},"key":if hidden {"lookup"} else {"other"},"owner":"alice","amount":7});
                engine.seed([("counters".into(), wire::row_from_json(engine.schema().table("counters").unwrap(), &row).unwrap())]).unwrap();
                let key = format!("{name}-{horizon}-{hidden}");
                let mut device = host.open(&key, Some(backend)).unwrap();
                for (i, page) in snapshot_pages(&mut engine, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
                let why = device.predict(name, "bob", &input, 1000, vec![], 1).unwrap_err().refusal();
                assert_eq!(why.code, "E_PREDICT");
                assert!(why.message.contains("site") && why.message.contains("counters") && why.message.contains(if name.ends_with("Id") {"target"} else {"lookup"}), "{why}");
                let entry = Queued { id: "same".into(), seq: 1, op: name.into(), args: input.clone(), viewer: "bob".into(), now: 1000, new_ids: vec!["fresh".into()], predicted: vec!["stale/key".into()], predictable: true, sent_seq: None, observed_seq: None };
                let admitted = device.admit(entry).unwrap();
                assert!(!admitted.predictable);
                assert!(admitted.predicted.is_empty());
                let local = device.query("one", "bob", &json!({"key":"lookup"}), 1000).unwrap();
                assert_eq!(local.data, Value::Null);
                host.close(&key, device);
                let mut device = host.open(&key, None).unwrap();
                assert_eq!(device.queued().unwrap()[0].predicted.len(), 0);
                assert!(!device.queued().unwrap()[0].predictable);
                assert_eq!(device.query("one", "bob", &json!({"key":"lookup"}), 1000).unwrap().data, Value::Null);
                // The transport still has a queued operation to send to the authority.
                let program = engine.programs().find(|p| p.name == name).unwrap().clone();
                let args = input.as_object().unwrap().iter().map(|(k,v)| (k.clone(), wire::from_json(&program.args[k], v).unwrap())).collect();
                let result = engine.mutate(name, Some("same"), Context::new("bob", args).at(1000).with_ids(["fresh".into()])).unwrap();
                if hidden {
                    let WriteState::Sent { seq, result: Value::Null } = result.state else { panic!("{result:?}") };
                    device.settle("same", Some(seq)).unwrap();
                    let page = stream_page(&mut engine, "bob", device.state().unwrap().0);
                    device.apply(&page, false).unwrap();
                    assert!(device.queued().unwrap().is_empty());
                    assert_eq!(device.query("one", "bob", &json!({"key":"lookup"}), 1000).unwrap().data, Value::Null);
                }
                pair.push(json!({"refusal":why,"admitted":admitted,"data":wire::to_json(&local.data)}));
                host.close(&key, device);
            }
            assert_eq!(pair[0], pair[1], "{}: {name}, horizon {horizon}", host.label());
            observations.push(pair.remove(0));
        }
    }
    // Positive held target still predicts on each store.
    let (mut engine, backend) = compile(SOURCE);
    engine.seed([("counters".into(), snapback4_core::value::object([("id", id("own")), ("key", Value::String("own".into())), ("owner", id("bob")), ("amount", Value::Int(7))]))]).unwrap();
    let mut device = host.open("held", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let result = device.predict("edit", "bob", &json!({"key":"own"}), 1000, vec![], 1).unwrap();
    assert_eq!(result.predicted.len(), 1);
    host.close("held", device);
    observations
}
#[test]
fn w1_a_device_queues_without_a_row_and_does_not_predict_not_found_or_insert() {
    let sqlite = scenario(&mut Sqlite::new("write-authority"));
    let memory = scenario(&mut Memory::new());
    assert_eq!(sqlite, memory);
}

#[test]
fn a_server_page_pass_never_predicts_even_when_held_and_after_reopen() {
    fn run<H: Host>(host: &mut H) {
        let source = format!("{SOURCE}\nmutation sweep(): server\n  for row in counters['bob'] first 1 by byOwner:\n    update counters[row] {{amount: 0}}\n  return null\n");
        let (mut engine, backend) = compile(&source);
        engine.seed([("counters".into(), snapback4_core::value::object([("id", id("own")), ("key", Value::String("own".into())), ("owner", id("bob")), ("amount", Value::Int(7))]))]).unwrap();
        let mut device = host.open("server-pass", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        assert_eq!(device.predict("sweep", "bob", &json!({}), 1000, vec![], 1).unwrap_err().code(), "E_PREDICT");
        let entry = Queued { id: "sweep".into(), seq: 1, op: "sweep".into(), args: json!({}), viewer: "bob".into(), now: 1000, new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None };
        assert!(!device.admit(entry).unwrap().predictable);
        host.close("server-pass", device);
        let mut device = host.open("server-pass", None).unwrap();
        assert!(!device.queued().unwrap()[0].predictable);
        assert_eq!(device.query("one", "bob", &json!({"key":"own"}), 1000).unwrap().data.field("amount"), Ok(&Value::Int(7)));
        let sent = engine.mutate("sweep", Some("sweep"), Context::new("bob", Default::default()).at(1000)).unwrap();
        let WriteState::Sent { seq, .. } = sent.state else { panic!("{sent:?}") };
        device.settle("sweep", Some(seq)).unwrap();
        let page = stream_page(&mut engine, "bob", device.state().unwrap().0);
        device.apply(&page, false).unwrap();
        assert!(device.queued().unwrap().is_empty());
        assert_eq!(device.query("one", "bob", &json!({"key":"own"}), 1000).unwrap().data.field("amount"), Ok(&Value::Int(0)));
        host.close("server-pass", device);
    }
    run(&mut Sqlite::new("server-pass"));
    run(&mut Memory::new());
}
