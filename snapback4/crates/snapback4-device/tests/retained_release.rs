//! Fault trace: late pages across retained rollback/forward, on both stores.
mod common;
use common::*;
use snapback4_core::engine::release::ReleaseActivation;
use snapback4_core::{Engine, Store, Value, WriteState, wire};
use snapback4_device::device::Backend;

const OLD: &str = "table items:\n  owner: principal\n  n: int\n  status: enum('active') default 'active'\n  read <- allow\n  insert <- allow\n  sync public\nquery all():\n  return items[] first 20 by byId\nmutation add():\n  return insert items {owner: viewer, n: 3}\n";
fn newer() -> String {
    OLD.replace("  n: int", "  extra: int default 7\n  n: int")
        .replace("enum('active')", "enum('active','new')")
        + "table secrets:\n  owner: principal\n  n: int\n  read <- .owner = viewer\n  sync to .owner\nquery mine():\n  return secrets where .owner = viewer first 10 by .id\n"
}
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn backend(e: &Engine, b: &snapback4_lang::Bound) -> Backend {
    Backend {
        generation: e.generation(),
        schema: b.schema.clone(),
        programs: b.programs.iter().map(|p| p.program.clone()).collect(),
    }
}
fn seed(e: &mut Engine, name: &str, json: serde_json::Value) {
    let row = wire::row_from_json(&e.schema().tables[name], &json).unwrap();
    e.seed([(name.into(), row)]).unwrap();
}

fn trace<H: Host>(host: &mut H, viewer: &str, reopen: bool) {
    let next = bound(&newer());
    let old = bound(OLD);
    let mut engine = Engine::new_release(
        Store::memory().unwrap(),
        next.schema.clone(),
        next.programs.iter().map(|p| p.program.clone()),
        2,
        None,
    )
    .unwrap();
    seed(
        &mut engine,
        "items",
        serde_json::json!({"id":"a","owner":"alice","n":1,"status":"new","extra":42}),
    );
    seed(
        &mut engine,
        "items",
        serde_json::json!({"id":"b","owner":"bob","n":2,"status":"active","extra":99}),
    );
    seed(
        &mut engine,
        "secrets",
        serde_json::json!({"id":"private","owner":"alice","n":55}),
    );
    let first = backend(&engine, &next);
    let first_pages = snapshot_pages(&mut engine, viewer, 1);
    let mut device = host.open("retained-release", Some(first.clone())).unwrap();
    for (i, page) in first_pages.iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    assert_eq!(
        device
            .query("all", viewer, &serde_json::json!({}), 1000)
            .unwrap()
            .data
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let options = ReleaseActivation::new(1, Some(2));
    engine
        .adopt_release(
            old.schema.clone(),
            old.programs.iter().map(|p| p.program.clone()),
            &options,
            false,
        )
        .unwrap();
    let second = backend(&engine, &old);
    assert!(second.generation > first.generation);
    device.adopt(second.clone()).unwrap();
    let second_pages = snapshot_pages(&mut engine, viewer, 1);
    for (i, page) in second_pages.iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    let before = device
        .query("all", viewer, &serde_json::json!({}), 1000)
        .unwrap();
    assert!(
        before
            .data
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r.field("extra").is_err())
    );
    assert_eq!(before.data.as_array().unwrap().len(),1,"new enum row must leave both device stores on rollback");
    assert!(before.data.as_array().unwrap().iter().all(|row|row.field("id").unwrap()!=&id("a")));
    for page in first_pages.iter().rev() {
        assert_eq!(
            device.apply(page, false).unwrap_err().code(),
            "E_GENERATION"
        );
    }
    assert_eq!(
        device
            .query("all", viewer, &serde_json::json!({}), 1000)
            .unwrap()
            .data,
        before.data,
        "a reordered old page changed the older shape"
    );
    let write = engine
        .mutate(
            "add",
            Some("older-write"),
            context(viewer, &[]).at(1000).with_ids(["new".into()]),
        )
        .unwrap();
    assert!(matches!(write.state, WriteState::Sent { .. }));
    let options = ReleaseActivation::new(2, Some(1));
    engine
        .adopt_release(
            next.schema.clone(),
            next.programs.iter().map(|p| p.program.clone()),
            &options,
            false,
        )
        .unwrap();
    let third = backend(&engine, &next);
    assert!(third.generation > second.generation);
    device.adopt(third).unwrap();
    let third_pages = snapshot_pages(&mut engine, viewer, 1);
    for (i, page) in third_pages.iter().enumerate() {
        device.apply(page, i == 0).unwrap();
    }
    for page in second_pages.iter().rev() {
        assert_eq!(
            device.apply(page, false).unwrap_err().code(),
            "E_GENERATION"
        );
    }
    let read = device
        .query("all", viewer, &serde_json::json!({}), 1000)
        .unwrap();
    assert_eq!(
        read.data
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r.field("id").unwrap() == &id("a"))
            .unwrap()
            .field("extra")
            .unwrap(),
        &Value::Int(42)
    );
    assert_eq!(
        read.data
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r.field("id").unwrap() == &id("new"))
            .unwrap()
            .field("extra")
            .unwrap(),
        &Value::Int(7)
    );
    let mine = device
        .query("mine", viewer, &serde_json::json!({}), 1000)
        .unwrap();
    assert_eq!(
        mine.data.as_array().unwrap().len(),
        usize::from(viewer == "alice")
    );
    if reopen {
        host.close("retained-release", device);
        device = host.open("retained-release", None).unwrap();
        assert_eq!(
            device
                .query("all", viewer, &serde_json::json!({}), 1000)
                .unwrap()
                .data,
            read.data
        );
    }
    host.close("retained-release", device);
}

