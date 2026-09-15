//! The durable at-most-once record is the replay body. Replays retrieve
//! execution identity, never historical read authority (including scalar results).
use super::{MutationOutcome, WriteState};
#[cfg(feature = "sqlite")]
use crate::error::{Refusal, RuntimeError};
#[cfg(feature = "sqlite")]
use crate::meter::Metered;
use crate::value::Value;
use serde_json::{Value as Json, json};

#[cfg(feature = "sqlite")]
impl super::Engine {
    // @ref LLP 3000.007#20.4 — permanent write refusals finalize the ID too, so an exposed predecessor can settle before its successors.
    pub fn refuse_mutation(&mut self, viewer: &str, id: Option<&str>, why: Refusal) -> Result<MutationOutcome, RuntimeError> {
        let outcome = MutationOutcome { state: WriteState::Failed { why: why.clone(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false };
        let Some(id) = id.filter(|_| !why.retryable) else { return Ok(outcome) };
        let tx = self.store.transaction()?;
        if let Some((_, recorded)) = tx.applied(viewer, id)? {
            let recorded = MutationOutcome::from_receipt(&recorded)?;
            tx.rollback()?;
            return Ok(recorded);
        }
        let receipt = serde_json::to_string(&outcome.receipt(Some(id))).map_err(|e| RuntimeError::Store(e.to_string()))?;
        tx.record_applied(viewer, id, tx.next_seq()? - 1, &receipt)?;
        tx.commit()?;
        Ok(outcome)
    }
}

impl MutationOutcome {
    pub fn reply(&self, id: Option<&str>) -> Json {
        let mut body = match &self.state {
            WriteState::Sent { seq, result } => {
                let mut body = json!({ "state": "sent", "id": id, "seq": seq });
                if !self.replayed { body["result"] = crate::wire::to_json(result); }
                body
            }
            WriteState::Failed { why, current } => {
                let mut body = json!({ "state": "failed", "id": id, "why": why });
                if !self.replayed && let Some(value) = current.as_ref().filter(|value| **value != Value::Null) { body["current"] = crate::wire::to_json(value); }
                body
            }
        };
        if self.replayed { body["replayed"] = Json::Bool(true); }
        body
    }

    // @ref LLP 3000.007#17 — store the replay body: no historical values, even in a diagnostic message.
    pub fn receipt(&self, id: Option<&str>) -> Json {
        let mut body = self.reply(id);
        body.as_object_mut().expect("reply object").remove("result");
        body.as_object_mut().expect("reply object").remove("current");
        if let WriteState::Failed { why, .. } = &self.state {
            body["why"]["message"] = Json::String(format!("the program refused with {}", why.code));
        }
        body["replayed"] = Json::Bool(true);
        body
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn from_receipt(text: &str) -> Result<Self, RuntimeError> {
        let body: Json = serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let malformed = || RuntimeError::Store("invalid mutation receipt".into());
        let state = match body["state"].as_str() {
            Some("sent") => WriteState::Sent { seq: body["seq"].as_u64().ok_or_else(malformed)?, result: Value::Null },
            Some("failed") => {
                let mut why: Refusal = serde_json::from_value(body["why"].clone()).map_err(|e| RuntimeError::Store(e.to_string()))?;
                // @ref LLP 3000.007#17 — even a historical W-shaped receipt cannot return row-derived diagnostic text.
                why.message = format!("the program refused with {}", why.code);
                WriteState::Failed { why, current: None }
            }
            _ => return Err(malformed()),
        };
        Ok(Self { state, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: true })
    }
}
