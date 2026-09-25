//! The view spelling uses the same replicated inbox, dependencies and prediction.
mod common;
use common::{BoundaryMetadata, Host, Memory, Sqlite, snapshot_pages, stream_page};
use snapback4_core::{Context, Value, WriteState};
use serde_json::json;
use std::collections::BTreeSet;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");
fn write(e: &mut snapback4_core::Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64) {
    let out=e.mutate(op,None,Context::new(who,common::args(args)).at(at)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
}
fn id(s:&str)->Value {Value::Id(s.into())}
fn view<H: Host>(mut host: H) {
    let (mut server,backend)=common::compile(SOURCE);
    let indexes = &backend.schema.tables["feedFeed"].indexes;
    assert!(indexes["byReaderTime"].unique);
    assert_eq!(indexes["byReaderTime"].columns(), ["readerId", "at", "eventId", "epoch"]);
    assert_eq!(indexes["byReaderPage"].columns(), ["readerId", "at", "eventId", "epoch", "id"]);
    assert!(backend.schema.operations["home"].sites.iter().any(|site| site.table == "feedFeed" && site.index == "byReaderPage"));
    for n in 0..70 {write(&mut server,"post","alice",&[("postId",id(&format!("p{n:03}"))),("parentId",Value::Null)],n+1);}
    write(&mut server,"follow","bob",&[("actor",id("alice"))],100);
    let sites=&backend.schema.operations["home"].sites;
    for table in ["feedFeed","feedEdges","feedRemovedEvents","feedWork"] {
        assert!(sites.iter().any(|s|s.table==table),"missing live dependency {table}: {sites:?}");
    }
    let mut d=host.open("bob",Some(backend.clone())).unwrap();
    for (i,p) in snapshot_pages(&mut server,"bob",1000).iter().enumerate(){d.apply(p,i==0).unwrap();}
    let mut cursor=None; let mut count=0;
    loop {
        let page=d.query("cards","bob",&json!({"c":cursor}),200).unwrap();
        assert!(!page.complete,"reader backfill is pending");
        for row in page.data.as_array().unwrap(){
            assert_eq!(row.field("actor").unwrap(),&id("alice"));
            assert_eq!(row.field("post").unwrap().field("id").unwrap(),row.field("id").unwrap());
        }
        count+=page.data.as_array().unwrap().len();cursor=page.next;if cursor.is_none(){break;}
    }
    assert_eq!(count,50);
    host.close("bob",d);let mut d=host.open("bob",None).unwrap();
    let from=server.seq().unwrap();while server.run_timeline_chunk(500).unwrap().is_some(){}
    let before=d.query("home","bob",&json!({"c":null}),500).unwrap();
    let changed=d.apply(&stream_page(&mut server,"bob",from),false).unwrap();
    assert!(changed.iter().any(|table|before.tables.contains(table)),"delivery invalidates the observed inbox");
    assert!(changed.iter().any(|t|t=="feedWork"),"completion invalidates pending coverage");
    assert!(d.query("home","bob",&json!({"c":null}),500).unwrap().complete);
    let queued=d.admit(serde_json::from_value(json!({"id":"unfollow","seq":1,"op":"unfollow","viewer":"bob","args":{"actor":"alice"},"now":600,"predictable":true})).unwrap()).unwrap();
    assert!(!queued.predictable && queued.predicted.is_empty());
    let from=server.seq().unwrap();write(&mut server,"unfollow","bob",&[("actor",id("alice"))],600);
    d.settle(&queued.id,Some(server.seq().unwrap())).unwrap();
    d.apply(&stream_page(&mut server,"bob",from),false).unwrap();
    assert!(d.query("home","bob",&json!({"c":null}),600).unwrap().data.as_array().unwrap().is_empty());
    let from=server.seq().unwrap();write(&mut server,"follow","bob",&[("actor",id("alice"))],601);
    write(&mut server,"remove","alice",&[("postId",id("p069"))],602);
    d.apply(&stream_page(&mut server,"bob",from),false).unwrap();
    let page=d.query("home","bob",&json!({"c":null}),603).unwrap();assert!(!page.complete);
    assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(),&id("p068"));
    let queued=d.admit(serde_json::from_value(json!({"id":"follow","seq":2,"op":"follow","viewer":"bob","args":{"actor":"carol"},"now":604,"predictable":true})).unwrap()).unwrap();
    assert!(!queued.predictable && queued.predicted.is_empty());
    let mut author=host.open("alice",Some(backend)).unwrap();
    for (i,p) in snapshot_pages(&mut server,"alice",1000).iter().enumerate(){author.apply(p,i==0).unwrap();}
    let own=author.admit(serde_json::from_value(json!({"id":"own","seq":1,"op":"post","viewer":"alice","args":{"postId":"own","parentId":null},"now":1000,"predictable":true})).unwrap()).unwrap();
    assert!(own.predictable,"{own:?}");
    assert!(own.predicted.iter().any(|p|p.starts_with("feedFeed/")));
    assert_eq!(author.query("home","alice",&json!({"c":null}),1001).unwrap().data.as_array().unwrap()[0].field("id").unwrap(),&id("own"));
}
#[test]fn materialized_view_memory(){view(Memory::new());}
#[test]fn materialized_view_sqlite(){view(Sqlite::new("following-view"));}

