//! Recorded attribution is history; aggregates are reconstructible from that history.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::engine::LoadMode;
use snapback4_core::ir::{Expr, ProgramKind, Stmt};
use snapback4_core::value::object;
use std::collections::BTreeMap;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/recorded-attribution.q");
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn engine(source: &str) -> Engine {
    let b = bound(source); Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn post(name: &str, author: &str, parent: Value) -> (String, Value) {
    ("posts".into(), object([("id", id(name)), ("authorId", id(author)), ("parentId", parent), ("at", Value::Int(100)), ("until", Value::Null)]))
}
fn like(name: &str, post: &str, until: Value) -> (String, Value) {
    ("likes".into(), object([("id", id(name)), ("postId", id(post)), ("principal", id("alice")), ("at", Value::Int(100)), ("until", until), ("note", Value::String(String::new()))]))
}
fn answers(e: &mut Engine, now: i64) -> Value {
    e.query("answers", Context::new("alice", BTreeMap::new()).at(now)).unwrap().data
}
fn rebuild(e: &mut Engine, revision: usize, now: i64) -> Value {
    let mut b = bound(SOURCE);
    for m in &mut b.schema.maintains {
        for _ in 0..revision { m.filter = Some(snapback4_core::maintain::Predicate::And(Box::new(snapback4_core::maintain::Predicate::Bool(true)), Box::new(m.filter.take().unwrap_or(snapback4_core::maintain::Predicate::Bool(true))))); }
    }
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    answers(e, now)
}
#[test]
fn equivalence_after_deletion_reuse_and_unswept_expiry() {
    let mut e = engine(SOURCE);
    let now = snapback4_core::now_ms();
    e.seed([post("p", "alice", Value::Null), like("l", "p", Value::Int(now + 60_000))]).unwrap();
    let original = answers(&mut e, now);
    assert_eq!(original.field("received").unwrap().as_array().unwrap()[0].field("postId.authorId").unwrap(), &id("alice"));
    e.seed_delete("posts", "p").unwrap();
    assert_eq!(answers(&mut e, now), original);
    assert_eq!(rebuild(&mut e, 1, now), original);
    e.seed([post("p", "bob", Value::Null)]).unwrap();
    assert_eq!(rebuild(&mut e, 2, now), original);
    let expired = answers(&mut e, now + 60_001);
    assert!(expired.field("received").unwrap().as_array().unwrap().is_empty());
    assert_eq!(rebuild(&mut e, 3, now + 60_001), expired);
    let stored = e.store().rows("likes").unwrap();
    assert_eq!(stored[0].field("postId.authorId").unwrap(), &id("alice"));
}

#[test]
fn predicate_changes_read_recorded_facts_and_new_paths_capture_once() {
    let mut e = engine(SOURCE);
    e.seed([post("p", "alice", Value::Null), like("l", "p", Value::Null)]).unwrap();
    e.seed_delete("posts", "p").unwrap();
    e.seed([post("p", "bob", Value::Null)]).unwrap();
    let changed = SOURCE.replace("where true by postId.authorId", "where postId.authorId = 'alice' by postId.authorId");
    let b = bound(&changed); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(answers(&mut e, 1000).field("received").unwrap().as_array().unwrap()[0].field("value").unwrap(), &Value::Int(1));
    assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.authorId").unwrap(), &id("alice"));

    // Adding a second path must not recapture the surviving first path.
    let initial = format!("{}\nmaintain receivedLikes: count likes by postId.authorId\n  read <- allow\n", SOURCE.split("maintain receivedLikes:").next().unwrap());
    let mut e = engine(&initial);
    e.seed([like("l", "p", Value::Null), post("p", "alice", Value::Null)]).unwrap();
    e.seed_delete("posts", "p").unwrap();
    let (table, mut replacement) = post("p", "bob", Value::Null);
    if let Value::Row(fields) = &mut replacement { fields.insert("at".into(), Value::Int(7_200_000)); }
    e.seed([(table, replacement)]).unwrap();
    let b = bound(SOURCE); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let row = &e.store().rows("likes").unwrap()[0];
    assert_eq!(row.field("postId.authorId").unwrap(), &id("alice"));
    assert_eq!(row.field("postId.at").unwrap(), &Value::Int(7_200_000));
}

#[test]
fn activation_assesses_sums_using_the_new_capture_groups() {
    let bare = SOURCE.split("maintain receivedLikes:").next().unwrap().replace("  note: text", "  amount: int\n  note: text");
    let mut e = engine(&bare);
    e.seed([post("a", "alice", Value::Null), post("b", "bob", Value::Null)]).unwrap();
    for name in ["a", "b"] {
        let (table, mut row) = like(name, name, Value::Null);
        if let Value::Row(fields) = &mut row { fields.insert("amount".into(), Value::Int(snapback4_core::value::I53_MAX)); }
        e.seed([(table, row)]).unwrap();
    }
    let next = format!("{bare}\nmaintain amounts: sum likes of amount by postId.authorId\n  read <- allow\nquery totals():\n  return amounts first 100 by byGroup\n");
    let b = bound(&next); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let values = e.query("totals", Context::new("alice", BTreeMap::new())).unwrap().data;
    assert_eq!(values.as_array().unwrap().len(), 2, "the null pre-capture group would overflow");
}

#[test]
fn activation_dangling_expired_reused_and_removed_paths() {
    let bare = SOURCE.split("maintain receivedLikes:").next().unwrap();
    let mut e = engine(bare);
    let (table, row) = like("l", "p", Value::Null);
    let row = match row { Value::Row(fields) => Value::Map(fields), _ => unreachable!() };
    e.seed([post("p", "old", Value::Null), (table,row), like("dangling", "absent", Value::Null)]).unwrap();
    e.seed_delete("posts", "p").unwrap();
    e.seed([post("p", "new", Value::Null)]).unwrap();
    let seq = e.seq().unwrap();
    let b = bound(SOURCE); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.seq().unwrap(), seq);
    let rows = e.store().rows("likes").unwrap();
    assert_eq!(rows.iter().find(|r| r.field("id").unwrap() == &id("l")).unwrap().field("postId.authorId").unwrap(), &id("new"));
    let nulls = e.recorded_nulls().unwrap();
    assert_eq!(nulls.captures["likes"]["postId.authorId"], 1);
    assert_eq!(nulls.contributions["receivedLikes"], 1);
    assert_eq!(nulls.contributions["receivedReplies"], 0, "original posts capture null parents but are not selected replies");
    let captured = answers(&mut e, 1000); assert_eq!(rebuild(&mut e, 1, 1000), captured);
    let b = bound(bare); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert!(e.store().rows("likes").unwrap().iter().all(|r| r.field("postId.authorId").is_err()));
    e.seed_delete("posts", "p").unwrap();
    e.seed([post("p", "third", Value::Null)]).unwrap();
    let b = bound(SOURCE); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.store().rows("likes").unwrap().iter().find(|r| r.field("id").unwrap() == &id("l")).unwrap().field("postId.authorId").unwrap(), &id("third"));
    let recaptured = answers(&mut e, 1000); assert_eq!(rebuild(&mut e, 2, 1000), recaptured);

    let mut e = engine(bare);
    let (name, mut expired) = post("p", "old", Value::Null);
    if let Value::Row(fields) = &mut expired { fields.insert("until".into(), Value::Int(1)); }
    e.load([(name, expired), like("l", "p", Value::Null)]).unwrap();
    let b = bound(SOURCE); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.at").unwrap(), &Value::Null);
    let trend = answers(&mut e, 1000).field("trend").unwrap().as_array().unwrap().to_vec();
    assert_eq!(trend[0].field("hour").unwrap(), &Value::Null);
}

