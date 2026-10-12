//! The Clique send predicts offline without ever acquiring its payload source.
use super::*;
use snapback4_core::{Ceilings, Presence};
use snapback4_core::value::object;

#[derive(Debug)]
struct Poll(u64, Option<i64>);
impl Presence for Poll {
    fn connections(&self, _: &str) -> u64 { self.0 + u64::from(self.1.is_some()) }
    fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (self.0, self.1) }
}

fn source() -> String {
    let block = snapback4_lang::guide::quarry(snapback4_lang::guide::card("prediction").unwrap()).into_iter().find(|block| block.contains("mutation send(")).unwrap();
    format!("{block}\nquery message(id: messages):\n  return messages[id]\n")
}

fn seed(engine: &mut snapback4_core::Engine, profile: bool) {
    let mut rows = Vec::new();
    for (i, principal) in ["alice", "bob", "carol"].into_iter().enumerate() {
        rows.push(("members".into(), object([("id", id(&format!("m{i}"))), ("chat", id("room")), ("principal", id(principal))])));
    }
    if profile { rows.push(("profiles".into(), object([("id", id("profile")), ("principal", id("alice")), ("displayName", Value::String("Alice Sender".into()))]))); }
    engine.seed(rows).unwrap();
}

fn without_pending(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(row) = value.as_object_mut() { row.remove("pending"); }
    value
}

