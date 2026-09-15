use snapback4_core::Engine;
#[path = "../common/merge_cursor.rs"] mod fixture;

fn engine(cross: bool, uniform: bool, rows: Vec<(String, snapback4_core::Value)>) -> Engine {
    let bound = fixture::bound(&fixture::source(cross, uniform));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows).unwrap();
    engine
}

fn cut(cross: bool) {
    let mut engine = engine(cross, false, fixture::seed(cross, fixture::CEILING + 1, Some(15)));
    fixture::check_cut(|cursor| engine.query("feed", fixture::context(cursor)).unwrap());
}

#[test] fn cross_table_hidden_cut_never_skips() { cut(true); }
#[test] fn single_table_hidden_cut_never_skips() { cut(false); }

#[test]
fn uniform_eager_and_lazy_cuts_never_skip() {
    for cross in [false, true] {
        let bound = fixture::bound(&fixture::expiring_source(cross));
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed(fixture::expired_seed(cross)).unwrap();
        fixture::check_cut(|cursor| engine.query("feed", fixture::context(cursor)).unwrap());
    }
}

#[test]
fn hidden_absent_wire_pairs_near_the_examined_ceiling() {
    let mut pairs = 0;
    for cross in [false, true] {
        // With no competing row, and with a readable row below the returned
        // key: neither data nor cursor may reveal the intervening hidden run.
        for competing in [None, Some(5)] {
            let mut absent = engine(cross, false, fixture::seed(cross, 0, competing));
            let expected = fixture::server_wire(&absent.query("feed", fixture::context(None)).unwrap());
            for hidden in [fixture::CEILING - 2, fixture::CEILING - 1, fixture::CEILING, fixture::CEILING + 1] {
                let mut hidden_world = engine(cross, false, fixture::seed(cross, hidden, competing));
                let page = hidden_world.query("feed", fixture::context(None)).unwrap();
                assert_eq!(fixture::server_wire(&page), expected, "cross={cross} hidden={hidden} competing={competing:?}");
                pairs += 1;
            }
        }
    }
    println!("merge server wire pairs: {pairs}");
}

#[test]
fn equal_ordering_keys_continue_and_projection_copies_deduplicate() {
    for cross in [false, true] {
        let mut engine = engine(cross, true, fixture::equal_rows(cross));
        fixture::check_equal(|cursor| engine.query("feed", fixture::context(cursor)).unwrap());
    }
}

#[test]
fn cursor_replays_across_generations_only_with_the_same_descriptor() {
    let mut engine = engine(true, true, fixture::equal_rows(true));
    let first = engine.query("feed", fixture::context(None)).unwrap();
    let generation = engine.generation();
    let next_source = fixture::source(true, true).replace("  owner: principal", "  owner: principal\n  label: text <=10 default 'new'");
    let next = fixture::bound(&next_source);
    engine.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.generation(), generation + 1);
    let second = engine.query("feed", fixture::context(first.next.clone())).unwrap();
    assert_eq!(fixture::ids(&second), ["y"]);
    let changed = fixture::bound(&next_source.replace("last 1 by", "first 1 by"));
    engine.adopt(changed.schema, changed.programs.into_iter().map(|p| p.program)).unwrap();
    let refusal = engine.query("feed", fixture::context(first.next)).unwrap_err();
    assert_eq!(refusal.code, "E_INPUT");
    assert!(refusal.message.contains("cursor token describes a different table, index, order, or suffix"), "{refusal:?}");
}
