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
fn atomic_launch_dev_is_automatic_and_deploy_prints_estimate_and_requires_opt_in() {
    let dir = Dir::new();
    dir.source(&without_view(&source()));
    assert!(dir.command(&["deploy", "release"]).status.success());
    let release = dir.0.join("release/store.sqlite");
    let mut e = Engine::open(Store::open(&release).unwrap()).unwrap();
    post(&mut e, "author", "p", Value::Null, 1); follow(&mut e, "reader", "author"); drop(e);
    dir.source(&source());
    let refused = dir.command(&["deploy", "release"]);
    assert!(!refused.status.success());
    let error = String::from_utf8_lossy(&refused.stderr);
    for text in ["E_TIMELINE_ACTIVATE", "--allow-feed-adoption", "2 rows to copy", "estimated writer lock", "planned home query"] {
        assert!(error.contains(text), "{error}");
    }
    let allowed = dir.command(&["deploy", "release", "--allow-feed-adoption"]);
    assert!(allowed.status.success(), "{allowed:?}");
    assert!(String::from_utf8_lossy(&allowed.stderr).contains("2 rows to copy"));
    let mut e = Engine::open(Store::open(&release).unwrap()).unwrap();
    assert_eq!(pages(&mut e,"reader").len(),1); drop(e);

    let dev = Dir::new(); fs::create_dir(dev.0.join(".snapback4")).unwrap();
    let path = dev.0.join(".snapback4/store.sqlite"); let b = compile(&without_view(&source()));
    let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    post(&mut e,"author","p",Value::Null,1); follow(&mut e,"reader","author"); drop(e);
    dev.source(&source());
    let mut child=Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dev.0).args(["dev","--no-watch","--port","0"])
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut address=String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut address).unwrap();
    child.kill().unwrap(); let output=child.wait_with_output().unwrap();
    assert!(address.starts_with("http://"),"{address}: {output:?}");
    assert!(String::from_utf8_lossy(&output.stderr).contains("2 rows to copy"));
    let mut e=Engine::open(Store::open(&path).unwrap()).unwrap(); assert_eq!(pages(&mut e,"reader").len(),1);
}

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
        for word in ["following", "repost identities", "remove the view and deploy", "fresh view name", "planned home query"] {
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
fn two_step_replacement_uses_a_fresh_owned_namespace() {
    let mut e = engine(&source());
    adopt(&mut e, &without_view(&source()));
    adopt(&mut e, &source().replace(".parentId = null and not .removed", "not .removed").replace("following", "replacement"));
    follow(&mut e, "reader", "author");
    post(&mut e, "author", "p", Value::Null, 1);
    post(&mut e, "author", "reply", id("p"), 2);
    drain(&mut e);
    assert_eq!(pages(&mut e, "reader").len(), 2);
}

// The same stored state must give the same Following verdict in check and runtime.
// Source sites and database/WAL byte equality also pin the CLI's read-only contract.
fn preview(dir: &Dir, path: &std::path::Path, s: &str, succeeds: bool, copies: Option<u64>, fragment: &str) {
    dir.source(s);
    let before = fs::read(path).unwrap();
    let wal_path = path.with_extension("sqlite-wal");
    let wal = fs::read(&wal_path).ok();
    for explicit in [false, true] {
        let args = if explicit { vec!["check", "--json", "--store", path.to_str().unwrap()] } else { vec!["check", "--json"] };
        let result = dir.command(&args);
        assert_eq!(result.status.success(), succeeds, "{result:?}");
        let json: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
        let code = if succeeds { "N_TIMELINE_ADOPT" } else { "E_TIMELINE_ACTIVATE" };
        let diagnostics = json[if succeeds { "notes" } else { "problems" }].as_array().unwrap();
        let d = diagnostics.iter().find(|d| d["code"] == code).expect("Following preflight diagnostic");
        assert_eq!(d["guide"], "feeds");
        assert!(d["message"].as_str().unwrap().contains(fragment), "{d}");
        if let Some(copies) = copies {
            for text in [format!("{copies} rows to copy"), "estimated writer lock".into(), "ceiling 5000000 copies".into()] {
                assert!(d["message"].as_str().unwrap().contains(&text), "{d}");
            }
        }
        if succeeds {
            for text in ["all retained own events", "newest 1,000", "no refill", "fresh repost ids", "Writes and syncs wait"] {
                assert!(d["message"].as_str().unwrap().contains(text), "{d}");
            }
            assert!(d["rewrite"].as_str().unwrap().contains("deploy requires --allow-feed-adoption"));
            assert!(json["problems"].as_array().is_none_or(|p| p.is_empty()), "{json}");
        } else {
            assert!(d["rewrite"].as_str().unwrap().contains("query home(c: cursor ?)"));
        }
        let line = d["site"]["line"].as_u64().unwrap() as usize;
        assert!(s.lines().nth(line - 1).unwrap().starts_with("view following:"), "{d}");
        assert_eq!(fs::read(path).unwrap(), before, "check is read-only");
        assert_eq!(fs::read(&wal_path).ok(), wal, "check leaves WAL unchanged");
    }
}

#[test]
fn check_notes_atomic_launch_and_agrees_with_runtime_over_retained_sources() {
    let s = source();
    for case in ["posts", "reposts", "follows", "orphan", "self-follow"] {
        for disk in [false, true] {
            let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
            let path = dir.0.join(".snapback4/store.sqlite");
            let b = compile(&without_view(&s));
            let store = if disk { Store::open(&path).unwrap() } else { Store::memory().unwrap() };
            let mut e = Engine::new(store, b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            if ["posts", "reposts"].contains(&case) { post(&mut e, "author", "p", Value::Null, 1); }
            if ["reposts", "orphan"].contains(&case) {
                e.seed([("reposts".into(), snapback4_core::value::object([
                    ("id", id("r")), ("actorId", id("author")), ("postId", id("p")), ("at", Value::Int(2)),
                ]))]).unwrap();
            }
            if ["follows", "self-follow"].contains(&case) {
                follow(&mut e, "reader", if case == "self-follow" { "reader" } else { "author" });
            }
            let valid = !["orphan", "self-follow"].contains(&case);
            let copies = match case { "posts" => 1, "reposts" => 2, _ => 0 };
            if disk {
                preview(&dir, &path, &s, valid, valid.then_some(copies),
                    if valid { "dev will atomically start this feed now" } else if case == "orphan" { "no original card" } else { "self-follow" });
            }
            let b = compile(&s);
            let preview = e.store_mut().check_timeline_activation(&b.schema);
            let production = e.store_mut().check_timeline_activation_at(&b.schema, 5000, false).unwrap_err();
            if valid { assert!(production.to_string().contains("--allow-feed-adoption")); }
            let generation = e.generation();
            let adoption = e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 5000);
            assert_eq!(preview.is_ok(), valid, "{case}: {preview:?}");
            assert_eq!(adoption.is_ok(), preview.is_ok(), "{case}: {adoption:?}");
            if valid {
                assert_eq!(preview.unwrap()[0].copies, copies);
                assert_eq!(e.store().rows("followingFeed").unwrap().len() as u64, copies);
            } else {
                assert_eq!(preview.unwrap_err().to_string(), adoption.unwrap_err().to_string());
                assert_eq!(e.generation(), generation);
            }
        }
    }
}

#[test]
fn check_and_runtime_refuse_the_copy_ceiling_and_owned_name_reuse() {
    use snapback4_core::value::object;
    for ceiling in [false, true] {
        let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
        let path = dir.0.join(".snapback4/store.sqlite");
        let s = source(); let b = compile(&without_view(&s));
        let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        if ceiling {
            e.seed((0..1001).map(|n| ("posts".into(), object([
                ("id", id(&format!("p{n}"))), ("authorId", id("author")), ("parentId", Value::Null),
                ("at", Value::Int(n)), ("removed", Value::Bool(false)),
            ]))).chain((0..5001).map(|n| ("follows".into(), object([
                ("id", id(&format!("f{n}"))), ("followerId", id(&format!("reader{n}"))), ("followedId", id("author")),
            ]))))).unwrap();
        } else { adopt(&mut e, &s); adopt(&mut e, &without_view(&s)); }
        preview(&dir, &path, &s, false, ceiling.then_some(5_002_001), if ceiling { "--allow-feed-adoption does not override this ceiling" } else { "first-use" });
        let b = compile(&s);
        let preview = e.store_mut().check_timeline_activation(&b.schema).unwrap_err();
        let generation = e.generation();
        let writes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)); let w = writes.clone();
        e.store().conn().update_hook(Some(move |_, _: &str, _: &str, _| { w.fetch_add(1, std::sync::atomic::Ordering::SeqCst); })).unwrap();
        let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
        assert_eq!(preview.to_string(), error.to_string());
        assert_eq!(e.generation(), generation);
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}

