use super::*;
use snapback4_core::meter::Ceilings;
use snapback4_device::device::Queued;
const NOW: i64 = 4_000_000_000_200;
fn report(e: &mut Engine, from: i64, through: i64) -> snapback4_core::MutationOutcome {
    e.mutate(
        "delivered",
        None,
        ctx(
            "bob",
            &[
                ("conversation", id("c")),
                ("from", Value::Int(from)),
                ("through", Value::Int(through)),
            ],
            NOW,
        ),
    )
    .unwrap()
}
fn compact(e: &mut Engine) -> snapback4_core::MutationOutcome {
    let mut context = ctx("bob", &[("conversation", id("c"))], NOW);
    context.delivery_fingerprint = Some(e.schema().delivery[0].fingerprint.clone());
    e.mutate("compactReceipts", None, context).unwrap()
}
fn prefix(e: &mut Engine) -> Value {
    e.query(
        "receiptMember",
        ctx("bob", &[("conversation", id("c"))], NOW),
    )
    .unwrap()
    .data
    .field("deliveredOrdinal")
    .unwrap()
    .clone()
}
fn intervals(e: &mut Engine) -> Vec<(i64, i64)> {
    let mut rows: Vec<_> = e
        .store()
        .rows("runs")
        .unwrap()
        .iter()
        .map(|r| {
            (
                r.field("fromOrdinal").unwrap().as_int().unwrap(),
                r.field("throughOrdinal").unwrap().as_int().unwrap(),
            )
        })
        .collect();
    rows.sort();
    rows
}
fn labels(e: &mut Engine, expected: &[(i64, &str)]) {
    let value = receipt(e, NOW);
    for (n, label) in expected {
        let row = value
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r.field("id").unwrap() == &id(&format!("m{n}")))
            .unwrap();
        assert_eq!(
            row.field("receipt").unwrap(),
            &Value::String((*label).into()),
            "message {n}"
        );
    }
}
fn fragmented(mixed: bool) -> Engine {
    let source = DECLARATIVE.replace(
        "  photo: image <=5000000 once ?",
        "  expiresAt: time ?\n  expire at .expiresAt\n  photo: image <=5000000 once ?",
    );
    let source = source
        + "\nquery pointReceipt(message: messages):\n  return receipt(messages[message] ! else NOT_FOUND)\n";
    let (mut e, _) = compile(&source);
    seed(&mut e);
    for n in 1..=131 {
        send(&mut e, n, NOW - 100);
    }
    for n in (2..=128).step_by(2) {
        sent(report(&mut e, n, n).state);
    }
    for n in (3..=129).step_by(2).chain([130]) {
        if mixed && n % 4 == 3 {
            let mut row = e
                .store()
                .rows("messages")
                .unwrap()
                .into_iter()
                .find(|r| r.field("id").unwrap() == &id(&format!("m{n}")))
                .unwrap();
            let mut fields = row.as_object().unwrap().clone();
            fields.insert("expiresAt".into(), Value::Int(NOW - 1));
            row = object(fields);
            e.seed_at([("messages".into(), row)], NOW - 100).unwrap();
        } else {
            e.seed_delete("messages", &format!("m{n}")).unwrap();
        }
    }
    e
}
fn bounded(out: &snapback4_core::MutationOutcome) {
    let m = out.metered;
    let c = Ceilings::default();
    assert!(
        m.examined < c.examined
            && m.index_entries < c.index_entries
            && m.steps < c.steps
            && m.heap_bytes < c.heap_bytes
            && m.rows_written < c.rows_written
            && m.rule_probes < c.rule_probes
    );
    eprintln!("round2 meter: {m:?}");
}
#[test]
fn compaction_merges_deleted_and_expired_gaps_beyond_live_blocker() {
    for mixed in [false, true] {
        let mut e = fragmented(mixed);
        let result = compact(&mut e);
        bounded(&result);
        assert!(
            matches!(
                result.state,
                WriteState::Sent {
                    result: Value::Bool(true),
                    ..
                }
            ),
            "{:?}",
            result.state
        );
        assert_eq!(prefix(&mut e), Value::Int(0));
        assert_eq!(intervals(&mut e), vec![(2, 130)]);
        let result = report(&mut e, 131, 131);
        bounded(&result);
        sent(result.state);
        assert_eq!(intervals(&mut e), vec![(2, 131)]);
        for (message, label) in [("m1", "sent"), ("m131", "delivered")] {
            assert_eq!(
                e.query(
                    "pointReceipt",
                    ctx("alice", &[("message", id(message))], NOW)
                )
                .unwrap()
                .data,
                Value::String(label.into())
            );
        }
        assert_eq!(prefix(&mut e), Value::Int(0));
        sent(report(&mut e, 1, 1).state);
        assert_eq!(prefix(&mut e), Value::Int(131));
        assert!(intervals(&mut e).is_empty());
    }
}
#[test]
fn delivery_compacts_beyond_live_blocker_before_enforcing_cap() {
    for mixed in [false, true] {
        let mut e = fragmented(mixed);
        let result = report(&mut e, 131, 131);
        bounded(&result);
        sent(result.state);
        assert_eq!(intervals(&mut e), vec![(2, 131)]);
        assert_eq!(prefix(&mut e), Value::Int(0));
        let repeated = report(&mut e, 131, 131);
        sent(repeated.state);
        assert_eq!(repeated.events, 0);
    }
}
#[test]
fn compaction_beyond_blocker_rolls_back_meter_refusal() {
    let mut e = fragmented(false);
    let before = intervals(&mut e);
    e.set_ceilings(Ceilings {
        rows_written: 10,
        ..Default::default()
    });
    let result = compact(&mut e);
    assert!(format!("{:?}", result.state).contains("E_BOUND"));
    assert_eq!(intervals(&mut e), before);
    assert_eq!(prefix(&mut e), Value::Int(0));
    e.set_ceilings(Default::default());
    sent(compact(&mut e).state);
    assert_eq!(intervals(&mut e), vec![(2, 130)]);
}
#[test]
fn compact_requires_its_familys_fingerprint() {
    let (mut e, b) = compile(DECLARATIVE);
    seed(&mut e);
    let fingerprint = &b.schema.delivery[0].fingerprint;
    for value in [None, Some("wrong")] {
        assert_eq!(
            b.schema
                .check_delivery("compactReceipts", value)
                .unwrap_err()
                .code(),
            "E_DELIVERY_BINDING"
        );
        let mut context = ctx("bob", &[("conversation", id("c"))], NOW);
        context.delivery_fingerprint = value.map(str::to_owned);
        assert_eq!(
            e.mutate("compactReceipts", None, context)
                .unwrap_err()
                .code(),
            "E_DELIVERY_BINDING"
        );
    }
    b.schema
        .check_delivery("compactReceipts", Some(fingerprint))
        .unwrap();
    // Preserve the existing optional fingerprint contract for manual reports.
    bound(MANUAL)
        .schema
        .check_delivery("delivered", None)
        .unwrap();
    sent(compact(&mut e).state);
}
#[test]
fn live_blocker_labels_survive_compaction_and_a_deleted_hole() {
    let (mut e, _) = compile(DECLARATIVE);
    seed(&mut e);
    for n in 1..=3 {
        send(&mut e, n, NOW);
    }
    sent(report(&mut e, 2, 2).state);
    sent(report(&mut e, 3, 3).state);
    labels(&mut e, &[(1, "sent"), (2, "delivered"), (3, "delivered")]);
    assert_eq!(prefix(&mut e), Value::Int(0));
    sent(mutate(
        &mut e,
        "bob",
        "seen",
        &[("conversation", id("c")), ("through", Value::Int(2))],
        NOW,
    ));
    labels(&mut e, &[(1, "sent"), (2, "read"), (3, "delivered")]);
    sent(report(&mut e, 1, 1).state);
    assert_eq!(prefix(&mut e), Value::Int(3));
    assert!(intervals(&mut e).is_empty());
    labels(&mut e, &[(1, "read"), (2, "read"), (3, "delivered")]);
    let (mut e, _) = compile(DECLARATIVE);
    seed(&mut e);
    for n in 1..=4 {
        send(&mut e, n, NOW);
    }
    sent(report(&mut e, 4, 4).state);
    sent(compact(&mut e).state);
    assert_eq!(prefix(&mut e), Value::Int(0));
    assert_eq!(intervals(&mut e), vec![(4, 4)]);
    labels(&mut e, &[(1, "sent"), (4, "delivered")]);
    for n in [1, 3] {
        e.seed_delete("messages", &format!("m{n}")).unwrap();
    }
    sent(compact(&mut e).state);
    assert_eq!(prefix(&mut e), Value::Int(1));
    assert_eq!(intervals(&mut e), vec![(4, 4)]);
    labels(&mut e, &[(2, "sent"), (4, "delivered")]);
    e.seed_delete("messages", "m2").unwrap();
    sent(compact(&mut e).state);
    assert_eq!(prefix(&mut e), Value::Int(4));
    assert!(intervals(&mut e).is_empty());
    labels(&mut e, &[(4, "delivered")]);
}
fn partial_leave<H: Host>(host: &mut H) {
    let (mut e, b) = compile(DECLARATIVE);
    seed(&mut e);
    for n in 1..=4 {
        send(&mut e, n, NOW);
    }
    sent(report(&mut e, 4, 4).state);
    let mut d = host.open("partial-leave", Some(b)).unwrap();
    let pages = snapshot_pages(&mut e, "bob", 1);
    assert!(pages.len() > 1);
    d.apply(&pages[0], true).unwrap();
    let queued = d
        .admit(Queued {
            id: "leave".into(),
            seq: 1,
            op: "leave".into(),
            args: json!({"conversation":"c"}),
            viewer: "bob".into(),
            now: NOW,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
            dispatch: None,
        })
        .unwrap();
    assert!(!queued.predictable);
    assert!(queued.predicted.is_empty());
    for page in &pages[1..] {
        d.apply(page, false).unwrap();
    }
    let result = d
        .query(
            "progress",
            "bob",
            &json!({"conversation":"c","c":null}),
            NOW,
        )
        .unwrap();
    assert!(result.complete);
    assert_eq!(
        result.data.field("member").unwrap().field("id").unwrap(),
        &id("b")
    );
    assert_eq!(
        result.data.field("runs").unwrap().as_array().unwrap().len(),
        1
    );
    host.close("partial-leave", d);
}
#[test]
fn partial_run_coverage_queues_removal_without_deleting_the_member() {
    partial_leave(&mut Memory::new());
    partial_leave(&mut Sqlite::new("rx-partial-leave"));
}

