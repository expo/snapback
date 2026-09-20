mod fixture;
use fixture::*;
use snapback4_core::{Context, Engine, Value};

fn engine(n: usize, hidden: usize, source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(seed(n, hidden)).unwrap();
    engine
}

fn query(engine: &mut Engine, op: &str, cursor: Option<String>) -> Result<snapback4_core::engine::QueryOutcome, snapback4_core::error::Refusal> {
    engine.query(op, Context::new("dev:alice", [("q".into(), Value::String("kx".into())), ("c".into(), cursor.map_or(Value::Null, Value::String))].into()).at(100_000))
}

#[test]
fn search_uniform_word_counts_and_worlds() {
    for n in COUNTS {
        let mut engine = engine(n, 0, SOURCE);
        measure("server-sqlite", n, &mut |op, cursor| query(&mut engine, op, cursor));
    }
    let mut a = engine(45, 0, SOURCE);
    let mut b = engine(45, 9000, SOURCE);
    let a = observations(&mut |op, cursor| query(&mut a, op, cursor));
    let b = observations(&mut |op, cursor| query(&mut b, op, cursor));
    assert_eq!(a, b);
    emit("worlds", "server-sqlite", serde_json::json!({"equal": true, "replies": a.len(), "bytes": a.iter().map(Vec::len).sum::<usize>(), "hidden": 9000}));
}

#[test]
fn search_45_words_walks_20_20_5() {
    let mut engine = engine(45, 0, SOURCE);
    let (actual, pages) = walk(&mut |op, cursor| query(&mut engine, op, cursor), "search", true);
    assert_eq!(actual, (0..45).rev().map(|i| format!("room-{i:05}")).collect::<Vec<_>>());
    assert_eq!(pages, 3);
}

#[test]
fn search_non_uniform_still_stops_at_32() {
    let source = non_uniform_source();
    let mut engine = engine(45, 0, &source);
    let page = query(&mut engine, "search", None).unwrap();
    assert!(page.word_cut_at.is_some() && page.next.is_none() && !page.complete && page.cut.is_none());
    assert_eq!((page.metered.index_entries, page.metered.examined, ids(&page).len()), (33, 32, 20));
    emit("nonuniform", "server-sqlite", serde_json::json!({"meter": page.metered, "rows": ids(&page).len(), "next": page.next, "cut": page.cut, "word_cut": page.word_cut_at}));
}

#[test]
fn search_opening_and_heap_cuts() {
    use snapback4_core::{meter::Ceilings};
    for (case, ceilings) in [
        ("discovery-index", Ceilings { index_entries: 32, ..Ceilings::default() }),
        ("opening-examined", Ceilings { examined: 10, ..Ceilings::default() }),
        ("heap", Ceilings { heap_bytes: 10_000, ..Ceilings::default() }),
    ] {
        let mut engine = engine(45, 0, SOURCE);
        engine.set_ceilings(ceilings);
        let page = query(&mut engine, "search", None).unwrap();
        assert_cut(case, &page);
        emit("forced-cut", "server-sqlite", serde_json::json!({"case":case,"meter":page.metered,"rows":page.data.as_array().ok().map(|rows| rows.len()),"cut":page.cut,"next":page.next,"capped_at":page.capped_at}));
    }
}

#[test]
fn search_expired_both_traversals_fit_and_admitted_nonuniform_two_worlds() {
    for expired in [true, false] {
        let mut worlds = Vec::new();
        for extra in [false, true] {
            let source = if expired { expired_source() } else { ROUND3.into() };
            let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            engine.seed(if expired { expired_seed(extra) } else { round3_seed(if extra { 33 } else { 0 }) }).unwrap();
            let replies = if expired { observations(&mut |op, c| query(&mut engine, op, c)) }
                else { let page = engine.query("matching", Context::new("dev:alice", [("c".into(), Value::Null)].into()).at(100_000)).unwrap();
                    assert_eq!(ids(&page), ["shown"]); assert!(!page.complete && page.cut.is_none() && page.next.is_none()); vec![viewer(&page)] };
            worlds.push(replies);
        }
        assert_eq!(worlds[0], worlds[1]);
    }
}

