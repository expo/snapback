// The same compiled Quarry and acceptance assertions on the server and both device stores.
use super::{DEVICE, Query, with_fixture};
use snapback4_core::{Context, Value, engine::{QueryOutcome, ReadCut}, value::object};
use snapback4_core::cursor::{CursorColumn, CursorPosition, decode_cursor, encode_cursor};
use snapback4_core::{ir::Order, schema::{ColumnType, Schema}};
use std::cell::RefCell;

fn ctx(cursor: Option<String>) -> Context {
    Context::new("dev:alice", [("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))].into()).at(100_000)
}

fn ids(page: &QueryOutcome) -> Vec<String> {
    page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

fn observe(label: &str, page: &QueryOutcome) {
    println!("{label}: complete={} cut={} next={} rows={} examined={} index_entries={}", page.complete,
        serde_json::to_string(&page.cut).unwrap(), if page.next.is_some() { "PRESENT" } else { "null" },
        page.data.as_array().map_or(0, |r| r.len()), page.metered.examined, page.metered.index_entries);
}

fn grouped() -> (String, Vec<(String, Value)>) {
    let source = include_str!("../../../../../benchmarks/runs/2026-09-17-snapback4-bounds-probes/grouped-defect/snapback/schema.q")
        .replace("  online only", "  sync");
    let mut rows = Vec::new();
    for g in 0..10 {
        let room = format!("room{g}");
        rows.push(("members".into(), object([("id", Value::Id(format!("{room}-alice"))), ("roomId", Value::Id(room.clone())), ("principal", Value::Id("dev:alice".into()))])));
        for m in 0..6 {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}-m{m}"))), ("roomId", Value::Id(room.clone())),
                ("body", Value::String(format!("{} {m}", if g < 4 { "coffee" } else { "tea" }))), ("at", Value::Int(1_700_000_000_000 + m))])));
        }
    }
    (source, rows)
}

fn predicate_top_one(op: &str, count: usize) {
    // Ticket fixture: ten memberships, six messages each, four coffee rooms; the outer page is 20.
    let (source, rows) = grouped();
    with_fixture(&source, rows, |q| {
        let mut context = ctx(None);
        if matches!(op, "v1" | "v3") { context.args.insert("q".into(), Value::String("cof".into())); }
        let page = q(op, context).unwrap();
        observe(op, &page);
        assert_eq!(page.data.as_array().unwrap().len(), count);
        assert_eq!((page.complete, page.cut, page.next), (true, None, None));
    });
}

#[test] fn a_v1_matching_predicate_does_not_overflow() { predicate_top_one("v1", 4); }
#[test] fn a_v2_plain_predicate_does_not_overflow() { predicate_top_one("v2", 10); }

#[test]
fn a_predicate_cursor_does_not_take_page_ownership_and_shapes_stay_complete() {
    let (source, rows) = grouped();
    let source = source.replace("messages[.roomId] last 1", "messages[.roomId] after c last 1");
    with_fixture(&source, rows, |q| {
        for op in ["v2", "v3", "v4"] {
            let mut context = ctx(None);
        if matches!(op, "v1" | "v3") { context.args.insert("q".into(), Value::String("cof".into())); }
        let page = q(op, context).unwrap();
            observe(op, &page);
            assert_eq!((page.complete, page.cut, page.next), (true, None, None));
        }
    });
}

fn table(name: &str, index: &str, nullable: bool) -> String {
    format!("table {name}:\n  lane: int\n  at: int{}\n  body: text <=200\n  {index}\n  public 'merge fixture'\n  sync public\n", if nullable { " ?" } else { "" })
}

fn row(id: &str, lane: i64, at: Value, body: &str) -> Value {
    object([("id", Value::Id(id.into())), ("lane", Value::Int(lane)), ("at", at), ("body", Value::String(body.into()))])
}