#[test]
fn long_gap_after_live_blocker_makes_bounded_persistent_progress() {
    let mut e = super::round1::expired_fixture(9131);
    let mut one = e
        .store()
        .rows("messages")
        .unwrap()
        .into_iter()
        .find(|r| r.field("id").unwrap() == &id("m1"))
        .unwrap()
        .as_object()
        .unwrap()
        .clone();
    one.insert("expiresAt".into(), Value::Null);
    e.seed_at([("messages".into(), object(one))], NOW - 199)
        .unwrap();
    for n in [2].into_iter().chain((9004..=9128).step_by(2)) {
        sent(mutate(
            &mut e,
            "bob",
            "delivered",
            &[
                ("conversation", id("c")),
                ("from", Value::Int(n)),
                ("through", Value::Int(n)),
            ],
            NOW - 198,
        ));
    }
    for n in (9001..=9129)
        .filter(|n| n % 2 == 1 || *n == 9002)
        .chain([9130])
    {
        e.seed_delete("messages", &format!("m{n}")).unwrap();
    }
    assert_eq!(intervals(&mut e).len(), 64);
    for call in 0..10 {
        let out = report(&mut e, 9131, 9131);
        bounded(&out);
        if matches!(out.state, WriteState::Sent { .. }) {
            break;
        }
        assert!(format!("{:?}", out.state).contains("RUNS_FULL"));
        let before = intervals(&mut e);
        let out = compact(&mut e);
        bounded(&out);
        assert!(matches!(
            out.state,
            WriteState::Sent {
                result: Value::Bool(true),
                ..
            }
        ));
        assert_eq!(prefix(&mut e), Value::Int(0));
        let after = intervals(&mut e);
        assert!(after[0].1 > before[0].1);
        if call == 0 {
            assert_eq!(after[0], (2, 1025));
        }
        assert!(call < 9);
    }
    assert_eq!(intervals(&mut e), vec![(2, 9131)]);
    assert_eq!(prefix(&mut e), Value::Int(0));
}

#[test]
fn app_cannot_update_runs_even_when_the_generated_fold_can() {
    let source = format!(
        "{DECLARATIVE}\nmutation forge(conversation: conversations):\n  update runs[conversation, viewer, 2] {{ throughOrdinal: 3 }}\n"
    );
    let (mut e, _) = compile(&source);
    seed(&mut e);
    for n in 1..=3 {
        send(&mut e, n, NOW);
    }
    sent(report(&mut e, 2, 2).state);
    let state = mutate(&mut e, "bob", "forge", &[("conversation", id("c"))], NOW);
    assert!(format!("{state:?}").contains("E_RECEIPTS_OWNED"));
    assert_eq!(intervals(&mut e), vec![(2, 2)]);
    let mut context = ctx("outsider", &[("conversation", id("c"))], NOW);
    context.delivery_fingerprint = Some(e.schema().delivery[0].fingerprint.clone());
    let state = e.mutate("compactReceipts", None, context).unwrap().state;
    assert!(format!("{state:?}").contains("NOT_MEMBER"));
}
