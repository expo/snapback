//! Upgrade the evaluation adapter's physical cap bookkeeping under its writer lock.
use crate::{error::RuntimeError, schema::Schema, value::Value};

pub(super) const DDL: &str = "CREATE TABLE _cap_counts (t TEXT COLLATE \"C\" NOT NULL, k BYTEA NOT NULL, n BIGINT NOT NULL CHECK(n >= 0), PRIMARY KEY(t,k))";

pub(super) fn install(client: &mut postgres::Client, schema: &Schema) -> Result<(), RuntimeError> {
    let mut tx = client.transaction()?;
    tx.query_one("SELECT seq FROM _head WHERE singleton FOR UPDATE", &[])?;
    let present: Option<String> = tx.query_one("SELECT to_regclass('_cap_counts')::text", &[])?.get(0);
    if present.is_none() {
        tx.batch_execute(DDL)?;
        for (name, table) in &schema.tables {
            if !table.is_expiring() || !table.constraints.iter().any(|c| matches!(c, crate::schema::Constraint::Cap { .. })) { continue; }
            let mut after: Option<String> = None;
            loop {
                let rows = match &after {
                    Some(after) => tx.query("SELECT id,data FROM r WHERE t = $1 AND id > $2 ORDER BY id LIMIT 500", &[name, after])?,
                    None => tx.query("SELECT id,data FROM r WHERE t = $1 ORDER BY id LIMIT 500", &[name])?,
                };
                for row in &rows {
                    after = Some(row.get(0));
                    let value: Value = super::store::decode(row.get(1))?;
                    for (key, _) in crate::rows::caps::deltas(table, None, Some(&value)) {
                        tx.execute("INSERT INTO _cap_counts(t,k,n) VALUES ($1,$2,1) ON CONFLICT(t,k) DO UPDATE SET n = _cap_counts.n + 1", &[name, &key])?;
                    }
                }
                if rows.len() < 500 { break; }
            }
        }
    }
    tx.commit()?;
    Ok(())
}

impl super::store::Tx<'_> {
    pub(super) fn update_cap_counts(&self, name: &str, table: &crate::schema::Table, old: Option<&Value>, new: Option<&Value>) -> Result<u64, RuntimeError> {
        let changes = crate::rows::caps::deltas(table, old, new);
        for (key, delta) in &changes {
            if *delta > 0 {
                self.execute("INSERT INTO _cap_counts(t,k,n) VALUES ($1,$2,1) ON CONFLICT(t,k) DO UPDATE SET n = _cap_counts.n + 1", &[&name, key])?;
            } else {
                self.execute("UPDATE _cap_counts SET n = n - 1 WHERE t = $1 AND k = $2", &[&name, key])?;
                self.execute("DELETE FROM _cap_counts WHERE t = $1 AND k = $2 AND n = 0", &[&name, key])?;
            }
        }
        Ok(changes.len() as u64)
    }
}
