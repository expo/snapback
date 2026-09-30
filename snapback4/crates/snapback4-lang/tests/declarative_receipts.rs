//! The starter's unchanged manual recipe is the differential control.
// @ref LLP 3000.022#14 — round-zero equivalence, ownership and adoption witnesses.
#[path = "../../snapback4-device/tests/common/mod.rs"]
mod common;
use common::*;
use serde_json::json;
use snapback4_core::value::object;
use snapback4_core::{Context, Engine, Value, WriteState};
const MANUAL: &str =
    include_str!("../../../reports/20260930-rx-declarative-receipts/starter-before.q");
const DECLARATIVE: &str = include_str!("../../snapback4/src/verbs/init/social/schema.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn ctx(who: &str, values: &[(&str, Value)], now: i64) -> Context {
    Context::new(who, args(values)).at(now)
}
fn mutate(e: &mut Engine, who: &str, op: &str, values: &[(&str, Value)], now: i64) -> WriteState {
    let mut context = ctx(who, values, now);
    context.delivery_fingerprint = e
        .schema()
        .delivery
        .iter()
        .find(|b| b.compact.as_deref() == Some(op))
        .map(|b| b.fingerprint.clone());
    let r = e.mutate(op, None, context).unwrap().state;
    if !matches!(r, WriteState::Sent { .. }) {
        eprintln!("{op} {who} {values:?}: {r:?}");
    }
    r
}
fn sent(state: WriteState) {
    assert!(matches!(state, WriteState::Sent { .. }), "{state:?}");
}
fn seed(e: &mut Engine) {
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
                    ("joinedOrdinal", Value::Int(0)),
                ]),
            ),
            (
                "members".into(),
                object([
                    ("id", id("b")),
                    ("conversation", id("c")),
                    ("principal", id("bob")),
                    ("joinedOrdinal", Value::Int(0)),
                ]),
            ),
        ],
        1,
    )
    .unwrap();
}
fn send(e: &mut Engine, n: i64, now: i64) {
    let r = e
        .mutate(
            "send",
            None,
            ctx(
                "alice",
                &[
                    ("conversation", id("c")),
                    ("text", Value::String(format!("m{n}"))),
                    ("photo", Value::Null),
                ],
                now,
            )
            .with_ids([format!("m{n}")]),
        )
        .unwrap();
    sent(r.state);
}
fn receipt(e: &mut Engine, now: i64) -> Value {
    let r = e
        .query(
            "messageReceipts",
            ctx(
                "alice",
                &[("conversation", id("c")), ("c", Value::Null)],
                now,
            ),
        )
        .unwrap();
    assert!(r.complete);
    r.data
}
#[test]
fn starter_compiles_and_rejects_owned_progress_and_unallocated_reports() {
    let source = format!(
        "{DECLARATIVE}\nmutation forge(conversation: conversations):\n  update members[conversation, viewer] {{ deliveredOrdinal: 999 }}\nmutation forgeRun(conversation: conversations):\n  insert runs {{ conversation, principal: viewer, fromOrdinal: 1, throughOrdinal: 999 }}\nmutation forgeUpsert(conversation: conversations):\n  upsert members[conversation, viewer] {{ seenOrdinal: 999 }}\n"
    );
    let b = bound(&source);
    assert_eq!(b.schema.delivery.len(), 1);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    seed(&mut e);
    send(&mut e, 1, 10);
    let group = ("conversation", id("c"));
    for op in ["forge", "forgeRun", "forgeUpsert"] {
        let r = mutate(&mut e, "bob", op, &[group.clone()], 20);
        assert!(format!("{r:?}").contains("E_RECEIPTS_OWNED"), "{r:?}");
    }
    for (who, from, through, code) in [
        ("outsider", 1, 1, "NOT_MEMBER"),
        ("bob", 0, 1, "NOT_A_RUN"),
        ("bob", 2, 1, "NOT_A_RUN"),
        ("bob", 1, 2, "PAST_LAST_MESSAGE"),
    ] {
        let r = mutate(
            &mut e,
            who,
            "delivered",
            &[
                group.clone(),
                ("from", Value::Int(from)),
                ("through", Value::Int(through)),
            ],
            20,
        );
        assert!(format!("{r:?}").contains(code), "{r:?}");
    }
    assert!(
        format!(
            "{:?}",
            mutate(
                &mut e,
                "bob",
                "seen",
                &[group, ("through", Value::Int(2))],
                20
            )
        )
        .contains("PAST_LAST_MESSAGE")
    );
    assert!(format!("{:?}", receipt(&mut e, 20)).contains("sent"));
}