fn merge_source(index: &str, nullable: bool, eager: bool, lanes: usize, direction: &str, take: usize, filter: &str) -> String {
    let mut source = table("msgs", index, nullable);
    if eager { source.push_str(&table("copy", index, nullable)); }
    source.push_str(&format!("query feed(c: cursor ?):\n  return merge msgs after c {direction} {take} by byLane{filter}:\n"));
    for lane in 0..lanes { source.push_str(&format!("    {}[{lane}]\n", if eager && lane == lanes - 1 { "copy" } else { "" })); }
    source
}

fn walk(q: &mut Query<'_>, name: &str) -> (Vec<String>, Vec<QueryOutcome>) {
    let mut pages = Vec::new();
    let mut all = Vec::new();
    let mut cursor = None;
    for _ in 0..200 {
        let page = q(name, ctx(cursor)).unwrap();
        all.extend(ids(&page));
        cursor = page.next.clone();
        pages.push(page);
        if cursor.is_none() { return (all, pages); }
    }
    panic!("continuation did not terminate");
}

#[test]
fn d01_equal_suffix_unique_and_non_unique_every_admitting_path() {
    // D5.6: lazy admits only required unique suffixes here; nullable/non-unique stay eager.
    // Two or nine lanes, ascending/descending, equal across lanes and within a non-unique lane.
    let failures = RefCell::new(Vec::new());
    for (index, nullable) in [("unique byLane: lane, at", false), ("by byLane: lane, at", false), ("unique byLane: lane, at", true)] {
        for eager in [false, true] { for lanes in [2, 9] { for direction in ["first", "last"] {
            let source = merge_source(index, nullable, eager, lanes, direction, 1, "");
            let other = if eager { "copy" } else { "msgs" };
            let mut rows = vec![("msgs".into(), row("a", 0, Value::Int(100), "a")), (other.into(), row("b", lanes as i64 - 1, Value::Int(100), "b")),
                ("msgs".into(), row("c", 0, Value::Int(90), "c")), (other.into(), row("d", lanes as i64 - 1, Value::Int(80), "d"))];
            let mut expected = vec!["d", "c", "a", "b"];
            if !index.starts_with("unique") { rows.push(("msgs".into(), row("aa", 0, Value::Int(100), "aa"))); expected.insert(3, "aa"); }
            if nullable {
                rows.extend([("msgs".into(), row("n1", 0, Value::Null, "n1")), ("msgs".into(), row("n2", 0, Value::Null, "n2"))]);
                expected.splice(0..0, ["n1", "n2"]);
            }
            if direction == "last" { expected.reverse(); }
            with_fixture(&source, rows, |q| {
                let (all, pages) = walk(q, "feed");
                println!("D0.1 index={index} nullable={nullable} cross={eager} lanes={lanes} {direction}: {all:?}");
                assert!(pages.iter().all(|p| p.complete && p.cut.is_none()));
                if all != expected { failures.borrow_mut().push(format!("index={index} nullable={nullable} cross={eager} lanes={lanes} {direction}: {all:?} != {expected:?}")); }
            });
        } } }
    }
    assert!(failures.borrow().is_empty(), "{}", failures.borrow().join("\n"));
}

#[test]
fn d01_old_descriptor_refused_and_paved_token_bytes_unchanged() {
    for ends_id in [true, false] {
        let source = merge_source(if ends_id { "by byLane: lane, at, id" } else { "unique byLane: lane, at" }, false, false, 2, "last", 1, "");
        let rows = vec![("msgs".into(), row("b", 0, Value::Int(100), "b")), ("msgs".into(), row("a", 1, Value::Int(90), "a"))];
        let mut position = CursorPosition { table: "msgs".into(), index: "byLane".into(), order: Order::Desc,
            suffix: vec![CursorColumn { name: "at".into(), kind: ColumnType::Int }], values: vec![Value::Int(100)], inclusive: false, scope: None };
        if ends_id { position.suffix.push(CursorColumn { name: "id".into(), kind: ColumnType::Id }); position.values.push(Value::Id("b".into())); }
        let old = encode_cursor(&Schema::default(), &position).unwrap();
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            if ends_id {
                assert_eq!(first.next.as_ref(), Some(&old), "C2: paved v1 bytes unchanged");
                assert_eq!(ids(&q("feed", ctx(Some(old.clone()))).unwrap()), ["a"]);
            } else {
                let error = q("feed", ctx(Some(old.clone()))).unwrap_err();
                assert_eq!(error.code, "E_INPUT");
                assert_eq!(error.message, "E_INPUT: cursor: cursor token describes a different table, index, order, or suffix");
            }
        });
    }
}

