//! Cross-product witnesses for storage custody, not a list of reader fixes.
// @ref LLP 3000.022#14.3 — a touched receipt family cannot cause device rejection.
use super::*;

fn complete_source() -> String {
    source().replace(
        "sync to members[.conversation] last 500 by byConversationOrdinal",
        "sync to members[.conversation]",
    )
}

fn generated_reads<H: Host>(host: &mut H) {
    // Each field/state is consumed in the same transaction and in a follow-up,
    // then passed through every read context below. Server truth is deliberately
    // different from the overlay. The same generated source runs on both stores.
    for field in [
        "counter",
        "ordinal",
        "recipients",
        "floor",
        "receipt",
        "delivered",
        "seen",
    ] {
        for reader in [
            "require",
            "rule",
            "probe",
            "lookup",
            "aggregate_filter",
            "aggregate_key",
            "after_insert",
            "builtin",
        ] {
            for split in [false, true] {
                eprintln!("READ {} {field} {reader} split={split}", host.label());
                let acquire = if split {
                    if field == "floor" {
                        "m = members[id = subject] ! else MISSING"
                    } else {
                        "m = messages[id = subject] ! else MISSING"
                    }
                } else if field == "floor" {
                    "m = insert members { conversation, principal: 'carol' }"
                } else {
                    "m = insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }"
                };
                let condition = match field {
                    "counter" => "(conversations[conversation] ! else MISSING).lastOrdinal > 0",
                    "ordinal" => "m.ordinal = 2",
                    "recipients" => "m.recipients = 1",
                    "floor" => "m.joinedOrdinal = 1",
                    "receipt" => "receipt(m) != null",
                    "delivered" => {
                        "(members[conversation, viewer] ! else MISSING).deliveredOrdinal = 1"
                    }
                    "seen" => "(members[conversation, viewer] ! else MISSING).seenOrdinal = 1",
                    _ => unreachable!(),
                };
                let rule = if reader == "probe" {
                    "exists permits[allowed = .passed]"
                } else {
                    ".passed"
                };
                let hook = if reader == "after_insert" {
                    "  after insert <- exists permits[allowed = .passed]\n"
                } else {
                    ""
                };
                let action = match reader {
                    "require" => "require good else ACCOUNTING",
                    "rule" | "probe" => {
                        "r = insert checks { conversation, passed: good }\n  update checks[r] { note: 'checked' }"
                    }
                    "lookup" => "p = permits[allowed = good] ! else ACCOUNTING",
                    "aggregate_filter" => {
                        "insert checks { conversation, passed: good }\n  require filtered[conversation] > 0 else ACCOUNTING"
                    }
                    "aggregate_key" => {
                        "insert checks { conversation, passed: good }\n  require keyed[true] > 0 else ACCOUNTING"
                    }
                    "after_insert" => "insert checks { conversation, passed: good }",
                    "builtin" => {
                        "require count(permits where .allowed = good first 1) > 0 else ACCOUNTING"
                    }
                    _ => unreachable!(),
                };
                let source = complete_source()
                    + &format!(
                        r#"
table permits:
  allowed: bool
  unique allowed
  public
  sync public
table checks:
  conversation: conversations
  passed: bool
  note: text <=20 ?
  public
  insert <- allow
  update <- {rule}
{hook}  sync public
view filtered: count checks where .passed by .conversation
view keyed: count checks by .passed
mutation caseWrite(conversation: conversations, subject: id):
  {acquire}
  good = {condition}
  {action}
"#
                    );
                let (mut e, b) = compile(&source);
                seed(&mut e);
                e.seed_at(
                    [(
                        "permits".into(),
                        object([("id", id("permit")), ("allowed", Value::Bool(true))]),
                    )],
                    NOW,
                )
                .unwrap();
                let key = format!("read-{field}-{reader}-{split}");
                let mut d = host.open(&key, Some(b)).unwrap();
                publish(&mut e, &mut d, "alice");
                if matches!(field, "ordinal" | "floor" | "delivered" | "seen") {
                    send(&mut e, 1, NOW);
                }
                if matches!(field, "delivered" | "seen") {
                    sent(mutate(
                        &mut e,
                        "alice",
                        "delivered",
                        &[
                            ("conversation", id("c")),
                            ("from", Value::Int(1)),
                            ("through", Value::Int(1)),
                        ],
                        NOW,
                    ));
                    sent(mutate(
                        &mut e,
                        "alice",
                        "seen",
                        &[("conversation", id("c")), ("through", Value::Int(1))],
                        NOW,
                    ));
                }
                let antecedent = split.then(|| {
                    let q = if field == "floor" {
                        request("add", json!({"conversation":"c","principal":"carol"}), 1)
                    } else {
                        queued("alice", 1)
                    };
                    let q = d.admit(q).unwrap();
                    assert!(q.predictable, "ordinary allocation must predict");
                    q
                });
                let q = deferred(
                    &mut d,
                    request(
                        "caseWrite",
                        json!({"conversation":"c","subject":antecedent.as_ref().map_or("unused", |q| q.new_ids[0].as_str())}),
                        2,
                    ),
                );
                assert!(d.store().raw_rows("checks").is_empty());
                host.close(&key, d);
                let mut d = host.open(&key, None).unwrap();
                assert_eq!(d.queued().unwrap().last().unwrap().id, q.id);
                assert!(!d.queued().unwrap().last().unwrap().predictable);
                if let Some(first) = antecedent {
                    settle(&mut e, &mut d, &first);
                }
                settle(&mut e, &mut d, &q);
                assert!(d.queued().unwrap().is_empty());
            }
        }
    }
}
both!(
    generated_reads_memory,
    generated_reads_sqlite,
    generated_reads
);

