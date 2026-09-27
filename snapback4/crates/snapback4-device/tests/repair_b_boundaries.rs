//! Deferred acquisition, leave/history and reset behavior on both stores.
mod common;
use common::*;
use snapback4_core::value::{Value, object};
use snapback4_device::device::{Device, Queued, StreamPage};
use snapback4_device::store::DeviceStore;
use serde_json::json;

const SOURCE: &str = r#"
use personas alice
table posts:
  owner: principal
  n: int
  photo: image <=100000 ?
  by byN: owner, n, id
  read <- .owner = viewer
  update <- allow
  RETAIN
  sync to .owner last 2 by byN
query one(k: posts):
  return posts[k]
query list():
  return posts[viewer] first 10 by byN {id, n}
mutation bump():
  p = posts['a'] ! else NOT_FOUND
  update posts['a'] {n: p.n + 1}
"#;
fn row(k: &str, n: i64) -> serde_json::Value { json!({"table":"posts","kind":"put","id":k,"data":{"id":k,"owner":"dev:alice","n":n,"photo":{"id":format!("image-{k}-{n}"),"type":"image/png","bytes":26,"width":2,"height":3,"duration":null}}}) }
fn marker(at: usize, floor: Option<String>) -> serde_json::Value { json!({"at":at,"table":"posts","index":"byN","group":["dev:alice"],"floor":floor}) }
fn frame(w: u64, ev: Vec<serde_json::Value>, markers: Vec<serde_json::Value>) -> StreamPage {
    serde_json::from_value(json!({"snapshot":false,"events":ev,"acquisitions":markers,"watermark":w,"more":true,"images_at":w+10,"committed_above":{"q":w+10}})).unwrap()
}
// Synthetic event pages still echo the request position used to obtain them.
fn apply_frame<S: DeviceStore>(d: &mut Device<S>, page: &StreamPage, first: bool) -> Result<Vec<String>, snapback4_core::error::RuntimeError> {
    let mut page = page.clone();
    page.store_id.get_or_insert_with(|| "media-store".into());
    page.requested_watermark = Some(d.sync_state_read()?.transfer_watermark);
    d.apply(&page, first)
}
fn admit<S: DeviceStore>(d: &mut Device<S>) {
    d.admit(Queued {id:"q".into(), seq:0, op:"bump".into(), args:json!({}), new_ids:vec![], predicted:vec![], viewer:"dev:alice".into(),now:100,predictable:true,sent_seq: None, receipt_store: None,observed_seq:None, dispatch: None}).unwrap();
    d.sync_state().unwrap();
}
fn list<S: DeviceStore>(d: &mut Device<S>) -> serde_json::Value {
    snapback4_core::wire::to_json(&d.query("list","dev:alice",&json!({}),100).unwrap().data)
}
// @ref LLP 3000.019#3.5 — deferred publication must revalidate the download's home.
fn media<S: DeviceStore>(d: &mut Device<S>, row: &str, n: i64) -> serde_json::Value {
    d.asset_home(&format!("image-{row}-{n}"), "dev:alice", 100,
        &json!({"store_id":"media-store","table":"posts", "row":row, "column":"photo"})).unwrap()
}
fn effects<H: Host>(h: &mut H, retain: bool) {
    let (mut e,b) = compile(&SOURCE.replace("RETAIN",if retain {"retain delivered-history"} else {""}));
    e.seed([("posts".into(),object([("id",id("a")),("owner",id("dev:alice")),("n",Value::Int(10))]))]).unwrap();
    let mut d=h.open("buffered",Some(b.clone())).unwrap();
    let mut control=h.open("control",Some(b)).unwrap();
    let initial=snapshot_pages(&mut e,"dev:alice",100).remove(0);
    apply_frame(&mut d,&initial,true).unwrap(); apply_frame(&mut control,&initial,true).unwrap();
    admit(&mut d);
    let before=d.store().boundary_entries();
    let w=d.state().unwrap().0;
    // Same page order as production: marker, row, marker, scope; history and
    // joined run after row effects. A second page re-joins and recreates a row.
    let scope=json!({"table":"posts","kind":"scope","id":"leave","data":["dev:alice"]});
    let mut p=frame(w+1,vec![row("x",5),scope],vec![marker(0,None),marker(1,Some("whole".into()))]);
    apply_frame(&mut d,&p,false).unwrap();
    let mut direct=p.clone(); direct.images_at=Some(direct.watermark); direct.committed_above.clear(); apply_frame(&mut control,&direct,false).unwrap();
    assert_eq!(d.state().unwrap().0,w);
    assert_eq!(d.store().boundary_entries(),before);
    assert_eq!(list(&mut d),json!([{"id":"a","n":11,"pending":true}]));
    p=frame(w+2,vec![row("x",6)],vec![marker(0,None),marker(1,Some("whole".into()))]);
    p.joined=serde_json::from_value(json!({"posts":[["dev:alice"]]})).unwrap();
    apply_frame(&mut d,&p,false).unwrap();
    direct=p.clone(); direct.images_at=Some(direct.watermark); direct.committed_above.clear(); apply_frame(&mut control,&direct,false).unwrap();
    assert_eq!(media(&mut d,"x",6),serde_json::Value::Null);
    h.close("buffered",d);
    let mut d=h.open("buffered",None).unwrap();
    assert_eq!(list(&mut d),json!([{"id":"a","n":11,"pending":true}]));
    d.settle("q",None).unwrap();
    let mut finish=frame(w+2,vec![],vec![]); finish.images_at=Some(w+2); finish.committed_above.clear(); finish.more=false;
    apply_frame(&mut d,&finish,false).unwrap();
    assert_eq!(list(&mut d),list(&mut control));
    assert_eq!(media(&mut d,"x",6),media(&mut control,"x",6));
    assert_eq!(media(&mut d,"x",6)["row"],"x");
    assert_eq!(media(&mut d,"x",5),serde_json::Value::Null);
    assert_eq!(d.store().boundary_entries(),control.store().boundary_entries());
    assert_eq!(d.store().meta("device:history:groups").unwrap(),control.store().meta("device:history:groups").unwrap());
}
#[test] fn scope_joined_markers_history_preserve_order() { for retain in [false,true] { effects(&mut Memory::new(),retain); effects(&mut Sqlite::new("repair-effects"),retain); } }

