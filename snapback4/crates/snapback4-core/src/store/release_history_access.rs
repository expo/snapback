//! SQLite release-history operations at the caller's snapshot.
use super::*;
use crate::release_history::{
    DormantItem, Event, ReleaseHistoryReader, ReleaseHistoryTransaction, counter,
};

impl ReleaseHistoryReader for Tx<'_> {
    fn release_events(&self, after: u64, limit: usize) -> Result<Vec<Event>, RuntimeError> {
        if !release_history::present(self.conn())? {
            return Ok(Vec::new());
        }
        let mut statement = self.conn().prepare("SELECT id,at,operation,release,previous,generation,revision,summary FROM _release_events WHERE id>?1 ORDER BY id LIMIT ?2")?;
        let mut rows = statement.query(params![
            counter(after)?,
            limit.min(i64::MAX as usize) as i64
        ])?;
        let mut events = Vec::new();
        while let Some(row) = rows.next()? {
            events.push(Event {
                id: row.get::<_, i64>(0)? as u64,
                at: row.get(1)?,
                operation: row.get(2)?,
                release: row.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                previous: row.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                generation: row.get::<_, i64>(5)? as u64,
                revision: row.get::<_, i64>(6)? as u64,
                summary: serde_json::from_str(&row.get::<_, String>(7)?)
                    .map_err(|e| RuntimeError::Store(e.to_string()))?,
            });
        }
        Ok(events)
    }
    fn release_event_items(
        &self,
        event: u64,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<DormantItem>, RuntimeError> {
        if !release_history::present(self.conn())? {
            return Ok(Vec::new());
        }
        self.conn().prepare("SELECT detail FROM _release_event_items WHERE event=?1 AND (?2 IS NULL OR path>?2) ORDER BY path LIMIT ?3")?
            .query_map(params![counter(event)?, after, limit.min(i64::MAX as usize) as i64], |r| r.get::<_, String>(0))?
            .map(|r| serde_json::from_str(&r?).map_err(|e| RuntimeError::Store(e.to_string()))).collect()
    }
    fn release_inventory(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<DormantItem>, RuntimeError> {
        release_history::inventory(self.conn(), after, limit)
    }
    fn previous_active_release(&self) -> Result<Option<u64>, RuntimeError> {
        if !release_history::present(self.conn())? {
            return Ok(None);
        }
        Ok(self.conn().query_row("SELECT previous FROM _release_events WHERE release IS NOT NULL AND previous != release AND operation != 'prune' ORDER BY id DESC LIMIT 1", [], |r| r.get::<_, Option<i64>>(0)).optional()?.flatten().map(|n| n as u64))
    }
    fn release_workers(&self, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
        Ok(self.conn().prepare("SELECT key,value FROM _meta WHERE key='worker:status' OR key LIKE 'worker:status:%' ORDER BY key LIMIT ?1")?.query_map([limit.min(i64::MAX as usize) as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?)
    }
}
impl ReleaseHistoryTransaction for Tx<'_> {
    fn finalize_restorations(&self) -> Result<(), RuntimeError> {
        release_history::finalize_restorations(self)
    }
    fn insert_release_event(
        &self,
        event: &Event,
        items: &[DormantItem],
    ) -> Result<u64, RuntimeError> {
        let held: i64 =
            self.conn()
                .query_row("SELECT COALESCE(MAX(id),0) FROM _release_events", [], |r| {
                    r.get(0)
                })?;
        let id = crate::release_history::next_event_id(held)?;
        self.set_meta("release_revision", &event.revision.to_string())?;
        self.conn().execute("INSERT INTO _release_events(id,at,operation,release,previous,generation,revision,summary) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![id, event.at, event.operation, event.release.map(counter).transpose()?, event.previous.map(counter).transpose()?, counter(event.generation)?, counter(event.revision)?, event.summary.to_string()])?;
        for item in items {
            self.conn().execute(
                "INSERT INTO _release_event_items(event,path,detail) VALUES(?1,?2,?3)",
                params![id, item.key, canonical_json(item)],
            )?;
        }
        Ok(id as u64)
    }
}
