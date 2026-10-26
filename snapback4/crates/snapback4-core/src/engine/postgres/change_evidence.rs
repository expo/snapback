//! Bounded Postgres evidence facts; missing/legacy commit evidence widens in shared policy.
// @ref LLP 3000.009.001.000.000.002#3.11 — ordered checks, typed tails and head-bound evidence maintenance.
// @ref LLP 3000.023#12 — no interval certifies authority unless its complete evidence is proven.
use super::store::{Store, Tx};
use crate::{
    RuntimeError,
    revocation::{self, ChangeEvidence, EvidenceRecord},
};
use std::cell::RefCell;

// The ordered lane already publishes _head in every tail. Maintenance locks
// and republishes that same boundary atomically with deletion. A snapshot that
// observes the deletion necessarily observes a head retaining >=1000 sequences;
// an older snapshot continues to see the deleted tuples through MVCC.
// SKIP LOCKED keeps this optional work off the owner's renewal wait path.
pub(super) const PRUNE: &str = "WITH locked AS (SELECT seq FROM _head WHERE singleton FOR UPDATE SKIP LOCKED), head AS (UPDATE _head SET seq=locked.seq FROM locked WHERE singleton RETURNING _head.seq) DELETE FROM _change_evidence WHERE seq <= (SELECT seq-1000 FROM head)";

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
        let Some((after, through)) = revocation::evidence_bounds(after, through) else { return Ok(None); };
        let rows = self.query("SELECT c.seq,e.footprint FROM _commits c LEFT JOIN _change_evidence e ON e.seq=c.seq WHERE c.seq>$1 AND c.seq<=$2 ORDER BY c.seq LIMIT 501", &[&after,&through])?;
        for row in rows {
            let Ok(seq) = u64::try_from(row.try_get::<_, i64>(0)?) else { return Ok(None); };
            // A LEFT JOIN miss is incomplete evidence, not a driver failure.
            let Some(footprint) = row.try_get::<_, Option<String>>(1)? else { return Ok(None); };
            if visit(EvidenceRecord { seq, footprint: Some(footprint) }).is_none() { return Ok(None); }
        }
        Ok(Some(()))
    }
}
impl ChangeEvidence for RefCell<&mut Store> {
    fn change_evidence(
        &self,
        after: u64,
        through: u64,
        visit: impl FnMut(EvidenceRecord) -> Option<()>,
    ) -> Result<Option<()>, RuntimeError> {
        if revocation::evidence_bounds(after, through).is_none() { return Ok(None); }
        let mut store = self.borrow_mut();
        let tx = store.transaction(None)?;
        let result = tx.change_evidence(after, through, visit);
        // End the snapshot even after a query error, preserving its original cause.
        let rollback = tx.rollback();
        let result = result?;
        rollback?;
        Ok(result)
    }
}
