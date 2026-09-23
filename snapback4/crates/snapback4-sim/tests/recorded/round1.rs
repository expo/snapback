// Shared fixture helpers live in the attribution integration test.
use super::*;

#[test]
fn ordinary_updates_and_upsert_update_preserve_capture() {
    let mut b = bound(SOURCE);
    let program = b.programs.iter_mut().find(|p| p.program.name == "edit").unwrap();
    program.program.body = vec![Stmt::Upsert { table: "likes".into(), key: Expr::Literal(id("l")), row: Expr::Literal(object([("id", id("l")), ("note", Value::String("upsert".into()))])) }];
    let mut e = engine(SOURCE);
    e.seed([post("p", "alice", Value::Null), like("l", "p", Value::Null)]).unwrap();
    e.seed_delete("posts", "p").unwrap();
    let out = e.mutate("edit", None, Context::new("alice", BTreeMap::from([("row".into(), id("l")), ("note".into(), Value::String("edit".into()))]))).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.authorId").unwrap(), &id("alice"));
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let out = e.mutate("edit", None, Context::new("alice", BTreeMap::from([("row".into(), id("l")), ("note".into(), Value::String("unused".into()))]))).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    let row = &e.store().rows("likes").unwrap()[0];
    assert_eq!(row.field("postId.authorId").unwrap(), &id("alice"));
    assert_eq!(row.field("note").unwrap(), &Value::String("upsert".into()));
}

#[test]
fn separate_import_commits_and_winning_forgery() {
    let mut e = engine(SOURCE);
    e.load([post("p", "alice", Value::Null)]).unwrap();
    e.load([like("l", "p", Value::Null)]).unwrap();
    let saved = e.store().rows("likes").unwrap();
    assert_eq!(saved[0].field("postId.authorId").unwrap(), &id("alice"));
    let (name, mut forged) = like("l", "p", Value::Null);
    if let Value::Row(fields) = &mut forged { fields.insert("postId.authorId".into(), id("mallory")); }
    assert_eq!(e.load([like("l", "p", Value::Null), (name, forged)]).unwrap_err().refusal().code, "E_RECORDED_FIELD");
    assert_eq!(e.store().rows("likes").unwrap(), saved);
    e.seed_delete("posts", "p").unwrap();
    e.load([like("l", "p", Value::Null)]).unwrap();
    assert_eq!(e.store().rows("likes").unwrap(), saved);
    let mut e = engine(SOURCE);
    e.load([like("l", "p", Value::Null)]).unwrap();
    e.load([post("p", "alice", Value::Null)]).unwrap();
    e.load([like("l", "p", Value::Null)]).unwrap();
    assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.authorId").unwrap(), &Value::Null);
    for seed in [false, true] {
        let mut e = engine(SOURCE);
        let (name, mut expired) = post("p", "alice", Value::Null);
        if let Value::Row(fields) = &mut expired { fields.insert("until".into(), Value::Int(1)); }
        let rows = [like("l", "p", Value::Null), (name, expired)];
        if seed { e.seed(rows).unwrap(); } else { e.load(rows).unwrap(); }
        assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.at").unwrap(), &Value::Null);
    }
}

#[test]
fn literal_field_lookup_and_nullable_required_target_time() {
    let row = object([("postId", object([("at", Value::Int(2))])), ("postId.at", Value::Int(1))]);
    assert_eq!(row.field("postId.at").unwrap(), &Value::Int(1));
    let mut e = engine(SOURCE);
    e.seed([like("l", "missing", Value::Null)]).unwrap();
    assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.at").unwrap(), &Value::Null);
    let trend = answers(&mut e, 1000);
    assert_eq!(trend.field("trend").unwrap().as_array().unwrap()[0].field("hour").unwrap(), &Value::Null);
}

