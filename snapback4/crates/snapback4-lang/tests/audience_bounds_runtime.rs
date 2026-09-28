//! The exact M8 helper/job plus a separately named, explicitly paged preview.
use snapback4_core::{Context, Engine, JobState, Store, Value, wire};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

const BUILDER: &str = include_str!("../../../experiments/p19-one-query/builder.q");
const PAGED: &str = "\nquery digestChatPreview(periodStart: time, periodEnd: time, c: cursor ?):\n  return members[principal = viewer] first 50 by .conversation after c { conversation, unread: unreadDuring(.conversation, viewer, .seenOrdinal, periodStart, periodEnd) }\n";

fn engine(store: Store) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{BUILDER}{PAGED}"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn args(start: i64, end: i64) -> BTreeMap<String, Value> {
    [("periodStart".into(), Value::Int(start)), ("periodEnd".into(), Value::Int(end))].into()
}
fn number(row: &Value, field: &str) -> i64 { let Value::Int(n) = row.field(field).unwrap() else { panic!("{row:?}") }; *n }
fn identity(row: &Value, field: &str) -> String { let Value::Id(s) = row.field(field).unwrap() else { panic!("{row:?}") }; s.clone() }
fn truth(row: &Value, field: &str) -> bool { row.field(field).unwrap() == &Value::Bool(true) }
fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows: Vec<_> = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect();
    engine.load(rows).unwrap();
}

fn seed(chats: usize, messages: usize) -> Engine {
    let mut e = engine(Store::memory().unwrap());
    let mut rows = vec![("profiles", json!({"id":"profile", "principal":"reader", "displayName":"Reader", "handle":"reader", "bio":"", "location":""}))];
    for n in 0..chats {
        let chat = format!("chat{n:03}");
        rows.push(("conversations", json!({"id":chat, "kind":"group", "title":"Chat", "description":"", "creator":"reader"})));
        rows.push(("members", json!({"id":format!("member{n:03}"), "conversation":chat, "principal":"reader", "role":"admin", "joinedOrdinal":0})));
        for m in 0..messages {
            rows.push(("messages", json!({"id":format!("m{n:03}-{m:05}"), "conversation":chat, "sender":"sender", "ordinal":m+1, "recipients":1, "text":"hello", "at":10, "expiresAt":null})));
        }
    }
    load(&mut e, rows);
    e
}

// Independent row enumeration: never calls the helper or the maintained totals.
fn oracle(e: &Engine, start: i64, end: i64) -> BTreeMap<String, [i64; 4]> {
    let rows = |table| e.store().rows(table).unwrap();
    let mut posts = BTreeMap::<String, i64>::new();
    for p in rows("posts") {
        if p.field("parent").unwrap() == &Value::Null && !truth(&p, "removed") && number(&p, "at").div_euclid(120_000) == start.div_euclid(120_000) {
            *posts.entry(identity(&p, "author")).or_default() += 1;
        }
    }
    let mut totals: BTreeMap<_, _> = rows("profiles").iter().map(|p| {
        let id = identity(p, "principal"); let own = posts.get(&id).copied().unwrap_or(0); (id, [0, own, 0, 0])
    }).collect();
    for f in rows("follows") {
        if let Some(total) = totals.get_mut(&identity(&f, "followed"))
            && number(&f, "at").div_euclid(120_000) == start.div_euclid(120_000) { total[0] += 1; }
        if let Some(total) = totals.get_mut(&identity(&f, "follower")) { total[1] += posts.get(&identity(&f, "followed")).copied().unwrap_or(0); }
    }
    let mut messages = BTreeMap::<String, Vec<Value>>::new();
    for m in rows("messages") {
        if !truth(&m, "tombstone") && number(&m, "at") >= start && number(&m, "at") < end
            && !matches!(m.field("expiresAt").unwrap(), Value::Int(t) if *t <= end) {
            messages.entry(identity(&m, "conversation")).or_default().push(m);
        }
    }
    for member in rows("members") {
        let reader = identity(&member, "principal");
        let count = messages.get(&identity(&member, "conversation")).into_iter().flatten()
            .filter(|m| identity(m, "sender") != reader && number(m, "ordinal") > number(&member, "seenOrdinal")).count() as i64;
        if let Some(total) = totals.get_mut(&reader) { total[2] += count; total[3] += i64::from(count > 0); }
    }
    totals
}

