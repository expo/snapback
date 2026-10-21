//! SQLite receipt access; binding and acknowledgement policy live above it.
use super::{Store, Tx};
use crate::{
    RuntimeError,
    receipts::{ReceiptReader, ReceiptRecord, sent_state},
};
use rusqlite::{Connection, OptionalExtension, params};

fn receipt(
    conn: &Connection,
    principal: &str,
    id: &str,
) -> Result<Option<ReceiptRecord>, RuntimeError> {
    Ok(conn
        .query_row(
            "SELECT outcome, name, args_digest FROM _ops WHERE principal = ?1 AND id = ?2",
            params![principal, id],
            |row| {
                Ok(ReceiptRecord {
                    outcome: row.get(0)?,
                    name: row.get(1)?,
                    args_digest: row.get(2)?,
                })
            },
        )
        .optional()?)
}

fn exists(conn: &Connection, principal: &str, id: &str) -> Result<bool, RuntimeError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM _ops WHERE principal=?1 AND id=?2)",
        [principal, id],
        |r| r.get::<_, bool>(0),
    )?)
}

fn sent_sequence(
    conn: &Connection,
    principal: &str,
    id: &str,
    through: i64,
) -> Result<Option<i64>, RuntimeError> {
    conn.query_row(
        "SELECT seq,outcome FROM _ops WHERE principal=?1 AND id=?2 AND seq<=?3",
        params![principal, id, through],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    )
    .optional()?
    .map(|(seq, outcome)| sent_state(seq, &outcome))
    .transpose()
    .map(Option::flatten)
}

impl ReceiptReader for Store {
    fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError> {
        receipt(&self.conn, principal, id)
    }
    fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError> {
        exists(&self.conn, principal, id)
    }
    fn sent_sequence(
        &self,
        principal: &str,
        id: &str,
        through: i64,
    ) -> Result<Option<i64>, RuntimeError> {
        sent_sequence(&self.conn, principal, id, through)
    }
}

impl ReceiptReader for Tx<'_> {
    fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError> {
        receipt(self.conn(), principal, id)
    }
    fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError> {
        exists(self.conn(), principal, id)
    }
    fn sent_sequence(
        &self,
        principal: &str,
        id: &str,
        through: i64,
    ) -> Result<Option<i64>, RuntimeError> {
        sent_sequence(self.conn(), principal, id, through)
    }
}

impl Store {
    pub(crate) fn replay_bound(
        &self,
        principal: &str,
        id: &str,
        name: &str,
        args: &serde_json::Value,
    ) -> Result<Option<String>, RuntimeError> {
        crate::receipts::replay_bound(self, principal, id, name, args)
    }
}

impl Tx<'_> {
    pub(crate) fn replay_bound(
        &self,
        principal: &str,
        id: &str,
        name: &str,
        args: &serde_json::Value,
    ) -> Result<Option<String>, RuntimeError> {
        crate::receipts::replay_bound(self, principal, id, name, args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_receipt_cases_on_store_and_transaction() {
        let mut store = Store::memory().unwrap();
        for row in crate::receipts::test_cases::fixtures() {
            store.conn.execute("INSERT INTO _ops(principal,id,seq,outcome,name,args_digest) VALUES(?1,?2,?3,?4,?5,?6)", params!["alice", row.id, row.seq, row.outcome, row.name, row.digest]).unwrap();
        }
        crate::receipts::test_cases::replay_and_acknowledgement(&store);
        let tx = store.read_transaction().unwrap();
        crate::receipts::test_cases::replay_and_acknowledgement(&tx);
        tx.rollback().unwrap();
    }
    #[test]
    fn legacy_nul_receipt_keys_and_values_are_not_revalidated() {
        let mut store = Store::memory().unwrap();
        store
            .conn()
            .execute(
                "INSERT INTO _ops(principal,id,seq,outcome) VALUES (?1,?2,7,?3)",
                params!["old\0principal", "old\0id", "old\0outcome"],
            )
            .unwrap();
        assert_eq!(
            crate::receipts::replay_bound(
                &store,
                "old\0principal",
                "old\0id",
                "any",
                &serde_json::Value::Null
            )
            .unwrap()
            .as_deref(),
            Some("old\0outcome")
        );
        let tx = store.read_transaction().unwrap();
        assert!(tx.receipt_exists("old\0principal", "old\0id").unwrap());
        assert_eq!(
            tx.receipt("old\0principal", "old\0id")
                .unwrap()
                .unwrap()
                .outcome,
            "old\0outcome"
        );
        tx.rollback().unwrap();
    }
}
