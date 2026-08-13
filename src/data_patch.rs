//! Bounded direct row patching for the agent-accessible control plane.
//!
//! The live apply token is deliberately process-local. It is an authorization
//! capability, not a durable receipt field; only its one-way identifier is
//! projected after consumption.

use crate::contract_types::ServerProfile;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::HandlerInput;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DATA_PATCH_PREVIEW_OPERATION: &str = "data.patch.preview";
pub const DATA_PATCH_APPLY_OPERATION: &str = "data.patch.apply";
pub const DATA_PATCH_TOKEN_TTL_MS: u64 = 60_000;
pub const DATA_PATCH_TOKEN_CAPACITY: usize = 256;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataPatchEffectivePrincipalV1 {
    pub user_id: String,
    #[serde(default)]
    pub roles: Vec<String>,
}

/// The LLP 0024 authority tuple, projected without inventing a data-patch
/// authority mode.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataPatchAuthorityV1 {
    pub mode: String,
    pub actor_principal: Option<String>,
    pub effective_principal: Option<DataPatchEffectivePrincipalV1>,
    pub local_dev_only: bool,
    pub admin_bypass: bool,
    pub scope: Option<String>,
    pub reason: Option<String>,
}

impl DataPatchAuthorityV1 {
    pub fn validate(&self, operation_reason: &str) -> SnapbackResult<()> {
        let reason = operation_reason.trim();
        if reason.is_empty() {
            return Err(authority_invalid(
                "a non-empty operation reason is required",
            ));
        }
        if self.actor_principal.is_some() || self.scope.is_some() || !self.local_dev_only {
            return Err(authority_invalid(
                "data patch authority must use LLP 0024 local-dev tuple fields",
            ));
        }
        match self.mode.as_str() {
            "devUser" => {
                let Some(principal) = &self.effective_principal else {
                    return Err(authority_invalid("devUser requires an effectivePrincipal"));
                };
                if principal.user_id.trim().is_empty() || self.admin_bypass {
                    return Err(authority_invalid(
                        "devUser requires a non-empty userId and adminBypass false",
                    ));
                }
                if principal.roles.iter().any(|role| role.trim().is_empty()) {
                    return Err(authority_invalid("devUser roles must be non-empty"));
                }
                if self
                    .reason
                    .as_deref()
                    .is_some_and(|tuple_reason| tuple_reason != reason)
                {
                    return Err(authority_invalid(
                        "authority reason must match the operation reason when present",
                    ));
                }
            }
            "devAdminBypass" => {
                if self.effective_principal.is_some()
                    || !self.admin_bypass
                    || self.reason.as_deref() != Some(reason)
                {
                    return Err(authority_invalid(
                        "devAdminBypass requires adminBypass true, no effective principal, and the same required reason",
                    ));
                }
            }
            _ => {
                return Err(authority_invalid(
                    "data patch admits only LLP 0024 devUser or devAdminBypass",
                ));
            }
        }
        Ok(())
    }

    pub fn impersonated(&self) -> bool {
        self.mode == "devUser"
    }

