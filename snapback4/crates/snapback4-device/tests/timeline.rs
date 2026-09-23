//! Declared Following through the real device on both persistent stores.
mod common;
#[path = "../../snapback4/tests/timeline/common.rs"]
#[allow(dead_code)]
mod fixture;
use common::{Host, Memory, Sqlite, snapshot_pages, stream_page};
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_device::{device::{Backend, Device, Queued}, store::DeviceStore};
use serde_json::{json, Value as Json};
use std::collections::BTreeMap;

fn server() -> (Engine, Backend) {
    let b = fixture::bound(true);
    let backend = Backend { generation: 1, schema: b.schema, programs: b.programs.into_iter().map(|p|p.program).collect() };
    let mut e = Engine::memory(backend.schema.clone(), backend.programs.clone()).unwrap();
    for who in ["alice", "bob", "carol"] { sent(&mut e, "register", who, json!({}), 1, vec![]); }
    sent(&mut e, "follow", "bob", json!({"authorId":"alice"}), 2, vec![]);
    sent(&mut e, "publish", "alice", json!({"postId":"original"}), 3, vec![]);
    (e, backend)
}
fn sent(e: &mut Engine, op: &str, viewer: &str, args: Json, now: i64, ids: Vec<String>) -> u64 {
    let args = args.as_object().unwrap().iter().map(|(k,v)| (k.clone(), Value::Id(v.as_str().unwrap().into()))).collect();
    let out = e.mutate(op, None, Context::new(viewer, args).at(now).with_ids(ids)).unwrap();
    match out.state { WriteState::Sent {seq,..} => seq, _ => panic!("{op}: {out:?}") }
}
fn open<H: Host>(host: &mut H, e: &mut Engine, b: Backend, viewer: &str) -> Device<H::Store> {
    let mut d = host.open(viewer, Some(b)).unwrap();
    for (n,p) in snapshot_pages(e,viewer,1000).iter().enumerate() { d.apply(p,n==0).unwrap(); }
    d
}
fn admit<S: DeviceStore>(d: &mut Device<S>, op: &str, viewer: &str, args: Json, n: u64) -> Queued {
    d.admit(serde_json::from_value(json!({"id":format!("q{n}"),"seq":n,"op":op,"viewer":viewer,"args":args,"now":10+n,"predictable":true})).unwrap()).unwrap()
}
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
fn rows<S: Images>(d: &mut Device<S>) -> BTreeMap<String,Vec<Value>> {
    d.schema().tables.keys().map(|name| {
        let mut rows: Vec<_> = d.store().images(name).into_iter().map(|mut r| {
            if let Value::Row(fields) = &mut r { fields.remove("pending"); } r
        }).collect();
        rows.sort_by_key(|r|r.field("id").unwrap().as_str().unwrap().to_owned());
        (name.clone(),rows)
    }).collect()
}
fn page<S: DeviceStore>(d: &mut Device<S>, who: &str) -> Value {
    let p=d.query("following",who,&json!({}),100).unwrap(); assert!(p.complete,"{p:?}"); p.data
}

