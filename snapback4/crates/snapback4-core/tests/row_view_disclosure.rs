#[path = "row_view_disclosure/cases.rs"]
mod cases;
#[path = "row_view_disclosure/mod.rs"]
mod disclosure;
use disclosure::*;
use serde_json::{Value as Json, json};
#[test]
fn old_mark_through_background_quiescence() {
    cases::old_mark().assert_equal();
}
#[test]
fn hidden_source_contribution_all_write_kinds() {
    for op in [
        "insertRow",
        "insertAbsent",
        "upsertRow",
        "updateRow",
        "deleteRow",
    ] {
        cases::hidden_source(op).assert_equal();
        cases::refused_source(op).assert_equal();
    }
}
#[test]
fn hidden_conversation_presence() {
    cases::hidden_conversation().assert_equal();
}
#[test]
fn row_key_target_exists_but_is_unreadable() {
    cases::unreadable_key().assert_equal();
}

#[test]
fn hidden_source_interval_does_not_select_background_work() {
    cases::hidden_interval().assert_equal();
}

#[test]
fn undelivered_hidden_expiry_does_not_change_catchup() {
    cases::hidden_expiry().assert_equal();
}

#[test]
fn hidden_count_digit_boundary_keeps_query_meters_identical() {
    let mut pair = cases::hidden_source("insertRow");
    for seed in &mut pair.seeds {
        seed.extend((0..9).map(|n| cases::message(&format!("padding{n}"), 5, false)));
    }
    pair.source.push_str("\nquery foldedCount():\n  rows = unread first 100\n  return count(rows)\n");
    pair.assert_equal();
}
