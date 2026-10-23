//! Semantic facts used by the common engine, including insert-then-bind receipts.
// @ref LLP 3000.009.001.000#3.4 — the port never exposes a driver to shared policy.
use super::store::{Tx, signed, decode, absent_text_key};
use crate::{RuntimeError, Value, ledger::LedgerReader, partition::PartitionRows, receipts::ReceiptTransaction};
impl Tx<'_> {
    pub(crate) fn begin_member_evidence(&self) {
        *self.changes.borrow_mut() = Default::default();
        if self.group_head.get().is_some() {
            *self.receipt_cache.borrow_mut() = None;
            *self.authority_cache.borrow_mut() = None;
            *self.placement_cache.borrow_mut() = None;
            *self.read_cache.borrow_mut() = Default::default();
            self.rows_cache.borrow_mut().clear();
        }
    }
    pub(crate) fn abandon(&self) -> Result<(), RuntimeError> { self.ensure_active() }
    pub(crate) fn savepoint(&self, name: &str) -> Result<(), RuntimeError> {
        validate_name(name)?;
        self.defer_control(&format!("SAVEPOINT {name}"))?;
        self.savepoints.borrow_mut().push((name.into(), Checkpoint { head: self.head.get(), tail: self.tail.borrow().clone(), group_len: self.group_tails.borrow().len(), changes: self.changes.borrow().clone() }));
        Ok(())
    }
    pub(crate) fn release(&self, name: &str) -> Result<(), RuntimeError> {
        validate_name(name)?;
        let index = self.savepoints.borrow().iter().rposition(|(n, _)| n == name)
            .ok_or_else(|| RuntimeError::Store("unknown savepoint".into()))?;
        // Flush while this frame can still roll back all of its bookkeeping.
        if name == "member" && self.group_head.get().is_some() {
            self.group_member_complete();
            self.defer_control("RELEASE SAVEPOINT member")?;
        } else if name == "member" {
            self.flush_tail_end("RELEASE SAVEPOINT member; SET LOCAL statement_timeout = 0; SET LOCAL lock_timeout = 0")?;
            self.commit_settings.set(true);
        } else { self.defer_control(&format!("RELEASE SAVEPOINT {name}"))?; }
        self.savepoints.borrow_mut().truncate(index);
        Ok(())
    }
    pub(crate) fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        validate_name(name)?;
        let index = self.savepoints.borrow().iter().rposition(|(n, _)| n == name)
            .ok_or_else(|| RuntimeError::Store("unknown savepoint".into()))?;
        self.rollback_named(name)?;
        let mut frames = self.savepoints.borrow_mut();
        let checkpoint = frames[index].1.clone();
        frames.truncate(index);
        self.head.set(checkpoint.head);
        self.group_tails.borrow_mut().truncate(checkpoint.group_len);
        *self.tail.borrow_mut() = checkpoint.tail;
        *self.changes.borrow_mut() = checkpoint.changes;
        // Match SQLite's conservative treatment of a recovered savepoint:
        // partial interpreter writes must never regain certification.
        self.changes.borrow_mut().widen();
        Ok(())
    }
    pub(crate) fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        Ok(self.rows_limited(table, i64::MAX as usize)?.0)
    }
    pub(crate) fn rows_limited(&self, table: &str, limit: usize) -> Result<(Vec<Value>, bool), RuntimeError> {
        if absent_text_key(&[table]) { return Ok((Vec::new(), false)); }
        let n = limit.saturating_add(1).min(i64::MAX as usize) as i64;
        let mut rows = self.query("SELECT data FROM r WHERE t=$1 ORDER BY id LIMIT $2", &[&table, &n])?.iter().map(|r| decode(r.get(0))).collect::<Result<Vec<Value>,_>>()?;
        let more = rows.len() > limit; rows.truncate(limit); Ok((rows, more))
    }
    pub(crate) fn count(&self, table: &str) -> Result<u64, RuntimeError> {
        if absent_text_key(&[table]) { return Ok(0); }
        Ok(self.query("SELECT COUNT(*) FROM r WHERE t=$1", &[&table])?[0].get::<_, i64>(0) as u64)
    }
    pub(crate) fn applied_ops(&self) -> Result<u64, RuntimeError> {
        Ok(self.query("SELECT COUNT(*) FROM _ops", &[])?[0].get::<_, i64>(0) as u64)
    }
    pub(crate) fn read_log(&self, partition: &str, after: u64, limit: usize) -> Result<Vec<crate::store_port::LogEvent>, RuntimeError> {
        self.read_log_spans(&[(partition.to_owned(), 0, None, None)], after, None, limit)
    }
}
impl LedgerReader for Tx<'_> {
    fn commits_after(&self, after: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        self.query("SELECT seq,touched FROM _commits WHERE seq>$1 ORDER BY seq LIMIT $2", &[&signed(after)?, &(limit.min(i64::MAX as usize) as i64)])?.iter().map(|r| Ok((r.get::<_, i64>(0) as u64, decode(r.get(1))?))).collect()
    }
}
impl ReceiptTransaction for Tx<'_> {
    fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError> {
        *self.receipt_cache.borrow_mut() = None;
        if self.group_head.get().is_some() {
            self.tail.borrow_mut().receipts.push(super::group_tail::Receipt { principal: principal.into(), id: id.into(), seq,
                outcome: outcome.into(), name: None, args_digest: None, at: 0 });
            return Ok(());
        }
        self.defer_one("INSERT INTO _ops(principal,id,seq,outcome,at) VALUES ($1,$2,$3,$4,0)", &[&principal, &id, &signed(seq)?, &outcome])
    }
    fn bind_applied(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value, at: i64) -> Result<(), RuntimeError> {
        *self.receipt_cache.borrow_mut() = None;
        if self.group_head.get().is_some() {
            let mut tail = self.tail.borrow_mut();
            let receipt = tail.receipts.iter_mut().rev().find(|r| r.principal == principal && r.id == id)
                .ok_or_else(||RuntimeError::Store("group receipt binding without its insert".into()))?;
            receipt.name = Some(name.into()); receipt.args_digest = Some(crate::receipts::payload_digest(args)); receipt.at = at;
            return Ok(());
        }
        self.defer_one("UPDATE _ops SET name=$3,args_digest=$4,at=$5 WHERE principal=$1 AND id=$2", &[&principal, &id, &name, &crate::receipts::payload_digest(args), &at])
    }
}

#[derive(Clone)]
pub(super) struct Checkpoint {
    head: Option<u64>,
    tail: super::tail::Tail,
    group_len: usize,
    changes: crate::revocation::Recorder,
}
fn validate_name(name: &str) -> Result<(), RuntimeError> {
    let mut bytes = name.bytes();
    if bytes.next().is_some_and(|b| b.is_ascii_lowercase() || b == b'_')
        && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') { return Ok(()); }
    Err(RuntimeError::Store("invalid savepoint name".into()))
}