fn schedule<H: Host>(host: &mut H, random_seed: u64, expiring: bool) {
    // Deletion/expiry are extensions of both schemas, with the manual recipe unchanged.
    let extend = |s: &str| {
        if expiring {
            s.replace("  photo: image <=5000000 once ?", "  expiresAt: time ?\n  expire at .expiresAt\n  delete <- .sender = viewer\n  photo: image <=5000000 once ?")
        .replace("photo, at: now }", "photo, at: now, expiresAt: now + 30 }")
        } else {
            s.into()
        }
    };
    let (mut manual, mb) = compile(&extend(MANUAL));
    let (mut decl, db) = compile(&extend(DECLARATIVE));
    seed(&mut manual);
    seed(&mut decl);
    let mut md = host.open("manual", Some(mb)).unwrap();
    let mut dd = host.open("decl", Some(db)).unwrap();
    let mut random = random_seed;
    let mut last = 0;
    let mut joined = true;
    let base = snapback4_core::now_ms() + 1_000_000;
    for step in 0..100 {
        random = random
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let now = base + step;
        let choice = if step < 4 { 0 } else { (random >> 32) % 7 };
        for e in [&mut manual, &mut decl] {
            match choice {
                0 => send(e, last + 1, now),
                1 | 2 if last > 0 && joined => {
                    let n = 1 + (random as i64 & i64::MAX) % last;
                    sent(mutate(
                        e,
                        "bob",
                        "delivered",
                        &[
                            ("conversation", id("c")),
                            ("from", Value::Int(n)),
                            ("through", Value::Int(n)),
                        ],
                        now,
                    ));
                }
                3 if last > 0 && joined => {
                    sent(mutate(
                        e,
                        "bob",
                        "seen",
                        &[
                            ("conversation", id("c")),
                            ("through", Value::Int(1 + (random as i64 & i64::MAX) % last)),
                        ],
                        now,
                    ));
                }
                4 if joined => {
                    sent(mutate(e, "bob", "leave", &[("conversation", id("c"))], now));
                }
                5 if !joined => {
                    sent(mutate(
                        e,
                        "alice",
                        "add",
                        &[("conversation", id("c")), ("principal", id("bob"))],
                        now,
                    ));
                }
                6 if expiring && last > 0 => {
                    let _ = e.seed_delete(
                        "messages",
                        &format!("m{}", 1 + (random as i64 & i64::MAX) % last),
                    );
                }
                _ => {}
            }
        }
        match choice {
            0 => last += 1,
            4 if joined => joined = false,
            5 if !joined => joined = true,
            _ => {}
        }
        assert_eq!(
            receipt(&mut manual, now),
            receipt(&mut decl, now),
            "seed {random_seed}, step {step}, expires {expiring}"
        );
        if joined {
            schedules::assert_live_coverage(&mut manual, &mut decl, now, expiring);
        }
        // Exercise the real wire publication, shared interpreter and both persistence hosts.
        for (e, d) in [(&mut manual, &mut md), (&mut decl, &mut dd)] {
            for (i, page) in snapshot_pages(e, "alice", 1000).into_iter().enumerate() {
                d.apply(&page, i == 0).unwrap();
            }
            for table in ["members", "runs"] {
                let mut server = e.store().rows(table).unwrap();
                let mut device = d.store().raw_rows(table);
                server.sort_by(Value::total_cmp);
                device.sort_by(Value::total_cmp);
                assert_eq!(
                    server, device,
                    "published {table} seed {random_seed}, step {step}"
                );
            }
        }
        let query = json!({"conversation":"c","c":null});
        let a = md.query("messageReceipts", "alice", &query, now).unwrap();
        let b = dd.query("messageReceipts", "alice", &query, now).unwrap();
        assert_eq!(a.data, b.data, "device seed {random_seed}, step {step}");
        assert!(a.complete && b.complete);
        assert_eq!(
            snapback4_core::wire::to_json(&receipt(&mut decl, now)),
            snapback4_core::wire::to_json(&b.data)
        );
    }
    host.close("manual", md);
    host.close("decl", dd);
}
#[test]
fn generated_schedules_memory_devices() {
    for seed in 1..=4 {
        for expiry in [false, true] {
            schedule(&mut Memory::new(), seed, expiry);
        }
    }
}
#[test]
fn generated_schedules_sqlite_devices() {
    for seed in 1..=2 {
        for expiry in [false, true] {
            schedule(&mut Sqlite::new("rx"), seed, expiry);
        }
    }
}

