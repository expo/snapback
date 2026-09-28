// Uniform matching merges share one heap; exercised on the server and acquired devices.
use super::{fixture, with_fixture, DECODED_STORE};
use snapback4_core::{Value, engine::{QueryOutcome, ReadCut}, value::object};
use std::cell::RefCell;

type Query<'a> = dyn FnMut(&str, Option<String>, &str) -> QueryOutcome + 'a;

fn source(take: usize, memberships: usize) -> String {
    format!("{}\nquery wide(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last {take} by byRoomWords:\n    [m.roomId] for m in members[principal = viewer] first {memberships} by byPrincipalRoom\n", fixture::legacy_source())
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
    let source = source(20, 1000) + "\nquery wideWalk(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 200 by byRoomWords:\n    [m.roomId] for m in members[principal = viewer] first 1000 by byPrincipalRoom\n";
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
fn w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped() {
    let mut rows = fixture::seed(12);
    rows.retain(|(table, _)| table == "members");
    for n in 0..33 { rows.push(message("r0000", n, format!("coffee{n:02}"), n as i64)); }
    rows.push(message("r0011", 0, "coffee".into(), 100));
    // @ref LLP 3000.028#3.3 — retain this authored-guard control on the old
    // evaluator; an unguarded ordinary membership page now infers its audience.
    let source = source(20, 1000) + "\nquery nonuniform(q: text <=100, c: cursor ?):\n  require q != 'blocked' else BLOCKED\n  return messages matching q after c last 20 by byWords\n";
    with_fixture(&source, rows, |q| {
        let page = q("wide", None, "cof");
        assert!(page.complete && page.cut.is_none() && page.next.is_some() && page.word_cut_at.is_none());
        assert_eq!(ids(&page).first().unwrap(), "r0011-0000", "a later scope is still discovered and wins");
        let pages = walk(q, "cof");
        assert_eq!(pages.iter().flat_map(ids).collect::<Vec<_>>(), std::iter::once("r0011-0000".to_owned()).chain((0..33).rev().map(|n| format!("r0000-{n:04}"))).collect::<Vec<_>>());
        let control = q("nonuniform", None, "cof");
        assert!(!control.complete && control.word_cut_at.is_some() && control.next.is_none());
        assert_eq!(control.metered.index_entries, 33);
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
    // Prepaid fetch/decode scratch makes the former 8,193-row search heap-cut.
    // Preserve the 32-emission resumable read-meter control with 7,374 cheap
    // missing point reads, then nine 100-row lanes matching every tenth row:
    // 9 memberships + 9*20 opening + 31*20 refills = 809; refill 32 crosses
    // the remaining 818 examined allowance. No ceiling is raised.
    let source = source(100, 1000).replace("query wide(q: text <=100, c: cursor ?):\n", "query wide(q: text <=100, c: cursor ?):\n  for i in range(0, 7374):\n    unused = exists members['missing']\n");
    with_fixture(&source, drain_rows(9, 100, 10), |q| {
        let first = q("wide", None, "cof zeb");
        println!("W13f drain rows={} examined={} cut={:?} next={}", ids(&first).len(), first.metered.examined, first.cut, first.next.is_some());
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        assert!(first.next.is_some());
        assert_eq!(ids(&first).len(), 32);
        assert_eq!(first.metered.examined, 8193);
        let pages = walk(q, "cof zeb");
        let expected: Vec<_> = (9..100).step_by(10).flat_map(|n| (0..9).rev().map(move |room| format!("r{room:04}-{n:04}"))).collect();
        assert_eq!(pages.iter().flat_map(ids).collect::<Vec<_>>(), expected);
        assert!(pages.last().unwrap().complete);
    });
}

#[test]
fn w13f_flattened_opening_cut_stays_terminal() {
    // 3,000 dense scope/word lanes: 3,000 memberships + 2 * 3,000 heads/lookahead > 8,192.
    with_fixture(&source(20, 3000), drain_rows(3000, 3, 1), |q| {
        let page = q("wide", None, "cof");
        // Both stores exhaust heap at this width and clear the entire page.
        // Typed projection-plan vectors also reserve their slots, so both
        // stores hit heap before examined while opening this many lanes.
        assert_eq!(page.data, Value::Null);
        assert!(page.metered.heap_bytes > snapback4_core::Ceilings::default().heap_bytes);
        assert_eq!(page.capped_at.as_ref().unwrap().0, snapback4_core::error::MeterKind::HeapBytes, "decoded_store={DECODED_STORE}");
        assert_eq!((page.complete, page.cut, page.next.as_ref()), (false, Some(ReadCut::Meter), None));
    });
    // Preserve the positive partial-opening case below the heap boundary:
    // 8,090 misses + 100 memberships leave two examined units, enough for
    // the first head/lookahead but not the remaining heads. No next is safe.
    let source = source(20, 100).replace("query wide(q: text <=100, c: cursor ?):\n", "query wide(q: text <=100, c: cursor ?):\n  for i in range(0, 8090):\n    unused = exists members['missing']\n");
    with_fixture(&source, drain_rows(100, 3, 1), |q| {
        let page = q("wide", None, "cof");
        assert_eq!(ids(&page).len(), 1);
        assert_eq!(page.capped_at.as_ref().unwrap().0, snapback4_core::error::MeterKind::Examined);
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
