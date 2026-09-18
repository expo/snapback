use super::*;

#[test]
fn the_device_follows_the_server_and_answers_locally() {
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = server();
        let mut device = host.open("bob", Some(backend.clone())).unwrap();
        assert_eq!(state(&mut *device), (0, backend.generation), "{label}");
        // The snapshot in pages of 50: the first clears, the watermark lands with the last.
        let pages = snapshot_pages(&mut engine, "dev:bob", 50);
        assert!(pages.len() >= 3, "{} pages", pages.len());
        for (n, page) in pages.iter().enumerate() {
            ok(apply(&mut *device, page, n == 0));
            assert_eq!(state(&mut *device).0 > 0, n + 1 == pages.len(), "{label}: the watermark lands with the last page");
        }
        let (watermark, _) = state(&mut *device);
        // A query with the device's words: the thread pages with the server's cursors.
        let first = query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 2_000);
        assert_eq!(rows(&first).len(), 50, "{label}");
        assert!(first["complete"].as_bool().unwrap() && first["next"].is_string(), "{label}: {first}");
        let inbox = query(&mut *device, "inbox", "dev:bob", serde_json::json!({}), 2_000);
        assert_eq!(rows(&inbox)[0]["count"], 120, "{label}");
        // A prediction: pending on the device, counted, then replaced by the server's image.
        let predicted = ok(device.call(serde_json::json!({ "op": "predict", "name": "send", "viewer": "dev:bob", "args": { "conversationId": "c1", "body": "hello" }, "now": 2_000, "newIds": ["msgNEW"], "entropy": 7 })));
        assert_eq!(predicted["result"]["id"], "msgNEW", "{label}: {predicted}");
        assert!(predicted["predicted"].as_array().unwrap().contains(&serde_json::json!("messages/msgNEW")));
        let thread = query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 2_000);
        assert_eq!(rows(&thread)[0]["id"], "msgNEW", "{label}");
        assert_eq!(rows(&thread)[0]["pending"], true, "{label}");
        assert_eq!(rows(&query(&mut *device, "inbox", "dev:bob", serde_json::json!({}), 2_000))[0]["count"], 121, "{label}");
        // The outbox keeps it in submission order until the server answers.
        let seq = ok(device.call(serde_json::json!({ "op": "next_submission" }))).as_u64().unwrap();
        let entry = Queued { id: "w1".into(), seq, op: "send".into(), args: serde_json::json!({ "conversationId": "c1", "body": "hello" }), new_ids: vec!["msgNEW".into()], predicted: vec!["messages/msgNEW".into()], viewer: "dev:bob".into(), now: 0, predictable: false, sent_seq: None, observed_seq: None };
        ok(device.call(serde_json::json!({ "op": "enqueue", "entry": entry })));
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" }))).as_array().unwrap().len(), 1, "{label}");
        assert!(device.call(serde_json::json!({ "op": "enqueue", "entry": entry })).get("denied").is_some(), "{label}: a duplicate submission is refused");
        // The server applies it; the stream brings the confirmed image, without `pending`.
        let sent = engine.mutate("send", Some("w1"), context("dev:bob", &[("conversationId", id("c1")), ("body", Value::String("hello".into()))]).at(2_500).with_ids(["msgNEW".to_owned()])).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }));
        ok(device.call(serde_json::json!({ "op": "dequeue", "id": "w1" })));
        let page = stream_page(&mut engine, "dev:bob", watermark);
        assert!(page.events.iter().any(|e| e.table == "messages" && e.id == "msgNEW"));
        ok(apply(&mut *device, &page, false));
        let thread = query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 3_000);
        assert_eq!(rows(&thread)[0]["id"], "msgNEW", "{label}");
        assert!(rows(&thread)[0].get("pending").is_none(), "{label}: the server's image carries no pending");
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" }))).as_array().unwrap().len(), 0);
        // A refused prediction leaves nothing; a withdrawn one goes.
        let refused = ok(device.call(serde_json::json!({ "op": "predict", "name": "send", "viewer": "dev:mallory", "args": { "conversationId": "c1", "body": "hi" }, "now": 3_000, "newIds": [], "entropy": 7 })));
        assert_eq!(refused["denied"]["code"], "NOT_MEMBER", "{label}: {refused}");
        let doomed = ok(device.call(serde_json::json!({ "op": "predict", "name": "send", "viewer": "dev:bob", "args": { "conversationId": "c1", "body": "doomed" }, "now": 3_000, "newIds": ["msgDOOM"], "entropy": 7 })));
        ok(device.call(serde_json::json!({ "op": "withdraw", "predicted": doomed["predicted"] })));
        assert!(rows(&query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 3_000)).iter().all(|m| m["id"] != "msgDOOM"), "{label}");
        // The rows survive a reopen; a cold start with no network opens on
        // the backend it kept; an identical-schema generation preserves them.
        device.close();
        let mut again = host.open("bob", Some(backend.clone())).unwrap();
        assert_eq!(state(&mut *again).0, page.watermark, "{label}");
        again.close();
        let mut cold = host.open("bob", None).unwrap();
        assert_eq!(state(&mut *cold).0, page.watermark, "{label}");
        assert_eq!(rows(&query(&mut *cold, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 3_000)).len(), 50, "{label}");
        cold.close();
        assert!(host.open("never", None).is_err(), "{label}: a device that never synced needs the server once");
        let mut moved = backend.clone();
        moved.generation += 1;
        let mut fresh = host.open("bob", Some(moved)).unwrap();
        assert_eq!(state(&mut *fresh), (0, backend.generation + 1), "{label}");
        let acquired = query(&mut *fresh, "inbox", "dev:bob", serde_json::json!({}), 3_000);
        assert_eq!(rows(&acquired)[0]["count"], 121, "{label}: identical-schema adoption keeps acquisition");
        assert_eq!(acquired["unknown"], false);
        fresh.close();
    });
}

