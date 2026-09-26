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
  return counters[key = key]
mutation edit(key: text <=30):
  update counters[key = key] {amount: 0}
mutation byId(target: counters):
  update counters[id = target] {amount: 0}
mutation put(key: text <=30):
  upsert counters[key = key] {owner: 'alice', amount: 0}
mutation putId(target: counters):
  upsert counters[id = target] {key: 'lookup', owner: 'alice', amount: 0}
"#;

#[test]
fn an_old_page_cannot_qualify_a_refused_ops_record_as_success() {
    fn run<H: Host>(host: &mut H) {
        let source = SOURCE.replace("mutation edit(key: text <=30):", "mutation edit(key: text <=30):\n  require false else NOT_ADMIN");
        let (mut engine, backend) = compile(&source);
        let mut device = host.open("old-refusal-page", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let entry: Queued = serde_json::from_value(json!({"id":"refused","seq":1,"op":"edit","args":{"key":"lookup"},"viewer":"bob","now":1000,
            "new_ids":[],"predicted":[],"predictable":false})).unwrap();
        device.enqueue(&entry).unwrap();
        let refusal = engine.mutate("edit", Some("refused"), context("bob", &[("key", Value::String("lookup".into()))])).unwrap().receipt(Some("refused"));
        assert_eq!(refusal["why"]["code"], "NOT_ADMIN");
        let seq = engine.store().conn().query_row("SELECT seq FROM _ops WHERE principal = 'bob' AND id = 'refused'", [], |r| r.get::<_, i64>(0)).unwrap() as u64;
        // Older servers included refused decisions in acknowledged and omitted
        // sent entirely. Exercise apply, not an already-stamped queue fixture.
        let page = serde_json::from_value(json!({"snapshot":false,"generation":device.backend().generation,"events":[],
            "watermark":seq,"more":false,"acknowledged":{"refused":seq}})).unwrap();
        device.apply(&page, false).unwrap();
        let kept = &device.queued().unwrap()[0];
        assert_eq!(kept.observed_seq, Some(seq));
        assert_eq!(kept.receipt_store.as_ref().and_then(|r| r.success_seq), None, "a decision without its outcome is not success");
        host.close("old-refusal-page", device);
        let mut device = host.open("old-refusal-page", None).unwrap();
        assert_eq!(device.queued().unwrap()[0].receipt_store.as_ref().and_then(|r| r.success_seq), None);
        let replay = engine.mutate("edit", Some("refused"), context("bob", &[("key", Value::String("lookup".into()))])).unwrap().reply(Some("refused"));
        assert_eq!(replay["replayed"], true); assert_eq!(replay["why"]["code"], "NOT_ADMIN");
        device.keep_write(&replay.to_string()).unwrap(); device.settle("refused", None).unwrap();
        host.close("old-refusal-page", device);
        let mut device = host.open("old-refusal-page", None).unwrap();
        assert!(device.queued().unwrap().is_empty());
        assert_eq!(serde_json::from_str::<Json>(&device.meta("write-history").unwrap().unwrap()).unwrap()[0]["why"]["code"], "NOT_ADMIN");
        host.close("old-refusal-page", device);
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("old-refusal-page"));
}

#[test]
fn only_a_matching_outbox_acknowledgement_overwrites_a_replacement_refusal() {
    fn run<H: Host>(host: &mut H) {
        for code in ["E_STORE_REPLACED", "NOT_ADMIN"] {
            for observed in [false, true] {
                let (_, backend) = compile(SOURCE);
                let name = format!("ack-{code}-{observed}");
                let mut device = host.open(&name, Some(backend)).unwrap();
                let failed = json!({"state":"failed", "id":"write", "why":{"code":code}});
                let sent = json!({"state":"sent", "id":"write", "seq":7, "replayed":true});
                device.keep_write(&failed.to_string()).unwrap();
                device.keep_write(&sent.to_string()).unwrap();
                let history = |device: &snapback4_device::device::Device<H::Store>| serde_json::from_str::<Json>(&device.meta("write-history").unwrap().unwrap()).unwrap();
                assert_eq!(history(&device), json!([failed]), "no acknowledgement cannot replace history");
                let entry = Queued { id: "write".into(), seq: 1, op: "edit".into(), args: json!({"key":"lookup"}), viewer: "bob".into(), now: 1000,
                    new_ids: vec![], predicted: vec![], predictable: false, sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None };
                device.admit(entry).unwrap();
                if observed {
                    let page = serde_json::from_value(json!({"snapshot":false,"generation":device.backend().generation,"events":[],"watermark":7,"more":false,"acknowledged":{"write":7},"sent":{"write":7}})).unwrap();
                    device.apply(&page, false).unwrap();
                } else { device.settle("write", Some(7)).unwrap(); }
                // The candidate sequence must match custody, not just its id.
                device.keep_write(&json!({"state":"sent","id":"write","seq":8}).to_string()).unwrap();
                assert_eq!(history(&device), json!([failed]));
                device.keep_write(&sent.to_string()).unwrap();
                let expected = if code == "E_STORE_REPLACED" { sent } else { failed };
                assert_eq!(history(&device), json!([expected]));
                host.close(&name, device);
                let device = host.open(&name, None).unwrap();
                assert_eq!(history(&device), json!([expected]));
                host.close(&name, device);
            }
        }
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("acknowledgement-receipts"));
}

#[test]
fn legacy_receipts_require_the_original_store_outcome_before_replacing_unknown_failure() {
    fn run<H: Host>(host: &mut H) {
        for code in ["E_STORE_REPLACED", "NOT_ADMIN", "NOT_FOUND", "CONFLICT"] {
            for observed in [false, true] {
                for success in [false, true] {
                    let (_, backend) = compile(SOURCE);
                    let name = format!("legacy-{code}-{observed}-{success}");
                    let mut device = host.open(&name, Some(backend)).unwrap();
                    let failed = json!({"state":"failed","id":"write","why":{"code":code}});
                    device.keep_write(&failed.to_string()).unwrap();
                    let mut entry: Queued = serde_json::from_value(json!({"id":"write","seq":1,"op":"edit","args":{"key":"lookup"},"viewer":"bob","now":1000,"new_ids":[],"predicted":[],"predictable":false,"receipt_store":{"id":"original"}})).unwrap();
                    if observed { entry.observed_seq = Some(7); } else { entry.sent_seq = Some(7); }
                    device.enqueue(&entry).unwrap();
                    let outcome = if success { json!({"state":"sent","id":"write","seq":7,"replayed":true}) }
                        else { json!({"state":"failed","id":"write","why":{"code":"NOT_ADMIN"}}) };
                    let history = |device: &snapback4_device::device::Device<H::Store>| serde_json::from_str::<Json>(&device.meta("write-history").unwrap().unwrap()).unwrap();
                    for proof in [None, Some("replacement")] {
                        let mut candidate = outcome.clone();
                        if let Some(proof) = proof { candidate["revalidated_store"] = json!(proof); }
                        device.keep_write(&candidate.to_string()).unwrap();
                        assert_eq!(history(&device), json!([failed]), "a legacy sequence or another store cannot resolve history");
                    }
                    let mut replay = outcome.clone(); replay["revalidated_store"] = json!("original");
                    device.keep_write(&json!([replay]).to_string()).unwrap();
                    assert_eq!(history(&device), json!([failed]), "adopted history cannot attest a fresh replay");
                    device.keep_write(&replay.to_string()).unwrap();
                    let expected = if code == "E_STORE_REPLACED" { outcome } else { failed };
                    assert_eq!(history(&device), json!([expected]), "only the unknown replacement outcome may change; proof stays internal");
                    host.close(&name, device);
                    let device = host.open(&name, None).unwrap();
                    assert_eq!(history(&device), json!([expected]));
                    host.close(&name, device);
                }
            }
        }
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("legacy-revalidated-outcomes"));
}

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
        let entry = Queued { id: "sweep".into(), seq: 1, op: "sweep".into(), args: json!({}), viewer: "bob".into(), now: 1000, new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None };
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
        new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None, dispatch: None };
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
