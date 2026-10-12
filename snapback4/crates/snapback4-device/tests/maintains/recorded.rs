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
    Queued { upload: None, id:format!("q{n}"), seq:n, op:"like".into(), args:json!({"postId":post,"at":100,"until":null}), viewer:"alice".into(), now, new_ids:vec![format!("l{n}")], predicted:vec![], predictable:true, sent_seq:None, receipt_store:None, observed_seq:None, dispatch: None }
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
    let delivered = stream_page(&mut server,"alice",from);
    let like_image = delivered.events.iter().find(|event|event.table=="likes" && event.id=="l1").unwrap().data.as_ref().unwrap();
    assert_eq!(like_image["postId.authorId"],json!("alice"));
    device.apply(&delivered, false).unwrap();
    // Server deletion/recreation never changes historical captures on a source.
    for (revision, replacement) in [None, Some("bob")].into_iter().enumerate() {
        let from = server.seq().unwrap();
        if let Some(author) = replacement { server.seed([post("p", author, Value::Null)]).unwrap(); }
        else { server.seed_delete("posts", "p").unwrap(); }
        let page = stream_page(&mut server,"alice",from);
        if replacement.is_some() { assert!(page.events.iter().any(|event|event.table=="posts" && event.id=="p" && event.data.as_ref().is_some_and(|row|row["authorId"]=="bob"))); }
        if replacement.is_none() {assert!(page.events.iter().any(|event|event.table=="posts" && event.id=="p" && event.kind=="del"));}
        device.apply(&page, false).unwrap();
        assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),now).unwrap().data,Value::Int(1));
        assert_eq!(device.query("received","alice",&json!({"authorId":"bob"}),now).unwrap().data,Value::Int(0));
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
    assert_eq!(server.seq().unwrap(), seq + 1);
    device.adopt(Backend { generation:server.generation(), ..next }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    assert_eq!(device.query("answers", "alice", &json!({}), now).unwrap().data, historical);
    let excluded = SOURCE.replace("where true by postId.authorId", "where postId.authorId = 'bob' by postId.authorId");
    assert_ne!(excluded,SOURCE);
    let (_, next) = compile(&excluded);
    server.adopt(next.schema.clone(),next.programs.clone()).unwrap();
    device.adopt(Backend { generation:server.generation(),..next }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),now).unwrap().data,Value::Int(0));
    assert_eq!(device.query("answers","alice",&json!({}),now).unwrap().data,server.query("answers",context("alice",&[]).at(now)).unwrap().data);
    let from=server.seq().unwrap();
    server.seed([("likes".into(),snapback4_core::value::object([("id",id("bob-like")),("postId",id("p")),("principal",id("alice")),("at",Value::Int(100)),("until",Value::Null)]))]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    assert_eq!(device.query("received","alice",&json!({"authorId":"bob"}),now).unwrap().data,Value::Int(1));
    assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),now).unwrap().data,Value::Int(0));
    server.seed_delete("likes","bob-like").unwrap();
    let (_, next) = compile(SOURCE);
    server.adopt(next.schema.clone(),next.programs.clone()).unwrap();
    device.adopt(Backend { generation:server.generation(),..next }).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let from = server.seq().unwrap();
    server.seed([("likes".into(), snapback4_core::value::object([("id",id("l1")), ("until",Value::Int(now + 60_000))]))]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),now).unwrap().data,Value::Int(1));
    assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),now+60_001).unwrap().data,Value::Int(0));
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
    for (author, count) in [(json!("bob"),1),(json!("alice"),0),(serde_json::Value::Null,1)] {
        assert_eq!(device.query("received","alice",&json!({"authorId":author}),1000).unwrap().data,Value::Int(count));
    }
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
    let source = format!("{members}\n{}\nquery allPosts():\n  return posts first 100 by byId\n", SOURCE.replacen("  by byExpiry:", "  by byAuthor: authorId, id\n  by byExpiry:", 1));
    let (_, mut backend) = compile(&source);
    let posts = backend.schema.tables.get_mut("posts").unwrap();
    posts.sync = Some(snapback4_core::schema::Sync { audience:snapback4_core::schema::Audience::Target { table:"members".into(),prefix:vec!["authorId".into()],principal:"principal".into() },horizon:Some(snapback4_core::schema::Horizon { last:1, by:"byAuthor".into() }), also: Vec::new() });
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
    assert!(device.query("allPosts", "alice", &json!({}), 1000).unwrap().data.as_array().unwrap().iter().any(|r| r.field("id").unwrap() == &id("p")));
    server.seed([post("z-new", "alice", Value::Null)]).unwrap();
    server.seed([("members".into(),snapback4_core::value::object([("id",id("m2")),("authorId",id("alice")),("principal",id("alice"))]))]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    assert!(device.query("allPosts", "alice", &json!({}), 1000).unwrap().data.as_array().unwrap().iter().any(|r| r.field("id").unwrap() == &id("p")));
    let again = device.admit(super::recorded::queued("p",2,1000)).unwrap();
    assert!(!again.predictable && again.predicted.is_empty(), "a rejoined group cannot certify an old retained image: {again:?}");
    assert_eq!(device.queued().unwrap().iter().map(|q|(q.id.as_str(),q.args["postId"].as_str().unwrap())).collect::<Vec<_>>(),[("q1","p"),("q2","p")]);
    assert!(device.query("allPosts","alice",&json!({}),1000).unwrap().data.as_array().unwrap().iter().any(|row|row.field("id").unwrap()==&id("z-new")));
    let reacquired=device.admit(super::recorded::queued("z-new",3,1000)).unwrap();
    assert!(reacquired.predictable && !reacquired.predicted.is_empty());
    let from=server.seq().unwrap();
    server.seed([post("zz-fresh","alice",Value::Null)]).unwrap();
    device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    let fresh = device.admit(super::recorded::queued("zz-fresh",4,1000)).unwrap();
    assert!(fresh.predictable && !fresh.predicted.is_empty(), "a fresh covered image in a rejoined group predicts: {fresh:?}");
    assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),1000).unwrap().data,Value::Int(2));
    host.close("retained",device);
}
#[test]
fn a_retained_only_public_target_does_not_predict_on_both_stores() { retained(&mut Sqlite::new("recorded-retained")); retained(&mut Memory::new()); }