    pub fn handler_input(&self) -> HandlerInput {
        HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: self
                    .effective_principal
                    .as_ref()
                    .map(|principal| principal.user_id.clone()),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    pub fn authorization_disposition(&self) -> &'static str {
        if self.mode == "devAdminBypass" {
            "devAdminBypassAdmitted"
        } else {
            "devUserImpersonation"
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataPatchPreviewInputV1 {
    pub table: String,
    pub row_id: String,
    pub expected_version: u64,
    pub patch: Map<String, Value>,
    pub authority: DataPatchAuthorityV1,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataPatchApplyInputV1 {
    pub table: String,
    pub row_id: String,
    pub expected_version: u64,
    pub patch: Map<String, Value>,
    pub authority: DataPatchAuthorityV1,
    pub reason: String,
    #[serde(default)]
    pub apply_token: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedLiveQueryClassV1 {
    pub class: String,
    pub table: String,
    pub live_functions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPatchDiffV1 {
    pub fields: Vec<String>,
    pub before: BTreeMap<String, Value>,
    pub after: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedDataPatchV1 {
    pub table: String,
    pub row_id: String,
    pub expected_version: u64,
    pub normalized_patch: BTreeMap<String, Value>,
    pub diff: DataPatchDiffV1,
    pub affected_live_query_classes: Vec<AffectedLiveQueryClassV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPatchTargetV1 {
    pub app_id: String,
    pub target_profile: String,
    pub auth_deployment: String,
    pub derived: bool,
}

/// Exact token binding. Keeping the requested patch in addition to the
/// normalized patch makes apply reject even a semantically equivalent but
/// different request body, while the normalized value is what reaches the
/// storage writer.
///
/// @ref LLP 0184#a-bounded-direct-row-patch--add-now — target, startup,
///   catalog/schema, row CAS, normalized patch/diff, complete authority, and
///   expiry all belong to the single-use capability binding.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPatchTokenBindingV1 {
    pub target: DataPatchTargetV1,
    pub startup_nonce: String,
    pub catalog_digest: String,
    pub schema_identity: Option<String>,
    pub table: String,
    pub row_id: String,
    pub expected_version: u64,
    pub requested_patch: BTreeMap<String, Value>,
    pub normalized_patch: BTreeMap<String, Value>,
    pub diff: DataPatchDiffV1,
    pub affected_live_query_classes: Vec<AffectedLiveQueryClassV1>,
    pub authority: DataPatchAuthorityV1,
    pub reason: String,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPatchPreviewOutputV1 {
    pub validated: ValidatedDataPatchV1,
    pub apply_token: String,
    pub apply_token_id: String,
    pub apply_token_expires_at_ms: u64,
    pub catalog_digest: String,
    pub startup_nonce: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPatchReceiptV1 {
    pub receipt_kind: String,
    pub apply_token_id: String,
    pub catalog_digest: String,
    pub startup_nonce: String,
    pub commit_version: u64,
    pub table: String,
    pub row_id: String,
    pub expected_version: u64,
    pub changed_count: usize,
    pub authority: DataPatchAuthorityV1,
    pub reason: String,
    pub authorization_disposition: String,
    pub app_handler_authorization_evaluated: bool,
}

#[derive(Clone, Debug)]
enum TokenState {
    Available,
    Consumed,
    Expired,
}

#[derive(Clone, Debug)]
struct TokenEntry {
    binding: DataPatchTokenBindingV1,
    state: TokenState,
    retain_until_ms: u64,
}

#[derive(Default)]
struct TokenRegistry {
    entries: HashMap<String, TokenEntry>,
    order: VecDeque<String>,
}

/// Clone-shared, process-local, bounded and expiring apply-token registry.
#[derive(Clone)]
pub struct DataPatchTokenStore {
    registry: Arc<Mutex<TokenRegistry>>,
    ttl_ms: u64,
    capacity: usize,
}

impl Default for DataPatchTokenStore {
    fn default() -> Self {
        Self::new(DATA_PATCH_TOKEN_TTL_MS, DATA_PATCH_TOKEN_CAPACITY)
    }
}

impl DataPatchTokenStore {
    pub fn new(ttl_ms: u64, capacity: usize) -> Self {
        Self {
            registry: Arc::new(Mutex::new(TokenRegistry::default())),
            ttl_ms: ttl_ms.max(1),
            capacity: capacity.max(1),
        }
    }

    pub fn mint(&self, binding: DataPatchTokenBindingV1) -> SnapbackResult<(String, String, u64)> {
        self.mint_at(binding, now_ms())
    }

    fn mint_at(
        &self,
        mut binding: DataPatchTokenBindingV1,
        now: u64,
    ) -> SnapbackResult<(String, String, u64)> {
        let expires_at_ms = now.checked_add(self.ttl_ms).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_DATA_PATCH_APPLY_TOKEN_EXPIRED",
                "data-patch",
                "apply-token expiry cannot be represented",
            )
        })?;
        binding.expires_at_ms = expires_at_ms;
        let mut random = [0_u8; 32];
        getrandom::fill(&mut random).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISSING",
                "data-patch",
                "apply-token entropy is unavailable",
            )
        })?;
        let token = format!("sbpat_{}", URL_SAFE_NO_PAD.encode(random));
        let token_id = apply_token_id(&token);
        let retain_until_ms = expires_at_ms.saturating_add(self.ttl_ms);
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_registry(&mut registry, now);
        while registry.entries.len() >= self.capacity {
            let Some(oldest) = registry.order.pop_front() else {
                break;
            };
            registry.entries.remove(&oldest);
        }
        registry.order.push_back(token_id.clone());
        registry.entries.insert(
            token_id.clone(),
            TokenEntry {
                binding,
                state: TokenState::Available,
                retain_until_ms,
            },
        );
        Ok((token, token_id, expires_at_ms))
    }

    /// Compare every request-controlled and process-controlled binding field,
    /// run the commit while retaining exclusive ownership, and consume only
    /// after the commit succeeds. Exactly one concurrent caller can commit.
    ///
    /// @ref LLP 0184#a-bounded-direct-row-patch--add-now — validation, CAS,
    ///   and success-only consumption share one process-local turn.
    pub fn commit<T>(
        &self,
        input: &DataPatchApplyInputV1,
        current: &DataPatchTokenContextV1,
        apply: impl FnOnce(&DataPatchTokenBindingV1) -> SnapbackResult<T>,
    ) -> SnapbackResult<(String, DataPatchTokenBindingV1, T)> {
        self.commit_at(input, current, now_ms(), apply)
    }

    fn commit_at<T>(
        &self,
        input: &DataPatchApplyInputV1,
        current: &DataPatchTokenContextV1,
        now: u64,
        apply: impl FnOnce(&DataPatchTokenBindingV1) -> SnapbackResult<T>,
    ) -> SnapbackResult<(String, DataPatchTokenBindingV1, T)> {
        if input.apply_token.trim().is_empty() {
            return Err(token_error(
                "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISSING",
                "an apply token is required",
            ));
        }
        let token_id = apply_token_id(&input.apply_token);
        let requested_patch = canonical_patch(&input.patch);
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(entry) = registry.entries.get_mut(&token_id) else {
            return Err(token_error(
                "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISSING",
                "the apply token is not known to this server process",
            ));
        };
        if now >= entry.binding.expires_at_ms {
            entry.state = TokenState::Expired;
        }
        match entry.state {
            TokenState::Expired => {
                return Err(token_error(
                    "SNAPBACK_DATA_PATCH_APPLY_TOKEN_EXPIRED",
                    "the apply token has expired",
                ));
            }
            TokenState::Consumed => {
                return Err(token_error(
                    "SNAPBACK_DATA_PATCH_APPLY_TOKEN_CONSUMED",
                    "the apply token was already consumed",
                ));
            }
            TokenState::Available => {}
        }
        let binding = &entry.binding;
        let matches = binding.target == current.target
            && binding.startup_nonce == current.startup_nonce
            && binding.catalog_digest == current.catalog_digest
            && binding.schema_identity == current.schema_identity
            && binding.table == input.table
            && binding.row_id == input.row_id
            && binding.expected_version == input.expected_version
            && binding.requested_patch == requested_patch
            && binding.authority == input.authority
            && binding.reason == input.reason;
        if !matches {
            return Err(token_error(
                "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISMATCH",
                "the apply request does not match the previewed binding",
            ));
        }
        let binding = entry.binding.clone();
        let committed = apply(&binding)?;
        entry.state = TokenState::Consumed;
        Ok((token_id, binding, committed))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataPatchTokenContextV1 {
    pub target: DataPatchTargetV1,
    pub startup_nonce: String,
    pub catalog_digest: String,
    pub schema_identity: Option<String>,
}

pub fn target_context(
    app_id: String,
    schema_identity: Option<String>,
    profile: ServerProfile,
    auth_deployment: crate::auth::deployment::AuthDeploymentTarget,
    hosted_serving: bool,
    derived: bool,
    startup_nonce: String,
) -> SnapbackResult<DataPatchTokenContextV1> {
    // @ref LLP 0184#a-bounded-direct-row-patch--add-now — v1 is local
    //   non-production on primary instances only; derived identity is an
    //   availability refusal, not an operability-unavailable claim.
    if profile == ServerProfile::Prod
        || auth_deployment == crate::auth::deployment::AuthDeploymentTarget::Hosted
        || hosted_serving
        || derived
    {
        return Err(SnapbackError::error(
            "SNAPBACK_DATA_PATCH_TARGET_REFUSED",
            "data-patch",
            "direct row patch is restricted to primary local non-production instances",
        )
        .with_details(json!({
            "availability": "refused",
            "profile": profile.as_str(),
            "hosted": auth_deployment == crate::auth::deployment::AuthDeploymentTarget::Hosted || hosted_serving,
            "derived": derived,
        })));
    }
    let catalog_digest = control_catalog_digest()?;
    Ok(DataPatchTokenContextV1 {
        target: DataPatchTargetV1 {
            app_id,
            target_profile: profile.as_str().to_owned(),
            auth_deployment: "local".to_owned(),
            derived,
        },
        startup_nonce,
        catalog_digest,
        schema_identity,
    })
}

pub fn binding_from_preview(
    preview: &DataPatchPreviewInputV1,
    validated: &ValidatedDataPatchV1,
    context: &DataPatchTokenContextV1,
) -> DataPatchTokenBindingV1 {
    DataPatchTokenBindingV1 {
        target: context.target.clone(),
        startup_nonce: context.startup_nonce.clone(),
        catalog_digest: context.catalog_digest.clone(),
        schema_identity: context.schema_identity.clone(),
        table: preview.table.clone(),
        row_id: preview.row_id.clone(),
        expected_version: preview.expected_version,
        requested_patch: canonical_patch(&preview.patch),
        normalized_patch: validated.normalized_patch.clone(),
        diff: validated.diff.clone(),
        affected_live_query_classes: validated.affected_live_query_classes.clone(),
        authority: preview.authority.clone(),
        reason: preview.reason.clone(),
        expires_at_ms: 0,
    }
}

pub fn receipt(
    token_id: String,
    binding: DataPatchTokenBindingV1,
    commit_version: u64,
    changed_count: usize,
) -> DataPatchReceiptV1 {
    DataPatchReceiptV1 {
        receipt_kind: "dataPatchReceipt.v1".to_owned(),
        apply_token_id: token_id,
        catalog_digest: binding.catalog_digest,
        startup_nonce: binding.startup_nonce,
        commit_version,
        table: binding.table,
        row_id: binding.row_id,
        expected_version: binding.expected_version,
        changed_count,
        authorization_disposition: binding.authority.authorization_disposition().to_owned(),
        // Direct patching cannot claim handler-code validators or handler
        // authorization. devAdminBypass is explicitly an admitted skip.
        // @ref LLP 0184#a-bounded-direct-row-patch--add-now — bypass receipt
        //   disclosure must never say "evaluated as if authorized".
        app_handler_authorization_evaluated: false,
        authority: binding.authority,
        reason: binding.reason,
    }
}

pub fn map_storage_error(error: SnapbackError) -> SnapbackError {
    let code = error.diagnostic.code.as_str();
    let (mapped, message) = match code {
        "SNAPBACK_UNKNOWN_FIELD" => (
            "SNAPBACK_DATA_PATCH_UNKNOWN_FIELD",
            "the patch names a field that is not declared by the table schema",
        ),
        "SNAPBACK_SYSTEM_FIELD_WRITE" | "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED" => (
            "SNAPBACK_DATA_PATCH_RESERVED_FIELD",
            "the patch names a Snapback-managed field",
        ),
        "SNAPBACK_MUTATION_CONFLICT" => (
            "SNAPBACK_DATA_PATCH_STALE_VERSION",
            "the row version no longer matches the previewed precondition",
        ),
        "SNAPBACK_UNKNOWN_TABLE" | "SNAPBACK_MEMBERSHIP_READ_PRIVATE" => (
            "SNAPBACK_DATA_PATCH_TARGET_REFUSED",
            "the requested row is not an ordinary patchable application row",
        ),
        _ => (
            "SNAPBACK_DATA_PATCH_VALIDATION_FAILED",
            "the patch failed schema validation or a storage invariant",
        ),
    };
    SnapbackError::error(mapped, "data-patch", message).with_details(json!({ "causeCode": code }))
}

pub fn row_not_found() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_DATA_PATCH_TARGET_REFUSED",
        "data-patch",
        "the target row does not exist",
    )
    .with_details(json!({ "reason": "row-not-found" }))
}

pub fn stale_version(expected: u64, actual: u64) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_DATA_PATCH_STALE_VERSION",
        "data-patch",
        "the row version does not match the expected per-row version",
    )
    .with_details(json!({ "expectedVersion": expected, "actualVersion": actual }))
}

pub fn apply_context_mismatch() -> SnapbackError {
    token_error(
        "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISMATCH",
        "the served app or schema changed after apply-token consumption",
    )
}

pub fn canonical_patch(patch: &Map<String, Value>) -> BTreeMap<String, Value> {
    patch
        .iter()
        .map(|(key, value)| (key.clone(), canonical_json(value.clone())))
        .collect()
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_json).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        other => other,
    }
}

