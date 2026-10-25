//! Each entry invokes its real reader/claimer API over the E transport.
use super::*;
use crate::{engine::effects::OutboxStore, receipts::ReceiptReader};
use std::sync::mpsc;
#[test]
#[ignore = "private PG16; Linux CLOCK_BOOTTIME"]
fn g7e_reader_classes_hold_visible_uncertified_snapshots_and_cache_fills() {
    if crate::engine::postgres::read_grant::boottime().is_none() {
        eprintln!("G6 E coverage requires CLOCK_BOOTTIME");
        return;
    }
    let (mut writer, d, v, _lease, mut c) = fixture_owned();
    writer
        .store_mut()
        .enable_postgres_early_lock_release()
        .unwrap();
    let mut readers = (0..9).map(|_| writer.reader().unwrap()).collect::<Vec<_>>();
    // Exercise both an actual G5 hit and an actual zero-flight G6 hit before
    // closing publication. Afterwards every path must hold the newer snapshot.
    for r in &mut readers {
        warm(r, &d, &v, "W1", SessionScope::Full);
    }
    let _ = actual_hit(&mut readers[0], &d, &v, "W1", SessionScope::Full);
    let grant = writer.store().read_grant().unwrap();
    let flight = grant.begin_flight().unwrap();
    let old: i64 = c
        .query_one("SELECT revision FROM _head WHERE singleton", &[])
        .unwrap()
        .get(0);
    let previous: String = c
        .query_one("SELECT attempt FROM _head WHERE singleton", &[])
        .unwrap()
        .get(0);
    let counter: u64 = previous.split_once(':').unwrap().1.parse().unwrap();
    let attempt = format!("{}:{}", _lease.token().unwrap(), counter + 1);
    c.execute(
        "UPDATE _head SET revision=revision+1,attempt=$1 WHERE singleton",
        &[&attempt],
    )
    .unwrap();
    let schema = writer.schema().clone();
    let tasks = readers
        .into_iter()
        .enumerate()
        .map(|(class, mut r)| {
            let d = d.clone();
            let v = v.clone();
            let schema = schema.clone();
            let (send, recv) = mpsc::channel();
            let task = std::thread::spawn(move || {
                let before = r.revision_cache_stats();
                let outcome = match class {
                    0 => read(&mut r, &d, &v, "W1", false, SessionScope::Full, 1000)
                        .map(|_| ())
                        .map_err(|e| e.code), // G4a closure
                    1 => r
                        .query("W1", Context::new(&v, args("W1")).at(1000))
                        .map(|_| ())
                        .map_err(|e| e.code), // ordinary
                    2 | 3 => read(&mut r, &d, &v, "W1", true, SessionScope::Full, 1000)
                        .map(|_| ())
                        .map_err(|e| e.code), // G5/G6 hit/fill
                    4 => (|| {
                        let snap = r.store_mut().read_transaction()?;
                        snap.commits_after(0, 20)?;
                        snap.rollback()
                    })()
                    .map_err(|e: RuntimeError| e.code()), // /changes ledger
                    5 => r
                        .store()
                        .receipt(&v, "no-key")
                        .map(|_| ())
                        .map_err(|e| e.code()),
                    6 => (|| {
                        let snap = r.store_mut().read_transaction()?;
                        crate::partition::stream(&snap, &schema, &v, 0, 20, 1000)?;
                        snap.rollback()
                    })()
                    .map_err(|e: RuntimeError| e.code()),
                    7 => r.effects_due(None, 1000).map(|_| ()).map_err(|e| e.code()),
                    _ => r
                        .store()
                        .list_effects(None, 20)
                        .map(|_| ())
                        .map_err(|e| e.code()),
                };
                assert_eq!(
                    r.revision_cache_stats().fills,
                    before.fills,
                    "uncertified cache fill in class {class}"
                );
                send.send((class, outcome)).unwrap();
            });
            (task, recv)
        })
        .collect::<Vec<_>>();
    std::thread::sleep(Duration::from_millis(40));
    for (_, recv) in &tasks {
        assert!(
            recv.try_recv().is_err(),
            "a reader class escaped the D hold"
        );
    }
    for (task, recv) in tasks {
        let (class, outcome) = recv.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(
            outcome.is_err(),
            "class {class} emitted above D at revision {}",
            old + 1
        );
        task.join().unwrap();
    }
    writer.store().durability().unwrap().break_history();
    flight.resolve(None, true);
    writer.store_mut().recover_durability().unwrap();
    assert!(writer.store().rows("messages").is_ok());
}
