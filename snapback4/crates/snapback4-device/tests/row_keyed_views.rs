mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Context, Value, value::object};
use snapback4_device::device::Queued;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/row-keyed-view.q");
fn seed(server: &mut snapback4_core::Engine, n: i64) {
    server
        .seed([(
            "members".into(),
            object([
                ("id", id("member")),
                ("conversationId", id("c")),
                ("principal", id("bob")),
                ("readUpTo", Value::Int(0)),
                ("joinedAt", Value::Int(0)),
            ]),
        )])
        .unwrap();
    server
        .seed((1..=n).map(|n| {
            (
                "messages".into(),
                object([
                    ("id", id(&format!("m{n:05}"))),
                    ("conversationId", id("c")),
                    ("ordinal", Value::Int(n)),
                    ("senderId", id("alice")),
                    ("tombstone", Value::Bool(false)),
                    ("until", Value::Null),
                ]),
            )
        }))
        .unwrap();
}
fn covered<H: Host>(host: &mut H) {
    let (mut server, mut backend) = compile(&SOURCE.replace("  expire at .until\n", ""));
    seed(&mut server, 10);
    backend.schema = backend.schema.public_projection();
    assert!(
        backend
            .schema
            .tables
            .keys()
            .all(|t| !t.starts_with("$recount:"))
    );
    let mut device = host.open("row-view", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let before = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(before.complete);
    assert_eq!(before.data, Value::Int(10));
    let queued = device
        .admit(Queued {
            id: "mark".into(),
            seq: 1,
            op: "mark".into(),
            args: json!({"member":"member","readUpTo":8}),
            viewer: "bob".into(),
            now: 1,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
        })
        .unwrap();
    assert!(queued.predictable, "{queued:?}");
    let after = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(after.complete, "{after:?}");
    assert_eq!(after.data, Value::Int(2));
}
#[test]
fn covered_memory() {
    covered(&mut Memory::new());
}
#[test]
fn covered_sqlite() {
    covered(&mut Sqlite::new("b3-covered"));
}
fn uncovered<H: Host>(host: &mut H) {
    let source = SOURCE
        .replace("  expire at .until\n", "")
        .replace("  sync public\nview unread", "  online only\nview unread");
    let (mut server, mut backend) = compile(&source);
    seed(&mut server, 10000);
    backend.schema = backend.schema.public_projection();
    let outcome = server
        .mutate(
            "mark",
            None,
            Context::new(
                "bob",
                args(&[("member", id("member")), ("readUpTo", Value::Int(10000))]),
            )
            .at(1),
        )
        .unwrap();
    assert!(matches!(
        outcome.state,
        snapback4_core::WriteState::Sent { .. }
    ));
    let mut device = host.open("row-view-pending", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let pending = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(!pending.complete, "{pending:?}");
    assert_eq!(pending.data, Value::Int(10000));
    host.close("row-view-pending", device);
    let mut device = host.open("row-view-pending", None).unwrap();
    assert!(
        !device
            .query("unreadFor", "bob", &json!({"member":"member"}), 1)
            .unwrap()
            .complete
    );
    let from = server.seq().unwrap();
    while server.run_view_chunk(1).unwrap().is_some() {}
    device
        .apply(&stream_page(&mut server, "bob", from), false)
        .unwrap();
    let settled = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(settled.complete, "{settled:?}");
    assert_eq!(settled.data, Value::Int(0));
    let queued = device
        .admit(Queued {
            id: "backward".into(),
            seq: 1,
            op: "mark".into(),
            args: json!({"member":"member","readUpTo":0}),
            viewer: "bob".into(),
            now: 1,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
        })
        .unwrap();
    assert!(!queued.predictable, "{queued:?}");
}
#[test]
fn uncovered_memory() {
    uncovered(&mut Memory::new());
}
#[test]
fn uncovered_sqlite() {
    uncovered(&mut Sqlite::new("b3-uncovered"));
}

fn member_horizon<H: Host>(host: &mut H) {
    let source = SOURCE.replace("  expire at .until\n", "").replacen(
        "  sync public\ntable messages:",
        "  sync public last 1 by .id\ntable messages:",
        1,
    );
    let (mut server, mut backend) = compile(&source);
    seed(&mut server, 2);
    server
        .seed([(
            "members".into(),
            object([
                ("id", id("z-latest")),
                ("conversationId", id("c")),
                ("principal", id("carol")),
                ("readUpTo", Value::Int(0)),
                ("joinedAt", Value::Int(0)),
            ]),
        )])
        .unwrap();
    backend.schema = backend.schema.public_projection();
    let mut device = host.open("member-horizon", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(2));
}
#[test]
fn member_horizon_memory() {
    member_horizon(&mut Memory::new());
}
#[test]
fn member_horizon_sqlite() {
    member_horizon(&mut Sqlite::new("b3-member-horizon"));
}

fn source_horizon<H: Host>(host: &mut H) {
    let source = SOURCE.replace("  expire at .until\n", "").replace(
        "  sync public\nview unread",
        "  sync public last 3 by .ordinal\nview unread",
    );
    let (mut server, mut backend) = compile(&source);
    seed(&mut server, 10);
    server
        .mutate(
            "mark",
            None,
            Context::new(
                "bob",
                args(&[("member", id("member")), ("readUpTo", Value::Int(9))]),
            )
            .at(1),
        )
        .unwrap();
    backend.schema = backend.schema.public_projection();
    let mut device = host.open("source-horizon", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let mark = |seq, n| Queued {
        id: format!("mark{seq}"),
        seq,
        op: "mark".into(),
        args: json!({"member":"member","readUpTo":n}),
        viewer: "bob".into(),
        now: 1,
        new_ids: vec![],
        predicted: vec![],
        predictable: true,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
    };
    let queued = device.admit(mark(1, 10)).unwrap();
    assert!(queued.predictable, "{queued:?}");
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(0));
    let outside = device.admit(mark(2, 0)).unwrap();
    assert!(!outside.predictable, "{outside:?}");
}
#[test]
fn source_horizon_memory() {
    source_horizon(&mut Memory::new());
}
#[test]
fn source_horizon_sqlite() {
    source_horizon(&mut Sqlite::new("b3-source-horizon"));
}

fn expiry<H: Host>(host: &mut H) {
    let (mut server, mut backend) = compile(SOURCE);
    seed(&mut server, 1);
    let now = snapback4_core::now_ms();
    server
        .seed([(
            "messages".into(),
            object([
                ("id", id("expiring")),
                ("conversationId", id("c")),
                ("ordinal", Value::Int(2)),
                ("senderId", id("alice")),
                ("tombstone", Value::Bool(false)),
                ("until", Value::Int(now + 10000)),
            ]),
        )])
        .unwrap();
    backend.schema = backend.schema.public_projection();
    let mut device = host.open("view-expiry", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), now)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(2));
    assert_eq!(r.next_expiry, Some(now + 10000));
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), now + 10001)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(1));
}
#[test]
fn expiry_memory() {
    expiry(&mut Memory::new());
}
#[test]
fn expiry_sqlite() {
    expiry(&mut Sqlite::new("b3-expiry"));
}