#[test]
fn untrusted_import_refuses_forgery_and_trusted_restore_keeps_history() {
    let mut e = engine(SOURCE);
    // Source comes first: imports resolve against all imported targets.
    e.load([like("l", "p", Value::Null), post("p", "alice", Value::Null)]).unwrap();
    let stored = e.store().rows("likes").unwrap()[0].clone();
    assert_eq!(stored.field("postId.authorId").unwrap(), &id("alice"));
    assert_eq!(e.load([("likes".into(), stored.clone())]).unwrap_err().refusal().code, "E_RECORDED_FIELD");
    assert_eq!(e.seed([("likes".into(), stored.clone())]).unwrap_err().refusal().code, "E_RECORDED_FIELD");
    let before_delete = answers(&mut e,1000);
    e.seed_delete("posts", "p").unwrap();
    assert_eq!(e.store().rows("likes").unwrap()[0],stored);
    assert_eq!(answers(&mut e,1000),before_delete);
    let mut restored = engine(SOURCE);
    restored.load_mode([("likes".into(), stored.clone())], LoadMode::Restore).unwrap();
    assert_eq!(restored.store().rows("likes").unwrap()[0], stored);
    let mut imported = engine(SOURCE);
    let (table, mut last) = like("l", "p", Value::Null);
    if let Value::Row(fields) = &mut last { fields.insert("note".into(),Value::String("last".into())); }
    imported.load([like("l", "p", Value::Null), (table,last), post("p","alice",Value::Null)]).unwrap();
    let row=&imported.store().rows("likes").unwrap()[0];
    assert_eq!(row.field("note").unwrap(),&Value::String("last".into()));
    assert_eq!(row.field("postId.authorId").unwrap(),&id("alice"));
    let (table, mut same) = post("p", "alice", Value::Null);
    if let Value::Row(fields) = &mut same { fields.remove("parentId"); }
    imported.load([(table, same)]).unwrap(); // Missing optional and explicit null are the same reference.
    let parent = &imported.store().rows("posts").unwrap()[0];
    assert_eq!(parent.as_object().unwrap().get("parentId"),None);
    assert_eq!(parent.field("parentId.authorId").unwrap(),&Value::Null);
    imported.load([post("p","bob",Value::Null)]).unwrap();
    assert_eq!(imported.store().rows("posts").unwrap()[0].field("authorId").unwrap(),&id("bob"));
    imported.load([like("l","p",Value::Null)]).unwrap();
    assert_eq!(imported.store().rows("likes").unwrap()[0].field("postId.authorId").unwrap(),&id("alice"));

    let mut b = bound(SOURCE);
    b.schema.tables.get_mut("posts").unwrap().defaults.insert("parentId".into(),snapback4_core::schema::ColumnDefault::Literal(id("p")));
    let mut defaults = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    defaults.seed([post("p","alice",Value::Null)]).unwrap();
    let (table, mut reply) = post("reply","bob",Value::Null);
    if let Value::Row(fields) = &mut reply { fields.remove("parentId"); }
    defaults.load([(table,reply)]).unwrap();
    let reply=defaults.store().rows("posts").unwrap().into_iter().find(|row|row.field("id").unwrap()==&id("reply")).unwrap();
    assert!(matches!(reply.as_object().unwrap().get("parentId"),None | Some(Value::Null)));
    assert_eq!(reply.field("parentId.authorId").unwrap(),&Value::Null,"missing optional fields in imported images read as null, including when inserts have a default");
    let (table, mut reply) = post("inserted-reply","bob",Value::Null);
    if let Value::Row(fields) = &mut reply { fields.remove("parentId"); }
    defaults.seed([(table,reply)]).unwrap();
    let reply=defaults.store().rows("posts").unwrap().into_iter().find(|row|row.field("id").unwrap()==&id("inserted-reply")).unwrap();
    assert_eq!(reply.field("parentId").unwrap(),&id("p"));
    assert_eq!(reply.field("parentId.authorId").unwrap(),&id("alice"),"insert defaults precede capture");
}

