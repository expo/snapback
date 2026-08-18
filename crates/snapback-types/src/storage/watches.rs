use crate::storage::CapturedReadDependency;
use crate::watches::{
    WatchAuthorityMode, WatchFunctionKind, WatchOwnerKind, WatchReactionKind, WatchStatus,
};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFiringRecord {
    pub ordinal: u64,
    pub job_id: String,
    pub fired_at_ms: u64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRecord {
    pub id: String,
    pub owner_kind: WatchOwnerKind,
    #[serde(skip_serializing)]
    pub owner_principal_id: String,
    #[serde(skip_serializing)]
    pub owner_authority_instance_id: String,
    pub authority_mode: WatchAuthorityMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_grant_id: Option<String>,
    #[serde(skip_serializing)]
    pub installation_grant_id: Option<String>,
    pub anchor_expires_at_ms: u64,
    pub query_function_id: String,
    pub query_function_name: String,
    pub query_basis: u64,
    pub query_args: Value,
    pub query_args_digest: String,
    #[serde(skip_serializing)]
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub predicate: Value,
    pub reaction_kind: WatchReactionKind,
    pub reaction_function_id: String,
    pub reaction_function_name: String,
    pub reaction_function_kind: WatchFunctionKind,
    pub reaction_basis: u64,
    pub reaction_args: Value,
    pub reaction_args_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    #[serde(skip_serializing)]
    pub webhook_secret_ref: Option<String>,
    pub status: WatchStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification: Option<Value>,
    pub daily_firing_budget: u32,
    pub firings_today: u32,
    pub debounce_ms: u64,
    pub pending: bool,
    pub last_predicate_state: bool,
    pub evaluation_count: u64,
    pub coalesced_invalidation_count: u64,
    pub firing_count: u64,
    pub last_evaluated_at_ms: Option<u64>,
    pub last_fired_at_ms: Option<u64>,
    pub last_firing_outcome: Option<String>,
    pub last_diagnostic_code: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub recent_firings: Vec<WatchFiringRecord>,
    #[serde(skip_serializing)]
    pub pending_job_id: Option<String>,
    #[serde(skip_serializing)]
    pub pending_firing_ordinal: Option<u64>,
    #[serde(skip_serializing)]
    pub pending_firing_job_id: Option<String>,
}