fn refollow_before_cleanup<H: Host>(mut host: H) {
    let (mut server, backend) = common::compile(SOURCE);
    for n in 0..600 {
        write(&mut server, "post", "alice", &[("postId", id(&format!("p{n:03}"))), ("parentId", Value::Null)], n + 1);
    }
    while server.run_timeline_chunk(700).unwrap().is_some() {}
    write(&mut server, "follow", "bob", &[("actor", id("alice"))], 700);
    while server.run_timeline_chunk(700).unwrap().is_some() {}
    let mut d = host.open("bob", Some(backend)).unwrap();
    for (i, p) in snapshot_pages(&mut server, "bob", 1000).iter().enumerate() { d.apply(p, i == 0).unwrap(); }
    let old_epoch = d.store().raw_rows("feedEdges")[0].field("epoch").unwrap().clone();

    let from = server.seq().unwrap();
    write(&mut server, "unfollow", "bob", &[("actor", id("alice"))], 701);
    write(&mut server, "follow", "bob", &[("actor", id("alice"))], 702);
    let changes = stream_page(&mut server, "bob", from);
    assert!(!changes.more, "the device must receive both edge transitions");
    d.apply(&changes, false).unwrap();
    let new_epoch = d.store().raw_rows("feedEdges")[0].field("epoch").unwrap().clone();
    assert_ne!(old_epoch, new_epoch);
    let copies = d.store().raw_rows("feedFeed");
    let old: Vec<_> = copies.iter().filter(|r| r.field("epoch").unwrap() == &old_epoch).collect();
    let current: Vec<_> = copies.iter().filter(|r| r.field("epoch").unwrap() == &new_epoch).collect();
    assert_eq!(old.len(), 344, "stale copies remain on the device before cleanup");
    assert_eq!(current.len(), 50, "the new epoch contains only its synchronous preview");
    assert!(old.iter().any(|r| r.field("eventId").unwrap().as_str().unwrap() >= "p580"),
        "the first page must encounter overlapping old and new copies");

    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        // The replicated view must reject stale epochs before any cleanup arrives.
        let p = d.query("home", "bob", &json!({"c": cursor}), 703).unwrap();
        assert!(!p.complete, "cleanup and backfill are still pending");
        let rows = p.data.as_array().unwrap();
        if ids.is_empty() {
            assert_eq!(rows.len(), 20);
            assert_eq!(rows.iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect::<BTreeSet<_>>().len(), 20);
        }
        for row in rows {
            assert_eq!(current.iter().filter(|r| r.field("eventId").unwrap() == row.field("id").unwrap()).count(), 1,
                "each returned event must have exactly one copy in the new epoch");
            ids.push(row.field("id").unwrap().as_str().unwrap().to_owned());
        }
        cursor = p.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(ids, (550..600).rev().map(|n| format!("p{n:03}")).collect::<Vec<_>>());
    assert_eq!(ids.iter().collect::<BTreeSet<_>>().len(), 50);
}

#[test]fn refollow_view_before_cleanup_memory(){refollow_before_cleanup(Memory::new());}
#[test]fn refollow_view_before_cleanup_sqlite(){refollow_before_cleanup(Sqlite::new("following-view-epochs"));}

fn repeated_unfollow<H: Host>(mut host: H) {
    let (mut server, backend) = common::compile(SOURCE);
    let mut device = host.open("bob", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 1000).iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let mut submission = 0;
    for cycle in 0..3 {
        let post = format!("original-{cycle}");
        let from = server.seq().unwrap();
        write(&mut server, "post", "alice", &[("postId", id(&post)), ("parentId", Value::Null)], 10 + cycle * 10);
        device.apply(&stream_page(&mut server, "bob", from), false).unwrap();
        for (op, arguments) in [
            ("follow", json!({"actor":"alice"})),
            ("unfollow", json!({"actor":"alice"})),
            ("repost", json!({"postId":post})),
        ] {
            submission += 1;
            let now = 100 + submission;
            let queued = device.admit(serde_json::from_value(json!({
                "id":format!("write-{submission}"), "seq":submission, "op":op,
                "viewer":"bob", "args":arguments, "now":now, "predictable":true,
            })).unwrap()).unwrap();
            assert_eq!(queued.predictable, op == "repost", "{queued:?}");
            let predicted = device.query("cards", "bob", &json!({"c":null}), now).unwrap();
            if op == "repost" {
                assert!(predicted.data.as_array().unwrap().iter().all(|r| r.field("repost") == Ok(&Value::Bool(true))), "cycle {cycle}: {predicted:?}");
            }
            let from = server.seq().unwrap();
            let outcome = server.mutate(op, Some(&queued.id), Context::new("bob", arguments.as_object().unwrap().iter().map(|(k,v)| (k.clone(), id(v.as_str().unwrap()))).collect())
                .at(now).with_ids(queued.new_ids)).unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
            if cycle % 2 == 0 { device.settle(&queued.id, Some(server.seq().unwrap())).unwrap(); }
            device.apply(&stream_page(&mut server, "bob", from), false).unwrap();
            if cycle % 2 == 1 { device.settle(&queued.id, Some(server.seq().unwrap())).unwrap(); }
            let local = device.query("cards", "bob", &json!({"c":null}), now).unwrap();
            let online = server.query("cards", Context::new("bob", common::args(&[("c", Value::Null)])).at(now)).unwrap();
            assert_eq!(local.data, online.data, "cycle {cycle}, {op}");
        }
    }
}

#[test] fn repeated_unfollow_memory() { repeated_unfollow(Memory::new()); }
#[test] fn repeated_unfollow_sqlite() { repeated_unfollow(Sqlite::new("unfollow-cycles")); }