fn lifecycle<H: Host>(mut h: H) where H::Store: Images {
    let (mut e,b) = server();
    let mut d = open(&mut h,&mut e,b.clone(),"alice");
    for (n,op,args,count) in [
        (1,"publish",json!({"postId":"offline"}),4),
        (2,"repost",json!({"postId":"original"}),4),
        (3,"remove",json!({"postId":"offline"}),3),
        (4,"unrepost",json!({"postId":"original"}),3),
    ] {
        let q=admit(&mut d,op,"alice",args.clone(),n);
        assert!(q.predictable,"{q:?}");
        assert_eq!(q.predicted.len(),count,"{op}: {q:?}");
        assert_eq!(q.new_ids.len(),if op=="repost" {2} else {0},"only application inserts and fresh events consume supplied ids");
        let predicted = rows(&mut d);
        let before=e.seq().unwrap();
        let seq=sent(&mut e,op,"alice",args,10+n as i64,q.new_ids.clone());
        // Exact identity parity when the server consumes the admitted id supply.
        for key in &q.predicted {
            let (table,id)=key.split_once('/').unwrap();
            let a=predicted[table].iter().find(|r|r.field("id").unwrap().as_str().unwrap()==id);
            let online=fixture::rows(&e,table);
            let b=online.iter().find(|r|r.field("id").unwrap().as_str().unwrap()==id);
            assert_eq!(a,b,"{} {op}: {key}",h.label());
        }
        h.close("alice",d);
        d=h.open("alice",None).unwrap();
        assert_eq!(rows(&mut d),predicted,"reopen preserves every provisional row");
        // A real unrelated server commit forces restore/replay on reconnect.
        sent(&mut e,"publish","carol",json!({"postId":format!("unrelated{n}")}),30+n as i64,vec![]);
        d.settle(&q.id,Some(seq)).unwrap();
        d.apply(&stream_page(&mut e,"alice",before),false).unwrap();
        assert!(d.queued().unwrap().is_empty());
        assert_eq!(page(&mut d,"alice"),e.query("following",Context::new("alice",BTreeMap::new()).at(100)).unwrap().data);
        let after=rows(&mut d);
        // Foreign provisional copies are withdrawn; only the viewer's partition remains.
        assert!(after["feedFeed"].iter().all(|r| r.field("readerId").unwrap()==&fixture::id("alice")));
        for table in ["posts","reposts","feedPosts","feedRemovedEvents","feedBroadcast"] { assert_eq!(after[table],fixture::rows(&e,table),"settled {table}"); }
    }
}
#[test] fn declared_timeline_lifecycle_memory() { lifecycle(Memory::new()); }
#[test] fn declared_timeline_lifecycle_sqlite() { lifecycle(Sqlite::new("timeline-lifecycle")); }

fn replay_and_refusal<H: Host>(mut h: H) where H::Store: Images {
    let (mut e,b)=server(); let mut d=open(&mut h,&mut e,b,"alice");
    let baseline=rows(&mut d);
    let q=admit(&mut d,"publish","alice",json!({"postId":"refused"}),1);
    assert_eq!(q.predicted.len(),4);
    let predicted=rows(&mut d);
    let before=e.seq().unwrap();
    sent(&mut e,"publish","carol",json!({"postId":"other"}),20,vec![]);
    d.apply(&stream_page(&mut e,"alice",before),false).unwrap();
    let replayed=rows(&mut d);
    for key in &q.predicted { let (table,id)=key.split_once('/').unwrap();
        assert_eq!(predicted[table].iter().find(|r|r.field("id").unwrap()==&fixture::id(id)),replayed[table].iter().find(|r|r.field("id").unwrap()==&fixture::id(id))); }
    assert_eq!(d.queued().unwrap()[0].new_ids,q.new_ids);
    let before=e.seq().unwrap();
    // Concurrent server insert makes the submitted app id refuse atomically.
    sent(&mut e,"publish","alice",json!({"postId":"refused"}),21,vec![]);
    let out=e.mutate("publish",Some(&q.id),Context::new("alice",[("postId".into(),fixture::id("refused"))].into()).at(11).with_ids(q.new_ids.clone())).unwrap();
    assert!(matches!(out.state,WriteState::Failed{..}));
    d.settle(&q.id,None).unwrap();
    let withdrawn=rows(&mut d);
    for key in &q.predicted { let (table,id)=key.split_once('/').unwrap(); assert!(!withdrawn[table].iter().any(|r|r.field("id").unwrap()==&fixture::id(id)),"orphan {key}"); }
    assert_eq!(withdrawn["feedFeed"],baseline["feedFeed"]);
    d.apply(&stream_page(&mut e,"alice",before),false).unwrap();
    assert_eq!(page(&mut d,"alice"),e.query("following",Context::new("alice",BTreeMap::new()).at(100)).unwrap().data);
}
#[test] fn declared_timeline_replay_refusal_memory() { replay_and_refusal(Memory::new()); }
#[test] fn declared_timeline_replay_refusal_sqlite() { replay_and_refusal(Sqlite::new("timeline-replay")); }

