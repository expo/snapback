//! Progressive acquisition shares the stream's physical snapshot and receipts.
use super::{Engine, sync_evidence, time_audience};
use crate::{RuntimeError, partition};
use std::collections::BTreeMap;

pub struct CertifiedAcquisition {
    pub page: partition::StreamPage,
    pub acquire: partition::AcquisitionProgress,
    pub acknowledged: BTreeMap<String, u64>,
    pub committed_above: BTreeMap<String, u64>,
}

impl Engine {
    /// Starting at cursor=None, from=0 pins the reply watermark at images_at.
    /// Receipt evidence still uses the requested cut, including (0, head] on
    /// that first unit; subsequent units retain watermark=from.
    // @ref LLP 3000.001.001#61-the-acquisition-page — image head and own-write deferral evidence belong to the unit's one read transaction.
    pub fn acquisition_page_at(&mut self, principal: &str, cursor: Option<&str>,
        hint: Option<&partition::AcquisitionGroup>, skip: &[partition::AcquisitionGroup],
        from: u64, limit: usize, now: i64, pending: &[String],
    ) -> Result<CertifiedAcquisition, RuntimeError> {
        let cursor = cursor.map(|token| partition::SnapshotCursor::decode(token).ok_or_else(||
            RuntimeError::Input("the acquisition cursor is not one this server minted".into()))).transpose()?;
        let now = self.advance_time_audience(now)?;
        let tx = self.store.read_transaction()?;
        let now = time_audience::observe_reader_time(&self.schema, &tx, now)?;
        let result = partition::acquisition_page(&tx, &self.schema, principal, cursor, hint, skip, from, limit, now)?;
        let (acknowledged, committed_above) = sync_evidence::acknowledged(&tx, principal, pending, from,
            result.page.images_at.expect("acquisition names its head"))?;
        tx.rollback()?;
        Ok(CertifiedAcquisition { page: result.page, acquire: result.acquire, acknowledged, committed_above })
    }
}
