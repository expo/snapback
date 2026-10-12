//! RP: settled maintained counts beside pending receipt history, on both hosts.
// @ref LLP 3000.022#14.3 — exclude predicted maintenance and retain static readers.
use super::*;

#[path = "prediction_round1.rs"]
mod round1;
#[path = "prediction_round2.rs"]
mod round2;
#[path = "prediction_round3.rs"]
mod round3;
#[path = "prediction_round6.rs"]
mod round6;

fn fixture(expiring: bool) -> String {
    let mut src = source().replace("mutation createConversation(", "mutation createGroup(").replace("mutation add(", "mutation addMember(").replace("  text: text <=2000", "  tombstone: bool default false\n  text: text <=2000")
        .replace("  retain delivered-history\n  sync to members[.conversation] last 500", "  update <- .sender = viewer\n  delete <- .sender = viewer\n  retain delivered-history\n  sync to members[.conversation] last 500");
    if expiring {
        src = src.replace(
            "  tombstone: bool default false",
            "  expiresAt: time ?\n  expire at .expiresAt\n  tombstone: bool default false",
        );
    }
    src + r#"
view unreadCounts: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal
    and .sender != m.principal and not .tombstone
query badge(member: members, conversation: conversations):
  return unreadCounts where .conversation = conversation and .member = member first 1 by .id { value, recountPending }
mutation sendMedia(conversation: conversations, text: text <=2000, photo: image <=5000000 ?):
  require conversations[conversation].title != 'closed' else CLOSED
  insert messages { conversation, sender: viewer, text, photo, at: now }
mutation close(conversation: conversations):
  update conversations[conversation] { title: 'closed' }
mutation edit(id: messages):
  update messages[id] { tombstone: true }
mutation remove(id: messages):
  delete messages[id]
mutation countWriter(conversation: conversations, member: members):
  insert messages { conversation, sender: viewer, text: 'dependent', photo: null, at: now }
  require (unreadCounts[member] ?? 0) > 0 else COUNT
"#
}

