// The owning page's post-materialization shapes on the server and both device stores.
use super::{with_fixture, DEVICE};
use snapback4_core::{Context, Value, engine::{QueryOutcome, ReadCut}, value::object, cursor::decode_cursor, schema::Schema};

fn ctx(cursor: Option<String>) -> Context {
    Context::new("dev:alice", [("c".into(), cursor.map(Value::String).unwrap_or(Value::Null)), ("q".into(), Value::String("cof".into()))].into()).at(100_000)
}

#[test]
fn w13j_a_shape_that_cannot_finish_under_a_fresh_meter_refuses_the_follow() {
    let source = "table items:\n  lane: int\n  by byLane: lane, id\n  public 'fixture'\n  sync public\nquery feed(c: cursor ?):\n  return items[0] after c first 1 by byLane { id, n: count(items[1] first 9000 by byLane) }\n";
    let rows = std::iter::once(("a".to_owned(), 0)).chain((0..9000).map(|n| (format!("x{n:05}"), 1)))
        .map(|(id, lane)| ("items".into(), object([("id", Value::Id(id)), ("lane", Value::Int(lane))]))).collect();
    with_fixture(source, rows, |q| {
        let first = q("feed", Context::new("dev:alice", [("c".into(), Value::Null)].into())).unwrap();
        assert!(first.data.as_array().unwrap().is_empty());
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        let cursor = first.next.expect("retry the first unfinished row");
        assert!(decode_cursor(&Schema::default(), &cursor).unwrap().inclusive);
        println!("W13j device={DEVICE}: first examined={} index_entries={} capped_at={:?}", first.metered.examined, first.metered.index_entries, first.capped_at);
        let refusal = q("feed", Context::new("dev:alice", [("c".into(), Value::String(cursor))].into())).unwrap_err();
        assert_eq!(refusal.code, "E_SHAPE_EXCEEDS_METER");
        assert_eq!(refusal.message, "E_SHAPE_EXCEEDS_METER: the returned shape at programs.feed.1 examines more than the 8,192-row meter on its own; bound it (`first N`/`last N`) or move it out of the returned shape");
        assert_eq!(refusal.guide.as_deref(), Some("reads"));
    });
}

fn ids(page: &QueryOutcome) -> Vec<String> {
    page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}

#[test]
fn w13j_exclusive_or_advancing_inclusive_follows_and_finished_shapes_still_answer() {
    let source = "table items:\n  lane: int\n  by byLane: lane, id\n  public 'fixture'\n  sync public\nquery feed(c: cursor ?, spare: cursor ?):\n  return items[0] after c first 1 by byLane { id, n: count(items[1] first 9000 by byLane) }\nquery bounded(c: cursor ?):\n  return items[0] after c first 1 by byLane { id, n: count(items[1] first 3 by byLane) }\n";
    let rows = std::iter::once(("a".to_owned(), 0)).chain((0..9000).map(|n| (format!("x{n:05}"), 1)))
        .map(|(id, lane)| ("items".into(), object([("id", Value::Id(id)), ("lane", Value::Int(lane))]))).collect();
    with_fixture(source, rows, |q| {
        let first = q("feed", Context::new("dev:alice", [("c".into(), Value::Null)].into())).unwrap();
        let next = first.next.unwrap();
        let position = decode_cursor(&Schema::default(), &next).unwrap();
        for inclusive in [false, true] {
            let mut earlier = position.clone();
            earlier.values = vec![Value::Id("0".into())];
            earlier.inclusive = inclusive;
            let cursor = snapback4_core::cursor::encode_cursor(&Schema::default(), &earlier).unwrap();
            let page = q("feed", Context::new("dev:alice", [("c".into(), Value::String(cursor)), ("spare".into(), Value::String(next.clone()))].into())).unwrap();
            assert!(page.data.as_array().unwrap().is_empty());
            assert_eq!((page.complete, page.cut, page.next), (false, Some(ReadCut::Meter), Some(next.clone())));
        }
        let mut exclusive = position;
        exclusive.inclusive = false;
        let cursor = snapback4_core::cursor::encode_cursor(&Schema::default(), &exclusive).unwrap();
        let end = q("feed", Context::new("dev:alice", [("c".into(), Value::String(cursor))].into())).unwrap();
        assert!(end.data.as_array().unwrap().is_empty() && end.complete && end.next.is_none());
        let bounded = q("bounded", Context::new("dev:alice", [("c".into(), Value::String(next))].into())).unwrap();
        assert_eq!(ids(&bounded), ["a"]);
        assert_eq!(bounded.data.as_array().unwrap()[0].field("n").unwrap(), &Value::Int(3));
        assert!(bounded.complete && bounded.next.is_none());
    });
}

#[test]
fn w13j_unfinishable_merge_shapes_refuse_in_both_directions() {
    for direction in ["first", "last"] { for owner in ["lazy", "eager", "words"] {
        let mut source = format!("{}{}{}query feed(c: cursor ?, q: text <=100):\n", table("msgs"), table("copy"), table("extra"));
        if owner == "words" {
            source = source.replace("  by byLane: lane, at, id", "  by byLane: lane, at, id\n  by byWords: lane, words(body), at, id");
            source.push_str(&format!("  page = msgs[0] matching q after c {direction} 1 by byWords\n"));
        } else {
            source.push_str(&format!("  page = merge msgs after c {direction} 1 by byLane:\n    [0]\n    {}[1]\n", if owner == "eager" { "copy" } else { "" }));
        }
        source.push_str("  return page { id, n: count(extra[0] first 9000 by byLane) }\n");
        let mut rows = vec![row("a", 0, 0, "coffee")];
        rows.extend((0..9000).map(|n| extra(n, 0)));
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            assert!(ids(&first).is_empty());
            assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
            let next = first.next.expect("inclusive shape retry");
            assert!(decode_cursor(&Schema::default(), &next).unwrap().inclusive);
            let refusal = q("feed", ctx(Some(next))).unwrap_err();
            assert_eq!(refusal.code, "E_SHAPE_EXCEEDS_METER", "{owner} {direction}");
            assert_eq!(refusal.guide.as_deref(), Some("reads"));
        });
    } }
}

