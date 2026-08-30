//! Receipt helpers for engine-enforced derived bounds checks.
// @ref LLP 1002#7-test-and-the-receipt — bounds failures preserve the engine's refusal.

use super::{Json, json};

pub(super) fn engine_failure(op: &str, persona: &str, response: Json) -> Json {
    json!({
        "op": op,
        "as": persona,
        "source": "engine",
        "code": response.get("code").cloned().unwrap_or(Json::Null),
        "response": response,
    })
}