fn drain_fixture(words: bool, overlap: bool) -> (String, Vec<(String, Value)>, Vec<String>) {
    // D5.1: 12 x 1,000 rows, descending; the 100th examined and each 100th thereafter passes.
    // 1,200 opening + 69 x 100 = 8,100; refill 70 fails at 8,193 after 70 emissions.
    // D5.2/4 now prepays all fetched/decoded/tokenized rows. Preserve its
    // examined-cut positive case below the heap ceiling: 7,373 cheap missing
    // point reads, nine 100-row lanes with zebra every tenth, and lookahead.
    // 7,373 + 9*20 + 31*20 = 8,173; refill 32 cuts at 8,193, 32 emissions.
    // D5.3 overlaps the same nine words: pop 32 still duplicates emission 4.
    // Thus the asserted emissions/cut/ordered walk remain, with fewer large
    // tokenizer allocations. No ceiling or assertion is weakened.
    let source = if words {
        format!("{}query feed(c: cursor ?):\n  for i in range(0, 7373):\n    unused = exists msgs['missing']\n  return msgs[0] matching 'cof zebra' after c last 100 by byLane\n", table("msgs", "by byLane: lane, words(body), at, id", false))
    } else { merge_source("by byLane: lane, at, id", false, false, 12, "last", 100, " where .body = 'hit'") };
    let mut rows = Vec::new();
    let mut expected = Vec::new();
    let lanes = if overlap { 1 } else if words { 9 } else { 12 };
    let all_words = "coffeea coffeeb coffeec coffeed coffeee coffeef coffeeg coffeeh coffeei";
    let (population, stride) = if words { (100, 10) } else { (1000, 100) };
    for n in 0..population { for lane in 0..lanes {
        let id = format!("r{n:04}-{lane:02}");
        let hit = n % stride == stride - 1;
        let body = if overlap { format!("{all_words} {}", if hit { "zebra" } else { "none" }) }
            else if words { format!("coffee{} {}", char::from(b'a' + lane as u8), if hit { "zebra" } else { "none" }) }
            else { if hit { "hit" } else { "none" }.into() };
        rows.push(("msgs".into(), row(&id, if words { 0 } else { lane }, Value::Int(1000 - n), &body)));
    } }
    for n in (stride - 1..population).step_by(stride as usize) { for lane in (0..lanes).rev() { expected.push(format!("r{n:04}-{lane:02}")); } }
    (source, rows, expected)
}

fn drain(words: bool, overlap: bool) {
    let (source, rows, expected) = drain_fixture(words, overlap);
    with_fixture(&source, rows, |q| {
        let first = q("feed", ctx(None)).unwrap();
        observe(if overlap { "D5.3 duplicate" } else if words { "D5.2/4 lookahead" } else { "D5.1 filter" }, &first);
        assert_eq!(first.metered.examined, 8193);
        assert_eq!(first.metered.index_entries, if words { 10 } else { 0 });
        assert_eq!(ids(&first).len(), if overlap { 4 } else if words { 32 } else { 70 });
        assert!(!first.complete);
        assert_eq!(first.cut, Some(ReadCut::Meter));
        assert!(first.next.is_some(), "a known-head drain cut must continue");
        let (all, pages) = walk(q, "feed");
        assert_eq!(all, expected, "no skips, duplicates or out-of-order rows across the cut");
        assert!(pages.last().unwrap().complete);
        println!("drain walk: {} rows, {} pages", all.len(), pages.len());
    });
}