#[test]
fn later_unrelated_rebuild_and_live_sum_repair_log_their_changes() {
    let base = SOURCE.replace("  note: text", "  amount: int default 1\n  note: text");
    let mut e = engine(&base);
    e.seed([post("p", "alice", Value::Null), like("l", "p", Value::Null)]).unwrap();
    let next = format!("{base}\nmaintain amounts: sum likes of amount by principal\n  read <- allow\n");
    let seq = e.seq().unwrap();
    let b = bound(&next); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.seq().unwrap(), seq + 1, "unrelated maintain rebuild records its commit");
    assert!(e.stream("alice", seq, 100).unwrap().events.iter().any(|event| event.table == "amounts"));
    e.store().conn().execute("DELETE FROM _meta WHERE key = 'live_sum_candidates'", []).unwrap();
    let seq = e.seq().unwrap();
    let b = bound(&next); e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.seq().unwrap(), seq + 1, "live-sum repair records its commit");
    assert!(e.stream("alice", seq, 100).unwrap().events.iter().any(|event| event.table == "amounts"));
}

#[test]
fn activation_capture_persists_after_reopen_and_empty_capture_has_no_gap() {
    let dir = std::env::temp_dir().join(format!("f2-activation-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let bare = SOURCE.split("maintain receivedLikes:").next().unwrap();
    let b = bound(bare);
    let mut e = Engine::new(snapback4_core::store::Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([post("p", "alice", Value::Null), like("l", "p", Value::Null)]).unwrap();
    let b = bound(SOURCE); e.adopt(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    drop(e);
    let e = Engine::open(snapback4_core::store::Store::open(&path).unwrap()).unwrap();
    assert_eq!(e.store().rows("likes").unwrap()[0].field("postId.authorId").unwrap(), &id("alice"));
    drop(e); std::fs::remove_dir_all(dir).unwrap();
    let mut e = engine(bare);
    let seq = e.seq().unwrap();
    let b = bound(SOURCE); e.adopt(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(e.seq().unwrap(), seq);
    e.seed([post("p", "alice", Value::Null)]).unwrap();
    assert_eq!(e.seq().unwrap(), seq+1);
}

#[test]
fn ranking_and_trending_project_recorded_keys() {
    let source = SOURCE.replace("  expire at .until\n", "").replace("  read <- allow\nmaintain dailyLikes", "  read <- allow\n  by ranking: value, postId.authorId\nmaintain dailyLikes");
    let source = format!("{source}\nquery ranking():\n  return receivedLikes last 10 by ranking {{authorId: .postId.authorId, count: .value}}\nquery trending():\n  rows = trend first 100 by byGroup {{post: .postId, at: .postId.at, count: .value}}\n  return sort(rows, '-at')\nquery guarded():\n  for r in trend first 100 by byGroup:\n    if r.postId.at != null:\n      return r.postId.at + 1\n  return null\nquery lookup(author: principal ?):\n  return receivedLikes[postId.authorId = author]\nquery selected(author: principal ?):\n  return receivedLikes first 10 by byGroup where .postId.authorId = author {{authorId: .postId.authorId, count: .value}}\n");
    let mut e = engine(&source);
    let (name, mut newer) = post("b", "bob", Value::Null);
    if let Value::Row(fields) = &mut newer { fields.insert("at".into(), Value::Int(3_600_100)); }
    e.seed([post("a","alice",Value::Null), (name,newer), like("a1","a",Value::Null), like("a2","a",Value::Null), like("b1","b",Value::Null), like("none","absent",Value::Null)]).unwrap();
    let query = |e: &mut Engine, name: &str| e.query(name,Context::new("alice",BTreeMap::new())).unwrap().data;
    let ranked = query(&mut e,"ranking");
    assert_eq!(ranked.as_array().unwrap()[0], object([("authorId",id("alice")),("count",Value::Int(2))]));
    let trend = query(&mut e,"trending");
    let trend = trend.as_array().unwrap();
    assert_eq!(trend.len(),3);
    assert_eq!(trend[0].field("at").unwrap(),&Value::Int(3_600_100));
    assert_eq!(trend[2].field("at").unwrap(),&Value::Null);
    let selected = e.query("selected",Context::new("alice",BTreeMap::from([("author".into(),id("alice"))]))).unwrap().data;
    assert_eq!(selected.as_array().unwrap(),&ranked.as_array().unwrap()[..1]);
    let lookup = e.query("lookup",Context::new("alice",BTreeMap::from([("author".into(),id("alice"))]))).unwrap().data;
    assert_eq!(lookup,Value::Int(2));
    assert_eq!(query(&mut e,"guarded"),Value::Int(101));
}

#[test]
fn a_recorded_column_cannot_have_an_application_default() {
    let mut b = bound(SOURCE);
    b.schema.tables.get_mut("likes").unwrap().defaults.insert("postId.authorId".into(), snapback4_core::schema::ColumnDefault::Literal(id("forged")));
    assert!(snapback4_core::schema::validate(&b.schema).iter().any(|issue| issue.path.contains("recorded")));
}

#[test]
fn capture_and_reimport_propagate_store_read_errors_without_null_writes() {
    for table in ["posts", "likes"] {
        let mut e = engine(SOURCE);
        e.seed([post("p","alice",Value::Null),like("l","p",Value::Null)]).unwrap();
        let seq = e.seq().unwrap();
        e.store().conn().execute("UPDATE r SET data = 'not-json' WHERE t = (SELECT num FROM _catalog WHERE name = ?1)", [table]).unwrap();
        let error = if table == "posts" { e.seed([like("new","p",Value::Null)]) } else { e.load([like("l","p",Value::Null)]) }.unwrap_err();
        assert!(matches!(error,snapback4_core::RuntimeError::Store(_)),"{error}");
        assert_eq!(e.seq().unwrap(),seq);
        let corrupted: String = e.store().conn().query_row("SELECT data FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1)",[table],|r|r.get(0)).unwrap();
        assert_eq!(corrupted,"not-json");
    }
}

#[test]
fn program_insert_applies_reference_default_before_capture() {
    let source = format!("{SOURCE}\nmutation reply():\n  insert posts {{authorId: viewer, at: now}}\n");
    let mut b = bound(&source);
    b.schema.tables.get_mut("posts").unwrap().defaults.insert("parentId".into(),snapback4_core::schema::ColumnDefault::Literal(id("p")));
    let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.seed([post("p","alice",Value::Null)]).unwrap();
    let result = e.mutate("reply",None,Context::new("bob",BTreeMap::new()).at(1000).with_ids(["reply".into()])).unwrap();
    assert!(matches!(result.state,WriteState::Sent{..}),"{result:?}");
    let rows=e.store().rows("posts").unwrap();
    let reply=rows.iter().find(|r|r.field("id").unwrap()==&id("reply")).unwrap();
    assert_eq!(reply.field("parentId").unwrap(),&id("p"));
    assert_eq!(reply.field("parentId.authorId").unwrap(),&id("alice"));
}

#[test]
fn malformed_target_fields_are_errors_not_null_captures() {
    let mut e = engine(SOURCE);
    e.seed([post("p","alice",Value::Null)]).unwrap();
    let mut malformed = e.store().rows("posts").unwrap().remove(0);
    if let Value::Row(fields) = &mut malformed { fields.remove("authorId"); }
    let bytes = serde_json::to_string(&malformed).unwrap();
    e.store().conn().execute("UPDATE r SET data = ?1 WHERE t = (SELECT num FROM _catalog WHERE name = 'posts')",[bytes]).unwrap();
    assert!(e.seed([like("l","p",Value::Null)]).is_err());
    assert!(e.store().rows("likes").unwrap().is_empty());
}

#[test]
fn uncovered_large_target_returns_prediction_before_heap_refusal() {
    let source = SOURCE.replacen("table posts:","table posts:\n  body: text <=100000 default ''",1);
    let mut e = engine(&source);
    let (table,mut row) = post("p","alice",Value::Null);
    // The unused payload is read from storage but does not certify coverage.
    if let Value::Row(fields) = &mut row { fields.insert("body".into(),Value::String("x".repeat(100_000))); }
    e.seed([(table,row)]).unwrap();
    let b = bound(&source);
    let program = &b.programs.iter().find(|p|p.program.name=="like").unwrap().program;
    let tx = e.store_mut().read_transaction().unwrap();
    // A server Rows view supplies no device coverage witness.
    let context = Context::new("alice",BTreeMap::from([("postId".into(),id("p")),("at".into(),Value::Int(100)),("until".into(),Value::Null)])).at(1000).with_ids(["l".into()]);
    let error = snapback4_core::engine::local::predict(&tx,&b.schema,program,context,snapback4_core::meter::Ceilings {heap_bytes:32_768,..Default::default()}).unwrap_err();
    assert_eq!(error.refusal().code,"E_PREDICT","{error}");
}
