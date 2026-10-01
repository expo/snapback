//! RY round 4: successful accounting decisions are just as uncertain as refusals.
// @ref LLP 3000.022#14.3 — all authored receipt reads defer the whole mutation.
use super::*;

fn writable() -> String {
    complete_source().replace("  immutable conversation, sender, ordinal, recipients, at", "  cap 20 by conversation\n  by byConversationId: conversation, id\n  by bySender: conversation, sender\n  by byConversationAt: conversation, at\n  immutable conversation, sender, ordinal, recipients, at\n  update <- .sender = viewer\n  delete <- .sender = viewer")
}
fn horizon(src: String, index: &str) -> String {
    let at = src.find("table messages:").unwrap();
    let (before, messages) = src.split_at(at);
    before.to_owned()
        + &messages.replacen(
            "sync to members[.conversation]",
            &format!("sync to members[.conversation] last 500 by {index}"),
            1,
        )
}
fn same_rows<S: DeviceStore + BoundaryMetadata>(e: &mut Engine, d: &Device<S>, table: &str) {
    let mut server = e.store().rows(table).unwrap();
    let mut local = d.store().raw_rows(table);
    server.sort_by_key(|r| r.field("id").unwrap().as_str().unwrap().to_owned());
    local.sort_by_key(|r| r.field("id").unwrap().as_str().unwrap().to_owned());
    assert_eq!(local, server, "settled {table}");
}
fn selections<H: Host>(host: &mut H) {
    // True on the provisional row; on the server it names m1. Four distinct
    // ordered indexes include the review's .id spelling and non-receipt sender.
    for index in [
        "byConversationId",
        "bySender",
        "byConversationOrdinal",
        "byConversationAt",
    ] {
        for order in ["first", "last"] {
            for horizon in [false, true] {
                for verb in ["update", "delete"] {
                    for shape in ["if", "where"] {
                        for split in [false, true] {
                            let key =
                                format!("select-{index}-{order}-{horizon}-{verb}-{shape}-{split}");
                            eprintln!("ROUND4 {} {key}", host.label());
                            let mut src = writable();
                            if horizon {
                                src = self::horizon(src, index);
                            }
                            let prefix = if split {
                                ""
                            } else {
                                "  insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }\n"
                            };
                            let patch = if verb == "update" {
                                " { text: 'edited' }"
                            } else {
                                ""
                            };
                            let filter = if shape == "where" {
                                " and .ordinal = 1"
                            } else {
                                ""
                            };
                            let body = if shape == "if" {
                                format!("    if m.ordinal = 1:\n      {verb} messages[m]{patch}")
                            } else {
                                format!("    {verb} messages[m]{patch}")
                            };
                            let sort = if index == "byConversationId" {
                                ".id"
                            } else {
                                index
                            };
                            src += &format!(
                                "\nmutation selectTarget(conversation: conversations):\n{prefix}  for m in messages where .conversation = conversation{filter} {order} 20 by {sort}:\n{body}\n"
                            );
                            let (mut e, b) = compile(&src);
                            seed(&mut e);
                            let mut d = host.open(&key, Some(b)).unwrap();
                            publish(&mut e, &mut d, "alice");
                            send(&mut e, 1, NOW);
                            let first = split.then(|| {
                                let q = d.admit(queued("alice", 1)).unwrap();
                                assert!(q.predictable);
                                q
                            });
                            let before = d.store().raw_rows("messages");
                            let q = deferred(
                                &mut d,
                                request("selectTarget", json!({"conversation":"c"}), 2),
                            );
                            assert_eq!(d.store().raw_rows("messages"), before);
                            host.close(&key, d);
                            let mut d = host.open(&key, None).unwrap();
                            if let Some(first) = first {
                                settle(&mut e, &mut d, &first);
                            }
                            settle(&mut e, &mut d, &q);
                            let rows = e.store().rows("messages").unwrap();
                            assert_eq!(rows.len(), if verb == "delete" { 1 } else { 2 });
                            assert_eq!(
                                rows.iter()
                                    .find(|r| int(r, "ordinal") == 2)
                                    .unwrap()
                                    .field("text")
                                    .unwrap()
                                    .as_str()
                                    .unwrap(),
                                if split { "alice1" } else { "checked" }
                            );
                            if verb == "update" {
                                assert_eq!(
                                    rows.iter()
                                        .find(|r| int(r, "ordinal") == 1)
                                        .unwrap()
                                        .field("text"),
                                    Ok(&Value::String("edited".into()))
                                );
                            }
                            same_rows(&mut e, &d, "messages");
                            assert!(d.queued().unwrap().is_empty());
                        }
                    }
                }
            }
        }
    }
}
both!(generated_loops_memory, generated_loops_sqlite, selections);

