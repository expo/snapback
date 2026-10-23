//! The SDK stream's images, head, receipts and certification share one snapshot.
// @ref LLP 3000.009.001.000#3.4 — P1-CE admits certification only with coherent head/evidence reads.
use super::{Engine, time_audience};
use crate::{RuntimeError, partition, revocation, receipts::ReceiptReader};
use std::collections::BTreeMap;

pub struct CertifiedStream {
    pub page: partition::StreamPage,
    pub acknowledged: BTreeMap<String, u64>,
    pub committed_above: BTreeMap<String, u64>,
    pub preserved: Option<Vec<String>>,
    pub footprint: Option<revocation::Footprint>,
}

impl Engine {
    pub fn certified_stream_at(&mut self, principal: &str, from: u64, limit: usize, now: i64, pending: &[String]) -> Result<CertifiedStream, RuntimeError> {
        let now = self.advance_time_audience(now)?;
        let tx = self.store.read_transaction()?;
        let now = time_audience::observe_reader_time(&self.schema, &tx, now)?;
        let page = partition::stream(&tx, &self.schema, principal, from, limit, now)?;
        #[cfg(test)]
        tests::interleave();
        let through = page.images_at.unwrap_or(page.watermark);
        let (acknowledged, committed_above) = acknowledged(&tx, principal, pending, page.watermark, through)?;
        let footprint = tx.footprint_between(from, through);
        let preserved = footprint.as_ref().filter(|f| !f.unknown).map(|f| f.preserved(&self.schema));
        tx.rollback()?;
        Ok(CertifiedStream { page, acknowledged, committed_above, preserved, footprint })
    }
}

pub(super) fn acknowledged(tx: &impl ReceiptReader, principal: &str, pending: &[String], through: u64, images_at: u64) -> Result<(BTreeMap<String, u64>, BTreeMap<String, u64>), RuntimeError> {
    if images_at < through { return Err(RuntimeError::Input("image head precedes the event watermark".into())); }
    if pending.len() > 256 || pending.iter().any(|id| id.len() > 128) { return Err(RuntimeError::Input("sync accepts at most 256 pending ids of at most 128 bytes".into())); }
    let mut acknowledged = BTreeMap::new();
    let mut committed_above = BTreeMap::new();
    for id in pending {
        // @ref LLP 3000.013#6 — only a committed success acknowledges device execution.
        if let Some(seq) = tx.sent_sequence(principal, id, images_at.min(i64::MAX as u64) as i64)? {
            let seq = u64::try_from(seq).map_err(|_| RuntimeError::Store("negative stored operation sequence".into()))?;
            if seq <= through { acknowledged.insert(id.clone(), seq); }
            else { committed_above.insert(id.clone(), seq); }
        }
    }
    Ok((acknowledged, committed_above))
}

#[cfg(test)]
pub(crate) mod tests {
    use std::cell::RefCell;
    thread_local! { pub(crate) static BETWEEN: RefCell<Option<Box<dyn FnOnce()>>> = RefCell::new(None); }
    pub(super) fn interleave() { BETWEEN.with(|hook| { if let Some(f) = hook.borrow_mut().take() { f(); } }); }

    #[cfg(feature = "postgres")]
    #[test]
    #[ignore = "requires private Postgres; scripts/test-postgres.sh"]
    fn change_evidence_forced_snapshot_interleavings_postgres() {
        use crate::{Value, engine::Context};
        use std::{collections::BTreeMap, sync::mpsc, time::Duration};
        let mut writer = crate::store_port::change_evidence_tests::engine(true);
        let mut reader = writer.reader().unwrap();
        let (go, ready) = mpsc::channel(); let (done, committed) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            for (seq, viewer) in [(1, "alice"), (2, "bob"), (3, "alice")] {
                ready.recv_timeout(Duration::from_secs(10)).unwrap();
                let out = writer.mutate("put", Some(&format!("id{seq}")), Context::new(viewer, BTreeMap::from([
                    ("key".into(), Value::Id("note".into())), ("body".into(), Value::String(format!("body{seq}")))
                ])).at(100)).unwrap();
                assert_eq!(serde_json::to_value(out).unwrap()["seq"], seq);
                done.send(()).unwrap();
            }
            writer
        });
        // The exact /changes order: head first, a concurrent real adapter
        // commit, then evidence. A stale head must never include new evidence.
        let tx = reader.store_mut().read_transaction().unwrap();
        assert_eq!(tx.next_seq().unwrap()-1, 0);
        go.send(()).unwrap(); committed.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(tx.footprint_between(0, 1).is_none());
        assert_eq!(tx.next_seq().unwrap()-1, 0);
        tx.rollback().unwrap();
        // Exercise the actual certified stream operation: its hook is after
        // the page/head and before receipts/evidence. The writer commits an
        // ownership transfer while that physical snapshot remains open.
        BETWEEN.with(|hook| *hook.borrow_mut() = Some(Box::new(move || {
            go.send(()).unwrap(); committed.recv_timeout(Duration::from_secs(10)).unwrap();
            // Save channels for the reverse-order snapshot witness below.
            CHANNELS.with(|slot| *slot.borrow_mut() = Some((go, committed)));
        })));
        let answer = reader.certified_stream_at("alice", 0, 100, 100, &["id1".into(), "id2".into()]).unwrap();
        assert_eq!(answer.page.watermark, 1);
        assert_eq!(answer.page.images_at.unwrap_or(answer.page.watermark), 1);
        assert_eq!(answer.preserved, Some(vec!["notes".into()]));
        assert_eq!(answer.acknowledged, BTreeMap::from([("id1".into(), 1)]));
        assert!(answer.committed_above.is_empty());
        let answer = reader.certified_stream_at("alice", 1, 100, 100, &[]).unwrap();
        assert_eq!(answer.page.watermark, 2);
        assert_eq!(answer.preserved, Some(vec![]), "the new snapshot sees revocation");
        let (go, committed) = CHANNELS.with(|slot| slot.borrow_mut().take().unwrap());
        let schema = reader.schema().clone();
        let tx = reader.store_mut().read_transaction().unwrap();
        assert_eq!(tx.preserved_between(&schema, 1, 2), Some(vec![]));
        go.send(()).unwrap(); committed.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(tx.next_seq().unwrap()-1, 2, "evidence-first cannot acquire a newer head");
        assert!(tx.footprint_between(2, 3).is_none());
        tx.rollback().unwrap();
        assert_eq!(worker.join().unwrap().seq().unwrap(), 3);
    }
    #[cfg(feature = "postgres")]
    thread_local! { static CHANNELS: RefCell<Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>> = RefCell::new(None); }
}