#[test]
fn retained_releases_never_mix_shapes_on_late_reordered_pages_and_reopen() {
    for viewer in ["alice", "bob"] {
        for reopen in [false, true] {
            trace(&mut Memory::new(), viewer, reopen);
            let mut sqlite = Sqlite::new("retained-release");
            trace(&mut sqlite, viewer, reopen);
            let store = Store::open_read_only(&sqlite.path("retained-release")).unwrap();
            assert_eq!(
                store.meta("version").unwrap().as_deref(),
                Some("snapback4-store-1")
            );
            let dormant: i64 = store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_schema WHERE name LIKE '_dormant_%'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(dormant, 0);
        }
    }
}

const UNION_PAGES: &str = "table members:
  board: int
  principal: principal
  unique board, principal
  immutable board, principal
  read <- .principal = viewer
  delete <- .principal = viewer
  sync
table cards:
  owner: principal
  board: int
  at: int
  read <- .owner = viewer or exists members[.board, viewer]
  insert <- .owner = viewer
  sync
query pages(a: int, b: int, c: cursor ?):
  return cards where .board = a or .board = b first 1 by .at after c
mutation leave():
  m = members[1, viewer] ! else NOT_MEMBER
  delete members[m]
  return null
";

fn audience_release<H: Host>(host: &mut H, limit: usize) {
    let union = bound(UNION_PAGES);
    let old = bound(&UNION_PAGES.replace(
        "  read <- .owner = viewer or exists members[.board, viewer]",
        "  read <- .owner = viewer",
    ));
    let mut engine = Engine::new_release(Store::memory().unwrap(), old.schema.clone(),
        old.programs.iter().map(|p| p.program.clone()), 1, None).unwrap();
    seed(&mut engine, "members", serde_json::json!({"id":"m","board":1,"principal":"alice"}));
    for (id, owner, board, at) in [("own", "alice", 2, 1), ("team", "bob", 1, 2), ("hidden", "bob", 2, 3)] {
        seed(&mut engine, "cards", serde_json::json!({"id":id,"owner":owner,"board":board,"at":at}));
    }
    let mut device = host.open("release-audiences", Some(backend(&engine, &old))).unwrap();
    let mut stale = Vec::new();
    for (release, current, expected) in [(1, &old, vec!["own"]), (2, &union, vec!["own","team"]), (1, &old, vec!["own"]), (2, &union, vec!["own"])] {
        if !stale.is_empty() {
            engine.adopt_release(current.schema.clone(), current.programs.iter().map(|p| p.program.clone()),
                &ReleaseActivation::new(release, engine.store().meta("release").unwrap().and_then(|r|r.parse().ok())), false).unwrap();
            device.adopt(backend(&engine, current)).unwrap();
            for page in stale.iter().rev() { assert_eq!(device.apply(page, false).unwrap_err().code(), "E_GENERATION"); }
        }
        let pages = snapshot_pages(&mut engine, "alice", limit);
        for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let mut cursor = serde_json::Value::Null;
        let mut ids = Vec::new();
        loop {
            let (answer, unknown, _) = device.query_with_coverage("pages", "alice", &serde_json::json!({"a":1,"b":2,"c":cursor}), 1000);
            let answer = answer.unwrap();
            assert!(!unknown && answer.complete, "{}: {answer:?}", host.label());
            ids.extend(answer.data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().to_owned()));
            match answer.next { Some(c) => cursor = serde_json::Value::String(c), None => break }
        }
        assert_eq!(ids, expected, "{} release {release}", host.label());
        if release == 1 && stale.len() > 0 {
            let write = engine.mutate("leave", Some("leave-while-owner-only"), context("alice", &[]).at(1000)).unwrap();
            assert!(matches!(write.state, WriteState::Sent { .. }));
        }
        stale = pages;
    }
    host.close("release-audiences", device);
}

