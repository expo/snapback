//! Membership continuity and logical uniqueness, using real server pages.
use super::super::common::*;
use serde_json::json;
use snapback4_core::{Engine, Value, schema::{Audience, Horizon, LeavePolicy, Sync}, value::object};
use snapback4_device::{device::{Backend, Device, Queued, StreamPage}, store::DeviceStore};

trait Images: DeviceStore { fn images(&self, table: &str) -> Vec<Value>; }
impl Images for snapback4_core::Store {
    fn images(&self, table: &str) -> Vec<Value> { self.rows(table).unwrap() }
}
impl Images for snapback4_device::memory::MemoryStore {
    fn images(&self, table: &str) -> Vec<Value> {
        self.export().into_iter().filter(|c| c.s == 'r' && serde_json::from_str::<(String,String)>(&c.k).unwrap().0 == table)
            .map(|c|serde_json::from_str(&c.v.unwrap()).unwrap()).collect()
    }
}

const SOURCE: &str = r#"table members:
  authorId: principal
  principal: principal
  until: time ?
  unique byAuthorPrincipal: authorId, principal
  by byPrincipal: principal, authorId
  by byExpiry: until, id
  expire at .until
  read <- allow
  sync public
table posts:
  authorId: principal
  immutable authorId
  read <- allow
  sync public
  by byAuthor: authorId, id
table likes:
  postId: posts
  immutable postId
  read <- allow
  insert <- allow
  sync public
maintain totals: count likes by postId.authorId
  read <- allow
query total():
  return totals[viewer]
mutation like(postId: posts):
  insert likes {postId}
