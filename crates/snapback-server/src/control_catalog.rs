//! Server adapter for the engine-owned build-bound control catalog.

use crate::admin::AppState;
use serde_json::{Value, json};

pub use snapback_engine::control_catalog::*;

fn instance_target(state: &AppState) -> &'static str {
    if state.derived_instance_identity.is_some() {
        "derived-hosted"
    } else if state.server.auth_deployment == crate::auth::deployment::AuthDeploymentTarget::Hosted
    {
        "primary-hosted"
    } else {
        "local"
    }
}

pub fn instance_projection(state: &AppState) -> Value {
    let target = instance_target(state);
    let profile = state.server.profile.as_str();
    let enabled_capabilities = build_catalog()
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("shipped"))
        .filter(|entry| {
            matches!(
                entry.get("operability").and_then(Value::as_str),
                Some("direct" | "mediated")
            )
        })
        .filter(|entry| {
            entry
                .pointer("/availability/targets")
                .and_then(Value::as_array)
                .is_some_and(|targets| targets.iter().any(|candidate| candidate == target))
        })
        .filter(|entry| {
            entry
                .pointer("/availability/profiles")
                .and_then(Value::as_array)
                .is_none_or(|profiles| profiles.iter().any(|candidate| candidate == profile))
        })
        .filter_map(|entry| entry.get("operation").and_then(Value::as_str))
        .collect::<Vec<_>>();

    json!({
        "schemaVersion": INSTANCE_SCHEMA_VERSION,
        "catalogDigest": catalog_digest(build_catalog()).expect("catalog digest"),
        "startupNonce": state.server_startup_nonce(),
        "target": target,
        "profile": profile,
        "enabledCapabilities": enabled_capabilities,
        "generatedAtMs": crate::server::now_millis(),
    })
}
