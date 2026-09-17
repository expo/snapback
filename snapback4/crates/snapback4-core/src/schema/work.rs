//! Server work metadata does not alter the portable data-program IR.
use crate::ir::{ArgType, Program};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// @ref LLP 3000.009#5.1 — one declaration types the client, handler and durable settlement.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionSpec {
    /// None preserves legacy unknown JSON results. Some(empty) requires {}.
    pub returns: Option<BTreeMap<String, ArgType>>,
    #[serde(default)]
    pub work: WorkSpec,
}

impl ActionSpec {
    /// The worker must have been generated from the admitted declaration.
    pub fn contract(&self, program: &Program) -> String {
        crate::value::digest(&(program, self))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkSpec {
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(default)]
    pub policy: WorkPolicy,
}

impl WorkSpec {
    /// Effects currently carry one generic `Value` payload surface. If a
    /// typed payload declaration is added, its schema identity must replace
    /// this validator tag rather than claiming same-name type safety here.
    pub fn effect_contract(&self, effect: &str, payload: &crate::Value) -> String {
        crate::value::digest(&("effect-payload:generic-value:v1", effect, payload, self))
    }
}

// @ref LLP 3000.009#5.2 — policy is frozen at admission, not reread on each retry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkPolicy {
    /// Total attempts, including the first attempt (not extra retries).
    pub max_attempts: u32,
    pub backoff_ms: u64,
    pub deadline_ms: Option<u64>,
    pub cancellable: bool,
}

impl Default for WorkPolicy {
    fn default() -> Self {
        Self { max_attempts: 8, backoff_ms: 2_000, deadline_ms: None, cancellable: true }
    }
}

impl WorkPolicy {
    pub fn valid(&self) -> bool {
        (1..=100).contains(&self.max_attempts)
            && (1_000..=300_000).contains(&self.backoff_ms)
            && self.deadline_ms.is_none_or(|ms| (1_000..=2_592_000_000).contains(&ms))
    }

    pub fn backoff(&self, attempt: u32) -> i64 {
        self.backoff_ms.saturating_mul(1u64 << attempt.saturating_sub(1).min(20)).min(300_000) as i64
    }
}