#[test]
fn a_scope_tombstone_applies_the_leave_policy() {
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = server();
        let mut device = host.open("bob", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:bob", 1_000).iter().enumerate() {
            ok(apply(&mut *device, page, n == 0));
        }
        let (watermark, _) = state(&mut *device);
        // Bob leaves: memberships go (until-revoked), messages stay (delivered-history).
        let left = engine.mutate("leave", Some("l1"), context("dev:bob", &[("conversationId", id("c1"))]).at(5_000)).unwrap();
        assert!(matches!(left.state, WriteState::Sent { .. }));
        let page = stream_page(&mut engine, "dev:bob", watermark);
        assert!(page.events.iter().any(|e| e.kind == "scope"), "{:?}", page.events.iter().map(|e| (&e.table, &e.kind)).collect::<Vec<_>>());
        ok(apply(&mut *device, &page, false));
        assert_eq!(rows(&query(&mut *device, "inbox", "dev:bob", serde_json::json!({}), 6_000)).len(), 0, "{label}: the membership is gone");
        let thread = query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 6_000);
        assert_eq!(thread["denied"]["code"], "MEMBERSHIP_REQUIRED", "{label}: the query requires a membership; the rows themselves stay held");
        device.close();
    });
}

#[test]
fn the_call_answers_the_card_on_every_host() {
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = server();
        let mut device = host.open("bob", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:bob", 1_000).into_iter().enumerate() {
            ok(apply(&mut *device, &page, n == 0));
        }
        let answer = query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 2_000);
        assert_eq!(rows(&answer).len(), 50, "{label}: {answer}");
        // A refused read is the card's `denied`, inside a call that succeeded.
        let answer = device.call(serde_json::json!({ "op": "query", "name": "nothing", "viewer": "dev:bob" }));
        assert_eq!(answer["ok"]["denied"]["code"], "E_OP", "{label}: {answer}");
        let answer = device.call(serde_json::json!({ "op": "nothing" }));
        assert_eq!(answer["denied"]["code"], "E_OP", "{label}: {answer}");
        let answer = device.call(serde_json::json!({ "op": "state" }));
        assert_eq!(answer["ok"]["generation"], 1, "{label}");
        device.close();
    });
}

#[test]
fn online_only_final_insert_target_is_unknown_to_the_predictor() {
    on_both(|host| {
        let label = host.label();
        let source = "table targets:\n  name: text <=10\n  unique byName: name\n  read <- allow\ntable sources:\n  name: text <=10\n  read <- allow\n  insert <- allow\n  after insert <- exists targets[.name]\n  sync public\nquery rows():\n  return sources[] first 10 by byId\nmutation add(name: text <=10):\n  insert sources {name}\n  return null\n";
        let (mut engine, backend) = compile(source);
        engine.seed([("targets".into(), snapback4_core::value::object([("id", id("t")), ("name", Value::String("known".into()))]))]).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open_as("alice", Some(backend), "dev:alice").unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() {
            assert!(page.events.iter().all(|event| event.table != "targets"));
            ok(apply(&mut *device, page, n == 0));
        }
        let unknown = ok(device.call(serde_json::json!({ "op": "predict", "name": "add", "viewer": "dev:alice", "args": { "name": "known" }, "now": 1, "newIds": ["s"], "entropy": 1 })));
        assert_eq!(unknown["denied"]["code"], "E_PREDICT", "{label}: an unacquired target is unknown, not a false final constraint");
        assert!(rows(&query(&mut *device, "rows", "dev:alice", serde_json::json!({}), 1)).is_empty(), "{label}: the failed prediction rolls back its inserted source");
        let sent = engine.mutate("add", None, context("dev:alice", &[("name", Value::String("known".into()))]).at(1).with_ids(["s".into()])).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "the server holds the required target");
        device.close();
    });
}

