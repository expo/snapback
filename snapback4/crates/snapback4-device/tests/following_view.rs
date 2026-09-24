//! The view spelling uses the same replicated inbox, dependencies and prediction.
mod common;
use common::{Host, Memory, Sqlite, snapshot_pages, stream_page};
use snapback4_core::{Context, Value, WriteState};
use serde_json::json;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");
fn write(e: &mut snapback4_core::Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64) {
    let out=e.mutate(op,None,Context::new(who,common::args(args)).at(at)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
}
fn id(s:&str)->Value {Value::Id(s.into())}
fn view<H: Host>(mut host: H) {
    let (mut server,backend)=common::compile(SOURCE);
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
