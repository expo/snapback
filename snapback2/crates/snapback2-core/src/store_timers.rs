use crate::store_jobs::decode;
use crate::timers::{Schedule, Timer, Trigger};
use crate::{RuntimeError, Schema, Store, Value, digest};
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) fn create(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _timers (
        id TEXT PRIMARY KEY, schedule TEXT NOT NULL, row_id TEXT, at INTEGER NOT NULL,
        period_start INTEGER, generation TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS _timers_at ON _timers(at,id);
        CREATE INDEX IF NOT EXISTS _timers_schedule_row ON _timers(schedule,row_id);",
    )
}
pub(crate) fn save(conn: &Connection, timer: &Timer) -> Result<(), RuntimeError> {
    conn.execute("INSERT INTO _timers(id,schedule,row_id,at,period_start,generation) VALUES (?1,?2,?3,?4,?5,?6)
        ON CONFLICT(id) DO UPDATE SET at=excluded.at,period_start=excluded.period_start,generation=excluded.generation",
        params![timer.id,timer.schedule,timer.row_id,timer.at,timer.period_start,timer.generation])?;
    Ok(())
}
pub(crate) fn get(conn: &Connection, id: &str) -> Result<Option<Timer>, RuntimeError> {
    let json: Option<String> = conn.query_row("SELECT json_object('id',id,'schedule',schedule,'rowId',row_id,'at',at,'periodStart',period_start,'generation',generation) FROM _timers WHERE id=?1",[id],|r|r.get(0)).optional()?;
    json.as_deref().map(decode).transpose()
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the deadline index follows its row in the same transaction; unchanged deadlines never resurrect settled occurrences.
pub(crate) fn maintain(
    conn: &Connection,
    schema: &Schema,
    table: &str,
    old: Option<&Value>,
    new: Option<&Value>,
) -> Result<u64, RuntimeError> {
    let mut writes = 0;
    for schedule in &schema.schedules {
        let Trigger::Row {
            table: source,
            column,
        } = &schedule.trigger
        else {
            continue;
        };
        if source != table {
            continue;
        }
        let deadline = |row: Option<&Value>| {
            row.and_then(|r| r.as_object().ok()?.get(column))
                .cloned()
                .unwrap_or(Value::Null)
        };
        let before = deadline(old);
        let after = deadline(new);
        if before == after {
            continue;
        }
        let id = new.or(old).unwrap().field("id")?.as_str()?.to_owned();
        conn.execute(
            "DELETE FROM _timers WHERE schedule=?1 AND row_id=?2",
            params![schedule.name, id],
        )?;
        if let Value::Int(at) = after {
            save(
                conn,
                &Timer {
                    id: format!("t_{}", digest(&(&schedule.name, &id, at))),
                    schedule: schedule.name.clone(),
                    row_id: Some(id),
                    at,
                    period_start: None,
                    generation: schema.hash(),
                },
            )?;
        }
        // Logical index replacement is one engine write, like application reindexing.
        writes += 1;
    }
    Ok(writes)
}

fn empty_reset(conn: &Connection) -> Result<bool, RuntimeError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _meta WHERE key='reset_empty')",
        [],
        |row| row.get(0),
    )?)
}

// @ref LLP 1021#6-the-adjacent-traps — an explicit empty reset stays dormant through restart and successors until a row exists.
pub(crate) fn resume_after_empty(conn: &Connection, now: i64) -> Result<(), RuntimeError> {
    if empty_reset(conn)?
        && conn.query_row("SELECT EXISTS(SELECT 1 FROM rows)", [], |row| {
            row.get::<_, bool>(0)
        })?
    {
        conn.execute("DELETE FROM _meta WHERE key='reset_empty'", [])?;
        let schema: String = conn.query_row(
            "SELECT value FROM _meta WHERE key='schema_json'",
            [],
            |row| row.get(0),
        )?;
        reconcile(conn, &Schema::default(), &decode::<Schema>(&schema)?, now)?;
    }
    Ok(())
}