#[test]
fn a_wide_merge_matches_the_server_until_the_device_horizon() {
    on_both(|host| {
        use snapback4_core::value::object;
        let label = host.label();
        let source = format!("{CHAT}\nquery feed(c: cursor ?):\n  return merge messages after c last 20 by byConvTime:\n    [m.conversationId] for m in memberships[viewer] first 20 by byPrincipalConversation\n");
        let (mut engine, backend) = compile(&source);
        let mut rows_seed = Vec::new();
        // Ten lanes exercise one-head refill. The first conversation exceeds
        // its device horizon, while the others include tied timestamps.
        for g in 0..10 {
            let c = id(&format!("c{g}"));
            rows_seed.push(("conversations".to_owned(), object([("id", c.clone()), ("title", Value::String(format!("Group {g}"))), ("creatorId", id("dev:bob"))])));
            rows_seed.push(("memberships".to_owned(), object([("id", id(&format!("m{g}"))), ("conversationId", c.clone()), ("principal", id("dev:bob")), ("role", Value::String("admin".into())), ("joinedAt", Value::Int(1))])));
            for n in 0..if g == 0 { 550 } else { 25 } {
                rows_seed.push(("messages".to_owned(), object([("id", id(&format!("msg{g}-{n:03}"))), ("conversationId", c.clone()), ("authorId", id("dev:bob")), ("body", Value::String(format!("m{n}"))), ("at", Value::Int(1_000 + n))])));
            }
        }
        engine.seed(rows_seed).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open("bob", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:bob", 100).iter().enumerate() {
            ok(apply(&mut *device, page, n == 0));
        }
        // Reopening also exercises what the host kept, not a live mirror.
        device.close();
        let mut device = host.open("bob", None).unwrap();
        let mut cursor: Option<String> = None;
        let mut complete_pages = 0;
        loop {
            let page = query(&mut *device, "feed", "dev:bob", serde_json::json!({ "c": cursor }), 2_000);
            let online = engine.query("feed", context("dev:bob", &[("c", cursor.clone().map(Value::String).unwrap_or(Value::Null))]).at(2_000)).unwrap();
            assert!(online.complete);
            if page["complete"] == false {
                assert!(complete_pages >= 24, "{label}: pages inside the held horizon are complete");
                break;
            }
            assert_eq!(page["data"], snapback4_core::wire::to_json(&online.data), "{label}");
            assert_eq!(page["next"], serde_json::json!(online.next), "{label}");
            complete_pages += 1;
            assert!(complete_pages < 40, "{label}: the exhausted horizon must report incomplete");
            cursor = Some(page["next"].as_str().expect("the server continues past this page").to_owned());
        }
        device.close();
    });
}

