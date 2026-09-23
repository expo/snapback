//! F2 source images travel intact and predict only from current coverage.
use super::super::common::*;
use snapback4_core::{Value, WriteState};
use snapback4_device::device::{Backend, Queued};
use serde_json::json;
const SOURCE: &str = include_str!("../../../snapback4-lang/tests/fixtures/recorded-attribution.q");
fn post(name: &str, author: &str, until: Value) -> (String, Value) {
    ("posts".into(), snapback4_core::value::object([("id", id(name)), ("authorId", id(author)), ("parentId", Value::Null), ("at", Value::Int(100)), ("until", until)]))
}
fn queued(post: &str, n: u64, now: i64) -> Queued {
    Queued { id:format!("q{n}"), seq:n, op:"like".into(), args:json!({"postId":post,"at":100,"until":null}), viewer:"alice".into(), now, new_ids:vec![format!("l{n}")], predicted:vec![], predictable:true, sent_seq:None, receipt_store:None, observed_seq:None }
}
fn run<H: Host>(host: &mut H) {
    let now = snapback4_core::now_ms();
    let (mut server, backend) = compile(SOURCE);
    server.seed([post("p", "alice", Value::Null), post("expired", "alice", Value::Int(now + 1000))]).unwrap();
    let mut device = host.open("attribution", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let prediction = device.admit(queued("p", 1, now)).unwrap();
    assert!(prediction.predictable, "{}: {prediction:?}", host.label());
    assert!(!prediction.predicted.is_empty());
    assert_eq!(device.query("received", "alice", &json!({"authorId":"alice"}), now).unwrap().data, Value::Int(1));
    let from = server.seq().unwrap();
    let out = server.mutate("like", Some("q1"), context("alice", &[("postId", id("p")), ("at",Value::Int(100)), ("until",Value::Null)]).at(now).with_ids(["l1".into()])).unwrap();
    let WriteState::Sent { seq, .. } = out.state else { panic!("{out:?}") };
    device.settle("q1", Some(seq)).unwrap();
    device.apply(&stream_page(&mut server, "alice", from), false).unwrap();
    // Server deletion/recreation never changes historical captures on a source.
    for (revision, replacement) in [None, Some("bob")].into_iter().enumerate() {
        let from = server.seq().unwrap();
        if let Some(author) = replacement { server.seed([post("p", author, Value::Null)]).unwrap(); }
        else { server.seed_delete("posts", "p").unwrap(); }
        device.apply(&stream_page(&mut server, "alice", from), false).unwrap();
        let incremental = device.query("answers", "alice", &json!({}), now).unwrap().data;
        assert_eq!(incremental, server.query("answers", context("alice", &[]).at(now)).unwrap().data);
        let predicate = vec!["true";revision + 2].join(" and ");
        let (_, next) = compile(&SOURCE.replace("where true by", &format!("where {predicate} by")));
        server.adopt(next.schema.clone(), next.programs.clone()).unwrap();
        device.adopt(Backend { generation:server.generation(), ..next }).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        assert_eq!(device.query("answers", "alice", &json!({}), now).unwrap().data, incremental);
    }
    host.close("attribution", device);
    let mut device = host.open("attribution", None).unwrap();
    let historical = device.query("answers", "alice", &json!({}), now).unwrap().data;
    assert_eq!(historical, server.query("answers", context("alice", &[]).at(now)).unwrap().data);
    assert_eq!(device.query("received", "alice", &json!({"authorId":"alice"}), now).unwrap().data, Value::Int(1));
    assert!(device.query("allLikes", "alice", &json!({}), now).unwrap().data.as_array().unwrap()[0].field("postId.authorId").is_err());
    // Rebuild a changed predicate over the existing path after target id reuse.
    let (_, next) = compile(&SOURCE.replace("where true by postId.authorId", "where postId.authorId = 'alice' by postId.authorId"));
    let seq = server.seq().unwrap();
    server.adopt(next.schema.clone(), next.programs.clone()).unwrap();
    assert_eq!(server.seq().unwrap(), seq);
    device.adopt(Backend { generation:server.generation(), ..next }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    assert_eq!(device.query("answers", "alice", &json!({}), now).unwrap().data, historical);
    let from = server.seq().unwrap();
    server.seed([("likes".into(), snapback4_core::value::object([("id",id("l1")), ("until",Value::Int(now + 60_000))]))]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    let expired = device.query("answers", "alice", &json!({}), now + 60_001).unwrap().data;
    assert_eq!(expired, server.query("answers",context("alice",&[]).at(now + 60_001)).unwrap().data);
    let (_, next) = compile(SOURCE);
    server.adopt(next.schema.clone(), next.programs.clone()).unwrap();
    device.adopt(Backend { generation:server.generation(), ..next }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    assert_eq!(device.query("answers","alice",&json!({}),now + 60_001).unwrap().data,expired);
    for (n, target, clock) in [(2,"missing",now), (3,"expired",now + 1001)] {
        let prediction = device.admit(queued(target, n, clock)).unwrap();
        assert!(!prediction.predictable && prediction.predicted.is_empty(), "{}: {prediction:?}", host.label());
    }
    host.close("attribution", device);
}
#[test]
fn recorded_prediction_stream_and_reopen_on_both_stores() { run(&mut Sqlite::new("recorded")); run(&mut Memory::new()); }

fn activation<H: Host>(host: &mut H) {
    let bare = format!("{}\nquery allLikes():\n  return likes first 100 by byId\n", SOURCE.split("maintain receivedLikes:").next().unwrap());
    let (mut server, backend) = compile(&bare);
    server.seed([post("p", "alice", Value::Null), ("likes".into(), snapback4_core::value::object([("id",id("l")),("postId",id("p")),("principal",id("alice")),("at",Value::Int(100)),("until",Value::Null)]))]).unwrap();
    let mut device = host.open("activation", Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    server.seed([("likes".into(), snapback4_core::value::object([("id",id("dangling")),("postId",id("absent")),("principal",id("alice")),("at",Value::Int(100)),("until",Value::Null)]))]).unwrap();
    server.seed_delete("posts", "p").unwrap();
    server.seed([post("p", "bob", Value::Null)]).unwrap();
    let before = server.seq().unwrap();
    let (_, next) = compile(SOURCE);
    server.adopt(next.schema.clone(), next.programs.clone()).unwrap();
    assert_eq!(server.seq().unwrap(), before, "no per-row activation commit");
    assert!(server.stream("alice", before, 100).unwrap().events.is_empty());
    device.adopt(Backend { generation:server.generation(), ..next }).unwrap();
    assert_eq!(device.query("allLikes", "alice", &json!({}), 1000).unwrap_err().code, "E_PREDICT", "adoption requires a new snapshot");
    for (i,page) in snapshot_pages(&mut server,"alice",1).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    assert_eq!(device.query("answers","alice",&json!({}),1000).unwrap().data,server.query("answers",context("alice",&[]).at(1000)).unwrap().data);
    let (_, removed) = compile(&bare);
    let seq = server.seq().unwrap();
    server.adopt(removed.schema.clone(), removed.programs.clone()).unwrap();
    assert_eq!(server.seq().unwrap(), seq);
    device.adopt(Backend { generation:server.generation(), ..removed }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    server.seed_delete("posts", "p").unwrap();
    server.seed([post("p", "charlie", Value::Null)]).unwrap();
    let (_, readded) = compile(SOURCE);
    server.adopt(readded.schema.clone(), readded.programs.clone()).unwrap();
    device.adopt(Backend { generation:server.generation(), ..readded }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    assert_eq!(device.query("received","alice",&json!({"authorId":"charlie"}),1000).unwrap().data,Value::Int(1));
    assert_eq!(device.query("answers","alice",&json!({}),1000).unwrap().data,server.query("answers",context("alice",&[]).at(1000)).unwrap().data);
    host.close("activation",device);
}
#[test]
fn activation_has_no_events_and_reacquires_both_stores() { activation(&mut Sqlite::new("recorded-activation")); activation(&mut Memory::new()); }

fn retained<H: Host>(host: &mut H) {
    let members = r#"table members:
  authorId: principal
  principal: principal
  unique byAuthorPrincipal: authorId, principal
  by byPrincipal: principal, authorId
  read <- allow
  delete <- .principal = viewer
  sync public
mutation leave():
  delete members['alice', viewer]
"#;
    // Public subset delivery is an admitted core schema form. Quarry currently
    // requires sync to invert the read rule, so exercise that wire form here.
    let source = format!("{members}\n{}", SOURCE.replacen("  by byExpiry:", "  by byAuthor: authorId, id\n  by byExpiry:", 1));
    let (_, mut backend) = compile(&source);
    let posts = backend.schema.tables.get_mut("posts").unwrap();
    posts.sync = Some(snapback4_core::schema::Sync { audience:snapback4_core::schema::Audience::Target { table:"members".into(),prefix:vec!["authorId".into()],principal:"principal".into() },horizon:None });
    posts.leave = snapback4_core::schema::LeavePolicy::DeliveredHistory;
    backend.schema.tables.get_mut("receivedReplies").unwrap().sync = None;
    let mut server = snapback4_core::Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
    backend.generation = server.generation();
    server.seed([("members".into(),snapback4_core::value::object([("id",id("m")),("authorId",id("alice")),("principal",id("alice"))])),post("p","alice",Value::Null)]).unwrap();
    let mut device=host.open("retained",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let from=server.seq().unwrap();
    server.mutate("leave",None,context("alice",&[])).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    let queued=device.admit(queued("p",1,1000)).unwrap();
    assert!(!queued.predictable && queued.predicted.is_empty(), "{}: {queued:?}",host.label());
    let from=server.seq().unwrap();
    server.seed_delete("posts", "p").unwrap();
    server.seed([("members".into(),snapback4_core::value::object([("id",id("m2")),("authorId",id("alice")),("principal",id("alice"))]))]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    let again = device.admit(super::recorded::queued("p",2,1000)).unwrap();
    assert!(!again.predictable && again.predicted.is_empty(), "a rejoined group cannot certify an old retained image: {again:?}");
    let from=server.seq().unwrap();
    server.seed([post("fresh","alice",Value::Null)]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    let fresh = device.admit(super::recorded::queued("fresh",3,1000)).unwrap();
    assert!(fresh.predictable && !fresh.predicted.is_empty(), "a fresh covered image in a rejoined group predicts: {fresh:?}");
    host.close("retained",device);
}
#[test]
fn a_retained_only_public_target_does_not_predict_on_both_stores() { retained(&mut Sqlite::new("recorded-retained")); retained(&mut Memory::new()); }

fn forged<H: Host>(host: &mut H) {
    use snapback4_core::{Engine, ir::{Expr, Stmt}, value::object};
    for kind in ["insert", "update", "upsert"] {
        let (_, mut backend) = compile(SOURCE);
        let program = backend.programs.iter_mut().find(|p| p.name == "like").unwrap();
        let row = object([("id",id("forged")),("postId",id("p")),("principal",id("alice")),("at",Value::Int(100)),("postId.authorId",id("alice"))]);
        program.body = vec![match kind {
            "update" => Stmt::Update { table:"likes".into(), key:Expr::Literal(id("l")), patch:Expr::Literal(object([("postId.authorId",id("alice"))])) },
            "upsert" => Stmt::Upsert { table:"likes".into(), key:Expr::Literal(id("forged")), row:Expr::Literal(row) },
            _ => Stmt::Insert { table:"likes".into(), row:Expr::Literal(row) },
        }];
        backend.schema.operations.clear();
        let mut server = Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
        server.seed([post("p","alice",Value::Null),("likes".into(),object([("id",id("l")),("postId",id("p")),("principal",id("alice")),("at",Value::Int(100))]))]).unwrap();
        backend.generation = server.generation();
        let mut device = host.open(kind,Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        assert_eq!(device.admit(queued("p",1,1000)).unwrap_err().refusal().code,"E_RECORDED_FIELD", "{kind}");
        assert!(device.queued().unwrap().is_empty());
        host.close(kind,device);
    }
}
#[test]
fn forged_payloads_refuse_on_both_stores() { forged(&mut Sqlite::new("recorded-forgery")); forged(&mut Memory::new()); }

fn clique<H: Host>(host: &mut H) {
    use snapback4_core::value::object;
    let (mut server, backend) = compile(SOURCE);
    let (name,mut reply) = post("reply","bob",Value::Null);
    if let Value::Row(fields) = &mut reply { fields.insert("parentId".into(),id("a")); }
    server.seed([post("a","alice",Value::Null),post("b","bob",Value::Null),(name,reply)]).unwrap();
    for (name,target) in [("la","a"),("lb","a"),("lc","b"),("lr","reply")] {
        server.seed([("likes".into(),object([("id",id(name)),("postId",id(target)),("principal",id("alice")),("at",Value::Int(100))]))]).unwrap();
    }
    let mut device=host.open("clique",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",2).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let answers=device.query("answers","alice",&json!({}),1000).unwrap().data;
    assert_eq!(answers,server.query("answers",context("alice",&[]).at(1000)).unwrap().data);
    // The hand-copied fixture's exact groups: two likes each, one reply to Alice,
    // and the reply's like excluded from the original-post trend.
    for author in ["alice","bob"] { assert_eq!(device.query("received","alice",&json!({"authorId":author}),1000).unwrap().data,Value::Int(2)); }
    assert_eq!(answers.field("daily").unwrap().as_array().unwrap().len(),2);
    let replies=answers.field("replies").unwrap().as_array().unwrap();
    assert_eq!(replies.len(),1);
    assert_eq!(replies[0].field("parentId.authorId").unwrap(),&id("alice"));
    assert_eq!(replies[0].field("value").unwrap(),&Value::Int(1));
    let trend=answers.field("trend").unwrap().as_array().unwrap();
    assert_eq!(trend.len(),2);
    assert_eq!(trend.iter().map(|row|row.field("value").unwrap().as_int().unwrap()).sum::<i64>(),3);
    host.close("clique",device);
}
#[test]
fn clique_answers_on_both_stores() { clique(&mut Sqlite::new("recorded-clique")); clique(&mut Memory::new()); }