fn boundary_gate<H: Host>(h: &mut H, recreate: bool) {
    let (mut e,b)=compile(&SOURCE.replace("RETAIN",""));
    e.seed([("posts".into(),object([("id",id("a")),("owner",id("dev:alice")),("n",Value::Int(10))]))]).unwrap();
    let mut d=h.open("boundary",Some(b)).unwrap();
    apply_frame(&mut d,&snapshot_pages(&mut e,"dev:alice",100)[0],true).unwrap();
    admit(&mut d);
    let w=d.state().unwrap().0;
    let floor=snapback4_core::value::encode_bytes_hex(&snapback4_core::key::encode(&[id("dev:alice"),Value::Int(10),id("a"),id("a")]));
    let name=if recreate {"a"} else {"low"};
    let events=if recreate {vec![json!({"table":"posts","kind":"scope","id":"leave","data":["dev:alice"]}),row(name,5)]} else {vec![row(name,5)]};
    let p=frame(w+1,events,vec![marker(usize::from(recreate),None),marker(if recreate {2} else {1},Some(floor))]);
    apply_frame(&mut d,&p,false).unwrap();
    assert_eq!(d.state().unwrap().0,w);
    assert_eq!(d.sync_state().unwrap().transfer_watermark,w+1);
    d.settle("q",None).unwrap();
    let mut finish=frame(w+1,vec![],vec![]); finish.images_at=Some(w+1); finish.committed_above.clear(); finish.more=false;
    apply_frame(&mut d,&finish,false).unwrap();
    assert_eq!(d.query("one","dev:alice",&json!({"k":name}),100).unwrap().data,Value::Null);
    assert_eq!(list(&mut d),if recreate {json!([])} else {json!([{"id":"a","n":10}])});
    assert_eq!(media(&mut d,name,5),serde_json::Value::Null);
}
#[test] fn deferred_images_recheck_the_published_acquisition_floor() { for recreate in [false,true] { boundary_gate(&mut Memory::new(),recreate); boundary_gate(&mut Sqlite::new("repair-floor"),recreate); } }

