use super::*;
use snapback4_core::{schema::{LeavePolicy, timeline::owned_id}, RuntimeError};

pub fn present<'a>(images: &'a BTreeMap<String,Vec<Value>>, table: &str, id: &str) -> &'a Value {
    let found: Vec<_> = images[table].iter().filter(|r| r.field("id").unwrap().as_str().unwrap()==id).collect();
    assert_eq!(found.len(),1,"exactly one {table}/{id}"); found[0]
}
pub fn queued_only<S: Images>(d: &mut Device<S>, q: &Queued, before: &BTreeMap<String,Vec<Value>>) {
    assert!(!q.predictable && q.predicted.is_empty(),"{q:?}");
    assert_eq!(&rows(d),before);
    let queued=d.queued().unwrap(); let kept=queued.iter().find(|item|item.id==q.id).expect("mutation stays queued");
    assert!(kept.predicted.is_empty() && !kept.predictable);
}
pub fn assert_partition<S: Images>(d: &mut Device<S>, e: &Engine, viewer: &str) {
    let local=rows(d);
    for table in ["profiles","posts","reposts","follows","feedAuthors","feedPosts","feedRemovedEvents","feedBroadcast","feedFeed","feedPulls"] {
        let mut expected=fixture::rows(e,table);
        if matches!(table,"feedFeed"|"feedPulls") { expected.retain(|r|r.field("readerId").unwrap()==&fixture::id(viewer)); }
        expected.sort_by_key(|r|r.field("id").unwrap().as_str().unwrap().to_owned());
        assert_eq!(local[table],expected,"settled partition {table}");
        assert!(d.store().images(table).iter().all(|r|!r.as_object().unwrap().contains_key("pending")),"pending survives in {table}");
    }
}
pub fn add_probes(b: &mut Backend) {
    let queries = r#"
query inboxPoint(eventId: id):
  return feedFeed['bob', eventId] { readerId, eventId }
query inboxScan():
  return feedFeed['bob'] first 100 by byReaderTime { readerId, eventId }
query inboxMerge():
  return merge feedFeed last 100 by byReaderTime:
    ['bob']
query inboxProbe(eventId: id):
  return exists feedFeed['bob', eventId]
query routePoint():
  return feedPulls['bob', 'alice']
query routeScan():
  return feedPulls['bob'] first 100 by byReaderAuthor
query routeMerge():
  return merge feedPulls first 100 by byReaderAuthor:
    ['bob']
query routeProbe():
  return exists feedPulls['bob', 'alice']
"#;
    let compiled=fixture::compile(&format!("{}{}{queries}",fixture::APP,fixture::DECLARATION));
    b.programs.extend(compiled.programs.into_iter().filter(|p|p.program.kind==snapback4_core::ir::ProgramKind::Query).map(|p|p.program));
}
pub fn assert_private<S: Images>(d: &mut Device<S>, post: &str) {
        for query in ["inboxPoint","inboxScan","inboxMerge","inboxProbe","routePoint","routeScan","routeMerge","routeProbe"] {
            let args=if query=="inboxPoint" || query=="inboxProbe" {json!({"eventId":post})} else {json!({})};
            let answer=d.query(query,"alice",&args,100).unwrap();
            assert!(answer.data==Value::Null || answer.data==Value::Bool(false) || answer.data==Value::Array(vec![]),"foreign disclosure via {query}: {answer:?}");
        }
    for table in ["feedFeed","feedPulls"] {
        assert!(d.store().images(table).iter().all(|r| r.field("readerId").unwrap()==&fixture::id("alice")), "foreign row in raw {table}");
    }
}
fn foreign_reads<H: Host>(mut h: H) where H::Store: Images {
    let (mut e,mut b)=server();add_probes(&mut b);
    let mut d=open(&mut h,&mut e,b,"alice");
    for (n,settles) in [(1,false),(2,true)] {
        let post=format!("foreign-{n}");let q=admit(&mut d,"publish","alice",json!({"postId":post}),n);
        // Check disclosure before the row-count witness, so the mutation proof
        // fails on the actual read, not merely a bookkeeping count.
        assert_private(&mut d, &post);
        assert_eq!(q.predicted.len(),3);
        let own=owned_id("feed","Feed",&[fixture::id("alice"),fixture::id(&post)]);
        assert_eq!(q.predicted.iter().cloned().collect::<std::collections::BTreeSet<_>>(),[format!("posts/{post}"),format!("feedPosts/{post}"),format!("feedFeed/{own}")].into());
        assert!(d.store().images("feedFeed").iter().all(|r|r.field("readerId").unwrap()==&fixture::id("alice")));
        let before=e.seq().unwrap();
        sent(&mut e,"publish","carol",json!({"postId":format!("replay-{n}")}),19,vec![]);
        d.apply(&stream_page(&mut e,"alice",before),false).unwrap();
        assert_private(&mut d,&post);
        h.close("alice",d); d=h.open("alice",None).unwrap();
        assert_private(&mut d,&post);
        let before=e.seq().unwrap();
        let seq=settles.then(||sent(&mut e,"publish","alice",json!({"postId":post}),20+n as i64,q.new_ids.clone()));
        d.settle(&q.id,seq).unwrap();
        if settles {d.apply(&stream_page(&mut e,"alice",before),false).unwrap();}
        assert!(d.queued().unwrap().is_empty()); assert_partition(&mut d,&e,"alice");
        assert_private(&mut d,&post);
        for (i,p) in snapshot_pages(&mut e,"alice",1000).iter().enumerate() { d.apply(p,i==0).unwrap(); }
        assert_private(&mut d,&post); assert_partition(&mut d,&e,"alice");
    }
}
#[test] fn foreign_reads_memory() {foreign_reads(Memory::new());}
#[test] fn foreign_reads_sqlite() {foreign_reads(Sqlite::new("foreign-reads"));}