fn table(name: &str) -> String {
    format!("table {name}:\n  lane: int\n  at: int\n  body: text <=100\n  by byLane: lane, at, id\n  public 'shape fixture'\n  sync public\n")
}

fn row(id: &str, lane: i64, at: i64, body: &str) -> (String, Value) {
    ("msgs".into(), object([("id", Value::Id(id.into())), ("lane", Value::Int(lane)), ("at", Value::Int(at)), ("body", Value::String(body.into()))]))
}

fn extra(n: i64, lane: i64) -> (String, Value) {
    let (_, value) = row(&format!("x{lane}-{n:05}"), lane, n, "detail");
    ("extra".into(), value)
}

#[test]
fn w13h_grouped_9000_walk_never_emits_an_empty_preview() {
    let source = include_str!("../../../../../benchmarks/runs/2026-09-17-snapback4-bounds-probes/grouped-search-9000/snapback/schema.q")
        .replace("  online only", "  sync")
        .replace("count(messages[roomId = .roomId] matching q last 1 by byRoomWords) > 0", "exists (messages[roomId = .roomId] matching q)");
    let mut rows = Vec::new();
    for g in 0..9000 {
        let room = format!("r{g:05}");
        rows.push(("members".into(), object([("id", Value::Id(format!("{room}-alice"))), ("roomId", Value::Id(room.clone())), ("principal", Value::Id("dev:alice".into()))])));
        let hit = [4100, 8500, 8950].contains(&g);
        for m in 0..if hit { 5 } else { 1 } {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}-m{m}"))), ("roomId", Value::Id(room.clone())),
                ("body", Value::String(if hit { format!("coffee number {m}") } else { "tea".into() })), ("at", Value::Int(m))])));
        }
    }
    with_fixture(&source, rows, |q| {
        let mut cursor = None;
        let mut found = Vec::new();
        let mut previews = Vec::new();
        for request in 1..=4 {
            let page = q("grouped", ctx(cursor)).unwrap();
            let groups = page.data.as_array().unwrap();
            let summary: Vec<_> = groups.iter().map(|group| {
                let room = group.field("roomId").unwrap().as_str().unwrap().to_owned();
                let hits: Vec<_> = group.field("hits").unwrap().as_array().unwrap().iter().map(|hit| hit.field("id").unwrap().as_str().unwrap().to_owned()).collect();
                found.push(room.clone());
                previews.push((room.clone(), hits.clone()));
                (room, hits)
            }).collect();
            println!("W13h grouped device={DEVICE} request {request}: groups={} complete={} cut={} next={} examined={} idx={} previews={}", groups.len(), page.complete,
                serde_json::to_string(&page.cut).unwrap(), if page.next.is_some() { "yes" } else { "no" }, page.metered.examined, page.metered.index_entries, serde_json::to_string(&summary).unwrap());
            cursor = page.next;
            if cursor.is_none() { assert!(page.complete); break; }
        }
        assert!(cursor.is_none(), "the grouped walk must finish");
        assert_eq!(found, ["r04100", "r08500", "r08950"]);
        for (room, hits) in previews { assert_eq!(hits, [format!("{room}-m4"), format!("{room}-m3"), format!("{room}-m2")], "{room} preview on its emitted page"); }
    });
}

#[test]
fn w13h_shape_cut_retries_the_first_unfinished_row_in_both_directions() {
    for direction in ["first", "last"] {
        // Three source rows; a's 8,188 detail rows leave one examined unit.
        // b's second detail row cuts. Continuing at b fits its shape and c's.
        let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  return msgs after c {direction} 3 by byLane {{ id, details: extra[.at] first 8190 by byLane }}\n", table("msgs"), table("extra"));
        let mut rows = vec![row("a", 0, if direction == "first" { 0 } else { 2 }, ""), row("b", 0, 1, ""), row("c", 0, if direction == "first" { 2 } else { 0 }, "")];
        rows.extend((0..8188).map(|n| extra(n, if direction == "first" { 0 } else { 2 })));
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            println!("W13h shape {direction} device={DEVICE}: ids={:?} examined={} next={}", ids(&first), first.metered.examined, first.next.is_some());
            assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
            assert_eq!(ids(&first), ["a"]);
            assert_eq!(first.data.as_array().unwrap()[0].field("details").unwrap().as_array().unwrap().len(), 8188);
            let next = first.next.expect("retry the unfinished shape");
            let second = q("feed", ctx(Some(next))).unwrap();
            assert_eq!(ids(&second), ["b", "c"]);
            assert_eq!(second.data.as_array().unwrap()[0].field("details").unwrap().as_array().unwrap().len(), 2);
            assert!(second.complete && second.next.is_none());
        });
    }
}

#[test]
fn w13h_predicate_cut_control_keeps_the_last_rule_visible_position() {
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  return msgs after c first 20 by byLane where count(extra[.at] first 9000 by byLane) > 0\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
    rows.extend((0..9000).map(|n| extra(n, 0)));
    rows.push(extra(0, 1));
    with_fixture(&source, rows, |q| {
        let first = q("feed", ctx(None)).unwrap();
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        assert!(ids(&first).is_empty());
        let next = first.next.unwrap();
        assert_eq!(decode_cursor(&Schema::default(), &next).unwrap().values.last(), Some(&Value::Id("a".into())));
        assert_eq!(ids(&q("feed", ctx(Some(next))).unwrap()), ["b"]);
    });
}