fn aliases<H: Host>(host: &mut H) {
    for ordinal in [1, 2] {
        for horizon in [false, true] {
            for split in [false, true] {
                let mut src = writable();
                if horizon {
                    src = self::horizon(src, "byConversationOrdinal");
                }
                let insert = if split {
                    ""
                } else {
                    "  m = insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }\n"
                };
                let subject = if split { "subject" } else { "m.id" };
                src += &format!(
                    "\nmutation aliasTarget(conversation: conversations, subject: messages):\n{insert}  target = messages[id = {subject}, ordinal = {ordinal}] ! else MISSING\n  update messages[target] {{ text: 'edited' }}\n"
                );
                let (mut e, b) = compile(&src);
                seed(&mut e);
                let key = format!("alias-{ordinal}-{horizon}-{split}");
                let mut d = host.open(&key, Some(b)).unwrap();
                publish(&mut e, &mut d, "alice");
                send(&mut e, 1, NOW);
                let first = split.then(|| {
                    let q = d.admit(queued("alice", 1)).unwrap();
                    assert!(q.predictable);
                    q
                });
                let before = d.store().raw_rows("messages");
                let q = deferred(
                    &mut d,
                    request(
                        "aliasTarget",
                        json!({"conversation":"c","subject":first.as_ref().map_or("unused",|q|q.new_ids[0].as_str())}),
                        2,
                    ),
                );
                assert_eq!(d.store().raw_rows("messages"), before);
                host.close(&key, d);
                let mut d = host.open(&key, None).unwrap();
                if let Some(first) = first {
                    settle(&mut e, &mut d, &first);
                }
                if ordinal == 2 {
                    settle(&mut e, &mut d, &q);
                } else {
                    let outcome = e
                        .mutate(&q.op, Some(&q.id), queued_context(&e, &q))
                        .unwrap();
                    assert!(
                        matches!(outcome.state,WriteState::Failed {ref why,..} if why.code=="MISSING"),
                        "{outcome:?}"
                    );
                    d.settle(&q.id, None).unwrap();
                    publish(&mut e, &mut d, "alice");
                }
                same_rows(&mut e, &d, "messages");
                assert!(d.queued().unwrap().is_empty());
            }
        }
    }
}
fn queued_context(e: &Engine, q: &Queued) -> Context {
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
    Context::new(&q.viewer, values)
        .at(q.now)
        .with_ids(q.new_ids.clone())
}
both!(generated_aliases_memory, generated_aliases_sqlite, aliases);

