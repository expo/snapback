use super::{with_fixture, DEVICE};
use snapback4_core::{Context, Value, engine::ReadCut, ir::{Builtin, Expr, Stmt}, value::object};
use std::collections::BTreeSet;

const TABLE: &str = "table members:\n  roomId: id\n  principal: principal\n  by byPrincipalRoom: principal, roomId, id\n  read <- .principal = viewer\n  sync\n";
const PAGE: &str = "members[viewer] after c first 20 by byPrincipalRoom";

pub fn compile(source: &str) -> snapback4_lang::Bound {
    let mut bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // Array Concat is an IR builtin, not a Quarry function. Bind its two
    // page operands normally, then exercise that existing builtin directly.
    for program in &mut bound.programs {
        if program.program.name == "concatControl" {
            let Some(Stmt::Return(value @ Expr::Object(_))) = program.program.body.last_mut() else { panic!("concat operands"); };
            let Expr::Object(fields) = value else { unreachable!() };
            *value = Expr::Builtin { builtin: Builtin::Concat, args: vec![fields["page"].clone(), fields["other"].clone()] };
        }
    }
    bound
}

fn context(cursor: Option<String>) -> Context {
    Context::new("dev:alice", [("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))].into()).at(100_000)
}

fn rows(count: usize) -> Vec<(String, Value)> {
    (0..count).map(|n| ("members".into(), object([
        ("id", Value::Id(format!("m{n:03}"))), ("roomId", Value::Id(format!("r{:03}", n / 3))),
        ("principal", Value::Id("dev:alice".into())),
    ]))).collect()
}

fn walk(expression: &str, grouped: bool, descending: bool) {
    // Inline source, a once-bound source, and a once-bound helper result.
    for binding in ["inline", "page", "result"] {
        let body = match binding {
            "inline" => format!("  return {}\n", expression.replace("page", PAGE)),
            "page" => format!("  page = {PAGE}\n  return {expression}\n"),
            _ => format!("  page = {PAGE}\n  result = {expression}\n  return result\n"),
        };
        let source = format!("{TABLE}\nquery feed(c: cursor ?):\n{body}");
        with_fixture(&source, rows(45), |q| {
            let mut cursor = None;
            let mut seen = BTreeSet::new();
            for (page, size) in [20, 20, 5].into_iter().enumerate() {
                let answer = q("feed", context(cursor)).unwrap();
                let top = answer.data.as_array().unwrap();
                let emitted = if grouped {
                    top.iter().flat_map(|group| {
                        let items = group.field("items").unwrap().as_array().unwrap();
                        assert!(!items.is_empty());
                        for item in items { assert_eq!(item.field("roomId").unwrap(), group.field("key").unwrap()); }
                        items.iter()
                    }).collect::<Vec<_>>()
                } else { top.iter().collect() };
                let ids = emitted.iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
                println!("W13i device={DEVICE} {expression}/{binding} page={}: rows={} groups={} complete={} cut={} next={}", page + 1,
                    ids.len(), if grouped { top.len() } else { 0 }, answer.complete, serde_json::to_string(&answer.cut).unwrap(), answer.next.is_some());
                assert_eq!(ids.len(), size);
                assert_eq!(answer.next.is_some(), page < 2, "{expression}/{binding}: {answer:?}");
                assert!(answer.complete, "{expression}/{binding}: {answer:?}");
                assert_eq!(answer.cut, None);
                let mut expected = (page * 20..page * 20 + size).map(|n| format!("m{n:03}")).collect::<Vec<_>>();
                if descending { expected.reverse(); }
                assert_eq!(ids, expected, "sort only reorders this page; next follows the source index");
                for id in ids { assert!(seen.insert(id), "duplicate row"); }
                cursor = answer.next;
            }
            assert_eq!(seen.len(), 45);
            assert!(cursor.is_none());
        });
    }
}

#[test]
fn w13i_group_carries_the_membership_page() { walk("group(page, 'roomId')", true, false); }

#[test]
fn w13i_sort_carries_the_membership_page() { walk("sort(page, '-id')", false, true); }

#[test]
fn w13i_nested_group_sort_carries_the_membership_page() { walk("group(sort(page, '-id'), 'roomId')", true, true); }

fn helper_sites(expression: &str) {
    for binding in ["inline", "page", "result"] {
        let body = match binding {
            "inline" => format!("  return {}\n", expression.replace("page", PAGE)),
            "page" => format!("  page = {PAGE}\n  return {expression}\n"),
            _ => format!("  page = {PAGE}\n  result = {expression}\n  return result\n"),
        };
        let source = format!("{TABLE}\nquery feed(c: cursor ?):\n  unused = {PAGE}\n{body}");
        let bound = compile(&source);
        let program = &bound.programs[0].program;
        let scans = snapback4_core::ir::scans(program);
        assert_eq!(scans.len(), 2);
        let expected = BTreeSet::from([scans[1].site.clone()]);
        let sites = snapback4_core::engine::returned_page_sites(program);
        println!("W13iR1 {expression}/{binding}: sites={sites:?}; expected={expected:?}");
        assert_eq!(sites, expected, "only the returned helper's page, never the auxiliary page");
    }
}

#[test]
fn w13ir1_diagnostics_group_sites() { helper_sites("group(page, 'roomId')"); }

#[test]
fn w13ir1_diagnostics_sort_sites() { helper_sites("sort(page, '-id')"); }

#[test]
fn w13ir1_diagnostics_nested_sites() { helper_sites("group(sort(page, '-id'), 'roomId')"); }

#[test]
fn w13ir1_diagnostics_nonowners_have_no_sites() {
    for expression in ["group(other, 'roomId')", "min(page, page)", "max(page, page)", "{ a: group(page, 'roomId'), b: sort(second, '-id') }"] {
        let source = format!("{TABLE}\nquery feed(c: cursor ?):\n  page = {PAGE}\n  second = {PAGE}\n  other = [{{ id: 'other', roomId: 'other' }}]\n  return {expression}\n");
        let bound = compile(&source);
        let sites = snapback4_core::engine::returned_page_sites(&bound.programs[0].program);
        println!("W13iR1 {expression}: sites={sites:?}");
        assert!(sites.is_empty(), "{expression}: {sites:?}");
    }
}

#[test]
fn w13i_original_probe_walks_direct_and_merged_pages_to_completion() {
    let source = include_str!("../../../../../benchmarks/runs/2026-09-17-snapback4-bounds-probes/group-drops-next/snapback/schema.q")
        .replace("  online only", "  sync");
    let mut seeded = Vec::new();
    for room in ["r1", "r2"] {
        seeded.push(("members".into(), object([("id", Value::Id(format!("{room}-alice"))), ("roomId", Value::Id(room.into())), ("principal", Value::Id("dev:alice".into()))])));
        for m in 0..5 {
            seeded.push(("messages".into(), object([("id", Value::Id(format!("{room}-m{m}"))), ("roomId", Value::Id(room.into())),
                ("body", Value::String(format!("hello {m}"))), ("at", Value::Int(1000 + m * 10 + if room == "r2" { 5 } else { 0 }))])));
        }
    }
    with_fixture(&source, seeded, |q| {
        for name in ["plain", "grouped", "groupedDirect", "both", "sorted", "shaped"] {
            let mut cursor = None;
            let mut seen = BTreeSet::new();
            let expected = if name == "groupedDirect" { 5 } else { 10 };
            for request in 0..3 {
                let mut ctx = context(cursor);
                if name == "groupedDirect" { ctx.args.insert("roomId".into(), Value::Id("r1".into())); }
                let answer = q(name, ctx).unwrap();
                let data = if name == "both" { answer.data.field("page").unwrap() } else { &answer.data };
                let top = data.as_array().unwrap();
                let emitted = if name.starts_with("grouped") {
                    top.iter().flat_map(|group| group.field("messages").unwrap().as_array().unwrap().iter()).collect::<Vec<_>>()
                } else { top.iter().collect() };
                assert_eq!(emitted.len(), (expected - seen.len()).min(4), "{name} request {request}");
                for row in emitted { assert!(seen.insert(row.field("id").unwrap().as_str().unwrap().to_owned())); }
                assert_eq!(answer.next.is_some(), seen.len() < expected, "{name} request {request}: {answer:?}");
                assert!(answer.complete && answer.cut.is_none(), "{name}: {answer:?}");
                cursor = answer.next;
                if cursor.is_none() { break; }
            }
            assert_eq!(seen.len(), expected, "{name}");
            assert!(cursor.is_none());
        }
    });
}

#[test]
fn w13i_helpers_preserve_a_meter_cut_and_continue_its_filtered_source() {
    let mut source = TABLE.to_owned();
    for (name, value) in [("plain", "page"), ("grouped", "group(page, 'roomId')"), ("sorted", "sort(page, 'id')")] {
        source.push_str(&format!("\nquery {name}(c: cursor ?):\n  page = {PAGE} where .roomId != .roomId\n  return {value}\n"));
    }
    with_fixture(&source, rows(8200), |q| {
        for name in ["plain", "grouped", "sorted"] {
            let first = q(name, context(None)).unwrap();
            assert!(first.data.as_array().unwrap().is_empty());
            assert_eq!((first.complete, first.cut), (false, Some(ReadCut::Meter)));
            let second = q(name, context(Some(first.next.expect("continue the visible filtered frontier")))).unwrap();
            assert!(second.data.as_array().unwrap().is_empty());
            assert!(second.complete && second.cut.is_none() && second.next.is_none());
        }
    });
}

#[test]
fn w13i_dropping_helpers_and_unrelated_values_have_no_owner() {
    for expression in ["first(page)", "last(page)", "at(page, 5)", "slice(page, 0, 5)", "min(page, page)", "max(page, page)", "group(slice(page, 0, 5), 'roomId')", "group(other, 'roomId')"] {
        let source = format!("{TABLE}\nquery feed(c: cursor ?):\n  page = {PAGE}\n  other = [{{ id: 'other', roomId: 'other' }}]\n  return {expression}\n");
        with_fixture(&source, rows(45), |q| {
            let answer = q("feed", context(None)).unwrap();
            assert!(!answer.complete && answer.next.is_none() && answer.cut.is_none(), "{expression}: {answer:?}");
            assert_ne!(answer.data, Value::Null, "the helper still returns its value");
        });
    }
    let source = format!("{TABLE}\nquery concatControl(c: cursor ?):\n  page = {PAGE}\n  other = {PAGE}\n  return {{ page, other }}\n");
    with_fixture(&source, rows(45), |q| {
        let answer = q("concatControl", context(None)).unwrap();
        assert_eq!(answer.data.as_array().unwrap().len(), 40);
        assert!(!answer.complete && answer.next.is_none() && answer.cut.is_none());
    });
}

#[test]
fn w13i_group_does_not_extend_the_returned_shape_mark() {
    let source = format!("{TABLE}\ntable extra:\n  n: int\n  public 'shape control'\n  sync public\n\nquery marked(c: cursor ?):\n  spent = count(extra[] first 8190 by byId)\n  return {PAGE} {{ id, roomId, details: extra[] first 2 by byId }}\n\nquery grouped(c: cursor ?):\n  spent = count(extra[] first 8190 by byId)\n  return group({PAGE} {{ id, roomId, details: extra[] first 2 by byId }}, 'roomId')\n");
    let bound = compile(&source);
    assert_eq!(bound.programs.iter().find(|p| p.program.name == "marked").unwrap().program.returned_shapes.len(), 1);
    assert!(bound.programs.iter().find(|p| p.program.name == "grouped").unwrap().program.returned_shapes.is_empty());
    let mut seeded = rows(1);
    seeded.extend((0..8190).map(|n| ("extra".into(), object([("id", Value::Id(format!("x{n:05}"))), ("n", Value::Int(n))]))));
    with_fixture(&source, seeded, |q| {
        let marked = q("marked", context(None)).unwrap();
        assert!(marked.data.as_array().unwrap().is_empty());
        assert_eq!((marked.complete, marked.cut), (false, Some(ReadCut::Meter)));
        assert!(marked.next.is_some(), "only the marked shape rewinds the unfinished row");
        let grouped = q("grouped", context(None)).unwrap();
        let groups = grouped.data.as_array().unwrap();
        assert_eq!(groups.len(), 1);
        let items = groups[0].field("items").unwrap().as_array().unwrap();
        assert_eq!(items.len(), 1, "wrapping a shape keeps today's unfinished row");
        assert!(items[0].field("details").unwrap().as_array().unwrap().len() < 2);
        assert_eq!((grouped.complete, grouped.cut), (false, Some(ReadCut::Meter)));
        assert!(grouped.next.is_none(), "the exhausted source has no next; the unmarked shape does not rewind");
    });
}

#[test]
fn w13i_cursor_notes_keep_their_existing_triggers() {
    let source = format!("{TABLE}\nquery plain():\n  return members[viewer] first 20 by byPrincipalRoom\nquery grouped():\n  return group(members[viewer] first 20 by byPrincipalRoom, 'roomId')\nquery sorted():\n  return sort(members[viewer] first 20 by byPrincipalRoom, 'id')\nquery cursor(c: cursor ?):\n  return group({PAGE}, 'roomId')\n");
    let bound = compile(&source);
    let notes = bound.notes.iter().filter(|note| note.code == "N_NO_CURSOR").collect::<Vec<_>>();
    assert_eq!(notes.len(), 1, "{:?}", bound.notes);
    assert!(notes[0].message.starts_with("query plain returns a page"));
    assert_eq!(bound.notes.iter().map(|note| note.code.as_str()).collect::<Vec<_>>(), ["N_NO_HORIZON", "N_NO_CURSOR"]);
    for name in ["grouped", "sorted"] {
        let program = &bound.programs.iter().find(|p| p.program.name == name).unwrap().program;
        assert!(snapback4_core::engine::returned_page_sites(program).is_empty(), "cursorless {name} stays outside the helper walk");
    }
}
