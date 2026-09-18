// The two published forms: one cursor per read on every host.
use super::{fixture, with_fixture};
use snapback4_core::{Value, engine::{QueryOutcome, ReadCut}, value::object};
use std::collections::BTreeSet;

type Query<'a> = dyn FnMut(&str, Option<String>, &str) -> QueryOutcome + 'a;

fn grouped(q: &mut Query<'_>, expected_rooms: &[usize], complete: bool) -> (usize, u64, u64, u64) {
    let mut cursor = None;
    let mut rooms = Vec::new();
    let (mut pages, mut first, mut max, mut total) = (0, 0, 0, 0);
    loop {
        let page = q("searchGrouped", cursor, "cof");
        assert_eq!(page.complete, complete, "{page:?}");
        assert!(page.cut.is_none());
        pages += 1;
        assert!(pages <= 1000, "cursor must make progress");
        if pages == 1 { first = page.metered.examined; }
        max = max.max(page.metered.examined);
        total += page.metered.examined;
        for row in page.data.as_array().unwrap() {
            let room = row.field("roomId").unwrap().as_str().unwrap().to_owned();
            let hits = row.field("hits").unwrap().as_array().unwrap();
            assert_eq!(hits.iter().map(|hit| hit.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>(),
                (21..24).rev().map(|n| format!("{room}-{n:02}")).collect::<Vec<_>>());
            rooms.push(room);
        }
        cursor = page.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(rooms, expected_rooms.iter().map(|room| format!("r{room:04}")).collect::<Vec<_>>(), "every expected chat once, no unreadable chat");
    (pages, first, max, total)
}

fn dense(memberships: usize) {
    with_fixture(fixture::source(), fixture::seed(memberships), |q| {
        let (pages, first, max, total) = grouped(q, &(0..memberships).collect::<Vec<_>>(), true);
        println!("W13e grouped memberships={memberships} groups={memberships} hits={} requests={pages} examined_first={first} examined_max={max} examined_total={total} complete=true", memberships * 3);
        let mut all = fixture::Walk::new();
        let mut cursor = None;
        loop {
            let page = q("searchNewest", cursor, "cof");
            assert!(page.complete && page.cut.is_none());
            if all.pages == 0 { assert!(page.next.is_some()); }
            cursor = page.next.clone();
            all.add(&page);
            if cursor.is_none() { break; }
        }
        all.assert_matches(memberships, 24, memberships);
        all.print("W13e-newest", memberships);
        assert_eq!(all.first_examined, (3 * memberships + 40) as u64);
    });
}

#[test] fn w13e_dense_100() { dense(100); }
#[test] fn w13e_dense_500() { dense(500); }
#[test] fn w13e_dense_1000() { dense(1000); }

#[test]
fn w13e_grouped_cut_continues_through_9000_memberships() {
    let mut rows = Vec::new();
    for room in 0..=9000 {
        let room_id = format!("r{room:04}");
        rows.push(("members".into(), object([("id", Value::Id(format!("member{room:04}"))), ("roomId", Value::Id(room_id.clone())),
            ("principal", Value::Id(if room == 9000 { "dev:bob" } else { "dev:alice" }.into()))])));
        if [8100, 8500, 8999, 9000].contains(&room) {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room_id}-hit"))), ("roomId", Value::Id(room_id)),
                ("body", Value::String("coffee".into())), ("at", Value::Int(room))])));
        }
    }
    // @ref LLP 3000.007#20.22.5 — grouped search is a filtered page whose cut carries the examined membership position.
    with_fixture(fixture::source(), rows, |q| {
        let mut cursor = None;
        let mut rooms = BTreeSet::new();
        let mut pages = 0;
        let mut total = 0;
        loop {
            let page = q("searchGrouped", cursor, "cof");
            pages += 1;
            assert!(pages <= 2);
            total += page.metered.examined;
            println!("W13e grouped9000 request={pages} groups={} complete={} cut={:?} next={} examined={}", page.data.as_array().unwrap().len(), page.complete, page.cut, page.next.is_some(), page.metered.examined);
            if pages == 1 {
                assert_eq!((page.complete, page.cut), (false, Some(ReadCut::Meter)));
                assert!(page.next.is_some(), "the cut must continue");
                assert_eq!(page.data.as_array().unwrap().len(), 0);
                assert_eq!(page.metered.examined, 8194);
            } else {
                assert!(page.complete && page.cut.is_none() && page.next.is_none());
                assert_eq!(page.data.as_array().unwrap().len(), 3);
                assert_eq!(page.metered.examined, 906);
            }
            for row in page.data.as_array().unwrap() {
                let room = row.field("roomId").unwrap().as_str().unwrap().to_owned();
                let hits = row.field("hits").unwrap().as_array().unwrap();
                // The canonical returned shape retries a starved preview on the next request.
                assert_eq!(hits.len(), 1);
                if let Some(hit) = hits.first() { assert_eq!(hit.field("id").unwrap().as_str().unwrap(), format!("{room}-hit")); }
                assert!(rooms.insert(room), "no duplicated chat");
            }
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert_eq!(pages, 2);
        assert_eq!(rooms, ["r8100", "r8500", "r8999"].map(String::from).into());
        assert_eq!(total, 9100);
        println!("W13e grouped9000 requests={pages} groups={} examined_total={total}", rooms.len());
    });
}

#[test]
fn w13e_newest_measures_complete_page_and_opening_envelope() {
    for memberships in [2717, 2718, 2730, 2731, 3000] {
        with_fixture(fixture::source(), fixture::seed(memberships), |q| {
            let page = q("searchNewest", None, "cof");
            let ids: Vec<_> = page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect();
            println!("W13e newest-envelope memberships={memberships} rows={} examined={} complete={} cut={:?} next={}", ids.len(), page.metered.examined, page.complete, page.cut, page.next.is_some());
            if memberships <= 2730 {
                assert_eq!(ids, (memberships - 20..memberships).rev().map(|room| format!("r{room:04}-23")).take(ids.len()).collect::<Vec<_>>());
                assert!(page.next.is_some());
                assert_eq!(page.complete, memberships == 2717);
            } else {
                assert_eq!((page.complete, page.cut, page.next), (false, Some(ReadCut::Meter), None));
            }
        });
    }
}

#[test]
fn w13e_both_forms_report_unknown_history_at_a_device_horizon() {
    let source = fixture::source().replace("  sync to members[.roomId]\n\nquery searchHeld", "  sync to members[.roomId] last 10 by byRoomTime\n\nquery searchHeld");
    with_fixture(&source, fixture::seed(100), |q| {
        for op in ["searchGrouped", "searchNewest"] {
            for term in ["cof", "absent"] {
                let page = q(op, None, term);
                println!("W13e horizon op={op} term={term} complete={} rows={} next={} examined={}", page.complete, page.data.as_array().unwrap().len(), page.next.is_some(), page.metered.examined);
                assert_eq!(page.data.as_array().unwrap().len(), if term == "cof" { 20 } else { 0 });
                assert_eq!(page.next.is_some(), term == "cof");
                assert!(page.cut.is_none());
            }
        }
    });
}
