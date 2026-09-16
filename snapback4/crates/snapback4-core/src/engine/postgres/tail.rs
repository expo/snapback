//! Only post-program bookkeeping is buffered. Row/index/maintain writes still
//! execute immediately, so every program-time read sees earlier writes.
//! @ref LLP 3000.009#4.2 — reuse the reserved head and batch the commit tail.
use super::store::{Tx, signed};
use crate::{RuntimeError, Value, value::canonical_json};

#[derive(Default)]
pub(super) struct Tail {
    pub commit: Option<Commit>,
    pub partitions: Vec<String>,
    pub ords: Vec<i64>,
    pub tables: Vec<String>,
    pub kinds: Vec<String>,
    pub ids: Vec<String>,
    pub data: Vec<Option<String>>,
    pub effects: Vec<(String, String, Value)>,
}
pub(super) struct Commit {
    pub seq: u64, pub at: i64, pub program: String, pub principal: String,
    pub kind: String, pub touched: String, pub writes: u64,
}

impl Tx<'_> {
    pub(super) fn flush_tail(&self) -> Result<(), RuntimeError> {
        let tail = std::mem::take(&mut *self.tail.borrow_mut());
        let Some(commit) = tail.commit else { return Ok(()) };
        let ids: Vec<_> = tail.effects.iter().map(|e| e.0.as_str()).collect();
        let effects: Vec<_> = tail.effects.iter().map(|e| e.1.as_str()).collect();
        let payloads: Vec<_> = tail.effects.iter().map(|e| canonical_json(&e.2)).collect();
        // Synchronous postgres cannot pipeline independently prepared calls.
        // One data-modifying CTE sends head, commit, all events and effects in
        // one execution. The protected receipt writer remains the next call.
        let rows = self.query("WITH head AS (
            UPDATE _head SET seq = $1::bigint WHERE singleton AND seq = $1::bigint - 1 RETURNING seq
        ), committed AS (
            INSERT INTO _commits SELECT seq,$2,$3,$4,$5,$6,$7 FROM head RETURNING seq
        ), logged AS (
            INSERT INTO _log SELECT l.partition,c.seq,l.ord,l.t,l.kind,l.id,l.data FROM committed c
            CROSS JOIN unnest($8::text[],$9::bigint[],$10::text[],$11::text[],$12::text[],$13::text[]) AS l(partition,ord,t,kind,id,data)
        ), effects AS (
            INSERT INTO _outbox SELECT e.id,c.seq,e.effect,e.payload,'queued',0,$2 FROM committed c
            CROSS JOIN unnest($14::text[],$15::text[],$16::text[]) AS e(id,effect,payload)
        ) SELECT count(*) FROM committed", &[
            &signed(commit.seq)?, &commit.at, &commit.program, &commit.principal, &commit.kind, &commit.touched, &signed(commit.writes)?,
            &tail.partitions, &tail.ords, &tail.tables, &tail.kinds, &tail.ids, &tail.data, &ids, &effects, &payloads,
        ])?;
        if rows[0].get::<_, i64>(0) != 1 {
            return Err(RuntimeError::Store("Postgres commit head changed without a serialization failure".into()));
        }
        Ok(())
    }
}
