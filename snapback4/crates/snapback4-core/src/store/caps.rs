//! Transactional cap occupancy, maintained with each physical row transition.
use super::*;

impl Tx<'_> {
    pub(super) fn physical_cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        let count: Option<i64> = self.tx.prepare_cached("SELECT n FROM _cap_counts WHERE t = ?1 AND k = ?2")?
            .query_row(params![self.num(table)?, crate::rows::caps::key(by, group)], |r| r.get(0)).optional()?;
        Ok(count.unwrap_or(0) as u64)
    }

    pub(super) fn update_cap_counts(&self, name: &str, table: &Table, old: Option<&Value>, new: Option<&Value>) -> Result<u64, RuntimeError> {
        let changes = crate::rows::caps::deltas(table, old, new);
        for (key, delta) in &changes {
            let t = self.num(name)?;
            if *delta > 0 {
                self.conn().prepare_cached("INSERT INTO _cap_counts(t,k,n) VALUES (?1,?2,1) ON CONFLICT(t,k) DO UPDATE SET n = n + 1")?.execute(params![t, key])?;
            } else {
                self.conn().prepare_cached("UPDATE _cap_counts SET n = n - 1 WHERE t = ?1 AND k = ?2")?.execute(params![t, key])?;
                self.conn().prepare_cached("DELETE FROM _cap_counts WHERE t = ?1 AND k = ?2 AND n = 0")?.execute(params![t, key])?;
            }
        }
        Ok(changes.len() as u64)
    }
}