fn conditions<H: Host>(host: &mut H) {
    for ordinal in [1, 2] {
        let src = writable()
            + &format!(
                r#"
mutation conditionalEdit(message: messages):
  update messages[message] {{ text: 'edited' }} if .ordinal = {ordinal}
"#
            );
        let (mut e, b) = compile(&src);
        seed(&mut e);
        let key = format!("condition-{ordinal}");
        let mut d = host.open(&key, Some(b)).unwrap();
        publish(&mut e, &mut d, "alice");
        send(&mut e, 1, NOW);
        let first = d.admit(queued("alice", 1)).unwrap();
        assert!(first.predictable);
        let q = deferred(
            &mut d,
            request("conditionalEdit", json!({"message":first.new_ids[0]}), 2),
        );
        host.close(&key, d);
        let mut d = host.open(&key, None).unwrap();
        settle(&mut e, &mut d, &first);
        let out = e
            .mutate(&q.op, Some(&q.id), queued_context(&e, &q))
            .unwrap();
        if ordinal == 1 {
            assert!(
                matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_CONFLICT"),
                "{out:?}"
            );
            d.settle(&q.id, None).unwrap();
        } else {
            d.settle(&q.id, Some(seq(&out.state))).unwrap();
        }
        publish(&mut e, &mut d, "alice");
        same_rows(&mut e, &d, "messages");
        assert!(d.queued().unwrap().is_empty());
    }
}
both!(
    generated_conditions_memory,
    generated_conditions_sqlite,
    conditions
);

fn columns<H: Host>(host: &mut H) {
    for derivation in [
        "sum messages of .recipients by .shelf",
        "count messages where .recipients > 0 by .shelf",
    ] {
        for horizon in [false, true] {
            for passes_locally in [false, true] {
                for reader in ["require", "after_insert"] {
                    let src = if horizon { source() } else { complete_source() };
                    let src = src.replace(
                        "  text: text <=2000",
                        "  shelf: shelves ?\n  text: text <=2000",
                    ) + &format!(
                        r#"
table shelves:
  total: {derivation}
  note: text <=30 ?
  public
  update <- allow
  sync public
mutation shelfSend(conversation: conversations, shelf: shelves):
  insert messages {{ conversation, shelf, sender: viewer, text: 'hello', photo: null, at: now }}
mutation shelfFollowup(shelf: shelves):
  p = shelves[shelf] ! else MISSING
  good = p.total {comparison}
  {action}
  update shelves[p] {{ note: 'checked' }}
table checks:
  passed: bool
  public
  insert <- allow
  after insert <- exists permits[allowed = .passed]
  sync public
table permits:
  allowed: bool
  unique allowed
  public
  sync public
"#,
                        comparison = if passes_locally { ">= 0" } else { "> 0" },
                        action = if reader == "require" {
                            "require good else NEED_TOTAL"
                        } else {
                            "insert checks { passed: good }"
                        }
                    );
                    let (mut e, mut b) = compile(&src);
                    seed(&mut e);
                    e.seed_at([("shelves".into(), object([("id", id("s"))]))], NOW)
                        .unwrap();
                    e.seed_at(
                        [(
                            "permits".into(),
                            object([("id", id("permit")), ("allowed", Value::Bool(true))]),
                        )],
                        NOW,
                    )
                    .unwrap();
                    // Private derivations are absent in shipped device schemas.
                    b.schema = b.schema.public_projection();
                    b = snapback4_core::json_codec::from_text(&serde_json::to_string(&b).unwrap())
                        .unwrap();
                    assert!(b.schema.maintains.iter().all(|m| m.private.is_none()));
                    // Verify projected device metadata survives both the binder and wire decoder.
                    assert!(b.schema.receipt_dependencies["shelves"].contains("total"));
                    let key = format!("column-{derivation}-{horizon}-{passes_locally}-{reader}");
                    let mut d = host.open(&key, Some(b)).unwrap();
                    publish(&mut e, &mut d, "alice");
                    let first = d
                        .admit(request(
                            "shelfSend",
                            json!({"conversation":"c","shelf":"s"}),
                            1,
                        ))
                        .unwrap();
                    assert!(first.predictable);
                    let q = deferred(&mut d, request("shelfFollowup", json!({"shelf":"s"}), 2));
                    host.close(&key, d);
                    let mut d = host.open(&key, None).unwrap();
                    settle(&mut e, &mut d, &first);
                    settle(&mut e, &mut d, &q);
                    assert_eq!(int(&e.store().rows("shelves").unwrap()[0], "total"), 1);
                    same_rows(&mut e, &d, "shelves");
                    assert!(d.queued().unwrap().is_empty());
                }
            }
        }
    }
}
both!(generated_columns_memory, generated_columns_sqlite, columns);