fn text_payload_scenarios(guarded: bool) {
    on_both(|host| {
        for (name, expression, present, missing) in [
            ("plain", "x ?? ''", "Alice Sender", ""),
            ("sha256", "sha256(x ?? '')", "4507233f5cebb99d42954e1e79bbb1aa6957c9aad13e4aa37c9e549a82fd1aa6", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
            ("join", "join([x ?? ''], '')", "Alice Sender", ""),
        ] {
            for profile in [false, true] {
                let (guard, indent) = if guarded { ("  if not exists connected[recipient]:\n", "    ") } else { ("", "  ") };
                let source = format!("{}\nmutation sendPayload(chat: id, body: text <=2000, recipient: principal) predicts:\n  message = insert messages {{ chat, sender: viewer, body }}\n{guard}{indent}x = profiles[principal = viewer].displayName\n{indent}emit notify {{ recipient, text: {expression} }}\n  return message\n", source());
                let (mut engine, mut backend) = compile(&source);
                seed(&mut engine, profile);
                backend.generation = engine.generation();
                let fact = &backend.schema.operations["sendPayload"];
                assert_eq!(fact.predicts.as_deref(), Some("eligible"));
                assert_eq!(fact.connected_effects_only, guarded, "unguarded scenario must not depend on presence eligibility");
                assert_eq!(fact.effect_payload_reads.len(), 1);
                let pages = snapshot_pages(&mut engine, "alice", 20);
                assert!(pages.iter().flat_map(|page| &page.events).all(|event| event.table != "profiles"));
                let label = format!("effect-text-{name}-{guarded}-{profile}");
                let mut device = host.open(&label, Some(backend)).unwrap();
                for (i, page) in pages.iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
                let prediction = ok(device.call(serde_json::json!({
                    "op":"predict", "name":"sendPayload", "viewer":"alice", "now":11_000,
                    "args":{"chat":"room", "body":"offline text", "recipient":"bob"}, "newIds":["message"],
                })));
                let predicted = query(&mut *device, "message", "alice", serde_json::json!({"id":"message"}), 11_000);
                assert_eq!(predicted["data"]["pending"], true, "{label}: {predicted}");
                assert!(engine.store().rows("messages").unwrap().is_empty());
                assert!(engine.effects(None, 10).unwrap().is_empty());
                let sent = engine.mutate("sendPayload", None, context("alice", &[
                    ("chat", id("room")), ("body", Value::String("offline text".into())), ("recipient", id("bob")),
                ]).at(11_000).with_ids(["message".into()])).unwrap();
                let WriteState::Sent { result, .. } = sent.state else { panic!("{label}: {sent:?}") };
                assert_eq!(without_pending(prediction["result"].clone()), snapback4_core::wire::to_json(&result), "{label}");
                assert_eq!(without_pending(predicted["data"].clone()), snapback4_core::wire::to_json(&engine.store().rows("messages").unwrap()[0]), "{label}");
                let effects = engine.effects(None, 10).unwrap();
                assert_eq!(effects.len(), 1, "{label}");
                assert_eq!(effects[0].payload.field("recipient").unwrap().as_str().unwrap(), "bob");
                assert_eq!(effects[0].payload.field("text").unwrap().as_str().unwrap(), if profile { present } else { missing }, "{label}");
                device.close();
            }
        }
    });
}

#[test]
fn total_text_payloads_skip_profile_reads_on_devices() {
    text_payload_scenarios(true);
}

#[test]
fn unguarded_payload_reads_predict_without_online_only_data() {
    text_payload_scenarios(false);
}

#[test]
fn effect_payload_send_predicts_offline_and_agrees_at_every_presence_state() {
    on_both(|host| {
        for (state, live, grace, expected_deadline) in [("held", 1, None, Some(16_000)), ("graced", 0, Some(36_000), Some(36_000)), ("absent", 0, None, None)] {
            for profile in [false, true] {
                for nested in [false, true] {
                    let source = if nested { source().replace("profiles[principal = viewer].displayName ?? 'Someone'", "profiles[principal = viewer].displayName ?? profiles[principal = p.principal].displayName ?? 'Someone'") } else { source() };
                    let (mut engine, mut backend) = compile(&source);
                    seed(&mut engine, profile);
                    engine.set_presence(Some(std::sync::Arc::new(Poll(live, grace))));
                    backend.generation = engine.generation();
                    assert_eq!(backend.schema.operations["send"].predicts.as_deref(), Some("eligible"));
                    let label = format!("effect-read-{state}-{profile}-{nested}");
                    let pages = snapshot_pages(&mut engine, "alice", 20);
                    assert!(pages.iter().flat_map(|page| &page.events).all(|event| event.table != "profiles"));
                    let watermark = pages.last().unwrap().watermark;
                    let mut device = host.open(&label, Some(backend)).unwrap();
                    for (i, page) in pages.iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
                    let args = serde_json::json!({"chat":"room", "body":"offline hello"});
                    let prediction = ok(device.call(serde_json::json!({"op":"predict", "name":"send", "viewer":"alice", "args":args, "now":11_000, "newIds":["message"]})));
                    ok(device.call(serde_json::json!({"op":"withdraw", "predicted":prediction["predicted"]})));
                    ok(device.call(serde_json::json!({"op":"admit", "entry":Queued { upload: None,
                        id:"send-write".into(), seq:1, op:"send".into(), args, new_ids:vec!["message".into()], predicted:vec![],
                        viewer:"alice".into(), now:11_000, predictable:true, sent_seq:None, receipt_store:None, observed_seq:None, dispatch: None,
                    }})));
                    assert!(engine.store().rows("messages").unwrap().is_empty());
                    assert!(engine.effects(None, 10).unwrap().is_empty());
                    let predicted = query(&mut *device, "message", "alice", serde_json::json!({"id":"message"}), 11_000);
                    assert_eq!(predicted["data"]["pending"], true, "{label}: {predicted}");
                    device.close();
                    let mut device = host.open(&label, None).unwrap();
                    assert_eq!(query(&mut *device, "message", "alice", serde_json::json!({"id":"message"}), 11_000)["data"], predicted["data"]);
                    let sent = engine.mutate("send", Some("send-write"), context("alice", &[("chat", id("room")), ("body", Value::String("offline hello".into()))]).at(11_000).with_ids(["message".into()])).unwrap();
                    let WriteState::Sent { seq, result, .. } = sent.state else { panic!("{sent:?}") };
                    assert_eq!(without_pending(prediction["result"].clone()), snapback4_core::wire::to_json(&result), "{label}");
                    assert_eq!(without_pending(predicted["data"].clone()), snapback4_core::wire::to_json(&engine.store().rows("messages").unwrap()[0]));
                    let effects = engine.effects(None, 10).unwrap();
                    assert_eq!(effects.len(), 2, "{label}");
                    for effect in effects {
                        assert_eq!(effect.next_at, expected_deadline, "{label}");
                        assert_eq!(effect.payload.field("senderDisplayName").unwrap().as_str().unwrap(), if profile { "Alice Sender" } else { "Someone" });
                        assert_eq!(effect.payload.field("preview").unwrap().as_str().unwrap(), "offline hello");
                    }
                    ok(device.call(serde_json::json!({"op":"settle", "id":"send-write", "seq":seq})));
                    ok(apply(&mut *device, &stream_page(&mut engine, "alice", watermark), false));
                    assert_ne!(query(&mut *device, "message", "alice", serde_json::json!({"id":"message"}), 11_000)["data"]["pending"], true);
                    println!("{label}: identical offline rows/result; server meter {:?}", sent.metered);
                    device.close();
                }
            }
        }
    });
}

#[test]
fn effect_payload_reads_keep_server_authorization_and_meter_rollback() {
    let private = source().replace("public 'Profile names are public'", "read <- .principal = viewer")
        .replace("profiles[principal = viewer]", "profiles[principal = p.principal]");
    let (mut engine, _) = compile(&private);
    seed(&mut engine, true);
    engine.seed([("profiles".into(), object([("id", id("secret")), ("principal", id("bob")), ("displayName", Value::String("SECRET".into()))]))]).unwrap();
    let ctx = || context("alice", &[("chat", id("room")), ("body", Value::String("hello".into()))]).at(11_000).with_ids(["message".into()]);
    let sent = engine.mutate("send", None, ctx()).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
    for effect in engine.effects(None, 10).unwrap() {
        assert_eq!(effect.payload.field("senderDisplayName").unwrap().as_str().unwrap(), "Someone", "hidden and missing profile reads both yield null");
    }
    let (mut engine, _) = compile(&source());
    seed(&mut engine, true);
    let measured = engine.mutate("send", None, ctx()).unwrap();
    assert!(matches!(measured.state, WriteState::Sent { .. }));
    let literal = source()
        .replace("        senderDisplayName = profiles[principal = viewer].displayName ?? 'Someone'\n", "")
        .replace("chatId: chat, senderDisplayName,", "chatId: chat, senderDisplayName: 'Alice Sender',");
    let (mut without_read, _) = compile(&literal);
    seed(&mut without_read, true);
    let baseline = without_read.mutate("send", None, ctx()).unwrap();
    assert!(matches!(baseline.state, WriteState::Sent { .. }));
    assert_eq!(measured.metered.examined, baseline.metered.examined + 2, "one authorized payload point read per recipient");
    for ceilings in [
        Ceilings { examined: measured.metered.examined - 1, ..Ceilings::default() },
        Ceilings { steps: measured.metered.steps - 1, ..Ceilings::default() },
        Ceilings { heap_bytes: measured.metered.heap_bytes - 1, ..Ceilings::default() },
    ] {
        let (mut engine, _) = compile(&source());
        seed(&mut engine, true);
        engine.set_ceilings(ceilings);
        let sent = engine.mutate("send", None, ctx()).unwrap();
        assert!(matches!(sent.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{sent:?}");
        assert!(engine.store().rows("messages").unwrap().is_empty());
        assert!(engine.effects(None, 10).unwrap().is_empty());
    }
}