fn badge<S: DeviceStore>(d: &mut Device<S>, n: i64, pending: bool) {
    let a = d
        .query(
            "badge",
            "alice",
            &json!({"member":"b", "conversation":"c"}),
            NOW,
        )
        .unwrap();
    assert_eq!(
        a.data.as_array().unwrap()[0].field("value"),
        Ok(&Value::Int(n)),
        "{a:?}"
    );
    assert_eq!(
        a.data.as_array().unwrap()[0].field("recountPending"),
        Ok(&Value::Bool(pending)),
        "{a:?}"
    );
    assert_eq!(a.complete, !pending, "{a:?}");
}
fn history_pending<S: DeviceStore>(d: &mut Device<S>) -> Vec<Value> {
    let a = d
        .query(
            "history",
            "alice",
            &json!({"conversation":"c", "c":null}),
            NOW,
        )
        .unwrap();
    assert!(a.complete, "{a:?}");
    a.data
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m.field("pending") == Ok(&Value::Bool(true)))
        .cloned()
        .collect()
}
fn convergence<H: Host>(host: &mut H) {
    for expiring in [false, true] {
        let src = fixture(expiring);
        let b = bound(&src);
        for op in [
            "send",
            "sendMedia",
            "addMember",
            "createGroup",
            "edit",
            "remove",
        ] {
            assert_eq!(
                b.schema.operations[op].predicts.as_deref(),
                Some("eligible"),
                "{op}: {:?}",
                b.schema.operations[op]
            );
            assert!(!b.notes.iter().any(|n| n.code == "N_RECEIPT_PREDICTION"
                && n.message.starts_with(&format!("mutation {op} "))));
        }
        static_prediction::classified(
            &src,
            "countWriter",
            "selects unreadCounts by receipt-owned or derived key",
        );
        let (mut e, b) = compile(&src);
        seed(&mut e);
        send(&mut e, 1, NOW);
        let key = format!("rp-{expiring}");
        let second_key = format!("rp-second-{expiring}");
        let mut d = host.open(&key, Some(b.clone())).unwrap();
        let mut other = host.open(&second_key, Some(b)).unwrap();
        publish(&mut e, &mut d, "alice");
        publish(&mut e, &mut other, "alice");
        badge(&mut d, 1, false);
        let base = d.store().raw_rows("unreadCounts");
        let mut queue = vec![];
        for n in 1..=3 {
            let mut q = queued("alice", n);
            if n == 2 {
                q.op = "sendMedia".into();
            }
            let q = d.admit(q).unwrap();
            assert!(q.predictable, "{q:?}");
            queue.push(q);
            assert_eq!(history_pending(&mut d).len(), n as usize);
            badge(&mut d, 1, true);
            assert_eq!(d.store().raw_rows("unreadCounts"), base);
        }
        let other_q = other.admit(queued("alice", 101)).unwrap();
        assert!(other_q.predictable);
        badge(&mut other, 1, true);
        host.close(&key, d);
        let mut d = host.open(&key, None).unwrap();
        assert_eq!(history_pending(&mut d).len(), 3);
        badge(&mut d, 1, true);
        let provisional = int(&history_pending(&mut d)[0], "ordinal");
        // A second device of the same principal wins the server's next ordinal.
        settle(&mut e, &mut other, &other_q);
        badge(&mut other, 2, false);
        for (i, q) in queue.iter().enumerate() {
            settle(&mut e, &mut d, q);
            badge(&mut d, 3 + i as i64, i != 2);
            assert_eq!(history_pending(&mut d).len(), 2 - i);
            assert_eq!(
                d.store().raw_rows("unreadCounts"),
                e.store().rows("unreadCounts").unwrap()
            );
        }
        let settled = e
            .store()
            .rows("messages")
            .unwrap()
            .into_iter()
            .find(|m| m.field("text") == Ok(&Value::String("alice1".into())))
            .unwrap();
        assert_ne!(int(&settled, "ordinal"), provisional);
        publish(&mut e, &mut other, "alice");
        badge(&mut other, 5, false);
        // An update and a deletion must retain the settled contribution, too.
        for (i, op) in ["edit", "remove"].iter().enumerate() {
            let q = d
                .admit(request(op, json!({"id":"m1"}), 20 + i as u64))
                .unwrap();
            assert!(q.predictable, "{q:?}");
            badge(&mut d, 5, true);
            d.settle(&q.id, None).unwrap();
            badge(&mut d, 5, false);
        }
        let q = d
            .admit(request(
                "sendMedia",
                json!({"conversation":"c","text":"refused","photo":null}),
                30,
            ))
            .unwrap();
        assert!(q.predictable);
        badge(&mut d, 5, true);
        sent(mutate(
            &mut e,
            "alice",
            "close",
            &[("conversation", id("c"))],
            NOW,
        ));
        let outcome = e
            .mutate(
                &q.op,
                Some(&q.id),
                ctx(
                    "alice",
                    &[
                        ("conversation", id("c")),
                        ("text", Value::String("refused".into())),
                        ("photo", Value::Null),
                    ],
                    NOW,
                )
                .with_ids(q.new_ids.clone()),
            )
            .unwrap();
        assert!(
            matches!(outcome.state, WriteState::Failed { .. }),
            "{outcome:?}"
        );
        assert!(format!("{outcome:?}").contains("CLOSED"));
        d.settle(&q.id, None).unwrap();
        publish(&mut e, &mut d, "alice");
        badge(&mut d, 5, false);
        assert!(history_pending(&mut d).is_empty());
        assert_eq!(
            d.store().raw_rows("messages"),
            e.store()
                .rows("messages")
                .unwrap()
                .iter()
                .map(
                    |row| snapback4_core::schema::row_image(row, &e.schema().tables["messages"])
                        .into_owned()
                )
                .collect::<Vec<_>>()
        );
        let q = d
            .admit(request(
                "addMember",
                json!({"conversation":"c","principal":"carol"}),
                40,
            ))
            .unwrap();
        assert!(q.predictable, "{q:?}");
        badge(&mut d, 5, true);
        assert!(
            d.store()
                .raw_rows("members")
                .iter()
                .any(|r| r.field("pending") == Ok(&Value::Bool(true)))
        );
        assert_eq!(
            d.store().raw_rows("unreadCounts"),
            e.store().rows("unreadCounts").unwrap()
        );
        let new_member = d
            .store()
            .raw_rows("members")
            .into_iter()
            .find(|r| r.field("principal") == Ok(&id("carol")))
            .unwrap();
        let absent = d.query("badge", "alice", &json!({"member": new_member.field("id").unwrap().as_str().unwrap(), "conversation":"c"}), NOW).unwrap();
        assert!(absent.data.as_array().unwrap().is_empty(), "{absent:?}");
        assert!(!absent.complete, "{absent:?}");
        settle(&mut e, &mut d, &q);
        badge(&mut d, 5, false);
        let q = d
            .admit(request("createGroup", json!({"title":"new"}), 41))
            .unwrap();
        assert!(q.predictable, "{q:?}");
        assert!(
            d.store()
                .raw_rows("conversations")
                .iter()
                .any(|r| r.field("pending") == Ok(&Value::Bool(true)))
        );
        settle(&mut e, &mut d, &q);
    }
}
both!(
    derived_convergence_memory,
    derived_convergence_sqlite,
    convergence
);