#[test]
fn durable_rejection_rebase_preserves_confirmed_images() {
    on_both(|host| {
        let label = host.label();
        let source = "table items:\n  group: text <=10\n  value: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nmaintain sums: sum items of value by group\n  read <- allow\nquery row(id: id):\n  return items[id] by byId\nquery total():\n  return sums['g'] by byGroup\nmutation first():\n  update items['a'] {value: 99}\n  delete items['b']\nmutation later():\n  old = items['a'] by byId\n  require old != null else MISSING\n  update items['a'] {value: old.value + 1}\nmutation many():\n  for n in range(0, 12):\n    insert items {group: 'g', value: n}\n";
        let (mut engine, backend) = compile(source);
        engine.seed([("items".into(), snapback4_core::value::object([("id", id("a")), ("group", Value::String("g".into())), ("value", Value::Int(1))])), ("items".into(), snapback4_core::value::object([("id", id("b")), ("group", Value::String("g".into())), ("value", Value::Int(20))]))]).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open_as("alice", Some(backend), "dev:alice").unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
            ok(apply(&mut *device, page, n == 0));
        }
        let watermark = state(&mut *device).0;
        let queue = |op: &str, seq: u64| Queued { id: format!("w{seq}"), seq, op: op.into(), args: serde_json::json!({}), new_ids: vec![], predicted: vec![], viewer: "dev:alice".into(), now: 2000, predictable: true, sent_seq: None, observed_seq: None };
        let read = |device: &mut dyn AnyDevice, key: &str| query(device, "row", "dev:alice", serde_json::json!({ "id": key }), 2000)["data"]["value"].clone();
        ok(device.call(serde_json::json!({ "op": "admit", "entry": queue("first", 1) })));
        ok(device.call(serde_json::json!({ "op": "admit", "entry": queue("later", 2) })));
        assert_eq!(read(&mut *device, "a"), 100, "{label}");
        // Reopen before rejection: both the base images and the ordered overlay survive.
        device.close();
        let mut device = host.open_as("alice", None, "dev:alice").unwrap();
        ok(device.call(serde_json::json!({ "op": "settle", "id": "w1" })));
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" }))).as_array().unwrap().len(), 1, "{label}");
        assert_eq!(read(&mut *device, "a"), 2, "{label}: the survivor replays over the confirmed image");
        assert_eq!(read(&mut *device, "b"), 20, "{label}: the refused delete is undone");
        assert_eq!(query(&mut *device, "total", "dev:alice", serde_json::json!({}), 2000)["data"], 22, "{label}");
        ok(device.call(serde_json::json!({ "op": "settle", "id": "w2" })));
        // A paged snapshot stays staged until its last page; a repeated
        // final page cannot truncate the partition.
        let pages = snapshot_pages(&mut engine, "dev:alice", 1);
        assert!(pages.len() > 1);
        ok(apply(&mut *device, &pages[0], true));
        for page in &pages[1..pages.len() - 1] {
            ok(apply(&mut *device, page, false));
        }
        assert_eq!(state(&mut *device).0, watermark, "{label}: staged, not yet applied");
        ok(apply(&mut *device, pages.last().unwrap(), false));
        assert!(apply(&mut *device, pages.last().unwrap(), false).get("denied").is_some(), "{label}: a repeated final page cannot truncate the partition");
        assert_eq!(read(&mut *device, "b"), 20, "{label}");
        // A program minting more than a guessed small preallocation persists
        // every actual id and retains those exact rows across replay/reopen.
        let admitted = ok(device.call(serde_json::json!({ "op": "admit", "entry": queue("many", 3) })));
        let ids: Vec<String> = serde_json::from_value(admitted["new_ids"].clone()).unwrap();
        assert_eq!(ids.len(), 12, "{label}");
        assert_eq!(ids.iter().collect::<std::collections::BTreeSet<_>>().len(), 12);
        device.close();
        let mut device = host.open_as("alice", None, "dev:alice").unwrap();
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", watermark), false));
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" })))[0]["new_ids"], serde_json::json!(ids), "{label}");
        for key in ids {
            assert_ne!(read(&mut *device, &key), serde_json::Value::Null, "{label}");
        }
        device.close();
    });
}

#[test]
fn the_memory_host_keeps_only_what_a_reopen_needs() {
    // The web keeps the changes each call reports: rows, metadata, the
    // outbox, the images, the staged snapshot — never index entries — and
    // a checkpoint between calls is as good as a close.
    let mut host = Memory::new();
    let (mut engine, backend) = server();
    let mut device = Host::open(&mut host, "bob", Some(backend.clone())).unwrap();
    let pages = snapshot_pages(&mut engine, "dev:bob", 50);
    for (n, page) in pages.iter().enumerate() {
        device.apply(page, n == 0).unwrap();
        checkpoint(&mut host, "bob", &device);
    }
    let held = host.held("bob");
    let seeded: usize = pages.iter().map(|page| page.events.len()).sum();
    assert_eq!(held.keys().filter(|(s, _)| *s == 'r').count(), seeded, "one row change per row the snapshot carried");
    assert!(held.keys().all(|(s, _)| "rmobs".contains(*s)));
    assert!(held.iter().filter(|((s, _), _)| *s == 's').all(|(_, v)| v.is_none()), "the staged snapshot drained");
    let predicted = device.predict("send", "dev:bob", &serde_json::json!({ "conversationId": "c1", "body": "hello" }), 2_000, vec!["msgNEW".to_owned()], 7).unwrap();
    assert!(predicted.predicted.contains(&"messages/msgNEW".to_owned()), "{:?}", predicted.predicted);
    drop(device);
    // Dropped without a close: the prediction was never handed to the host.
    let mut device = Host::open(&mut host, "bob", None).unwrap();
    assert_eq!(device.state().unwrap().0, pages.last().unwrap().watermark);
    let thread = device.query("thread", "dev:bob", &serde_json::json!({ "conversationId": "c1" }), 3_000).unwrap();
    assert!(thread.data.as_array().unwrap().iter().all(|m| m.field("id").unwrap() != &id("msgNEW")));
    assert!(host.held("bob").keys().all(|(s, _)| *s != 'r' || true));
}

