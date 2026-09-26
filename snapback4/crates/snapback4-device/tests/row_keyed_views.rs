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

fn member_horizon_prefix<H: Host>(host: &mut H, horizon: usize) {
    let source = SOURCE.replace("  expire at .until\n", "")
        .replacen("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal last 1 by .id", 1)
        + "\nquery mine():\n  return unread where .principal = viewer first 100\n";
    let source = source.replace("last 1 by .id", &format!("last {horizon} by .id"));
    let (mut server, mut backend) = compile(&source);
    seed(&mut server, 1);
    server.seed([("members".into(), object([
        ("id", id("older")), ("conversationId", id("other")),
        ("principal", id("bob")), ("readUpTo", Value::Int(0)), ("joinedAt", Value::Int(0)),
    ]))]).unwrap();
    let full = server.query("mine", Context::new("bob", Default::default()).at(1)).unwrap();
    assert!(full.complete);
    assert_eq!(full.data.as_array().unwrap().len(), 2);
    backend.schema = backend.schema.public_projection();
    let mut device = host.open("member-prefix", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let local = device.query("mine", "bob", &json!({}), 1).unwrap();
    assert_eq!(local.data.as_array().unwrap().len(), horizon.min(2));
    assert_eq!(local.complete, horizon > 2, "{local:?}");
    let held = device.query("unreadFor", "bob", &json!({"member":"older"}), 1).unwrap();
    assert!(held.complete, "{held:?}");
    let missing = device.query("unreadFor", "bob", &json!({"member":"member"}), 1).unwrap();
    assert_eq!(missing.complete, horizon > 2, "{missing:?}");
}
#[test]
fn member_horizon_prefix_memory() { for horizon in [1, 3] { member_horizon_prefix(&mut Memory::new(), horizon); } }
#[test]
fn member_horizon_prefix_sqlite() { for horizon in [1, 3] { member_horizon_prefix(&mut Sqlite::new("b3-member-prefix"), horizon); } }
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
    assert!(!r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(0));
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
                ("id", id("a-carol-outside")),
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
    assert!(queued.predictable, "{queued:?}");
    let r = device
        .query("unreadFor", "bob", &json!({"member":"member"}), 1)
        .unwrap();
    assert!(r.complete, "{r:?}");
    assert_eq!(r.data, Value::Int(2));
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
fn held_member_source_predicts_past_other_member_horizon_memory() {
    source_prediction(&mut Memory::new(), true);
}
#[test]
fn held_member_source_predicts_past_other_member_horizon_sqlite() {
    source_prediction(&mut Sqlite::new("b3-horizon-predict"), true);
}

#[test]
fn member_horizon_never_persists_excluded_note_or_attribution_in_view() {
    let source = SOURCE
        .replace("  expire at .until\n", "")
        .replace(
            "  joinedAt: int default 0",
            "  joinedAt: int default 0\n  note: text <=100 default 'excluded-note-secret'",
        )
        .replacen(
            "  sync public\ntable messages:",
            "  sync public last 1 by .joinedAt\ntable messages:",
            1,
        );
    let source = source.replace("  title: text", "  immutable title\n  title: text")
        .replace("  conversationId: conversations", "  immutable conversationId\n  conversationId: conversations")
        + "\nview memberTitles: count members by .conversationId.title\n";
    let (mut server, mut backend) = compile(&source);
    server.seed([("conversations".into(), object([("id", id("c")), ("title", Value::String("captured-title".into()))]))]).unwrap();
    seed(&mut server, 2);
    // The member with the smaller id is newest by the actual horizon column.
    server
        .seed([(
            "members".into(),
            object([
                ("id", id("a-newest")),
                ("conversationId", id("c")),
                ("principal", id("carol")),
                ("readUpTo", Value::Int(0)),
                ("joinedAt", Value::Int(1)),
                ("note", Value::String("allowed".into())),
            ]),
        )])
        .unwrap();
    assert!(server.store().rows("members").unwrap().iter().all(|row| row.field("conversationId.title").is_ok()));
    assert_eq!(
        backend.schema.tables["unread"]
            .columns
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["id", "member", "recountPending", "value"]
    );
    for row in server.store().rows("unread").unwrap() {
        assert!(row.field("note").is_err());
        assert_eq!(row.as_object().unwrap().len(), 4);
    }
    backend.schema = backend.schema.public_projection();
    let mut host = Memory::new();
    let mut device = host.open("projected-horizon", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut server, "bob", 1);
    let views = pages
        .iter()
        .flat_map(|p| &p.events)
        .filter(|e| e.table == "unread")
        .collect::<Vec<_>>();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].id, "a-newest");
    for (i, page) in pages.iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let persisted = device.store().drain();
    for change in persisted.iter().filter(|c| c.s != 'm') {
        assert!(
            !change
                .v
                .as_ref()
                .is_some_and(|v| v.contains("excluded-note-secret")),
            "{change:?}"
        );
    }
    let from = server.seq().unwrap();
    server
        .mutate(
            "send",
            None,
            Context::new(
                "bob",
                args(&[
                    ("id", id("later")),
                    ("conversationId", id("c")),
                    ("ordinal", Value::Int(3)),
                    ("senderId", id("alice")),
                    ("until", Value::Null),
                ]),
            )
            .at(1),
        )
        .unwrap();
    let page = stream_page(&mut server, "bob", from);
    assert!(
        page.events
            .iter()
            .filter(|e| e.table == "unread" && e.id == "member")
            .all(|e| e.kind == "del" && e.data.is_none())
    );
    device.apply(&page, false).unwrap();
    assert!(
        device
            .store()
            .drain()
            .iter()
            .filter(|c| c.s != 'm')
            .all(|c| !c
                .v
                .as_ref()
                .is_some_and(|v| v.contains("excluded-note-secret")))
    );
}