#[test] fn d51_filter_drain_cut_continues() { drain(false, false); }
#[test] fn d52_d54_further_term_lookahead_cut_continues() { drain(true, false); }
#[test] fn d53_duplicate_pop_stops_before_an_unknown_head() { drain(true, true); }

#[test]
fn d02_non_uniform_outcome_withholds_next_in_both_orders_and_paths() {
    // Two worlds differ only in 9,000 hidden rows, sorting ahead of the one visible note.
    // Synced devices hold only that visible note and never set the non-uniform class.
    let failures = RefCell::new(Vec::new());
    for eager in [false, true] { for synced in [false, true] { for hidden in [0, 9000] {
        let feed = merge_source("by byLane: lane, at, id", false, eager, 2, "last", 1, "");
        let merge = feed.split("  return ").nth(1).unwrap();
        let source = format!("{feed}\ntable notes:\n  owner: principal\n  body: text <=100\n  by byBody: body, id\n  by byOwner: owner, id\n  read <- .owner = viewer\n  {}\nquery before(c: cursor ?):\n  other = notes first 5 by byBody\n  page = {merge}  return {{ page, n: count(other) }}\nquery after(c: cursor ?):\n  page = {merge}  other = notes first 5 by byBody\n  return {{ page, n: count(other) }}\n", if synced { "sync" } else { "online only" });
        let mut rows = (0..5).map(|n| ("msgs".into(), row(&format!("r{n}"), 0, Value::Int(n), "m"))).collect::<Vec<_>>();
        rows.push(("notes".into(), object([("id", Value::Id("shown".into())), ("owner", Value::Id("dev:alice".into())), ("body", Value::String("zz visible".into()))])));
        if !(DEVICE && synced) { rows.extend((0..hidden).map(|n| ("notes".into(), object([("id", Value::Id(format!("hidden{n}"))), ("owner", Value::Id("dev:bob".into())), ("body", Value::String("aa hidden".into()))])))); }
        with_fixture(&source, rows, |q| {
            assert!(q("feed", ctx(None)).unwrap().next.is_some());
            for op in ["after", "before"] {
                let read = q(op, ctx(None)).unwrap();
                observe(&format!("D0.2 {op} eager={eager} synced={synced} hidden={hidden}"), &read);
                if read.next.is_some() != (DEVICE && synced) { failures.borrow_mut().push(format!("{op} eager={eager} synced={synced} hidden={hidden}: next={:?}", read.next)); }
                assert_eq!(read.complete, DEVICE && synced);
                assert_eq!(read.cut, if DEVICE && !synced && hidden > 0 { Some(ReadCut::Meter) } else { None });
            }
        });
    } } }
    assert!(failures.borrow().is_empty(), "{}", failures.borrow().join("\n"));
}

#[test]
fn control_c2c_later_meter_cut_does_not_strand_the_owner() {
    for eager in [false, true] {
        let source = merge_source("by byLane: lane, at, id", false, eager, 2, "last", 1, "")
            .replace("  return merge", "  page = merge") + &format!("  return page {{ id, later: count(extra[0] first 9000 by byLane) }}\n{}", table("extra", "by byLane: lane, at, id", false));
        let mut rows = (0..3).map(|n| ("msgs".into(), row(&format!("m{n}"), 0, Value::Int(n), "m"))).collect::<Vec<_>>();
        rows.extend((0..9000).map(|n| ("extra".into(), row(&format!("x{n}"), 0, Value::Int(n), "x"))));
        with_fixture(&source, rows, |q| {
            let page = q("feed", ctx(None)).unwrap();
            observe("C2c later shape cut", &page);
            assert!(ids(&page).is_empty(), "the unfinished merge row must not be returned");
            assert_eq!((page.complete, page.cut, page.next.is_some()), (false, Some(ReadCut::Meter), true));
        });
    }
}