fn witness(e: &mut Engine, viewer: &str, start: i64, end: i64) {
    let expected = oracle(e, start, end);
    let membership_count = e.store().rows("members").unwrap().iter().filter(|r| identity(r, "principal") == viewer).count();
    assert_eq!(membership_count, 100);
    let mut c = Value::Null;
    let (mut chats, mut unread, mut pages) = (std::collections::BTreeSet::new(), 0, 0);
    loop {
        let mut input = args(start, end); input.insert("c".into(), c);
        let read = e.query("digestChatPreview", Context::new(viewer, input).at(end)).unwrap();
        assert!(read.cut.is_none(), "{read:?}");
        let rows = read.data.as_array().unwrap();
        if pages == 0 { assert_eq!(rows.len(), 50); assert!(read.next.is_some()); }
        for row in rows { assert!(chats.insert(identity(row, "conversation"))); unread += number(row, "unread"); }
        pages += 1;
        let Some(next) = read.next else { break; }; c = Value::String(next);
        assert!(pages < 5);
    }
    assert_eq!(chats.len(), membership_count);
    assert_eq!(unread, expected[viewer][2]);
    let run = e.run_job("digest", args(start, end), end).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    let effects = e.effects(None, 10_000).unwrap();
    let actual: BTreeMap<_, _> = effects.iter().filter(|effect| effect.payload.field("kind").ok() == Some(&Value::String("digest".into()))
        && effect.payload.field("periodEnd").ok() == Some(&Value::Int(end))).map(|effect| {
        let p = &effect.payload;
        (identity(p, "targetUserId"), [number(p, "newFollowers"), number(p, "newPostsInFollowing"), number(p, "unreadMessages"), number(p, "unreadChats")])
    }).collect();
    let expected: BTreeMap<_, _> = expected.into_iter().filter(|(_, n)| n[0] > 0 || n[1] > 0 || n[2] > 0).collect();
    assert_eq!(actual, expected);
    println!("M8: memberships={membership_count} preview_pages={pages} unread={unread} full_recipients={} job={run:?}", actual.len());
    let outsider = e.query("digestChatPreview", Context::new("outsider", args(start, end)).at(end)).unwrap();
    assert!(outsider.data.as_array().unwrap().is_empty(), "a helper cannot grant membership");
}

#[test]
fn unchanged_builder_job_is_complete_and_preview_requires_all_chat_pages() {
    let mut e = seed(100, 1);
    let first = e.query("digestChatPreview", Context::new("reader", args(0, 100)).at(100)).unwrap();
    assert_eq!(first.data.as_array().unwrap().iter().map(|r| number(r, "unread")).sum::<i64>(), 50);
    witness(&mut e, "reader", 0, 100);
}

#[test]
fn oversized_recipient_parks_without_a_partial_digest_or_emission_key() {
    let mut e = seed(1, 16_400);
    let run = e.run_job("digest", args(0, 100), 100).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert_eq!(run.chunk_size, 1);
    assert!(run.error.as_ref().unwrap().starts_with("E_BOUND:"), "{run:?}");
    assert!(e.effects(None, 10).unwrap().is_empty());
    let exists: i64 = e.store().conn().query_row("SELECT count(*) FROM sqlite_master WHERE name='_effect_keys'", [], |r| r.get(0)).unwrap();
    let keys: i64 = if exists == 0 { 0 } else { e.store().conn().query_row("SELECT count(*) FROM _effect_keys", [], |r| r.get(0)).unwrap() };
    assert_eq!(keys, 0);
    println!("M8 oversized recipient: {run:?}; effects=0; keys=0");
}

#[test]
#[ignore = "full calibration store: DG_STORE must name a worktree-owned writable copy"]
fn copied_calibration_store_job_and_preview_match_independent_oracle() {
    let path = std::path::PathBuf::from(std::env::var("DG_STORE").expect("DG_STORE copy required")).canonicalize().unwrap();
    let worktree = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../reports/20260928-dg/.work").canonicalize().unwrap();
    assert!(path.starts_with(worktree), "only this worktree's copied evidence may be opened");
    let mut e = engine(Store::open(&path).unwrap());
    // The supplied development store suppresses effects. This isolated engine
    // has no worker or network; retain payloads here to verify complete totals.
    e.store().conn().execute("UPDATE _meta SET value='false' WHERE key='dev:replay'", []).unwrap();
    let profile = e.store().rows("profiles").unwrap().into_iter().find(|p| p.field("handle").unwrap() == &Value::String("u0500".into())).unwrap();
    let start = 14_921_360 * 120_000;
    witness(&mut e, &identity(&profile, "principal"), start, start + 119_998);
}