fn resets<H: Host>(h: &mut H, kind: &str) {
    let (mut e,b)=compile(&SOURCE.replace("RETAIN",""));
    e.seed([("posts".into(),object([("id",id("a")),("owner",id("dev:alice")),("n",Value::Int(10))]))]).unwrap();
    let mut d=h.open("reset",Some(b.clone())).unwrap();
    apply_frame(&mut d,&snapshot_pages(&mut e,"dev:alice",100)[0],true).unwrap();
    admit(&mut d);
    let w=d.state().unwrap().0;
    let mut deferred=frame(w+1,vec![row("old",99)],vec![]);
    {
        let mut q=d.queued().unwrap()[0].clone(); q.id="q2".into(); q.seq=0;
        d.admit(q).unwrap(); d.sync_state().unwrap();
        deferred.images_at=Some(w+2);
        deferred.acknowledged.insert("q".into(),w+1);
        deferred.committed_above.clear();
        deferred.committed_above.insert("q2".into(),w+2);
    }
    apply_frame(&mut d,&deferred,false).unwrap();
    assert!(d.store().meta("device:deferred:cursor").unwrap().is_some());
    assert!(d.store().meta("device:deferred:acks").unwrap().unwrap().contains("q"));
    match kind {
        "clear" => d.clear_rows().unwrap(),
        "adopt" => { let mut b=b; b.generation+=1; d.adopt(b).unwrap(); },
        "open" => { h.close("reset",d); let mut b=b; b.generation+=1; d=h.open("reset",Some(b)).unwrap(); },
        "snapshot" => {
            let mut p=snapshot_pages(&mut e,"dev:alice",100)[0].clone(); p.watermark=w+2;
            apply_frame(&mut d,&p,true).unwrap();
            assert!(d.store().meta("device:deferred:acks").unwrap().is_none());
            assert!(d.queued().unwrap().iter().all(|q| q.observed_seq.is_none()), "discarded receipts cannot retire predictions");
            assert_eq!(d.query("one","dev:alice",&json!({"k":"old"}),100).unwrap().data,Value::Null);
            let mut following=frame(w+2,vec![],vec![]); following.more=false; following.images_at=Some(w+2); following.committed_above.clear();
            apply_frame(&mut d,&following,false).unwrap();
            assert_eq!(d.query("one","dev:alice",&json!({"k":"old"}),100).unwrap().data,Value::Null);
        },
        "identity" => { d.settle("q2",Some(w+2)).unwrap(); let mut p=frame(w+1,vec![],vec![]); p.store_id=Some("replacement".into()); let observation=d.observe_store(&p).unwrap(); assert!(observation.reset);
            assert_eq!(observation.retired.get("q2"),Some(&(w+2)));
            assert_eq!(d.queued().unwrap().len(),1);
            assert!(d.queued().unwrap().iter().all(|q| q.observed_seq.is_none())); },
        _ => unreachable!(),
    }
    assert!(d.store().meta("device:deferred:cursor").unwrap().is_none());
    assert!(d.store().meta("device:deferred:acks").unwrap().is_none());
}
#[test] fn resets_discard_private_stream_state_even_when_images_survive() { for k in ["clear","adopt","open","snapshot","identity"] { resets(&mut Memory::new(),k); resets(&mut Sqlite::new("repair-reset"),k); } }

fn moved_private<H: Host>(h: &mut H) {
    let (mut e,b)=compile(&SOURCE.replace("RETAIN",""));
    e.seed([("posts".into(),object([("id",id("a")),("owner",id("dev:alice")),("n",Value::Int(10))]))]).unwrap();
    let mut d=h.open("move",Some(b.clone())).unwrap();
    let mut control=h.open("move-control",Some(b)).unwrap();
    let initial=snapshot_pages(&mut e,"dev:alice",100).remove(0);
    apply_frame(&mut d,&initial,true).unwrap(); apply_frame(&mut control,&initial,true).unwrap();
    admit(&mut d);
    let w=d.state().unwrap().0;
    let floor=snapback4_core::value::encode_bytes_hex(&snapback4_core::key::encode(&[id("dev:alice"),Value::Int(10),id("a"),id("a")]));
    let mut first=frame(w+1,vec![row("moved",15)],vec![marker(0,None),marker(1,Some(floor))]);
    first.joined=serde_json::from_value(json!({"posts":[["dev:alice"]]})).unwrap();
    let second=frame(w+2,vec![row("moved",5)],vec![]);
    for p in [&first,&second] {
        d.sync_state().unwrap();
        assert!(apply_frame(&mut d,p,false).unwrap().is_empty());
        let mut direct=p.clone();direct.images_at=Some(direct.watermark);direct.committed_above.clear();
        apply_frame(&mut control,&direct,false).unwrap();
    }
    h.close("move",d); let mut d=h.open("move",None).unwrap();
    assert_eq!(d.state().unwrap().0,w);
    assert_eq!(d.sync_state().unwrap().transfer_watermark,w+2);
    d.settle("q",None).unwrap();
    let mut finish=frame(w+2,vec![],vec![]);finish.more=false;finish.images_at=Some(w+2);finish.committed_above.clear();
    apply_frame(&mut d,&finish,false).unwrap();
    assert_eq!(list(&mut d),list(&mut control));
    assert_eq!(d.query("one","dev:alice",&json!({"k":"moved"}),100).unwrap().data.field("n").unwrap(),&Value::Int(5));
}
#[test] fn acquired_private_row_keeps_holding_after_moving_below_floor() {
    moved_private(&mut Memory::new()); moved_private(&mut Sqlite::new("moved-private"));
}