#[test]
fn control_a_inner_meter_cut_is_still_incomplete() {
    let source = format!("{}{}query feed(c: cursor ?):\n  return msgs[0] after c first 20 by byLane where count(extra[0] first 9000 by byLane) > 0\n",
        table("msgs", "by byLane: lane, at, id", false), table("extra", "by byLane: lane, at, id", false));
    let mut rows = vec![("msgs".into(), row("parent", 0, Value::Int(0), "m"))];
    rows.extend((0..9000).map(|n| ("extra".into(), row(&format!("x{n}"), 0, Value::Int(n), "x"))));
    with_fixture(&source, rows, |q| {
        let page = q("feed", ctx(None)).unwrap();
        observe("A inner cut", &page);
        assert_eq!((page.complete, page.cut), (false, Some(ReadCut::Meter)));
        assert!(page.data.as_array().unwrap().is_empty());
    });
}

#[test]
fn control_c3_direct_filtered_cut_keeps_last_rule_visible_position() {
    for uniform in [true, false] {
        let source = format!("{}query feed(c: cursor ?):\n  return msgs after c first 20 by byLane where .body = 'hit'\n", table("msgs", "by byLane: lane, at, id", false));
        let source = if uniform { source } else { source.replace("public 'merge fixture'\n  sync public", "read <- .body != 'hidden'\n  online only") };
        let rows = (0..9000).map(|n| ("msgs".into(), row(&format!("r{n:04}"), 0, Value::Int(n), if n == 8999 { "hit" } else { "reject" }))).collect();
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            assert!(!first.complete);
            assert_eq!(first.cut, if uniform || DEVICE { Some(ReadCut::Meter) } else { None });
            let next = first.next.clone().expect("direct cut still continues past rejected visible rows");
            let position = decode_cursor(&Schema::default(), &next).unwrap();
            assert_eq!(position.values, [Value::Int(0), Value::Int(8191), Value::Id("r8191".into())]);
            assert_eq!(ids(&q("feed", ctx(Some(next))).unwrap()), ["r8999"]);
        });
    }
}

#[test]
fn control_c1_c2b_opening_cut_has_no_continuation_even_with_buffered_siblings() {
    // Eight lanes buffer take+1=101 matches each. Lane 0 supplies 101 cheaply;
    // lane 1's first hit is after 9,000 rejected rows: opening is cut, yet the
    // heap can fill a 100-row page from lane 0. has_more alone is unsafe.
    let source = merge_source("by byLane: lane, at, id", false, false, 8, "last", 100, " where .body = 'hit'");
    let mut rows = (0..102).map(|n| ("msgs".into(), row(&format!("a{n}"), 0, Value::Int(n), "hit"))).collect::<Vec<_>>();
    rows.extend((0..9001).map(|n| ("msgs".into(), row(&format!("b{n}"), 1, Value::Int(n), if n == 0 { "hit" } else { "reject" }))));
    with_fixture(&source, rows, |q| {
        let page = q("feed", ctx(None)).unwrap();
        assert_eq!(ids(&page).len(), 100);
        assert_eq!((page.complete, page.cut, page.next), (false, Some(ReadCut::Meter), None));
    });
}

#[test]
fn control_c1_opening_cut_with_a_short_nonempty_buffer_stays_terminal() {
    // Lane 1 opens with one newest hit and cuts on its remaining 9,000 rejects;
    // lane 0 is buffered. C2 preserves the opening-cut answer: b9000, a101..a3.
    let source = merge_source("by byLane: lane, at, id", false, false, 2, "last", 100, " where .body = 'hit'");
    let mut rows = (0..102).map(|n| ("msgs".into(), row(&format!("a{n}"), 0, Value::Int(n), "hit"))).collect::<Vec<_>>();
    rows.extend((0..9001).map(|n| ("msgs".into(), row(&format!("b{n}"), 1, Value::Int(n + 10000), if n == 9000 { "hit" } else { "reject" }))));
    with_fixture(&source, rows, |q| {
        let page = q("feed", ctx(None)).unwrap();
        observe("C2 audit: nonempty opening-cut buffer", &page);
        let expected = std::iter::once("b9000".to_owned()).chain((3..=101).rev().map(|n| format!("a{n}"))).collect::<Vec<_>>();
        assert_eq!(ids(&page), expected);
        assert_eq!((page.complete, page.cut, page.next), (false, Some(ReadCut::Meter), None));
    });
}