fn maintenance<H: Host>(host: &mut H) {
    // Real write-side predicate, key and contribution evaluation, including the
    // review's overflow. Neither overflow nor a constraint may discard send 2.
    for (label, view, hook) in [
        (
            "predicate",
            "view scored: sum messages of .score where .recipients = 0 by .conversation",
            "",
        ),
        (
            "key",
            "view scored: sum messages of .score by .conversation, .recipients",
            "",
        ),
        (
            "contribution",
            "view scored: sum messages of .recipients by .conversation",
            "  require scored[conversation] > 0 else ACCOUNTING",
        ),
    ] {
        eprintln!("MAINTENANCE {} {label}", host.label());
        let source = complete_source().replace(
            "  text: text <=2000",
            "  score: int default 9007199254740991\n  text: text <=2000",
        ) + &format!(
            r#"
{view}
mutation checkedSend(conversation: conversations):
  insert messages {{ conversation, sender: viewer, text: 'checked', photo: null, at: now }}
{hook}
"#
        );
        let (mut e, b) = compile(&source);
        seed(&mut e);
        let key = format!("maintenance-{label}");
        let mut d = host.open(&key, Some(b)).unwrap();
        publish(&mut e, &mut d, "alice");
        let first = d.admit(queued("alice", 1)).unwrap();
        assert!(first.predictable);
        // In the key case, send 1 has one recipient and send 2 has two at the
        // server, so their huge contributions enter different buckets. On the
        // device both guesses are zero, and the second would overflow.
        settle_server_only(&mut e, &first);
        if label == "key" {
            sent(mutate(
                &mut e,
                "alice",
                "add",
                &[("conversation", id("c")), ("principal", id("carol"))],
                NOW,
            ));
        }
        let second = deferred(
            &mut d,
            request("checkedSend", json!({"conversation":"c"}), 2),
        );
        assert_eq!(d.store().raw_rows("messages").len(), 1);
        host.close(&key, d);
        let mut d = host.open(&key, None).unwrap();
        settle(&mut e, &mut d, &first); // write-id replay
        settle(&mut e, &mut d, &second);
        assert_eq!(e.store().rows("messages").unwrap().len(), 2);
    }
}
fn settle_server_only(e: &mut Engine, q: &Queued) {
    let values = q
        .args
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                snapback4_core::wire::from_json(&e.program(&q.op).unwrap().args[k], v).unwrap(),
            )
        })
        .collect();
    let result = e
        .mutate(
            &q.op,
            Some(&q.id),
            Context::new(&q.viewer, values)
                .at(q.now)
                .with_ids(q.new_ids.clone()),
        )
        .unwrap();
    sent(result.state);
}
both!(
    generated_maintenance_memory,
    generated_maintenance_sqlite,
    maintenance
);

