//! Following retirement and durable reconstruction use retained source rows.
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use std::{collections::BTreeMap, fs, io::{BufRead, BufReader}, path::PathBuf,
    process::{Command, Stdio}, time::Duration};

fn source() -> String {
    include_str!("../../snapback4-lang/src/guide/feeds.md").split_once("```quarry\n").unwrap().1.split_once("```").unwrap().0.into()
}
fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    // Retiring the last materialization exposes the retained public source
    // partition note; this test intentionally preserves those source tables.
    assert!(b.notes.iter().all(|n| n.code == "N_NO_HORIZON"), "{:?}", b.notes); b
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
    panic!("rebuild did not drain");
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
    let s = format!("{}\nview totals: count posts by .authorId\n  online only\nview other: activity where .actor = viewer or exists follows[viewer, .actor]\n", source());
    let dir = Dir::new(); fs::create_dir(dir.0.join(".snapback4")).unwrap();
    let path = dir.0.join(".snapback4/store.sqlite"); let b = compile(&s);
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    follow(&mut e, "reader", "author"); post(&mut e, "author", "p", Value::Null, 1); drain(&mut e);
    let kept: BTreeMap<_, _> = e.schema().tables.keys().filter(|t| !t.starts_with("following"))
        .map(|t| (t.clone(), e.store().rows(t).unwrap())).collect();
    let owned = e.schema().timelines.iter().find(|t| t.name == "following").unwrap().owned.clone();
    assert!(!e.store().rows("followingFeed").unwrap().is_empty()); drop(e);
    dir.source(&without_view(&s));
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
    for (table, rows) in kept { assert_eq!(e.store().rows(&table).unwrap(), rows, "{table}"); }
    assert_eq!(e.timeline_work_counts().unwrap(), [("other".into(), 0, 0)]);
    assert!(e.run_timeline_chunk(6000).unwrap().is_none());
}

#[test]
fn predicate_rebuild_resumes_after_reopen_and_matches_fresh_history_window() {
    let original = source(); let revised = original.replace(".parentId = null and not .removed", "not .removed");
    let dir = Dir::new(); let path = dir.0.join("store.sqlite"); let b = compile(&original);
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut fresh = engine(&revised);
    for e in [&mut e, &mut fresh] {
        for n in 0..520 {
            post(e, "author", &format!("p{n:04}"), Value::Null, n * 2);
            post(e, "author", &format!("r{n:04}"), id("p0000"), n * 2 + 1);
        }
        for reader in ["reader1", "reader2", "reader3"] { follow(e, reader, "author"); }
        drain(e);
    }
    let sources = e.store().rows("posts").unwrap();
    adopt(&mut e, &revised);
    assert!(e.store().rows("followingFeed").unwrap().is_empty());
    for _ in 0..9 {
        let m = e.run_timeline_chunk_for(6000, Duration::ZERO).unwrap().unwrap();
        assert!(m.rows_written <= 5, "a zero-time rebuild commits at most one source row: {m:?}");
    }
    drop(e); let mut e = Engine::open(Store::open(&path).unwrap()).unwrap(); drain(&mut e);
    for reader in ["author", "reader1", "reader2", "reader3", "outsider"] {
        let page = pages(&mut e, reader); assert_eq!(page, pages(&mut fresh, reader), "{reader}");
        if reader.starts_with("reader") { assert_eq!(page.len(), 1000); }
    }
    assert_eq!(e.store().rows("posts").unwrap(), sources);
    let before = e.store().rows("followingFeed").unwrap(); adopt(&mut e, &revised);
    assert_eq!(e.store().rows("followingFeed").unwrap(), before, "unchanged adoption never restarts a rebuild");
}