#[test]
fn manual_store_adopts_without_losing_receipts() {
    let (mut e, _) = compile(MANUAL);
    seed(&mut e);
    for n in 1..=3 {
        send(&mut e, n, 10 + n);
    }
    sent(mutate(
        &mut e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(3)),
            ("through", Value::Int(3)),
        ],
        20,
    ));
    sent(mutate(
        &mut e,
        "bob",
        "seen",
        &[("conversation", id("c")), ("through", Value::Int(3))],
        20,
    ));
    let before = receipt(&mut e, 20);
    let b = bound(DECLARATIVE);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 21)
        .unwrap();
    assert_eq!(before, receipt(&mut e, 21));
    sent(mutate(
        &mut e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(1)),
            ("through", Value::Int(2)),
        ],
        22,
    ));
    assert!(
        receipt(&mut e, 22)
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m.field("receipt").unwrap() == &Value::String("read".into()))
    );
}

#[test]
fn gaps_skip_only_absent_rows_and_covered_runs_are_noops() {
    let source=DECLARATIVE.replace("  photo: image <=5000000 once ?", "  expiresAt: time ?\n  expire at .expiresAt\n  delete <- .sender = viewer\n  photo: image <=5000000 once ?")
        .replace("photo, at: now }", "photo, at: now, expiresAt: now + 30 }");
    let source =
        format!("{source}\nmutation erase(message: messages):\n  delete messages[message]\n");
    let (mut e, _) = compile(&source);
    seed(&mut e);
    send(&mut e, 1, 10);
    send(&mut e, 2, 30);
    send(&mut e, 3, 31);
    let report = [
        ("conversation", id("c")),
        ("from", Value::Int(3)),
        ("through", Value::Int(3)),
    ];
    sent(mutate(&mut e, "bob", "delivered", &report, 50));
    let progress = |e: &mut Engine, now| {
        e.query(
            "progress",
            ctx("bob", &[("conversation", id("c")), ("c", Value::Null)], now),
        )
        .unwrap()
        .data
    };
    let p = progress(&mut e, 50);
    assert_eq!(
        p.field("member")
            .unwrap()
            .field("deliveredOrdinal")
            .unwrap(),
        &Value::Int(1)
    );
    assert_eq!(
        p.field("runs").unwrap().as_array().unwrap().len(),
        1,
        "live ordinal 2 blocks prefix"
    );
    let again = e
        .mutate("delivered", Some("retry"), ctx("bob", &report, 50))
        .unwrap();
    sent(again.state.clone());
    assert_eq!(again.events, 0);
    assert_eq!(
        again.state,
        e.mutate("delivered", Some("retry"), ctx("bob", &report, 50))
            .unwrap()
            .state
    );
    sent(mutate(
        &mut e,
        "alice",
        "erase",
        &[("message", id("m2"))],
        51,
    ));
    sent(mutate(&mut e, "bob", "delivered", &report, 52));
    let p = progress(&mut e, 52);
    assert_eq!(
        p.field("member")
            .unwrap()
            .field("deliveredOrdinal")
            .unwrap(),
        &Value::Int(3)
    );
    assert!(p.field("runs").unwrap().as_array().unwrap().is_empty());
    send(&mut e, 4, 60);
    send(&mut e, 5, 61);
    let before = progress(&mut e, 95);
    e.set_ceilings(snapback4_core::meter::Ceilings {
        steps: 1,
        ..Default::default()
    });
    let report = [
        ("conversation", id("c")),
        ("from", Value::Int(5)),
        ("through", Value::Int(5)),
    ];
    assert!(format!("{:?}", mutate(&mut e, "bob", "delivered", &report, 95)).contains("E_BOUND"));
    e.set_ceilings(Default::default());
    assert_eq!(before, progress(&mut e, 95), "meter abort is atomic");
    sent(mutate(&mut e, "bob", "delivered", &report, 95));
    assert_eq!(
        progress(&mut e, 95)
            .field("member")
            .unwrap()
            .field("deliveredOrdinal")
            .unwrap(),
        &Value::Int(5),
        "debt collected before expiry may be reported afterwards"
    );
}

#[test]
fn administrative_removal_drops_requirement_and_runs() {
    let source=DECLARATIVE.replace("  delete <- .principal = viewer\n  sync to members[.conversation]", "  delete <- .principal = viewer or exists members[.conversation, viewer]\n  sync to members[.conversation]");
    let source = format!(
        "{source}\nmutation kick(conversation: conversations, principal: principal):\n  delete members[conversation, principal]\n"
    );
    let (mut e, _) = compile(&source);
    seed(&mut e);
    for n in 1..=3 {
        send(&mut e, n, 10 + n);
    }
    sent(mutate(
        &mut e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(3)),
            ("through", Value::Int(3)),
        ],
        20,
    ));
    sent(mutate(
        &mut e,
        "alice",
        "kick",
        &[("conversation", id("c")), ("principal", id("bob"))],
        21,
    ));
    assert!(
        receipt(&mut e, 21)
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m.field("receipt").unwrap() == &Value::String("read".into()))
    );
    sent(mutate(
        &mut e,
        "alice",
        "add",
        &[("conversation", id("c")), ("principal", id("bob"))],
        22,
    ));
    let p = e
        .query(
            "progress",
            ctx("bob", &[("conversation", id("c")), ("c", Value::Null)], 23),
        )
        .unwrap()
        .data;
    assert!(p.field("runs").unwrap().as_array().unwrap().is_empty());
    assert_eq!(
        p.field("member").unwrap().field("joinedOrdinal").unwrap(),
        &Value::Int(3)
    );
}

