//! Both writes enter through the adapter, and the observer proves overlap.
// @ref LLP 3000.009.001.000#91-adapter-parity-rules — races cannot pass under sequential scheduling.
use super::authority_engine;
use super::super::{PostgresEngine, WriteMode};
use crate::engine::effects::{self, OutboxTransaction, test_cases};
use std::{sync::{Arc, Barrier}, time::{Duration, Instant}};

fn peer(owner: &mut PostgresEngine) -> (PostgresEngine, postgres::Client, i32, i32) {
    let name: String = owner.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let owner_pid: i32 = owner.store.client.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private database");
    let mut peer = PostgresEngine::open(postgres::Client::connect(&url,postgres::NoTls).unwrap(), &name).unwrap();
    peer.store.client.batch_execute("SET statement_timeout = '10s'").unwrap();
    let peer_pid = peer.store.client.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
    (peer,postgres::Client::connect(&url,postgres::NoTls).unwrap(),owner_pid,peer_pid)
}

fn overlapped(observer: &mut postgres::Client, owner: i32, peer: i32) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let blockers: Vec<i32> = observer.query_one("SELECT pg_blocking_pids($1)", &[&peer]).unwrap().get(0);
        if blockers.contains(&owner) { break; }
        assert!(Instant::now() < deadline,"peer adapter never overlapped the owner transaction");
        std::thread::sleep(Duration::from_millis(5));
    }
    let query: String = observer.query_one("SELECT query FROM pg_stat_activity WHERE pid = $1", &[&peer]).unwrap().get(0);
    assert!(query.contains("FROM _head WHERE singleton FOR UPDATE"),"wrong blocking operation: {query}");
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_two_workers_claim_one_effect_with_forced_overlap() {
    let mut owner = authority_engine();
    let (mut peer,mut observer,owner_pid,peer_pid) = peer(&mut owner);
    let tx = owner.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::race_seed(&tx,false);
    tx.commit().unwrap();
    let tx = owner.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let first = test_cases::claim_one(&tx,"worker-a");
    let barrier = Arc::new(Barrier::new(2));
    let ready = barrier.clone();
    let handle = std::thread::spawn(move || {
        ready.wait();
        let tx = peer.store.transaction(Some(WriteMode::Serialized)).unwrap();
        let second = test_cases::claim_one(&tx,"worker-b");
        let run = tx.required_effect_run("race").unwrap();
        tx.commit().unwrap();
        (second,run)
    });
    barrier.wait();
    overlapped(&mut observer,owner_pid,peer_pid);
    tx.commit().unwrap();
    let (second,run) = handle.join().unwrap();
    assert_eq!((first.len(),second.len(),run.attempts),(1,0,1));
    let mut sqlite = crate::Store::memory().unwrap();
    let tx = sqlite.transaction().unwrap();
    test_cases::race_seed(&tx,false);
    assert_eq!(test_cases::claim_one(&tx,"worker-a"),first);
    assert_eq!(test_cases::claim_one(&tx,"worker-b"),second);
    assert_eq!(tx.required_effect_run("race").unwrap(),run);
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn outbox_cancellation_races_settlement_in_both_fenced_orders() {
    for cancellation_first in [true,false] {
        let mut owner = authority_engine();
        let (mut peer,mut observer,owner_pid,peer_pid) = peer(&mut owner);
        let tx = owner.store.transaction(Some(WriteMode::Serialized)).unwrap();
        test_cases::race_seed(&tx,true);
        tx.commit().unwrap();
        let tx = owner.store.transaction(Some(WriteMode::Serialized)).unwrap();
        if cancellation_first { test_cases::cancelled_race_winner(&tx); }
        else { test_cases::settle_race_loser(&tx).unwrap(); }
        let barrier = Arc::new(Barrier::new(2));
        let ready = barrier.clone();
        let handle = std::thread::spawn(move || {
            ready.wait();
            let tx = peer.store.transaction(Some(WriteMode::Serialized)).unwrap();
            let error = if cancellation_first {
                test_cases::settle_race_loser(&tx).err().map(|e| e.code().to_string())
            } else { effects::cancel(&tx,"race",12).unwrap(); None };
            // A policy refusal is read-only and drops its transaction too.
            if error.is_some() { tx.rollback().unwrap(); } else { tx.commit().unwrap(); }
            let tx = peer.store.transaction(None).unwrap();
            let run = tx.required_effect_run("race").unwrap();
            tx.rollback().unwrap();
            (error,run)
        });
        barrier.wait();
        overlapped(&mut observer,owner_pid,peer_pid);
        tx.commit().unwrap();
        let (pg_error,pg_run) = handle.join().unwrap();
        let mut sqlite = crate::Store::memory().unwrap();
        let tx = sqlite.transaction().unwrap();
        test_cases::race_seed(&tx,true);
        let error = if cancellation_first {
            test_cases::cancelled_race_winner(&tx);
            test_cases::settle_race_loser(&tx).err().map(|e| e.code().to_string())
        } else {
            test_cases::settle_race_loser(&tx).unwrap();
            effects::cancel(&tx,"race",12).unwrap();
            None
        };
        assert_eq!((pg_error.clone(),pg_run.clone()),(error,tx.required_effect_run("race").unwrap()));
        assert_eq!(pg_error.as_deref(),cancellation_first.then_some("E_EFFECT_LEASE"));
        assert_eq!(pg_run.state,if cancellation_first { "failed" } else { "sent" });
        tx.rollback().unwrap();
    }
}
