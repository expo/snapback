//! Matching scopes merge into one authorized, ordered page on the shared runner.
use snapback4_core::{Context, Engine, Value};
use snapback4_core::engine::QueryOutcome;
use snapback4_core::value::object;
use std::collections::BTreeMap;

const SCHEMA: &str = include_str!("search_merge/schema.q");
fn id(value: &str) -> Value { Value::Id(value.into()) }
fn text(value: &str) -> Value { Value::String(value.into()) }
fn bound(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn engine(source: &str) -> Engine {
    let bound = bound(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn seed_member(engine: &mut Engine, room: &str, viewer: &str) {
    engine.seed([("members".into(), object([("id", id(&format!("{room}-{viewer}"))), ("roomId", id(room)), ("principal", id(viewer))]))]).unwrap();
}
fn seed_message(engine: &mut Engine, room: &str, name: &str, body: &str, at: i64) {
    engine.seed([("messages".into(), object([("id", id(name)), ("roomId", id(room)), ("body", text(body)), ("at", Value::Int(at))]))]).unwrap();
}
fn fixture(source: &str) -> Engine {
    let mut engine = engine(source);
    for (room, viewer) in [("r1", "dev:alice"), ("r2", "dev:alice"), ("r3", "dev:bob")] { seed_member(&mut engine, room, viewer); }
    for (room, name, body, at) in [("r1", "a", "coffee carol", 10), ("r2", "b", "coffers", 20), ("r1", "c", "cofounder car", 30), ("r2", "d", "coffee coffers car", 30), ("r3", "hidden", "coffee car", 99)] { seed_message(&mut engine, room, name, body, at); }
    engine
}
fn read(engine: &mut Engine, op: &str, q: &str, cursor: Option<String>) -> QueryOutcome {
    let mut args = BTreeMap::from([("q".into(), text(q))]);
    if let Some(cursor) = cursor { args.insert("c".into(), text(&cursor)); }
    engine.query(op, Context::new("dev:alice", args).at(100)).unwrap()
}
fn ids(page: &QueryOutcome) -> Vec<String> { page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect() }

#[test]
fn matching_lanes_authorize_order_deduplicate_and_continue() {
    let mut engine = fixture(SCHEMA);
    for op in ["everywhere", "explicit"] {
        let first = read(&mut engine, op, "cof", None);
        assert_eq!(ids(&first), ["d", "c"]);
        assert!(first.complete);
        // @ref LLP 3000.007#17 — every lane charges its rule's static allowance, admitted or denied: two rooms, or three with r3 named.
        assert_eq!(first.metered.rule_probes, if op == "explicit" { 3 } else { 2 }, "one verdict per lane, not per word");
        let second = read(&mut engine, op, "cof", first.next.clone());
        assert_eq!(ids(&second), ["b", "a"]);
        assert!(second.complete);
        assert_eq!(second.next, None);
        assert_eq!(ids(&read(&mut engine, op, "cof car", None)), ["d", "c"]);
        assert!(ids(&read(&mut engine, op, "", None)).is_empty());
    }
    let mut ascending = fixture(&SCHEMA.replace("last 2 by byRoomWords", "first 2 by byRoomWords"));
    let first = read(&mut ascending, "everywhere", "cof", None);
    assert_eq!(ids(&first), ["a", "b"]);
    assert_eq!(ids(&read(&mut ascending, "everywhere", "cof", first.next)), ["c", "d"]);
}

#[test]
fn further_terms_filter_and_query_expression_is_outside_lane_bindings() {
    let mut engine = fixture(&SCHEMA.replace("matching q", "matching q + ' car'").replace("[m.roomId] for m", "[q.roomId] for q"));
    let first = read(&mut engine, "everywhere", "cof", None);
    assert_eq!(ids(&first), ["d", "c"]);
    assert_eq!(ids(&read(&mut engine, "everywhere", "cof", first.next)), ["a"]);
}

#[test]
fn a_wide_word_lane_is_named_and_incomplete_but_a_denied_lane_cannot_cut() {
    let mut engine = fixture(SCHEMA);
    let before = read(&mut engine, "explicit", "cof", None);
    for n in 0..33 { seed_message(&mut engine, "r3", &format!("hidden{n}"), &format!("cof{n:02}"), 50); }
    let allowed = read(&mut engine, "explicit", "cof", None);
    assert!(allowed.complete, "denied scope must not discover its 33 words");
    assert_eq!((ids(&before), before.complete, before.next.clone(), before.capped_at.clone(), before.metered.clone()), (ids(&allowed), allowed.complete, allowed.next.clone(), allowed.capped_at.clone(), allowed.metered.clone()), "hidden rows in a denied lane change no observable");
    for n in 0..33 { seed_message(&mut engine, "r2", &format!("wide{n}"), &format!("cof{n:02}"), n); }
    let page = read(&mut engine, "everywhere", "cof", None);
    assert!(!page.complete);
    let (_, site) = page.capped_at.as_ref().expect("word cut");
    assert!(site.contains("lane") && site.contains("r2"), "{site}");
    println!("word cut: {:?}", page.capped_at);
}

#[test]
fn nonuniform_matching_lanes_keep_per_row_authority_and_the_note() {
    let source = SCHEMA.replace("  sync to members[.roomId]\n", "").replace("  by byRoomTime: roomId, at, id\n  read <- exists members[.roomId, viewer]", "  by byRoomTime: roomId, at, id\n  read <- exists members[.roomId, viewer] and .body != 'coffers'");
    let compiled = bound(&source);
    assert!(compiled.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"));
    let mut engine = fixture(&source);
    let first = read(&mut engine, "explicit", "cof", None);
    assert_eq!(ids(&first), ["d", "c"]);
    assert!(!first.complete);
    assert_eq!(ids(&read(&mut engine, "explicit", "cof", first.next)), ["a"]);
}

#[test]
fn matching_merge_refusals_name_the_admitted_rewrite_and_51_lanes_get_a_note() {
    for (old, new, message, rewrite) in [
        ("merge messages matching q after c last 2 by byRoomWords", "merge messages after c last 2 by byRoomWords", "merge over a words index without matching", "merge messages matching q after c last 2 by byRoomWords:\n  [roomId]"),
        ("[m.roomId] for m", "[] for m", "matching merge lanes must pin exactly", "merge messages matching q after c last 2 by byRoomWords:\n  [roomId]"),
        ("merge messages matching q after c last 2 by byRoomWords", "merge messages matching q after c last 2 by byRoomTime", "matching on a merge over a plain index", "merge messages last 2 by byRoomTime:\n  [prefix]  -- or merge messages matching q last 2 by <wordsIndex>:\n  [scope]"),
    ] {
        let compiled = snapback4_lang::compile(&[("schema.q".into(), SCHEMA.replace(old, new))]);
        let diagnostic = compiled.diagnostics.first().expect("refused");
        assert!(diagnostic.message.contains(message), "{diagnostic}");
        assert_eq!(diagnostic.rewrite, rewrite);
        assert_eq!(diagnostic.guide, "search");
        println!("{diagnostic}");
    }
    assert!(!bound(SCHEMA).notes.iter().any(|note| note.code == "N_WIDE_MERGE"));
    let wide = bound(&SCHEMA.replace("first 50 by byPrincipalRoom", "first 51 by byPrincipalRoom"));
    let note = wide.notes.iter().find(|note| note.code == "N_WIDE_MERGE").expect("51 lanes");
    assert!(note.message.contains("51 lanes"), "{note}");
    println!("{note}");
    let source = format!("{SCHEMA}\nquery all(q: text <=100, c: cursor ?):\n  return messages matching q after c last 50 by byWords\n");
    let compiled = bound(&source);
    let note = compiled.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").unwrap();
    assert_eq!(note.rewrite, "merge messages matching q last 50 by byRoomWords: [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom — one verdict per scope and a complete page; or read the page on the device");
    assert_eq!(note.guide, "search");
    println!("{note}");
}

#[test]
fn meter_for_two_scopes_times_three_words_times_twenty_rows() {
    let mut engine = engine(&SCHEMA.replace("last 2 by byRoomWords", "last 50 by byRoomWords"));
    for room in ["r1", "r2"] {
        seed_member(&mut engine, room, "dev:alice");
        for (word_n, word) in ["coffee", "coffers", "cofounder"].iter().enumerate() {
            for n in 0..20 {
                seed_message(&mut engine, room, &format!("{room}-{word_n}-{n:02}"), word, (word_n * 20 + n) as i64);
            }
        }
    }
    let page = read(&mut engine, "everywhere", "cof", None);
    assert_eq!(ids(&page).len(), 50);
    assert!(page.complete && page.next.is_some());
    assert_eq!(page.metered.rule_probes, 2);
    println!("2 lanes x 3 words x 20 rows: {}", serde_json::to_string(&page.metered).unwrap());
}

#[test]
fn more_than_eight_word_heads_keep_one_verdict_and_exhaust_without_gaps() {
    let mut engine = engine(SCHEMA);
    for room in ["r1", "r2"] {
        seed_member(&mut engine, room, "dev:alice");
        for n in 0..12 { seed_message(&mut engine, room, &format!("{room}-{n:02}"), &format!("cof{n:02} car"), n); }
    }
    let mut cursor = None;
    let mut all = Vec::new();
    loop {
        let page = read(&mut engine, "everywhere", "cof car", cursor);
        assert!(page.complete);
        assert_eq!(page.metered.rule_probes, 2);
        all.extend(ids(&page));
        cursor = page.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(all.len(), 24);
    assert_eq!(all.iter().collect::<std::collections::BTreeSet<_>>().len(), 24);
    assert_eq!(&all[..2], ["r2-11", "r1-11"]);
}

#[test]
fn empty_scopes_and_named_scopes_use_the_same_matching_form() {
    let mut named = fixture(&SCHEMA.replace("[m.roomId] for m", "[roomId = m.roomId] for m"));
    assert_eq!(ids(&read(&mut named, "everywhere", "cof", None)), ["d", "c"]);
    let source = SCHEMA.replace("  sync to members[.roomId]\n", "").replace("  read <- exists members[.roomId, viewer]", "  read <- allow");
    let source = format!("{source}\nquery unscoped(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 2 by byWords:\n    []\n    []\n");
    let mut unscoped = fixture(&source);
    let first = read(&mut unscoped, "unscoped", "cof", None);
    assert!(first.complete);
    assert_eq!(ids(&first), ["hidden", "d"]);
    assert_eq!(ids(&read(&mut unscoped, "unscoped", "cof", first.next)), ["c", "b"]);
}

#[test]
fn r1a_prefix_denied_nonuniform_scope_never_discovers_hidden_words() {
    let source = SCHEMA.replace("  sync to members[.roomId]\n", "")
        .replace("  read <- exists members[.roomId, viewer]\n  insert <- allow", "  read <- exists members[.roomId, viewer] and .body != 'hidden'\n  insert <- allow")
        .replace("    ['r1']\n    ['r2']\n    ['r3']", "    ['r3']\n    ['r1']\n    ['r2']");
    let source = format!("{source}\nquery scoped(q: text <=100, c: cursor ?):\n  return messages['r3'] matching q after c last 2 by byRoomWords\nquery plain(q: text <=100, c: cursor ?):\n  return messages['r3'] after c last 2 by byRoomTime\n");
    for op in ["explicit", "scoped", "plain"] {
        let mut worlds = Vec::new();
        for population in [0, 33] {
            let mut engine = fixture(&source);
            for n in 0..population { seed_message(&mut engine, "r3", &format!("extra{n}"), &format!("cof{n:02}"), n); }
            let mut page = read(&mut engine, op, "cof", None);
            page.seq = 0; // Same logical world; fixture seeding uses separate commits.
            worlds.push(page);
        }
        assert_eq!(worlds[0], worlds[1], "{op}: a non-member scope contributes nothing");
        assert_eq!(ids(&worlds[0]), if op == "explicit" { vec!["d", "c"] } else { vec![] });
        assert!(!worlds[0].complete, "non-uniform class remains incomplete");
    }
    let mut admitted = fixture(&source);
    seed_member(&mut admitted, "r3", "dev:alice");
    seed_message(&mut admitted, "r3", "filtered", "hidden", 101);
    assert_eq!(ids(&read(&mut admitted, "plain", "cof", None)), ["hidden"]);
}

#[test]
fn r1a_search_where_reads_an_independent_members_page() {
    for words in [1, 12] {
        let source = format!("{SCHEMA}\nquery filtered(q: text <=100, c: cursor ?):\n  return messages['r1'] matching q after c last 50 by byRoomWords where count(members['r1'] first 50 by byRoomPrincipal) > 0\n");
        let mut engine = engine(&source);
        seed_member(&mut engine, "r1", "dev:alice");
        for n in 0..words { seed_message(&mut engine, "r1", &format!("m{n}"), &format!("cof{n:02} car"), n); }
        assert_eq!(ids(&read(&mut engine, "filtered", "cof car", None)).len(), words as usize);
        assert_eq!(ids(&read(&mut engine, "filtered", "cof boat", None)).len(), 0);
    }
}