#[test]
fn release_changes_reacquire_union_arms_and_merged_pages_without_old_membership() {
    for limit in [1, 1000] {
        audience_release(&mut Memory::new(), limit);
        audience_release(&mut Sqlite::new("release-audiences"), limit);
    }
}

fn restored_literal_column<H:Host>(host:&mut H) {
    let wide=bound("table rows:\n  status: enum('live','new') default 'live'\n  public\n  sync public\nquery all():\n  return rows[] first 20 by byId\n");
    let retired=bound("table rows:\n  public\n  sync public\nquery all():\n  return rows[] first 20 by byId\n");
    let narrow=bound("table rows:\n  status: enum('live') default 'live'\n  public\n  sync public\nquery all():\n  return rows[] first 20 by byId\n");
    let mut e=Engine::new_release(Store::memory().unwrap(),wide.schema.clone(),wide.programs.iter().map(|p|p.program.clone()),1,None).unwrap();
    seed(&mut e,"rows",serde_json::json!({"id":"r","status":"new"}));
    e.adopt_release(retired.schema.clone(),retired.programs.iter().map(|p|p.program.clone()),&ReleaseActivation::new(2,Some(1)),false).unwrap();
    let mut device=host.open("literal-retention",Some(backend(&e,&retired))).unwrap();
    for (i,page) in snapshot_pages(&mut e,"alice",10).iter().enumerate(){device.apply(page,i==0).unwrap();}
    assert_eq!(device.query("all","alice",&serde_json::json!({}),1000).unwrap().data.as_array().unwrap().len(),1);
    assert!(snapback4_core::successor::keeps_literal_default_images(&retired.schema,&narrow.schema),"fixture must exercise the formerly retained-image shape");
    e.adopt_release(narrow.schema.clone(),narrow.programs.iter().map(|p|p.program.clone()),&ReleaseActivation::new(3,Some(2)),false).unwrap();
    device.adopt(backend(&e,&narrow)).unwrap();
    assert_eq!(device.query("all","alice",&serde_json::json!({}),1000).unwrap_err().code,"E_PREDICT","a new generation cannot certify a now-dormant row through its literal default");
    for (i,page) in snapshot_pages(&mut e,"alice",10).iter().enumerate(){device.apply(page,i==0).unwrap();}
    assert!(device.query("all","alice",&serde_json::json!({}),1000).unwrap().data.as_array().unwrap().is_empty());
    host.close("literal-retention",device);
}
#[test]
fn literal_column_restoration_cannot_keep_dormant_images_on_either_store(){restored_literal_column(&mut Memory::new());restored_literal_column(&mut Sqlite::new("literal-retention"));}