#[test]
fn w13h_drain_cut_keeps_only_fully_shaped_emissions() {
    // 12 lanes, every 100th descending candidate matches: opening 1,200;
    // 69 refills reach 8,100; refill 70 cuts at 8,193. The last emission
    // alone asks for a detail, so 69 pure shapes survive the inherited cap.
    let mut source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  page = merge msgs after c last 100 by byLane where .body = 'hit':\n", table("msgs"), table("extra"));
    for lane in 0..12 { source.push_str(&format!("    [{lane}]\n")); }
    source.push_str("  return page { id, details: extra[0] first 1 by byLane if .id = 'm02-0600' else [] }\n");
    let mut rows = Vec::new();
    for lane in 0..12 { for n in 1..=1000 {
        rows.push(row(&format!("m{lane:02}-{n:04}"), lane, 1001 - n, if n % 100 == 0 { "hit" } else { "miss" }));
    } }
    rows.push(extra(0, 0));
    for all_starved in [false, true] {
    let shaped = if all_starved { source.replace(" if .id = 'm02-0600' else []", "") } else { source.clone() };
    with_fixture(&shaped, rows.clone(), |q| {
        let first = q("feed", ctx(None)).unwrap();
        let emitted = ids(&first);
        println!("W13h drain device={DEVICE}: rows={} last={:?} examined={} next={}", emitted.len(), emitted.last(), first.metered.examined, first.next.is_some());
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        if all_starved {
            assert!(emitted.is_empty());
            assert!(first.next.is_none(), "a drain candidate requires a fully computed emission");
            return;
        }
        assert_eq!(emitted.len(), 69);
        assert_eq!(emitted.last().unwrap(), "m03-0600");
        let next = first.next.unwrap();
        assert_eq!(decode_cursor(&Schema::default(), &next).unwrap().values.last(), Some(&Value::Id("m03-0600".into())));
        let second = q("feed", ctx(Some(next))).unwrap();
        assert_eq!(ids(&second).first().unwrap(), "m02-0600");
        assert_eq!(second.data.as_array().unwrap()[0].field("details").unwrap().as_array().unwrap().len(), 1);
        let all = emitted.into_iter().chain(ids(&second)).collect::<Vec<_>>();
        assert_eq!(all.len(), 120);
        assert_eq!(all.iter().collect::<std::collections::BTreeSet<_>>().len(), 120);
        assert!(second.complete && second.next.is_none());
    });
    }
}

#[test]
fn w13h_successive_shapes_keep_partial_rows_on_direct_eager_and_lazy_pages() { first_shape_cut(false); }

#[test]
fn w13h_canonical_bound_read_retries_direct_eager_and_lazy_pages() { first_shape_cut(true); }

fn first_shape_cut(canonical: bool) {
    for direction in ["first", "last"] { for owner in ["direct", "lazy", "eager"] {
        // Prelude uses 8,189 examined; source materialization fits; a two-row
        // preview cannot finish. Resume at a, skipping the cursor-free prelude.
        let mut source = format!("{}{}{}query feed(c: cursor ?, q: text <=100):\n  if c = null:\n    spent = count(extra[0] first 8189 by byLane)\n", table("msgs"), table("copy"), table("extra"));
        if owner == "direct" {
            source.push_str(&format!("  page = msgs[0] after c {direction} 1 by byLane\n"));
        } else {
            source.push_str(&format!("  page = merge msgs after c {direction} 1 by byLane:\n    [0]\n    {}[1]\n", if owner == "eager" { "copy" } else { "" }));
        }
        // The canonical form shapes the read directly. Successive assigned shapes
        // keep their partial row and the original exclusive continuation.
        source.push_str(if canonical { "  return page { id, preview: extra[1] first 2 by byLane }\n" }
            else { "  cards = page { id }\n  return cards { id, preview: extra[1] first 2 by byLane }\n" });
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, if direction == "first" { 1 } else { -1 }, "")];
        rows.extend((0..8189).map(|n| extra(n, 0)));
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)), "{owner} {direction}");
            if !canonical {
                assert_eq!(ids(&first), ["a"]);
                assert!(first.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len() < 2);
                let next = first.next.expect("ordinary raw position");
                let second = q("feed", ctx(Some(next))).unwrap();
                assert_eq!(ids(&second), ["b"]);
                assert!(second.complete && second.next.is_none());
                return;
            }
            assert!(ids(&first).is_empty(), "{owner} {direction}: unfinished first shape");
            let next = first.next.expect("an inclusive first-row position");
            let second = q("feed", ctx(Some(next))).unwrap();
            assert_eq!(ids(&second), ["a"], "{owner} {direction}");
            assert_eq!(second.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), 2);
            assert!(second.complete);
            let third = q("feed", ctx(second.next)).unwrap();
            assert_eq!(ids(&third), ["b"], "{owner} {direction}: no duplicated boundary");
            assert!(third.complete && third.next.is_none());
        });
    } }
}

#[test]
fn w13h_nested_shape_cut_control_preserves_its_outer_row() {
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  spent = count(extra[0] first 8190 by byLane)\n  nested = msgs[0] first 1 by byLane {{ id, preview: extra[1] first 2 by byLane }}\n  return {{ id: 'outer', nested }}\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, "")];
    rows.extend((0..8190).map(|n| extra(n, 0)));
    rows.extend((0..2).map(|n| extra(n, 1)));
    with_fixture(&source, rows, |q| {
        let answer = q("feed", ctx(None)).unwrap();
        assert_eq!((answer.complete, answer.cut), (false, Some(ReadCut::Meter)));
        assert_eq!(answer.data.field("id").unwrap().as_str().unwrap(), "outer");
        assert_eq!(answer.data.field("nested").unwrap().as_array().unwrap().len(), 1);
        assert!(answer.next.is_none());
    });
}

#[test]
fn w13h_cursorless_return_also_drops_an_unfinished_shape() {
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  spent = count(extra[0] first 8190 by byLane)\n  return msgs[0] first 1 by byLane {{ id, preview: extra[1] first 2 by byLane }}\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, "")];
    rows.extend((0..8190).map(|n| extra(n, 0)));
    rows.extend((0..2).map(|n| extra(n, 1)));
    with_fixture(&source, rows, |q| {
        let answer = q("feed", ctx(None)).unwrap();
        assert_eq!((answer.complete, answer.cut), (false, Some(ReadCut::Meter)));
        assert!(ids(&answer).is_empty());
        assert!(answer.next.is_none());
    });
}

