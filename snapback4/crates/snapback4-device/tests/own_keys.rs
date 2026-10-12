//! @ref LLP 3000.028#7.3 — whole owner partitions, overlays and interrupted publication on both stores.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, value::object, WriteState};
use snapback4_device::{device::{Device, Queued}, store::DeviceStore};

const SOURCE: &str = r#"
table likes:
  post: id
  owner: principal
  at: time
  unique post, owner
  immutable post, owner
  public 'likes'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public last 2 by .at with own keys .owner
query own(post: id):
  return exists likes[post, viewer]
query other(post: id, owner: principal):
  return exists likes[post, owner]
query image(post: id):
  return likes[post, viewer]
mutation add(post: id):
  insert likes {post, owner: viewer, at: now}
mutation remove(post: id):
  delete likes[post, viewer]
"#;

fn state<S: DeviceStore>(d: &mut Device<S>, post: &str) -> (bool, bool) {
    let (q, unknown, _) = d.query_with_coverage("own", "alice", &json!({"post":post}), 100);
    let q = q.unwrap();
    assert!(!unknown, "{q:?}");
    (q.data == Value::Bool(true), q.complete)
}
fn row(id_: &str, post: &str, owner: &str, at: i64) -> (String,Value) {
    ("likes".into(), object([("id",id(id_)),("post",id(post)),("owner",id(owner)),("at",Value::Int(at))]))
}

fn exercise<H: Host>(h: &mut H) {
    let (mut e, b) = compile(SOURCE);
    e.seed([row("old-own","old","alice",1),row("old-other","secret","bob",2),row("new1","new1","bob",3),row("new2","new2","bob",4)]).unwrap();
    let mut d = h.open("own",Some(b)).unwrap();
    assert!(d.query("own","alice",&json!({"post":"missing"}),10).is_err());
    let pages = snapshot_pages(&mut e,"alice",1);
    for (n,p) in pages.iter().enumerate() {
        let mut p = p.clone(); p.stage_snapshot = true;
        d.apply(&p,n==0).unwrap();
        assert!(d.query("own","alice",&json!({"post":"missing"}),10).is_err());
    }
    h.close("own",d); // crash after terminal snapshot, before catch-up publication
    let mut d = h.open("own",None).unwrap();
    assert!(!d.sync_state().unwrap().acquired);
    assert!(d.query("own","alice",&json!({"post":"missing"}),10).is_err());
    let mut catchup = stream_page(&mut e,"alice",pages.last().unwrap().watermark);
    catchup.snapshot_catchup = true;
    assert!(d.apply(&catchup,false).is_err(), "the crashed owner cannot publish its transfer");
    for (n,p) in pages.iter().enumerate() {
        let mut p=p.clone();p.stage_snapshot=true;d.apply(&p,n==0).unwrap();
    }
    d.apply(&catchup,false).unwrap();
    h.close("own",d);
    let mut d = h.open("own",None).unwrap();
    assert_eq!(state(&mut d,"missing"),(false,true));
    assert_eq!(state(&mut d,"old"),(true,true));
    let (_, unknown, _) = d.query_with_coverage("own","bob",&json!({"post":"missing"}),10);
    assert!(unknown, "even a direct caller switch cannot borrow Alice's acquired marker");
    h.close("own",d);
    let mut d = h.open("own",None).unwrap();
    assert_eq!(state(&mut d,"missing"),(false,true), "same-principal reopen keeps its proof after another caller's refused read");
    let (image, unknown, _) = d.query_with_coverage("image","alice",&json!({"post":"old"}),10);
    assert!(unknown && !image.unwrap().complete, "key cannot supply the row");
    for post in ["secret","missing"] {
        let (_,unknown,_) = d.query_with_coverage("other","alice",&json!({"post":post,"owner":"bob"}),10);
        assert!(unknown,"another owner's {post} is unknown");
    }
    let from = e.seq().unwrap();
    assert!(matches!(e.mutate("remove",None,context("alice",&[("post",id("old"))])).unwrap().state,WriteState::Sent {..}));
    assert_eq!(state(&mut d,"old"),(true,true),"unseen remote deletion stays stale true");
    d.apply(&stream_page(&mut e,"alice",from),false).unwrap();
    assert_eq!(state(&mut d,"old"),(false,true),"last deletion preserves whole empty partition");
    let from = e.seq().unwrap();
    e.mutate("add",None,context("alice",&[("post",id("old"))]).at(5).with_ids(["again".into()])).unwrap();
    d.apply(&stream_page(&mut e,"alice",from),false).unwrap();
    assert_eq!(state(&mut d,"old"),(true,true));
    // Deleting a held image predicts both the source deletion and the key deletion.
    let q = d.admit(Queued { upload: None, id:"pending".into(),seq:1,op:"remove".into(),args:json!({"post":"old"}),new_ids:vec![],predicted:vec![],viewer:"alice".into(),now:10,predictable:true,sent_seq:None,receipt_store:None,observed_seq:None,dispatch:None }).unwrap();
    assert!(q.predictable, "{q:?}");
    assert!(q.predicted.iter().any(|k| k.starts_with("$ownKeys:likes/")));
    assert_eq!(state(&mut d,"old"),(false,true));
    d.dequeue("pending").unwrap(); d.withdraw(&q.predicted).unwrap();
    assert_eq!(state(&mut d,"old"),(true,true));
    // The unknown row image is still required for deletion; keys alone are not a write target.
    let q = d.admit(Queued { upload: None, id:"unpredicted".into(),seq:2,op:"remove".into(),args:json!({"post":"missing"}),new_ids:vec![],predicted:vec![],viewer:"alice".into(),now:10,predictable:true,sent_seq:None,receipt_store:None,observed_seq:None,dispatch:None }).unwrap();
    assert!(!q.predictable && q.predicted.is_empty(),"{q:?}");
    assert_eq!(state(&mut d,"old"),(true,true));
    d.clear_rows().unwrap();
    assert!(!d.sync_state().unwrap().acquired);
    assert!(d.query("own","bob",&json!({"post":"missing"}),10).is_err());
    h.close("own",d);
    let mut d = h.open("empty",Some(e_backend(&e,SOURCE))).unwrap();
    for (n,p) in snapshot_pages(&mut e,"empty",2).iter().enumerate() {d.apply(p,n==0).unwrap();}
    let q=d.query("own","empty",&json!({"post":"new1"}),10).unwrap();
    assert_eq!(q.data,Value::Bool(false)); assert!(q.complete);
    h.close("empty",d);
}
fn e_backend(e: &snapback4_core::Engine, source: &str) -> snapback4_device::device::Backend {
    let (_,mut b)=compile(source);b.generation=e.generation();b
}
#[test] fn sqlite() { exercise(&mut Sqlite::new("owner-keys")); }
#[test] fn memory() { exercise(&mut Memory::new()); }

