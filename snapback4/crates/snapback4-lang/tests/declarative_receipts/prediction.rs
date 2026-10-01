//! Provisional positions never become receipt evidence on either device store.
use super::*;

fn read<S: DeviceStore>(d: &mut Device<S>, op: &str, who: &str) -> Value {
    let input = if op == "receiptMember" {
        json!({"conversation":"c"})
    } else {
        json!({"conversation":"c","c":null})
    };
    let answer = d.query(op, who, &input, NOW).unwrap();
    assert!(answer.complete, "{op}: {answer:?}");
    answer.data
}
fn pending_rows<S: DeviceStore>(d: &mut Device<S>, who: &str) -> Vec<Value> {
    read(d, "history", who)
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m.field("pending") == Ok(&Value::Bool(true)))
        .cloned()
        .collect()
}
fn no_pending_accounting<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, who: &str) {
    for op in ["receiptMember", "progress"] {
        let local = read(d, op, who);
        let values = if op == "receiptMember" {
            vec![("conversation", id("c"))]
        } else {
            vec![("conversation", id("c")), ("c", Value::Null)]
        };
        let server = e.query(op, ctx(who, &values, NOW)).unwrap().data;
        assert_eq!(local, server, "{op} cannot observe any overlay accounting");
    }
    let projected = read(d, "messageReceipts", who);
    let server = e
        .query(
            "messageReceipts",
            ctx(who, &[("conversation", id("c")), ("c", Value::Null)], NOW),
        )
        .unwrap()
        .data;
    let mut settled = vec![];
    for row in projected.as_array().unwrap() {
        if row.field("pending") == Ok(&Value::Bool(true)) {
            assert_eq!(row.field("receipt"), Ok(&Value::Null));
        } else {
            settled.push(row.clone());
        }
    }
    assert_eq!(Value::Array(settled), server);
    // Enumerate the actual SDK debt, including while provisional rows occupy
    // ordinals that another member subsequently receives on the server.
    let debt = d
        .delivery(&json!({"viewer":who,"action":"enumerate","now":NOW}))
        .unwrap();
    let high = e
        .store()
        .rows("messages")
        .unwrap()
        .iter()
        .map(|m| int(m, "ordinal"))
        .max()
        .unwrap_or(0);
    let text = debt["value"].as_str().unwrap();
    let state: serde_json::Value = serde_json::from_str(text).unwrap();
    for group in state["groups"].as_object().unwrap().values() {
        for run in group["owed"].as_array().unwrap() {
            assert!(
                run[1].as_i64().unwrap() <= high,
                "provisional delivery debt: {debt}"
            );
        }
    }
}
fn model<H: Host>(host: &mut H) {
    for seed_number in 1..=8 {
        let (mut e, b) = compile(&source());
        seed(&mut e);
        let mut d = host
            .open(&format!("pending{seed_number}"), Some(b))
            .unwrap();
        publish(&mut e, &mut d, "bob");
        let mut serial = 0;
        let mut rng = seed_number as u64;
        for step in 0..60 {
            rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1);
            let high = e.store().rows("messages").unwrap().len() as i64;
            match if step == 0 { 0 } else { (rng >> 32) % 5 } {
                0 => {
                    // Retain several offline predictions across publications.
                    if pending_rows(&mut d, "bob").len() < 4 {
                        serial += 1;
                        assert!(d.admit(queued("bob", serial)).unwrap().predictable);
                    }
                }
                1 if high < 10 => {
                    sent(mutate(
                        &mut e,
                        "alice",
                        "send",
                        &[
                            ("conversation", id("c")),
                            ("text", Value::String(format!("remote{step}"))),
                            ("photo", Value::Null),
                        ],
                        NOW,
                    ));
                    publish(&mut e, &mut d, "bob");
                }
                2 | 3 if high > 0 => {
                    let n = (rng % high as u64) as i64 + 1;
                    let delivery = step % 2 == 0;
                    let mut values = vec![("conversation", id("c")), ("through", Value::Int(n))];
                    if delivery {
                        values.push(("from", Value::Int(n)));
                    }
                    sent(mutate(
                        &mut e,
                        "bob",
                        if delivery { "delivered" } else { "seen" },
                        &values,
                        NOW,
                    ));
                    publish(&mut e, &mut d, "bob");
                }
                _ => {
                    // Even an explicit seen/delivery request at a provisional
                    // ordinal cannot write local progress, with full coverage.
                    if let Some(row) = pending_rows(&mut d, "bob").first() {
                        for op in ["seen", "delivered"] {
                            serial += 1;
                            let mut q = queued("bob", serial);
                            q.op = op.into();
                            q.args = if op == "seen" {
                                json!({"conversation":"c","through":int(row,"ordinal")})
                            } else {
                                json!({"conversation":"c","from":int(row,"ordinal"),"through":int(row,"ordinal")})
                            };
                            let id = q.id.clone();
                            assert!(!d.admit(q).unwrap().predictable);
                            d.settle(&id, None).unwrap();
                        }
                    }
                }
            }
            no_pending_accounting(&mut e, &mut d, "bob");
            let mut rows = pending_rows(&mut d, "bob");
            rows.sort_by_key(|m| int(m, "ordinal"));
            let queued = d.queued().unwrap();
            assert_eq!(rows.len(), queued.len());
            for (row, q) in rows.iter().zip(queued) {
                assert_eq!(row.field("text").unwrap().as_str().unwrap(), q.id);
                assert!(int(row, "ordinal") > e.store().rows("messages").unwrap().len() as i64);
                assert_eq!(int(row, "recipients"), 0);
            }
        }
    }
}
#[test]
fn provisional_accounting_model_memory() {
    model(&mut Memory::new());
}
#[test]
fn provisional_accounting_model_sqlite() {
    model(&mut Sqlite::new("ry-pending"));
}