#[test]
fn control_c2d_uniform_words_continue_and_nonuniform_word_cuts_withhold_candidate() {
    for uniform in [true, false] { for owner_overflows in [false, true] {
        let mut source = format!("{}query feed(c: cursor ?):\n  auxiliary = msgs[1] matching 'cof' last 1 by byLane\n  return msgs[0] matching 'cof' after c last 1 by byLane\n", table("msgs", "by byLane: lane, words(body), at, id", false));
        if !uniform {
            source = format!("table members:\n  lane: int\n  principal: principal\n  unique byLanePrincipal: lane, principal\n  by byPrincipal: principal, id\n  read <- .principal = viewer\n  sync to .principal\n{source}")
                .replace("  body: text <=200", "  author: principal default 'dev:alice'\n  body: text <=200")
                .replace("public 'merge fixture'", "read <- exists members[.lane, viewer] and .author = viewer").replace("  sync public\n", "");
        }
        let mut rows = Vec::new();
        if !uniform { for lane in 0..2 { rows.push(("members".into(), object([("id", Value::Id(format!("member-{lane}"))),
            ("lane", Value::Int(lane)), ("principal", Value::Id("dev:alice".into()))]))); } }
        for lane in 0..2 { for n in 0..if lane == 1 || owner_overflows { 33 } else { 2 } {
            // Word coffee32 is newest: uniform discovery must include it; the
            // non-uniform twin still witnesses and discards that 33rd word.
            rows.push(("msgs".into(), row(&format!("r{lane}-{n}"), lane, Value::Int(n), &format!("coffee{n:02}"))));
        } }
        with_fixture(&source, rows, |q| {
            let page = q("feed", ctx(None)).unwrap();
            if uniform {
                // The cursorless auxiliary last 1 still loses rows: uniform
                // expansion repairs the owner's word cut, not that answer loss.
                assert!(!page.complete && page.word_cut_at.is_none() && page.cut.is_none() && page.next.is_some(), "{page:?}");
                assert_eq!(ids(&page), [if owner_overflows { "r0-32" } else { "r0-1" }]);
                let second = q("feed", ctx(page.next)).unwrap();
                assert_eq!(ids(&second), [if owner_overflows { "r0-31" } else { "r0-0" }]);
            } else {
                assert_eq!((page.complete, page.cut, page.next.as_ref()), (false, if DEVICE { Some(ReadCut::Words) } else { None }, None));
                assert!(page.word_cut_at.as_ref().is_some_and(|site| site.contains("feed")));
                assert_eq!(ids(&page), [if owner_overflows { "r0-31" } else { "r0-1" }], "non-uniform twin retains the same one-row returned shape");
            }
        });
    } }
}

#[test]
fn control_direct_unique_suffix_keeps_its_scoped_token() {
    let source = format!("{}query feed(c: cursor ?):\n  return msgs[0] after c last 1 by byLane\n", table("msgs", "unique byLane: lane, at", false));
    let rows = vec![("msgs".into(), row("a", 0, Value::Int(100), "a")), ("msgs".into(), row("b", 0, Value::Int(90), "b"))];
    with_fixture(&source, rows, |q| {
        let first = q("feed", ctx(None)).unwrap();
        let token = first.next.unwrap();
        let position = decode_cursor(&Schema::default(), &token).unwrap();
        assert_eq!(position.suffix, [CursorColumn { name: "at".into(), kind: ColumnType::Int }]);
        assert_eq!(position.values, [Value::Int(100)]);
        assert_eq!(position.scope.as_ref().unwrap().prefix, [Value::Int(0)]);
        assert_eq!(encode_cursor(&Schema::default(), &position).unwrap(), token);
        assert_eq!(ids(&q("feed", ctx(Some(token))).unwrap()), ["b"]);
    });
}

