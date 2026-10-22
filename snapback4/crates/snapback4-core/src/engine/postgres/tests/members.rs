//! The K0b facade property on one real Postgres physical transaction.
// @ref LLP 3000.009.001.000#3.4 — complete each tail inside its member; rollback cannot erase a preceding member.
use super::*;
use crate::{Engine, Schema, store_port::{AnyStore}, partition::PartitionRows,
    receipts::ReceiptReader};
fn store() -> AnyStore {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private scripts/test-postgres.sh database");
    let name = format!("sb4_eval_members_{:x}", crate::ids::seed());
    let engine = Engine::new(AnyStore::create_postgres(&connection, &name).unwrap(), Schema::default(), []).unwrap();
    engine.store
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn postgres_member_two_rollback_preserves_member_one_and_contiguous_heads() {
    for rollback in [true, false] {
        let mut store = store();
        let tx = store.transaction().unwrap();
        Committer::execute(&tx, Member::new(Kind::Program, |member| {
            assert_eq!(member.next_seq()?, 1);
            member.set_schedule_boundary("marker", 10)?;
            member.record_commit(1, 100, ("first", "alice", "mutation"), &[], 0)?;
            member.record_applied("alice", "first", 1, "receipt one")?;
            member.bind_applied("alice", "first", "first", &serde_json::json!({}), 100)?;
            member.complete(())
        })).unwrap();
        assert_eq!(tx.next_seq().unwrap(), 2);
        assert_eq!(tx.receipt("alice", "first").unwrap().unwrap().name.as_deref(), Some("first"));
        Committer::execute(&tx, Member::new(Kind::Program, |member| {
            assert_eq!(member.next_seq()?, 2);
            assert_eq!(crate::engine::job::JobTransaction::schedule_boundary(member.tx, "marker")?, Some(10));
            member.savepoint("program")?;
            member.set_schedule_boundary("marker", 20)?;
            member.record_commit(2, 200, ("second", "alice", "mutation"), &[], 0)?;
            member.rollback_to("program")?;
            assert_eq!(member.next_seq()?, 2);
            member.record_commit(2, 200, ("second", "alice", "mutation"), &[], 0)?;
            member.record_applied("alice", "second", 2, "receipt two")?;
            if rollback { member.rollback(()) } else { Err(RuntimeError::Store("injected member error".into())) }
        })).map_or_else(|e| assert!(!rollback && e.to_string().contains("injected")), |_| assert!(rollback));
        assert_eq!(tx.next_seq().unwrap(), 2);
        assert!(tx.receipt("alice", "second").unwrap().is_none());
        tx.commit().unwrap();
        assert_eq!(store.seq().unwrap(), 1);
        assert_eq!(store.schedule_boundary("marker").unwrap(), Some(10));
        Committer::run(&mut store, Member::new(Kind::Program, |member| {
            assert_eq!(member.next_seq()?, 2);
            member.record_commit(2, 300, ("third", "alice", "mutation"), &[], 0)?;
            member.complete(())
        })).unwrap();
        assert_eq!(store.seq().unwrap(), 2);
    }
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn postgres_flush_failure_is_still_inside_member_and_slot_cannot_be_overwritten() {
    let mut store = store(); let tx = store.transaction().unwrap();
    Committer::execute(&tx, Member::new(Kind::Program, |member| {
        member.record_commit(1, 100, ("first", "alice", "mutation"), &[], 0)?;
        assert!(member.record_commit(1, 100, ("overwrite", "alice", "mutation"), &[], 0).is_err());
        member.complete(())
    })).unwrap();
    // A duplicate event key makes the CTE fail after attempting its head update.
    let result = Committer::execute(&tx, Member::new(Kind::Program, |member| {
        member.record_commit(2, 200, ("failed", "alice", "mutation"), &[], 0)?;
        for _ in 0..2 { PartitionRows::append_log(member.tx, "public", 2, 0, "notes", "del", "id", None)?; }
        member.complete(())
    }));
    assert!(result.is_err());
    assert_eq!(tx.next_seq().unwrap(), 2);
    tx.commit().unwrap();
    assert_eq!(store.seq().unwrap(), 1);
    assert_eq!(store.rows("notes").unwrap().len(), 0);
}
