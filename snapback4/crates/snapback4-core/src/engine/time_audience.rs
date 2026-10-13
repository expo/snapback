//! Server clock crossings for `not before` tables.

use super::*;

impl Engine {
    /// Advance the server-authoritative lower-lifetime ledger for one host
    /// request. Detached read engines only observe the durable clock floor.
    pub fn advance_time_audiences_at(&mut self, requested: i64) -> Result<i64, RuntimeError> {
        self.advance_time_audience(requested)
    }

    /// The next private wake deadline. It is host scheduling state and never
    /// appears in a query, sync cursor, change answer, or device database.
    pub fn next_time_audience_at(&mut self) -> Result<Option<i64>, RuntimeError> {
        if self.store.conn().is_readonly("main")? {
            return Ok(None);
        }
        let tx = self.store.read_transaction()?;
        let next = tx.next_time_audience()?;
        tx.rollback()?;
        Ok(next)
    }

    pub(crate) fn pin_time_audience(&mut self, requested: i64) -> Result<i64, RuntimeError> {
        if !self
            .schema
            .tables
            .values()
            .any(|table| table.not_before.is_some())
        {
            return Ok(requested);
        }
        if self.store.conn().is_readonly("main")? {
            let floor = self
                .store
                .meta("time_audience_clock")?
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(i64::MIN);
            return Ok(requested.max(floor));
        }
        let tx = self.store.transaction()?;
        let now = tx.pin_time_audience_clock(requested)?;
        tx.commit()?;
        Ok(now)
    }

    /// Pin the request clock and publish at most one due row. One-row commits
    /// are a bounded prefix of the ordered private ledger and have the same
    /// payload/event bound as an ordinary admitted row write.
    pub(crate) fn advance_time_audience(&mut self, requested: i64) -> Result<i64, RuntimeError> {
        if !self
            .schema
            .tables
            .values()
            .any(|table| table.not_before.is_some())
        {
            return Ok(requested);
        }
        if self.store.conn().is_readonly("main")? {
            let floor = self
                .store
                .meta("time_audience_clock")?
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(i64::MIN);
            return Ok(requested.max(floor));
        }

        let tx = self.store.transaction()?;
        let now = tx.pin_time_audience_clock(requested)?;
        let Some(opening) = tx.due_time_audience(now)? else {
            tx.commit()?;
            return Ok(now);
        };

        let row = tx.get(&opening.table, &opening.id)?;
        let current = row.as_ref().filter(|row| {
            self.schema
                .table(&opening.table)
                .is_some_and(|table| table.opens_at(row) == Some(opening.at))
        });
        tx.remove_time_audience(&opening.table, &opening.id)?;

        let Some((_table, row)) = self
            .schema
            .table(&opening.table)
            .zip(current)
            .filter(|(table, row)| table.live(row, now))
        else {
            // Stale/rescheduled/deleted and never-live rows advance only the
            // private ledger and clock, with no public commit or invalidation.
            tx.set_time_audience_published(&opening.table, &opening.id, false)?;
            tx.commit()?;
            return Ok(now);
        };

        let seq = tx.next_seq()?;
        let mut runner = Runner::new(
            &tx,
            &self.schema,
            Context::system().at(now),
            // Structural admission proves one opening fits the ordinary
            // request envelope. Keep runtime accounting bounded as a second
            // check; any failure rolls back the cursor and clock together.
            Meter::new(Ceilings::default(), Cut::Abort),
            seq,
        );
        partition::row_changed(
            &mut runner,
            &opening.table,
            None,
            Some(row),
            write::Origin::Source,
        )?;
        // Publication evidence commits with the put/join events. A failure
        // anywhere below rolls it back together with the consumed opening.
        tx.set_time_audience_published(&opening.table, &opening.id, true)?;
        runner.written_tables.insert(opening.table.clone());
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        let event_bytes = crate::value::canonical_json(&events).len() as u64;
        if events.len() as u64 > crate::schema::time_audience::MAX_OPENING_EVENTS
            || event_bytes > crate::schema::time_audience::MAX_OPENING_BYTES
        {
            return Err(RuntimeError::Schema(format!(
                "time audience opening for {} exceeds its admitted publication envelope",
                opening.table
            )));
        }
        tx.record_commit(
            seq,
            now,
            "time audience",
            crate::SYSTEM_PRINCIPAL,
            "time",
            &tables,
            0,
        )?;
        partition::append(&tx, seq, &events)?;
        tx.commit()?;
        Ok(now)
    }
}