fn retained<H: Host>(mut h: H) where H::Store: Images {
    for (table,op,args,empty) in [
        ("feedAuthors","publish",json!({"postId":"retained-mode"}),false),
        ("profiles","publish",json!({"postId":"retained-profile"}),false),
        ("follows","publish",json!({"postId":"retained-edge"}),false),
        ("follows","publish",json!({"postId":"retained-empty-range"}),true),
        ("feedRemovedEvents","publish",json!({"postId":"removed"}),false),
        ("feedPosts","repost",json!({"postId":"original"}),false),
    ] {
        let (mut e,mut b)=server();
        if table=="feedRemovedEvents" {
            sent(&mut e,"publish","alice",json!({"postId":"removed"}),4,vec![]);
            sent(&mut e,"remove","alice",json!({"postId":"removed"}),5,vec![]);
        }
        // Inject persisted retention state, not a new admitted timeline shape.
        b.schema.tables.get_mut(table).unwrap().leave=LeavePolicy::DeliveredHistory;
        let mut d=h.open(&format!("{table}-{empty}"),Some(b)).unwrap();
        let mut pages=snapshot_pages(&mut e,"alice",1000);
        if table=="feedRemovedEvents" { for page in &mut pages {page.events.retain(|ev|ev.table!="posts" || ev.id!="removed");} }
        if empty {for page in &mut pages {page.events.retain(|ev|ev.table!=table);}}
        for (i,page) in pages.iter().enumerate() {d.apply(page,i==0).unwrap();}
        assert_eq!(d.store().images(table).is_empty(),empty);
        let left=serde_json::from_value(json!({"snapshot":false,"events":[{"table":table,"kind":"scope","id":"scope","data":[]}],"watermark":e.seq().unwrap()+1,"more":false})).unwrap();
        d.apply(&left,false).unwrap();
        let history=d.store().meta("device:history:groups").unwrap().unwrap();
        assert_eq!(serde_json::from_str::<Json>(&history).unwrap()[table]["[]"],"Left");
        let before=rows(&mut d);
        let error=d.predict(op,"alice",&args,11,vec![],1).unwrap_err();
        assert!(matches!(error,RuntimeError::Prediction(ref reason) if reason.contains(table)),"{error:?}");
        let q=admit(&mut d,op,"alice",args,1);
        queued_only(&mut d,&q,&before);
    }
}
#[test] fn retained_inputs_memory() {retained(Memory::new());}
#[test] fn retained_inputs_sqlite() {retained(Sqlite::new("retained"));}

fn tombstoned_ids<H: Host>(mut h: H) where H::Store: Images {
    for repost in [false,true] {
        let (mut e,b)=server();
        sent(&mut e,"publish","alice",json!({"postId":"removed"}),4,vec![]);
        sent(&mut e,"remove","alice",json!({"postId":"removed"}),5,vec![]);
        let mut d=h.open(if repost {"repost"} else {"original"},Some(b)).unwrap();
        let mut pages=snapshot_pages(&mut e,"alice",1000);
        for page in &mut pages {page.events.retain(|ev|ev.table!="posts" || ev.id!="removed");}
        for (i,page) in pages.iter().enumerate() {d.apply(page,i==0).unwrap();}
        let before=rows(&mut d);
        let (op,args,ids)=if repost {("repost",json!({"postId":"original"}),vec!["attribution".into(),"removed".into()])} else {("publish",json!({"postId":"removed"}),vec![])};
        let error=d.predict(op,"alice",&args,10,ids,1).unwrap_err();
        assert!(matches!(error,RuntimeError::Require {code,..} if code=="FEED_EVENT_REMOVED"));
        assert_eq!(rows(&mut d),before);
    }
}
#[test] fn tombstone_refusal_memory() {tombstoned_ids(Memory::new());}
#[test] fn tombstone_refusal_sqlite() {tombstoned_ids(Sqlite::new("tombstone-refusal"));}
