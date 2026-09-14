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
page_test!(returning_helper_inside_merge_setup_keeps_page, "withMergeSetup");
page_test!(returning_helper_keeps_matching_page, "withMatching");
page_test!(auxiliary_lost_page_is_incomplete, "withAuxiliary");

macro_rules! collector_test {
    ($test:ident, $count:literal) => {
        #[test]
        fn $test() {
            fixture::check_collector(engine_with_rows($count).query("interrupted", Context::new("dev:alice", BTreeMap::new())).unwrap(), $count);
        }
    };
}

collector_test!(interrupted_1, 1);
collector_test!(interrupted_2, 2);
collector_test!(interrupted_3, 3);
collector_test!(interrupted_4, 4);
collector_test!(interrupted_5, 5);
collector_test!(interrupted_6, 6);
collector_test!(interrupted_12, 12);

#[test]
fn exhausted_scalar_is_complete() {
    fixture::check_total(engine_with_rows(5).query("total", Context::new("dev:alice", BTreeMap::new())).unwrap(), 5);
}

#[test]
fn continuing_scalar_is_incomplete() {
    fixture::check_total(engine_with_rows(6).query("total", Context::new("dev:alice", BTreeMap::new())).unwrap(), 6);
}

#[test]
fn owned_page_cannot_mask_lost_sibling() {
    for count in [1, 2, 3, 4, 5, 6, 12] {
        fixture::check_siblings(engine_with_rows(count).query("ownedAndLost", Context::new("dev:alice", BTreeMap::new())).unwrap(), count);
    }
}

#[test]
fn exhausted_returning_helper_is_complete() {
    fixture::check_full_final_page(engine_with_rows(5).query("withEarly", Context::new("dev:alice", BTreeMap::new())).unwrap());
}

#[test]
fn program_return_still_exits_nested_loops_without_a_cursor() {
    fixture::check_interrupted(engine().query("returnedFromLoop", Context::new("dev:alice", BTreeMap::new())).unwrap());
}

#[path = "common/page_loss.rs"]
mod loss_fixture;
#[path = "common/page_loss_server.rs"]
mod page_loss;