#[test]
fn sparse_literal_defaults_agree_in_check_and_atomic_launch() {
    use snapback4_core::value::object;
    // Each case isolates a mapped read: original card, edge estimate/build,
    // original slot, repost slot. The predecessor really predates these fields;
    // no direct SQL manufactures sparse rows after adoption.
    for (case, sparse_table, missing, repost) in [
        ("card", "posts", vec!["authorId"], true),
        ("edge", "follows", vec!["followerId", "followedId"], true),
        ("post slot", "posts", vec!["authorId"], false),
        ("repost slot", "reposts", vec!["actorId", "postId"], true),
    ] {
        let s = source().replace("authorId: principal", "authorId: principal default 'a'")
            .replace("actorId: principal", "actorId: principal default 'b'")
            .replace("postId: posts\n", "postId: posts default 'p'\n")
            .replace("followerId: principal", "followerId: principal default 'reader'")
            .replace("followedId: principal", "followedId: principal default 'a'");
        let s = format!("{s}\nquery inspectSource(key: id):\n  return {sparse_table}[id = key]\n");
        let mut table = "";
        let old = s.split("view activity:").next().unwrap().lines().filter(|line| {
            if let Some(name) = line.strip_prefix("table ").and_then(|s| s.strip_suffix(':')) { table = name; }
            table != sparse_table || !missing.iter().any(|field| line.contains(field))
        }).collect::<Vec<_>>().join("\n");
        let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
        let path = dir.0.join(".snapback4/store.sqlite");
        let b = compile(&old);
        let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, []).unwrap();
        let mut rows = vec![
            ("posts".to_string(), object([("id", id("p")), ("authorId", id("a")), ("parentId", Value::Null), ("at", Value::Int(1)), ("removed", Value::Bool(false))])),
            ("posts".to_string(), object([("id", id("reply")), ("authorId", id("a")), ("parentId", id("p")), ("at", Value::Int(3)), ("removed", Value::Bool(false))])),
            ("follows".to_string(), object([("id", id("f")), ("followerId", id("reader")), ("followedId", id("a"))])),
        ];
        if repost { rows.push(("reposts".into(), object([("id", id("r")), ("actorId", id("b")), ("postId", id("p")), ("at", Value::Int(2))]))); }
        for (name, row) in &mut rows {
            if name == sparse_table { if let Value::Row(fields) | Value::Map(fields) = row { fields.retain(|field, _| !missing.contains(&field.as_str())); } }
        }
        e.seed(rows).unwrap();
        adopt(&mut e, &without_view(&s));
        let retained = e.store().rows(sparse_table).unwrap();
        for row in &retained { for field in &missing { assert!(row.field(field).is_err(), "{case}: default was stored"); } }
        let copies = if repost { 3 } else { 2 };
        preview(&dir, &path, &s, true, Some(copies), "start this feed now");
        let b = compile(&s);
        let estimates = e.store_mut().check_timeline_activation(&b.schema).unwrap();
        assert_eq!(estimates[0].copies, copies, "{case}");
        let result = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program));
        assert!(result.is_ok(), "{case}: check accepted but runtime returned {result:?}");
        assert_eq!(e.store().count("followingFeed").unwrap(), copies);
        assert_eq!(pages(&mut e, "reader").len(), 1);
        assert_eq!(e.store().rows("posts").unwrap()[0].field("$timeline:following:post"), Ok(&Value::Bool(true)));
        if repost {
            let events = e.store().rows("followingPosts").unwrap();
            let event = events.iter().find(|r| r.field("repost") == Ok(&Value::Bool(true))).unwrap();
            assert_eq!(event.field("authorId"), Ok(&id("a")));
            assert_eq!(event.field("actorId"), Ok(&id("b")));
            assert_eq!(e.store().rows("reposts").unwrap()[0].field("$timeline:following:repost"), event.field("id"));
        }
        let reply = e.store().rows("posts").unwrap().into_iter().find(|r| r.field("id") == Ok(&id("reply"))).unwrap();
        assert_eq!(reply.field("$timeline:following:post"), Ok(&Value::Bool(false)));
        let launched = e.store().rows(sparse_table).unwrap();
        assert_eq!(launched.len(), retained.len(), "{case}");
        for (row, original) in launched.iter().zip(&retained) {
            for field in &missing { assert!(row.field(field).is_err(), "{case}: launch stored {field}"); }
            let mut without_slots = row.clone();
            if let Value::Row(fields) | Value::Map(fields) = &mut without_slots { fields.retain(|field, _| !field.starts_with("$timeline:")); }
            assert_eq!(&without_slots, original, "{case}: launch changed source fields");
        }
        // Defaults remain an interpretation after launch, including excluded
        // replies. A later schema reads the new defaults from the same bytes.
        let changed = s.replace("default 'a'", "default 'next-a'")
            .replace("default 'b'", "default 'next-b'")
            .replace("default 'p'", "default 'reply'")
            .replace("default 'reader'", "default 'next-reader'");
        adopt(&mut e, &changed);
        assert_eq!(e.store().rows(sparse_table).unwrap(), launched, "{case}: default edit changed stored images");
        for row in &retained {
            let read = e.query("inspectSource", Context::new("reader", [("key".into(), row.field("id").unwrap().clone())].into())).unwrap();
            assert!(read.complete && !read.unavailable, "{case}: {read:?}");
            for field in &missing {
                let expected = match *field {
                    "authorId" | "followedId" => "next-a",
                    "actorId" => "next-b",
                    "postId" => "reply",
                    "followerId" => "next-reader",
                    _ => unreachable!(),
                };
                assert_eq!(read.data.field(field), Ok(&id(expected)), "{case}: {field}");
            }
        }
    }
}

