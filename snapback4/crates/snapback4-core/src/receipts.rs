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

// @ref LLP 3000.009.001.000#3.4 — receipt writes share the admitted transaction with the ledger.
#[cfg(feature = "sqlite")]
pub(crate) trait ReceiptTransaction: ReceiptReader {
    fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError>;
    fn bind_applied(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value, at: i64) -> Result<(), RuntimeError>;
}

/// Decode the receipt state identically, without dialect-specific JSON coercions.
pub(crate) fn sent_state(seq: i64, outcome: &str) -> Result<Option<i64>, RuntimeError> {
    let value: serde_json::Value =
        serde_json::from_str(outcome).map_err(|e| RuntimeError::Store(e.to_string()))?;
    Ok((value.get("state").and_then(serde_json::Value::as_str) == Some("sent")).then_some(seq))
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

    pub(crate) struct Fixture {
        pub id: &'static str,
        pub seq: i64,
        pub outcome: &'static str,
        pub name: Option<&'static str>,
        pub digest: Option<String>,
    }
    pub(crate) fn fixtures() -> Vec<Fixture> {
        let digest = payload_digest(&serde_json::json!({"a": 1, "b": 2}));
        [
            (
                "bound",
                7,
                r#"{"state":"sent"}"#,
                Some("send"),
                Some(digest.clone()),
            ),
            ("legacy", 8, r#"{"state":"sent"}"#, None, None),
            ("failed", 9, r#"{"state":"failed"}"#, None, None),
            ("name-only", 10, r#"{"state":"sent"}"#, Some("send"), None),
            ("digest-only", 11, r#"{"state":"sent"}"#, None, Some(digest)),
            ("non-string", 12, r#"{"state":7}"#, None, None),
            (
                "duplicate-state",
                13,
                r#"{"state":"failed","state":"sent"}"#,
                None,
                None,
            ),
            ("invalid", 14, "invalid", None, None),
            ("minimum", i64::MIN, r#"{"state":"sent"}"#, None, None),
            ("maximum", i64::MAX, r#"{"state":"sent"}"#, None, None),
        ]
        .into_iter()
        .map(|(id, seq, outcome, name, digest)| Fixture {
            id,
            seq,
            outcome,
            name,
            digest,
        })
        .collect()
    }

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
        for (principal, id) in [("alice", "new\0id"), ("new\0principal", "bound")] {
            assert!(reader.receipt(principal, id).unwrap().is_none());
            assert!(!reader.receipt_exists(principal, id).unwrap());
            assert_eq!(reader.sent_sequence(principal, id, i64::MAX).unwrap(), None);
            assert!(
                replay_bound(reader, principal, id, "send", &args)
                    .unwrap()
                    .is_none()
            );
        }
        assert!(reader.receipt_exists("alice", "failed").unwrap());
        assert!(!reader.receipt_exists("bob", "failed").unwrap());
        assert_eq!(
            reader.sent_sequence("alice", "bound", i64::MIN).unwrap(),
            None
        );
        assert_eq!(
            reader.sent_sequence("alice", "bound", i64::MAX).unwrap(),
            Some(7)
        );
        assert_eq!(reader.sent_sequence("alice", "bound", 6).unwrap(), None);
        assert_eq!(reader.sent_sequence("alice", "bound", 7).unwrap(), Some(7));
        assert_eq!(reader.sent_sequence("alice", "legacy", 8).unwrap(), Some(8));
        assert_eq!(reader.sent_sequence("alice", "failed", 9).unwrap(), None);
        for id in ["name-only", "digest-only"] {
            assert!(
                replay_bound(reader, "alice", id, "send", &args)
                    .unwrap()
                    .is_some()
            );
        }
        assert_eq!(
            reader.sent_sequence("alice", "non-string", 12).unwrap(),
            None
        );
        assert_eq!(
            reader
                .sent_sequence("alice", "duplicate-state", 13)
                .unwrap(),
            Some(13)
        );
        assert_eq!(
            reader.sent_sequence("alice", "minimum", i64::MIN).unwrap(),
            Some(i64::MIN)
        );
        assert_eq!(
            reader
                .sent_sequence("alice", "maximum", i64::MAX - 1)
                .unwrap(),
            None
        );
        assert_eq!(
            reader.sent_sequence("alice", "maximum", i64::MAX).unwrap(),
            Some(i64::MAX)
        );
        assert_eq!(reader.sent_sequence("alice", "invalid", 13).unwrap(), None);
        assert!(reader.sent_sequence("alice", "invalid", 14).is_err());
    }
}
