use serde_json::Value;
use snapback2_core::EffectDecl;
use std::collections::BTreeMap;
use std::time::Duration;

/// One durable outbox job after the writer atomically claims it.
#[derive(Clone, Debug, PartialEq)]
pub struct EffectJob {
    pub id: String,
    pub effect: String,
    pub payload: Value,
    /// The post-claim attempt number. The first run is attempt 1.
    pub attempt: u32,
    /// The project generation atomically bound by this claim.
    pub generation: Option<String>,
    /// `Some` only in a `test` owner: the provider bindings of the journey
    /// epoch this row was emitted in, logical origin → loopback origin. Every
    /// fetch is admitted on its logical origin first (the grant), then routed
    /// through this table; an origin absent from it is `E_EFFECT_UNBOUND` and
    /// reaches no transport. `None` is production transport.
    // @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — bindings belong to one journey epoch; a row from an earlier epoch carries an empty table, never a later journey's.
    pub bindings: Option<BTreeMap<String, String>>,
}

/// A console record attributed to the job that produced it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectLog {
    pub outbox_id: String,
    pub level: String,
    pub message: String,
}

/// The only outcomes the durable runner has to settle.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Sent {
        result: Value,
        /// The effect resolved, but other asynchronous work was still pending
        /// when its budget expired. The host must discard that runtime.
        leftover: bool,
    },
    Failed {
        error: String,
        retry: bool,
    },
    Unavailable(&'static str),
}

/// The seam every effect engine implements.
// @ref LLP 1003#3-the-runtime-snapback2-effects — effects have one host seam, and the default host refuses loudly.
pub trait EffectHost {
    fn run(&mut self, decl: &EffectDecl, job: &EffectJob, budget: Duration) -> Outcome;
    fn describe(&self) -> &'static str;

    /// Drop generation-scoped engine state before the next job. Hosts without
    /// cached runtimes have nothing to do.
    fn generation_changed(&mut self) {}

    /// Framework-owned provider contact for the most recent bound attempt.
    /// Production hosts return none; authored results cannot supply evidence.
    fn take_provider(&mut self) -> Option<Value> {
        None
    }

    /// Return console records produced by the most recent `run`.
    fn take_logs(&mut self) -> Vec<EffectLog> {
        Vec::new()
    }
}

/// The host in an engine-less build. It never reports a job as sent.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoEngine;

impl EffectHost for NoEngine {
    fn run(&mut self, _decl: &EffectDecl, _job: &EffectJob, _budget: Duration) -> Outcome {
        Outcome::Unavailable("no engine in this build")
    }

    fn describe(&self) -> &'static str {
        "none"
    }
}

/// What this build can run. The binary's `doctor` reports this text.
pub fn describe() -> &'static str {
    #[cfg(feature = "hermes")]
    {
        if crate::ibex::engine_available() {
            "ibex2 + vanilla hermes"
        } else {
            "none"
        }
    }
    #[cfg(not(feature = "hermes"))]
    {
        "none"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declaration() -> EffectDecl {
        EffectDecl {
            name: "notifications.notify".to_owned(),
            grants: vec!["https://api.example.com".to_owned()],
            source: "async () => true".to_owned(),
            then: None,
        }
    }

    fn job() -> EffectJob {
        EffectJob {
            id: "outbox-1".to_owned(),
            effect: "notifications.notify".to_owned(),
            payload: Value::Null,
            attempt: 1,
            generation: Some("generation-1".to_owned()),
            bindings: None,
        }
    }

    #[test]
    fn no_engine_refuses_loudly() {
        let outcome = NoEngine.run(&declaration(), &job(), Duration::from_secs(1));
        assert_eq!(outcome, Outcome::Unavailable("no engine in this build"));
        assert_eq!(NoEngine.describe(), "none");
    }
}