#[test]
fn snapshot_and_catchup_payloads_never_disclose_another_owners_keys() {
    let (mut e, _) = compile(SOURCE);
    e.seed([
        row("alice-old", "alice-secret", "alice", 1),
        row("bob-old", "bob-secret", "bob", 2),
        row("new1", "new1", "bob", 3),
        row("new2", "new2", "bob", 4),
    ]).unwrap();
    let mut keys = std::collections::BTreeMap::new();
    for owner in ["alice", "bob"] {
        let pages = snapshot_pages(&mut e, owner, 1);
        let events: Vec<_> = pages.iter().flat_map(|p| &p.events)
            .filter(|event| event.table.starts_with("$ownKeys:")).collect();
        assert_eq!(events.len(), if owner == "alice" { 1 } else { 3 });
        for event in events {
            assert_eq!(event.kind, "put");
            let data = event.data.as_ref().unwrap();
            assert_eq!(data["owner"], owner, "snapshot leaked: {event:?}");
            keys.insert((owner.to_owned(), data["post"].as_str().unwrap().to_owned()), event.id.clone());
        }
    }
    let from = e.seq().unwrap();
    for owner in ["alice", "bob"] {
        for (op, post) in [("remove", format!("{owner}-secret")), ("add", format!("{owner}-new"))] {
            let result = e.mutate(op, None, context(owner, &[("post", id(&post))]).at(10)).unwrap();
            assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
        }
    }
    for owner in ["alice", "bob"] {
        let page = stream_page(&mut e, owner, from);
        let events: Vec<_> = page.events.iter().filter(|event| event.table.starts_with("$ownKeys:")).collect();
        assert_eq!(events.len(), 2, "{owner}: {events:?}");
        let mut puts = 0;
        let mut deletes = 0;
        for event in events {
            match event.kind.as_str() {
                "put" => {
                    puts += 1;
                    assert_eq!(event.data.as_ref().unwrap()["owner"], owner, "catch-up leaked: {event:?}");
                }
                "del" => {
                    deletes += 1;
                    assert_eq!(event.id, keys[&(owner.to_owned(), format!("{owner}-secret"))], "tombstone leaked: {event:?}");
                    assert!(event.data.is_none());
                }
                kind => panic!("unexpected owner-key event {kind}"),
            }
        }
        assert_eq!((puts, deletes), (1, 1));
    }
}

