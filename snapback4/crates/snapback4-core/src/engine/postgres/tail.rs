//! Only post-program bookkeeping is buffered. Row/index/maintain writes still
//! execute immediately, so every program-time read sees earlier writes.
//! @ref LLP 3000.009#4.2 — reuse the reserved head and batch the commit tail.
use super::store::{Tx, signed};
use crate::RuntimeError;

#[derive(Clone, Default)]
pub(super) struct Tail {
    pub commit: Option<Commit>,
    pub partitions: Vec<String>,
    pub ords: Vec<i64>,
    pub tables: Vec<String>,
    pub kinds: Vec<String>,
    pub ids: Vec<String>,
    pub data: Vec<Option<String>>,
    pub effects: Vec<Effect>,
}
#[derive(Clone)]
pub(super) struct Effect {
    pub id: String, pub effect: String, pub payload: String,
    pub next_at: Option<i64>, pub work: String, pub deadline: Option<i64>, pub contract: String,
    pub presence: Vec<(String, i64)>,
    pub release: Option<Option<String>>,
}
#[derive(Clone)]
pub(super) struct Commit {
    pub seq: u64, pub at: i64, pub program: String, pub principal: String,
    pub kind: String, pub touched: String, pub writes: u64, pub footprint: String,
}

impl Tx<'_> {
    pub(super) fn flush_tail(&self) -> Result<(), RuntimeError> {
        self.ensure_active()?;
        let tail = self.tail.borrow();
        let Some(commit) = tail.commit.as_ref() else {
            if !tail.effects.is_empty() || !tail.partitions.is_empty() { return Err(RuntimeError::Store("pending tail records have no commit slot".into())); }
            return Ok(());
        };
        let ids: Vec<_> = tail.effects.iter().map(|e| e.id.as_str()).collect();
        let effects: Vec<_> = tail.effects.iter().map(|e| e.effect.as_str()).collect();
        let payloads: Vec<_> = tail.effects.iter().map(|e| e.payload.as_str()).collect();
        let next_at: Vec<_> = tail.effects.iter().map(|e| e.next_at).collect();
        let work: Vec<_> = tail.effects.iter().map(|e| e.work.as_str()).collect();
        let deadlines: Vec<_> = tail.effects.iter().map(|e| e.deadline).collect();
        let contracts: Vec<_> = tail.effects.iter().map(|e| e.contract.as_str()).collect();
        let explicit_release: Vec<bool> = tail.effects.iter().map(|e| e.release.is_some()).collect();
        let releases: Vec<Option<&str>> = tail.effects.iter().map(|e| e.release.as_ref().and_then(|r| r.as_deref())).collect();
        let mut principals = Vec::new();
        let mut presence_ids = Vec::new();
        let mut presence_deadlines = Vec::new();
        for effect in &tail.effects {
            for (principal, deadline) in &effect.presence {
                principals.push(principal.as_str());
                presence_ids.push(effect.id.as_str());
                presence_deadlines.push(*deadline);
            }
        }
        // Synchronous postgres cannot pipeline independently prepared calls.
        // One data-modifying CTE sends head, commit, all events and effects in
        // one execution. Shared policy inserts and binds receipts before member
        // release; a failed flush still rolls them back with this frame.
        let rows = self.query("WITH head AS (
            UPDATE _head SET seq = $1::bigint WHERE singleton AND seq = $1::bigint - 1 RETURNING seq
        ), committed AS (
            INSERT INTO _commits(seq,at,program,principal,kind,touched,writes) SELECT seq,$2,$3,$4,$5,$6,$7 FROM head RETURNING seq
        ), evidence AS (
            INSERT INTO _change_evidence(seq,footprint) SELECT seq,$26 FROM committed
        ), pruned AS (
            DELETE FROM _change_evidence WHERE seq <= $27 AND EXISTS (SELECT 1 FROM committed)
        ), logged AS (
            INSERT INTO _log(partition,seq,ord,t,kind,id,data) SELECT l.partition,c.seq,l.ord,l.t,l.kind,l.id,l.data FROM committed c
            CROSS JOIN unnest($8::text[],$9::bigint[],$10::text[],$11::text[],$12::text[],$13::text[]) AS l(partition,ord,t,kind,id,data)
        ), effects AS (
            INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at,next_at,work_spec,deadline,contract,release)
            SELECT e.id,c.seq,e.effect,e.payload,'queued',0,$2,e.next_at,e.work,e.deadline,e.contract,CASE WHEN e.explicit_release THEN e.release ELSE (SELECT value FROM _meta WHERE key = 'release') END FROM committed c
            CROSS JOIN unnest($14::text[],$15::text[],$16::text[],$17::bigint[],$18::text[],$19::bigint[],$20::text[],$24::boolean[],$25::text[]) AS e(id,effect,payload,next_at,work,deadline,contract,explicit_release,release)
        ), presence AS (
            INSERT INTO _effect_presence(principal,id,deadline) SELECT p.principal,p.id,p.deadline FROM committed c
            CROSS JOIN unnest($21::text[],$22::text[],$23::bigint[]) AS p(principal,id,deadline)
        ) SELECT count(*) FROM committed", &[
            &signed(commit.seq)?, &commit.at, &commit.program, &commit.principal, &commit.kind, &commit.touched, &signed(commit.writes)?,
            &tail.partitions, &tail.ords, &tail.tables, &tail.kinds, &tail.ids, &tail.data, &ids, &effects, &payloads, &next_at, &work, &deadlines, &contracts, &principals, &presence_ids, &presence_deadlines, &explicit_release, &releases,
            &commit.footprint, &signed(commit.seq.saturating_sub(1000))?,
        ])?;
        if rows[0].get::<_, i64>(0) != 1 {
            return Err(RuntimeError::Store("Postgres commit head changed without a serialization failure".into()));
        }
        let seq = commit.seq;
        drop(tail);
        // The next member must allocate the successor of this completed tail.
        self.head.set(Some(seq));
        *self.tail.borrow_mut() = Tail::default();
        Ok(())
    }
}