fn forged<H: Host>(host: &mut H) {
    use snapback4_core::{Engine, ir::{Expr, Stmt}, value::object};
    for (kind,forged_author) in ["insert", "update", "upsert"].into_iter().flat_map(|kind|["alice","mallory"].map(|author|(kind,author))) {
        let (_, mut backend) = compile(SOURCE);
        let program = backend.programs.iter_mut().find(|p| p.name == "like").unwrap();
        let row = object([("id",id("forged")),("postId",id("p")),("principal",id("alice")),("at",Value::Int(100)),("postId.authorId",id(forged_author))]);
        program.body = vec![match kind {
            "update" => Stmt::Update { table:"likes".into(), key:Expr::Literal(id("l")), patch:Expr::Literal(object([("postId.authorId",id(forged_author))])) },
            "upsert" => Stmt::Upsert { table:"likes".into(), key:Expr::Literal(id("forged")), row:Expr::Literal(row) },
            _ => Stmt::Insert { table:"likes".into(), row:Expr::Literal(row) },
        }];

        let mut server = Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
        server.seed([post("p","alice",Value::Null),("likes".into(),object([("id",id("l")),("postId",id("p")),("principal",id("alice")),("at",Value::Int(100))]))]).unwrap();
        backend.generation = server.generation();
        let name=format!("{kind}-{forged_author}");
        let mut device = host.open(&name,Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        let error = device.admit(queued("p",1,1000)).unwrap_err();
        assert_eq!(error.refusal().code,"E_RECORDED_FIELD", "{kind}");
        assert!(error.to_string().contains("postId.authorId"));
        assert!(device.queued().unwrap().is_empty());
        host.close(&name,device);
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

fn membership_expiry<H: Host>(host: &mut H, retain: bool) {
    use snapback4_core::{schema::{Audience, Sync, LeavePolicy}, value::object};
    let source = format!("table members:\n  authorId: principal\n  principal: principal\n  until: time ?\n  unique byAuthorPrincipal: authorId, principal\n  by byPrincipal: principal, authorId\n  by byExpiry: until, id\n  expire at .until\n  read <- allow\n  sync public\n{}", SOURCE.replacen("  by byExpiry:", "  by byAuthor: authorId, id\n  by byExpiry:", 1));
    let (_, mut backend) = compile(&source);
    let posts = backend.schema.tables.get_mut("posts").unwrap();
    posts.sync = Some(Sync { audience: Audience::Target { table: "members".into(), prefix: vec!["authorId".into()], principal: "principal".into() }, horizon: None, also: Vec::new() });
    posts.leave = if retain { LeavePolicy::DeliveredHistory } else { LeavePolicy::UntilRevoked };
    backend.schema.tables.get_mut("receivedReplies").unwrap().sync = None;
    let mut server = snapback4_core::Engine::memory(backend.schema.clone(), backend.programs.clone()).unwrap();
    let expires = snapback4_core::now_ms() + 60_000;
    server.seed([("members".into(), object([("id",id("m")), ("authorId",id("alice")), ("principal",id("alice")), ("until",Value::Int(expires))])),post("p","alice",Value::Null)]).unwrap();
    backend.generation = server.generation();
    let name = if retain { "expiry-retained" } else { "expiry-revoked" };
    let mut device = host.open(name, Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let good = device.admit(queued("p",1,expires-1)).unwrap();
    assert!(good.predictable && !good.predicted.is_empty());
    assert_eq!(device.queued().unwrap().iter().map(|q|q.id.as_str()).collect::<Vec<_>>(),["q1"]);
    let live_before=device.query("received","alice",&json!({"authorId":"alice"}),expires-1).unwrap().data;
    assert_eq!(live_before,Value::Int(1));
    let before = device.query("received","alice",&json!({"authorId":"alice"}),expires+1).unwrap().data;
    let expired = device.admit(queued("p",2,expires+1)).unwrap();
    assert!(!expired.predictable && expired.predicted.is_empty(), "expired membership before sweep/scope delivery: {expired:?}");
    assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),expires+1).unwrap().data, before);
    assert_eq!(device.queued().unwrap().len(), 2);
    server.seed([post("uncovered","alice",Value::Null)]).unwrap();
    for (n,target) in [(3,"uncovered"),(4,"absent")] {
        let out = device.admit(queued(target,n,expires-1)).unwrap();
        assert!(!out.predictable && out.predicted.is_empty());
        assert_eq!(device.query("received","alice",&json!({"authorId":"alice"}),expires-1).unwrap().data,live_before);
    }
    let at_expiry=device.admit(queued("p",5,expires)).unwrap();
    assert!(!at_expiry.predictable && at_expiry.predicted.is_empty());
    host.close(name,device);
}
#[test]
fn membership_expiry_before_sweep_and_scope_on_both_stores() {
    for retain in [true, false] { membership_expiry(&mut Sqlite::new("recorded-expiry"),retain); membership_expiry(&mut Memory::new(),retain); }
}
