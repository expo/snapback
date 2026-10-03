//! Executed fault schedules exported for the actual wasm/native dispatcher replay.
// @ref LLP 3000.016#5 — a source image owns its event state through every acquisition path.
mod common;
use common::{args, id, BoundaryMetadata, snapshot_pages};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_device::{device::{Backend, Device, StreamPage}, memory::MemoryStore};

fn source(posts: &str, reposts: &str) -> String {
    include_str!("../../snapback4-lang/tests/fixtures/following-view.q")
        .replacen("sync public", posts, 1)
        .replace("sync public\n\ntable follows", &format!("{reposts}\n\ntable follows"))
        .replace("  removed: bool default false", "  body: text <=100 default 'first'\n  removed: bool default false") + r#"
mutation conditionalPost(postId: id, parentId: posts ?):
  if parentId = null:
    insert posts { id: postId, authorId: viewer, parentId: null, at: now }
  else:
    insert posts { id: postId, authorId: viewer, parentId, at: now }
mutation conditionalRemove(postId: posts, removeIt: bool):
  if removeIt:
    update posts[postId] { removed: true }
mutation edit(postId: posts):
  update posts[postId] { body: 'edited' }
mutation birthAndEdit(postId: id, at: time):
  insert posts { id: postId, authorId: viewer, at }
  update posts[postId] { body: 'edited' }
mutation plainRepost(repostId: id, postId: posts):
  insert reposts { id: repostId, actorId: viewer, postId, at: now }
query event(eventId: id):
  return feedPosts[eventId]
query events():
  return feedPosts last 100 by .at
query original(actor: principal, postId: id):
  return feedPosts[actor, postId, false]
query postRow(postId: posts):
  return posts[postId]
query tombstone(eventId: id):
  return exists feedRemovedEvents[eventId = eventId]
mutation needsEvent(eventId: id):
  require exists feedPosts[eventId] else NO_EVENT
table gates:
  eventId: id
  public 'rule probe witness'
  insert <- exists feedPosts[id = .eventId]
  sync public
mutation gated(eventId: id):
  insert gates { id: 'gate', eventId }
table actorGates:
  actor: principal
  public 'bounded population witness'
  insert <- .actor = viewer
  sync public
mutation gatedActor(actor: principal):
  require exists feedPosts where .actorId = actor else NO_EVENT
  insert actorGates { id: 'gate', actor }
"#
}

