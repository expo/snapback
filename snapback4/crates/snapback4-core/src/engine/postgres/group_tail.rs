//! One verified vector tail, followed by a separate, uncancellable COMMIT.
// @ref LLP 3000.009.001.000.002#3.2 — preserve every intermediate commit/image; advance the head once.
// @ref LLP 3000.009.001.000.000.002#3.4 — ticket batches advance the complete head identity with one exact CAS.
use super::store::{Tx, signed};
use crate::RuntimeError;

macro_rules! tail_sql { ($update:literal, $head:literal, $publication:literal) => { concat!(r#"WITH
head AS ("#, $update, $head, r#"),
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
 DELETE FROM _change_evidence WHERE seq > $2-1000 AND seq <= $3-1000 AND EXISTS(SELECT 1 FROM committed)
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
 (SELECT count(*) FROM logged),(SELECT count(*) FROM effects),(SELECT count(*) FROM presence),(SELECT count(*) FROM receipts),(SELECT count(*) FROM images)"#, $publication) }; }
pub(super) const SQL: &str = tail_sql!("UPDATE _head SET seq=$3 WHERE singleton AND seq=$2 ", "RETURNING seq", "");
const PUBLICATION_SQL: &str = tail_sql!("UPDATE _head SET seq=$3 WHERE singleton AND seq=$2 ", "RETURNING seq,revision", r#",
 (SELECT revision FROM head),(SELECT seq FROM head),(SELECT generation FROM _backend WHERE singleton),
 (SELECT value FROM _meta WHERE key='store_id'),(SELECT value FROM _meta WHERE key='schema_hash'),(SELECT value FROM _meta WHERE key='activation_hash')"#);
const CAS_SQL: &str = tail_sql!("UPDATE _head SET seq=$3,revision=$4,attempt=$5 WHERE singleton AND seq OPERATOR(pg_catalog.=) $2 AND revision OPERATOR(pg_catalog.=) $6 AND attempt OPERATOR(pg_catalog.=) $7 ", "RETURNING seq", "");
const CAS_PUBLICATION_SQL: &str = tail_sql!("UPDATE _head SET seq=$3,revision=$4,attempt=$5 WHERE singleton AND seq OPERATOR(pg_catalog.=) $2 AND revision OPERATOR(pg_catalog.=) $6 AND attempt OPERATOR(pg_catalog.=) $7 ", "RETURNING seq,revision", r#",
 (SELECT revision FROM head),(SELECT seq FROM head),(SELECT generation FROM _backend WHERE singleton),
 (SELECT value FROM _meta WHERE key='store_id'),(SELECT value FROM _meta WHERE key='schema_hash'),(SELECT value FROM _meta WHERE key='activation_hash')"#);

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
#[derive(serde::Serialize)]
struct Log<'a> {
    partition: &'a str,
    seq: u64,
    ord: i64,
    t: &'a str,
    kind: &'a str,
    id: &'a str,
    data: &'a Option<String>,
}
#[derive(serde::Serialize)]
struct Effect<'a> {
    seq: u64,
    at: i64,
    id: &'a str,
    effect: &'a str,
    payload: &'a str,
    next_at: Option<i64>,
    work: &'a str,
    deadline: Option<i64>,
    contract: &'a str,
    explicit_release: bool,
    release: Option<&'a str>,
}
#[derive(serde::Serialize)]
struct Presence<'a> {
    principal: &'a str,
    id: &'a str,
    deadline: i64,
}
#[derive(serde::Serialize)]
struct Image<'a> {
    t: &'a str,
    id: &'a str,
    data: String,
}
#[derive(serde::Serialize)]
struct Payload<'a> {
    commits: Vec<&'a super::tail::Commit>,
    log: Vec<Log<'a>>,
    effects: Vec<Effect<'a>>,
    presence: Vec<Presence<'a>>,
    receipts: Vec<&'a Receipt>,
    images: Vec<Image<'a>>,
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
        if tails.is_empty() && (self.batch_ticket.is_none() || self.commit_settings.get()) {
            return Ok(());
        }
        // @ref LLP 3000.009.001.000.002#4.1 — completed receipt-only members count too; aborted members have no tail slot.
        if self.batch_ticket.is_none() { self.defer_revision(tails.len())?; }
        else { self.revisions.set(tails.len() as u64); }
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
                commits.push(commit);
                for n in 0..tail.partitions.len() {
                    log.push(Log {
                        partition: &tail.partitions[n],
                        seq: commit.seq,
                        ord: tail.ords[n],
                        t: &tail.tables[n],
                        kind: &tail.kinds[n],
                        id: &tail.ids[n],
                        data: &tail.data[n],
                    });
                }
                for effect in &tail.effects {
                    effects.push(Effect {
                        seq: commit.seq,
                        at: commit.at,
                        id: &effect.id,
                        effect: &effect.effect,
                        payload: &effect.payload,
                        next_at: effect.next_at,
                        work: &effect.work,
                        deadline: effect.deadline,
                        contract: &effect.contract,
                        explicit_release: effect.release.is_some(),
                        release: effect.release.as_ref().and_then(|v| v.as_deref()),
                    });
                    for (principal, deadline) in &effect.presence {
                        presence.push(Presence {
                            principal,
                            id: &effect.id,
                            deadline: *deadline,
                        });
                    }
                }
            } else if !tail.partitions.is_empty() || !tail.effects.is_empty() {
                return Err(RuntimeError::Store("tail records without a commit".into()));
            }
            receipts.extend(tail.receipts.iter());
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
        // Serialize borrowed records directly: no per-field JSON tree or
        // duplicate strings between the per-member tails and the wire payload.
        let payload = {
            let images = self.group_images.borrow();
            let images = images
                .iter()
                .map(|image| Image {
                    t: &image.table,
                    id: image.new.field("id").unwrap().as_str().unwrap(),
                    data: crate::value::canonical_json(&image.new),
                })
                .collect();
            serde_json::to_string(&Payload {
                commits,
                log,
                effects,
                presence,
                receipts,
                images,
            })
            .unwrap()
        };
        let sets = if self.batch_ticket.is_some() {
            let base = self.batch_base.borrow();
            let base = base.as_ref().ok_or_else(|| RuntimeError::Store("missing ticket batch head".into()))?;
            if base.seq != signed(first)? { return Err(RuntimeError::Store("ticket batch base seq changed".into())); }
            let revision = base.revision.checked_add(tails.len() as i64).ok_or_else(||RuntimeError::Store("revision overflow".into()))?;
            let attempt = self.attempt.borrow();
            let predecessor = self.predecessor_ticket;
            let predecessor_params: &[&(dyn postgres::types::ToSql + Sync)] = &[&predecessor];
            let identity_params: &[&(dyn postgres::types::ToSql + Sync)] = &[];
            let tail_params: &[&(dyn postgres::types::ToSql + Sync)] = &[&payload, &signed(first)?, &signed(last)?, &revision, &*attempt, &base.revision, &base.attempt];
            let mut commands = Vec::new();
            if predecessor.is_some() { commands.push((super::group_commit::TICKET, predecessor_params)); }
            commands.extend([
                (super::group_commit::IDENTITY, identity_params),
                (if self.publication_enabled() { CAS_PUBLICATION_SQL } else { CAS_SQL },
                 tail_params),
            ]);
            let mut sets = self.flight(&commands, "SET LOCAL statement_timeout=0; SET LOCAL lock_timeout=0")?;
            if predecessor.is_some() { sets.remove(0); }
            let identity = &sets[0].rows[0];
            self.check_batch_identity(identity.get(0), identity.get(1))?;
            if sets[1].rows.first().is_some_and(|row| row.get::<_,i64>(0)==0) {
                let observed=self.query(super::group_commit::HEAD, &[])?.remove(0);
                return Err(RuntimeError::Store(format!(
                    "ticket head CAS mismatch: expected ({},{},{}), observed ({},{},{})",
                    base.seq, base.revision, base.attempt,
                    observed.get::<_,i64>(0), observed.get::<_,i64>(1), observed.get::<_,String>(2))));
            }
            sets.into_iter().skip(1).collect::<Vec<_>>()
        } else { self.flight(
            &[(if self.publication_enabled() { PUBLICATION_SQL } else { SQL }, &[&payload, &signed(first)?, &signed(last)?])],
            "SET LOCAL statement_timeout=0; SET LOCAL lock_timeout=0",
        )? };
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
        self.capture_tail_publication(row, 8)?;
        drop(tails);
        self.group_tails.borrow_mut().clear();
        self.group_images.borrow_mut().clear();
        self.group_head.set(Some(last));
        self.commit_settings.set(true);
        Ok(())
    }
}