fn ordinal_targets<H: Host>(host: &mut H) {
    for address in ["direct", "aliased", "settled"] {
        for verb in ["delete", "update", "upsert"] {
            for split in [false, true] {
                for horizon in [false, true] {
                    for ordinal in [1, 2] {
                        if address == "settled" && split {
                            continue;
                        }
                        eprintln!(
                            "TARGET {} {address} {verb} split={split} horizon={horizon} ordinal={ordinal}",
                            host.label()
                        );
                        let insert = if split || address == "settled" {
                            ""
                        } else {
                            "  insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }\n"
                        };
                        let patch = if verb == "delete" {
                            ""
                        } else {
                            " { text: 'edited' }"
                        };
                        let selection = if address == "aliased" {
                            format!("  target = messages[conversation, {ordinal}] ! else MISSING\n")
                        } else {
                            String::new()
                        };
                        let target = if address == "aliased" {
                            "target".into()
                        } else {
                            format!("conversation, {ordinal}")
                        };
                        let base = if horizon { source() } else { complete_source() };
                        let source = base.replace("  immutable conversation, sender, ordinal, recipients, at", "  immutable conversation, sender, ordinal, recipients, at\n  update <- .sender = viewer\n  delete <- .sender = viewer") + &format!(r#"
mutation targetWrite(conversation: conversations):
{insert}{selection}  {verb} messages[{target}]{patch}
"#);
                        let (mut e, b) = compile(&source);
                        seed(&mut e);
                        let key = format!("target-{address}-{verb}-{split}-{horizon}-{ordinal}");
                        let mut d = host.open(&key, Some(b)).unwrap();
                        publish(&mut e, &mut d, "alice");
                        send(&mut e, 1, NOW); // hidden competitor at ordinal 1
                        if address == "settled" {
                            send(&mut e, 2, NOW);
                            publish(&mut e, &mut d, "alice");
                        }
                        let first = split.then(|| {
                            let q = d.admit(queued("alice", 1)).unwrap();
                            assert!(q.predictable);
                            q
                        });
                        let before = d.store().raw_rows("messages");
                        let q = deferred(
                            &mut d,
                            request("targetWrite", json!({"conversation":"c"}), 2),
                        );
                        assert_eq!(
                            d.store().raw_rows("messages"),
                            before,
                            "no false-success target changes"
                        );
                        host.close(&key, d);
                        let mut d = host.open(&key, None).unwrap();
                        if let Some(first) = first {
                            settle(&mut e, &mut d, &first);
                        }
                        settle(&mut e, &mut d, &q);
                        let rows = e.store().rows("messages").unwrap();
                        if verb == "delete" {
                            assert_eq!(rows.len(), 1);
                            assert_eq!(int(&rows[0], "ordinal"), 3 - ordinal);
                        } else {
                            assert_eq!(rows.len(), 2);
                            assert_eq!(
                                rows.iter()
                                    .find(|r| int(r, "ordinal") == ordinal)
                                    .unwrap()
                                    .field("text"),
                                Ok(&Value::String("edited".into()))
                            );
                            assert_ne!(
                                rows.iter()
                                    .find(|r| int(r, "ordinal") != ordinal)
                                    .unwrap()
                                    .field("text"),
                                Ok(&Value::String("edited".into()))
                            );
                        }
                    }
                }
            }
        }
    }
}
both!(
    generated_ordinal_targets_memory,
    generated_ordinal_targets_sqlite,
    ordinal_targets
);

fn touched_control<H: Host>(host: &mut H) {
    // Whole-row access is intentionally conservative even when later receipt
    // expressions are skipped. No-row-read short circuits are tested separately.
    let source = source()
        + r#"
mutation touched(message: messages):
  m = messages[message] ! else MISSING
  require true or receipt(m) != null else UNREACHABLE
  require false else TERMINAL
"#;
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("touched", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let first = d.admit(queued("alice", 1)).unwrap();
    let q = deferred(
        &mut d,
        request("touched", json!({"message":first.new_ids[0]}), 2),
    );
    settle(&mut e, &mut d, &first);
    let result = e
        .mutate(
            "touched",
            Some(&q.id),
            ctx("alice", &[("message", id(&first.new_ids[0]))], NOW),
        )
        .unwrap();
    assert!(
        matches!(result.state, WriteState::Failed { .. }),
        "{result:?}"
    );
    d.settle(&q.id, None).unwrap();
    assert!(d.queued().unwrap().is_empty());
}
both!(
    touched_refusal_memory,
    touched_refusal_sqlite,
    touched_control
);

fn other_owned_targets<H: Host>(host: &mut H) {
    for field in [
        "lastOrdinal",
        "recipients",
        "joinedOrdinal",
        "deliveredOrdinal",
        "seenOrdinal",
    ] {
        for verb in ["delete", "update", "upsert"] {
            eprintln!("OWNED TARGET {} {field} {verb}", host.label());
            let (table, declaration, address, patch) = match field {
                "lastOrdinal" => (
                    "conversations",
                    "  unique creatorId, lastOrdinal\n",
                    "creatorId = viewer, lastOrdinal = 0".into(),
                    " { title: 'edited' }",
                ),
                "recipients" => (
                    "messages",
                    "  unique conversation, sender, recipients\n",
                    "conversation = conversation, sender = viewer, recipients = 1".into(),
                    " { text: 'edited' }",
                ),
                _ => (
                    "members",
                    "  note: text <=20 ?\n",
                    format!("conversation = conversation, principal = viewer, {field} = 0"),
                    " { note: 'edited' }",
                ),
            };
            let mut source = complete_source().replace(
                &format!("table {table}:\n"),
                &format!("table {table}:\n{declaration}"),
            );
            if table == "members" {
                source = source.replace(
                    "  note: text <=20 ?\n",
                    &format!("  note: text <=20 ?\n  unique conversation, principal, {field}\n"),
                );
            }
            source = source.replace("  immutable conversation, sender, ordinal, recipients, at", "  immutable conversation, sender, ordinal, recipients, at\n  update <- .sender = viewer\n  delete <- .sender = viewer");
            let patch = if verb == "delete" { "" } else { patch };
            source += &format!(
                "\nmutation ownedTarget(conversation: conversations):\n  {verb} {table}[{address}]{patch}\n"
            );
            let (mut e, b) = compile(&source);
            seed(&mut e);
            let key = format!("owned-{field}-{verb}");
            let mut d = host.open(&key, Some(b)).unwrap();
            publish(&mut e, &mut d, "alice");
            let first = (table == "messages").then(|| {
                let q = d.admit(queued("alice", 1)).unwrap();
                assert!(q.predictable);
                q
            });
            let before = d.store().raw_rows(table);
            let q = deferred(
                &mut d,
                request("ownedTarget", json!({"conversation":"c"}), 2),
            );
            assert_eq!(d.store().raw_rows(table), before);
            host.close(&key, d);
            let mut d = host.open(&key, None).unwrap();
            if let Some(first) = first {
                settle(&mut e, &mut d, &first);
            }
            if table == "conversations" && verb == "delete" {
                let result = e
                    .mutate(
                        "ownedTarget",
                        Some(&q.id),
                        ctx("alice", &[("conversation", id("c"))], NOW),
                    )
                    .unwrap();
                assert!(matches!(result.state, WriteState::Failed { .. }));
                d.settle(&q.id, None).unwrap();
            } else {
                settle(&mut e, &mut d, &q);
            }
            assert!(d.queued().unwrap().is_empty());
        }
    }
}
both!(
    other_owned_targets_memory,
    other_owned_targets_sqlite,
    other_owned_targets
);
