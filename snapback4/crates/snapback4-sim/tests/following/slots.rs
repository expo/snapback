use super::*;
#[path = "../common/following_slots.rs"]
mod case;

// @ref LLP 3000.007#20.3 — unfollow releases routing capacity atomically without exposing another reader's routes.
fn scenario(at_cap: bool) {
    let bound = world::compiled(&world::source());
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    case::seed(&mut engine, at_cap);
    case::counts(&engine, case::READER, Some(if at_cap { 1 } else { 2 }), if at_cap { 32_000 } else { 2 });
    for (op, viewer, author, used, total) in case::steps(at_cap) {
        let result = world::mutate(&mut engine, op, viewer, &[("authorId", world::id(author))], 10);
        case::counts(&engine, viewer, used, total);
        let page = engine.query("following", Context::new(viewer, BTreeMap::new()).at(10)).unwrap();
        assert!(page.complete);
        assert_eq!(page.data.as_array().unwrap().len(), used.unwrap_or(0) as usize);
        println!("W7R2 host=server cap={at_cap} op={op} reader={viewer} routes={} count_rows={total} written={}", used.unwrap_or(0), result.metered.rows_written);
    }
    case::counts(&engine, case::AUTHOR, Some(1), if at_cap { 32_000 } else { 2 });
}

#[test]
fn following_w7r2_churn_at_accounting_cap() { scenario(true); }

#[test]
fn following_w7r2_decrement_delete_and_refollow() { scenario(false); }

#[test]
fn following_count_deletion_is_reader_owned() {
    let source = format!("{}\nmutation discardCount(readerId: principal):\n  delete pullCounts[readerId]\n", world::source());
    let bound = world::compiled(&source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    case::seed(&mut engine, false);
    let input = world::args(&[("readerId", world::id(case::READER))]);
    let denied = engine.mutate("discardCount", None, Context::new(case::AUTHOR, input.clone()).at(10)).unwrap();
    assert!(matches!(denied.state, WriteState::Failed { .. }), "{:?}", denied.state);
    case::counts(&engine, case::READER, Some(2), 2);
    let allowed = engine.mutate("discardCount", None, Context::new(case::READER, input).at(10)).unwrap();
    assert!(matches!(allowed.state, WriteState::Sent { .. }), "{:?}", allowed.state);
    assert_eq!(engine.store().rows("pullCounts").unwrap().len(), 1);
}