fn refused<H: Host>(host: &mut H) {
    let (mut e, b) = compile(&source());
    seed(&mut e);
    let mut d = host.open("revoked", Some(b)).unwrap();
    publish(&mut e, &mut d, "bob");
    let q = d.admit(queued("bob", 1)).unwrap();
    assert!(q.predictable);
    assert_eq!(pending_rows(&mut d, "bob").len(), 1);
    no_pending_accounting(&mut e, &mut d, "bob");
    sent(mutate(
        &mut e,
        "bob",
        "leave",
        &[("conversation", id("c"))],
        NOW,
    ));
    let outcome = e
        .mutate(
            "send",
            Some(&q.id),
            ctx(
                "bob",
                &[
                    ("conversation", id("c")),
                    ("text", Value::String("refused".into())),
                    ("photo", Value::Null),
                ],
                NOW,
            )
            .with_ids(q.new_ids),
        )
        .unwrap();
    assert!(
        matches!(outcome.state, WriteState::Failed { .. }),
        "{:?}",
        outcome.state
    );
    d.settle(&q.id, None).unwrap();
    assert!(
        read(&mut d, "history", "bob")
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(e.store().rows("messages").unwrap().is_empty());
    assert!(e.store().rows("runs").unwrap().is_empty());
    assert_eq!(
        int(&e.store().rows("conversations").unwrap()[0], "lastOrdinal"),
        0
    );
    assert_eq!(int(&read(&mut d, "receiptMember", "bob"), "seenOrdinal"), 0);
    let debt = d
        .delivery(&json!({"viewer":"bob","action":"enumerate","now":NOW}))
        .unwrap();
    assert!(serde_json::from_str::<serde_json::Value>(debt["value"].as_str().unwrap()).unwrap()["groups"].as_object().unwrap().is_empty());
}
#[test]
fn refused_offline_send_memory() {
    refused(&mut Memory::new());
}
#[test]
fn refused_offline_send_sqlite() {
    refused(&mut Sqlite::new("ry-refused"));
}

fn creation<H: Host>(host: &mut H) {
    let (mut e, b) = compile(&source());
    seed(&mut e);
    let mut d = host.open("create", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let mut q = queued("alice", 1);
    q.op = "createConversation".into();
    q.args = json!({"title":"offline group"});
    q.new_ids = vec!["offline".into(), "founder".into()];
    assert!(d.admit(q).unwrap().predictable);
    let group = d
        .query(
            "conversationScreen",
            "alice",
            &json!({"conversation":"offline"}),
            NOW,
        )
        .unwrap();
    assert_eq!(group.data.field("pending"), Ok(&Value::Bool(true)));
    let inbox = d.query("inbox", "alice", &json!({"c":null}), NOW).unwrap();
    assert!(
        inbox
            .data
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m.field("conversation") == Ok(&id("offline")))
    );
    assert_eq!(
        d.query(
            "receiptMember",
            "alice",
            &json!({"conversation":"offline"}),
            NOW
        )
        .unwrap()
        .data,
        Value::Null
    );
    assert_eq!(
        d.query(
            "progress",
            "alice",
            &json!({"conversation":"offline","c":null}),
            NOW
        )
        .unwrap()
        .data,
        Value::Null
    );
    let mut q = queued("alice", 2);
    q.args["conversation"] = json!("offline");
    assert!(d.admit(q).unwrap().predictable);
    let rows = d
        .query(
            "history",
            "alice",
            &json!({"conversation":"offline","c":null}),
            NOW,
        )
        .unwrap();
    assert_eq!(rows.data.as_array().unwrap().len(), 1);
    assert_eq!(
        rows.data.as_array().unwrap()[0].field("pending"),
        Ok(&Value::Bool(true))
    );
    // A new recipient is visible as membership, but cannot change old receipts.
    let mut q = queued("alice", 3);
    q.op = "add".into();
    q.args = json!({"conversation":"c","principal":"carol"});
    assert!(d.admit(q).unwrap().predictable);
    no_pending_accounting(&mut e, &mut d, "alice");
}
#[test]
fn scope_and_join_predictions_memory() {
    creation(&mut Memory::new());
}
#[test]
fn scope_and_join_predictions_sqlite() {
    creation(&mut Sqlite::new("ry-create"));
}
