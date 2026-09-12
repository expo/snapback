//! Durable operation terminals have no implicit retry expiry.
// @ref LLP 2000#durable-operation-ownership — successful data and its terminal share the engine transaction.
use crate::operations::TerminalCommit;
use crate::{RuntimeError, Store, StoredClientIntent};
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::Value as Json;

impl Store {
    pub fn stored_operation(
        &self,
        principal: &str,
        intent: &str,
    ) -> Result<Option<StoredClientIntent>, RuntimeError> {
        self.conn.query_row(
            "SELECT request_digest, response, seq, at FROM _operation_intents WHERE principal = ?1 AND intent = ?2",
            params![principal, intent],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
        ).optional()?.map(|(request_digest, response, seq, at)| Ok(StoredClientIntent {
            request_digest,
            response: serde_json::from_str(&response).map_err(|e| RuntimeError::Serialization(e.to_string()))?,
            seq: seq.max(0) as u64, at,
        })).transpose()
    }

    pub(crate) fn record_terminal(
        tx: &Transaction<'_>,
        principal: &str,
        terminal: &TerminalCommit,
        response: &Json,
        seq: u64,
    ) -> Result<(), RuntimeError> {
        let table = if let Some((grant, offset, count)) = &terminal.allocation {
            tx.execute("INSERT INTO _grant_slices(grant_id, principal, intent, offset, count) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![grant, principal, terminal.intent, i64::from(*offset), i64::from(*count)])?;
            "_client_intents"
        } else {
            "_operation_intents"
        };
        let mut response = response.clone();
        if terminal.allocation.is_none() {
            // Every S3 terminal, including a rejection, identifies the snapshot
            // at which it settled. The inherited replay wire remains unchanged.
            response["seq"] = Json::from(seq);
        }
        tx.execute(&format!("INSERT INTO {table}(principal, intent, request_digest, response, seq, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
            params![principal, terminal.intent, terminal.request_digest,
                serde_json::to_string(&response).map_err(|e| RuntimeError::Serialization(e.to_string()))?, seq as i64, terminal.at])?;
        Ok(())
    }

    pub(crate) fn record_operation_refusal(
        &self,
        principal: &str,
        terminal: &TerminalCommit,
        response: &Json,
        seq: u64,
    ) -> Result<(), RuntimeError> {
        let tx = self.conn.unchecked_transaction()?;
        Self::record_terminal(&tx, principal, terminal, response, seq)?;
        tx.commit()?;
        Ok(())
    }
}