#[test]
fn forged_program_payloads_and_system_jobs_are_refused_including_noop_updates() {
    for kind in ["insert", "update", "upsert", "job"] {
        let mut b = bound(SOURCE);
        let mut p = b.programs.iter().find(|p| p.program.name == "like").unwrap().program.clone();
        p.name = "forge".into(); p.args.clear();
        if kind == "job" { p.kind = ProgramKind::Job; }
        let mut fields = like("forged", "p", Value::Null).1.as_object().unwrap().clone();
        fields.insert("postId.authorId".into(), id("alice"));
        p.body = vec![match kind {
            "update" => Stmt::Update { table: "likes".into(), key: Expr::Literal(id("l")), patch: Expr::Literal(object([("postId.authorId", id("alice"))])) },
            "upsert" => Stmt::Upsert { table: "likes".into(), key: Expr::Literal(id("forged")), row: Expr::Literal(Value::Row(fields.into())) },
            _ => Stmt::Insert { table: "likes".into(), row: Expr::Literal(Value::Row(fields.into())) },
        }];
        if kind == "job" {
            let query = &b.programs.iter().find(|p| p.program.name == "allLikes").unwrap().program;
            let scan = snapback4_core::ir::scans(query)[0].clone();
            p.body = vec![Stmt::For { binding: "item".into(), domain: snapback4_core::ir::LoopDomain::Page(scan), body: p.body }];
        }
        b.schema.operations.clear();
        let mut e = Engine::memory(b.schema, [p]).unwrap();
        e.seed([post("p", "alice", Value::Null), like("l", "p", Value::Null)]).unwrap();
        let stored=e.store().rows("likes").unwrap();
        if kind == "job" {
            let run = e.run_job("forge", BTreeMap::new(), 1000).unwrap();
            assert!(run.error.unwrap().contains("E_RECORDED_FIELD"));
        } else {
            let out = e.mutate("forge", None, Context::new("alice", BTreeMap::new()).at(1000)).unwrap();
            let WriteState::Failed { why, .. } = out.state else { panic!("forged {kind} passed") };
            assert_eq!(why.code, "E_RECORDED_FIELD", "{kind}: {why:?}");
        }
        assert_eq!(e.store().rows("likes").unwrap(),stored);
        assert_eq!(e.store().rows("likes").unwrap().len(),1);
        assert_eq!(e.store().rows("likes").unwrap()[0].field("id").unwrap(),&id("l"));
        assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.authorId").unwrap(),&id("alice"));
    }
}