fn classification<H: Host>(mut h:H) where H::Store: Images {
    let (mut e,b)=server();
    for op in ["register","publish","repost","remove","unrepost"] { assert_eq!(b.schema.operations[op].predicts.as_deref(),Some("eligible"),"{op}"); }
    for op in ["follow","unfollow","refollow"] {
        let f=&b.schema.operations[op]; assert_eq!(f.predicts.as_deref(),Some("never"));
        assert!(f.sites.iter().any(|s| s.table=="feedPullCounts" && s.class==snapback4_core::schema::SiteClass::Server));
    }
    let mut d=open(&mut h,&mut e,b.clone(),"bob"); let before=rows(&mut d);
    for (n,op) in [(1,"follow"),(2,"unfollow")] { let q=admit(&mut d,op,"bob",json!({"authorId":"alice"}),n); assert!(!q.predictable && q.predicted.is_empty()); assert_eq!(rows(&mut d),before); }
    let mut registering=open(&mut h,&mut e,b.clone(),"new");
    let q=admit(&mut registering,"register","new",json!({}),1);assert_eq!(q.predicted.len(),2); assert!(q.predictable);
    assert_eq!(q.new_ids.len(),1,"the mode takes owned_id, not a caller id");
    // Runtime guard must hold even if a caller strips classification metadata.
    let mut stripped=b; stripped.schema.operations.clear();
    let mut d=open(&mut h,&mut e,stripped,"carol"); let before=rows(&mut d);
    let q=admit(&mut d,"follow","carol",json!({"authorId":"alice"}),1);assert!(!q.predictable);assert_eq!(rows(&mut d),before);
}
#[test] fn declared_timeline_classification_memory() { classification(Memory::new()); }
#[test] fn declared_timeline_classification_sqlite() { classification(Sqlite::new("timeline-classes")); }

fn unheld<H:Host>(mut h:H) where H::Store: Images {
    for (table,op,args) in [
        ("feedAuthors","publish",json!({"postId":"unheld-mode"})),
        ("follows","publish",json!({"postId":"unheld-edge"})),
        ("feedRemovedEvents","publish",json!({"postId":"unheld-tombstone"})),
        ("feedPosts","repost",json!({"postId":"original"})),
        ("feedAuthors","register",json!({})),
    ] {
        let (mut e,mut b)=server();
        // Exercise each runtime dependency independently: a partially held input
        // with a horizon, rather than trusting static eligibility. The declared
        // form normally acquires all public inputs together; its actual interrupted
        // acquisition case is below. These injected horizons are not authoring.
        let t=b.schema.tables.get_mut(table).unwrap();
        t.sync.as_mut().unwrap().horizon=Some(snapback4_core::schema::Horizon { last:1,by:"byId".into() });
        let viewer=if op=="register" {"new"} else {"alice"};
        let name=format!("{table}-{op}"); let mut d=h.open(&name,Some(b)).unwrap();
        let mut pages=snapshot_pages(&mut e,viewer,1000);
        for p in &mut pages { p.events.retain(|ev|ev.table!=table); }
        for (n,p) in pages.iter().enumerate() {d.apply(p,n==0).unwrap();}
        let before=rows(&mut d);let q=admit(&mut d,op,viewer,args,1);
        assert!(!q.predictable && q.predicted.is_empty(),"unheld {table}: {q:?}");
        assert_eq!(rows(&mut d),before,"partial derivation from {table}");
        h.close(&name,d);
    }
    let (mut e,b)=server();let mut d=h.open("partial",Some(b)).unwrap();
    let pages=snapshot_pages(&mut e,"alice",1);assert!(pages.len()>1);
    d.apply(&pages[0],true).unwrap();
    let (partial,unknown,_)=d.query_with_coverage("following","alice",&json!({}),100);
    assert!(partial.is_err() && unknown,"an interrupted snapshot must report unacquired coverage");
    let q=admit(&mut d,"publish","alice",json!({"postId":"partial"}),1);
    assert!(!q.predictable && q.predicted.is_empty());
}
#[test] fn declared_timeline_unheld_memory() { unheld(Memory::new()); }
#[test] fn declared_timeline_unheld_sqlite() { unheld(Sqlite::new("timeline-unheld")); }