#[test]
fn w13h_auxiliary_shape_does_not_rewind_the_returned_raw_page() {
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n  page = msgs[0] after c first 1 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n  return page\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
    rows.extend((0..8190).map(|n| extra(n, 0)));
    rows.extend((0..2).map(|n| extra(n, 1)));
    with_fixture(&source, rows, |q| {
        let first = q("feed", ctx(None)).unwrap();
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        assert_eq!(ids(&first), ["a"]);
        let second = q("feed", ctx(first.next)).unwrap();
        assert_eq!(ids(&second), ["b"], "an unused shape must not move the raw page's continuation");
        assert!(second.complete && second.next.is_none());
    });
}

fn auxiliary_return(form: &str, raw: bool) { auxiliary_return_cut(form, raw, true); }

fn auxiliary_return_cut(form: &str, raw: bool, cut: bool) { auxiliary_return_cut_owner(form, raw, cut, true); }

fn auxiliary_return_cut_owner(form: &str, raw: bool, cut: bool, owner: bool) {
    let prelude = if cut { "  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n" } else { "" };
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n{prelude}  page = msgs[0] after c first 1 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n{form}\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
    if cut { rows.extend((0..8190).map(|n| extra(n, 0))); }
    rows.extend((0..2).map(|n| extra(n, 1)));
    with_fixture(&source, rows, |q| {
        let mut context = ctx(None);
        context.args.insert("q".into(), Value::String(if raw { "raw" } else { "shaped" }.into()));
        let first = q("feed", context.clone()).unwrap();
        let page_ids = |page: &QueryOutcome| {
            let data = page.data.field("page").unwrap_or(&page.data);
            data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>()
        };
        assert_eq!((first.complete, first.cut), (!cut && owner, cut.then_some(ReadCut::Meter)));
        assert_eq!(page_ids(&first), ["a"]);
        if !raw {
            let data = first.data.field("page").unwrap_or(&first.data);
            assert_eq!(data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), if cut { 0 } else { 2 });
        }
        if let Ok(n) = first.data.field("n") { assert_eq!(*n, Value::Int(1)); }
        if let Ok(shaped) = first.data.field("shaped") { assert_eq!(shaped.as_array().unwrap().len(), 1); }
        if !owner { assert!(first.next.is_none(), "main cannot infer ownership through this loop"); return; }
        let next = first.next.clone().expect("a continuation");
        assert_eq!(decode_cursor(&Schema::default(), &next).unwrap().values.last(), Some(&Value::Id("a".into())));
        context.args.insert("c".into(), Value::String(next));
        let second = q("feed", context).unwrap();
        assert_eq!(page_ids(&second), ["b"]);
        assert!(second.complete && second.next.is_none());
        println!("W13h return device={DEVICE} raw={raw} cut={cut}: {:?} -> {:?}", page_ids(&first), page_ids(&second));
    });
}

#[test]
fn w13h_used_auxiliary_summary_does_not_rewind_the_returned_raw_page() {
    auxiliary_return("  return { page, n: count(ignored) }", true);
}

#[test]
fn w13h_raw_page_returned_beside_its_shape_keeps_its_own_position() {
    auxiliary_return("  return { page, shaped: ignored }", true);
}

#[test]
fn w13h_conditional_return_keeps_the_raw_position_for_both_arms() {
    for raw in [true, false] {
        auxiliary_return("  if q = 'raw':\n    return page { * }\n  else:\n    return ignored", raw);
    }
}

fn conditional_value_return(form: &str, raw: bool) { conditional_value_return_checked(form, raw, |_, _| {}); }

fn conditional_value_return_checked(form: &str, raw: bool, check: impl Fn(&Value, &str)) {
    conditional_value_return_owner(form, raw, true, check);
}

fn conditional_value_return_owner(form: &str, raw: bool, owner: bool, check: impl Fn(&Value, &str)) {
    conditional_value_return_observations(form, raw, owner, true, check);
}

fn conditional_value_return_observations(form: &str, raw: bool, owner: bool, uncut_complete: bool, check: impl Fn(&Value, &str)) {
    for cut in [true, false] {
        let prelude = if cut { "  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n" } else { "" };
        let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n{prelude}  page = msgs[0] after c first 1 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n{form}\n", table("msgs"), table("extra"));
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
        if cut { rows.extend((0..8190).map(|n| extra(n, 0))); }
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let mut context = ctx(None);
            context.args.insert("q".into(), Value::String(if raw { "raw" } else { "shaped" }.into()));
            let page = |answer: &QueryOutcome| answer.data.field("page").unwrap_or(&answer.data).clone();
            let page_ids = |answer: &QueryOutcome| page(answer).as_array().unwrap().iter()
                .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
            let first = q("feed", context.clone()).unwrap();
            assert_eq!((first.complete, first.cut), (!cut && owner && uncut_complete, cut.then_some(ReadCut::Meter)));
            assert_eq!(page_ids(&first), ["a"], "an ambiguous return keeps the row, even if its preview is unfinished");
            if !owner {
                assert!(first.next.is_none(), "main leaves this return unowned");
                let shaped = first.data.field("shaped").cloned().unwrap_or_else(|_| page(&first));
                if !raw || first.data.field("shaped").is_ok() {
                    assert_eq!(shaped.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), if cut { 0 } else { 2 });
                }
                check(&first.data, "a");
                return;
            }
            context.args.insert("c".into(), Value::String(first.next.clone().expect("main's page owner")));
            let second = q("feed", context).unwrap();
            assert_eq!(page_ids(&second), ["b"], "a possibly raw page must never rewind");
            assert!(second.complete && second.next.is_none());
            check(&first.data, "a");
            check(&second.data, "b");
            for (answer, expected, preview_len) in [(&first, "a", if cut { 0 } else { 2 }), (&second, "b", 2)] {
                let shaped = answer.data.field("shaped").cloned().unwrap_or_else(|_| page(answer));
                if !raw || answer.data.field("shaped").is_ok() {
                    let shaped_rows = shaped.as_array().unwrap();
                    assert_eq!(shaped_rows.len(), 1, "no trimmed row may be skipped by the raw continuation");
                    assert_eq!(shaped_rows[0].field("id").unwrap().as_str().unwrap(), expected);
                    assert_eq!(shaped_rows[0].field("preview").unwrap().as_array().unwrap().len(), preview_len);
                }
            }
            println!("W13h conditional device={DEVICE} raw={raw} cut={cut}: {:?} -> {:?}; examined={} -> {}", page_ids(&first), page_ids(&second), first.metered.examined, second.metered.examined);
        });
    }
}