"#;
fn backend(retain: bool, horizon: bool) -> (Engine, Backend) {
    let (_, mut b) = compile(SOURCE);
    let posts = b.schema.tables.get_mut("posts").unwrap();
    posts.sync = Some(Sync { audience: Audience::Target {table:"members".into(),prefix:vec!["authorId".into()],principal:"principal".into()}, horizon:horizon.then(|| Horizon {last:1,by:"byAuthor".into()}) });
    posts.leave = if retain { LeavePolicy::DeliveredHistory } else { LeavePolicy::UntilRevoked };
    let e = Engine::memory(b.schema.clone(),b.programs.clone()).unwrap();
    b.generation=e.generation(); (e,b)
}
fn post(name: &str) -> (String, Value) { ("posts".into(),object([("id",id(name)),("authorId",id("alice"))])) }
fn member(name: &str, until: i64) -> (String, Value) { ("members".into(),object([("id",id(name)),("authorId",id("alice")),("principal",id("alice")),("until",Value::Int(until))])) }
fn intent(target: &str, n: u64, now: i64) -> Queued {
    Queued {id:format!("q{n}"),seq:n,op:"like".into(),args:json!({"postId":target}),viewer:"alice".into(),now,new_ids:vec![format!("l{n}")],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None}
}
fn snapshot<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, now: i64) {
    let page=e.snapshot_acquisition_page_at("alice",None,100,now).unwrap();
    assert!(page.next.is_none());
    let wire=serde_json::from_value(json!({"snapshot":true,"held":page.held,"acquisitions":page.acquisitions,"events":page.events.iter().map(|event|json!({"table":event.table,"kind":event.kind.word(),"id":event.id,"data":event.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"more":false,"generation":e.generation()})).unwrap();
    d.apply(&wire,true).unwrap();
}
fn page(e: &mut Engine, after: u64, limit: usize, now: i64) -> StreamPage {
    let p=e.stream_at("alice",after,limit,now).unwrap();
    serde_json::from_value(json!({"snapshot":false,"requested_watermark":after,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,"events":p.events.iter().map(|event|json!({"table":event.table,"kind":event.kind,"id":event.id,"data":event.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":p.watermark,"more":p.more,"generation":e.generation()})).unwrap()
}
fn predict<S: DeviceStore>(d: &mut Device<S>, target: &str, n: u64, now: i64, expected: bool) {
    let result=d.admit(intent(target,n,now)).unwrap();
    assert_eq!(result.predictable,expected,"{target}: {result:?}");
    assert_eq!(!result.predicted.is_empty(),expected,"{target}: {result:?}");
}
fn renewal<H: Host>(mut host: H, split: bool, rejoined: bool) where H::Store: Images {
    let (mut e,b)=backend(true,true);
    e.seed_at([post("p")],50).unwrap();
    if !rejoined {e.seed_at([member("m",200)],75).unwrap();}
    let mut d=host.open("renewal",Some(b)).unwrap();
    snapshot(&mut e,&mut d,100);
    if rejoined {
        let from=e.seq().unwrap();
        e.seed_at([member("m",200)],100).unwrap();
        d.apply(&page(&mut e,from,100,100),false).unwrap();
    }
    let state=d.store().meta("device:history:groups").unwrap().unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&state).unwrap()["posts"]["[\"alice\"]"],if rejoined {json!({"Rejoined":["p"]})} else {json!("Held")});
    predict(&mut d,"p",1,100,true);
    assert_eq!(d.query("total","alice",&json!({}),100).unwrap().data,Value::Int(1));
    let mut from=e.seq().unwrap();
    e.seed_at([member("m",400)],150).unwrap();
    e.seed_at([member("m",600)],300).unwrap();
    let mut pages=0;
    loop {
        let p=page(&mut e,from,if split {1} else {1000},350);
        assert!(p.events.iter().all(|event|event.table!="posts"),"continuous renewal must preserve the acquisition horizon");
        d.apply(&p,false).unwrap(); pages+=1; from=p.watermark;
        if !p.more {break;}
    }
    assert_eq!(pages,if split {2} else {1});
    predict(&mut d,"p",2,350,true);
    assert_eq!(d.store().meta("device:history:groups").unwrap().unwrap(),state,"renewal must not reset coverage");
    assert_eq!(d.query("total","alice",&json!({}),350).unwrap().data,Value::Int(2));
    assert_eq!(d.queued().unwrap().iter().map(|q|q.id.as_str()).collect::<Vec<_>>(),["q1","q2"]);
    host.close("renewal",d);
    let mut d=host.open("renewal",None).unwrap();
    predict(&mut d,"p",3,350,true);
}
#[test] fn continuous_renewal_keeps_coverage_memory() {for split in [false,true] {for rejoined in [false,true] {renewal(Memory::new(),split,rejoined);}}}
#[test] fn continuous_renewal_keeps_coverage_sqlite() {for split in [false,true] {for rejoined in [false,true] {renewal(Sqlite::new("f2-renewal"),split,rejoined);}}}

fn replacement<H: Host>(mut host: H, retain: bool, predecessors: usize) where H::Store: Images {
    let (mut e,b)=backend(retain,false);
    e.seed_at([member("m00",200),post("p")],100).unwrap();
    let mut d=host.open("replacement",Some(b)).unwrap(); snapshot(&mut e,&mut d,100);
    let mut from=e.seq().unwrap();
    // Each predecessor reaches the device while live; none is swept later.
    for n in 1..predecessors {
        let at=199+n as i64;
        e.seed_at([member(&format!("m{n:02}"),at+1)],at).unwrap();
        let p=page(&mut e,from,1000,at);
        d.apply(&p,false).unwrap(); from=p.watermark;
    }
    e.seed_at([member("z-live",500)],250).unwrap();
    let p=page(&mut e,from,1000,300);
    assert!(p.events.iter().any(|event|event.table=="posts" && event.id=="p" && event.kind=="put"));
    d.apply(&p,false).unwrap();
    let members=d.store().images("members");
    assert_eq!(members.len(),predecessors+1,"expired predecessors remain physically unswept");
    assert_eq!(members.iter().filter(|row|row.field("until").unwrap().as_int().unwrap()<=300).count(),predecessors);
    predict(&mut d,"p",1,300,true);
    assert_eq!(d.query("total","alice",&json!({}),300).unwrap().data,Value::Int(1));
    assert_eq!(d.store().images("members"),members,"coverage lookup never sweeps");
    predict(&mut d,"p",2,500,false);
    assert_eq!(d.store().images("members"),members);
}
#[test] fn live_replacement_passes_unswept_members_memory() {for retain in [false,true] {for n in [1,34] {replacement(Memory::new(),retain,n);}}}
#[test] fn live_replacement_passes_unswept_members_sqlite() {for retain in [false,true] {for n in [1,34] {replacement(Sqlite::new("f2-replacement"),retain,n);}}}

fn gaps<H: Host>(mut host: H, split: bool) where H::Store: Images {
    let (mut e,b)=backend(true,true);
    e.seed_at([member("m",200),post("p")],100).unwrap();
    let mut d=host.open("gaps",Some(b)).unwrap(); snapshot(&mut e,&mut d,100);
    let mut from=e.seq().unwrap();
    for (round,fresh,at,until,stale) in [(1,"q",250,400,"p"),(2,"r",450,600,"q")] {
        e.seed_at([post(fresh)],at-10).unwrap();
        e.seed_at([member("m",until)],at).unwrap();
        loop {let p=page(&mut e,from,if split {1} else {1000},at+10);d.apply(&p,false).unwrap();from=p.watermark;if !p.more {break;}}
        assert!(d.store().images("posts").iter().any(|row|row.field("id").unwrap()==&id(stale)));
        predict(&mut d,stale,round*2,at+10,false);
        predict(&mut d,fresh,round*2+1,at+10,true);
        let state=d.store().meta("device:history:groups").unwrap().unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&state).unwrap()["posts"]["[\"alice\"]"],json!({"Rejoined":[fresh]}));
    }
}
#[test] fn actual_gaps_reset_held_and_rejoined_memory() {for split in [false,true] {gaps(Memory::new(),split);}}
#[test] fn actual_gaps_reset_held_and_rejoined_sqlite() {for split in [false,true] {gaps(Sqlite::new("f2-gap"),split);}}
