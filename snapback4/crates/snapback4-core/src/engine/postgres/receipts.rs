//! Receipt facts use the shared reader and replay policy, including legacy unbound rows.
// @ref LLP 3000.009.001.000#3.3 — one replay policy above both adapters.
use super::store::{Store, Tx, absent_text_key};
use crate::{
    RuntimeError,
    receipts::{ReceiptReader, ReceiptRecord, sent_state},
};
use std::cell::RefCell;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    if !tx.query("SELECT to_regclass('_ops') IS NOT NULL", &[])?[0].get::<_, bool>(0) {
        tx.batch("CREATE TABLE _ops (principal TEXT COLLATE \"C\" NOT NULL, id TEXT COLLATE \"C\" NOT NULL, seq BIGINT NOT NULL, outcome TEXT NOT NULL, name TEXT, args_digest TEXT, at BIGINT NOT NULL, PRIMARY KEY(principal,id))")?;
        return Ok(());
    }
    // The evaluation layout originally required both binding columns. Permit
    // legacy NULL bindings, as SQLite does; avoid no-op ALTER on every reopen.
    let bindings = tx.query("SELECT attname::text,attnotnull FROM pg_attribute WHERE attrelid=to_regclass('_ops') AND attname IN ('name','args_digest') AND NOT attisdropped", &[])?;
    let required = |name: &str| {
        bindings
            .iter()
            .find(|r| r.get::<_, &str>(0) == name)
            .is_some_and(|r| r.get::<_, bool>(1))
    };
    super::foundation_schema::verify(
        tx,
        "_ops",
        &[
            ("principal", "text", true, true),
            ("id", "text", true, true),
            ("seq", "bigint", true, false),
            ("outcome", "text", true, false),
            ("name", "text", required("name"), false),
            ("args_digest", "text", required("args_digest"), false),
            ("at", "bigint", true, false),
        ],
        &["principal", "id"],
    )?;
    if required("name") {
        tx.batch("ALTER TABLE _ops ALTER COLUMN name DROP NOT NULL")?;
    }
    if required("args_digest") {
        tx.batch("ALTER TABLE _ops ALTER COLUMN args_digest DROP NOT NULL")?;
    }
    Ok(())
}

pub(super) const LOOKUP: &str = "SELECT outcome,name,args_digest FROM _ops WHERE principal=$1 AND id=$2";
pub(super) fn record(rows: &[super::store::Row]) -> Option<ReceiptRecord> {
    rows.first().map(|r|ReceiptRecord { outcome:r.get(0),name:r.get(1),args_digest:r.get(2) })
}
impl Tx<'_> {
    fn group_receipt(&self,principal:&str,id:&str)->Option<super::group_tail::Receipt> {
        if self.group_head.get().is_none(){return None;}
        let tails=self.group_tails.borrow();let tail=self.tail.borrow();
        tail.receipts.iter().rev().chain(tails.iter().rev().flat_map(|t|t.receipts.iter().rev()))
            .find(|r|r.principal==principal&&r.id==id).cloned()
    }
}
impl ReceiptReader for Tx<'_> {
    /// A NUL principal or operation id is absent without querying.
    fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError> {
        if absent_text_key(&[principal, id]) {
            return Ok(None);
        }
        if let Some(r)=self.group_receipt(principal,id) {return Ok(Some(ReceiptRecord{outcome:r.outcome,name:r.name,args_digest:r.args_digest}));}
        if let Some((key,value)) = self.receipt_cache.borrow().as_ref() {
            if key.0 == principal && key.1 == id { return Ok(value.as_ref().map(|r| ReceiptRecord {outcome:r.outcome.clone(),name:r.name.clone(),args_digest:r.args_digest.clone()})); }
        }
        Ok(record(&self.query(LOOKUP,&[&principal,&id])?))
    }
    /// A NUL principal or operation id is absent without querying.
    fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError> {
        if absent_text_key(&[principal, id]) {
            return Ok(false);
        }
        if self.group_receipt(principal,id).is_some(){return Ok(true);}
        Ok(self.query(
            "SELECT EXISTS(SELECT 1 FROM _ops WHERE principal=$1 AND id=$2)",
            &[&principal, &id],
        )?[0]
            .get(0))
    }
    /// A NUL principal or operation id is absent without querying.
    fn sent_sequence(
        &self,
        principal: &str,
        id: &str,
        through: i64,
    ) -> Result<Option<i64>, RuntimeError> {
        if absent_text_key(&[principal, id]) {
            return Ok(None);
        }
        if let Some(r)=self.group_receipt(principal,id) {
            return if r.seq as i64<=through {sent_state(r.seq as i64,&r.outcome)}else{Ok(None)};
        }
        self.query(
            "SELECT seq,outcome FROM _ops WHERE principal=$1 AND id=$2 AND seq<=$3",
            &[&principal, &id, &through],
        )?
        .first()
        .map(|r| sent_state(r.get(0), r.get(1)))
        .transpose()
        .map(Option::flatten)
    }
}
macro_rules! reader {
    ($name:ident, $result:ty, $absent:expr $(, $arg:ident: $kind:ty)*) => {
        fn $name(&self, principal: &str, id: &str $(, $arg: $kind)*) -> Result<$result, RuntimeError> {
            if absent_text_key(&[principal, id]) { return Ok($absent); }
            let mut store = self.borrow_mut();
            let tx = store.transaction(None)?;
            let value = tx.$name(principal, id $(, $arg)*)?;
            tx.rollback()?;
            Ok(value)
        }
    };
}
impl ReceiptReader for RefCell<&mut Store> {
    reader!(receipt, Option<ReceiptRecord>, None);
    reader!(receipt_exists, bool, false);
    reader!(sent_sequence, Option<i64>, None, through: i64);
}