// Explicitly shape the raw arm too: differing row kinds cannot join.
const CONDITIONAL_RECORD: &str = "  selected = (page { id, preview: [] }) if q = 'raw' else ignored\n  return { page: selected, shaped: ignored }";
const CONDITIONAL_PAGE: &str = "  return (page { id, preview: [] }) if q = 'raw' else ignored";

#[test]
fn w13h_conditional_value_record_raw_keeps_its_position() { conditional_value_return(CONDITIONAL_RECORD, true); }

#[test]
fn w13h_conditional_value_record_shaped_keeps_its_rows() { conditional_value_return(CONDITIONAL_RECORD, false); }

#[test]
fn w13h_conditional_value_raw_keeps_its_owner() { conditional_value_return(CONDITIONAL_PAGE, true); }

#[test]
fn w13h_conditional_value_shaped_keeps_its_rows() { conditional_value_return(CONDITIONAL_PAGE, false); }

#[test]
fn w13h_conditional_value_record_field_keeps_its_page() {
    for raw in [true, false] {
        conditional_value_return("  selected = { inner: page { * } } if q = 'raw' else { inner: ignored }\n  return { page: selected.inner, shaped: ignored }", raw);
    }
}

#[test]
fn w13h_conditional_value_successive_shape_keeps_its_rows() {
    for raw in [true, false] {
        conditional_value_return("  copy = page { id, preview: extra[1] first 2 by byLane }\n  selected = copy if q = 'raw' else ignored\n  cards = selected { id, preview: extra[1] first 2 by byLane }\n  return { page: selected, shaped: cards }", raw);
    }
}

#[test]
fn w13h_conditional_same_shape_keeps_partial_rows_without_rewind() {
    auxiliary_return("  return ignored if q = 'raw' else ignored", false);
}

#[test]
fn w13h_conditional_cursor_field_does_not_hide_the_page_owner() {
    auxiliary_return("  label = c if q = 'raw' else null\n  return { page, label }", true);
}

#[test]
fn w13h_conditional_value_without_exhaustion_keeps_next() {
    for raw in [true, false] {
        let source = format!("{}query feed(c: cursor ?, q: text <=100):\n  page = msgs[0] after c first 1 by byLane\n  shaped = page {{ id }}\n  return (page {{ * }}) if q = 'raw' else shaped\n", table("msgs"));
        with_fixture(&source, vec![row("a", 0, 0, ""), row("b", 0, 1, "")], |q| {
            let mut context = ctx(None);
            context.args.insert("q".into(), Value::String(if raw { "raw" } else { "shaped" }.into()));
            let first = q("feed", context.clone()).unwrap();
            assert_eq!((first.complete, first.cut), (true, None));
            assert_eq!(ids(&first), ["a"]);
            context.args.insert("c".into(), Value::String(first.next.expect("an uncut conditional page keeps its continuation")));
            let second = q("feed", context).unwrap();
            assert_eq!(ids(&second), ["b"]);
            assert!(second.complete && second.next.is_none());
        });
    }
}

fn inherited_lane_cap(domain: &str) {
    for eager in [true, false] {
        let details = if eager { table("extra").replace("lane, at, id", "lane, at") } else { table("extra") };
        let source = format!("{}{}fn preview():\n  return merge extra first 2 by byLane:\n    [lane] for lane in {domain}\nquery feed(c: cursor ?, q: text <=100):\n  page = msgs[0] after c first 1 by byLane\n  if c = null:\n    spent = count(extra[0] first 9000 by byLane)\n  return page {{ id, preview: preview() }}\n", table("msgs"), details);
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
        rows.extend((0..9000).map(|n| extra(n, 0)));
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
            assert!(ids(&first).is_empty(), "inherited cap: eager={eager} domain={domain}, {:?}", first.data);
            let second = q("feed", ctx(Some(first.next.expect("retry a's skipped lanes")))).unwrap();
            assert_eq!(ids(&second), ["a"]);
            assert_eq!(second.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), 2);
            assert!(second.complete);
            let third = q("feed", ctx(second.next)).unwrap();
            assert_eq!(ids(&third), ["b"]);
            assert!(third.complete && third.next.is_none());
        });
    }
}

#[test]
fn w13h_inherited_cap_cuts_range_merge_shapes() { inherited_lane_cap("range(1, 2)"); }

#[test]
fn w13h_inherited_cap_cuts_list_merge_shapes() { inherited_lane_cap("[1]"); }

#[test]
fn w13j_inherited_exhaustion_names_the_blocked_shape_and_prior_read() {
    for domain in ["range(1, 2)", "[1]"] { for eager in [true, false] { for bound in [9000, 3] {
        let details = if eager { table("extra").replace("lane, at, id", "lane, at") } else { table("extra") };
        let source = format!("{}{}fn preview():\n  return merge extra first 2 by byLane:\n    [lane] for lane in {domain}\nquery feed(c: cursor ?, q: text <=100):\n  page = msgs[0] after c first 1 by byLane\n  spent = count(extra[0] first {bound} by byLane)\n  return page {{ id, preview: preview() }}\n", table("msgs"), details);
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
        rows.extend((0..9000).map(|n| extra(n, 0)));
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let first = q("feed", ctx(None)).unwrap();
            if bound == 9000 {
                assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
                assert!(ids(&first).is_empty());
                let cursor = first.next.expect("retry a's skipped lanes");
                let position = decode_cursor(&Schema::default(), &cursor).unwrap();
                assert!(position.inclusive);
                assert_eq!(position.values, [Value::Int(0), Value::Id("a".into())]);
                let refusal = q("feed", ctx(Some(cursor))).unwrap_err();
                assert_eq!(refusal.code, "E_SHAPE_EXCEEDS_METER");
                assert_eq!(refusal.message, "E_SHAPE_EXCEEDS_METER: the returned shape at programs.feed.0 cannot finish: the 8,192-row meter was spent at programs.feed.1 before it ran; bound that read (`first N`/`last N`) or move the shape out of the returned shape");
                assert_eq!(refusal.guide.as_deref(), Some("reads"));
            } else {
                // The truncated prelude count stays incomplete, but no longer starves either shape.
                assert_eq!((first.complete, first.cut), (false, None));
                assert_eq!(ids(&first), ["a"]);
                assert_eq!(first.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), 2);
                let second = q("feed", ctx(Some(first.next.expect("the bounded prelude leaves room for a's shape")))).unwrap();
                assert_eq!(ids(&second), ["b"]);
                assert_eq!(second.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), 2);
                assert!(!second.complete && second.cut.is_none() && second.next.is_none());
            }
        });
    } } }
}

