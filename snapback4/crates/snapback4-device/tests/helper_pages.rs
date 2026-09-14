mod common;
#[path = "../../snapback4-sim/tests/common/helper_pages.rs"]
mod fixture;

use common::*;
use snapback4_device::device::Device;

fn device<H: Host>(host: &mut H) -> Device<H::Store> {
    device_with_rows(host, 12)
}

fn device_with_rows<H: Host>(host: &mut H, count: usize) -> Device<H::Store> {
    let (mut engine, backend) = compile(fixture::SOURCE);
    engine.seed(fixture::rows().into_iter().take(count)).unwrap();
    let mut device = host.open("helpers", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    device
}

macro_rules! page_test {
    ($module:ident, $op:literal) => {
        mod $module {
            use super::*;
            fn run<H: Host>(host: &mut H) {
                let mut device = device(host);
                fixture::check_pages($op, |cursor| device.query($op, "dev:alice", &serde_json::json!({"c": cursor}), 100).unwrap());
            }
            #[test]
            fn sqlite() { run(&mut Sqlite::new(stringify!($module))); }
            #[test]
            fn memory() { run(&mut Memory::new()); }
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
    ($module:ident, $count:literal) => {
        mod $module {
            use super::*;
            fn run<H: Host>(host: &mut H) {
                fixture::check_collector(device_with_rows(host, $count).query("interrupted", "dev:alice", &serde_json::json!({}), 100).unwrap(), $count);
            }
            #[test]
            fn sqlite() { run(&mut Sqlite::new(stringify!($module))); }
            #[test]
            fn memory() { run(&mut Memory::new()); }
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

macro_rules! outcome_test {
    ($module:ident, $count:literal, $op:literal, $check:ident) => {
        mod $module {
            use super::*;
            fn run<H: Host>(host: &mut H) {
                fixture::$check(device_with_rows(host, $count).query($op, "dev:alice", &serde_json::json!({}), 100).unwrap(), $count);
            }
            #[test]
            fn sqlite() { run(&mut Sqlite::new(stringify!($module))); }
            #[test]
            fn memory() { run(&mut Memory::new()); }
        }
    };
}

outcome_test!(exhausted_scalar_is_complete, 5, "total", check_total);
outcome_test!(continuing_scalar_is_incomplete, 6, "total", check_total);
outcome_test!(owned_page_and_one_row_sibling_are_complete, 1, "ownedAndLost", check_siblings);
outcome_test!(owned_page_cannot_mask_short_sibling, 4, "ownedAndLost", check_siblings);
outcome_test!(owned_page_cannot_mask_continuing_sibling, 6, "ownedAndLost", check_siblings);

mod exhausted_returning_helper_is_complete {
    use super::*;
    fn run<H: Host>(host: &mut H) {
        fixture::check_full_final_page(device_with_rows(host, 5).query("withEarly", "dev:alice", &serde_json::json!({}), 100).unwrap());
    }
    #[test]
    fn sqlite() { run(&mut Sqlite::new("helper-exhausted")); }
    #[test]
    fn memory() { run(&mut Memory::new()); }
}

#[test]
fn program_return_still_exits_nested_loops_sqlite() {
    let mut host = Sqlite::new("returned-page");
    fixture::check_interrupted(device(&mut host).query("returnedFromLoop", "dev:alice", &serde_json::json!({}), 100).unwrap());
}

#[test]
fn program_return_still_exits_nested_loops_memory() {
    fixture::check_interrupted(device(&mut Memory::new()).query("returnedFromLoop", "dev:alice", &serde_json::json!({}), 100).unwrap());
}

#[path = "../../snapback4-sim/tests/common/page_loss.rs"]
mod loss_fixture;
#[path = "page_loss/mod.rs"]
mod page_loss;