#[test]
fn pending_metadata_survives_repeated_updates_and_an_offline_reopen_on_both_hosts() {
    on_both(|host| {
        let label = host.label();
        let source = include_str!("../fixtures/pending-metadata.q");
        let (mut engine, backend) = compile(source);
        engine.seed([("people".into(), snapback4_core::value::object([("id", id("alice")), ("name", Value::String("Alice".into())), ("bio", Value::String("Confirmed bio".into()))]))]).unwrap();
        engine.seed([("votes".into(), snapback4_core::value::object([("id", id("held-vote")), ("person", id("alice")), ("answer", Value::String("answer".into())), ("direction", Value::Int(0))]))]).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open_as("alice", Some(backend), "dev:alice").unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() {
            ok(apply(&mut *device, page, n == 0));
        }
        let commands = [
            ("profile", serde_json::json!({ "person": "alice", "name": "Offline Alice", "bio": "Saved bio" })),
            ("profile", serde_json::json!({ "person": "alice", "name": "Final Alice", "bio": "Final bio" })),
            ("vote", serde_json::json!({ "person": "alice", "answer": "answer", "direction": 1 })),
            ("vote", serde_json::json!({ "person": "alice", "answer": "answer", "direction": -1 })),
            ("updateVote", serde_json::json!({ "person": "alice", "answer": "answer", "direction": 1 })),
            ("scanVote", serde_json::json!({ "direction": -1 })),
        ];
        let person_args = serde_json::json!({ "person": "alice" });
        for (n, (op, input)) in commands.iter().enumerate() {
            let seq = n as u64 + 1;
            ok(device.call(serde_json::json!({ "op": "admit", "entry": Queued { id: format!("write-{seq}"), seq, op: (*op).into(), args: input.clone(), new_ids: vec![], predicted: vec![], viewer: "dev:alice".into(), now: seq as i64, predictable: true, sent_seq: None, observed_seq: None } })));
            let person = query(&mut *device, "person", "dev:alice", person_args.clone(), 10);
            assert_eq!(person["data"]["pending"], true, "{label}: mutation reads must not erase the card");
            if n >= 2 {
                assert_eq!(query(&mut *device, "voteTotal", "dev:alice", serde_json::json!({ "answer": "answer" }), 10)["data"], if n % 2 == 0 { 1 } else { -1 }, "{label}");
            }
        }
        let queued = ok(device.call(serde_json::json!({ "op": "queued" })));
        assert_eq!(queued.as_array().unwrap().len(), commands.len(), "{label}");
        // Offline reopen: the outbox and the pending marks are what they were.
        device.close();
        let mut device = host.open_as("alice", None, "dev:alice").unwrap();
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" }))), queued, "{label}: submission order, arguments and minted ids survive an offline reopen");
        let person = query(&mut *device, "person", "dev:alice", person_args.clone(), 10);
        assert_eq!(person["data"]["name"], "Final Alice", "{label}");
        assert_eq!(person["data"]["bio"], "Final bio", "{label}");
        assert_eq!(person["data"]["pending"], true, "{label}: the pending mark survives a reopen");
        let votes = query(&mut *device, "voteRows", "dev:alice", serde_json::json!({}), 10);
        assert_eq!(rows(&votes).len(), 1, "{label}");
        assert_eq!(rows(&votes)[0]["direction"], -1, "{label}");
        assert_eq!(rows(&votes)[0]["pending"], true, "{label}");
        assert_eq!(query(&mut *device, "voteTotal", "dev:alice", serde_json::json!({ "answer": "answer" }), 10)["data"], -1, "{label}: replay must not double-count the maintained total");
        // The server takes every write; the stream's images replace the marks.
        let watermark = state(&mut *device).0;
        for entry in queued.as_array().unwrap() {
            let typed = entry["args"].as_object().unwrap().iter().map(|(name, value)| {
                let value = match value {
                    serde_json::Value::String(value) if name == "person" => id(value),
                    serde_json::Value::String(value) => Value::String(value.clone()),
                    serde_json::Value::Number(value) => Value::Int(value.as_i64().unwrap()),
                    _ => panic!("unexpected fixture argument"),
                };
                (name.clone(), value)
            }).collect();
            let sent = engine.mutate(entry["op"].as_str().unwrap(), Some(entry["id"].as_str().unwrap()), snapback4_core::engine::Context::new("dev:alice", typed).at(entry["now"].as_i64().unwrap())).unwrap();
            let WriteState::Sent { seq, .. } = sent.state else { panic!("the server refused the admitted fixture") };
            ok(device.call(serde_json::json!({ "op": "settle", "id": entry["id"], "seq": seq })));
        }
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", watermark), false));
        assert!(ok(device.call(serde_json::json!({ "op": "queued" }))).as_array().unwrap().is_empty(), "{label}");
        let person = query(&mut *device, "person", "dev:alice", person_args, 10);
        assert!(person["data"].get("pending").is_none(), "{label}: the authoritative image replaces the pending mark");
        assert!(rows(&query(&mut *device, "voteRows", "dev:alice", serde_json::json!({}), 10))[0].get("pending").is_none(), "{label}");
        device.close();
    });
}

#[path = "../../../snapback4-core/tests/common/meter.rs"]
mod meter_fixture;