#[test]
fn clique_fixture_matches_the_hand_copied_model() {
    let mut recorded = engine(SOURCE);
    let hand = SOURCE.replace("  note: text", "  copiedAuthor: principal ?\n  copiedAt: time ?\n  copiedParent: posts ?\n  copiedHour: int ?\n  note: text")
        .replace("  parentId: posts ? on delete keep", "  replyAuthor: principal ?\n  parentId: posts ? on delete keep")
        .replace("hour(postId.at)", "copiedHour").replace("postId.authorId", "copiedAuthor")
        .replace("postId.parentId", "copiedParent").replace("postId.at", "copiedAt").replace("parentId.authorId", "replyAuthor").replace("where copiedParent", "where .copiedParent");
    let mut copied = engine(&hand);
    let (name, mut later) = post("b", "bob", Value::Null);
    if let Value::Row(fields) = &mut later { fields.insert("at".into(),Value::Int(7_200_100)); }
    let rows = [post("a", "alice", Value::Null), (name,later), post("reply", "bob", id("a")), like("la", "a", Value::Null), like("lb", "a", Value::Null), like("lc", "b", Value::Null), like("lr", "reply", Value::Null), like("null","absent",Value::Null)];
    let targets: BTreeMap<_,_> = rows.iter().filter(|(name,_)| name == "posts").map(|(_,row)|(row.field("id").unwrap().as_str().unwrap().to_owned(),row.clone())).collect();
    recorded.seed(rows.clone()).unwrap();
    let stored = &recorded.store().rows("likes").unwrap()[0];
    let mut visible = stored.as_object().unwrap().clone();
    visible.retain(|field, _| !recorded.schema().tables["likes"].recorded.contains_key(field));
    let stored_bytes = snapback4_core::value::canonical_json(stored).len();
    let visible_bytes = snapback4_core::value::canonical_json(&Value::Row(visible.into())).len();
    println!("Clique source image: {visible_bytes} B before attribution, {stored_bytes} B recorded (+{} B, 3 distinct paths)", stored_bytes-visible_bytes);
    for (table, mut row) in rows {
        if let Value::Row(fields) = &mut row {
            if table == "likes" {
                let target = targets.get(fields["postId"].as_str().unwrap());
                let value = |name| target.map(|row|row.field(name).unwrap().clone()).unwrap_or(Value::Null);
                let at = value("at");
                let hour = match at { Value::Int(at) => Value::Int(at.div_euclid(3_600_000)), _ => Value::Null };
                fields.insert("copiedAuthor".into(), value("authorId")); fields.insert("copiedAt".into(), at);
                fields.insert("copiedHour".into(), hour); fields.insert("copiedParent".into(), value("parentId"));
            } else { let author = if fields["id"] == id("reply") { id("alice") } else { Value::Null }; fields.insert("replyAuthor".into(), author); }
        }
        copied.seed([(table, row)]).unwrap();
    }
    let actual = serde_json::to_string(&answers(&mut recorded, 1000)).unwrap();
    let expected = serde_json::to_string(&answers(&mut copied, 1000)).unwrap().replace("copiedAuthor", "postId.authorId").replace("copiedAt", "postId.at").replace("copiedHour", "hour").replace("replyAuthor", "parentId.authorId");
    let actual: serde_json::Value = serde_json::from_str(&actual).unwrap();
    let expected: serde_json::Value = serde_json::from_str(&expected).unwrap();
    assert_eq!(actual, expected);
    let counts = answers(&mut recorded,1000);
    let received = counts.field("received").unwrap().as_array().unwrap();
    assert_eq!(received.len(),3);
    for (author,total) in [(id("alice"),2),(id("bob"),2),(Value::Null,1)] {
        let group=received.iter().find(|row|row.field("postId.authorId").unwrap()==&author).unwrap();
        assert_eq!(group.field("value").unwrap(),&Value::Int(total));
    }
    assert_eq!(received.iter().map(|r|r.field("value").unwrap().as_int().unwrap()).sum::<i64>(),5);
    let visible = recorded.query("allLikes", Context::new("alice", BTreeMap::new()).at(1000)).unwrap().data;
    assert!(!visible.as_array().unwrap().is_empty());
    for path in ["postId.authorId","postId.at","postId.parentId"] { assert!(visible.as_array().unwrap().iter().all(|r| r.field(path).is_err())); }
}

#[path = "recorded/round1.rs"]
mod round1;
