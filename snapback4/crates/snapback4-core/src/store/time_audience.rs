//! Private lower-lifetime publication state.
//!
//! `_time_openings` contains only a table name, row id, and boundary. Row
//! payloads stay in `r` and cannot cross a device boundary until the server
//! records the corresponding ordinary partition event.

use super::*;

const CLOCK_KEY: &str = "time_audience_clock";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Opening {
    pub at: i64,
    pub table: String,
    pub id: String,
}

impl Tx<'_> {
    pub(crate) fn time_audience_clock(&self) -> Result<i64, RuntimeError> {
        Ok(self
            .meta(CLOCK_KEY)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(i64::MIN))
    }

    /// Pin one server operation to a durable monotonic clock. The metadata
    /// update is private: by itself it creates no application commit or wake.
    pub(crate) fn pin_time_audience_clock(&self, requested: i64) -> Result<i64, RuntimeError> {
        if !self.server {
            return Ok(requested);
        }
        let pinned = requested.max(self.time_audience_clock()?);
        self.set_meta(CLOCK_KEY, &pinned.to_string())?;
        Ok(pinned)
    }

    /// Maintain the payload-free pending index beside a physical row write.
    /// `now` is the operation's already-pinned server clock.
    pub(crate) fn track_time_audience(
        &self,
        table_name: &str,
        table: &Table,
        row: Option<&Value>,
        now: i64,
    ) -> Result<(), RuntimeError> {
        if !self.server || table.not_before.is_none() {
            return Ok(());
        }
        let id = row
            .map(|row| row.field("id").and_then(Value::as_str))
            .transpose()?;
        if let Some(id) = id {
            self.conn()
                .prepare_cached("DELETE FROM _time_openings WHERE t = ?1 AND id = ?2")?
                .execute(params![table_name, id])?;
            if let Some(at) = row.and_then(|row| table.opens_at(row))
                && at > now
                && row.is_some_and(|row| table.deadline(row).is_none_or(|until| at < until))
            {
                self.conn()
                    .prepare_cached("INSERT INTO _time_openings(at, t, id) VALUES (?1, ?2, ?3)")?
                    .execute(params![at, table_name, id])?;
            }
        }
        Ok(())
    }

    pub(crate) fn remove_time_audience(&self, table: &str, id: &str) -> Result<(), RuntimeError> {
        if self.server {
            self.conn()
                .prepare_cached("DELETE FROM _time_openings WHERE t = ?1 AND id = ?2")?
                .execute(params![table, id])?;
        }
        Ok(())
    }

    pub(crate) fn time_audience_pending(
        &self,
        table: &str,
        id: &str,
    ) -> Result<bool, RuntimeError> {
        if !self.server {
            return Ok(false);
        }
        Ok(self
            .conn()
            .prepare_cached("SELECT 1 FROM _time_openings WHERE t = ?1 AND id = ?2")?
            .query_row(params![table, id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub(crate) fn due_time_audience(&self, now: i64) -> Result<Option<Opening>, RuntimeError> {
        if !self.server {
            return Ok(None);
        }
        Ok(self
            .conn()
            .prepare_cached(
                "SELECT at, t, id FROM _time_openings WHERE at <= ?1 ORDER BY at, t, id LIMIT 1",
            )?
            .query_row([now], |row| {
                Ok(Opening {
                    at: row.get(0)?,
                    table: row.get(1)?,
                    id: row.get(2)?,
                })
            })
            .optional()?)
    }

    pub(crate) fn next_time_audience(&self) -> Result<Option<i64>, RuntimeError> {
        if !self.server {
            return Ok(None);
        }
        Ok(self
            .conn()
            .prepare_cached("SELECT at FROM _time_openings ORDER BY at, t, id LIMIT 1")?
            .query_row([], |row| row.get(0))
            .optional()?)
    }

    /// A schema adoption can add, remove, or redirect a lifetime column. Its
    /// activation transaction rebuilds the private index from physical rows.
    pub(crate) fn rebuild_time_audiences(
        &self,
        schema: &Schema,
        now: i64,
    ) -> Result<(), RuntimeError> {
        if !self.server {
            return Ok(());
        }
        let pending: std::collections::BTreeSet<(i64, String, String)> = self
            .conn()
            .prepare("SELECT at, t, id FROM _time_openings")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<_, _>>()?;
        self.conn().execute("DELETE FROM _time_openings", [])?;
        let mut insert = self
            .conn()
            .prepare_cached("INSERT INTO _time_openings(at, t, id) VALUES (?1, ?2, ?3)")?;
        for (name, table) in schema
            .tables
            .iter()
            .filter(|(_, table)| table.ephemeral.is_none() && table.not_before.is_some())
        {
            let t = self.num(name)?;
            let mut statement = self
                .conn()
                .prepare("SELECT id, data FROM r WHERE t = ?1 ORDER BY id")?;
            let mut rows = statement.query([t])?;
            while let Some(stored) = rows.next()? {
                let id: String = stored.get(0)?;
                let data: String = stored.get(1)?;
                let row: Value = serde_json::from_str(&data)
                    .map_err(|error| RuntimeError::Store(error.to_string()))?;
                if let Some(at) = table.opens_at(&row)
                    && (at > now || pending.contains(&(at, name.clone(), id.clone())))
                    && table.deadline(&row).is_none_or(|until| at < until)
                {
                    insert.execute(params![at, name, id])?;
                }
            }
        }
        Ok(())
    }
}
