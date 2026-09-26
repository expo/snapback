//! Atomic retirement and explicit refusal of history reconstruction.
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use std::{collections::BTreeMap, fs, io::{BufRead, BufReader}, path::PathBuf,
    process::{Command, Stdio}, time::Duration};

fn source() -> String {
    snapback4_lang::guide::quarry(include_str!("../../snapback4-lang/src/guide/feeds.md")).into_iter()
        .find(|source| source.contains("view following:")).expect("published Following example")
}
fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    // Retiring the last materialization exposes the retained public source
    // partition note; this test intentionally preserves those source tables.
    // @ref LLP 3000.019#3.1 — retained-source pages expose their window-order mismatch.
    assert!(b.notes.iter().all(|n| n.code == "N_NO_HORIZON" ||
        (n.code == "N_SYNC_ORDER" && n.message.contains("reads posts") &&
            (n.message.starts_with("query home ") || n.message.starts_with("query cards ")))), "{:?}", b.notes);
    check_source_page_repairs(source, &b);
    b
}
// A planned view is a merge of projected branches. Replacing one branch is
// not an exact replacement of the view, so advice must stay prose-only.
fn check_source_page_repairs(_source: &str, bound: &snapback4_lang::Bound) {
    for note in bound.notes.iter().filter(|n| n.code == "N_SYNC_ORDER") {
        assert!(!note.rewrite.contains('`'), "no incomplete branch rewrite: {note}");
        assert!(!note.rewrite.contains('$'), "no compiler binding: {note}");
        assert!(note.rewrite.contains("newest first") && note.rewrite.contains("index"), "{note}");
        assert!(note.rewrite.contains("merge context"), "{note}");
    }
}
fn engine(source: &str) -> Engine {
    let b = compile(source); Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn adopt(e: &mut Engine, source: &str) {
    let b = compile(source); e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 5000).unwrap();
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn write(e: &mut Engine, who: &str, op: &str, args: &[(&str, Value)], at: i64) {
    let r = e.mutate(op, None, Context::new(who, args.iter().map(|(k,v)| (k.to_string(), v.clone())).collect()).at(at)).unwrap();
    assert!(matches!(r.state, WriteState::Sent { .. }), "{op}: {r:?}");
}
fn post(e: &mut Engine, who: &str, name: &str, parent: Value, at: i64) {
    write(e, who, "post", &[("postId", id(name)), ("parentId", parent)], at);
}
fn follow(e: &mut Engine, reader: &str, actor: &str) { write(e, reader, "follow", &[("actor", id(actor))], 2000); }
fn drain(e: &mut Engine) {
    for _ in 0..20000 {
        if e.run_timeline_chunk_for(6000, Duration::ZERO).unwrap().is_none() {
            assert!(e.timeline_work_counts().unwrap().iter().all(|(_, pending, parked)| *pending == 0 && *parked == 0)); return;
        }
    }
    panic!("delivery did not drain");
}
fn pages(e: &mut Engine, who: &str) -> Vec<Value> {
    let mut rows = vec![]; let mut cursor = Value::Null;
    loop {
        let r = e.query("home", Context::new(who, BTreeMap::from([("c".into(), cursor)]))).unwrap();
        assert!(r.complete, "{r:?}"); rows.extend_from_slice(r.data.as_array().unwrap());
        match r.next { Some(c) => cursor = Value::String(c), None => break }
    }
    rows
}
fn without_view(source: &str) -> String {
    source.replace("view following: activity where .actor = viewer or exists follows[viewer, .actor]\n", "")
        .replace("return following last", "return activity last")
}
struct Dir(PathBuf);
impl Dir {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let p = std::env::temp_dir().join(format!("sb4-timeline-adopt-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        fs::create_dir_all(p.join("snapback")).unwrap(); Self(p)
    }
    fn source(&self, s: &str) { fs::write(self.0.join("snapback/schema.q"), s).unwrap(); }
    fn command(&self, args: &[&str]) -> std::process::Output {
        Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).output().unwrap()
    }
}
impl Drop for Dir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

#[test]
fn dev_removes_populated_view_and_preserves_sources_and_other_views() {
    let s = format!("{}\nview totals: count posts by .authorId\n  online only\nview other: activity where .actor = viewer or exists follows[viewer, .actor]\nview ownedTotals: count followingPosts by .actorId\n  online only\n", source());
    let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
    let path = dir.0.join(".snapback4/store.sqlite"); let b = compile(&s);
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    follow(&mut e, "reader", "author"); post(&mut e, "author", "p", Value::Null, 1); drain(&mut e);
    let kept: BTreeMap<_, _> = e.schema().tables.keys().filter(|t| !t.starts_with("following") && *t != "ownedTotals")
        .map(|t| (t.clone(), e.store().rows(t).unwrap())).collect();
    let mut owned = e.schema().timelines.iter().find(|t| t.name == "following").unwrap().owned.clone();
    owned.insert("ownedTotals".into());
    assert_eq!(e.store().rows("ownedTotals").unwrap()[0].field("value").unwrap(), &Value::Int(1));
    assert!(!e.store().rows("followingFeed").unwrap().is_empty()); drop(e);
    dir.source(&without_view(&s).replace("view ownedTotals: count followingPosts by .actorId\n  online only\n", ""));
    // The real dev startup adopts the edited program without any flag.
    let mut child = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir.0)
        .args(["dev", "--no-watch", "--port", "0"]).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let mut address = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut address).unwrap();
    let _ = child.kill(); let _ = child.wait();
    assert!(address.starts_with("http://"), "{address}");
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    for table in owned {
        assert!(!e.schema().tables.contains_key(&table));
        let n: i64 = e.store().conn().query_row("SELECT count(*) FROM r JOIN _catalog c ON c.num = r.t WHERE c.name = ?1", [&table], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        let n: i64 = e.store().conn().query_row("SELECT count(*) FROM i JOIN _catalog c ON c.num = i.ti WHERE substr(c.name, 1, length(?1) + 1) = ?1 || '.'", [&table], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
    for (table, mut rows) in kept {
        // Retiring one declaration projects out only its engine columns.
        for row in &mut rows { if let Value::Row(fields) | Value::Map(fields) = row { fields.retain(|name,_| !name.starts_with("$timeline:following:")); } }
        assert_eq!(e.store().rows(&table).unwrap(), rows, "{table}");
    }
    assert_eq!(e.timeline_work_counts().unwrap(), [("other".into(), 0, 0)]);
    assert!(e.run_timeline_chunk(6000).unwrap().is_none());
}

#[test]
fn deploy_removal_uses_the_same_destructive_flag_as_maintained_views() {
    for maintained in [false, true] {
        let dir = Dir::new();
        let before = if maintained { format!("{}\nview totals: count posts by .authorId\n  online only\n", without_view(&source())) } else { source() };
        dir.source(&before);
        let r = dir.command(&["deploy", "release"]); assert!(r.status.success(), "{r:?}");
        let path = dir.0.join("release/store.sqlite"); let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
        post(&mut e, "author", "p", Value::Null, 1); drain(&mut e); drop(e);
        let redefined = if maintained { before.replace("count posts by", "count posts where not .removed by") }
            else { before.replace(".parentId = null and not .removed", "not .removed") };
        dir.source(&redefined);
        let r = dir.command(&["deploy", "release"]);
        if maintained { assert!(r.status.success(), "maintained aggregate redefinition: {r:?}"); }
        else {
            assert!(!r.status.success(), "{r:?}");
            assert!(String::from_utf8_lossy(&r.stderr).contains("E_TIMELINE_REDEFINE"), "{r:?}");
            let r = dir.command(&["deploy", "release", "--allow-destructive"]);
            assert!(!r.status.success(), "the destructive flag cannot authorize reconstruction: {r:?}");
            assert!(String::from_utf8_lossy(&r.stderr).contains("E_TIMELINE_REDEFINE"), "{r:?}");
        }
        let mut e = Engine::open(Store::open(&path).unwrap()).unwrap(); drain(&mut e); drop(e);
        dir.source(&without_view(&source()));
        let r = dir.command(&["deploy", "release"]); assert!(!r.status.success(), "{r:?}");
        assert!(String::from_utf8_lossy(&r.stderr).contains("--allow-destructive"), "{r:?}");
        let r = dir.command(&["deploy", "release", "--allow-destructive"]); assert!(r.status.success(), "{r:?}");
        let e = Engine::open(Store::open(&path).unwrap()).unwrap();
        assert_eq!(e.store().rows("posts").unwrap().len(), 1);
        assert!(e.schema().timelines.is_empty()); assert!(e.schema().maintains.is_empty());
    }
}

#[test]
fn a_new_view_preserves_preexisting_application_tables_with_owned_names() {
    let bare = format!("{}\ntable followingFeed:\n  value: int\n  public 'application table'\n  insert <- allow\nmutation seedCollision():\n  insert followingFeed {{ value: 1 }}\n", without_view(&source()));
    let mut e = engine(&bare); write(&mut e, "actor", "seedCollision", &[], 1);
    let before = e.store().rows("followingFeed").unwrap(); let generation = e.generation();
    let b = compile(&source()); let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
    assert_eq!(error.code(), "E_TIMELINE_ACTIVATE");
    assert!(error.to_string().contains("followingFeed")); assert!(error.to_string().contains("rename"));
    assert_eq!(e.generation(), generation); assert_eq!(e.store().rows("followingFeed").unwrap(), before);
}

#[test]
fn retirement_cancels_pending_delivery_and_rolls_back_with_a_failed_adoption() {
    let s = source(); let mut e = engine(&s);
    follow(&mut e, "reader", "author"); post(&mut e, "author", "p", Value::Null, 1);
    assert_eq!(e.timeline_work_counts().unwrap(), [("following".into(), 1, 0)]);
    let saved: BTreeMap<_, _> = e.schema().tables.keys().map(|t| (t.clone(), e.store().rows(t).unwrap())).collect();
    let generation = e.generation();
    let broken = without_view(&s).replace("  parentId: posts ?", "  extra: int\n  parentId: posts ?")
        .replace("authorId: viewer, parentId, at: now", "authorId: viewer, extra: 0, parentId, at: now");
    let b = compile(&broken); let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
    assert_eq!(error.code(), "E_ADOPT"); assert_eq!(e.generation(), generation);
    for (table, rows) in saved { assert_eq!(e.store().rows(&table).unwrap(), rows, "{table}"); }
    adopt(&mut e, &without_view(&s));
    assert!(e.run_timeline_chunk(6000).unwrap().is_none());
    assert_eq!(e.store().rows("posts").unwrap().len(), 1);
    // Retained sources cannot recreate the old event/epoch history.
    let b = compile(&s);
    assert_eq!(e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err().code(), "E_TIMELINE_ACTIVATE");
    assert_eq!(pages(&mut e, "reader").len(), 1, "planned activity still reads the retained source");
}

#[test]
fn redefinition_refuses_atomically_and_delivery_keeps_running() {
    let s = format!("{}\nview totals: count followingPosts by .actorId\n  online only\n", source());
    let mut e = engine(&s);
    follow(&mut e, "reader", "author");
    post(&mut e, "author", "p", Value::Null, 1);
    let before: BTreeMap<_, _> = e.schema().tables.keys().map(|t| (t.clone(), e.store().rows(t).unwrap())).collect();
    let generation = e.generation(); let seq = e.seq().unwrap();
    // Both a broadened predicate and changed source mappings refuse before any
    // copy, admission record or dependent count can be deleted/reconstructed.
    let alternate = source().replace("posts", "entries").replace("follows", "links")
        .replace("activity", "alternateActivity").replace("following", "alternateFollowing")
        .replace("mutation ", "mutation alternate_").replace("query ", "query alternate_");
    for revised in [s.replace(".parentId = null and not .removed", "not .removed"),
        format!("{}\n{alternate}", s.replace("view following: activity where .actor = viewer or exists follows[viewer, .actor]",
            "view following: alternateActivity where .actor = viewer or exists links[viewer, .actor]"))] {
        let b = compile(&revised);
        let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
        assert_eq!(error.code(), "E_TIMELINE_REDEFINE");
        for word in ["following", "event identities", "remove the view and deploy, then add the new definition", "empty", "planned view"] {
            assert!(error.to_string().contains(word), "{error}");
        }
        assert_eq!(e.generation(), generation); assert_eq!(e.seq().unwrap(), seq);
        for (table, rows) in &before { assert_eq!(&e.store().rows(table).unwrap(), rows, "{table}"); }
    }
    // The rejected adoption never installs an exclusive reconstruction task.
    for n in 0..100 {
        post(&mut e, "author", &format!("live-{n}"), Value::Null, n + 2);
        e.run_timeline_chunk_for(5000, Duration::ZERO).unwrap();
    }
    drain(&mut e);
    assert_eq!(pages(&mut e, "reader").len(), 101);
    assert_eq!(e.store().rows("totals").unwrap()[0].field("value").unwrap(), &Value::Int(101));
}

#[test]
fn retirement_resets_dependent_aggregates_even_when_all_names_survive() {
    for keep_aggregate in [true, false] {
        let s = format!("{}\nview totals: count followingPosts by .actorId\n  online only\nview sourceTotals: count posts by .authorId\n  online only\n", source());
        let mut e = engine(&s);
        post(&mut e, "author", "p", Value::Null, 1); drain(&mut e);
        let source_rows = e.store().rows("posts").unwrap();
        let event = e.store().rows("followingPosts").unwrap()[0].clone();
        assert_eq!(e.store().rows("totals").unwrap()[0].field("value").unwrap(), &Value::Int(1));
        // Retain the exact owned table shapes as ordinary tables. This makes
        // schema-diff-only aggregate invalidation insufficient.
        let mut next = e.schema().clone(); next.timelines.clear();
        if !keep_aggregate { next.maintains.retain(|m| m.target != "totals"); }
        let steps = snapback4_core::successor::classify(e.schema(), &next);
        assert!(steps.iter().any(|s| s.path == "timelines.following" && s.change == snapback4_core::successor::Change::Destructive));
        e.adopt(next, e.programs().cloned().collect::<Vec<_>>()).unwrap();
        assert!(e.store().rows("totals").unwrap().is_empty());
        assert!(e.store().rows("followingPosts").unwrap().is_empty());
        assert_eq!(e.store().rows("sourceTotals").unwrap()[0].field("value").unwrap(), &Value::Int(1));
        assert_eq!(e.store().rows("posts").unwrap(), source_rows);
        let count: i64 = e.store().conn().query_row("SELECT count(*) FROM i JOIN _catalog c ON c.num = i.ti WHERE c.name LIKE 'totals.%'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "no stale aggregate index entries");
        if keep_aggregate {
            e.seed([("followingPosts".into(), event)]).unwrap();
            assert_eq!(e.store().rows("totals").unwrap()[0].field("value").unwrap(), &Value::Int(1), "retired contributions must not be counted twice");
        }
    }
}

#[test]
fn failed_retirement_restores_dependent_aggregates_and_indexes() {
    let s = format!("{}\nview totals: count followingPosts by .actorId\n  online only\n", source());
    let mut e = engine(&s); post(&mut e, "author", "p", Value::Null, 1); drain(&mut e);
    let before = e.store().rows("totals").unwrap(); let generation = e.generation();
    let mut next = e.schema().clone(); next.timelines.clear();
    // Candidate rows fail only after retirement has cleared the derived state.
    next.tables.get_mut("posts").unwrap().columns.insert("required".into(), snapback4_core::schema::ColumnType::Int);
    assert!(e.adopt(next, e.programs().cloned().collect::<Vec<_>>()).is_err());
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().rows("totals").unwrap(), before);
    post(&mut e, "author", "p2", Value::Null, 2);
    assert_eq!(e.store().rows("totals").unwrap()[0].field("value").unwrap(), &Value::Int(2));
}

#[test]
fn unfinished_experimental_rebuild_is_fenced_but_can_be_removed() {
    let dir = Dir::new(); let path = dir.0.join("old-builder.sqlite"); let b = compile(&source());
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    post(&mut e, "author", "p", Value::Null, 1);
    let control_id = snapback4_core::schema::timeline::owned_id("following", "Work", &[
        Value::String("rebuild".into()), id("service:$timeline-rebuild"), Value::Null, Value::Null, Value::Null,
    ]);
    let mut row = e.store().rows("followingWork").unwrap()[0].as_object().unwrap().clone();
    row.insert("id".into(), id(&control_id)); row.insert("kind".into(), Value::String("rebuild".into()));
    e.store().conn().execute("INSERT INTO r(t,id,data) VALUES ((SELECT num FROM _catalog WHERE name='followingWork'),?1,?2)",
        [&control_id, &serde_json::to_string(&Value::Row(row.into())).unwrap()]).unwrap();
    drop(e);
    let error = match Engine::open(Store::open(&path).unwrap()) { Ok(_) => panic!("unfinished rebuild opened"), Err(e) => e };
    assert_eq!(error.code(), "E_TIMELINE_REDEFINE");
    assert!(error.to_string().contains("unfinished experimental reconstruction"));
    let b = compile(&source());
    let error = match Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)) {
        Ok(_) => panic!("unchanged adoption resumed unfinished reconstruction"), Err(e) => e,
    };
    assert_eq!(error.code(), "E_TIMELINE_REDEFINE");
    let b = compile(&without_view(&source()));
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert!(e.schema().timelines.is_empty());
    assert_eq!(pages(&mut e, "reader").len(), 1);
    assert!(e.run_timeline_chunk(6000).unwrap().is_none());
}

#[test]
fn two_step_replacement_over_empty_sources_is_supported() {
    let mut e = engine(&source());
    adopt(&mut e, &without_view(&source()));
    adopt(&mut e, &source().replace(".parentId = null and not .removed", "not .removed"));
    follow(&mut e, "reader", "author");
    post(&mut e, "author", "p", Value::Null, 1);
    post(&mut e, "author", "reply", id("p"), 2);
    drain(&mut e);
    assert_eq!(pages(&mut e, "reader").len(), 2);
}
