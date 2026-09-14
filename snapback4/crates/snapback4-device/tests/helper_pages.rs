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
page_test!(returning_helper_keeps_matching_page, "withMatching");
page_test!(auxiliary_scan_does_not_reclassify_the_final_page, "withAuxiliary");

#[test]
fn lost_continuation_is_incomplete_sqlite() {
    for count in [5, 12] {
        let mut host = Sqlite::new("lost-page");
        let mut device = device_with_rows(&mut host, count);
        if count == 5 {
            fixture::check_full_final_page(device.query("withEarly", "dev:alice", &serde_json::json!({}), 100).unwrap());
        }
        fixture::check_interrupted(device.query("interrupted", "dev:alice", &serde_json::json!({}), 100).unwrap());
    }
}

#[test]
fn lost_continuation_is_incomplete_memory() {
    for count in [5, 12] {
        let mut device = device_with_rows(&mut Memory::new(), count);
        if count == 5 {
            fixture::check_full_final_page(device.query("withEarly", "dev:alice", &serde_json::json!({}), 100).unwrap());
        }
        fixture::check_interrupted(device.query("interrupted", "dev:alice", &serde_json::json!({}), 100).unwrap());
    }
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
