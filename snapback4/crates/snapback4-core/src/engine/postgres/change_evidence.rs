//! Bounded Postgres evidence facts; missing/legacy commit evidence widens in shared policy.
// @ref LLP 3000.023#12 — no interval certifies authority unless its complete evidence is proven.
use super::store::{Store, Tx};
use crate::{
    RuntimeError,
    revocation::{self, ChangeEvidence, EvidenceRecord},
};
use std::cell::RefCell;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    super::foundation_schema::verify(
        tx,
        "_commits",
        &[
            ("seq", "bigint", true, false),
            ("at", "bigint", true, false),
            ("program", "text", true, false),
            ("principal", "text", true, false),
            ("kind", "text", true, false),
            ("touched", "text", true, false),
            ("writes", "bigint", true, false),
        ],
        &["seq"],
    )?;
    super::foundation_schema::verify(
        tx,
        "_change_evidence",
        &[
            ("seq", "bigint", true, false),
            ("footprint", "text", true, false),
        ],
        &["seq"],
    )?;
    if !tx.query("SELECT to_regclass('_change_evidence') IS NOT NULL", &[])?[0].get::<_, bool>(0) {
        tx.batch(
            "CREATE TABLE _change_evidence (seq BIGINT PRIMARY KEY, footprint TEXT NOT NULL)",
        )?;
    }
    Ok(())
}

impl ChangeEvidence for Tx<'_> {
    fn change_evidence(
        &self,
        after: u64,
        through: u64,
        mut visit: impl FnMut(EvidenceRecord) -> Option<()>,
    ) -> Result<Option<()>, RuntimeError> {
        Ok((|| {
        let (after, through) = revocation::evidence_bounds(after, through)?;
        let rows = self.query("SELECT c.seq,e.footprint FROM _commits c LEFT JOIN _change_evidence e ON e.seq=c.seq WHERE c.seq>$1 AND c.seq<=$2 ORDER BY c.seq LIMIT 501", &[&after,&through]).ok()?;
        for row in rows {
            visit(EvidenceRecord {
                seq: u64::try_from(row.try_get::<_, i64>(0).ok()?).ok()?,
                footprint: row.try_get(1).ok()?,
            })?;
        }
        Some(())
        })())
    }
}
impl ChangeEvidence for RefCell<&mut Store> {
    fn change_evidence(
        &self,
        after: u64,
        through: u64,
        visit: impl FnMut(EvidenceRecord) -> Option<()>,
    ) -> Result<Option<()>, RuntimeError> {
        Ok((|| {
        revocation::evidence_bounds(after, through)?;
        let mut store = self.borrow_mut();
        let tx = store.transaction(None).ok()?;
        let result = tx.change_evidence(after, through, visit).ok()?;
        // Failure also ends the snapshot; no statements follow a query error.
        tx.rollback().ok()?;
        result
        })())
    }
}