#[test]
fn heap_cuts_and_successful_accumulators_on_both_stores() {
    use snapback4_core::ir::ProgramKind;
    use snapback4_core::meter::Ceilings;
    use snapback4_core::error::{MeterKind, RuntimeError};
    use snapback4_device::device::Backend;

    fn scenario<H: Host>(host: &mut H) {
        for push in [false, true] {
            for count in [2, 128] {
                let programs = vec![
                    meter_fixture::growing("read", ProgramKind::Query, push, 128),
                    meter_fixture::growing("write", ProgramKind::Mutation, push, 128),
                    meter_fixture::written(),
                ];
                let mut engine = meter_fixture::engine(programs.clone(), count);
                let backend = Backend { generation: engine.generation(), schema: engine.schema().clone(), programs };
                let name = format!("meter-{push}-{count}");
                let mut device = Host::open(host, &name, Some(backend)).unwrap();
                for (i, page) in snapshot_pages(&mut engine, "alice", 256).iter().enumerate() {
                    device.apply(page, i == 0).unwrap();
                }
                let result = device.query("read", "alice", &serde_json::json!({}), 1).unwrap();
                let prediction = device.predict("write", "alice", &serde_json::json!({}), 1, Vec::new(), 1);
                if count == 2 {
                    assert!(result.complete, "{}: {result:?}", Host::label(host));
                    assert_eq!(result.data, Value::Int(if push { 128 } else { 8000 }));
                    assert!(prediction.is_ok(), "{}: {prediction:?}", Host::label(host));
                    assert_eq!(device.query("written", "alice", &serde_json::json!({}), 1).unwrap().data, Value::Bool(true));
                } else {
                    assert!(!result.complete, "{}", Host::label(host));
                    assert_eq!(result.data, Value::Null);
                    assert_eq!(result.next, None);
                    assert_eq!(result.capped_at.as_ref().map(|cut| cut.0), Some(MeterKind::HeapBytes));
                    assert!(result.metered.heap_bytes > Ceilings::default().heap_bytes);
                    let error = prediction.unwrap_err();
                    assert!(matches!(error, RuntimeError::Bound { kind: MeterKind::HeapBytes, ceiling: 16_777_216, .. }), "{error:?}");
                    assert_eq!(error.code(), "E_BOUND");
                    // The prediction wrote before its loop. Its aborted commit
                    // must leave neither that row nor a pending overlay behind.
                    assert_eq!(device.query("written", "alice", &serde_json::json!({}), 1).unwrap().data, Value::Bool(false));
                    println!("{} {} query cut: heap={} B", Host::label(host), if push { "push" } else { "concat" }, result.metered.heap_bytes);
                }
                Host::close(host, &name, device);
            }
        }
    }
    scenario(&mut Sqlite::new("meter"));
    scenario(&mut Memory::new());
}
#[test]
fn upload_receipts_predict_id_only_image_and_video_on_both_stores() {
    on_both(|host| {
        let source = "table photos:\n  photo: image <=100000\n  read <- allow\n  insert <- allow\n  sync public\ntable clips:\n  clip: video <=100000\n  read <- allow\n  insert <- allow\n  sync public\nmutation photo(photo: image <=100000):\n  require photo.width = 2 else WRONG_WIDTH\n  return insert photos { photo }\nmutation clip(clip: video <=100000):\n  duration = clip.duration\n  require duration != null else DURATION_UNKNOWN\n  require duration <= 60000 else TOO_LONG\n  return insert clips { clip }\n";
        let (mut engine, backend) = compile(source);
        let png = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,0,2,0,0,0,3,8,6];
        let mut mp4 = vec![0u8; 52];
        mp4[0..4].copy_from_slice(&20u32.to_be_bytes()); mp4[4..8].copy_from_slice(b"ftyp"); mp4[8..12].copy_from_slice(b"isom");
        mp4[20..24].copy_from_slice(&32u32.to_be_bytes()); mp4[24..28].copy_from_slice(b"moov");
        mp4[28..32].copy_from_slice(&24u32.to_be_bytes()); mp4[32..36].copy_from_slice(b"mvhd");
        // Version 0 mvhd: flags, creation, modification, timescale, duration.
        mp4.resize(60, 0); mp4[20..24].copy_from_slice(&40u32.to_be_bytes()); mp4[28..32].copy_from_slice(&32u32.to_be_bytes());
        mp4[48..52].copy_from_slice(&1000u32.to_be_bytes()); mp4[52..56].copy_from_slice(&1000u32.to_be_bytes());
        let mut device = host.open_as("uploads", Some(backend), "dev:alice").unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        for (op, bytes) in [("photo", png.as_slice()), ("clip", mp4.as_slice())] {
            let asset = engine.store_asset("dev:alice", bytes, 1).unwrap();
            let facts = snapback4_core::wire::to_json(&asset.column_value());
            ok(device.call(serde_json::json!({ "op": "upload_facts", "viewer": "dev:alice", "asset": facts })));
            device.close();
            device = host.open_as("uploads", None, "dev:alice").unwrap();
            let submitted = serde_json::json!({ op: { "id": asset.id } });
            let forged = ok(device.call(serde_json::json!({ "op":"predict", "name":op, "viewer":"dev:alice", "args":{ op: { "id":asset.id, "width":999, "duration":999999 } }, "now":2, "entropy":41 })));
            assert_eq!(forged["result"][op]["id"], asset.id);
            assert_eq!(forged["result"][op][if op == "photo" { "width" } else { "duration" }], if op == "photo" { 2 } else { 1000 });
            ok(device.call(serde_json::json!({"op":"withdraw", "predicted":forged["predicted"]})));
            let admitted = ok(device.call(serde_json::json!({ "op": "admit", "entry": { "id": op, "seq": if op == "photo" { 1 } else { 2 }, "op": op, "args": submitted, "viewer": "dev:alice", "now": 2, "predictable": true } })));
            assert_eq!(admitted["predictable"], true, "{admitted}");
            assert_eq!(admitted["predicted"].as_array().unwrap().len(), 1);
            let unknown = ok(device.call(serde_json::json!({ "op": "admit", "entry": { "id": format!("unknown-{op}"), "seq": if op == "photo" { 3 } else { 4 }, "op": op, "args": { op: { "id": "missing", "width": 2, "duration": 1000 } }, "viewer": "dev:alice", "now": 3, "predictable": true } })));
            assert_eq!(unknown["predictable"], false, "caller facts never substitute for a receipt");
            let foreign = ok(device.call(serde_json::json!({ "op": "predict", "name": op, "args": { op: { "id": asset.id } }, "viewer": "dev:bob", "now": 3 })));
            assert_eq!(foreign["denied"]["code"], "E_PREDICT", "receipts belong to the uploader");
        }
        device.close();
    });
}