const LOOP_SELECTED: &str = "  selected = (page { id, preview: [] }) if q = 'raw' else ignored\n  for i in range(0, 1):\n    selected = (page { id, preview: [] }) if q = 'raw' else ignored\n";

#[test]
fn w13h_loop_carried_record_keeps_owner_position_and_rows() {
    for raw in [true, false] {
        conditional_value_return(&format!("{LOOP_SELECTED}  return {{ page: selected, shaped: ignored }}"), raw);
    }
}

#[test]
fn w13h_loop_carried_page_keeps_partial_rows_without_an_owner() {
    for raw in [true, false] { conditional_value_return_owner(&format!("{LOOP_SELECTED}  return selected"), raw, false, |_, _| {}); }
}

#[test]
fn w13h_loop_exits_keep_main_ownership_without_trimming() {
    for raw in [true, false] { for exit in ["break", "continue", "return { page: selected, shaped: ignored }"] {
        let form = format!("{LOOP_SELECTED}    if q = 'raw':\n      {exit}\n    selected = ignored\n  return {{ page: selected, shaped: ignored }}");
        conditional_value_return_owner(&form, raw, !(raw && exit.starts_with("return")), |_, _| {});
    } }
}

#[test]
fn w13h_multiple_backedges_keep_the_sibling_raw_position() {
    for raw in [true, false] {
        conditional_value_return("  selected = ignored\n  previous = ignored\n  for i in range(0, 2):\n    selected = previous\n    previous = (page { id, preview: [] }) if q = 'raw' else ignored\n  return { page: selected, shaped: ignored }", raw);
    }
}

#[test]
fn w13h_loop_same_shape_keeps_partial_rows_without_an_owner() {
    auxiliary_return_cut_owner("  selected = ignored\n  for i in range(0, 2):\n    selected = ignored if q = 'raw' else ignored\n  return selected", false, true, false);
}

// A known sibling can retain main's cursor even when another value is unowned.
#[test]
fn w13h_unknown_sibling_and_field_alias_keep_the_unique_owner() {
    for raw in [true, false] {
        conditional_value_return("  mystery = { inner: page } if q = 'raw' else null\n  alias = mystery\n  known = ignored if q = 'raw' else ignored\n  return { mystery: alias.inner, page: known, shaped: ignored }", raw);
    }
}

#[test]
fn w13h_container_transport_never_erases_a_possible_raw_page() {
    for setup in [
        "  bag = [page]\n  alias = bag",
        "  bag = []\n  bag = bag + [page]\n  alias = bag",
        "  bag = [page]\n  alias = first(bag)",
        "  bag = [page]\n  alias = page\n  for value in bag:\n    alias = value",
    ] {
        conditional_value_return(&format!("{setup}\n  return {{ mystery: alias, page: ignored, shaped: ignored }}"), false);
    }
}

#[test]
fn w13h_loop_unknown_record_keeps_the_sibling_owner() {
    for raw in [true, false] {
        conditional_value_return("  box = { inner: page } if q = 'raw' else null\n  for i in range(0, 3):\n    box = { inner: page } if q = 'raw' else null\n  return { mystery: box, page: ignored, shaped: ignored }", raw);
    }
}

fn optional_page_return(form: &str, raw: bool, record: bool) {
    for cut in [true, false] {
        let prelude = if cut { "  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n" } else { "" };
        let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n{prelude}  page = msgs[0] after c first 1 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n{form}\n", table("msgs"), table("extra"));
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
        if cut { rows.extend((0..8190).map(|n| extra(n, 0))); }
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let mut context = ctx(None);
            context.args.insert("q".into(), Value::String(if raw { "raw" } else { "shaped" }.into()));
            for (request, id) in ["a", "b"].into_iter().enumerate() {
                let answer = q("feed", context.clone()).unwrap();
                let data = if record { answer.data.field("page").unwrap() } else { &answer.data };
                if raw { assert_eq!(data.as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), id); }
                else if record { assert_eq!(*data, Value::Null); }
                else { assert!(data.as_array().unwrap().is_empty()); }
                if record {
                    let shaped = answer.data.field("shaped").unwrap().as_array().unwrap();
                    assert_eq!(shaped.len(), 1, "an unmarked shape keeps its row");
                    assert_eq!(shaped[0].field("id").unwrap().as_str().unwrap(), id);
                }
                assert_eq!((answer.complete, answer.cut), (record && !(cut && request == 0), (cut && request == 0).then_some(ReadCut::Meter)));
                if !record { assert!(answer.next.is_none(), "main leaves page-or-empty unowned"); break; }
                println!("W13h optional device={DEVICE} record={record} raw={raw} cut={cut} request={request}: next={} examined={}", answer.next.is_some(), answer.metered.examined);
                if request == 0 { context.args.insert("c".into(), Value::String(answer.next.expect("a possibly empty page still keeps its owner"))); }
                else { assert!(answer.next.is_none()); }
            }
        });
    }
}

#[test]
fn w13h_page_or_empty_in_either_order_keeps_rows_without_an_owner() {
    for raw in [true, false] { for form in ["  return page if q = 'raw' else []", "  return [] if q != 'raw' else page"] {
        optional_page_return(form, raw, false);
    } }
}

