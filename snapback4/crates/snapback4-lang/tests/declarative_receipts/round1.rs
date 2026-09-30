use super::*;
fn progress(e: &mut Engine, now: i64) -> Value {
    e.query(
        "progress",
        ctx("bob", &[("conversation", id("c")), ("c", Value::Null)], now),
    )
    .unwrap()
    .data
}
fn report(e: &mut Engine, from: i64, through: i64, now: i64) -> WriteState {
    mutate(
        e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(from)),
            ("through", Value::Int(through)),
        ],
        now,
    )
}
fn runs(e: &mut Engine) -> usize {
    e.store()
        .rows("runs")
        .unwrap()
        .iter()
        .filter(|r| r.field("principal").unwrap() == &id("bob"))
        .count()
}
fn service_source() -> String {
    DECLARATIVE
        .replacen(
            "  read <- exists members[.conversation, viewer]",
            "  read <- exists members[.conversation, viewer] or viewer = 'service:admin'",
            1,
        )
        .replacen(
            "  delete <- .principal = viewer",
            "  delete <- .principal = viewer or viewer = 'service:admin'",
            1,
        )
        + "\nmutation kick(conversation: conversations, principal: principal):\n  delete members[conversation, principal]\n"
}
#[test]
fn service_removal_retires_exact_members_runs_and_rejoin_has_room() {
    let (mut e, _) = compile(&service_source());
    seed(&mut e);
    for n in 1..=131 {
        send(&mut e, n, 10 + n);
    }
    for n in (2..=128).step_by(2) {
        sent(report(&mut e, n, n, 200));
    }
    sent(mutate(
        &mut e,
        "alice",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(130)),
            ("through", Value::Int(130)),
        ],
        200,
    ));
    assert_eq!(runs(&mut e), 64);
    let before = progress(&mut e, 200);
    e.set_ceilings(snapback4_core::meter::Ceilings {
        rows_written: 10,
        ..Default::default()
    });
    assert!(
        format!(
            "{:?}",
            mutate(
                &mut e,
                "service:admin",
                "kick",
                &[("conversation", id("c")), ("principal", id("bob"))],
                201
            )
        )
        .contains("E_BOUND")
    );
    e.set_ceilings(Default::default());
    assert_eq!(before, progress(&mut e, 201));
    sent(mutate(
        &mut e,
        "service:admin",
        "kick",
        &[("conversation", id("c")), ("principal", id("bob"))],
        202,
    ));
    assert_eq!(
        e.store().rows("runs").unwrap().len(),
        1,
        "only Alice's run survives"
    );
    sent(mutate(
        &mut e,
        "alice",
        "add",
        &[("conversation", id("c")), ("principal", id("bob"))],
        203,
    ));
    send(&mut e, 132, 204);
    send(&mut e, 133, 205);
    sent(report(&mut e, 133, 133, 206));
    assert_eq!(runs(&mut e), 1);
}
#[test]
fn saturated_deleted_holes_compact_all_covered_runs_before_cap() {
    let (mut e, _) = compile(DECLARATIVE);
    seed(&mut e);
    for n in 1..=131 {
        send(&mut e, n, 10 + n);
    }
    for n in (2..=128).step_by(2) {
        sent(report(&mut e, n, n, 200));
    }
    assert_eq!(runs(&mut e), 64);
    for n in (1..=129).step_by(2).chain([130]) {
        e.seed_delete("messages", &format!("m{n}")).unwrap();
    }
    sent(report(&mut e, 131, 131, 201));
    assert_eq!(runs(&mut e), 0);
    assert_eq!(
        progress(&mut e, 201)
            .field("member")
            .unwrap()
            .field("deliveredOrdinal")
            .unwrap(),
        &Value::Int(131)
    );
}
#[test]
fn compaction_retires_runs_already_behind_prefix() {
    let (mut e, _) = compile(DECLARATIVE);
    seed(&mut e);
    for n in 1..=4 {
        send(&mut e, n, 10 + n);
    }
    sent(report(&mut e, 2, 2, 20));
    sent(report(&mut e, 4, 4, 20));
    for n in 1..=3 {
        e.seed_delete("messages", &format!("m{n}")).unwrap();
    }
    sent(report(&mut e, 4, 4, 21));
    assert_eq!(runs(&mut e), 0);
}
#[test]
fn self_only_membership_cannot_promise_complete_receipts() {
    let source = DECLARATIVE.replacen("  read <- exists members[.conversation, viewer]", "  read <- .principal = viewer",1)
        .replacen("  sync to members[.conversation]", "  sync to .principal",1)
        .replace("  for member in members where .conversation = conversation:\n    if member.principal != viewer:\n      recipients = recipients + 1", "  recipients = 1");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(
        b.diagnostics.iter().any(|d| d.code == "E_RECEIPTS_CLAUSE"),
        "{:?}",
        b.diagnostics
    );
}

