//! SQLite reads for bounded change evidence; revocation owns classification.
// @ref LLP 3000.023#12 — incomplete evidence certifies nothing.
use super::{Store, Tx};
use crate::{
    Schema,
    revocation::{self, ChangeEvidence, EvidenceRecord, Footprint},
};
use rusqlite::{Connection, params};

fn read(
    conn: &Connection,
    after: u64,
    through: u64,
    mut visit: impl FnMut(EvidenceRecord) -> Option<()>,
) -> Option<()> {
    let (after, through) = revocation::evidence_bounds(after, through)?;
    let mut statement = conn.prepare("SELECT c.seq, e.footprint FROM _commits c LEFT JOIN _change_evidence e ON e.seq=c.seq WHERE c.seq>?1 AND c.seq<=?2 ORDER BY c.seq LIMIT 501").ok()?;
    let rows = statement
        .query_map(params![after, through], |r| {
            Ok(EvidenceRecord {
                seq: r.get::<_, i64>(0)? as u64,
                footprint: r.get(1)?,
            })
        })
        .ok()?;
    for row in rows {
        visit(row.ok()?)?;
    }
    Some(())
}

impl ChangeEvidence for Store {
    fn change_evidence(
        &self,
        after: u64,
        through: u64,
        visit: impl FnMut(EvidenceRecord) -> Option<()>,
    ) -> Option<()> {
        read(self.conn(), after, through, visit)
    }
}
impl ChangeEvidence for Tx<'_> {
    fn change_evidence(
        &self,
        after: u64,
        through: u64,
        visit: impl FnMut(EvidenceRecord) -> Option<()>,
    ) -> Option<()> {
        read(self.conn(), after, through, visit)
    }
}

impl Store {
    /// Classify a complete interval; missing or unknown evidence returns None.
    pub fn preserved_between(&self, schema: &Schema, after: u64, through: u64) -> Option<Vec<String>> {
        revocation::preserved_between(self, schema, after, through)
    }
    /// Complete bounded transaction evidence; gaps certify nothing.
    pub fn footprint_between(&self, after: u64, through: u64) -> Option<Footprint> {
        revocation::footprint_between(self, after, through)
    }
}
impl Tx<'_> {
    pub fn preserved_between(&self, schema: &Schema, after: u64, through: u64) -> Option<Vec<String>> {
        revocation::preserved_between(self, schema, after, through)
    }
    pub fn footprint_between(&self, after: u64, through: u64) -> Option<Footprint> {
        revocation::footprint_between(self, after, through)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::revocation::evidence_test_cases;

    #[test]
    fn store_and_transaction_share_the_bounded_evidence_contract() {
        let mut store = Store::memory().unwrap();
        for record in evidence_test_cases::records().into_iter().rev() {
            store.conn().execute("INSERT INTO _commits(seq, at, program, principal, kind, touched, writes) VALUES (?1, 0, 'test', 'test', 'mutation', '[]', 0)", [record.seq as i64]).unwrap();
            if let Some(footprint) = record.footprint {
                store
                    .conn()
                    .execute(
                        "INSERT INTO _change_evidence(seq, footprint) VALUES (?1, ?2)",
                        params![record.seq as i64, footprint],
                    )
                    .unwrap();
            }
        }
        evidence_test_cases::check(&store);
        let tx = store.read_transaction().unwrap();
        evidence_test_cases::check(&tx);
        tx.rollback().unwrap();
    }
    #[test]
    fn missing_evidence_table_widens_and_writer_is_discarded_on_error() {
        let mut store = Store::memory().unwrap();
        store.conn().execute("INSERT INTO _commits(seq, at, program, principal, kind, touched, writes) VALUES (1,0,'test','alice','mutation','[]',0)", []).unwrap();
        assert!(store.footprint_between(0, 1).is_none());
        let tx = store.transaction().unwrap();
        tx.set_meta("deployment_environment", "discard").unwrap();
        tx.conn()
            .execute_batch("DROP TABLE _change_evidence")
            .unwrap();
        assert!(tx.footprint_between(0, 1).is_none());
        tx.rollback().unwrap();
        assert_eq!(store.meta("deployment_environment").unwrap(), None);
    }
}
