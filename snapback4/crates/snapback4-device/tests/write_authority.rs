//! Hidden write targets: one scenario on SQLite and memory, including reopen.
mod common;
#[path = "../../snapback4-sim/tests/common/write_observation.rs"]
mod observation;
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
#[test]
fn w1_a_device_queues_without_a_row_and_does_not_predict_not_found_or_insert() {
    // The same full observation boundary runs both stores, including settlement
    // in both worlds. Denied authority makes the server pair comparable too.
    for denied in [false, true] {
        for horizon in [false, true] {
            for (name, input) in [("edit", json!({"key":"lookup"})), ("byId", json!({"target":"target"})), ("put", json!({"key":"lookup"})), ("putId", json!({"target":"target"}))] {
                let mut pair = Vec::new();
                for hidden in [false, true] {
                    let source = if horizon { SOURCE.replace("sync to .owner", "sync to .owner last 1 by byOwner") } else { SOURCE.into() };
                    let source = if denied { source.replace("update <- allow", "update <- deny").replace("insert <- allow", "insert <- deny") } else { source };
                    let (mut engine, _) = compile(&source);
                    let row = json!({"id":if hidden {"target"} else {"decoy"},"key":if hidden {"lookup"} else {"other"},"owner":"alice","amount":7});
                    engine.seed([("counters".into(), wire::row_from_json(engine.schema().table("counters").unwrap(), &row).unwrap())]).unwrap();
                    let (_, observed) = observation::observe(&mut engine, name, "bob", input.clone(), "same", ("one", json!({"key":"lookup"})));
                    for device in &observed.devices {
                        assert_eq!(device["admission"]["queued"]["predictable"], false);
                        assert_eq!(device["admission"]["queued"]["predicted"], json!([]));
                        for stage in ["pending", "reopened", "settled"] { assert_eq!(device[stage]["query"]["data"], Json::Null); }
                        assert_eq!(device["settled"]["outbox"], json!([]));
                    }
                    pair.push(observed);
                }
                if denied { pair[0].assert_same(&pair[1]); }
                else { assert_eq!(pair[0].devices, pair[1].devices, "admitted existence is allowed, device observations stay equal"); }
            }
        }
    }
    // Positive held target still predicts on each store.
    fn held<H: Host>(host: &mut H) {
        let (mut engine, backend) = compile(SOURCE);
        engine.seed([("counters".into(), snapback4_core::value::object([("id", id("own")), ("key", Value::String("own".into())), ("owner", id("bob")), ("amount", Value::Int(7))]))]).unwrap();
        let mut device = host.open("held", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        assert_eq!(device.predict("edit", "bob", &json!({"key":"own"}), 1000, vec![], 1).unwrap().predicted.len(), 1);
        host.close("held", device);
    }
    held(&mut Sqlite::new("write-authority"));
    held(&mut Memory::new());
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
        let entry = Queued { id: "sweep".into(), seq: 1, op: "sweep".into(), args: json!({}), viewer: "bob".into(), now: 1000, new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None };
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

fn named_receipt_after_revocation<H: Host>(host: &mut H, historical: bool) {
    let source = SOURCE.replace("  amount: int", "  amount: int\n  secret: text <=30\n  unique bySecretAmount: secret, amount else DUPLICATE")
        .replace("mutation edit(key: text <=30):", "mutation edit(key: text <=30): server");
    let (mut engine, backend) = compile(&source);
    let seed = |engine: &mut snapback4_core::Engine, owner: &str, other_amount: i64| {
        let rows = [("target", "lookup", 7), ("other", "other", other_amount)].map(|(id, key, amount)| {
            let row = json!({"id":id,"key":key,"owner":owner,"amount":amount,"secret":"PRIVATE"});
            ("counters".into(), wire::row_from_json(engine.schema().table("counters").unwrap(), &row).unwrap())
        });
        engine.seed(rows).unwrap();
    };
    seed(&mut engine, "alice", 0);
    let mut device = host.open("named-receipt", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let entry = Queued { id: "lost".into(), seq: 1, op: "edit".into(), args: json!({"key":"lookup"}), viewer: "alice".into(), now: 1000,
        new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None };
    assert!(!device.admit(entry.clone()).unwrap().predictable);
    device.begin_send().unwrap();
    let request_context = context("alice", &[("key", Value::String("lookup".into()))]).at(1000);
    let first = engine.mutate("edit", Some("lost"), request_context.clone()).unwrap();
    let live = first.reply(Some("lost"));
    assert_eq!(live["why"]["code"], "DUPLICATE");
    assert!(live["why"]["detail"].as_str().unwrap().contains("PRIVATE"), "live development detail stays useful");
    let receipt = engine.store().applied_outcome("alice", "lost").unwrap().unwrap();
    if historical {
        // Older servers persisted this live detail; replay must sanitize it too.
        let mut raw = first.receipt(Some("lost")); raw["why"]["detail"] = live["why"]["detail"].clone();
        engine.store().conn().execute("UPDATE _ops SET outcome = ?1 WHERE principal = 'alice' AND id = 'lost'", [raw.to_string()]).unwrap();
    }
    // Drop the first response. Only the outbox survives a close/reopen; revoke
    // before delivering the retried response to either device store.
    host.close("named-receipt", device);
    seed(&mut engine, "carol", 0);
    let mut device = host.open("named-receipt", None).unwrap();
    assert_eq!(device.queued().unwrap().len(), 1);
    let page = stream_page(&mut engine, "alice", device.state().unwrap().0);
    device.apply(&page, false).unwrap();
    assert_eq!(device.query("one", "alice", &entry.args, 1000).unwrap().data, Value::Null);
    let replay = engine.mutate("edit", Some("lost"), request_context).unwrap();
    let delivered = replay.reply(Some("lost"));
    assert_eq!(delivered["replayed"], true);
    assert_eq!(delivered["why"]["code"], "DUPLICATE");
    assert_eq!(delivered["why"]["rule"], "DUPLICATE");
    assert_eq!(delivered["why"]["message"], "the program refused with DUPLICATE");
    for field in ["code", "family", "site", "rewrite", "guide", "rule", "retryable"] { assert_eq!(delivered["why"][field], live["why"][field]); }
    assert!(delivered["why"].get("detail").is_none(), "{delivered}");
    assert!(!delivered.to_string().contains("PRIVATE"));
    if !historical { assert!(!receipt.contains("PRIVATE")); }
    device.keep_write(&delivered.to_string()).unwrap();
    device.settle("lost", None).unwrap();
    host.close("named-receipt", device);
    let mut device = host.open("named-receipt", None).unwrap();
    assert!(device.queued().unwrap().is_empty());
    assert_eq!(serde_json::from_str::<Json>(&device.meta("write-history").unwrap().unwrap()).unwrap(), json!([delivered]));
    // The same named constraint admits a non-colliding write by the new owner.
    seed(&mut engine, "carol", 2);
    let success = engine.mutate("edit", Some("allowed"), context("carol", &[("key", Value::String("lookup".into()))]).at(1000)).unwrap();
    assert!(matches!(success.state, WriteState::Sent { .. }));
    let page = stream_page(&mut engine, "alice", device.state().unwrap().0);
    device.apply(&page, false).unwrap();
    assert_eq!(device.query("one", "alice", &entry.args, 1000).unwrap().data, Value::Null);
    println!("W9R1a receipt store={} historical={historical} dropped=1 retries=1 settled=1 retained_detail=0 positive_writes=1 live={}", host.label(), live["why"]);
    host.close("named-receipt", device);
}

#[test]
fn w9r1a_named_receipt_dropped_reply_then_revocation_memory() {
    named_receipt_after_revocation(&mut Memory::new(), false);
}
#[test]
fn w9r1a_named_receipt_dropped_reply_then_revocation_sqlite() {
    named_receipt_after_revocation(&mut Sqlite::new("w9r1a-receipt"), false);
}

#[test]
fn w9r1a_historical_named_receipt_dropped_reply_then_revocation_memory() {
    named_receipt_after_revocation(&mut Memory::new(), true);
}
#[test]
fn w9r1a_historical_named_receipt_dropped_reply_then_revocation_sqlite() {
    named_receipt_after_revocation(&mut Sqlite::new("w9r1a-historical"), true);
}