pub(super) fn expired_fixture(last: i64) -> Engine {
    let source = DECLARATIVE.replace(
        "  photo: image <=5000000 once ?",
        "  expiresAt: time ?\n  expire at .expiresAt\n  photo: image <=5000000 once ?",
    );
    let (mut e, _) = compile(&source);
    seed(&mut e);
    let chat = object([
        ("id", id("c")),
        ("creatorId", id("alice")),
        ("lastOrdinal", Value::Int(last)),
    ]);
    e.seed_at([("conversations".into(), chat)], 1).unwrap();
    e.seed_at(
        (1..=last).map(|n| {
            (
                "messages".into(),
                object([
                    ("id", id(&format!("m{n}"))),
                    ("conversation", id("c")),
                    ("sender", id("alice")),
                    ("ordinal", Value::Int(n)),
                    ("recipients", Value::Int(1)),
                    ("text", Value::String("x".into())),
                    ("at", Value::Int(1)),
                    (
                        "expiresAt",
                        if n <= 9000 {
                            Value::Int(4_000_000_000_100)
                        } else {
                            Value::Null
                        },
                    ),
                ]),
            )
        }),
        4_000_000_000_001,
    )
    .unwrap();
    e
}
fn prefix(e: &mut Engine, now: i64) -> i64 {
    e.query(
        "receiptMember",
        ctx("bob", &[("conversation", id("c"))], now),
    )
    .unwrap()
    .data
    .field("deliveredOrdinal")
    .unwrap()
    .as_int()
    .unwrap()
}
#[test]
fn unswept_long_expiry_hole_records_coverage_and_resumes_bounded_compaction() {
    let mut e = expired_fixture(9001);
    let r = e
        .mutate(
            "delivered",
            None,
            ctx(
                "bob",
                &[
                    ("conversation", id("c")),
                    ("from", Value::Int(9001)),
                    ("through", Value::Int(9001)),
                ],
                4_000_000_000_101,
            ),
        )
        .unwrap();
    sent(r.state);
    assert!(r.metered.examined < 8192);
    assert_eq!(prefix(&mut e, 4_000_000_000_101), 1024);
    assert_eq!(runs(&mut e), 1);
    let mut calls = 0;
    while prefix(&mut e, 4_000_000_000_101) < 9001 {
        let before = prefix(&mut e, 4_000_000_000_101);
        let mut context = ctx("bob", &[("conversation", id("c"))], 4_000_000_000_101);
        context.delivery_fingerprint = Some(e.schema().delivery[0].fingerprint.clone());
        let r = e.mutate("compactReceipts", None, context).unwrap();
        sent(r.state);
        assert!(r.metered.examined < 8192);
        assert!(prefix(&mut e, 4_000_000_000_101) > before);
        calls += 1;
        assert!(calls < 10);
    }
    assert_eq!(runs(&mut e), 0);
}
#[test]
fn full_runs_behind_long_expiry_hole_converge_without_acknowledging_refused_input() {
    let mut e = expired_fixture(9131);
    for n in (9002..=9128).step_by(2) {
        sent(report(&mut e, n, n, 4_000_000_000_002));
    }
    // Only the old hole expires; delete each later unreported message as well.
    for n in (9001..=9129).step_by(2).chain([9130]) {
        e.seed_delete("messages", &format!("m{n}")).unwrap();
    }
    assert_eq!(e.store().rows("runs").unwrap().len(), 64);
    let mut calls = 0;
    loop {
        let state = report(&mut e, 9131, 9131, 4_000_000_000_101);
        if matches!(state, WriteState::Sent { .. }) {
            break;
        }
        assert!(format!("{state:?}").contains("RUNS_FULL"));
        assert_eq!(runs(&mut e), 64);
        let before = prefix(&mut e, 4_000_000_000_101);
        sent(mutate(
            &mut e,
            "bob",
            "compactReceipts",
            &[("conversation", id("c"))],
            4_000_000_000_101,
        ));
        assert!(prefix(&mut e, 4_000_000_000_101) > before);
        calls += 1;
        assert!(calls < 10);
    }
    assert_eq!(prefix(&mut e, 4_000_000_000_101), 9131);
    assert_eq!(runs(&mut e), 0);
}
#[test]
fn family_mappings_operations_and_semantics_are_explicit() {
    let source = DECLARATIVE
        .replace("receipts chat ", "receipts chatRenamed ")
        .replace("lastOrdinal", "allocated")
        .replace("joinedOrdinal", "joined")
        .replace("recipients", "recipientCount")
        .replace("deliveredOrdinal", "received")
        .replace("seenOrdinal", "viewed")
        .replace("runs runs", "runs chatRuns")
        .replace(
            "operations receipt, delivered, seen, receiptMember, progress, compactReceipts",
            "operations badge, acknowledge, viewedThrough, myReceipt, receiptProgress, compactChat",
        )
        .replace("receipt(.)", "badge(.)");
    let b = bound(&source);
    let original = bound(DECLARATIVE);
    assert!(b.schema.tables.contains_key("chatRuns"));
    assert!(!b.schema.tables.contains_key("runs"));
    assert_eq!(
        serde_json::to_value(&b.schema.delivery[0]).unwrap()["compact"],
        "compactChat"
    );
    assert_ne!(
        original.schema.delivery[0].fingerprint,
        b.schema.delivery[0].fingerprint
    );
    assert_ne!(
        original.schema.delivery[0].fingerprint,
        bound(MANUAL).schema.delivery[0].fingerprint
    );
    let mut wire = serde_json::to_value(&b.schema.delivery[0]).unwrap();
    wire["semantics"] = json!("receipts.v4");
    let changed: snapback4_core::schema::DeliveryBinding = serde_json::from_value(wire).unwrap();
    assert_ne!(
        changed.compute_fingerprint(),
        b.schema.delivery[0].fingerprint
    );
    let caps = serde_json::to_string(&b.schema).unwrap();
    assert!(caps.contains("declarative-receipts-v4"));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed_at(
        [
            (
                "conversations".into(),
                object([("id", id("c")), ("creatorId", id("alice"))]),
            ),
            (
                "members".into(),
                object([
                    ("id", id("a")),
                    ("conversation", id("c")),
                    ("principal", id("alice")),
                    ("joined", Value::Int(0)),
                ]),
            ),
            (
                "members".into(),
                object([
                    ("id", id("b")),
                    ("conversation", id("c")),
                    ("principal", id("bob")),
                    ("joined", Value::Int(0)),
                ]),
            ),
        ],
        1,
    )
    .unwrap();
    for n in 1..=3 {
        send(&mut e, n, 10 + n);
    }
    sent(mutate(
        &mut e,
        "bob",
        "acknowledge",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(3)),
            ("through", Value::Int(3)),
        ],
        20,
    ));
    assert_eq!(e.store().rows("chatRuns").unwrap().len(), 1);
    sent(mutate(
        &mut e,
        "bob",
        "leave",
        &[("conversation", id("c"))],
        21,
    ));
    assert!(e.store().rows("chatRuns").unwrap().is_empty());
}

