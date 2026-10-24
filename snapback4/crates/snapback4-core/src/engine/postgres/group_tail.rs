//! One verified vector tail, followed by a separate, uncancellable COMMIT.
// @ref LLP 3000.009.001.000.002#3.2 — preserve every intermediate commit/image; advance the head once.
use super::store::{Tx, signed};
use crate::RuntimeError;
use serde_json::json;

pub(super) const SQL: &str = r#"WITH
head AS (UPDATE _head SET seq=$3 WHERE singleton AND seq=$2 RETURNING seq),
images AS (
 UPDATE r SET data=w.data FROM jsonb_to_recordset(($1::text::jsonb)->'images') AS w(t text,id text,data text)
 CROSS JOIN head WHERE r.t=w.t AND r.id=w.id RETURNING r.id
),
committed AS (
 INSERT INTO _commits(seq,at,program,principal,kind,touched,writes)
 SELECT c.seq,c.at,c.program,c.principal,c.kind,c.touched,c.writes
 FROM jsonb_to_recordset(($1::text::jsonb)->'commits') AS c(seq bigint,at bigint,program text,principal text,kind text,touched text,writes bigint)
 CROSS JOIN head RETURNING seq
), evidence AS (
 INSERT INTO _change_evidence(seq,footprint)
 SELECT c.seq,c.footprint FROM jsonb_to_recordset(($1::text::jsonb)->'commits') AS c(seq bigint,footprint text)
 JOIN committed USING(seq) RETURNING seq
), pruned AS (
 DELETE FROM _change_evidence WHERE seq <= $3-1000 AND EXISTS(SELECT 1 FROM committed)
), logged AS (
 INSERT INTO _log(partition,seq,ord,t,kind,id,data)
 SELECT l.partition,l.seq,l.ord,l.t,l.kind,l.id,l.data
 FROM jsonb_to_recordset(($1::text::jsonb)->'log') AS l(partition text,seq bigint,ord bigint,t text,kind text,id text,data text)
 JOIN committed USING(seq) RETURNING seq
), effects AS (
 INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at,next_at,work_spec,deadline,contract,release)
 SELECT e.id,e.seq,e.effect,e.payload,'queued',0,e.at,e.next_at,e.work,e.deadline,e.contract,
 CASE WHEN e.explicit_release THEN e.release ELSE (SELECT value FROM _meta WHERE key='release') END
 FROM jsonb_to_recordset(($1::text::jsonb)->'effects') AS e(id text,seq bigint,effect text,payload text,at bigint,next_at bigint,work text,deadline bigint,contract text,explicit_release bool,release text)
 JOIN committed USING(seq) RETURNING id
), presence AS (
 INSERT INTO _effect_presence(principal,id,deadline)
 SELECT p.principal,p.id,p.deadline FROM jsonb_to_recordset(($1::text::jsonb)->'presence') AS p(principal text,id text,deadline bigint)
 JOIN effects USING(id) RETURNING id
), receipts AS (
 INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at)
 SELECT r.principal,r.id,r.seq,r.outcome,r.name,r.args_digest,r.at
 FROM jsonb_to_recordset(($1::text::jsonb)->'receipts') AS r(principal text,id text,seq bigint,outcome text,name text,args_digest text,at bigint)
 CROSS JOIN head RETURNING id
)
SELECT (SELECT count(*) FROM head),(SELECT count(*) FROM committed),(SELECT count(*) FROM evidence),
 (SELECT count(*) FROM logged),(SELECT count(*) FROM effects),(SELECT count(*) FROM presence),(SELECT count(*) FROM receipts),(SELECT count(*) FROM images)"#;

#[derive(Clone, serde::Serialize)]
pub(super) struct Receipt {
    pub principal: String,
    pub id: String,
    pub seq: u64,
    pub outcome: String,
    pub name: Option<String>,
    pub args_digest: Option<String>,
    pub at: i64,
}
impl Tx<'_> {
    pub(crate) fn enable_group_tail(&self) -> Result<(), RuntimeError> {
        self.ensure_active()?;
        if !self.serialized_head.get() {
            return Err(RuntimeError::Store(
                "group tail requires the reserved serial head".into(),
            ));
        }
        self.group_head.set(self.head.get());
        Ok(())
    }
    pub(crate) fn group_member_complete(&self) {
        let tail = std::mem::take(&mut *self.tail.borrow_mut());
        if let Some(commit) = &tail.commit {
            self.head.set(Some(commit.seq));
        }
        self.group_tails.borrow_mut().push(tail);
    }
    pub(super) fn flush_group_tail(&self) -> Result<(), RuntimeError> {
        let Some(first) = self.group_head.get() else {
            return Ok(());
        };
        let tails = self.group_tails.borrow();
        if tails.is_empty() {
            return Ok(());
        }
        let mut commits = Vec::new();
        let mut log = Vec::new();
        let mut effects = Vec::new();
        let mut presence = Vec::new();
        let mut receipts = Vec::new();
        let mut last = first;
        for tail in tails.iter() {
            if let Some(commit) = &tail.commit {
                if commit.seq != last + 1 {
                    return Err(RuntimeError::Store("non-contiguous group tail".into()));
                }
                last = commit.seq;
                commits.push(json!(commit));
                for n in 0..tail.partitions.len() {
                    log.push(json!({"partition":tail.partitions[n],"seq":commit.seq,"ord":tail.ords[n],"t":tail.tables[n],"kind":tail.kinds[n],"id":tail.ids[n],"data":tail.data[n]}));
                }
                for effect in &tail.effects {
                    effects.push(json!({"seq":commit.seq,"at":commit.at,"id":effect.id,"effect":effect.effect,"payload":effect.payload,"next_at":effect.next_at,"work":effect.work,"deadline":effect.deadline,"contract":effect.contract,"explicit_release":effect.release.is_some(),"release":effect.release.as_ref().and_then(|v|v.as_ref())}));
                    for (principal, deadline) in &effect.presence {
                        presence.push(
                            json!({"principal":principal,"id":effect.id,"deadline":deadline}),
                        );
                    }
                }
            } else if !tail.partitions.is_empty() || !tail.effects.is_empty() {
                return Err(RuntimeError::Store("tail records without a commit".into()));
            }
            receipts.extend(tail.receipts.iter().map(|r| json!(r)));
        }
        let expected = [
            1,
            commits.len(),
            commits.len(),
            log.len(),
            effects.len(),
            presence.len(),
            receipts.len(),
            self.group_images.borrow().len(),
        ];
        let images=self.group_images.borrow().iter().map(|image|json!({"t":image.table,"id":image.new.field("id").unwrap().as_str().unwrap(),"data":crate::value::canonical_json(&image.new)})).collect::<Vec<_>>();
        let payload = json!({"commits":commits,"log":log,"effects":effects,"presence":presence,"receipts":receipts,"images":images}).to_string();
        let sets = self.flight(
            &[(SQL, &[&payload, &signed(first)?, &signed(last)?])],
            "SET LOCAL statement_timeout=0; SET LOCAL lock_timeout=0",
        )?;
        let row = sets[0]
            .rows
            .first()
            .ok_or_else(|| RuntimeError::Store("missing group tail counts".into()))?;
        for (column, count) in expected.into_iter().enumerate() {
            if row.get::<_, i64>(column) != count as i64 {
                return Err(RuntimeError::Store(format!(
                    "group tail count mismatch at {column}"
                )));
            }
        }
        drop(tails);
        self.group_tails.borrow_mut().clear();
        self.group_images.borrow_mut().clear();
        self.group_head.set(Some(last));
        self.commit_settings.set(true);
        Ok(())
    }
}
