//! Tail buffering is independent of the number of admitted effect records.
// @ref LLP 3000.009.001.000#3.4 — no implicit execute flush and one CTE flight per member.
use super::super::*;
use crate::{Engine, store_port::AnyStore, engine::effects::{NewEffect, OutboxTransaction, legacy_work}, metadata::DevMetadata};
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn effects_batch_and_unrelated_execute_never_flushes_the_member() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let name = format!("sb4_eval_tail_{:x}", crate::ids::seed());
    let mut engine = Engine::new(AnyStore::create_postgres(&connection, &name).unwrap(), Schema::default(), []).unwrap();
    let mut flights = Vec::new();
    for (seq, count) in [(1, 1), (2, 8), (3, 16)] {
        let owner = engine.store_mut().transaction().unwrap();
        let tx = owner.test_postgres_tx();
        owner.savepoint("member").unwrap();
        owner.record_commit(seq, 100, "emit", "alice", "mutation", &[], 0).unwrap();
        let before = tx.calls.get();
        let payload = Value::String("payload".into()); let work = legacy_work();
        for i in 0..count {
            let id = format!("{seq}/effect/{i}");
            OutboxTransaction::insert_effect(&owner, &NewEffect { id: &id, seq, effect: "notify", payload: &payload, now: 100, next_at: None, work: &work, deadline: None, release: Some("explicit"), contract: "contract" }).unwrap();
            OutboxTransaction::insert_effect_presence(&owner, "alice", &id, 200).unwrap();
        }
        assert_eq!(tx.calls.get(), before, "preparing any number of effects makes no driver call");
        // execute used to flush here, before member release.
        owner.set_dev_value(DevMetadata::HoldSchedules, "marker").unwrap();
        assert_eq!(tx.query("SELECT seq FROM _head WHERE singleton", &[]).unwrap()[0].get::<_, i64>(0), seq as i64 - 1);
        let before = tx.calls.get(); owner.release("member").unwrap();
        let delta = tx.calls.get() - before; flights.push(delta);
        assert_eq!(owner.next_seq().unwrap(), seq + 1);
        let rows = tx.query("SELECT release FROM _outbox WHERE seq=$1 ORDER BY id", &[&(seq as i64)]).unwrap();
        assert_eq!(rows.len(), count); assert!(rows.iter().all(|r| r.get::<_,Option<&str>>(0) == Some("explicit")));
        owner.commit().unwrap();
    }
    assert_eq!(flights, [3, 1, 1], "cold Bind/SQL prepare + tail flight; cached tail folds release and settings");
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn nested_rollback_invalidates_prefetch_and_terminal_bind_refusal_stays_terminal() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let name = format!("sb4_eval_rollback_{:x}", crate::ids::seed());
    let mut engine = Engine::new(AnyStore::create_postgres(&connection, &name).unwrap(), Schema::default(), []).unwrap();
    let owner = engine.store_mut().transaction().unwrap();
    let tx = owner.test_postgres_tx();
    owner.savepoint("member").unwrap(); owner.savepoint("program").unwrap();
    tx.execute("INSERT INTO r(t,id,data) VALUES ('notes','id',$1)", &[&crate::value::canonical_json(&Value::Int(1))]).unwrap();
    Rows::prefetch(&owner, &[crate::rows::PrefetchRequest::Get { table: "notes".into(), id: "id".into() }]);
    assert_eq!(Rows::get(&owner, "notes", "id").unwrap(), Some(Value::Int(1)));
    owner.rollback_to("program").unwrap();
    assert_eq!(Rows::get(&owner, "notes", "id").unwrap(), None);
    owner.savepoint("program").unwrap();
    assert_eq!(tx.execute("INSERT INTO _meta(key,value) VALUES ($1,'x')", &[&"bad\0key"]).unwrap_err().code(), "E_INPUT");
    assert_eq!(owner.rollback_to("program").unwrap_err().code(), "E_INPUT");
    assert_eq!(owner.commit().unwrap_err().code(), "E_INPUT");
    assert_eq!(engine.store().seq().unwrap(), 0);
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn an_orphan_effect_tail_refuses_without_discarding_records() {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let name = format!("sb4_eval_orphan_{:x}", crate::ids::seed());
    let mut engine = Engine::new(AnyStore::create_postgres(&connection, &name).unwrap(), Schema::default(), []).unwrap();
    let owner = engine.store_mut().transaction().unwrap();
    let tx = owner.test_postgres_tx();
    tx.tail.borrow_mut().effects.push(super::super::tail::Effect { id: "id".into(), effect: "mail".into(), payload: "null".into(), next_at: None, work: "{}".into(), deadline: None, contract: "contract".into(), presence: Vec::new(), release: None });
    assert!(tx.flush_tail().unwrap_err().to_string().contains("no commit slot"));
    assert_eq!(tx.tail.borrow().effects.len(), 1);
    owner.rollback().unwrap();
}