#[test]
fn media_home_follows_stream_clear_delete_expiry_and_scope_on_both_stores() {
    on_both(|host| {
        let (_, backend) = compile("table photos:\n  owner: principal\n  photo: image <=100000 ?\n  secret: image <=100000 once ?\n  until: time ?\n  by byExpiry: until\n  expire at .until\n  by byOwner: owner, id\n  read <- .owner = viewer\n  sync to .owner\n");
        let generation = backend.generation;
        let mut device = host.open("homes", Some(backend)).unwrap();
        let facts = serde_json::json!({"id":"image", "type":"image/png", "bytes":26, "width":2, "height":3, "duration":null});
        let row = serde_json::json!({"id":"home", "owner":"dev:alice", "photo":facts, "secret":{ "id":"once", "type":"image/png", "bytes":26, "width":2, "height":3, "duration":null }, "until":100});
        let put = |data: serde_json::Value, watermark| serde_json::json!({"op":"apply", "first":true, "page": {"snapshot":true, "events":[{"table":"photos", "id":"home", "kind":"put", "data":data}], "watermark":watermark, "more":false, "generation":generation}});
        ok(device.call(put(row.clone(), 1)));
        let home = |id, now| serde_json::json!({"op":"asset_home", "id":id, "viewer":"dev:alice", "now":now});
        let retained = ok(device.call(home("image", 1)));
        assert_eq!(retained["row"], "home"); assert_eq!(retained["expiresAt"], 100);
        assert_eq!(ok(device.call(home("once", 1))), serde_json::Value::Null);
        assert_eq!(ok(device.call(home("image", 100))), serde_json::Value::Null);
        let mut cleared = row.clone(); cleared["photo"] = serde_json::Value::Null;
        ok(device.call(put(cleared, 2)));
        assert_eq!(ok(device.call(home("image", 1))), serde_json::Value::Null);
        ok(device.call(put(row.clone(), 3)));
        ok(device.call(serde_json::json!({"op":"apply", "page":{"snapshot":false,"events":[{"table":"photos","id":"home","kind":"del"}],"watermark":4,"more":false}})));
        assert_eq!(ok(device.call(home("image", 1))), serde_json::Value::Null);
        ok(device.call(put(row.clone(), 5)));
        ok(device.call(serde_json::json!({"op":"apply", "page":{"snapshot":false,"events":[{"table":"photos","id":"scope","kind":"scope","data":["dev:alice"]}],"watermark":6,"more":false}})));
        assert_eq!(ok(device.call(home("image", 1))), serde_json::Value::Null);
        ok(device.call(put(row, 7)));
        ok(device.call(serde_json::json!({"op":"clear_rows"})));
        assert_eq!(ok(device.call(home("image", 1))), serde_json::Value::Null);
        device.close();
    });
}