#[test]
fn failed_partition_publication_keeps_absence_unavailable() {
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    let (mut e,b)=compile(SOURCE);
    let mut host=Sqlite::new("owner-keys-failed-save");
    let mut d=host.open("empty",Some(b)).unwrap();
    let pages=snapshot_pages(&mut e,"alice",1);
    for (i,page) in pages.iter().enumerate() {
        let mut page=page.clone();page.stage_snapshot=true;d.apply(&page,i==0).unwrap();
    }
    let mut publish=stream_page(&mut e,"alice",pages.last().unwrap().watermark);
    publish.snapshot_catchup=true;
    d.store().conn().authorizer(Some(|ctx:AuthContext<'_>| match ctx.action {
        AuthAction::Insert {table_name:"_meta"} => Authorization::Deny,
        _=>Authorization::Allow,
    }));
    assert!(d.apply(&publish,false).is_err());
    d.store().conn().authorizer(None::<fn(AuthContext<'_>)->Authorization>);
    assert!(!d.sync_state().unwrap().acquired);
    assert!(d.query("own","alice",&json!({"post":"missing"}),10).is_err());
    d.apply(&publish,false).unwrap();
    assert_eq!(state(&mut d,"missing"),(false,true));
}

#[test]
fn adoption_failure_never_publishes_an_empty_key_set() {
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    let (mut e, _) = compile(&SOURCE.replace(" with own keys .owner", ""));
    e.seed([row("old","old","alice",1)]).unwrap();
    let old=e.generation();let before=e.schema().clone();
    let (_,b)=compile(SOURCE);
    e.store().conn().authorizer(Some(|ctx:AuthContext<'_>| match ctx.action {
        AuthAction::Insert {table_name:"_generations"} => Authorization::Deny,
        _=>Authorization::Allow,
    }));
    assert!(e.adopt(b.schema.clone(),b.programs.clone()).is_err());
    e.store().conn().authorizer(None::<fn(AuthContext<'_>)->Authorization>);
    assert_eq!(e.generation(),old);assert_eq!(e.schema(),&before);
    let count:i64=e.store().conn().query_row("select count(*) from _catalog where name='$ownKeys:likes'",[],|r|r.get(0)).unwrap();
    assert_eq!(count,0,"failed activation rolls back the projection and its catalog");
    e.adopt(b.schema,b.programs).unwrap();
    assert_eq!(e.query("own",context("alice",&[("post",id("old"))])).unwrap().data,Value::Bool(true));
}

#[test]
fn source_and_keys_share_the_unchanged_write_meter_and_rollback() {
    let (mut e,_)=compile(SOURCE);
    e.set_ceilings(snapback4_core::Ceilings {rows_written:1,..e.ceilings()});
    let out=e.mutate("add",None,context("alice",&[("post",id("p"))]).at(1)).unwrap();
    assert!(matches!(out.state,WriteState::Failed {..}),"{out:?}");
    assert_eq!(e.store().conn().query_row("select count(*) from r",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    e.set_ceilings(snapback4_core::Ceilings::default());
    let out=e.mutate("add",None,context("alice",&[("post",id("p"))]).at(2)).unwrap();
    assert!(matches!(out.state,WriteState::Sent {..}));
    assert_eq!(out.metered.rows_written,2);
    assert!(out.metered.index_entries>=5,"source unique, owner index and projection indexes are charged");
}