fn hooks<H: Host>(host: &mut H) {
    // Hooks consume both true and false provisional values. No Get/scan in
    // the mutation body may accidentally supply the observation for these.
    for field in ["ordinal", "recipients"] {
        for local_match in [false, true] {
            let value = if field == "ordinal" {
                if local_match {
                    1
                } else {
                    2
                }
            } else {
                if local_match {
                    0
                } else {
                    1
                }
            };
            let src=writable().replace("  immutable conversation, sender, ordinal, recipients, at",&format!("  after insert <- exists permits[value = .{field}]\n  immutable conversation, sender, ordinal, recipients, at"))+r#"
table permits:
  value: int
  unique value
  public
  sync public
"#;
            let (mut e, b) = compile(&src);
            seed(&mut e);
            e.seed_at(
                [(
                    "permits".into(),
                    object([("id", id("permit")), ("value", Value::Int(value))]),
                )],
                NOW,
            )
            .unwrap();
            let key = format!("hook-{field}-{local_match}");
            let mut d = host.open(&key, Some(b)).unwrap();
            publish(&mut e, &mut d, "alice");
            // Administrative competing send bypasses the authored hook only to
            // establish the stale ordinal; all tested writes use normal mutation.
            e.seed_at(
                [(
                    "conversations".into(),
                    object([
                        ("id", id("c")),
                        ("creatorId", id("alice")),
                        ("lastOrdinal", Value::Int(1)),
                    ]),
                )],
                NOW,
            )
            .unwrap();
            let q = deferred(&mut d, queued("alice", 1));
            host.close(&key, d);
            let mut d = host.open(&key, None).unwrap();
            let out = e
                .mutate(&q.op, Some(&q.id), queued_context(&e, &q))
                .unwrap();
            if local_match {
                assert!(matches!(out.state, WriteState::Failed { .. }));
                d.settle(&q.id, None).unwrap();
            } else {
                let n = seq(&out.state);
                d.settle(&q.id, Some(n)).unwrap();
            }
            publish(&mut e, &mut d, "alice");
            same_rows(&mut e, &d, "messages");
            assert!(d.queued().unwrap().is_empty());
        }
    }
}
both!(generated_hooks_memory, generated_hooks_sqlite, hooks);

fn whole_values<H: Host>(host: &mut H) {
    for expression in ["m = m", "[m] = [m]", "{ saved: m } = { saved: m }"] {
        let src = writable()
            + &format!(
                r#"
mutation compareSend(conversation: conversations):
  m = insert messages {{ conversation, sender: viewer, text: 'compared', photo: null, at: now }}
  require {expression} else IMPOSSIBLE
"#
            );
        let (mut e, b) = compile(&src);
        seed(&mut e);
        let key = format!("whole-{expression}");
        let mut d = host.open(&key, Some(b)).unwrap();
        publish(&mut e, &mut d, "alice");
        let q = deferred(
            &mut d,
            request("compareSend", json!({"conversation":"c"}), 1),
        );
        settle(&mut e, &mut d, &q);
        same_rows(&mut e, &d, "messages");
    }
}
both!(
    generated_whole_values_memory,
    generated_whole_values_sqlite,
    whole_values
);

