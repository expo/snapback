use super::*;
use snapback4_device::device::{Backend, Queued};
fn queued(op: &str, seq: u64, now: i64) -> Queued {
    Queued {
        id: format!("q{seq}"),
        seq,
        op: op.into(),
        args: json!({"conversation":"c","from":2,"through":3}),
        viewer: "bob".into(),
        now,
        new_ids: vec![],
        predicted: vec![],
        predictable: true,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
        dispatch: None,
    }
}
fn adoption<H: Host>(host: &mut H) {
    let now = snapback4_core::now_ms() + 1_000_000;
    let (mut e, manual) = compile(MANUAL);
    seed(&mut e);
    for n in 1..=5 {
        send(&mut e, n, now);
    }
    sent(mutate(
        &mut e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(5)),
            ("through", Value::Int(5)),
        ],
        now,
    ));
    let mut d = host.open("adoption", Some(manual)).unwrap();
    let pages = snapshot_pages(&mut e, "bob", 1);
    assert!(pages.len() > 1);
    d.apply(&pages[0], true).unwrap();
    let read = d.query(
        "messageReceipts",
        "bob",
        &json!({"conversation":"c","c":null}),
        now,
    );
    assert!(
        read.is_err() || !read.unwrap().complete,
        "partial acquisition cannot claim a complete receipt"
    );
    let mut seen = queued("seen", 1, now);
    seen.args = json!({"conversation":"c","through":3});
    assert!(
        !d.admit(seen).unwrap().predictable,
        "partial acquisition queues seen"
    );
    for p in &pages[1..] {
        d.apply(p, false).unwrap();
    }
    let member = d
        .query("receiptMember", "bob", &json!({"conversation":"c"}), now)
        .unwrap();
    assert_eq!(
        member.data.field("seenOrdinal").unwrap(),
        &Value::Int(0),
        "unpredictable partial write stays queued"
    );
    d.settle("q1", None).unwrap();
    let mut seen = queued("seen", 3, now);
    seen.args = json!({"conversation":"c","through":3});
    assert!(d.admit(seen).unwrap().predictable);
    assert_eq!(
        d.query("receiptMember", "bob", &json!({"conversation":"c"}), now)
            .unwrap()
            .data
            .field("seenOrdinal")
            .unwrap(),
        &Value::Int(3)
    );
    assert!(
        d.admit(queued("delivered", 2, now)).unwrap().predictable,
        "manual recipe predicts with complete coverage"
    );
    let b = bound(DECLARATIVE);
    let schema = b.schema.clone();
    let programs: Vec<_> = b.programs.into_iter().map(|p| p.program).collect();
    e.adopt_at(schema.clone(), programs.clone(), now + 1)
        .unwrap();
    let backend = Backend {
        generation: e.generation(),
        schema,
        programs,
    };
    d.adopt(backend).unwrap();
    // Adoption requests a fresh publication; that publication restores old
    // predictions and replays them under the new operation classifications.
    for (i, p) in snapshot_pages(&mut e, "bob", 1000).iter().enumerate() {
        d.apply(p, i == 0).unwrap();
    }
    let pending = d.queued().unwrap();
    assert_eq!(pending.len(), 2);
    assert!(
        !pending
            .iter()
            .find(|q| q.op == "delivered")
            .unwrap()
            .predictable,
        "adoption rolls back manual delivery prediction"
    );
    assert!(!pending.iter().find(|q| q.op == "seen").unwrap().predictable);
    // Both adapters persist the outbox and authoritative progress across reopen.
    host.close("adoption", d);
    let mut d = host.open("adoption", None).unwrap();
    for q in d.queued().unwrap() {
        let values = q
            .args
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                (
                    k.as_str(),
                    if k == "conversation" {
                        id(v.as_str().unwrap())
                    } else {
                        Value::Int(v.as_i64().unwrap())
                    },
                )
            })
            .collect::<Vec<_>>();
        let r = e
            .mutate(&q.op, Some(&q.id), ctx("bob", &values, now + 2))
            .unwrap();
        let duplicate = e
            .mutate(&q.op, Some(&q.id), ctx("bob", &values, now + 2))
            .unwrap();
        assert!(duplicate.replayed);
        assert_eq!(r.state, duplicate.state);
        let WriteState::Sent { seq, .. } = r.state else {
            panic!("{:?}", r.state)
        };
        d.settle(&q.id, Some(seq)).unwrap();
        for (i, p) in snapshot_pages(&mut e, "bob", 1000).iter().enumerate() {
            d.apply(p, i == 0).unwrap();
        }
    }
    assert!(d.queued().unwrap().is_empty());
    let server = e
        .query(
            "progress",
            ctx(
                "bob",
                &[("conversation", id("c")), ("c", Value::Null)],
                now + 2,
            ),
        )
        .unwrap();
    let device = d
        .query(
            "progress",
            "bob",
            &json!({"conversation":"c","c":null}),
            now + 2,
        )
        .unwrap();
    assert!(device.complete);
    assert_eq!(server.data, device.data);
    assert_eq!(
        receipt(&mut e, now + 2),
        d.query(
            "messageReceipts",
            "bob",
            &json!({"conversation":"c","c":null}),
            now + 2
        )
        .unwrap()
        .data
    );
    host.close("adoption", d);
}
#[test]
fn partial_acquisition_adoption_and_replay_memory() {
    adoption(&mut Memory::new());
}
#[test]
fn partial_acquisition_adoption_and_replay_sqlite() {
    adoption(&mut Sqlite::new("rx-adoption"));
}
