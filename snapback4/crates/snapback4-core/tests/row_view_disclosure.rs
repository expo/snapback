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
    cases::digit_boundary().assert_equal();
}

#[path = "row_view_disclosure/generated.rs"]
mod generated;
#[test]
fn generated_populations_transitions_and_expiry() {
    let count = generated::visit(|name, mut pair| {
        eprintln!("{name}");
        pair.assert_equal();
        if !pair.refused { pair.file_store = true; pair.assert_equal(); }
    });
    assert_eq!(count, 540);
}
#[test]
fn astra_scratch_regressions_refuse_unsupported_audiences() {
    generated::astra_schedule().assert_equal();
    generated::astra_move().assert_equal();
}

#[test]
fn grok_born_expired_cardinality_is_absent_from_counts_meters_and_commits() {
    for (population, examined) in [(3,None), (30,Some(48)), (9999,None)] {
        let mut pair = generated::grok_born_expired(population, examined);
        pair.assert_equal();
        pair.file_store = true;
        pair.assert_equal();
    }
}

#[test]
fn shared_grant_blind_member_write_cannot_select_hidden_recount_traffic() {
    let pair = generated::aligned_access_hidden_mark();
    let mut e = pair.engine(0);
    let op = &pair.operations[0];
    let result = e.mutate(&op.name, None, snapback4_core::Context::new(&op.principal, inputs(&e,&op.name,&op.args)).at(NOW)).unwrap();
    assert!(matches!(&result.state, snapback4_core::WriteState::Failed { why, .. } if why.code == "E_VIEW_KEY"), "{result:?}");
    assert_eq!(e.store().rows("members").unwrap()[0].field("readUpTo").unwrap(), &snapback4_core::Value::Int(0));
    pair.assert_equal();
}

#[test]
fn blind_nonowner_cannot_infer_a_private_parent_from_source_admission() {
    generated::blind_private_parent().assert_equal();
}

#[test]
fn public_source_blind_private_parent_refuses_without_recount_work() {
    let mut pair = generated::public_private_parent([1, 1200], "alice", "bob", "alice", "alice");
    for file in [false, true] {
        pair.file_store = file;
        for world in 0..2 {
            let mut e = pair.engine(world);
            let base = e.seq().unwrap();
            let op = &pair.operations[0];
            let result = e.mutate(&op.name, None, snapback4_core::Context::new(&op.principal, inputs(&e, &op.name, &op.args)).at(NOW)).unwrap();
            assert!(matches!(&result.state, snapback4_core::WriteState::Failed { why, .. }
                if why.code == "E_VIEW_KEY" && why.message.contains("readable to its writers")), "{result:?}");
            assert!(e.run_view_chunk(NOW).unwrap().is_none());
            assert_eq!(e.seq().unwrap(), base);
            assert!(e.store().rows("members").unwrap().iter().all(|r| r.field("readUpTo") == Ok(&snapback4_core::Value::Int(0))));
        }
        pair.assert_equal();
    }
}
