//! The durable at-most-once record is the replay body. Replays retrieve
//! execution identity, never historical read authority (including scalar results).
use super::{MutationOutcome, WriteState};
#[cfg(feature = "sqlite")]
use crate::error::{Refusal, RuntimeError};
#[cfg(feature = "sqlite")]
use crate::meter::Metered;
use crate::value::Value;
use serde_json::{Value as Json, json};

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

    // @ref LLP 3000.007#17 — store the replay body: no historical values, even in diagnostic messages or named-constraint detail.
    pub fn receipt(&self, id: Option<&str>) -> Json {
        let mut body = self.reply(id);
        body.as_object_mut().expect("reply object").remove("result");
        body.as_object_mut().expect("reply object").remove("current");
        if let WriteState::Failed { why, .. } = &self.state {
            body["why"]["message"] = Json::String(format!("the program refused with {}", why.code));
            body["why"].as_object_mut().expect("refusal object").remove("detail");
        }
        if self.receipt_only { body["receiptOnly"] = Json::Bool(true); }
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
                why.detail = None;
                WriteState::Failed { why, current: None }
            }
            _ => return Err(malformed()),
        };
        Ok(Self { receipt_only: body.get("receiptOnly").and_then(Json::as_bool).unwrap_or(false), state, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: true })
    }
}
