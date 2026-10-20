//! Store-neutral operation receipt facts and replay binding policy.
use crate::RuntimeError;

pub(crate) struct ReceiptRecord {
    pub outcome: String,
    pub name: Option<String>,
    pub args_digest: Option<String>,
}

/// Access only: callers retain acknowledgement cuts and refusal ordering.
pub(crate) trait ReceiptReader {
    fn receipt(&self, principal: &str, id: &str) -> Result<Option<ReceiptRecord>, RuntimeError>;
    fn receipt_exists(&self, principal: &str, id: &str) -> Result<bool, RuntimeError>;
    fn sent_sequence(
        &self,
        principal: &str,
        id: &str,
        through: i64,
    ) -> Result<Option<i64>, RuntimeError>;
}

// @ref LLP 3000.009.001.000#3.3 — replay binding policy stays above the adapter during extraction.
pub(crate) fn replay_bound(
    reader: &impl ReceiptReader,
    principal: &str,
    id: &str,
    name: &str,
    args: &serde_json::Value,
) -> Result<Option<String>, RuntimeError> {
    let Some(recorded) = reader.receipt(principal, id)? else {
        return Ok(None);
    };
    // NULL is an old receipt with no binding, never a mismatch.
    if recorded.name.as_deref().is_some_and(|old| old != name)
        || recorded
            .args_digest
            .is_some_and(|old| old != payload_digest(args))
    {
        return Err(id_reused());
    }
    Ok(Some(recorded.outcome))
}

/// Canonical plain JSON, including recursively sorted object keys.
pub fn canonical_payload(value: &serde_json::Value) -> String {
    let mut value = value.clone();
    value.sort_all_objects();
    value.to_string()
}

pub fn payload_digest(value: &serde_json::Value) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(canonical_payload(value).as_bytes()))
}

pub fn id_reused() -> RuntimeError {
    RuntimeError::Structural { code: "E_ID_REUSED", message: "this id already admitted another operation or different arguments; use the original operation and arguments, or mint a new id".into() }
}

#[cfg(test)]
pub(crate) mod test_cases {
    use super::*;

    /// Adapters seed alice's `bound`, `legacy`, and `failed` receipts at 7, 8, 9.
    pub(crate) fn replay_and_acknowledgement(reader: &impl ReceiptReader) {
        let args = serde_json::json!({"b": 2, "a": 1});
        assert_eq!(
            replay_bound(reader, "alice", "bound", "send", &args)
                .unwrap()
                .as_deref(),
            Some(r#"{"state":"sent"}"#)
        );
        assert!(
            replay_bound(reader, "bob", "bound", "send", &args)
                .unwrap()
                .is_none()
        );
        assert!(
            replay_bound(reader, "alice", "missing", "send", &args)
                .unwrap()
                .is_none()
        );
        for (name, args) in [
            ("other", args.clone()),
            ("send", serde_json::json!({"a": 2})),
        ] {
            assert_eq!(
                replay_bound(reader, "alice", "bound", name, &args)
                    .unwrap_err()
                    .refusal()
                    .code,
                "E_ID_REUSED"
            );
        }
        assert!(
            replay_bound(
                reader,
                "alice",
                "legacy",
                "anything",
                &serde_json::Value::Null
            )
            .unwrap()
            .is_some()
        );
        assert!(reader.receipt_exists("alice", "failed").unwrap());
        assert!(!reader.receipt_exists("bob", "failed").unwrap());
        assert_eq!(reader.sent_sequence("alice", "bound", 6).unwrap(), None);
        assert_eq!(reader.sent_sequence("alice", "bound", 7).unwrap(), Some(7));
        assert_eq!(reader.sent_sequence("alice", "legacy", 8).unwrap(), Some(8));
        assert_eq!(reader.sent_sequence("alice", "failed", 9).unwrap(), None);
    }
}
