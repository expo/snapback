//! RP round 2: every reservation path, legacy downgrade, canceled overlay groups.
use super::*;
use snapback4_device::device::Backend;

fn refusal<H: Host>(host: &mut H, src: &str, op: &str, good: bool, label: &str) {
    let (mut e, mut b) = compile(src);
    seed(&mut e);
    b.schema = b.schema.public_projection();
    assert_eq!(b.schema.operations[op].predicts.as_deref(), Some("eligible"));
    let mut d = host.open(label, Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = if op == "send" { queued("alice", 1) } else { request(op, json!({"conversation":"c"}), 1) };
    let q = d.admit(q).unwrap();
    let args = q.args.as_object().unwrap().iter().map(|(k,v)|
        (k.clone(), snapback4_core::wire::from_json(&e.program(op).unwrap().args[k], v).unwrap())).collect();
    let outcome = e.mutate(op, Some(&q.id), Context::new("alice", args).at(NOW).with_ids(q.new_ids.clone())).unwrap();
    assert_eq!(q.predictable, good, "{label}: {q:?}, {outcome:?}");
    assert_eq!(q.predicted.len(), usize::from(good), "{label}");
    assert_eq!(history_pending(&mut d).len(), usize::from(good), "{label}");
    if good { assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}"); }
    else {
        assert!(format!("{outcome:?}").contains("E_BOUND"), "{label}: {outcome:?}");
        assert!(e.store().rows("messages").unwrap().is_empty());
        assert_eq!(d.queued().unwrap().len(), 1);
        d.settle(&q.id, None).unwrap();
        assert!(d.queued().unwrap().is_empty());
    }
    eprintln!("RP r2 {label}: server rows={}, predictable={}", outcome.metered.rows_written, q.predictable);
}
fn online<H: Host>(host: &mut H) {
    for count in [1, 6] {
        let mut src = source() + "\ntable watchers:\n  conversation: conversations\n  cap 50 by conversation\n  read <- exists members[.conversation, viewer]\n";
        for n in 0..count { src += &format!("\nview online{n}: count messages by watchers w where .conversation = w.conversation and .ordinal > 0\n"); }
        refusal(host, &src, "send", count == 1, &format!("online-{count}"));
    }
}
both!(derived_online_reservations_memory, derived_online_reservations_sqlite, online);

fn assets<H: Host>(host: &mut H) {
    for (kind, slots, mode, good) in [("image", 480, "row", false), ("video", 480, "row", false),
        ("image", 32, "ordinary", false), ("image", 32, "public", false), ("video", 32, "private", false),
        ("image", 480, "single", true), ("image", 512, "single", false)] {
        let mut src = if mode == "row" { fixture(false) } else { source() };
        src = src.replace("  text: text <=2000", &format!("  shots: [{kind} <=1000] <={slots} ?\n  text: text <=2000"));
        if mode == "public" { src += "\nview totals: count messages where .recipients >= 0 by .conversation\n"; }
        if mode == "private" {
            src = src.replace("  text: text <=2000", "  shelf: shelves ?\n  text: text <=2000");
            src += "\ntable shelves:\n  total: count messages where .recipients >= 0 by .shelf\n  public\n  sync public\n";
        }
        src += "\nmutation burst(conversation: conversations):\n  for n in range(0, 16):\n    insert messages { conversation, sender: viewer, text: 'burst', photo: null, shots: null, at: now }\n";
        refusal(host, &src, if ["row","single"].contains(&mode) { "send" } else { "burst" }, good, &format!("{mode}-{kind}-{slots}"));
    }
}
both!(derived_asset_reservations_memory, derived_asset_reservations_sqlite, assets);

fn stripped<H: Host>(host: &mut H) {
    let mut src = source().replace("  text: text <=2000", "  shelf: shelves ?\n  text: text <=2000");
    src += "\ntable shelves:\n";
    for n in 0..10 { src += &format!("  total{n}: count messages where .recipients >= -{n} by .shelf\n"); }
    src += "  public\n  sync public\nmutation burst(conversation: conversations):\n  for n in range(0, 30):\n    insert messages { conversation, sender: viewer, text: 'burst', photo: null, at: now }\n";
    let (mut e, mut b) = compile(&src);
    seed(&mut e);
    b.schema = b.schema.public_projection();
    for (stamp, prices) in [(false,false), (false,true), (true,false)] {
        let mut wire = serde_json::to_value(&b).unwrap();
        if !prices { wire["schema"].as_object_mut().unwrap().remove("source_reservations"); }
        if !stamp {
            for table in wire["schema"]["tables"].as_object_mut().unwrap().values_mut() {
                for c in table["constraints"].as_array_mut().unwrap() {
                    if let Some(caps) = c.get_mut("Capabilities").and_then(|v|v.as_array_mut()) {
                        caps.retain(|v|v != "receipt-derived-prediction-v1");
                    }
                }
            }
        }
        let decoded: Backend = serde_json::from_value(wire).unwrap();
        assert_eq!(decoded.schema.operations["burst"].predicts.as_deref(), Some("never"));
        let mut d = host.open(&format!("stripped-{stamp}-{prices}"), Some(decoded)).unwrap();
        publish(&mut e, &mut d, "alice");
        let q = d.admit(request("burst", json!({"conversation":"c"}), 1)).unwrap();
        assert!(!q.predictable && q.predicted.is_empty(), "{q:?}");
        assert!(history_pending(&mut d).is_empty());
        // A genuine current adoption restores eligibility, and the price still
        // queues this over-budget burst instead of trusting the stripped blob.
        d.adopt(b.clone()).unwrap();
        assert!(d.admit(queued("alice", 2)).unwrap().predictable);
        let q = d.admit(request("burst", json!({"conversation":"c"}), 3)).unwrap();
        assert!(!q.predictable && q.predicted.is_empty());
    }
}
both!(derived_stripped_schema_memory, derived_stripped_schema_sqlite, stripped);

fn canceled<H: Host>(host: &mut H) {
    let src = fixture(true).replace("last 500 by byConversationOrdinal", "") + r#"
mutation named(conversation: conversations, id: id):
  insert messages { id, conversation, sender: viewer, text: 'named', photo: null, at: now }
mutation namedThenDelete(conversation: conversations, id: id):
  insert messages { id, conversation, sender: viewer, text: 'named', photo: null, at: now }
  delete messages[id]
mutation expiringSend(conversation: conversations, until: time):
  insert messages { conversation, sender: viewer, text: 'expires', photo: null, at: now, expiresAt: until }
"#;
    let (mut e, b) = compile(&src);
    seed(&mut e);
    e.seed_at([
        ("conversations".into(), object([("id", id("d")), ("creatorId", id("alice"))])),
        ("members".into(), object([("id", id("da")), ("conversation", id("d")), ("principal", id("alice")), ("joinedOrdinal", Value::Int(0))])),
        ("members".into(), object([("id", id("db")), ("conversation", id("d")), ("principal", id("bob")), ("joinedOrdinal", Value::Int(0))])),
    ], 1).unwrap();
    for group in ["c", "d"] { sent(mutate(&mut e, "alice", "expiringSend", &[("conversation", id(group)), ("until", Value::Int(NOW+1000))], NOW)); }
    let mut d = host.open("canceled", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    for (key, same_write) in [("cancel",false), ("",false), ("single",true)] {
        let first = d.admit(request(if same_write {"namedThenDelete"} else {"named"}, json!({"conversation":"c", "id":key}), 1)).unwrap();
        assert!(first.predictable, "{first:?}");
        let second = if same_write {None} else {let q = d.admit(request("remove",json!({"id":key}),2)).unwrap(); assert!(q.predictable,"{q:?}");Some(q)};
        let saved = d.store().meta(&format!("device:receipt-deleted:{}", snapback4_core::value::digest(&("messages",key)))).unwrap().unwrap();
        let saved: Value = snapback4_core::json_codec::from_text(&saved).unwrap();
        assert_eq!(saved.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), vec!["conversation"], "no receipt payload or guessed ordinal is kept");
        for reopen in [false,true] {
            if reopen { host.close("canceled",d);d=host.open("canceled",None).unwrap(); }
            for (group,member,pending,count) in [("c","b",true,1),("d","db",false,0)] {
                let a=d.query("badge","alice",&json!({"conversation":group,"member":member}),NOW+2000).unwrap();
                assert_eq!(a.complete,!pending,"{group}: {a:?}");
                let row=&a.data.as_array().unwrap()[0];
                assert_eq!(row.field("value"),Ok(&Value::Int(count)),"{a:?}");
                assert_eq!(row.field("recountPending"),Ok(&Value::Bool(pending)),"{a:?}");
            }
        }
        if let Some(second)=second { d.settle(&second.id,None).unwrap(); }
        d.settle(&first.id,None).unwrap();
        assert!(d.queued().unwrap().is_empty());
        assert!(d.store().meta(&format!("device:receipt-deleted:{}", snapback4_core::value::digest(&("messages",key)))).unwrap().is_none());
    }
}
both!(derived_canceled_groups_memory, derived_canceled_groups_sqlite, canceled);

// This pricing is not a receipts-only rule. Known-input bounds without receipt
// allocation retain the ordinary immediate refusal contract on both hosts.
fn ordinary_assets<H: Host>(host: &mut H) {
    for (slots, burst, good) in [(480,false,true),(512,false,false),(32,true,false)] {
        let src=format!("table posts:\n  shots: [image <=1000] <={slots} ?\n  public\n  insert <- allow\n  sync public\nmutation single():\n  insert posts {{ shots: null }}\nmutation burst():\n  for n in range(0, 16):\n    insert posts {{ shots: null }}\nquery rows():\n  return posts first 100\n");
        let (mut e,b)=compile(&src);
        let mut d=host.open(&format!("plain-assets-{slots}-{burst}"),Some(b)).unwrap();
        publish(&mut e,&mut d,"alice");
        let op=if burst {"burst"} else {"single"};
        let result=d.admit(request(op,json!({}),1));
        let outcome=e.mutate(op,None,ctx("alice",&[],NOW)).unwrap();
        if good {
            assert!(result.unwrap().predictable);
            assert!(matches!(outcome.state,WriteState::Sent {..}),"{outcome:?}");
        } else {
            assert!(matches!(result,Err(snapback4_core::error::RuntimeError::Bound {..})),"{result:?}");
            assert!(format!("{outcome:?}").contains("E_BOUND"));
            assert!(d.query("rows","alice",&json!({}),NOW).unwrap().data.as_array().unwrap().is_empty());
            assert!(e.store().rows("posts").unwrap().is_empty());
        }
    }
}
both!(derived_plain_asset_reservations_memory, derived_plain_asset_reservations_sqlite, ordinary_assets);
