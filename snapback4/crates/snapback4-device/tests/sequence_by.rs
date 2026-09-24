mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState};
use snapback4_device::device::{Device, Queued};
use snapback4_device::store::DeviceStore;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/sequence-by.q");
fn one<S: DeviceStore>(d: &mut Device<S>, id: &str) -> Value {
    d.query("one", "alice", &json!({"messageId":id}), 1000).unwrap().data
}
fn queued(n: u64) -> Queued {
    Queued {
        id: format!("q{n}"),
        seq: n,
        op: "send".into(),
        args: json!({"conversationId":"c","body":format!("pending{n}")}),
        viewer: "alice".into(),
        now: 1000,
        new_ids: vec![format!("pending{n}")],
        predicted: vec![],
        predictable: true,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
    }
}
fn scenario<H: Host>(host: &mut H, offline: bool) {
    let (mut e, backend) = compile(SOURCE);
    // Memberships and messages share the held floor, even on separate tables.
    e.seed([(
        "members".into(),
        snapback4_core::value::object([("id", id("member")), ("conversationId", id("c")), ("principal", id("alice"))]),
    )])
    .unwrap();
    let mut d = host.open("sequence", Some(backend)).unwrap();
    for (i, p) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() {
        d.apply(p, i == 0).unwrap();
    }
    let predicted = d
        .predict(
            "send",
            "alice",
            &json!({"conversationId":"c","body":"preview"}),
            1000,
            vec!["preview".into()],
            0,
        )
        .unwrap();
    assert_eq!(predicted.result["ordinal"], 2);
    assert_eq!(predicted.result["pending"], true);
    d.withdraw(&predicted.predicted).unwrap();
    let first = d.admit(queued(1)).unwrap();
    assert!(first.predictable, "{first:?}");
    assert_eq!(one(&mut d, "pending1").field("ordinal"), Ok(&Value::Int(2)));
    assert_eq!(one(&mut d, "pending1").field("pending"), Ok(&Value::Bool(true)));
    if offline {
        assert!(d.admit(queued(2)).unwrap().predictable);
        assert_eq!(one(&mut d, "pending2").field("ordinal"), Ok(&Value::Int(3)));
        host.close("sequence", d);
        d = host.open("sequence", None).unwrap();
        assert_eq!(one(&mut d, "pending2").field("pending"), Ok(&Value::Bool(true)));
    }
    // Another writer settles unseen work ahead of the offline outbox.
    let other = e
        .mutate(
            "send",
            Some("other"),
            context("bob", &[("conversationId", id("c")), ("body", Value::String("other".into()))])
                .at(1000)
                .with_ids(["other".into()]),
        )
        .unwrap();
    assert!(matches!(other.state, WriteState::Sent { .. }));
    for n in 1..=if offline { 2 } else { 1 } {
        let entry = d.queued().unwrap().into_iter().find(|q| q.id == format!("q{n}")).unwrap();
        assert!(entry.sent_seq.is_none());
        let out = e
            .mutate(
                "send",
                Some(&entry.id),
                context("alice", &[("conversationId", id("c")), ("body", Value::String(format!("pending{n}")))])
                    .at(1000)
                    .with_ids(entry.new_ids),
            )
            .unwrap();
        let WriteState::Sent { seq, result } = out.state else { panic!("{out:?}") };
        assert_eq!(result.field("ordinal"), Ok(&Value::Int(n as i64 + 2)));
        assert!(result.field("pending").is_err());
        d.settle(&format!("q{n}"), Some(seq)).unwrap();
        // The reply alone cannot convert the still-provisional local row to settled.
        assert_eq!(one(&mut d, &format!("pending{n}")).field("pending"), Ok(&Value::Bool(true)));
        let page = stream_page(&mut e, "alice", d.sync_state().unwrap().watermark);
        d.apply(&page, false).unwrap();
        let settled = one(&mut d, &format!("pending{n}"));
        assert_ne!(settled.field("pending"), Ok(&Value::Bool(true)));
        assert_eq!(settled.field("ordinal"), Ok(&Value::Int(n as i64 + 2)));
    }
    assert!(d.queued().unwrap().is_empty());
    let page = d.query("history", "alice", &json!({"conversationId":"c"}), 1000).unwrap();
    let rows = page.data.as_array().unwrap();
    let expected = if offline { vec!["pending2", "pending1"] } else { vec!["pending1", "other"] };
    assert_eq!(rows.iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), expected);
    host.close("sequence", d);
}
#[test]
fn memory_online_and_two_offline_inserts() {
    for offline in [false, true] {
        scenario(&mut Memory::new(), offline);
    }
}
#[test]
fn sqlite_online_and_two_offline_inserts() {
    for offline in [false, true] {
        scenario(&mut Sqlite::new("sequence"), offline);
    }
}

#[test]
fn a_pending_delete_cannot_lower_the_settled_parent_floor() {
    fn run<H: Host>(host: &mut H) {
        let (mut e, backend) = compile(SOURCE);
        e.seed([(
            "messages".into(),
            snapback4_core::value::object([("id", id("settled")), ("conversationId", id("c")), ("body", Value::String("settled".into()))]),
        )])
        .unwrap();
        let mut d = host.open("delete-floor", Some(backend)).unwrap();
        for (i, p) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() {
            d.apply(p, i == 0).unwrap();
        }
        let deletion = d.predict("remove", "alice", &json!({"messageId":"settled"}), 1000, vec![], 0).unwrap();
        assert_eq!(one(&mut d, "settled"), Value::Null);
        let insert = d
            .predict(
                "send",
                "alice",
                &json!({"conversationId":"c","body":"after delete"}),
                1000,
                vec!["pending".into()],
                0,
            )
            .unwrap();
        assert_eq!(insert.result["ordinal"], 2, "settled row remains held beneath deletion");
        d.withdraw(&deletion.predicted).unwrap();
        assert_eq!(one(&mut d, "settled").field("ordinal"), Ok(&Value::Int(1)));
        host.close("delete-floor", d);
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("sequence-delete"));
}

#[test]
fn an_unrepresentable_provisional_queues_without_publishing_a_clamped_row() {
    fn run<H: Host>(host: &mut H) {
        let (mut e, backend) = compile(SOURCE);
        e.load_trusted([(
            "messages".into(),
            snapback4_core::value::object([
                ("id", id("high")),
                ("conversationId", id("c")),
                ("body", Value::String("high".into())),
                ("ordinal", Value::Int(snapback4_core::value::I53_MAX - 1)),
            ]),
        )])
        .unwrap();
        let mut d = host.open("sequence-limit", Some(backend)).unwrap();
        for (i, p) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() {
            d.apply(p, i == 0).unwrap();
        }
        assert!(d.admit(queued(1)).unwrap().predictable);
        assert_eq!(one(&mut d, "pending1").field("ordinal"), Ok(&Value::Int(snapback4_core::value::I53_MAX)));
        assert!(!d.admit(queued(2)).unwrap().predictable);
        assert_eq!(one(&mut d, "pending2"), Value::Null);
        assert_eq!(d.queued().unwrap().len(), 2, "the server must decide both queued writes");
        host.close("sequence-limit", d);
    }
    run(&mut Memory::new());
    run(&mut Sqlite::new("sequence-limit"));
}