pub(crate) fn reconcile(
    conn: &Connection,
    old: &Schema,
    next: &Schema,
    now: i64,
) -> Result<(), RuntimeError> {
    if empty_reset(conn)? {
        return Ok(());
    }
    for previous in &old.schedules {
        if next
            .schedules
            .iter()
            .all(|s| s.name != previous.name || s.trigger != previous.trigger)
        {
            conn.execute("DELETE FROM _timers WHERE schedule=?1", [&previous.name])?;
        }
    }
    for schedule in &next.schedules {
        if old
            .schedules
            .iter()
            .any(|s| s.name == schedule.name && s.trigger == schedule.trigger)
        {
            conn.execute(
                "UPDATE _timers SET generation=?2 WHERE schedule=?1",
                params![schedule.name, next.hash()],
            )?;
            continue;
        }
        match &schedule.trigger {
            Trigger::Row { table, .. } => {
                let isolated = Schema {
                    schedules: vec![schedule.clone()],
                    ..next.clone()
                };
                crate::successor::for_row_batches(conn, table, |row| {
                    maintain(conn, &isolated, table, None, Some(&row)).map(|_| ())
                })?;
                conn.execute(
                    "UPDATE _timers SET generation=?2 WHERE schedule=?1",
                    params![schedule.name, next.hash()],
                )?;
            }
            Trigger::Every { duration_ms } => save(
                conn,
                &Timer {
                    id: format!("t_{}", digest(&(&schedule.name, "period"))),
                    schedule: schedule.name.clone(),
                    row_id: None,
                    at: now.saturating_add(*duration_ms),
                    period_start: Some(now),
                    generation: next.hash(),
                },
            )?,
        }
    }
    Ok(())
}
impl Store {
    pub fn timer(&self, id: &str) -> Result<Option<Timer>, RuntimeError> {
        get(&self.conn, id)
    }
    pub fn due_timers(&self, now: i64, limit: usize) -> Result<Vec<Timer>, RuntimeError> {
        let mut statement = self
            .conn
            .prepare("SELECT id FROM _timers WHERE at<=?1 ORDER BY at,id LIMIT ?2")?;
        let ids = statement
            .query_map(params![now, limit.min(64) as i64], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| {
                get(&self.conn, id)?.ok_or_else(|| RuntimeError::Input("timer disappeared".into()))
            })
            .collect()
    }
    pub fn next_timer_at(&self) -> Result<Option<i64>, RuntimeError> {
        Ok(self
            .conn
            .query_row("SELECT MIN(at) FROM _timers", [], |r| r.get(0))?)
    }
    pub fn timer_status(&self, now: i64) -> Result<serde_json::Value, RuntimeError> {
        let due: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM _timers WHERE at<=?1", [now], |r| {
                    r.get(0)
                })?;
        let rejected:i64=self.conn.query_row("SELECT COUNT(*) FROM _commits WHERE kind='schedule' AND json_extract(schedule,'$.outcome.state')='rejected'",[],|r|r.get(0))?;
        Ok(serde_json::json!({"due":due,"next_at":self.next_timer_at()?,"rejected":rejected}))
    }
    /// Per-schedule counts for every declared schedule, a schedule with no timer row at zero:
    /// a row schedule whose deadlines have all fired is still declared, and the operator sees it.
    pub fn timers_summary(
        &self,
        now: i64,
        schedules: &[Schedule],
    ) -> Result<serde_json::Value, RuntimeError> {
        let mut summary = self.timer_status(now)?;
        let mut statement = self.conn.prepare(
            "SELECT schedule,COUNT(*),SUM(at<=?1),MIN(at) FROM _timers GROUP BY schedule",
        )?;
        let mut counts = statement
            .query_map([now], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, Option<i64>>(3)?,
                    ),
                ))
            })?
            .collect::<Result<std::collections::BTreeMap<_, _>, _>>()?;
        let mut names: Vec<String> = schedules.iter().map(|s| s.name.clone()).collect();
        names.extend(counts.keys().cloned());
        names.sort();
        names.dedup();
        let counts = names
            .into_iter()
            .take(100)
            .map(|name| {
                let (count, due, next_at) = counts.remove(&name).unwrap_or((0, 0, None));
                serde_json::json!({"schedule":name,"count":count,"due":due,"next_at":next_at})
            })
            .collect::<Vec<_>>();
        summary["schedules"] = serde_json::json!(counts);
        summary["next"] = match self
            .conn
            .query_row("SELECT id FROM _timers ORDER BY at,id LIMIT 1", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
        {
            Some(id) => serde_json::json!(self.timer(&id)?),
            None => serde_json::Value::Null,
        };
        summary["limit"] = 100.into();
        Ok(summary)
    }
    pub fn timer_trace(&self, id: &str) -> Result<serde_json::Value, RuntimeError> {
        let mut statement=self.conn.prepare("SELECT seq,schedule FROM _commits WHERE kind='schedule' AND json_extract(schedule,'$.timer')=?1 ORDER BY seq DESC LIMIT 100")?;
        let rows = statement
            .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        let firings = rows
            .into_iter()
            .map(|(seq, row)| {
                let mut v: serde_json::Value = decode(&row)?;
                v["seq"] = seq.into();
                Ok(v)
            })
            .collect::<Result<Vec<_>, RuntimeError>>()?;
        Ok(serde_json::json!({"timer":self.timer(id)?,"firings":firings,"limit":100}))
    }
    pub fn schedule_receipt(&self) -> Result<serde_json::Value, RuntimeError> {
        let (fired,late,rejected):(i64,i64,i64)=self.conn.query_row("SELECT COUNT(*),COALESCE(SUM(json_extract(schedule,'$.latenessMs')>0),0),COALESCE(SUM(json_extract(schedule,'$.outcome.state')='rejected'),0) FROM _commits WHERE kind='schedule'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        Ok(serde_json::json!({"fired":fired,"late":late,"rejected":rejected}))
    }
}