#[test]
fn declaration_refusals_and_device_delivery_queue() {
    for invalid in [
        DECLARATIVE.replace("cap 50 by conversation", "cap 51 by conversation"),
        DECLARATIVE.replace(
            "immutable conversation, principal, joinedOrdinal",
            "immutable conversation, principal",
        ),
        format!("{DECLARATIVE}\nmutation delivered():\n  return null\n"),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), invalid)]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == "E_RECEIPTS_CLAUSE"),
            "{:?}",
            b.diagnostics
        );
    }
    let (mut e, b) = compile(DECLARATIVE);
    assert_eq!(
        b.schema.operations["delivered"].predicts.as_deref(),
        Some("never")
    );
    seed(&mut e);
    send(&mut e, 1, 10);
    let mut host = Memory::new();
    let mut d = host.open("offline", Some(b)).unwrap();
    for (i, p) in snapshot_pages(&mut e, "bob", 1000).iter().enumerate() {
        d.apply(p, i == 0).unwrap();
    }
    let q = snapback4_device::device::Queued {
        id: "report".into(),
        seq: 1,
        op: "delivered".into(),
        args: json!({"conversation":"c","from":1,"through":1}),
        viewer: "bob".into(),
        now: snapback4_core::now_ms(),
        new_ids: vec![],
        predicted: vec![],
        predictable: true,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
        dispatch: None,
    };
    assert!(!d.admit(q).unwrap().predictable);
    let p = d
        .query(
            "receiptMember",
            "bob",
            &json!({"conversation":"c"}),
            snapback4_core::now_ms(),
        )
        .unwrap();
    assert_eq!(p.data.field("deliveredOrdinal").unwrap(), &Value::Int(0));
}

#[test]
fn receipts_remains_a_legal_ordinary_column_name() {
    let b = bound(
        "table stats:\n  receipts: int\n  public\n  sync public\nquery all():\n  return stats first 1 by .id\n",
    );
    assert!(b.schema.receipts.is_empty());
    assert_eq!(
        b.schema.tables["stats"].columns["receipts"],
        snapback4_core::schema::ColumnType::Int
    );
}

#[test]
fn device_predictions_keep_owned_progress_and_include_removal_cleanup() {
    let source = format!(
        "{DECLARATIVE}\nmutation forge(conversation: conversations):\n  update members[conversation, viewer] {{ seenOrdinal: 999 }}\n"
    );
    let (mut e, b) = compile(&source);
    seed(&mut e);
    for n in 1..=3 {
        send(&mut e, n, 10 + n);
    }
    sent(mutate(
        &mut e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(3)),
            ("through", Value::Int(3)),
        ],
        20,
    ));
    let mut host = Memory::new();
    let mut d = host.open("predictions", Some(b)).unwrap();
    for (i, p) in snapshot_pages(&mut e, "bob", 1000).iter().enumerate() {
        d.apply(p, i == 0).unwrap();
    }
    let queued = |op: &str, seq| snapback4_device::device::Queued {
        id: op.into(),
        seq,
        op: op.into(),
        args: json!({"conversation":"c"}),
        viewer: "bob".into(),
        now: snapback4_core::now_ms(),
        new_ids: vec![],
        predicted: vec![],
        predictable: true,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
        dispatch: None,
    };
    assert_eq!(
        d.admit(queued("forge", 1)).unwrap_err().code(),
        "E_RECEIPTS_OWNED"
    );
    let mut seen = queued("seen", 2);
    seen.args = json!({"conversation":"c","through":3});
    assert!(d.admit(seen).unwrap().predictable);
    let leave = d.admit(queued("leave", 3)).unwrap();
    assert!(leave.predictable, "{leave:?}");
    assert!(leave.predicted.contains(&"members/b".to_string()));
    assert!(
        leave.predicted.iter().any(|key| key.starts_with("runs/")),
        "implicit run deletion is included in prediction's write set: {leave:?}"
    );
}

#[path = "declarative_receipts/device_round1.rs"]
mod device_round1;
#[path = "declarative_receipts/names.rs"]
mod names;
#[path = "declarative_receipts/round1.rs"]
mod round1;
#[path = "declarative_receipts/round2.rs"]
mod round2;
#[path = "declarative_receipts/schedules.rs"]
mod schedules;

#[path = "declarative_receipts/round3.rs"]
mod round3;