#[test]
fn calibration_29_compiles_with_predicting_writers() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
        "../../../benchmarks/runs/2026-10-02-snapback4-clique-astra-0.4.11/astra/source/snapback",
    );
    let inputs: Vec<_> = ["schema.q", "windows.q"]
        .into_iter()
        .map(|name| {
            (
                name.into(),
                std::fs::read_to_string(root.join(name)).unwrap(),
            )
        })
        .collect();
    let b = snapback4_lang::compile(&inputs);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    for op in ["send", "sendMedia", "createGroup", "addMember"] {
        assert_eq!(
            b.schema.operations[op].predicts.as_deref(),
            Some("eligible"),
            "{op}: {:?}",
            b.schema.operations[op]
        );
        let why = snapback4_lang::bind::residency::operation_lines(op, &b.schema.operations[op]);
        assert!(why.contains("predicts: eligible"), "{why}");
        assert!(
            why.contains("unreadCounts stays settled during prediction"),
            "{why}"
        );
    }
}

#[test]
fn maintenance_refusals_stay_static_and_readers_cannot_consume_frozen_values() {
    let count = "\nview totals: count messages where .recipients > 0 by .conversation\n";
    for (suffix, reason) in [
        (
            "\nmutation guard(conversation: conversations):\n  require (totals[conversation] ?? 0) > 0 else CAP\n  insert messages { conversation, sender: viewer, text: 'x', photo: null, at: now }\n",
            "receipt-owned or derived key",
        ),
        (
            "\nmutation guard(conversation: conversations):\n  insert messages { conversation, sender: viewer, text: 'x', photo: null, at: now }\n  return totals[conversation]\n",
            "receipt-owned or derived key",
        ),
        (
            "\nmutation guard(conversation: conversations):\n  for m in messages where .conversation = conversation first 20 by .at:\n    require m.ordinal > 0 else POSITION\n",
            "messages.ordinal",
        ),
    ] {
        static_prediction::classified(&(fixture(false) + count + suffix), "guard", reason);
    }
    let cap = fixture(false).replace(
        "  unique byConversationOrdinal:",
        "  cap 1 by recipients\n  unique byConversationOrdinal:",
    );
    static_prediction::classified(&cap, "send", "messages.recipients");
    let mut b = bound(&(fixture(false) + count));
    b.schema
        .tables
        .get_mut("totals")
        .unwrap()
        .constraints
        .push(snapback4_core::schema::Constraint::Cap { by: vec![], max: 1 });
    let p = &b
        .programs
        .iter()
        .find(|p| p.program.name == "send")
        .unwrap()
        .program;
    let fact = snapback4_lang::bind::residency::execution(&b.schema, p);
    assert_eq!(fact.predicts.as_deref(), Some("never"));
    assert!(
        fact.sites
            .iter()
            .any(|s| s.reason.contains("has target constraints"))
    );
}

