#[path = "common/helper_pages.rs"]
mod fixture;

use snapback4_core::engine::{Context, Engine};
use snapback4_core::Value;
use std::collections::BTreeMap;

fn engine() -> Engine {
    engine_with_rows(12)
}

fn engine_with_rows(count: usize) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), fixture::SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(fixture::rows().into_iter().take(count)).unwrap();
    engine
}

macro_rules! page_test {
    ($test:ident, $op:literal) => {
        #[test]
        fn $test() {
            let mut engine = engine();
            fixture::check_pages($op, |cursor| {
                let args = BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]);
                engine.query($op, Context::new("dev:alice", args)).unwrap()
            });
        }
    };
}

page_test!(plain_page_continues, "plain");
page_test!(accumulated_helper_page_continues, "withAccumulated");
page_test!(early_return_in_for_keeps_page, "withEarly");
page_test!(early_return_in_if_else_if_keeps_page, "withConditional");
page_test!(nested_returning_helper_keeps_page, "withNested");
page_test!(returning_helper_keeps_merge_page, "withMerge");
page_test!(returning_helper_keeps_matching_page, "withMatching");
page_test!(auxiliary_scan_does_not_reclassify_the_final_page, "withAuxiliary");

#[test]
fn lost_continuation_is_incomplete() {
    for count in [5, 12] {
        let mut engine = engine_with_rows(count);
        if count == 5 {
            fixture::check_full_final_page(engine.query("withEarly", Context::new("dev:alice", BTreeMap::new())).unwrap());
        }
        fixture::check_interrupted(engine.query("interrupted", Context::new("dev:alice", BTreeMap::new())).unwrap());
    }
}

#[test]
fn program_return_still_exits_nested_loops_without_a_cursor() {
    fixture::check_interrupted(engine().query("returnedFromLoop", Context::new("dev:alice", BTreeMap::new())).unwrap());
}