#[test]
fn w13h_page_or_null_record_keeps_owner_and_rows() {
    for raw in [true, false] { for form in [
        "  selected = page if q = 'raw' else null\n  return { page: selected, shaped: ignored }",
        "  selected = null if q != 'raw' else page\n  return { page: selected, shaped: ignored }",
        "  selected = null\n  if q = 'raw':\n    selected = page\n  return { page: selected, shaped: ignored }",
    ] { optional_page_return(form, raw, true); } }
}

#[test]
fn w13h_two_page_loop_keeps_unique_sibling_owner_but_not_two_sites() {
    for cut in [true, false] { for raw in [true, false] { for two_sites in [false, true] {
        let prelude = if cut { "  if c = null:\n    spent = count(extra[0] first 8188 by byLane)\n" } else { "" };
        let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n{prelude}  page = msgs[0] after c first 1 by byLane\n  other = msgs[0] after c first 2 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n  selected = page\n  for i in range(0, 2):\n    selected = page if q = 'raw' else other\n  return {{ page: ignored, mystery: selected{} }}\n", table("msgs"), table("extra"), if two_sites { ", other" } else { "" });
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
        if cut { rows.extend((0..8188).map(|n| extra(n, 0))); }
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let mut context = ctx(None);
            context.args.insert("q".into(), Value::String(if raw { "raw" } else { "shaped" }.into()));
            let first = q("feed", context.clone()).unwrap();
            let page = first.data.field("page").unwrap().as_array().unwrap();
            assert_eq!(page.len(), 1, "an unmarked shape keeps its row");
            assert_eq!(page[0].field("id").unwrap().as_str().unwrap(), "a");
            assert_eq!(first.cut, cut.then_some(ReadCut::Meter));
            if two_sites {
                assert!(first.next.is_none(), "two known returned sites have no unique cursor owner");
                assert!(!first.complete);
            } else {
                context.args.insert("c".into(), Value::String(first.next.expect("the unique known sibling site owns next")));
                let second = q("feed", context).unwrap();
                assert_eq!(second.data.field("page").unwrap().as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), "b");
                assert!(second.complete && second.next.is_none());
            }
        });
    } } }
}

fn check_collector_payload(data: &Value, id: &str) {
    let bag = data.field("mystery").unwrap().as_array().unwrap();
    assert_eq!(bag.len(), 1, "one push per source row");
    let payload = bag[0].field("raw").unwrap_or(&bag[0]).as_array().unwrap();
    assert_eq!(payload.len(), 1);
    assert_eq!(payload[0].field("id").unwrap().as_str().unwrap(), id, "the embedded page also advances without a duplicate or skip");
}

#[test]
fn w13h_collector_wrapping_raw_page_keeps_main_position() {
    conditional_value_return_checked("  bag = []\n  for item in page:\n    bag = bag + [page]\n  return { mystery: bag, page: ignored, shaped: ignored }", false, check_collector_payload);
}

#[test]
fn w13h_collector_wrapping_conditional_page_keeps_main_position() {
    for raw in [true, false] {
        conditional_value_return_checked("  bag = []\n  for item in page:\n    payload = (page { id, preview: [] }) if q = 'raw' else ignored\n    bag = bag + [payload]\n  return { mystery: bag, page: ignored, shaped: ignored }", raw, check_collector_payload);
    }
}

#[test]
fn w13h_collector_shape_embedding_raw_page_keeps_main_position() {
    conditional_value_return_checked("  bag = []\n  for item in page:\n    bag = bag + [item { id, raw: page }]\n  return { mystery: bag, page: ignored, shaped: ignored }", false, check_collector_payload);
}

#[test]
fn w13h_item_and_alias_collectors_keep_partial_rows_without_rewind() {
    for form in [
        "  bag = []\n  for item in ignored:\n    bag = bag + [item]\n  return bag",
        "  bag = []\n  for item in page:\n    bag = bag + [item { id, preview: extra[1] first 2 by byLane }]\n  return bag",
        "  bag = []\n  for item in page:\n    alias = item\n    bag = bag + [alias { id, preview: extra[1] first 2 by byLane }]\n  return bag",
    ] { for cut in [true, false] { auxiliary_return_cut(form, false, cut); } }
    for cut in [true, false] {
        auxiliary_return_cut("  bag = []\n  for item in page:\n    bag = bag + [item]\n  return bag", true, cut);
    }
}

fn record_join_return(other: &str, reverse: bool, assigned: bool) {
    for cut in [true, false] { for raw in [true, false] {
        let prelude = if cut { "  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n" } else { "" };
        let record = "{ page, shaped: ignored }";
        let value = if reverse { format!("{other} if q != 'raw' else {record}") } else { format!("{record} if q = 'raw' else {other}") };
        let tail = if assigned { format!("  selected = {value}\n  return selected") } else { format!("  return {value}") };
        let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n{prelude}  page = msgs[0] after c first 1 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n{tail}\n", table("msgs"), table("extra"));
        let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
        if cut { rows.extend((0..8190).map(|n| extra(n, 0))); }
        rows.extend((0..2).map(|n| extra(n, 1)));
        with_fixture(&source, rows, |q| {
            let mut context = ctx(None);
            context.args.insert("q".into(), Value::String(if raw { "raw" } else { "shaped" }.into()));
            for (request, id) in ["a", "b"].into_iter().enumerate() {
                let answer = q("feed", context.clone()).unwrap();
                if raw {
                    for field in ["page", "shaped"] {
                        let rows = answer.data.field(field).unwrap().as_array().unwrap();
                        assert_eq!(rows.len(), 1, "{other}: raw fallback cannot skip a trimmed row");
                        assert_eq!(rows[0].field("id").unwrap().as_str().unwrap(), id);
                    }
                } else {
                    match other {
                        "null" => assert_eq!(answer.data, Value::Null),
                        "[]" => assert!(answer.data.as_array().unwrap().is_empty()),
                        "ignored" | "page" => assert_eq!(ids(&answer), [id]),
                        "c" => assert_eq!(answer.data, context.args["c"]),
                        _ => unreachable!(),
                    }
                }
                assert_eq!((answer.complete, answer.cut), (false, (cut && request == 0).then_some(ReadCut::Meter)));
                assert!(answer.next.is_none(), "main leaves a structural conditional unowned");
                println!("W13h record join device={DEVICE} other={other} reverse={reverse} assigned={assigned} raw={raw} cut={cut} request={request}: next={} examined={}", answer.next.is_some(), answer.metered.examined);
                break;
            }
        });
    } }
}

