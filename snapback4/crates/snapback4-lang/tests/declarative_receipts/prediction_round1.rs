//! RP review regressions: public reservations, affected groups, real RY stores.
use super::*;
use snapback4_device::device::Backend;
#[path = "prediction_counted.rs"]
mod counted;

fn cost<S: DeviceStore>(store: S, history: i64) {
    let src = fixture(false) + "\nquery repeated():\n  return [unreadCounts['b'], unreadCounts['a'], unreadCounts['b']]\n";
    let (mut e, b) = compile(&src);
    seed(&mut e);
    for n in 1..=history { send(&mut e, n, NOW); }
    let visits = counted::Visits::default();
    let mut d = Device::open_store(counted::Counted { inner: store, visits: visits.clone() }, Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    for n in 1..=32 {
        assert!(d.admit(queued("alice", n)).unwrap().predictable);
        if ![1,8,32].contains(&n) { continue; }
        visits.borrow_mut().clear();
        let started = std::time::Instant::now();
        let a = d.query("repeated", "alice", &json!({}), NOW).unwrap();
        assert!(!a.complete, "{a:?}");
        let visits = visits.borrow();
        let source: Vec<_> = visits.iter().filter(|((table,_),_)|table=="messages").collect();
        assert_eq!(source, vec![(&("messages".into(), "$get".into()), &(n as usize))], "one overlay point per pending row, reused across three badges");
        eprintln!("RP overlay cost: history={history}, pending={n}, source_points={n}, source_scans=0, query_us={}", started.elapsed().as_micros());
    }
}
#[test] fn derived_overlay_cost_memory() { for n in [16,512] { cost(snapback4_device::memory::MemoryStore::new(), n); } }
#[test] fn derived_overlay_cost_sqlite() {
    for n in [16,512] {
        let host = Sqlite::new("rp-cost");
        // Initialize the native device's side tables before handing the store
        // to the instrumented adapter.
        let (_, b) = compile(&fixture(false));
        drop(Device::open(&host.path("d"), Some(b)).unwrap());
        cost(snapback4_core::Store::open_shared(&host.path("d")).unwrap(), n);
    }
}

fn reservations<H: Host>(host: &mut H) {
    for (views, burst) in [(1, false), (6, false), (1, true)] {
        let mut src = fixture(false);
        for n in 1..views {
            src += &format!("\nview unread{n}: count messages by members m where .conversation = m.conversation and .ordinal > m.seenOrdinal\n");
        }
        src += "\nmutation burst(conversation: conversations):\n  for n in range(0, 10):\n    insert messages { conversation, sender: viewer, text: 'burst', photo: null, at: now }\n";
        let (mut e, b) = compile(&src);
        seed(&mut e);
        let mut d = host.open(&format!("reserve-{views}-{burst}"), Some(b)).unwrap();
        publish(&mut e, &mut d, "alice");
        let q = if burst { request("burst", json!({"conversation":"c"}), 1) } else { queued("alice", 1) };
        let q = d.admit(q).unwrap();
        let good = views == 1 && !burst;
        assert_eq!(q.predictable, good, "{q:?}");
        assert_eq!(history_pending(&mut d).len(), usize::from(good));
        let args = q.args.as_object().unwrap().iter().map(|(k,v)|
            (k.clone(), snapback4_core::wire::from_json(&e.program(&q.op).unwrap().args[k], v).unwrap())).collect();
        let outcome = e.mutate(&q.op, Some(&q.id), Context::new("alice", args).at(NOW).with_ids(q.new_ids.clone())).unwrap();
        if good {
            assert_eq!(outcome.metered.rows_written, 202);
            assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
        } else {
            assert!(format!("{:?}", outcome.state).contains("E_BOUND"), "{outcome:?}");
            assert!(e.store().rows("messages").unwrap().is_empty());
            assert_eq!(d.queued().unwrap().len(), 1, "allocation refusal retains custody");
            d.settle(&q.id, None).unwrap();
            assert!(d.queued().unwrap().is_empty());
        }
    }
}
both!(derived_reservations_memory, derived_reservations_sqlite, reservations);