fn ticket_equal_suffix(unique: bool) {
    let source = if unique {
        include_str!("../../../../../benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-equal-suffix-skip/snapback/schema.q")
    } else {
        include_str!("../../../../../benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-cursor-bypasses-cursor-index/snapback/schema.q")
    }.replace("  online only", "  sync public");
    let rows = if unique { vec![("r1-100", "r1", 100), ("r2-100", "r2", 100), ("r1-090", "r1", 90), ("r2-080", "r2", 80)] }
        else { vec![("r1-100-a", "r1", 100), ("r1-100-b", "r1", 100), ("r1-090", "r1", 90)] };
    let rows = rows.into_iter().map(|(id, room, at)| ("msgs".into(), object([("id", Value::Id(id.into())), ("roomId", Value::Id(room.into())), ("at", Value::Int(at)), ("body", Value::String(id.into()))]))).collect();
    with_fixture(&source, rows, |q| {
        let mut all = Vec::new();
        let mut cursor = None;
        for page_no in 1..=8 {
            let mut context = ctx(cursor);
            context.args.extend([("a".into(), Value::Id("r1".into())), ("b".into(), Value::Id("r2".into()))]);
            let page = q("feed", context).unwrap();
            let found = ids(&page);
            println!("ticket unique={unique} page {page_no}: {} complete={} cut={} next={}", serde_json::to_string(&found).unwrap(), page.complete,
                serde_json::to_string(&page.cut).unwrap(), if page.next.is_some() { "yes" } else { "no" });
            assert!(page.complete && page.cut.is_none());
            all.extend(found);
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        let expected = if unique { vec!["r2-100", "r1-100", "r1-090", "r2-080"] } else { vec!["r1-100-b", "r1-100-a", "r1-090"] };
        assert_eq!(all, expected);
    });
}

#[test] fn ticket_merge_equal_suffix_skip() { ticket_equal_suffix(true); }
#[test] fn ticket_merge_cursor_bypasses_cursor_index() { ticket_equal_suffix(false); }

#[test]
fn ticket_merge_next_after_non_uniform() {
    let source = include_str!("../../../../../benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-next-after-non-uniform/snapback/schema.q")
        .replacen("  online only", "  sync", 2);
    let failures = RefCell::new(Vec::new());
    for hidden in [0, 9000] {
        let mut rows = Vec::new();
        for room in ["r1", "r2"] {
            rows.push(("members".into(), object([("id", Value::Id(format!("{room}-alice"))), ("roomId", Value::Id(room.into())), ("principal", Value::Id("dev:alice".into()))])));
            for m in 0..5 { rows.push(("messages".into(), object([("id", Value::Id(format!("{room}-m{m}"))), ("roomId", Value::Id(room.into())), ("body", Value::String(format!("hello {m}"))), ("at", Value::Int(1000 + m))]))); }
        }
        rows.push(("notes".into(), object([("id", Value::Id("n-alice".into())), ("ownerId", Value::Id("dev:alice".into())), ("body", Value::String("zz alice note".into()))])));
        rows.extend((0..hidden).map(|n| ("notes".into(), object([("id", Value::Id(format!("n-bob-{n:05}"))), ("ownerId", Value::Id("dev:bob".into())), ("body", Value::String(format!("aa bob note {n:05}")))]))));
        with_fixture(&source, rows, |q| {
            for op in ["mergeAlone", "mergeThenNonUniform", "nonUniformThenMerge"] {
                let page = q(op, ctx(None)).unwrap();
                observe(&format!("ticket {op} hidden={hidden}"), &page);
                assert_eq!(page.complete, op == "mergeAlone");
                assert_eq!(page.cut, if DEVICE && op != "mergeAlone" && hidden > 0 { Some(ReadCut::Meter) } else { None });
                if page.next.is_some() != (op == "mergeAlone") { failures.borrow_mut().push(format!("{op} hidden={hidden}: next={:?}", page.next)); }
            }
        });
    }
    assert!(failures.borrow().is_empty(), "{}", failures.borrow().join("\n"));
}
