use serde::{Deserialize, Serialize};

/// Server-derived, bearer-free attribution for one app-data function
/// response. Wrappers may copy this value, but cannot synthesize attribution
/// authority when the invocation gate did not produce it.
///
/// @ref LLP 0055#audit — every resolved service-principal function response
/// carries the same actor/effective/grant attribution and v1 has no agent
/// dry-run surface.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FunctionAttribution {
    pub actor_user_id: String,
    pub effective_user_id: Option<String>,
    pub grant_id: String,
    pub dry_run: bool,
}
