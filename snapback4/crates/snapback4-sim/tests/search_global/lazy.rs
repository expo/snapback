// Uniform matching merges share one heap; exercised on the server and acquired devices.
use super::{fixture, with_fixture};
use snapback4_core::{Value, engine::{QueryOutcome, ReadCut}, value::object};
use std::cell::RefCell;

type Query<'a> = dyn FnMut(&str, Option<String>, &str) -> QueryOutcome + 'a;

fn source(take: usize, memberships: usize) -> String {
    format!("{}\nquery wide(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last {take} by byRoomWords:\n    [m.roomId] for m in members[viewer] first {memberships} by byPrincipalRoom\n", fixture::source())
}

fn ids(page: &QueryOutcome) -> Vec<String> {
    page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

fn walk(q: &mut Query<'_>, term: &str) -> Vec<QueryOutcome> {
    let mut pages = Vec::new();
    let mut cursor = None;
    loop {
        let page = q("wide", cursor, term);
        cursor = page.next.clone();
        pages.push(page);
        assert!(pages.len() <= 2000, "cursor must make progress");
        if cursor.is_none() { return pages; }
    }
}

fn dense(memberships: usize) {
    with_fixture(&source(20, 1000), fixture::seed(memberships), |q| {
        let first = q("wide", None, "cof");
        println!("W13f dense memberships={memberships} rows={} examined={} complete={} cut={:?} next={}", ids(&first).len(), first.metered.examined, first.complete, first.cut, first.next.is_some());
        assert!(first.complete && first.next.is_some(), "{first:?}");
        assert_eq!(first.metered.examined, (3 * memberships + 40) as u64);
        let mut all = fixture::Walk::new();
        for page in walk(q, "cof") { assert!(page.complete); all.add(&page); }
        all.assert_matches(memberships, 24, memberships);
        all.print("W13f-one-cursor", memberships);
    });
}

#[test] fn w13f_dense_100() { dense(100); }
#[test] fn w13f_dense_500() { dense(500); }
#[test] fn w13f_dense_1000() { dense(1000); }

fn body(row: &mut Value, text: String) {
    if let Value::Row(fields) = row { fields.insert("body".into(), Value::String(text)); }
}

#[test]
fn w13f_clique_every_row_hits_in_1000_lanes() {
    let mut rows = fixture::seed(1000);
    for (table, row) in &mut rows { if table == "messages" { body(row, "coffee".into()); } }
    let expected: Vec<_> = (0..30).rev().flat_map(|n| (0..1000).rev().map(move |room| format!("r{room:04}-{n:02}"))).collect();
    // The first page stays the card's 20; the full walk uses 200 to keep this scale control cheap.
    let source = source(20, 1000) + "\nquery wideWalk(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 200 by byRoomWords:\n    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom\n";
    with_fixture(&source, rows, |q| {
        let first = q("wide", None, "cof");
        assert!(first.complete && first.next.is_some());
        assert_eq!(ids(&first), expected[..20]);
        let pages = walk(&mut |_, c, term| q("wideWalk", c, term), "cof");
        assert!(pages.iter().all(|p| p.complete && p.cut.is_none()));
        assert_eq!(pages.iter().flat_map(ids).collect::<Vec<_>>(), expected);
    });
}

#[test]
fn w13f_further_terms_and_duplicate_words_preserve_one_ordered_walk() {
    let mut rows = fixture::seed(12);
    for (table, row) in &mut rows {
        if table == "messages" {
            let at = row.field("at").unwrap().as_int().unwrap();
            body(row, format!("coffee coffin {}", if at % 3 == 0 { "zebra" } else { "tea" }));
        }
    }
    with_fixture(&source(20, 1000), rows, |q| {
        let pages = walk(q, "cof zeb");
        let expected: Vec<_> = (0..30).rev().filter(|n| n % 3 == 0).flat_map(|n| (0..12).rev().map(move |room| format!("r{room:04}-{n:02}"))).collect();
        assert!(pages.iter().all(|p| p.complete));
        assert_eq!(pages.iter().flat_map(ids).collect::<Vec<_>>(), expected);
    });
}

fn message(room: &str, n: usize, text: String, at: i64) -> (String, Value) {
    ("messages".into(), object([("id", Value::Id(format!("{room}-{n:04}"))), ("roomId", Value::Id(room.into())), ("body", Value::String(text)), ("at", Value::Int(at))]))
}

#[test]
fn w13f_word_overflow_keeps_later_scopes() {
    let mut rows = fixture::seed(12);
    rows.retain(|(table, _)| table == "members");
    for n in 0..33 { rows.push(message("r0000", n, format!("coffee{n:02}"), n as i64)); }
    rows.push(message("r0011", 0, "coffee".into(), 100));
    with_fixture(&source(20, 1000), rows, |q| {
        let page = q("wide", None, "cof");
        assert_eq!((page.complete, page.cut, page.next.as_ref()), (false, Some(ReadCut::Words), None));
        assert_eq!(ids(&page).first().unwrap(), "r0011-0000", "a later scope is still discovered and wins");
    });
}

fn drain_rows(lanes: usize, rows_per_lane: usize, stride: usize) -> Vec<(String, Value)> {
    let mut rows = fixture::seed(lanes);
    rows.retain(|(table, _)| table == "members");
    for room in 0..lanes { for n in 0..rows_per_lane {
        rows.push(message(&format!("r{room:04}"), n, format!("coffee {}", if n % stride == stride - 1 { "zebra" } else { "tea" }), (rows_per_lane - n) as i64));
    } }
    rows
}

#[test]
fn w13f_flattened_drain_cut_continues_after_32_emissions() {
    // Nine (scope, word) lanes, one word per scope, 1,000 rows descending in each.
    // Every 100th row matches term two. Memberships cost 9; opening costs 9 * 200.
    // 31 refills cost 6,200: 8,009 total. Refill 32 crosses 8,192 in lookahead.
    // Its emitted row is safe; the next head is unknown, so stop at 32 emissions.
    with_fixture(&source(100, 1000), drain_rows(9, 1000, 100), |q| {
        let first = q("wide", None, "cof zeb");
        println!("W13f drain rows={} examined={} cut={:?} next={}", ids(&first).len(), first.metered.examined, first.cut, first.next.is_some());
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        assert!(first.next.is_some());
        assert_eq!(ids(&first).len(), 32);
        assert_eq!(first.metered.examined, 8193);
        let pages = walk(q, "cof zeb");
        let expected: Vec<_> = (99..1000).step_by(100).flat_map(|n| (0..9).rev().map(move |room| format!("r{room:04}-{n:04}"))).collect();
        assert_eq!(pages.iter().flat_map(ids).collect::<Vec<_>>(), expected);
        assert!(pages.last().unwrap().complete);
    });
}

#[test]
fn w13f_flattened_opening_cut_stays_terminal() {
    // 3,000 dense scope/word lanes: 3,000 memberships + 2 * 3,000 heads/lookahead > 8,192.
    with_fixture(&source(20, 3000), drain_rows(3000, 3, 1), |q| {
        let page = q("wide", None, "cof");
        println!("W13f opening rows={} examined={} cut={:?} next={}", ids(&page).len(), page.metered.examined, page.cut, page.next.is_some());
        assert_eq!((page.complete, page.cut, page.next.as_ref()), (false, Some(ReadCut::Meter), None));
    });
}

#[test]
fn w13f_hidden_worlds_have_identical_pages_and_dev_meters() {
    let mut source = source(20, 1000);
    // Explicit denial exercises verdict-before-discovery as well as the hidden membership.
    source.push_str("\nquery denied(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    ['hidden']\n    ['r0000']\n");
    let observations = RefCell::new(Vec::new());
    for hidden in [false, true] {
        let mut rows = fixture::seed(12);
        if hidden {
            rows.push(("members".into(), object([("id", Value::Id("hidden-member".into())), ("roomId", Value::Id("hidden".into())), ("principal", Value::Id("dev:bob".into()))])));
            for n in 0..9000 { rows.push(message("hidden", n, format!("coffee{n}"), 10_000 + n as i64)); }
        }
        with_fixture(&source, rows, |q| {
            let mut pages = walk(q, "cof");
            pages.push(q("denied", None, "cof"));
            let observed: Vec<_> = pages.iter().map(|p| serde_json::to_vec(&serde_json::json!({
                "data": snapback4_core::wire::to_json(&p.data), "complete": p.complete, "cut": p.cut, "next": p.next, "meter": p.metered,
            })).unwrap()).collect();
            assert!(pages.iter().all(|p| p.complete && p.cut.is_none()));
            observations.borrow_mut().push(observed);
        });
    }
    assert_eq!(observations.borrow()[0], observations.borrow()[1]);
}
