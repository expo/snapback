use super::store::{Tx, decode, signed};
use crate::{
    error::RuntimeError,
    partition::{LogSpan, PartitionRows},
    store::LogEvent,
};
use postgres::types::ToSql;
use std::collections::BTreeMap;

impl Tx<'_> {
    fn log_rows(&self, sql: &'static str, params: &[&(dyn ToSql + Sync)]) -> Result<Vec<LogEvent>, RuntimeError> {
        self.query(sql, params)?
            .into_iter()
            .map(|r| {
                Ok(LogEvent {
                    seq: r.get::<_, i64>(0) as u64,
                    ord: r.get::<_, i64>(1) as u32,
                    table: r.get(2),
                    kind: r.get(3),
                    id: r.get(4),
                    data: r.get::<_, Option<&str>>(5).map(decode).transpose()?,
                })
            })
            .collect()
    }
}

impl PartitionRows for Tx<'_> {
    fn next_seq(&self) -> Result<u64, RuntimeError> {
        if let Some(head) = self.head.get() { return Ok(head + 1); }
        Ok(self.query("SELECT seq FROM _head WHERE singleton", &[])?[0].get::<_, i64>(0) as u64 + 1)
    }

    fn append_log(
        &self,
        partition: &str,
        seq: u64,
        ord: u32,
        table: &str,
        kind: &str,
        id: &str,
        data: Option<&str>,
    ) -> Result<(), RuntimeError> {
        let mut tail = self.tail.borrow_mut();
        debug_assert!(tail.commit.as_ref().is_some_and(|commit| commit.seq == seq), "log event requires its matching commit tail");
        tail.partitions.push(partition.into());
        tail.ords.push(ord as i64);
        tail.tables.push(table.into());
        tail.kinds.push(kind.into());
        tail.ids.push(id.into());
        tail.data.push(data.map(str::to_owned));
        Ok(())
    }

    fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows(
            "SELECT seq,ord,t,kind,id,data FROM _log WHERE partition = $1 AND seq > $2 AND kind IN ('join','scope') ORDER BY seq,ord",
            &[&partition, &signed(after)?],
        )
    }

    fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows("SELECT seq,ord,t,kind,id,data FROM (SELECT seq,ord,t,kind,id,data, ROW_NUMBER() OVER (PARTITION BY t,id ORDER BY seq DESC,ord DESC) AS position FROM _log WHERE partition = $1 AND seq <= $2 AND kind IN ('join','scope')) AS ranked WHERE position = 1", &[&partition, &signed(watermark)?])
    }

    fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> {
        let sequences: Vec<i64> = sequences.iter().map(|s| signed(*s)).collect::<Result<_, _>>()?;
        Ok(self
            .query("SELECT seq,at FROM _commits WHERE seq = ANY($1)", &[&sequences])?
            .iter()
            .map(|r| (r.get::<_, i64>(0) as u64, r.get(1)))
            .collect())
    }

    fn read_log_spans(&self, spans: &[LogSpan], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> {
        let spans = crate::value::canonical_json(&spans);
        self.log_rows(
            "SELECT l.seq,l.ord,l.t,l.kind,l.id,l.data FROM jsonb_array_elements($1::text::jsonb) AS span(value)
            JOIN _log l ON l.partition = span.value->>0 AND l.seq >= (span.value->>1)::bigint
                AND (span.value->>2 IS NULL OR l.seq < (span.value->>2)::bigint)
            JOIN _commits c ON c.seq = l.seq
            WHERE (span.value->>3 IS NULL OR c.at < (span.value->>3)::bigint)
                AND l.seq > $2 AND ($3::bigint IS NULL OR l.seq = $3)
            ORDER BY l.seq,l.ord LIMIT $4",
            &[&spans, &signed(after)?, &only_seq.map(signed).transpose()?, &(limit.min(i64::MAX as usize) as i64)],
        )
    }

    fn group_at(&self, partition: &str, seq: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows(
            "SELECT seq,ord,t,kind,id,data FROM (SELECT seq,ord,t,kind,id,data,
            ROW_NUMBER() OVER (PARTITION BY t,id ORDER BY seq DESC,ord DESC) AS position
            FROM _log WHERE partition = $1 AND seq <= $2 AND kind IN ('put','del')) AS ranked
            WHERE position = 1 AND kind = 'put'",
            &[&partition, &signed(seq)?],
        )
    }
}