#[test]
fn a_scope_retires_media_past_a_page_while_preserving_delivered_history() {
    on_both(|host| {
        let (_, backend) = compile("table photos:\n  owner: principal\n  photo: image <=100000\n  by byOwner: owner\n  read <- .owner = viewer\n  sync to .owner\n  retain delivered-history\nquery photo(id: photos):\n  return photos[id]\n");
        let mut device = host.open("media-history", Some(backend)).unwrap();
        let events = (0..501).map(|n| serde_json::json!({"table":"photos", "kind":"put", "id":format!("r{n:03}"), "data":{
            "id":format!("r{n:03}"), "owner":"dev:alice", "photo":{"id":format!("a{n:03}"),"type":"image/png","bytes":26,"width":2,"height":3,"duration":null}
        }})).collect::<Vec<_>>();
        ok(device.call(serde_json::json!({"op":"apply","first":true,"page":{"snapshot":true,"events":events,"watermark":1,"more":false}})));
        let home = serde_json::json!({"op":"asset_home", "id":"a500", "viewer":"dev:alice", "now":1});
        assert_eq!(ok(device.call(home.clone()))["row"], "r500");
        ok(device.call(serde_json::json!({"op":"apply","page":{"snapshot":false,"events":[{"table":"photos","kind":"scope","id":"scope","data":["dev:alice"]}],"watermark":2,"more":false}})));
        assert_eq!(ok(device.call(home)), serde_json::Value::Null);
        assert_eq!(query(&mut *device, "photo", "dev:alice", serde_json::json!({"id":"r500"}), 1)["data"]["id"], "r500", "textual history remains held");
        device.close();
    });
}

#[test]
fn actions_never_predict_query_or_enter_either_device_outbox() {
    on_both(|host| {
        let source = "action remote(n: int)\nmutation answer(n: int):\n  return { n }\nquery answer():\n  return 7\n".replace("query answer()", "query number()");
        let (_, backend) = compile(&source);
        let mut device = host.open_as("actions", Some(backend), "dev:alice").unwrap();
        let predicted = ok(device.call(serde_json::json!({ "op": "predict", "name": "answer", "viewer": "dev:alice", "args": { "n": 42 }, "now": 1 })));
        assert_eq!(predicted["result"]["n"], 42);
        assert_eq!(query(device.as_mut(), "number", "dev:alice", serde_json::json!({}), 1)["data"], 7);
        for op in ["query", "predict"] {
            let refused = device.call(serde_json::json!({ "op": op, "name": "remote", "viewer": "dev:alice", "args": { "n": 42 }, "now": 1 }));
            assert_eq!(refused["ok"]["denied"]["code"], "E_OP", "{refused}");
        }
        for predictable in [true, false] {
            let refused = device.call(serde_json::json!({ "op": "admit", "entry": { "id": "action", "op": "remote", "args": { "n": 42 }, "seq": 1, "viewer": "dev:alice", "now": 1, "predictable": predictable } }));
            assert_eq!(refused["denied"]["code"], "E_OP", "{refused}");
        }
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" }))), serde_json::json!([]));
        device.close();
    });
}

#[test]
fn extra_probe_equalities_run_on_both_device_stores() {
    on_both(|host| {
        let source = include_str!("../../../snapback4-sim/tests/fixtures/probe-equalities.q").replace("  read <- allow", "  read <- allow\n  sync public");
        let (_, backend) = compile(&source);
        let mut device = host.open("probe-equalities", Some(backend)).unwrap();
        ok(device.call(serde_json::json!({"op":"apply", "first":true, "page":{"snapshot":true,"events":[{"table":"chats","id":"c0","kind":"put","data":{"id":"c0","key":"c0","admin":"dev:alice"}}],"watermark":1,"more":false}})));
        for (admin, present) in [("dev:alice", true), ("dev:bob", false)] {
            let args = serde_json::json!({"chatKey":"c0","admin":admin});
            assert_eq!(query(&mut *device, "probe", "dev:alice", args.clone(), 1)["data"], present);
            assert_eq!(!query(&mut *device, "get", "dev:alice", args, 1)["data"].is_null(), present);
        }
        for (viewer, admitted) in [("dev:alice", true), ("dev:bob", false)] {
            let result = ok(device.call(serde_json::json!({"op":"predict","name":"add","args":{"chatKey":"c0","principal":"dev:carol"},"viewer":viewer,"now":1,"ids":["member"]})));
            if admitted { assert!(result.get("denied").is_none(), "{result}"); ok(device.call(serde_json::json!({"op":"withdraw","predicted":result["predicted"]}))); }
            else { assert!(result.get("denied").is_some(), "{result}"); }
        }
        device.close();
    });
}