#[test]
fn concurrent_writes_keep_one_producer_and_reposts_survive_original_removal() {
    let old = source(); let new = old.replace(".parentId = null and not .removed", "not .removed");
    let mut e = engine(&old);
    for n in 0..1005 { post(&mut e, "author", &format!("p{n:04}"), Value::Null, n); }
    for reader in ["reader", "leaver", "refollower"] { follow(&mut e, reader, "author"); }
    write(&mut e, "booster", "repost", &[("postId", id("p1004"))], 1100);
    write(&mut e, "author", "remove", &[("postId", id("p1004"))], 1101); drain(&mut e);
    adopt(&mut e, &new);
    // Writes before the graph or original-event scan reaches their rows.
    write(&mut e, "leaver", "unfollow", &[("actor", id("author"))], 6000);
    write(&mut e, "refollower", "unfollow", &[("actor", id("author"))], 6000);
    follow(&mut e, "refollower", "author");
    post(&mut e, "author", "backdated-live", Value::Null, -100);
    write(&mut e, "booster2", "repost", &[("postId", id("p1003"))], 6001);
    follow(&mut e, "new-reader", "author");
    write(&mut e, "author", "remove", &[("postId", id("p1002"))], 6002);
    follow(&mut e, "repost-reader", "booster");
    drain(&mut e);
    let reader = pages(&mut e, "reader");
    assert_eq!(reader.len(), 1001, "1000 retained events plus the live event, even with an old timestamp");
    assert_eq!(reader.iter().filter(|r| r.field("id").unwrap() == &id("backdated-live")).count(), 1);
    assert!(!reader.iter().any(|r| [id("p1002"), id("p1004")].contains(r.field("id").unwrap())));
    assert!(pages(&mut e, "leaver").is_empty());
    assert_eq!(pages(&mut e, "refollower").len(), 1001);
    assert_eq!(pages(&mut e, "new-reader").len(), 1000, "a later follow applies its own history boundary");
    let repost = pages(&mut e, "repost-reader"); assert_eq!(repost.len(), 1);
    assert_eq!(repost[0].field("post").unwrap(), &id("p1004"));
    assert_eq!(pages(&mut e, "booster2").len(), 1);
    let copies = e.store().rows("followingFeed").unwrap();
    let identities: std::collections::BTreeSet<_> = copies.iter().map(|r|
        format!("{:?}", (r.field("readerId").unwrap(), r.field("eventId").unwrap(), r.field("epoch").unwrap()))).collect();
    assert_eq!(identities.len(), copies.len());
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
        let r = dir.command(&["deploy", "release"]); assert!(r.status.success(), "redefinition needs no destructive flag: {r:?}");
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
fn changing_all_sources_rebuilds_only_the_redefined_view() {
    let alternate = source().replace("posts", "entries").replace("follows", "links")
        .replace("activity", "alternateActivity").replace("following", "alternateFollowing")
        .replace("mutation ", "mutation alternate_").replace("query home", "query alternateHome");
    let old = format!("{}\n{alternate}", source());
    let mut e = engine(&old);
    follow(&mut e, "reader", "author"); post(&mut e, "author", "old", Value::Null, 1);
    write(&mut e, "reader", "alternate_follow", &[("actor", id("other"))], 2);
    write(&mut e, "other", "alternate_post", &[("postId", id("new")), ("parentId", Value::Null)], 3);
    drain(&mut e);
    let other = e.store().rows("alternateFollowingFeed").unwrap();
    let new = old.replace("view following: activity where .actor = viewer or exists follows[viewer, .actor]",
        "view following: alternateActivity where .actor = viewer or exists links[viewer, .actor]");
    adopt(&mut e, &new); drain(&mut e);
    let rows = pages(&mut e, "reader"); assert_eq!(rows.len(), 1); assert_eq!(rows[0].field("id").unwrap(), &id("new"));
    assert_eq!(e.store().rows("posts").unwrap().len(), 1);
    assert_eq!(e.store().rows("entries").unwrap().len(), 1);
    assert_eq!(e.store().rows("alternateFollowingFeed").unwrap(), other);
}

#[test]
fn missing_original_parks_only_its_rebuild_with_an_actionable_diagnosis() {
    let bare = without_view(&source()); let mut e = engine(&bare);
    // Without a timeline, a typed reference does not prove current existence.
    write(&mut e, "actor", "repost", &[("postId", id("missing-original"))], 1);
    adopt(&mut e, &source());
    while e.run_timeline_chunk_for(6000, Duration::ZERO).unwrap().is_some() {}
    assert_eq!(e.timeline_work_counts().unwrap(), [("following".into(), 0, 1)]);
    let work = e.store().rows("followingWork").unwrap();
    let message = work[0].field("error").unwrap().as_str().unwrap();
    for word in ["E_TIMELINE_REDEFINE", "following", "reposts", "missing-original", "original author", "delete", "rename"] {
        assert!(message.contains(word), "{message}");
    }
    assert!(e.store().rows("followingFeed").unwrap().is_empty());
    assert_eq!(e.store().rows("reposts").unwrap().len(), 1, "the refusal never deletes a source");
    // Its control seat cannot be acquired through either minting path.
    assert!(snapback4_core::identity::validate_custom_session("service:$timeline-rebuild", "custom").is_err());
    assert!(snapback4_core::identity::service_session(e.store(), "$timeline-rebuild", 1, 1).is_err());
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
    // Reintroducing the name starts a new source rebuild, with no retired task.
    adopt(&mut e, &s); drain(&mut e);
    assert_eq!(pages(&mut e, "reader").len(), 1);
}