fn shared_and_pages<H: Host>(mut h:H) where H::Store: Images {
    let (mut e,b)=server();
    // Promote by actual public transitions, then acquire the installed route.
    for n in 0..50 {
        let who=format!("f{n}");sent(&mut e,"register",&who,json!({}),4,vec![]);
        sent(&mut e,"follow",&who,json!({"authorId":"alice"}),5,vec![]);
    }
    let mut d=open(&mut h,&mut e,b,"alice");
    let q=admit(&mut d,"publish","alice",json!({"postId":"shared-offline"}),1);
    assert!(q.predictable);assert_eq!(q.predicted.len(),3);
    assert!(q.predicted.iter().any(|k|k.starts_with("feedBroadcast/")));
    let before=e.seq().unwrap();
    let seq=sent(&mut e,"publish","alice",json!({"postId":"shared-offline"}),11,q.new_ids);
    d.settle(&q.id,Some(seq)).unwrap();d.apply(&stream_page(&mut e,"alice",before),false).unwrap();
    let before=e.seq().unwrap();
    for n in 0..25 {sent(&mut e,"publish","alice",json!({"postId":format!("page{n}")}),20+n,vec![]);}
    d.apply(&stream_page(&mut e,"alice",before),false).unwrap();
    let mut cursor=None::<String>;
    for _ in 0..3 {
        let args=json!({"c":cursor});
        let local=d.query("following","alice",&args,100).unwrap();
        let online=e.query("following",Context::new("alice",[("c".into(),cursor.clone().map(Value::String).unwrap_or(Value::Null))].into()).at(100)).unwrap();
        assert_eq!((&local.data,local.complete,&local.next),(&online.data,online.complete,&online.next));
        if local.next.is_none() {break;}cursor=local.next;
    }
    let q=admit(&mut d,"remove","alice",json!({"postId":"shared-offline"}),2);
    assert!(q.predictable);assert_eq!(q.predicted.len(),4,"app update, tombstone, source and broadcast removal");
    assert!(!page(&mut d,"alice").as_array().unwrap().iter().any(|r|r.field("postId").unwrap()==&fixture::id("shared-offline")));
}
#[test] fn declared_timeline_shared_pages_memory() {shared_and_pages(Memory::new());}
#[test] fn declared_timeline_shared_pages_sqlite() {shared_and_pages(Sqlite::new("timeline-shared"));}

fn repost_replay<H:Host>(mut h:H) where H::Store:Images {
    let (mut e,b)=server();let mut d=open(&mut h,&mut e,b,"alice");
    let q=admit(&mut d,"repost","alice",json!({"postId":"original"}),1);
    assert_eq!(q.new_ids.len(),2);assert_eq!(q.predicted.len(),4);
    let original=rows(&mut d);let from=e.seq().unwrap();
    sent(&mut e,"publish","carol",json!({"postId":"intervening"}),20,vec![]);
    d.apply(&stream_page(&mut e,"alice",from),false).unwrap();
    let replayed=rows(&mut d);
    assert_eq!(d.queued().unwrap()[0].new_ids,q.new_ids);
    assert_eq!(d.queued().unwrap()[0].predicted,q.predicted);
    for key in &q.predicted {
        let (table,key)=key.split_once('/').unwrap();
        assert_eq!(original[table].iter().find(|r|r.field("id").unwrap()==&fixture::id(key)),replayed[table].iter().find(|r|r.field("id").unwrap()==&fixture::id(key)));
    }
}
#[test] fn declared_timeline_repost_replay_memory() {repost_replay(Memory::new());}
#[test] fn declared_timeline_repost_replay_sqlite() {repost_replay(Sqlite::new("timeline-repost-replay"));}