#[test]
fn w13h_record_or_null_keeps_its_value_without_an_owner() {
    for reverse in [false, true] { for assigned in [false, true] { record_join_return("null", reverse, assigned); } }
}

// Round 9 refuses these row-containing joins before continuation ownership
// can be inferred. Same-kind and nullable continuation controls stay above.
#[test]
fn w13h_incompatible_record_alternatives_are_refused_at_the_join() {
    for other in ["[]", "page", "ignored", "c"] {
        for reverse in [false, true] { for assigned in [false, true] {
            let record = "{ page, shaped: ignored }";
            let value = if reverse { format!("{other} if q != 'raw' else {record}") } else { format!("{record} if q = 'raw' else {other}") };
            let tail = if assigned { format!("  selected = {value}\n  return selected") } else { format!("  return {value}") };
            incompatible_return(&tail);
        } }
    }
    for tail in [
        "  selected = { mystery: [page] } if q = 'raw' else page\n  return selected",
        "  selected = { mystery: [page] } if q = 'raw' else page\n  return { mystery: selected, page: ignored, shaped: ignored }",
    ] { incompatible_return(tail); }
}

fn incompatible_return(tail: &str) {
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  page = msgs[0] after c first 1 by byLane\n  ignored = page {{ id, preview: extra[1] first 2 by byLane }}\n{tail}\n", table("msgs"), table("extra"));
    let result = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(result.diagnostics.iter().any(|d| d.code == "E_QUARRY_SHAPE_JOIN" && d.rewrite.contains("q")), "{:?}", result.diagnostics);
}

#[test]
fn w13h_finite_helper_composition_terminates() {
    let source = format!("{}fn wrap(previous: json <=100000 ?, payload: json <=100000):\n  return {{ previous, payload }}\nquery feed(c: cursor ?, q: text <=100):\n  page = msgs[0] after c first 1 by byLane\n  wrapped = null\n  for i in range(0, 1):\n    wrapped = wrap(wrapped, page)\n  return {{ page, wrapped }}\n", table("msgs"));
    println!("W13h termination: entering compile and plan device={DEVICE}");
    with_fixture(&source, vec![row("a", 0, 0, ""), row("b", 0, 1, "")], |q| {
        let first = q("feed", ctx(None)).unwrap();
        assert_eq!(first.data.field("page").unwrap().as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), "a");
        let second = q("feed", ctx(first.next)).unwrap();
        assert_eq!(second.data.field("page").unwrap().as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), "b");
        assert!(second.complete && second.next.is_none());
    });
}

#[test]
fn w13h_inline_returned_read_retries_the_starved_preview() {
    let source = format!("{}{}query feed(c: cursor ?, q: text <=100):\n  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n  return msgs[0] after c first 1 by byLane {{ id, preview: extra[1] first 2 by byLane }}\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
    rows.extend((0..8190).map(|n| extra(n, 0)));
    rows.extend((0..2).map(|n| extra(n, 1)));
    with_fixture(&source, rows, |q| {
        let first = q("feed", ctx(None)).unwrap();
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        assert!(ids(&first).is_empty());
        let second = q("feed", ctx(Some(first.next.unwrap()))).unwrap();
        assert_eq!(ids(&second), ["a"]);
        assert_eq!(second.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().len(), 2);
        let third = q("feed", ctx(Some(second.next.unwrap()))).unwrap();
        assert_eq!(ids(&third), ["b"]);
        assert!(third.complete && third.next.is_none());
    });
}

#[test]
fn w13h_rescan_collector_keeps_partial_shapes_and_main_position() {
    conditional_value_return_observations("  bag = []\n  for item in page:\n    bag = bag + [msgs[0] after c first 1 by byLane]\n  return { mystery: bag, page: ignored, shaped: ignored }", false, true, false, |data, _| {
        let bag = data.field("mystery").unwrap().as_array().unwrap();
        assert_eq!(bag.len(), 1);
        let payload = bag[0].as_array().unwrap();
        // On the cut request the nested re-scan is itself starved; its containing row stays.
        if data.field("page").unwrap().as_array().unwrap()[0].field("id").unwrap().as_str().unwrap() == "a"
            && data.field("shaped").unwrap().as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().is_empty() {
            assert!(payload.is_empty());
        } else { assert_eq!(payload.len(), 1); }
    });
}

#[test]
fn w13h_helper_returned_shape_keeps_partial_rows_and_main_ownership() {
    let source = format!("{}{}fn shaped(c: cursor ?):\n  return msgs[0] after c first 1 by byLane {{ id, preview: extra[1] first 2 by byLane }}\nquery feed(c: cursor ?, q: text <=100):\n  if c = null:\n    spent = count(extra[0] first 8190 by byLane)\n  return shaped(c)\n", table("msgs"), table("extra"));
    let mut rows = vec![row("a", 0, 0, ""), row("b", 0, 1, "")];
    rows.extend((0..8190).map(|n| extra(n, 0)));
    rows.extend((0..2).map(|n| extra(n, 1)));
    with_fixture(&source, rows, |q| {
        let first = q("feed", ctx(None)).unwrap();
        assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
        assert_eq!(ids(&first), ["a"]);
        assert!(first.data.as_array().unwrap()[0].field("preview").unwrap().as_array().unwrap().is_empty());
        let second = q("feed", ctx(Some(first.next.expect("main's inlined helper owner")))).unwrap();
        assert_eq!(ids(&second), ["b"]);
        assert!(second.complete && second.next.is_none());
    });
}