fn ordinary_reservations<H: Host>(host: &mut H) {
    let mut src = source();
    for n in 0..50 { src += &format!("\nview totals{n}: count messages where .recipients >= -{n} by .conversation\n"); }
    src += "\nmutation burst(conversation: conversations):\n  for n in range(0, 21):\n    insert messages { conversation, sender: viewer, text: 'burst', photo: null, at: now }\n";
    let (mut e, b) = compile(&src);
    seed(&mut e);
    let mut d = host.open("ordinary-reservations", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = d.admit(request("burst", json!({"conversation":"c"}), 1)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty(), "{q:?}");
    let result = e.mutate("burst", Some(&q.id), ctx("alice", &[("conversation", id("c"))], NOW)).unwrap();
    assert!(format!("{result:?}").contains("E_BOUND"), "{result:?}");
    assert!(e.store().rows("messages").unwrap().is_empty());
}
both!(derived_ordinary_reservations_memory, derived_ordinary_reservations_sqlite, ordinary_reservations);

fn column_reservations<H: Host>(host: &mut H) {
    let mut src = source().replace("  text: text <=2000", "  shelf: shelves ?\n  text: text <=2000");
    src += "\ntable shelves:\n";
    for n in 0..10 { src += &format!("  total{n}: count messages where .recipients >= -{n} by .shelf\n"); }
    src += "  public\n  sync public\nmutation burst(conversation: conversations):\n  for n in range(0, 30):\n    insert messages { conversation, shelf: 's', sender: viewer, text: 'burst', photo: null, at: now }\n";
    let (mut e, mut b) = compile(&src);
    seed(&mut e);
    e.seed_at([("shelves".into(), object([("id", id("s"))]))], NOW).unwrap();
    b.schema = b.schema.public_projection();
    assert_eq!(b.schema.source_reservations["messages"].prices[0][3], 40);
    assert!(b.schema.maintains.iter().all(|m| m.private.is_none()));
    let text = serde_json::to_string(&b).unwrap();
    assert!(text.contains("receipt-derived-prediction-v1"));
    b = snapback4_core::json_codec::from_text(&text).unwrap();
    let mut d = host.open("column-reservations", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = d.admit(request("burst", json!({"conversation":"c"}), 1)).unwrap();
    let result = e.mutate("burst", Some(&q.id), ctx("alice", &[("conversation", id("c"))], NOW)).unwrap();
    assert!(format!("{result:?}").contains("E_BOUND"), "{result:?}");
    assert!(!q.predictable && q.predicted.is_empty(), "{q:?}");
    assert!(e.store().rows("messages").unwrap().is_empty());
}
both!(derived_column_reservations_memory, derived_column_reservations_sqlite, column_reservations);

fn recipient_cap<H: Host>(host: &mut H) {
    let src = fixture(false) + r#"
table watchers:
  conversation: conversations
  cap 2 by conversation
  read <- exists members[.conversation, viewer]
  sync to members[.conversation]
view watched: count messages by watchers w
  where .conversation = w.conversation and .ordinal > 0
"#;
    let (mut e, b) = compile(&src);
    seed(&mut e);
    // Defensive refusal on a malformed restored population, independent of
    // the ordinary member-write cap. No receipt field is needed to detect it.
    e.load_trusted((0..3).map(|n| ("watchers".into(), object([
        ("id", id(&format!("w{n}"))), ("conversation", id("c"))
    ])))).unwrap();
    let mut d = host.open("cap", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = d.admit(queued("alice", 1)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty(), "{q:?}");
    let result = e.mutate("send", None, ctx("alice", &[("conversation", id("c")), ("text", Value::String("refused".into())), ("photo", Value::Null)], NOW)).unwrap();
    assert!(format!("{result:?}").contains("E_VIEW_KEY"), "{result:?}");
    assert!(e.store().rows("messages").unwrap().is_empty());
}
both!(derived_recipient_cap_memory, derived_recipient_cap_sqlite, recipient_cap);

fn group_badge<S: DeviceStore>(d: &mut Device<S>, group: &str, member: &str, now: i64, count: i64, pending: bool) {
    let a = d.query("badge", "alice", &json!({"conversation":group, "member":member}), now).unwrap();
    assert_eq!(a.complete, !pending, "{group}: {a:?}");
    let row = &a.data.as_array().unwrap()[0];
    assert_eq!(row.field("value"), Ok(&Value::Int(count)), "{group}: {a:?}");
    assert_eq!(row.field("recountPending"), Ok(&Value::Bool(pending)), "{group}: {a:?}");
}

fn groups<H: Host>(host: &mut H) {
    let src = fixture(true).replace("last 500 by byConversationOrdinal", "") + r#"
mutation expiringSend(conversation: conversations, until: time):
  insert messages { conversation, sender: viewer, text: 'expiry', photo: null, at: now, expiresAt: until }
view totals: count messages where .recipients > 0 by .conversation
query total(conversation: conversations):
  return totals[conversation]
query memberBadge(member: members):
  return unreadCounts[member]
"#;
    let (mut e, b) = compile(&src);
    seed(&mut e);
    e.seed_at([
        ("conversations".into(), object([("id", id("d")), ("creatorId", id("alice"))])),
        ("members".into(), object([("id", id("da")), ("conversation", id("d")), ("principal", id("alice")), ("joinedOrdinal", Value::Int(0))])),
        ("members".into(), object([("id", id("db")), ("conversation", id("d")), ("principal", id("bob")), ("joinedOrdinal", Value::Int(0))])),
    ], 1).unwrap();
    for group in ["c", "d"] {
        sent(mutate(&mut e, "alice", "expiringSend", &[("conversation", id(group)), ("until", Value::Int(NOW+1000))], NOW));
    }
    let message = e.store().rows("messages").unwrap().into_iter().find(|m| m.field("conversation")==Ok(&id("c"))).unwrap();
    let mut d = host.open("groups", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    for op in ["send", "edit", "remove", "addMember"] {
        let q = match op {
            "send" => queued("alice", 1),
            "addMember" => request(op, json!({"conversation":"c", "principal":"carol"}), 2),
            _ => request(op, json!({"id":message.field("id").unwrap().as_str().unwrap()}), 3),
        };
        let q = d.admit(q).unwrap();
        assert!(q.predictable, "{q:?}");
        group_badge(&mut d, "c", "b", NOW, 1, true);
        group_badge(&mut d, "d", "db", NOW, 1, false);
        // Clean groups still expire. The dirty snapshot can exceed the live
        // answer and must never be rendered as an L+ lower bound.
        group_badge(&mut d, "c", "b", NOW+2000, 1, true);
        group_badge(&mut d, "d", "db", NOW+2000, 0, false);
        let clean = d.query("memberBadge", "alice", &json!({"member":"db"}), NOW+2000).unwrap();
        assert!(clean.complete, "{clean:?}");
        assert_eq!(clean.data, Value::Int(0));
        let clean = d.query("total", "alice", &json!({"conversation":"d"}), NOW+2000).unwrap();
        assert!(clean.complete, "{clean:?}");
        assert_eq!(clean.data, Value::Int(0));
        host.close("groups", d);
        d = host.open("groups", None).unwrap();
        group_badge(&mut d, "d", "db", NOW+2000, 0, false);
        d.settle(&q.id, None).unwrap();
        group_badge(&mut d, "c", "b", NOW+2000, 0, false);
    }
}
both!(derived_group_pending_memory, derived_group_pending_sqlite, groups);

const OLD: &str = include_str!("../fixtures/rp-predecessor/backend.json");
const SOURCE: &str = include_str!("../fixtures/rp-predecessor/schema.q");
fn old_memory() -> snapback4_device::memory::MemoryStore {
    let mut store = snapback4_device::memory::MemoryStore::new();
    store.load(serde_json::from_str::<Vec<snapback4_device::memory::Change>>(include_str!("../fixtures/rp-predecessor/memory.json")).unwrap()).unwrap();
    store
}
fn debt<S: DeviceStore>(d: &mut Device<S>) -> serde_json::Value {
    let response = d.delivery(&json!({"viewer":"alice", "action":"read", "now":NOW})).unwrap();
    let state: serde_json::Value = serde_json::from_str(response["value"].as_str().unwrap()).unwrap();
    state["groups"].as_object().unwrap().values().next().unwrap()["owed"].clone()
}
fn upgrade<S: DeviceStore>(mut d: Device<S>, e: &mut Engine, b: Backend) {
    let original = d.queued().unwrap();
    assert_eq!(original.len(), 1);
    assert!(!original[0].predictable);
    let identity = d.store().meta("device:store_id").unwrap();
    assert_eq!(identity, e.store().meta("store_id").unwrap());
    assert!(identity.is_some());
    assert_eq!(debt(&mut d), json!([[1,1]]));
    d.adopt(b).unwrap();
    assert_eq!(d.store().meta("device:store_id").unwrap(), identity);
    assert_eq!(d.queued().unwrap()[0].id, original[0].id);
    assert_eq!(debt(&mut d), json!([[1,1]]));
    publish(e, &mut d, "alice");
    let fresh = d.admit(queued("alice", 8)).unwrap();
    assert!(fresh.predictable, "{fresh:?}");
    settle(e, &mut d, &original[0]);
    settle(e, &mut d, &fresh);
    assert!(d.queued().unwrap().is_empty());
    let value = d.query("badge", "alice", &json!({"member":"b"}), NOW).unwrap();
    assert_eq!(value.data, Value::Int(3));
    assert!(value.complete, "{value:?}");
    assert_eq!(debt(&mut d), json!([[1,3]]));
    sent(mutate(e, "alice", "delivered", &[("conversation", id("c")), ("from", Value::Int(1)), ("through", Value::Int(3))], NOW));
    // An authentic delivered operation consumes the preserved debt positions.
    let request = d.delivery(&json!({"viewer":"alice", "action":"read", "now":NOW})).unwrap();
    let mut state: serde_json::Value = serde_json::from_str(request["value"].as_str().unwrap()).unwrap();
    for group in state["groups"].as_object_mut().unwrap().values_mut() { group["owed"] = json!([]); }
    assert_eq!(d.delivery(&json!({"viewer":"alice", "action":"write", "expected":request["value"], "value":state.to_string()})).unwrap(), json!(true));
    assert_eq!(debt(&mut d), json!([]));
}
#[test]
fn authentic_predecessor_stores_open_install_and_converge() {
    use snapback4_device::opening::Opening;
    assert!(!OLD.contains("receipt-derived-prediction-v1"));
    let old: Backend = snapback4_core::json_codec::from_text(OLD).unwrap();
    assert_eq!(old.schema.operations["send"].predicts.as_deref(), Some("never"));
    let compiled = bound(SOURCE);
    assert_eq!(compiled.schema.delivery, old.schema.delivery);
    for memory in [true, false] {
        for mode in ["kept", "initial", "install"] {
            let host = Sqlite::new("rp-real-upgrade");
            let path = host.path("server");
            std::fs::write(&path, include_bytes!("../fixtures/rp-predecessor/server.sqlite")).unwrap();
            let mut e = Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
            assert_eq!(e.store().rows("messages").unwrap().len(), 1);
            let generation = e.adopt(compiled.schema.clone(), compiled.programs.iter().map(|p|p.program.clone())).unwrap();
            let b = Backend { generation, schema: compiled.schema.public_projection(), programs: compiled.programs.iter().map(|p|p.program.clone()).collect() };
            let opening = match mode { "kept" => Opening::Kept, "initial" => Opening::Initial(b.clone()), _ => Opening::Install(b.clone()) };
            if memory { upgrade(opening.open(old_memory()).unwrap(), &mut e, b); }
            else {
                let path = host.path("device");
                std::fs::write(&path, include_bytes!("../fixtures/rp-predecessor/device.sqlite")).unwrap();
                upgrade(opening.open(snapback4_core::Store::open_shared(&path).unwrap()).unwrap(), &mut e, b);
            }
        }
    }
    // Direct installation into an old server database is supported too.
    let host = Sqlite::new("rp-server-install");
    std::fs::write(host.path("server"), include_bytes!("../fixtures/rp-predecessor/server.sqlite")).unwrap();
    let e = Engine::new(snapback4_core::Store::open(&host.path("server")).unwrap(), compiled.schema, compiled.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(e.store().rows("messages").unwrap().len(), 1);
}