struct Trace { name: String, backend: Backend, device: Device<MemoryStore>, calls: Vec<Json>, seq: u64, kept: Vec<snapback4_device::memory::Change> }
impl Trace {
    fn new(name: &str, backend: Backend) -> Self {
        let device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
        Self { name: name.into(), backend, device, calls: vec![], seq: 0, kept: vec![] }
    }
    fn call(&mut self, request: Json) -> Json {
        let expected = snapback4_device::call::call(&mut self.device, request.clone());
        self.calls.push(json!({"request":request,"expected":expected}));
        expected
    }
    fn apply(&mut self, page: &StreamPage, first: bool) {
        let out = self.call(json!({"op":"apply","page":page,"first":first}));
        assert!(out.get("denied").is_none(), "{}: {out}", self.name);
    }
    fn acquire(&mut self, e: &mut Engine) {
        for (n, page) in snapshot_pages(e, "alice", 7).iter().enumerate() { self.apply(page, n == 0); }
    }
    fn sync(&mut self, e: &mut Engine, limit: usize) {
        loop {
            let page = stream(e, self.device.state().unwrap().0, limit);
            self.apply(&page, false);
            if !page.more { break; }
        }
    }
    fn query(&mut self, name: &str, input: Json) -> Json {
        self.call(json!({"op":"query","name":name,"viewer":"alice","args":input,"now":1000}))
    }
    fn predict(&mut self, name: &str, input: Json) -> Json {
        self.call(json!({"op":"predict","name":name,"viewer":"alice","args":input,"now":1000,"entropy":17,"newIds":["predicted-event-1","predicted-event-2"]}))
    }
    fn admit(&mut self, name: &str, input: Json) -> Json {
        self.seq += 1;
        self.call(json!({"op":"admit","entry":{"id":format!("intent-{}",self.seq),"seq":self.seq,"op":name,"viewer":"alice","args":input,"now":1000,"entropy":17,"new_ids":["predicted-event-1","predicted-event-2"],"predictable":true}}))
    }
    fn withdraw(&mut self) { self.call(json!({"op":"withdraw","predicted":[]})); }
    fn reopen(&mut self) {
        self.kept.extend(self.device.store().drain());
        let mut store = MemoryStore::new(); store.load(self.kept.clone()).unwrap();
        self.device = Device::open_store(store, None).unwrap();
        self.calls.push(json!({"reopen":true}));
    }
    fn finish(self) -> Json { json!({"name":self.name,"backend":self.backend,"calls":self.calls}) }
}
fn write(e: &mut Engine, op: &str, input: &[(&str, Value)], ids: &[&str]) {
    let out = e.mutate(op, None, Context::new("alice", args(input)).at(100).with_ids(ids.iter().map(|s| s.to_string())).with_entropy(41)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}
fn post(e: &mut Engine, name: &str) { write(e,"post",&[("postId",id(name)),("parentId",Value::Null)],&[]); }
fn repost(e: &mut Engine, name: &str, post: &str, event: &str) {
    write(e,"plainRepost",&[("repostId",id(name)),("postId",id(post))],&[event,"second-event"]);
}
fn drain(e: &mut Engine) { while e.run_timeline_chunk(500).unwrap().is_some() {} }
fn stream(e: &mut Engine, watermark: u64, limit: usize) -> StreamPage {
    let page = e.stream("alice", watermark, limit).unwrap();
    serde_json::from_value(json!({"snapshot":false,"requested_watermark":watermark,"images_at":page.images_at,
        "joined":page.joined,"acquisitions":page.acquisitions,"events":page.events.iter().map(|v| json!({"table":v.table,"kind":v.kind,"id":v.id,"data":v.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "watermark":page.watermark,"more":page.more,"generation":e.generation()})).unwrap()
}
fn snapshot(e: &mut Engine, after: Option<&str>) -> StreamPage {
    let page = e.snapshot_acquisition_page_at("alice", after, 1, 1000).unwrap();
    let next = page.next.map(|v|v.encode());
    serde_json::from_value(json!({"snapshot":true,"after":after,"held":page.held,"acquisitions":page.acquisitions,
        "events":page.events.iter().map(|v| json!({"table":v.table,"kind":v.kind.word(),"id":v.id,"data":v.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "watermark":page.watermark,"more":next.is_some(),"next":next,"generation":e.generation()})).unwrap()
}
fn unavailable(value: &Json) { assert_eq!(value["ok"]["loading"], true, "{value}"); assert!(value["ok"].get("data").is_none(),"{value}"); }
fn predicts(value: &Json) { assert!(value["ok"].get("predicted").is_some(),"{value}"); assert!(value["ok"].get("denied").is_none(),"{value}"); }
fn refusal(value: &Json, code: &str) { assert_eq!(value["ok"]["denied"]["code"], code,"{value}"); }

fn log_order() -> Json {
    let (mut e, backend) = common::compile(&source("sync public last 10 by .at","sync public"));
    let mut t = Trace::new("birth order, whole floor, removal normalized across commits",backend);
    t.acquire(&mut e);
    write(&mut e,"birthAndEdit",&[("postId",id("p")),("at",Value::Int(-20))],&[]);
    t.sync(&mut e,1);
    assert_eq!(t.query("postRow",json!({"postId":"p"}))["ok"]["data"]["body"],"edited");
    predicts(&t.predict("plainRepost",json!({"repostId":"r","postId":"p"})));
    t.withdraw();
    let before = e.seq().unwrap();
    write(&mut e,"edit",&[("postId",id("p"))],&[]);
    write(&mut e,"remove",&[("postId",id("p"))],&[]);
    let a = stream(&mut e,before,1);
    assert!(a.more && a.images_at.unwrap() > a.watermark);
    assert!(a.events.iter().any(|v|v.table=="posts" && v.data.as_ref().is_some_and(|row|row["$timeline:feed:post"]==false)));
    t.apply(&a,false);
    refusal(&t.predict("plainRepost",json!({"repostId":"r","postId":"p"})),"FEED_POST_NOT_FOUND");
    t.sync(&mut e,1); drain(&mut e); t.sync(&mut e,1);
    refusal(&t.predict("plainRepost",json!({"repostId":"r","postId":"p"})),"FEED_POST_NOT_FOUND");
    t.finish()
}

fn snapshot_reincarnation(recreate: bool) -> Json {
    let (mut e, backend) = common::compile(&source("sync public last 10 by .at","sync public last 10 by .at"));
    post(&mut e,"p"); post(&mut e,"q"); drain(&mut e);
    let first = snapshot(&mut e,None); assert!(first.more);
    repost(&mut e,"r","p","E");
    let mut pages = vec![first];
    while let Some(next) = pages.last().unwrap().next.clone() { pages.push(snapshot(&mut e,Some(&next))); }
    assert!(pages.iter().flat_map(|p|&p.events).any(|v|v.table=="reposts" && v.data.as_ref().is_some_and(|r|r["$timeline:feed:repost"]=="E")));
    write(&mut e,"unrepost",&[("postId",id("p"))],&[]);
    if recreate { repost(&mut e,"r","q","F"); }
    let mut t = Trace::new(if recreate { "snapshot catch-up replaces a reused source id" } else { "snapshot catches delete before serving insert" },backend);
    t.apply(&pages[0],true);
    t.reopen();
    // Reopening abandons a partially staged acquisition; restart from page one.
    for (n,page) in pages.iter().enumerate() { t.apply(page,n==0); }
    t.sync(&mut e,1);
    assert!(t.device.store().raw_rows("feedPosts").is_empty());
    assert_eq!(t.device.store().raw_rows("reposts").len(),usize::from(recreate));
    if recreate {
        assert_eq!(t.device.store().raw_rows("reposts")[0].field("$timeline:feed:repost").unwrap(),&id("F"));
        predicts(&t.predict("unrepost",json!({"postId":"q"})));
        assert_eq!(t.query("tombstone",json!({"eventId":"F"}))["ok"]["data"],true);
    } else { predicts(&t.predict("plainRepost",json!({"repostId":"new","postId":"p"}))); }
    unavailable(&t.query("event",json!({"eventId":"E"})));
    t.finish()
}

fn reused_event(full_originals: bool, split: bool) -> Json {
    let (mut e,backend) = common::compile(&source(if full_originals { "sync public" } else { "sync public last 10 by .at" },"sync public last 10 by .at"));
    post(&mut e,"E"); post(&mut e,"q");
    if !full_originals { repost(&mut e,"old","E","reused"); }
    drain(&mut e);
    let mut t = Trace::new(&format!("event id reuse full-originals={full_originals} split={split}"),backend);
    t.acquire(&mut e);
    repost(&mut e,"r","q","F");
    let reuse = if full_originals { write(&mut e,"remove",&[("postId",id("E"))],&[]); "E" }
        else { write(&mut e,"unrepost",&[("postId",id("E"))],&[]); "reused" };
    drain(&mut e);
    write(&mut e,"unrepost",&[("postId",id("q"))],&[]);
    drain(&mut e);
    repost(&mut e,"r","q",reuse);
    t.sync(&mut e,if split { 1 } else { 1000 });
    assert_eq!(t.device.store().raw_rows("reposts")[0].field("$timeline:feed:repost").unwrap(),&id(reuse));
    assert!(t.device.store().raw_rows("feedPosts").iter().all(|r|r.field("repost").unwrap()==&Value::Bool(false)));
    predicts(&t.predict("unrepost",json!({"postId":"q"})));
    assert_eq!(t.query("tombstone",json!({"eventId":reuse}))["ok"]["data"],true);
    t.finish()
}

fn mixed(reposts: &str) -> Json {
    let (mut e,backend) = common::compile(&source("sync public",reposts));
    post(&mut e,"p"); repost(&mut e,"r","p","E");
    let mut t = Trace::new(&format!("ordinary event reads with {reposts}"),backend); t.acquire(&mut e);
    unavailable(&t.query("event",json!({"eventId":"E"})));
    unavailable(&t.query("events",json!({})));
    for (name,input) in [("event",json!({"eventId":"E"})),("events",json!({}))] {
        let out=t.query(name,input); assert_eq!(out["ok"]["speculative"],true,"{out}");
    }
    assert_eq!(t.query("original",json!({"actor":"alice","postId":"missing"}))["ok"]["data"],Json::Null);
    let hit=t.query("event",json!({"eventId":"p"})); assert_eq!(hit["ok"]["data"]["id"],"p"); assert_eq!(hit["ok"]["unknown"],false); assert!(hit["ok"].get("speculative").is_none(), "non-speculative replies keep the old wire: {hit}");
    let out=t.admit("needsEvent",json!({"eventId":"E"})); assert_eq!(out["ok"]["predictable"],false,"{out}");
    for (name, input) in [("gated",json!({"eventId":"E"})),("gatedActor",json!({"actor":"unheld"}))] {
        let out=t.admit(name,input); assert_eq!(out["ok"]["predictable"],false,"{out}");
        assert!(out["ok"].get("denied").is_none(),"{out}");
    }
    t.finish()
}

fn aggregates(online: bool) -> Json {
    let s = source("sync public last 10 by .at","sync public") + "\nview totals: count feedPosts by .actorId\n" + if online { "  online only\n" } else { "" };
    let (mut e,backend) = common::compile(&s); post(&mut e,"p");
    // One operation accepts either a reply or an original: its filter cannot
    // be decided statically, so both calls must reach the runtime guard.
    assert_eq!(backend.schema.operations["post"].predicts.as_deref(),Some("eligible"));
    let mut t = Trace::new(&format!("aggregate fence online={online}"),backend); t.acquire(&mut e);
    predicts(&t.predict("post",json!({"postId":"reply","parentId":"p"})));
    assert_eq!(t.query("postRow",json!({"postId":"reply"}))["ok"]["data"]["parentId"],"p");
    t.withdraw();
    predicts(&t.predict("conditionalPost",json!({"postId":"branch-reply","parentId":"p"})));
    t.withdraw();
    let conditional=t.predict("conditionalPost",json!({"postId":"branch-post","parentId":null}));
    if online { predicts(&conditional); } else { assert!(conditional["ok"]["denied"]["message"].as_str().is_some_and(|s|s.contains("totals")),"{conditional}"); }
    t.withdraw();
    predicts(&t.predict("edit",json!({"postId":"p"})));
    assert_eq!(t.query("postRow",json!({"postId":"p"}))["ok"]["data"]["body"],"edited");
    t.withdraw();
    let out=t.predict("post",json!({"postId":"another","parentId":null}));
    if online { predicts(&out); } else {
        assert!(out["ok"]["denied"]["message"].as_str().is_some_and(|s|s.contains("totals")),"{out}");
        assert!(out["ok"].get("predicted").is_none(),"{out}");
        assert!(t.device.store().raw_rows("posts").iter().all(|r|r.field("id").unwrap()!=&id("another")));
    }
    t.withdraw();
    let out = t.admit("post",json!({"postId":"new","parentId":null}));
    assert_eq!(out["ok"]["predictable"],online,"{out}");
    if !online { assert_eq!(out["ok"]["predicted"],json!([])); }
    t.finish()
}

fn aggregate_unrepost(online: bool) -> Json {
    let s = source("sync public","sync public last 10 by .at") + "\nview totals: count feedPosts by .actorId\n" + if online { "  online only\n" } else { "" };
    let (mut e,backend)=common::compile(&s); post(&mut e,"p"); repost(&mut e,"r","p","E");
    assert_eq!(backend.schema.operations["unrepost"].predicts.as_deref(),Some("eligible"));
    let mut t=Trace::new(&format!("held floored unrepost aggregate online={online}"),backend); t.acquire(&mut e);
    let before=t.device.store().raw_rows("reposts");
    assert_eq!(before[0].field("$timeline:feed:repost").unwrap(),&id("E"));
    let out=t.predict("unrepost",json!({"postId":"p"}));
    if online {
        predicts(&out);
        assert!(t.device.store().raw_rows("reposts").is_empty());
        assert_eq!(t.query("tombstone",json!({"eventId":"E"}))["ok"]["data"],true);
    } else {
        assert!(out["ok"]["denied"]["message"].as_str().is_some_and(|s|s.contains("totals")),"{out}");
        assert!(out["ok"].get("predicted").is_none(),"{out}");
        assert_eq!(t.device.store().raw_rows("reposts"),before,"the failed transition must roll back its source delete");
        assert_eq!(t.query("tombstone",json!({"eventId":"E"}))["ok"]["data"],false);
        let out=t.admit("unrepost",json!({"postId":"p"}));
        assert_eq!(out["ok"]["predictable"],false); assert_eq!(out["ok"]["predicted"],json!([]));
    }
    t.finish()
}

fn aggregate_conditional_remove(online: bool) -> Json {
    let s = source("sync public last 10 by .at", "sync public")
        + "\nview totals: count feedPosts by .actorId\n" + if online { "  online only\n" } else { "" };
    let (mut e, backend) = common::compile(&s); post(&mut e, "p");
    // A conditional write is only a Horizon site. A static Server refusal
    // would hide a missing runtime guard, so require prediction eligibility.
    assert_eq!(backend.schema.operations["conditionalRemove"].predicts.as_deref(), Some("eligible"));
    let mut t = Trace::new(&format!("conditional original removal aggregate online={online}"), backend);
    t.acquire(&mut e);
    let before = t.device.store().raw_rows("posts");
    assert_eq!(before[0].field("$timeline:feed:post").unwrap(), &Value::Bool(true));
    predicts(&t.predict("conditionalRemove", json!({"postId":"p", "removeIt":false})));
    assert_eq!(t.device.store().raw_rows("posts"), before, "the untaken branch remains predictable");
    t.withdraw();
    let out = t.predict("conditionalRemove", json!({"postId":"p", "removeIt":true}));
    if online {
        predicts(&out);
        let rows = t.device.store().raw_rows("posts");
        assert_eq!(rows[0].field("removed").unwrap(), &Value::Bool(true));
        assert_eq!(rows[0].field("$timeline:feed:post").unwrap(), &Value::Bool(false));
        assert_eq!(t.query("tombstone", json!({"eventId":"p"}))["ok"]["data"], true);
    } else {
        assert!(out["ok"]["denied"]["message"].as_str().is_some_and(|s|s.contains("totals")), "{out}");
        assert!(out["ok"].get("predicted").is_none(), "{out}");
        assert_eq!(t.device.store().raw_rows("posts"), before, "the refused removal preserves the row and live slot");
        assert_eq!(t.query("tombstone", json!({"eventId":"p"}))["ok"]["data"], false);
        let queued = t.admit("conditionalRemove", json!({"postId":"p", "removeIt":true}));
        assert_eq!(queued["ok"]["predictable"], false);
        assert_eq!(queued["ok"]["predicted"], json!([]));
        assert_eq!(t.device.store().raw_rows("posts"), before);
    }
    t.finish()
}

#[test]
fn conditional_original_removal_reaches_runtime_aggregate_guard() {
    aggregate_conditional_remove(false);
    aggregate_conditional_remove(true);
}

fn shared() -> Json {
    let s=source("sync public last 10 by .at","sync public last 10 by .at") + "\nview allActivity:\n  posts where not .removed { post: .id, actor: .authorId, at, repost: false }\n  reposts { post: .postId, actor: .actorId, at, repost: true }\nview other: allActivity where .actor = viewer or exists follows[viewer, .actor]\nquery otherTombstone(eventId: id):\n  return exists otherRemovedEvents[eventId = eventId]\n";
    let (mut e,backend)=common::compile(&s); post(&mut e,"p"); repost(&mut e,"r","p","first-event");
    write(&mut e,"post",&[("postId",id("reply")),("parentId",id("p"))],&[]);
    let mut t=Trace::new("two declarations share sources and retire independently",backend); t.acquire(&mut e);
    let reply=t.device.store().raw_rows("posts").into_iter().find(|r|r.field("id").unwrap()==&id("reply")).unwrap();
    assert_eq!(reply.field("$timeline:feed:post").unwrap(),&Value::Bool(false));
    assert_eq!(reply.field("$timeline:other:post").unwrap(),&Value::Bool(true));
    predicts(&t.predict("unrepost",json!({"postId":"p"})));
    assert_eq!(t.query("tombstone",json!({"eventId":"first-event"}))["ok"]["data"],true);
    assert_eq!(t.query("otherTombstone",json!({"eventId":"second-event"}))["ok"]["data"],true);
    t.withdraw();
    // Retire the first declaration in the schema; its old source slots project out.
    let mut schema=e.schema().clone(); schema.timelines.retain(|v|v.name!="feed");
    schema.tables.retain(|name,_|!name.starts_with("feed") && name!="gates" && name!="actorGates");
    for table in schema.tables.values_mut() { table.columns.retain(|name,_|!name.starts_with("$timeline:feed:")); }
    let programs=e.programs().filter(|p|p.name=="otherTombstone" || p.name=="unrepost").cloned().collect::<Vec<_>>();
    let generation=e.adopt(schema.clone(),programs.clone()).unwrap();
    t.call(json!({"op":"adopt","backend":Backend{generation,schema,programs}})); t.acquire(&mut e);
    let row=&t.device.store().raw_rows("reposts")[0]; assert!(row.field("$timeline:feed:repost").is_err());
    assert_eq!(row.field("$timeline:other:repost").unwrap(),&id("second-event"));
    predicts(&t.predict("unrepost",json!({"postId":"p"})));
    assert_eq!(t.query("otherTombstone",json!({"eventId":"second-event"}))["ok"]["data"],true);
    t.finish()
}

fn activation() -> Json {
    let bound=snapback4_lang::compile(&[("schema.q".into(),source("sync public last 10 by .at","sync public last 10 by .at"))]);
    assert!(bound.diagnostics.is_empty());
    let mut legacy=bound.schema.clone();
    for table in legacy.tables.values_mut() { table.columns.retain(|name,_| !snapback4_core::schema::timeline::is_slot(name)); }
    let programs=bound.programs.into_iter().map(|p|p.program).collect::<Vec<_>>();
    let mut e=Engine::memory(legacy.clone(),programs.clone()).unwrap();
    post(&mut e,"p"); repost(&mut e,"r","p","E");
    let mut t=Trace::new("slot activation with literal default, interrupted before source pages",Backend{generation:e.generation(),schema:legacy,programs:programs.clone()});
    t.acquire(&mut e);
    let mut schema=bound.schema;
    let follows=schema.tables.get_mut("follows").unwrap();
    follows.columns.insert("pinned".into(),snapback4_core::schema::ColumnType::Bool);
    follows.defaults.insert("pinned".into(),snapback4_core::schema::ColumnDefault::Literal(Value::Bool(false)));
    let before=e.seq().unwrap();
    let generation=e.adopt_at(schema.clone(),programs.clone(),1000).unwrap();
    assert_eq!(e.seq().unwrap(),before,"slot fill never logs a write");
    t.call(json!({"op":"adopt","backend":Backend{generation,schema,programs}}));
    let pages=snapshot_pages(&mut e,"alice",1);
    t.apply(&pages[0],true); t.reopen();
    let read=t.query("postRow",json!({"postId":"p"}));
    assert!(read["ok"].get("data").is_none(),"{read}");
    for (n,input) in [("remove",json!({"postId":"p"})),("unrepost",json!({"postId":"p"}))] {
        let q=t.admit(n,input); assert_eq!(q["ok"]["predictable"],false,"{q}");
    }
    // Withdraw the queued witnesses; final reacquisition must be authoritative.
    t.call(json!({"op":"dequeue","id":"intent-1"})); t.call(json!({"op":"dequeue","id":"intent-2"}));
    t.acquire(&mut e);
    assert!(t.device.store().raw_rows("feedPosts").is_empty());
    predicts(&t.predict("unrepost",json!({"postId":"p"})));
    assert_eq!(t.query("tombstone",json!({"eventId":"E"}))["ok"]["data"],true);
    t.finish()
}

fn deferred() -> Json {
    let (mut e,backend)=common::compile(&source("sync public last 10 by .at","sync public last 10 by .at"));
    post(&mut e,"p"); post(&mut e,"q");
    let mut t=Trace::new("normalized source slots survive deferred fold and reopen",backend); t.acquire(&mut e);
    let pending=t.admit("remove",json!({"postId":"q"})); assert_eq!(pending["ok"]["predictable"],true,"{pending}");
    t.call(json!({"op":"begin_send"}));
    write(&mut e,"edit",&[("postId",id("p"))],&[]);
    let committed=e.mutate("remove",Some("intent-1"),Context::new("alice",args(&[("postId",id("q"))])).at(1000)).unwrap();
    let WriteState::Sent{seq,..}=committed.state else { panic!("{committed:?}") };
    write(&mut e,"remove",&[("postId",id("p"))],&[]);
    let mut first=true;
    loop {
        t.call(json!({"op":"sync_state"}));
        let capture=t.device.sync_state_read().unwrap();
        let mut page=stream(&mut e,capture.transfer_watermark,1);
        let (ack,above)=e.acknowledged_at("alice",&capture.pending_ids,page.watermark,page.images_at.unwrap()).unwrap();
        page.acknowledged=ack; page.committed_above=above;
        page.captured_watermark=Some(capture.watermark);
        page.pending_through=Some(capture.pending_through);
        page.pending_complete=Some(capture.pending_complete);
        page.pending_bound=Some(capture.pending_bound);
        page.send_revision=Some(capture.send_revision);
        if first { assert!(!page.committed_above.is_empty()); }
        t.apply(&page,false);
        if first { t.reopen(); first=false; }
        if !page.more { break; }
    }
    assert_eq!(t.device.queued().unwrap()[0].observed_seq,Some(seq));
    refusal(&t.predict("plainRepost",json!({"repostId":"r","postId":"p"})),"FEED_POST_NOT_FOUND");
    assert!(t.device.store().raw_rows("feedPosts").is_empty());
    t.finish()
}

fn transition_cases(posts: &str, reposts: &str) -> Json {
    let (mut e,backend)=common::compile(&source(posts,reposts));
    post(&mut e,"p"); post(&mut e,"removed");
    write(&mut e,"post",&[("postId",id("reply")),("parentId",id("p"))],&[]);
    write(&mut e,"remove",&[("postId",id("removed"))],&[]);
    repost(&mut e,"r","p","E");
    let mut t=Trace::new(&format!("held live/reply/removed and server unrepost: {posts}, {reposts}"),backend); t.acquire(&mut e);
    for p in ["reply","removed"] {
        refusal(&t.predict("plainRepost",json!({"repostId":"next","postId":p})),"FEED_POST_NOT_FOUND");
    }
    predicts(&t.predict("unrepost",json!({"postId":"p"})));
    assert_eq!(t.query("tombstone",json!({"eventId":"E"}))["ok"]["data"],true);
    t.withdraw();
    write(&mut e,"unrepost",&[("postId",id("p"))],&[]); t.sync(&mut e,1);
    predicts(&t.predict("plainRepost",json!({"repostId":"next","postId":"p"})));
    let local=t.device.store().raw_rows("reposts")[0].field("$timeline:feed:repost").unwrap().clone();
    let context=Context::new("alice",args(&[("repostId",id("next")),("postId",id("p"))])).at(1000)
        .with_ids(["predicted-event-1".to_string(),"predicted-event-2".to_string()]).with_entropy(17);
    e.mutate("plainRepost",None,context).unwrap();
    assert_eq!(&local,e.store().rows("reposts").unwrap()[0].field("$timeline:feed:repost").unwrap(),"prediction and server mint the same event id");
    t.withdraw(); t.sync(&mut e,1);
    let card=t.query("postRow",json!({"postId":"p"}));
    assert!(card["ok"]["data"].as_object().unwrap().keys().all(|k|!k.starts_with("$timeline:")),"engine slots are never application fields");
    write(&mut e,"remove",&[("postId",id("p"))],&[]); t.sync(&mut e,1);
    predicts(&t.predict("unrepost",json!({"postId":"p"})));
    t.withdraw();
    write(&mut e,"unrepost",&[("postId",id("p"))],&[]); t.sync(&mut e,1);
    refusal(&t.predict("plainRepost",json!({"repostId":"another","postId":"p"})),"FEED_POST_NOT_FOUND");
    t.finish()
}

fn unheld() -> Json {
    let (mut e,backend)=common::compile(&source("sync public last 1 by .at","sync public last 1 by .at"));
    write(&mut e,"birthAndEdit",&[("postId",id("old")),("at",Value::Int(1))],&[]);
    write(&mut e,"plainRepost",&[("repostId",id("old-repost")),("postId",id("old"))],&["old-event"]);
    write(&mut e,"birthAndEdit",&[("postId",id("new")),("at",Value::Int(1000))],&[]);
    let out=e.mutate("plainRepost",None,Context::new("alice",args(&[("repostId",id("new-repost")),("postId",id("new"))])).at(1000).with_ids(["new-event".into()])).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}));
    let mut t=Trace::new("unheld original/repost removal and repost insertion queue",backend); t.acquire(&mut e);
    for (name,input) in [("remove",json!({"postId":"old"})),("unrepost",json!({"postId":"old"})),("plainRepost",json!({"repostId":"r","postId":"old"}))] {
        let out=t.admit(name,input); assert_eq!(out["ok"]["predictable"],false,"{out}");
    }
    t.finish()
}

#[test]
fn emit_fault_schedules_for_wasm_and_native() {
    let mut traces=vec![log_order(),snapshot_reincarnation(false),snapshot_reincarnation(true),mixed("sync public last 1 by .at"),mixed("online only"),aggregates(false),aggregates(true),aggregate_unrepost(false),aggregate_unrepost(true),aggregate_conditional_remove(false),aggregate_conditional_remove(true),shared(),activation(),deferred(),unheld()];
    for full in [false,true] { for split in [false,true] { traces.push(reused_event(full,split)); } }
    for posts in ["sync public","sync public last 10 by .at"] {
        for reposts in ["sync public","sync public last 10 by .at"] { traces.push(transition_cases(posts,reposts)); }
    }
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/event-slots-traces.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path,serde_json::to_vec(&traces).unwrap()).unwrap();
    println!("{} fault schedules exported to {}",traces.len(),path.display());
}