#[test]
fn following_declared_before_events_passes_check_and_unchanged_adoption() {
    let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
    let path = dir.0.join(".snapback4/store.sqlite");
    let s = source(); dir.source(&s);
    // No store: compile only. Empty existing sources: adoption preflight passes.
    assert!(dir.command(&["check"]).status.success());
    let b = compile(&without_view(&s));
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    assert!(dir.command(&["check"]).status.success());
    adopt(&mut e, &s);
    post(&mut e, "author", "p", Value::Null, 1);
    follow(&mut e, "reader", "author");
    drain(&mut e);
    assert!(dir.command(&["check"]).status.success());
    adopt(&mut e, &s);
    assert_eq!(pages(&mut e, "reader").len(), 1);
}

#[test]
fn check_and_adoption_agree_across_expiry_through_changes_and_following_presence() {
    use snapback4_core::value::object;
    // Astra's repro: inherited expiry remains physically present until a
    // read-through change retires it, before Following checks occupancy.
    let base = source().split("mutation post").next().unwrap().to_owned()
        .replace("  sync public last 1000 by .at", "  online only")
        .replace("  public 'public posts and replies'", "  group: groups\n  immutable group\n  read through .group");
    let base = format!("table groups:\n  deadline: time ?\n  immutable deadline\n  public\n  expire at .deadline\n  online only\n{base}\nmutation addPost(group: groups, expiresAt: time ?):\n  return insert posts {{ group, expiresAt, authorId: viewer, parentId: null, at: now }}\n");
    for expired in [false, true] {
        for changed in [false, true] {
            for existing in [false, true] {
                let case = format!("expired={expired}, through_changed={changed}, following_existing={existing}");
                let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
                let path = dir.0.join(".snapback4/store.sqlite");
                // No read-through change: use an own expiry and remove it in the
                // candidate; ordinary expiry removal must NOT retire raw rows.
                let old = without_view(&base);
                let old = if changed { old } else {
                    old.replace("read through .group", "public 'public posts and replies'\n  expire at .expiresAt")
                };
                let old = old.replace("  group: groups", "  expiresAt: time ?\n  immutable expiresAt\n  group: groups");
                let next = base.replace("read through .group", "public 'public posts and replies'")
                    .replace("  group: groups", "  expiresAt: time ?\n  immutable expiresAt\n  group: groups");
                let candidate = compile(&next);
                let mut b = compile(&old);
                if existing {
                    // Generate a stored predecessor with an existing declaration.
                    // Quarry currently rejects expiring Following sources, but
                    // the stored-schema activation API must still agree with check.
                    b.schema.timelines = candidate.schema.timelines.clone();
                    for name in &b.schema.timelines[0].owned {
                        b.schema.tables.insert(name.clone(), candidate.schema.tables[name].clone());
                    }
                }
                let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
                e.seed_at([("groups".into(), object([("id", id("g")), ("deadline", if expired { Value::Int(2) } else { Value::Null })]))], 1).unwrap();
                write(&mut e, "alice", "addPost", &[("group", id("g")), ("expiresAt", if expired { Value::Int(2) } else { Value::Null })], 1);
                assert_eq!(e.store().rows("posts").unwrap().len(), 1, "unswept: {case}");
                dir.source(&next);
                let b = compile(&next);
                assert!(!e.store_mut().successor(&b.schema).unwrap().iter().any(|s| s.change == snapback4_core::successor::Change::Narrowing), "{case}");
                // Check under a live writer too: the preview takes no writer lock
                // and must leave both the database and existing WAL unchanged.
                let before = fs::read(&path).unwrap();
                let wal_path = path.with_extension("sqlite-wal");
                let wal = fs::read(&wal_path).unwrap();
                let check = dir.command(&["check", "--json"]);
                let json: serde_json::Value = serde_json::from_slice(&check.stdout).unwrap();
                assert_eq!(fs::read(&path).unwrap(), before, "{case}");
                assert_eq!(fs::read(&wal_path).unwrap(), wal, "{case}");
                let preview = e.store_mut().check_timeline_activation_at(&b.schema, 5000, true);
                let adoption = e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 5000);
                let expected = true;
                assert_eq!(adoption.is_ok(), expected, "runtime {case}: {adoption:?}");
                assert_eq!(preview.is_ok(), adoption.is_ok(), "API divergence {case}: {preview:?}, {adoption:?}");
                assert_eq!(check.status.success(), adoption.is_ok(), "CLI divergence {case}: {json}, {adoption:?}");
                if !existing {
                    let copies = u64::from(!(expired && changed));
                    assert_eq!(preview.unwrap()[0].copies, copies, "{case}");
                    assert_eq!(e.store().rows("followingFeed").unwrap().len() as u64, copies, "{case}");
                    assert_eq!(json["notes"].as_array().unwrap().iter().any(|d| d["code"] == "N_TIMELINE_ADOPT"), copies != 0, "{case}: {json}");
                }
                assert_eq!(e.store().rows("posts").unwrap().len(), usize::from(!(expired && changed)), "{case}");
            }
        }
    }
}
