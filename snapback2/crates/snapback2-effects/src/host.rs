use serde_json::Value;
use snapback2_core::EffectDecl;
use std::time::Duration;

/// One durable outbox job after the writer atomically claims it.
#[derive(Clone, Debug, PartialEq)]
pub struct EffectJob {
    pub id: String,
    pub effect: String,
    pub payload: Value,
    /// The post-claim attempt number. The first run is attempt 1.
    pub attempt: u32,
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
    Sent(Value),
    Failed { error: String, retry: bool },
    Unavailable(&'static str),
}

/// The seam every effect engine implements.
// @ref LLP 1003#3-the-runtime-snapback2-effects — effects have one host seam, and the default host refuses loudly.
pub trait EffectHost {
    fn run(&mut self, decl: &EffectDecl, job: &EffectJob, budget: Duration) -> Outcome;
    fn describe(&self) -> &'static str;

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
        }
    }

    #[test]
    fn no_engine_refuses_loudly() {
        let outcome = NoEngine.run(&declaration(), &job(), Duration::from_secs(1));
        assert_eq!(outcome, Outcome::Unavailable("no engine in this build"));
        assert_eq!(NoEngine.describe(), "none");
    }
}