fn ordinary<H: Host>(host: &mut H) {
    let src = writable()
        + r#"
table reactions:
  message: messages
  principal: principal
  emoji: text <=8
  unique message, principal
  immutable message, principal
  read through .message
  sync
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
mutation react(message: messages):
  upsert reactions[message, viewer] { emoji: 'ok' }
mutation edit(message: messages):
  update messages[message] { text: 'edited' }
mutation conditionalText(message: messages):
  update messages[message] { text: 'edited' } if .text = 'edited'
mutation ownEdit(conversation: conversations):
  m = insert messages { conversation, sender: viewer, text: 'hello', photo: null, at: now }
  update messages[m] { text: 'edited' }
"#;
    let (mut e, b) = compile(&src);
    seed(&mut e);
    send(&mut e, 0, NOW);
    let mut d = host.open("ordinary-r4", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let first = d.admit(queued("alice", 1)).unwrap();
    assert!(first.predictable);
    for (n, op, args) in [
        (2, "edit", json!({"message":first.new_ids[0]})),
        (3, "react", json!({"message":"m0"})),
        (4, "react", json!({"message":"m0"})),
        (5, "ownEdit", json!({"conversation":"c"})),
    ] {
        let q = d.admit(request(op, args, n)).unwrap();
        assert!(q.predictable, "{op}: {q:?}");
    }
    let count = d.queued().unwrap().len();
    let condition = d
        .admit(request(
            "conditionalText",
            json!({"message":first.new_ids[0]}),
            7,
        ))
        .unwrap();
    assert!(
        condition.predictable,
        "an ordinary text condition consumes no accounting"
    );
    let refusal = d.admit(request("failedSend", json!({"conversation":"c"}), 6));
    assert!(
        matches!(refusal, Err(snapback4_core::RuntimeError::Require { code, .. }) if code == "ROLLBACK")
    );
    assert_eq!(
        d.queued().unwrap().len(),
        count + 1,
        "allocator reads alone cannot hide an ordinary refusal"
    );
    let queue = d.queued().unwrap();
    for q in queue {
        settle(&mut e, &mut d, &q);
    }
    same_rows(&mut e, &d, "messages");
    same_rows(&mut e, &d, "reactions");
}
both!(ordinary_controls_memory, ordinary_controls_sqlite, ordinary);

#[test]
fn schema_closure_is_transitive_and_survives_projection() {
    let src = source().replace(
        "  text: text <=2000",
        "  shelf: shelves ?\n  text: text <=2000",
    ) + r#"
table shelves:
  total: sum messages of .recipients by .shelf
  public
  sync public
"#;
    let (_, b) = compile(&src);
    let mut schema = b.schema;
    // Current authoring rejects aggregate cascades. Exercise the fixed-point
    // classifier directly without claiming this synthetic schema is admitted.
    let mirror = schema
        .maintains
        .iter()
        .find(|m| m.private.is_some())
        .unwrap()
        .clone();
    let mut outer = mirror.clone();
    outer.source = "shelves".into();
    outer.target = "outer".into();
    outer.private = None;
    outer.kind = snapback4_core::schema::MaintainKind::Sum { of: "total".into() };
    outer.by = vec!["id".into()];
    schema
        .tables
        .insert("outer".into(), schema.tables[&mirror.target].clone());
    let mut last = outer.clone();
    last.source = "outer".into();
    last.target = "last".into();
    last.kind = snapback4_core::schema::MaintainKind::Sum { of: "value".into() };
    schema
        .tables
        .insert("last".into(), schema.tables["outer"].clone());
    schema.maintains.insert(0, last);
    schema.maintains.insert(0, outer);
    schema.receipt_dependencies.clear();
    schema.prepare_receipt_dependencies();
    for (table, field) in [
        ("messages", "recipients"),
        ("shelves", "total"),
        ("outer", "value"),
        ("last", "value"),
    ] {
        assert!(
            schema.receipt_dependencies[table].contains(field),
            "{table}.{field}"
        );
    }
    let projected = schema.public_projection();
    assert!(projected.maintains.iter().all(|m| m.private.is_none()));
    assert!(!projected.receipt_dependencies.contains_key(&mirror.target));
    let decoded: snapback4_core::Schema =
        snapback4_core::json_codec::from_text(&serde_json::to_string(&projected).unwrap()).unwrap();
    assert_eq!(decoded.receipt_dependencies, projected.receipt_dependencies);
}