fn upgrade_evidence<H: Host>(h: &mut H, mode: usize, recreate: bool) {
    let (mut e,b) = compile(&SOURCE.replace("RETAIN", ""));
    e.seed([("posts".into(),object([("id",id("a")),("owner",id("dev:alice")),("n",Value::Int(10))]))]).unwrap();
    let mut d = h.open("upgrade",Some(b.clone())).unwrap();
    let mut control = h.open("upgrade-control",Some(b)).unwrap();
    let initial = snapshot_pages(&mut e,"dev:alice",100).remove(0);
    apply_frame(&mut d,&initial,true).unwrap(); apply_frame(&mut control,&initial,true).unwrap();
    admit(&mut d);
    let w = d.state().unwrap().0;
    let floor = || snapback4_core::value::encode_bytes_hex(&snapback4_core::key::encode(&[id("dev:alice"),Value::Int(30),id("floor"),id("floor")]));
    let first = if mode == 0 {
        // Qualifies just before completion, then moves below it on this page.
        frame(w+1,vec![row("x",5),row("x",35),row("x",4)],vec![marker(0,None),marker(2,Some(floor()))])
    } else if mode == 1 {
        frame(w+1,vec![row("x",5)],vec![marker(0,None),marker(1,Some(floor()))])
    } else {
        frame(w+1,vec![row("x",5),row("x",35)],vec![marker(0,None)])
    };
    let mut pages = vec![first];
    if mode == 1 { pages.push(frame(w+2,vec![row("x",35),row("x",4)],vec![])); }
    if mode == 2 {
        pages.push(frame(w+2,vec![],vec![marker(0,Some(floor()))]));
        pages.push(frame(w+3,vec![row("x",4)],vec![]));
    }
    let last = w+4;
    if recreate {
        // Deletion ends the hold; a recreation starts with fresh evidence.
        pages.push(frame(last,vec![json!({"table":"posts","kind":"scope","id":"left","data":["dev:alice"]}),row("x",3)],vec![marker(1,None),marker(2,Some(floor()))]));
    }
    for p in &pages {
        d.sync_state().unwrap(); apply_frame(&mut d,p,false).unwrap();
        let mut direct=p.clone(); direct.images_at=Some(p.watermark); direct.committed_above.clear();
        apply_frame(&mut control,&direct,false).unwrap();
        h.close("upgrade",d); d=h.open("upgrade",None).unwrap();
    }
    h.close("upgrade",d); let mut d=h.open("upgrade",None).unwrap();
    assert_eq!(d.state().unwrap().0,w);
    d.settle("q",None).unwrap();
    let mut finish=frame(last,vec![],vec![]);finish.more=false;finish.images_at=Some(last);finish.committed_above.clear();
    apply_frame(&mut d,&finish,false).unwrap();
    let result=d.query("one","dev:alice",&json!({"k":"x"}),100).unwrap().data;
    if recreate { assert_eq!(result,Value::Null); }
    else {
        assert_eq!(result.field("n").unwrap(),&Value::Int(4));
        assert_eq!(list(&mut d),list(&mut control));
        assert_eq!(media(&mut d,"x",4),media(&mut control,"x",4));
        assert_eq!(media(&mut d,"x",4)["row"],"x");
    }
}
mod later_qualifying_image_upgrades_admission_and_moves_keep_it {
    use super::*;
    #[test] fn memory() { for mode in [0,1,2] { for recreate in [false,true] {
        upgrade_evidence(&mut Memory::new(),mode,recreate);
    } } }
    #[test] fn sqlite() { for mode in [0,1,2] { for recreate in [false,true] {
        upgrade_evidence(&mut Sqlite::new("upgrade-evidence"),mode,recreate);
    } } }
}