fn covered_cut<H: Host>(host: &mut H) {
    let (mut server, mut backend) = compile(&SOURCE.replace("  expire at .until\n", ""));
    seed(&mut server, 2000);
    backend.schema = backend.schema.public_projection();
    let mut device = host.open("covered-cut", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 500).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let queued = device
        .admit(Queued {
            id: "mark".into(),
            seq: 1,
            op: "mark".into(),
            args: json!({"member":"member","readUpTo":2000}),
            viewer: "bob".into(),
            now: 1,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
        })
        .unwrap();
    assert!(!queued.predictable, "{queued:?}");
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(2000));
}
#[test]
fn covered_cut_memory() {
    covered_cut(&mut Memory::new());
}
#[test]
fn covered_cut_sqlite() {
    covered_cut(&mut Sqlite::new("b3-covered-cut"));
}

fn source_prediction<H: Host>(host: &mut H, horizon: bool) {
    let mut source = SOURCE.replace("  expire at .until\n", "");
    if horizon {
        source = source.replacen(
            "  sync public\ntable messages:",
            "  sync public last 1 by .id\ntable messages:",
            1,
        );
    } else {
        source=source.replacen("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal",1);
    }
    let (mut server, mut backend) = compile(&source);
    seed(&mut server, 1);
    server
        .seed([(
            "members".into(),
            object([
                ("id", id("z-last")),
                ("conversationId", id("c")),
                ("principal", id("carol")),
                ("readUpTo", Value::Int(0)),
                ("joinedAt", Value::Int(0)),
            ]),
        )])
        .unwrap();
    backend.schema = backend.schema.public_projection();
    let mut device = host
        .open(
            if horizon {
                "source-u-horizon"
            } else {
                "source-private-u"
            },
            Some(backend),
        )
        .unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let queued=device.admit(Queued {id:"send".into(),seq:1,op:"send".into(),args:json!({"id":"predicted","conversationId":"c","ordinal":2,"senderId":"alice","until":null}),viewer:"bob".into(),now:1,new_ids:vec!["predicted".into()],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None}).unwrap();
    assert_eq!(queued.predictable, !horizon, "{queued:?}");
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(if horizon { 1 } else { 2 }));
}
#[test]
fn private_member_source_prediction_memory() {
    source_prediction(&mut Memory::new(), false);
}
#[test]
fn private_member_source_prediction_sqlite() {
    source_prediction(&mut Sqlite::new("b3-private-predict"), false);
}
#[test]
fn member_horizon_source_queues_memory() {
    source_prediction(&mut Memory::new(), true);
}
#[test]
fn member_horizon_source_queues_sqlite() {
    source_prediction(&mut Sqlite::new("b3-horizon-predict"), true);
}