fn authority_invalid(message: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_DATA_PATCH_AUTHORITY_INVALID",
        "data-patch",
        message,
    )
}

fn token_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "data-patch", message)
}

fn apply_token_id(token: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(token.as_bytes()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn prune_registry(registry: &mut TokenRegistry, now: u64) {
    registry
        .entries
        .retain(|_, entry| entry.retain_until_ms > now);
    registry
        .order
        .retain(|token_id| registry.entries.contains_key(token_id));
}

pub fn control_catalog_digest() -> SnapbackResult<String> {
    static DIGEST: OnceLock<Result<String, String>> = OnceLock::new();
    match DIGEST.get_or_init(|| {
        serde_json::from_str::<Value>(include_str!(
            "../control-catalog/generated/control-catalog.v1.json"
        ))
        .map_err(|error| error.to_string())?
        .get("catalogDigest")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "generated control catalog has no catalogDigest".to_owned())
    }) {
        Ok(digest) => Ok(digest.clone()),
        Err(_) => Err(SnapbackError::error(
            "SNAPBACK_DATA_PATCH_TARGET_REFUSED",
            "data-patch",
            "the process control-catalog identity is unavailable",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authority(user: &str) -> DataPatchAuthorityV1 {
        DataPatchAuthorityV1 {
            mode: "devUser".to_owned(),
            actor_principal: None,
            effective_principal: Some(DataPatchEffectivePrincipalV1 {
                user_id: user.to_owned(),
                roles: vec!["member".to_owned()],
            }),
            local_dev_only: true,
            admin_bypass: false,
            scope: None,
            reason: None,
        }
    }

    fn context() -> DataPatchTokenContextV1 {
        DataPatchTokenContextV1 {
            target: DataPatchTargetV1 {
                app_id: "app".to_owned(),
                target_profile: "test".to_owned(),
                auth_deployment: "local".to_owned(),
                derived: false,
            },
            startup_nonce: "startup".to_owned(),
            catalog_digest: "sha256:catalog".to_owned(),
            schema_identity: Some("sha256:schema".to_owned()),
        }
    }

    fn preview(user: &str) -> DataPatchPreviewInputV1 {
        DataPatchPreviewInputV1 {
            table: "todos".to_owned(),
            row_id: "todo-1".to_owned(),
            expected_version: 4,
            patch: Map::from_iter([("title".to_owned(), json!("new"))]),
            authority: authority(user),
            reason: "fix title".to_owned(),
        }
    }

    fn binding(input: &DataPatchPreviewInputV1) -> DataPatchTokenBindingV1 {
        let normalized = canonical_patch(&input.patch);
        DataPatchTokenBindingV1 {
            target: context().target,
            startup_nonce: "startup".to_owned(),
            catalog_digest: "sha256:catalog".to_owned(),
            schema_identity: Some("sha256:schema".to_owned()),
            table: input.table.clone(),
            row_id: input.row_id.clone(),
            expected_version: input.expected_version,
            requested_patch: normalized.clone(),
            normalized_patch: normalized,
            diff: DataPatchDiffV1 {
                fields: vec!["title".to_owned()],
                before: BTreeMap::from([("title".to_owned(), json!("old"))]),
                after: BTreeMap::from([("title".to_owned(), json!("new"))]),
            },
            affected_live_query_classes: Vec::new(),
            authority: input.authority.clone(),
            reason: input.reason.clone(),
            expires_at_ms: 0,
        }
    }

    fn apply(input: &DataPatchPreviewInputV1, token: String) -> DataPatchApplyInputV1 {
        DataPatchApplyInputV1 {
            table: input.table.clone(),
            row_id: input.row_id.clone(),
            expected_version: input.expected_version,
            patch: input.patch.clone(),
            authority: input.authority.clone(),
            reason: input.reason.clone(),
            apply_token: token,
        }
    }

    #[test]
    fn token_is_single_use_and_atomic() {
        let store = DataPatchTokenStore::new(1_000, 8);
        let input = preview("user-a");
        let (token, _, _) = store.mint_at(binding(&input), 10).unwrap();
        let request = apply(&input, token);
        let left = store.clone();
        let right = store.clone();
        let request_left = request.clone();
        let request_right = request.clone();
        let ctx_left = context();
        let ctx_right = context();
        let a =
            std::thread::spawn(move || left.commit_at(&request_left, &ctx_left, 11, |_| Ok(())));
        let b =
            std::thread::spawn(move || right.commit_at(&request_right, &ctx_right, 11, |_| Ok(())));
        let outcomes = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        assert!(outcomes.iter().any(|outcome| {
            outcome.as_ref().is_err_and(|error| {
                error.diagnostic.code == "SNAPBACK_DATA_PATCH_APPLY_TOKEN_CONSUMED"
            })
        }));
    }

    #[test]
    fn expired_and_mismatched_tokens_are_distinct() {
        let store = DataPatchTokenStore::new(5, 8);
        let input = preview("user-a");
        let (expired, _, _) = store.mint_at(binding(&input), 10).unwrap();
        let error = store
            .commit_at(&apply(&input, expired), &context(), 15, |_| Ok(()))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_DATA_PATCH_APPLY_TOKEN_EXPIRED"
        );

        let (token, _, _) = store.mint_at(binding(&input), 20).unwrap();
        let mut other_user = apply(&input, token);
        other_user.authority = authority("user-b");
        let error = store
            .commit_at(&other_user, &context(), 21, |_| Ok(()))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISMATCH"
        );
    }

    #[test]
    fn failed_commit_leaves_token_available_for_a_successful_retry() {
        let store = DataPatchTokenStore::new(1_000, 8);
        let input = preview("user-a");
        let (token, _, _) = store.mint_at(binding(&input), 10).unwrap();
        let request = apply(&input, token);

        let error = store
            .commit_at(&request, &context(), 11, |_| {
                Err::<(), _>(SnapbackError::error(
                    "SNAPBACK_MUTATION_CONFLICT",
                    "storage",
                    "injected conflict",
                ))
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");

        let committed = store
            .commit_at(&request, &context(), 12, |_| Ok("committed"))
            .expect("failed commit must not consume the token");
        assert_eq!(committed.2, "committed");
        let consumed = store
            .commit_at(&request, &context(), 13, |_| Ok(()))
            .unwrap_err();
        assert_eq!(
            consumed.diagnostic.code,
            "SNAPBACK_DATA_PATCH_APPLY_TOKEN_CONSUMED"
        );
    }

    #[test]
    fn target_gate_refuses_prod_and_derived_as_availability() {
        for (profile, deployment, derived) in [
            (
                ServerProfile::Prod,
                crate::auth::deployment::AuthDeploymentTarget::Local,
                false,
            ),
            (
                ServerProfile::Test,
                crate::auth::deployment::AuthDeploymentTarget::Local,
                true,
            ),
            (
                ServerProfile::Test,
                crate::auth::deployment::AuthDeploymentTarget::Hosted,
                false,
            ),
        ] {
            let error = target_context(
                "app".to_owned(),
                Some("schema".to_owned()),
                profile,
                deployment,
                false,
                derived,
                "startup".to_owned(),
            )
            .unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_DATA_PATCH_TARGET_REFUSED");
            assert_eq!(error.diagnostic.details["availability"], "refused");
        }
    }
}
