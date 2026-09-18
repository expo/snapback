//! Executable writes belong to the device's opening principal on every host.
use super::*;

// @ref LLP 3000.001#reliability-retention — first binding preserves matching writes; a principal change cannot execute another principal's arguments.
pub(super) fn owns(entry: &Queued, viewer: &str) -> bool {
    !viewer.is_empty() && entry.viewer == viewer
}

pub(super) fn require(entry: &Queued, viewer: &str) -> Result<(), RuntimeError> {
    if !owns(entry, viewer) {
        return Err(RuntimeError::Input("the queued write does not belong to this device's principal".into()));
    }
    Ok(())
}

pub(super) fn entries<T: DeviceTx>(tx: &T, viewer: &str) -> Result<Vec<Queued>, RuntimeError> {
    adoption::require_binding(tx, viewer)?;
    let mut entries = Vec::new();
    for data in tx.outbox_entries()? {
        let entry: Queued = decoded(&data)?;
        if owns(&entry, viewer) {
            entries.push(entry);
        }
    }
    Ok(entries)
}

impl<S: DeviceStore> Device<S> {
    /// Recheck the exact entries the host is about to send, in the transaction
    /// that fences in-flight sync. A previously captured queue is no authority.
    pub fn begin_send_for(&mut self, ids: &[String]) -> Result<u64, RuntimeError> {
        self.begin_send_checked(Some(ids))
    }

    pub(super) fn begin_send_checked(&mut self, ids: Option<&[String]>) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction()?;
        adoption::require_binding(&tx, &self.history_owner)?;
        store_identity::require_healthy(&tx)?;
        match ids {
            Some(ids) => for id in ids {
                let data = tx.outbox_get(id)?.ok_or_else(|| RuntimeError::Input("the write is no longer queued".into()))?;
                require(&decoded(&data)?, &self.history_owner)?;
            },
            // An unqualified send can authorize only a wholly owned queue.
            None => for data in tx.outbox_entries()? {
                require(&decoded(&data)?, &self.history_owner)?;
            },
        }
        let revision = meta_u64(&tx, SEND_REVISION)?.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991).ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        tx.set_meta(SEND_REVISION, &revision.to_string())?;
        tx.commit()?;
        Ok(revision)
    }
}