#[test]
fn distinct_families_map_membership_identity_and_keep_ownership_separate() {
    let base = r#"
table groups:
  total: int
  alertTotal: int
  public
  sync public
table audience:
  group: groups
  who: principal
  joined: int
  alertJoined: int
  unique group, who
  cap 50 by group
  immutable group, who, joined, alertJoined
  read <- exists audience[.group, viewer]
  update <- .who = viewer
  delete <- viewer = 'service:admin'
  sync to audience[.group] by .who
mutation remove(group: groups, who: principal):
  delete audience[group, who]
"#;
    let message = r#"
table notes:
  receipts inbox by .room, .number from .author to audience:
    member .group, .who
    counter .total
    floor .joined
    count .size
  room: groups
  number: int
  author: principal
  size: int
  unique room, number
  immutable room, number, author, size
  read <- exists audience[.room, viewer]
  sync to audience[.room] by .who
"#;
    let source = format!(
        "{base}{message}{}",
        message
            .replace("table notes:", "table alerts:")
            .replace("receipts inbox ", "receipts alerts ")
            .replace("counter .total", "counter .alertTotal")
            .replace("floor .joined", "floor .alertJoined")
    );
    let source = source.replace(
        "read <- exists audience[.group, viewer]",
        "read <- exists audience[.group, viewer] or viewer = 'service:admin'",
    ) + "\nmutation forge(room: groups):\n  insert alertsRuns { room, principal: viewer, fromOrdinal: 2, throughOrdinal: 3 }\n";
    let b = bound(&source);
    assert_eq!(b.schema.receipts.len(), 2);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed_at(
        [
            (
                "groups".into(),
                object([("id", id("c")), ("total", Value::Int(3)), ("alertTotal", Value::Int(3))]),
            ),
            (
                "audience".into(),
                object([
                    ("id", id("b")),
                    ("group", id("c")),
                    ("who", id("bob")),
                    ("joined", Value::Int(0)),
                    ("alertJoined", Value::Int(0)),
                ]),
            ),
        ],
        1,
    )
    .unwrap();
    for table in ["notes", "alerts"] {
        e.seed_at(
            [(
                table.into(),
                object([
                    ("id", id("one")),
                    ("room", id("c")),
                    ("number", Value::Int(1)),
                    ("author", id("alice")),
                    ("size", Value::Int(1)),
                ]),
            )],
            1,
        )
        .unwrap();
    }
    for op in ["inboxDelivered", "alertsDelivered"] {
        sent(mutate(
            &mut e,
            "bob",
            op,
            &[
                ("room", id("c")),
                ("from", Value::Int(3)),
                ("through", Value::Int(3)),
            ],
            2,
        ));
    }
    assert_eq!(e.store().rows("inboxRuns").unwrap().len(), 1);
    assert_eq!(e.store().rows("alertsRuns").unwrap().len(), 1);
    assert!(
        format!(
            "{:?}",
            mutate(&mut e, "bob", "forge", &[("room", id("c"))], 2)
        )
        .contains("E_RECEIPTS_OWNED")
    );
    sent(mutate(
        &mut e,
        "service:admin",
        "remove",
        &[("group", id("c")), ("who", id("bob"))],
        3,
    ));
    assert!(e.store().rows("inboxRuns").unwrap().is_empty());
    assert!(e.store().rows("alertsRuns").unwrap().is_empty());
}