fn overflow<H: Host>(host: &mut H) {
    let src = fixture(false).replace(
        "  text: text <=2000",
        "  score: int default 9007199254740991\n  text: text <=2000",
    ) + "\nview scores: sum messages of .score where .recipients > 0 by .conversation\n";
    static_prediction::classified(&src, "send", "can overflow");
    let (mut e, b) = compile(&src);
    seed(&mut e);
    send(&mut e, 1, NOW);
    let mut d = host.open("rp-overflow", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = deferred(&mut d, queued("alice", 1));
    let result = e
        .mutate(
            &q.op,
            Some(&q.id),
            ctx(
                "alice",
                &[
                    ("conversation", id("c")),
                    ("text", Value::String("overflow".into())),
                    ("photo", Value::Null),
                ],
                NOW,
            )
            .with_ids(q.new_ids.clone()),
        )
        .unwrap();
    assert!(
        matches!(result.state, WriteState::Failed { .. }),
        "{result:?}"
    );
    assert!(format!("{result:?}").contains("E_OVERFLOW"), "{result:?}");
    d.settle(&q.id, None).unwrap();
    publish(&mut e, &mut d, "alice");
    assert_eq!(e.store().rows("messages").unwrap().len(), 1);
    assert_eq!(
        d.store().raw_rows("messages"),
        e.store()
            .rows("messages")
            .unwrap()
            .iter()
            .map(
                |row| snapback4_core::schema::row_image(row, &e.schema().tables["messages"])
                    .into_owned()
            )
            .collect::<Vec<_>>()
    );
}
both!(derived_overflow_memory, derived_overflow_sqlite, overflow);

#[test]
fn receipt_prediction_capability_is_required_on_the_wire() {
    let b = bound(&fixture(false));
    let encoded = serde_json::to_string(&b.schema.public_projection()).unwrap();
    assert!(encoded.contains("receipt-derived-prediction-v1"));
    let older = encoded.replace(
        "receipt-derived-prediction-v1",
        "receipt-derived-prediction-v0",
    );
    let error =
        snapback4_core::json_codec::from_text::<snapback4_core::Schema>(&older).unwrap_err();
    assert!(error.to_string().contains("E_SCHEMA_CAPABILITY"));
}

fn live_boundary<H: Host>(host: &mut H) {
    let src = fixture(true)
        + r#"
mutation expiringSend(conversation: conversations, until: time):
  insert messages { conversation, sender: viewer, text: 'expiry', photo: null, at: now, expiresAt: until }
view totals: count messages where .recipients > 0 by .conversation
query total(conversation: conversations):
  return totals[conversation]
"#;
    let (mut e, b) = compile(&src);
    seed(&mut e);
    sent(mutate(
        &mut e,
        "alice",
        "expiringSend",
        &[("conversation", id("c")), ("until", Value::Int(NOW + 1000))],
        NOW,
    ));
    let mut d = host.open("rp-expiry", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    badge(&mut d, 1, false);
    let q = d.admit(queued("alice", 1)).unwrap();
    assert!(q.predictable);
    // The last settled count may now be too large: it is not an L+ lower bound.
    let a = d
        .query(
            "badge",
            "alice",
            &json!({"member":"b", "conversation":"c"}),
            NOW + 2000,
        )
        .unwrap();
    assert!(!a.complete, "{a:?}");
    assert_eq!(
        a.data.as_array().unwrap()[0].field("value"),
        Ok(&Value::Int(1))
    );
    assert_eq!(
        a.data.as_array().unwrap()[0].field("recountPending"),
        Ok(&Value::Bool(true))
    );
    let total = d
        .query("total", "alice", &json!({"conversation":"c"}), NOW + 2000)
        .unwrap();
    assert!(!total.complete, "{total:?}");
    assert_eq!(total.data, Value::Int(1));
    d.settle(&q.id, None).unwrap();
    let a = d
        .query(
            "badge",
            "alice",
            &json!({"member":"b", "conversation":"c"}),
            NOW + 2000,
        )
        .unwrap();
    assert!(a.complete, "{a:?}");
    assert_eq!(
        a.data.as_array().unwrap()[0].field("value"),
        Ok(&Value::Int(0))
    );
    let total = d
        .query("total", "alice", &json!({"conversation":"c"}), NOW + 2000)
        .unwrap();
    // Ordinary expiring aggregates retain their horizon-dependent completeness.
    assert_eq!(total.data, Value::Int(0));
}
both!(
    derived_live_boundary_memory,
    derived_live_boundary_sqlite,
    live_boundary
);

fn inherited_count<H: Host>(host: &mut H) {
    let src = source()
        .replace("  read <- exists members[.id, viewer]", "  read <- allow")
        .replace("  sync to members[.id]", "  sync public")
        .replace(
            "  read <- exists members[.conversation, viewer]\n  insert <- .sender",
            "  read through .conversation\n  insert <- .sender",
        )
        .replace(
            "  sync to members[.conversation] last 500 by byConversationOrdinal",
            "  sync",
        )
        + r#"
view inheritedCounts: count messages where .ordinal > 0 by .conversation
  read <- allow
query inheritedCount(conversation: conversations):
  return inheritedCounts[conversation]
"#;
    for synthetic in [false, true] {
        let (mut e, mut b) = compile(&src);
        if synthetic {
            // Exercise the raw-schema parent-key form too: it has no synced total.
            let parent = b.schema.tables["messages"].through.clone();
            b.schema
                .maintains
                .iter_mut()
                .find(|m| m.target == "inheritedCounts")
                .unwrap()
                .parent_key = parent;
            let table = b.schema.tables.get_mut("inheritedCounts").unwrap();
            table.sync = None;
            table.rules.read = snapback4_core::schema::RuleExpr::Deny;
            e = Engine::memory(b.schema.clone(), b.programs.iter().cloned()).unwrap();
        }
        seed(&mut e);
        send(&mut e, 1, NOW);
        let mut d = host
            .open(&format!("rp-inherited-{synthetic}"), Some(b))
            .unwrap();
        publish(&mut e, &mut d, "alice");
        let before = d
            .query("inheritedCount", "alice", &json!({"conversation":"c"}), NOW)
            .unwrap();
        assert_eq!(before.data, Value::Int(1), "{before:?}");
        let q = d.admit(queued("alice", 1)).unwrap();
        assert!(q.predictable, "{q:?}");
        let pending = d
            .query("inheritedCount", "alice", &json!({"conversation":"c"}), NOW)
            .unwrap();
        assert!(!pending.complete, "{pending:?}");
        assert_eq!(
            pending.data,
            if synthetic {
                Value::Null
            } else {
                Value::Int(1)
            },
            "no settled cache means unavailable, never an invented zero: {pending:?}"
        );
        settle(&mut e, &mut d, &q);
        let after = d
            .query("inheritedCount", "alice", &json!({"conversation":"c"}), NOW)
            .unwrap();
        assert!(after.complete, "{after:?}");
        assert_eq!(after.data, Value::Int(2));
    }
}
both!(
    derived_inherited_count_memory,
    derived_inherited_count_sqlite,
    inherited_count
);

fn empty_identity<H: Host>(host: &mut H) {
    let src = fixture(true)
        + r#"
mutation sendNamed(conversation: conversations, id: id):
  insert messages { id, conversation, sender: viewer, text: 'named', photo: null, at: now }
"#;
    let (mut e, b) = compile(&src);
    seed(&mut e);
    send(&mut e, 1, NOW);
    let mut d = host.open("rp-empty-id", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = d
        .admit(request(
            "sendNamed",
            json!({"conversation":"c", "id":""}),
            1,
        ))
        .unwrap();
    assert!(q.predictable, "{q:?}");
    badge(&mut d, 1, true);
    settle(&mut e, &mut d, &q);
    badge(&mut d, 2, false);
    let q = d.admit(request("remove", json!({"id":""}), 2)).unwrap();
    assert!(q.predictable, "{q:?}");
    badge(&mut d, 2, true);
    settle(&mut e, &mut d, &q);
    badge(&mut d, 1, false);
}
both!(
    derived_empty_id_memory,
    derived_empty_id_sqlite,
    empty_identity
);