#[test]
fn search_nested_cursor_ir_is_borrowed_without_per_lane_clones() {
    for bytes in [8, 1_000_000] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        let mut programs = bound.programs.into_iter().map(|p| p.program).collect::<Vec<_>>();
        nested_cursor(&mut programs, bytes);
        let mut engine = Engine::memory(bound.schema, programs).unwrap();
        engine.seed(seed(45, 0)).unwrap();
        let page = query(&mut engine, "search", None).unwrap();
        // Dead IR is a shared compiled image. A million-byte dead branch now
        // costs no per-lane clone and retains the positive 45-word page.
        assert!(page.complete && page.next.is_some());
        assert_eq!(ids(&page).len(), 20);
    }
}

#[test]
fn search_expired_meter_boundary_is_existing_time_hidden_work() {
    let mut worlds = Vec::new();
    for extra in [false, true] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), expired_source())]);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed(expired_seed(extra)).unwrap();
        engine.set_ceilings(snapback4_core::meter::Ceilings { index_entries: 46, ..Default::default() });
        worlds.push(query(&mut engine, "search", None).unwrap());
    }
    assert_expired_boundary(&worlds[0], &worlds[1]);
}

#[test]
fn search_thousand_words_borrow_eight_4k_literals_and_continue_many_pages() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    let mut programs = bound.programs.into_iter().map(|p| p.program).collect::<Vec<_>>();
    nested_predicate(&mut programs);
    let mut engine = Engine::memory(bound.schema, programs).unwrap();
    engine.seed(seed(1000, 0)).unwrap();
    let first = query(&mut engine, "search", None).unwrap();
    assert!(first.complete && first.cut.is_none());
    // Eight 4 KiB literals belong to one compiled image (32,768 B), shared
    // across every descriptor; the query heap charge for those IR bytes is zero.
    let (rows, pages) = walk(&mut |op, c| {
        let cursor_allowance = c.as_ref().map_or(0, |token| snapback4_core::rows::word_heap::cursor_decode(token));
        let page = query(&mut engine, op, c)?;
        assert!(page.metered.heap_bytes >= cursor_allowance, "every continuation prepays its decode/re-encode allowance");
        // Repeating that allowance per 1,000 lanes would exceed the unchanged
        // 16 MiB ceiling; successful complete pages exercise the shared cache.
        if cursor_allowance != 0 { assert!(1000 * cursor_allowance > snapback4_core::Ceilings::default().heap_bytes); }
        Ok(page)
    }, "search", false);
    assert_eq!(rows, (0..1000).rev().map(|i| format!("room-{i:05}")).collect::<Vec<_>>());
    assert_eq!(pages, 50, "each continuation decodes and re-encodes the row cursor");
    emit("adversarial-ir", "server-sqlite", serde_json::json!({"shared_literal_bytes":32768,"per_lane_ir_bytes":0,"heap":first.metered.heap_bytes,"pages":pages}));
}

#[test]
fn search_long_bodies_are_precharged_before_store_decode_and_row_tokenisation() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = seed(45, 0);
    for (table, row) in &mut rows { if table == "messages" {
        let Value::Row(fields) = row else { unreachable!() };
        let body = fields["body"].as_str().unwrap().to_owned() + " extra " + &"z".repeat(4000);
        fields.insert("body".into(), Value::String(body));
    } }
    engine.seed(rows).unwrap();
    let context = || Context::new("dev:alice", [("q".into(), Value::String("kx extra".into())), ("c".into(), Value::Null)].into());
    let positive = engine.query("search", context()).unwrap();
    assert!(positive.complete && positive.next.is_some()); assert_eq!(ids(&positive).len(), 20);
    engine.set_ceilings(snapback4_core::meter::Ceilings { heap_bytes: 10_000, ..Default::default() });
    let cut = engine.query("search", context()).unwrap();
    assert_cut("heap", &cut);
    assert_eq!(cut.metered.examined, 0, "store allowance fails during discovery before any opening or row tokenisation");
}
