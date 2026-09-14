use super::*;

#[derive(Debug)]
struct Online(Vec<String>);
impl snapback4_core::Presence for Online {
    fn connections(&self, principal: &str) -> u64 { self.0.iter().filter(|p| p.as_str() == principal).count() as u64 }
}

#[test]
fn presence_effects_send_predicts_identical_rows_on_both_stores() {
    on_both(|host| {
        for connected in [vec![], vec!["dev:bob"], vec!["dev:bob", "dev:carol"]] {
            let source = format!("{}\nquery message(id: messages):\n  return messages[id]\nquery online(p: principal):\n  return connected[p]\n", snapback4_lang::guide::quarry(snapback4_lang::guide::card("effects").unwrap())[0]);
            let (mut engine, mut backend) = compile(&source);
            engine.set_presence(Some(std::sync::Arc::new(Online(connected.iter().map(|p| (*p).into()).collect()))));
            engine.seed(["dev:alice", "dev:bob", "dev:carol"].iter().enumerate().map(|(n, p)| ("members".into(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("roomId", id("room")), ("principal", id(p))])))).unwrap();
            backend.generation = engine.generation();
            let label = host.label();
            let mut device = host.open(&format!("presence-{}", connected.len()), Some(backend)).unwrap();
            for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let online = query(&mut *device, "online", "dev:alice", serde_json::json!({"p":"dev:bob"}), 1000);
            assert_eq!(online["complete"], false, "presence queries remain unknown on {label}");
            ok(device.call(serde_json::json!({ "op": "admit", "entry": Queued { id: "send-write".into(), seq: 1, op: "send".into(), args: serde_json::json!({"roomId":"room", "body":"offline hello"}), new_ids: vec!["msg".into()], predicted: vec![], viewer: "dev:alice".into(), now: 1234, predictable: true, sent_seq: None, observed_seq: None } })));
            let predicted = query(&mut *device, "message", "dev:alice", serde_json::json!({"id":"msg"}), 2000);
            assert_eq!(predicted["data"]["pending"], true, "{label}, connected={connected:?}: {predicted}");
            assert!(engine.store().rows("messages").unwrap().is_empty(), "the device admitted the row offline");
            assert!(engine.effects(None, 10).unwrap().is_empty());
            let sent = engine.mutate("send", Some("send-write"), context("dev:alice", &[("roomId", id("room")), ("body", Value::String("offline hello".into()))]).at(1234).with_ids(["msg".into()])).unwrap();
            let WriteState::Sent { seq, .. } = sent.state else { panic!("{:?}", sent.state) };
            let mut expected = predicted["data"].clone();
            expected.as_object_mut().unwrap().remove("pending");
            assert_eq!(expected, snapback4_core::wire::to_json(&engine.store().rows("messages").unwrap()[0]), "{label}, connected={connected:?}");
            let effects = engine.effects(Some("queued"), 10).unwrap();
            assert_eq!(effects.len(), 2 - connected.len());
            let mut actual: Vec<_> = effects.iter().map(|e| { assert_eq!(e.effect, "notify"); e.payload.field("targetUserId").unwrap().as_str().unwrap() }).collect();
            actual.sort();
            assert_eq!(actual, ["dev:bob", "dev:carol"].into_iter().filter(|p| !connected.contains(p)).collect::<Vec<_>>());
            ok(device.call(serde_json::json!({"op":"settle", "id":"send-write", "seq":seq})));
            ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", 0), false));
            let confirmed = query(&mut *device, "message", "dev:alice", serde_json::json!({"id":"msg"}), 2000);
            assert_ne!(confirmed["data"]["pending"], true);
            println!("{label}, connected={}: predicted rows=1, identical server rows=1, notify={}", connected.len(), effects.len());
            device.close();
        }
    });
}
