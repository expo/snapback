//! The durable, machine-readable result of `snapback2 test`.
// @ref LLP 1002#7-test-and-the-receipt — zero checks cannot pass and every outcome is named.

use crate::protocol::Refusal;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryReceipt {
    pub version: String,
    pub digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReceipt {
    pub name: String,
    pub kind: String,
    pub verdict: String,
    pub ms: u64,
    pub detail: Json,
}

impl CheckReceipt {
    pub fn pass(name: impl Into<String>, kind: &str, ms: u64, detail: Json) -> Self {
        Self::new(name, kind, "pass", ms, detail)
    }

    pub fn fail(name: impl Into<String>, kind: &str, ms: u64, detail: Json) -> Self {
        Self::new(name, kind, "fail", ms, detail)
    }

    pub fn blocked(name: impl Into<String>, kind: &str, ms: u64, detail: Json) -> Self {
        Self::new(name, kind, "blocked", ms, detail)
    }

    fn new(name: impl Into<String>, kind: &str, verdict: &str, ms: u64, detail: Json) -> Self {
        Self {
            name: name.into(),
            kind: kind.to_owned(),
            verdict: verdict.to_owned(),
            ms,
            detail,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReceipt {
    pub binary: BinaryReceipt,
    pub generation: String,
    pub commands: Vec<String>,
    pub checks: Vec<CheckReceipt>,
    pub arms: Vec<String>,
    pub verdict: String,
    pub scope: ScopeReceipt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedules: Option<Json>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeReceipt {
    pub changed: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_only: Option<bool>,
}

impl TestReceipt {
    pub fn new(generation: String, commands: Vec<String>, checks: Vec<CheckReceipt>) -> Self {
        let verdict = if checks.iter().any(|check| check.verdict == "blocked") {
            "blocked"
        } else if checks.is_empty() || checks.iter().any(|check| check.verdict == "fail") {
            "fail"
        } else {
            "pass"
        };
        Self {
            binary: binary_receipt(),
            generation,
            commands,
            checks,
            arms: vec!["headless".to_owned()],
            verdict: verdict.to_owned(),
            scope: ScopeReceipt::default(),
            schedules: None,
        }
    }

    pub fn explicitly_blocked(reason: &str) -> Self {
        Self {
            binary: binary_receipt(),
            generation: String::new(),
            commands: vec![format!("snapback2 test --blocked {reason:?}")],
            checks: vec![CheckReceipt::blocked(
                "explicit",
                "derived",
                0,
                serde_json::json!({ "reason": reason }),
            )],
            arms: vec!["headless".to_owned()],
            verdict: "blocked".to_owned(),
            scope: ScopeReceipt::default(),
            schedules: None,
        }
    }

    pub fn write(&self, root: &Path, stamp: u128) -> Result<PathBuf, Refusal> {
        let directory = root.join(".snapback/receipts");
        fs::create_dir_all(&directory).map_err(receipt_error)?;
        let path = directory.join(format!("{stamp}.json"));
        let bytes = serde_json::to_vec_pretty(self).map_err(|error| {
            Refusal::owner(
                "E_OWNER_RECEIPT",
                format!("cannot serialize test receipt: {error}"),
                "rerun snapback2 test",
            )
        })?;
        fs::write(&path, bytes).map_err(receipt_error)?;
        Ok(path)
    }
}

fn binary_receipt() -> BinaryReceipt {
    let bytes = std::env::current_exe()
        .ok()
        .and_then(|path| fs::read(path).ok())
        .unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    BinaryReceipt {
        version: crate::VERSION.to_owned(),
        digest: format!("rust64:{:016x}", hasher.finish()),
    }
}

fn receipt_error(error: std::io::Error) -> Refusal {
    Refusal::owner(
        "E_OWNER_RECEIPT",
        format!("cannot write test receipt: {error}"),
        "make .snapback/receipts writable and rerun snapback2 test",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn receipt(checks: Vec<CheckReceipt>) -> TestReceipt {
        TestReceipt::new(
            "generation".to_owned(),
            vec!["snapback2 test".to_owned()],
            checks,
        )
    }

    #[test]
    fn blocked_dominates_and_pass_requires_every_check_to_pass() {
        assert_eq!(receipt(Vec::new()).verdict, "fail");
        assert_eq!(
            receipt(vec![CheckReceipt::pass("rules", "derived", 1, json!({}))]).verdict,
            "pass"
        );
        assert_eq!(
            receipt(vec![
                CheckReceipt::pass("rules", "derived", 1, json!({})),
                CheckReceipt::fail("journey", "journey", 1, json!({})),
            ])
            .verdict,
            "fail"
        );
        let blocked = receipt(vec![
            CheckReceipt::fail("journey", "journey", 1, json!({})),
            CheckReceipt::blocked(
                "effects",
                "derived",
                1,
                json!({ "reason": "no engine in this build" }),
            ),
        ]);
        assert_eq!(blocked.verdict, "blocked");
        assert_eq!(
            blocked
                .checks
                .iter()
                .filter(|check| check.verdict == "blocked")
                .map(|check| check.name.as_str())
                .collect::<Vec<_>>(),
            vec!["effects"]
        );
    }
}
