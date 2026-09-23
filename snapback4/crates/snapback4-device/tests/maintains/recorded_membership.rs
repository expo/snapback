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

fn over_budget<H: Host>(mut host: H) where H::Store: Images {
    let (mut e, b) = backend(true, false);
    e.seed_at([member("z-live", 500), post("p")], 100).unwrap();
    let mut d = host.open("over-budget", Some(b)).unwrap();
    snapshot(&mut e, &mut d, 100);
    let from = d.state().unwrap().0;
    // Reproduce unswept physical history without 9,000 server commits: these
    // are the delivered images each sequential membership would leave behind.
    let events: Vec<_> = (0..9000).map(|n| json!({"table":"members", "kind":"put", "id":format!("m{n:05}"),
        "data":{"id":format!("m{n:05}"),"authorId":"alice","principal":"alice","until":200}})).collect();
    let p: StreamPage = serde_json::from_value(json!({"snapshot":false, "requested_watermark":from,
        "images_at":from+1,"watermark":from+1,"more":false,"generation":e.generation(),"events":events})).unwrap();
    d.apply(&p, false).unwrap();
    let members = d.store().images("members");
    assert_eq!(members.len(), 9001);
    assert_eq!(members.iter().filter(|row| row.field("until").unwrap().as_int().unwrap() <= 300).count(), 9000);
    let reply = snapback4_device::call::call_text(&mut d, &json!({"op":"admit", "entry":intent("p",1,300)}).to_string());
    let q: Queued = serde_json::from_value(reply["ok"].clone()).expect(&reply.to_string());
    assert!(!q.predictable && q.predicted.is_empty(), "coverage must stop at its meter and queue: {q:?}");
    assert_eq!(d.queued().unwrap().len(), 1);
    assert!(d.store().images("likes").is_empty(), "unpredicted admission rolls back the source");
    assert!(d.store().images("totals").is_empty(), "unpredicted admission rolls back the aggregate");
    assert_eq!(d.store().images("members"), members, "coverage never sweeps");
}
#[test] fn membership_over_budget_memory() { over_budget(Memory::new()); }
#[test] fn membership_over_budget_sqlite() { over_budget(Sqlite::new("f2-over-budget")); }

fn boundary_ladder<H: Host>(mut host: H, reads: i64) where H::Store: Images {
    for membership in [false, true] {
        let source = format!("{SOURCE}\nmutation ladder(postId: posts, work: int):\n  insert likes {{postId}}\n  for i in range(0, work):\n    ignored = posts[postId]\n  return null\n");
        let (_, mut b) = compile(&source);
        if membership {
            b.schema.tables.get_mut("posts").unwrap().sync = backend(false, false).1.schema.tables["posts"].sync.clone();
        }
        let mut e = Engine::memory(b.schema.clone(), b.programs.clone()).unwrap();
        b.generation = e.generation();
        e.seed_at([member("m", 500), post("p")], 100).unwrap();
        let mut d = host.open(&format!("boundary-{reads}-{membership}"), Some(b)).unwrap();
        snapshot(&mut e, &mut d, 100);
        let mut entry = intent("p", 1, 100);
        entry.op = "ladder".into();
        entry.args = json!({"postId":"p", "work":reads});
        let reply = snapback4_device::call::call_text(&mut d, &json!({"op":"admit", "entry":entry}).to_string());
        let server = e.mutate("ladder", Some("server"), context("alice", &[("postId", id("p")), ("work", Value::Int(reads))]).at(100).with_ids(vec!["l1".into()])).unwrap();
        assert_eq!(server.metered.examined, reads as u64 + 2, "one capture and one aggregate read");
        if reads <= 8190 {
            assert!(matches!(server.state, snapback4_core::WriteState::Sent { .. }), "{server:?}");
            let queued: Queued = serde_json::from_value(reply["ok"].clone()).expect(&format!("reads={reads}, membership={membership}: {reply}"));
            assert!(queued.predictable && queued.predicted.len() == 2, "{queued:?}");
            assert_eq!(d.queued().unwrap().len(), 1);
        } else {
            let snapback4_core::WriteState::Failed { why, .. } = server.state else { panic!("{server:?}") };
            assert_eq!(why.code, "E_BOUND");
            assert_eq!(reply["denied"]["code"], "E_BOUND", "{reply}");
            assert_eq!(reply["denied"]["message"], why.message, "same server-equivalent cut");
            assert!(d.queued().unwrap().is_empty());
            assert!(d.store().images("likes").is_empty());
            assert!(d.store().images("totals").is_empty());
        }
    }
}
#[test] fn membership_boundary_8189_memory() { boundary_ladder(Memory::new(), 8189); }
#[test] fn membership_boundary_8189_sqlite() { boundary_ladder(Sqlite::new("f2-boundary-8189"), 8189); }
#[test] fn membership_boundary_8190_memory() { boundary_ladder(Memory::new(), 8190); }
#[test] fn membership_boundary_8190_sqlite() { boundary_ladder(Sqlite::new("f2-boundary-8190"), 8190); }
#[test] fn membership_boundary_8191_memory() { boundary_ladder(Memory::new(), 8191); }
#[test] fn membership_boundary_8191_sqlite() { boundary_ladder(Sqlite::new("f2-boundary-8191"), 8191); }

// JSON counterpart to core::engine::recorded's direct Runner clock guard.
fn prediction_clock<H: Host>(mut host: H) where H::Store: Images {
    let (mut e, b) = backend(true, false);
    e.seed_at([member("m", 200), post("p")], 100).unwrap();
    let mut d = host.open("clock", Some(b)).unwrap();
    snapshot(&mut e, &mut d, 100);
    for clock in [None, Some(json!(null)), Some(json!("100")), Some(json!(true)), Some(json!(1.5)), Some(json!(u64::MAX))] {
        for op in ["predict", "admit", "enqueue"] {
            let mut entry = serde_json::to_value(intent("p", 1, 100)).unwrap();
            entry.as_object_mut().unwrap().remove("now");
            let mut request = if op == "predict" {
                json!({"op":op,"name":"like","viewer":"alice","args":{"postId":"p"},"newIds":["l1"]})
            } else { json!({"op":op,"entry":entry}) };
            if let Some(clock) = &clock {
                if op == "predict" { request["now"] = clock.clone(); } else { request["entry"]["now"] = clock.clone(); }
            }
            for text in [false, true] {
                let reply = if text { snapback4_device::call::call_text(&mut d, &request.to_string()) }
                    else { snapback4_device::call::call(&mut d, request.clone()) };
                assert_eq!(reply["denied"]["code"], "E_INPUT", "{request}: {reply}");
                assert!(d.store().images("likes").is_empty());
                assert!(d.queued().unwrap().is_empty());
            }
        }
    }
    let request = |now| json!({"op":"predict","name":"like","viewer":"alice","args":{"postId":"p"},"newIds":["l1"],"now":now});
    let expired = snapback4_device::call::call_text(&mut d, &request(300).to_string());
    assert_eq!(expired["ok"]["denied"]["code"], "E_PREDICT", "{expired}");
    let live = snapback4_device::call::call_text(&mut d, &request(100).to_string());
    assert!(live["ok"]["denied"].is_null(), "a valid clock remains accepted: {live}");
    assert_eq!(d.store().images("likes").len(), 1);
}
#[test] fn prediction_clock_json_memory() { prediction_clock(Memory::new()); }
#[test] fn prediction_clock_json_sqlite() { prediction_clock(Sqlite::new("f2-clock")); }
