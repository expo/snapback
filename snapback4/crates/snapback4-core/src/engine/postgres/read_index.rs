//! One independent implicit transaction, never a snapshot retained by a reader.
// @ref LLP 3000.009.001.000.002#g5-read-index-validation — complete revision equality certifies frozen per-session facts.
use super::{store::Store, read_grant::{Published, PUBLICATION}};
use crate::RuntimeError;

impl Store {
    pub(crate) fn read_index_validation(&mut self) -> Result<Option<Published>, RuntimeError> {
        // Stage E snapshots must first acquire the certified D image. This
        // prototype deliberately leaves that path on its existing G5 check.
        if !self.read_index_eligible() || !self.client.is_reader() { return Ok(None); }
        self.refresh_reader_connection()?;
        let expected = self.fence.clone();
        let sql = format!("SELECT p.*,o.store_id,o.token,o.holder,(SELECT value FROM _meta WHERE key='generation'),pg_catalog.current_setting('client_encoding') FROM ({PUBLICATION}) p CROSS JOIN _owner o WHERE o.singleton");
        let sql = self.check_functions.borrow().as_ref().map_or_else(||sql.clone(), |c| c.binary_read(&sql));
        self.calls.set(self.calls.get() + 1);
        let rows = self.client.independent(&sql, &[])?;
        let Some(row) = rows.first().filter(|_| rows.len() == 1) else { return Ok(None); };
        let stamp = Published::row(row)?;
        let token = expected.as_ref().map_or(0, |f| f.token);
        let owner_store: Option<String> = row.try_get(6)?;
        let holder: Option<String> = row.try_get(8)?;
        if row.try_get::<_, i64>(7)? != token
            || expected.as_ref().is_some_and(|f| owner_store.as_deref() != Some(f.store_id.as_str()) || holder.as_deref() != Some(f.holder.as_str()))
            || owner_store.as_deref() != Some(stamp.store.as_str())
            || row.try_get::<_, String>(9)?.parse::<i64>().ok() != Some(stamp.generation)
            || stamp.generation != self.generation as i64
            || row.try_get::<_, &str>(10)? != "UTF8"
        { return Ok(None); }
        Ok(self.read_index_eligible().then_some(stamp))
    }
}