fn metadata_witness<H: Host>(host: &mut H) {
    let source=SOURCE.replace("  expire at .until\n", "")
        .replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  note: text <=20000000 default ''")
        + "\ntable gates:\n  member: members\n  read <- allow\n  insert <- exists unread[member = .member]\n  sync public\nmutation witness():\n  insert gates { id: 'gate', member: 'member' }\n";
    let (mut server,backend)=compile(&source);
    seed(&mut server,0);
    let mut device=host.open("metadata-witness",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"bob",100).iter().enumerate() {device.apply(page,i==0).unwrap();}
    // The 20 MB declaration cannot fit a member materialization reservation.
    // A raw authorization witness needs only its indexed lifetime, including
    // on the device's separate physical authority ledger.
    let prediction=device.predict("witness","bob",&json!({}),1,vec![],1).unwrap();
    assert!(!prediction.predicted.is_empty(),"{prediction:?}");
}
#[test]
fn metadata_witness_memory() {metadata_witness(&mut Memory::new());}
#[test]
fn metadata_witness_sqlite() {metadata_witness(&mut Sqlite::new("b3-witness"));}

fn large_live_certification<H: Host>(host: &mut H) {
    let (mut server, mut backend)=compile(&(SOURCE.to_owned()+"\nmutation useCount(member: members):\n  return unread[member]\n"));
    seed(&mut server,1200);backend.schema=backend.schema.public_projection();
    let pages=snapshot_pages(&mut server,"bob",2000);
    let mut observations=Vec::new();
    for pending in [false,true] {
        let name=format!("large-live-{pending}");
        let mut device=host.open(&name,Some(backend.clone())).unwrap();
        for (i,mut page) in pages.clone().into_iter().enumerate() {
            for event in &mut page.events {
                if event.table=="unread" {
                    let row=event.data.as_mut().unwrap();row["recountPending"]=json!(pending);
                    row["value"]=json!(if pending {0} else {1200});
                }
            }
            device.apply(&page,i==0).unwrap();
        }
        let out=device.query("unreadFor","bob",&json!({"member":"member"}),1).unwrap();
        assert!(out.complete,"{out:?}");assert_eq!(out.data,Value::Int(1200));
        observations.push(out.data);
        let entry=device.admit(Queued {id:name.clone(),seq:1,op:"useCount".into(),args:json!({"member":"member"}),viewer:"bob".into(),now:1,new_ids:vec![],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None}).unwrap();
        assert!(!entry.predictable && entry.predicted.is_empty(),"{entry:?}");
        assert_eq!(device.queued().unwrap().len(),1);
        host.close(&name,device);let mut device=host.open(&name,None).unwrap();
        assert_eq!(device.queued().unwrap().len(),1);
        let out=server.mutate("useCount",Some(&name),Context::new("bob",args(&[("member",id("member"))])).at(1)).unwrap();
        let snapback4_core::WriteState::Sent {seq,result}=out.state else {panic!("{out:?}")};
        assert_eq!(result,Value::Int(1200));
        device.settle(&name,Some(seq)).unwrap();
        let page=stream_page(&mut server,"bob",device.sync_state().unwrap().watermark);
        device.apply(&page,false).unwrap();assert!(device.queued().unwrap().is_empty());
    }
    assert_eq!(observations[0],observations[1]);
}
#[test]
fn large_live_count_queues_and_settles_memory() {large_live_certification(&mut Memory::new());}
#[test]
fn large_live_count_queues_and_settles_sqlite() {large_live_certification(&mut Sqlite::new("landing-live-count"));}

#[test]
fn device_index_preparation_preserves_projection_and_legacy_work_schema() {
    let (_, backend) = compile(SOURCE);
    let mut projected = backend.schema.public_projection();
    let public_bytes = snapback4_core::json_codec::to_text(&projected).unwrap();
    assert!(projected.tables.keys().all(|name| !projected.is_recount_work(name)));
    // Rebuild missing replica indexes without reconstructing any server tables.
    for maintain in &projected.maintains {
        let Some(key) = &maintain.row_key else { continue; };
        for name in [&maintain.source, &key.table] {
            projected.tables.get_mut(name).unwrap().indexes.retain(|name, _| !name.starts_with("$view"));
        }
    }
    projected.prepare_row_view_indexes();
    assert_eq!(snapback4_core::json_codec::to_text(&projected).unwrap(), public_bytes);

    // Offline reopen may read a backend prepared by an older device. Its
    // stored schema and identity must remain byte-for-byte reproducible.
    let mut legacy = backend.schema;
    assert!(legacy.tables.keys().any(|name| legacy.is_recount_work(name)));
    let legacy_bytes = snapback4_core::json_codec::to_text(&legacy).unwrap();
    legacy.prepare_row_view_indexes();
    assert_eq!(snapback4_core::json_codec::to_text(&legacy).unwrap(), legacy_bytes);
}
