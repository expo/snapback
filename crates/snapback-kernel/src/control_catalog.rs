//! Build-bound control catalog and advisory instance availability projection.
//!
//! The checked catalog is embedded in the native binary. Neither the HTTP,
//! CLI, nor MCP projections read a source checkout at runtime, so a packaged
//! binary always describes the exact catalog it was compiled with.
//!
//! @ref LLP 0184#1-controlcatalogv1 — build and instance identities remain
//! distinct and consumers must refuse a digest mismatch.
//! @ref LLP 0184#2-derived-ownership-not-a-second-registry — this module only
//! projects the generated join; invocation admission remains authoritative.

use serde_json::{Value, json};
use std::sync::OnceLock;

pub const CATALOG_SCHEMA_VERSION: &str = "snapback.control-catalog.v1";
pub const INSTANCE_SCHEMA_VERSION: &str = "snapback.control-catalog-instance.v1";
pub const CATALOG_DIGEST_HEADER: &str = "x-snapback-control-catalog-digest";

pub static BUILD_CATALOG_BYTES: &[u8] = include_bytes!(concat!(
    env!("OUT_DIR"),
    "/embedded-control-catalog.v1.json"
));

static BUILD_CATALOG: OnceLock<Value> = OnceLock::new();

pub fn build_catalog() -> &'static Value {
    BUILD_CATALOG.get_or_init(|| {
        let catalog: Value = serde_json::from_slice(BUILD_CATALOG_BYTES)
            .expect("compiled control catalog must be valid JSON");
        assert_eq!(
            catalog.get("schemaVersion").and_then(Value::as_str),
            Some(CATALOG_SCHEMA_VERSION),
            "compiled control catalog has the wrong schemaVersion"
        );
        assert!(
            catalog_digest(&catalog).is_some(),
            "compiled control catalog has no catalogDigest"
        );
        catalog
    })
}

pub fn catalog_digest(catalog: &Value) -> Option<&str> {
    catalog.get("catalogDigest").and_then(Value::as_str)
}

pub fn operation(operation: &str) -> Option<&'static Value> {
    build_catalog()
        .get("entries")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("operation").and_then(Value::as_str) == Some(operation))
}

pub fn cli_projection(operation: &str) -> Option<&'static str> {
    self::operation(operation)?
        .pointer("/projections/cli")?
        .as_str()
}

pub fn guide_anchor(operation: &str) -> Option<&'static str> {
    self::operation(operation)?.get("guide")?.as_str()
}

/// Build the refusal acquisition path from the same embedded row used by
/// every control projection. This is presentation only: the owning gate still
/// decides whether a retried operation is admitted.
///
/// @ref LLP 0184#3-completeness-and-parity-rules — rule 4 discovery metadata
///   and the CLI projection remain one catalog-owned fact in refusals too.
pub fn refusal_next(operation: &str) -> Vec<Value> {
    let operation = if self::operation(operation).is_some() {
        operation.to_owned()
    } else {
        format!("cli.{operation}")
    };
    let mut next = Vec::new();
    if let Some(guide) = guide_anchor(&operation) {
        next.push(json!({
            "guide": guide,
            "reason": "read the operation's build-bound Guide acquisition path",
        }));
    }
    if let Some(command) = cli_projection(&operation) {
        next.push(json!({
            "command": command,
            "reason": "retry through the operation's shipped CLI projection",
        }));
    }
    next
}

pub fn result_next(ok: bool, operation: &str) -> Vec<Value> {
    if ok {
        Vec::new()
    } else {
        refusal_next(operation)
    }
}

/// Return the build catalog with only entries matching every query token.
/// The digest continues to identify the complete embedded catalog; filtering
/// is a presentation projection, never a new catalog identity.
pub fn search(intent: Option<&str>) -> Value {
    let mut catalog = build_catalog().clone();
    let tokens = intent
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return catalog;
    }
    let Some(entries) = catalog.get_mut("entries").and_then(Value::as_array_mut) else {
        return catalog;
    };
    entries.retain(|entry| {
        let operation = entry
            .get("operation")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let title = entry
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let intents = entry
            .get("intents")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        let haystack = format!("{operation} {title} {intents}").to_lowercase();
        tokens.iter().all(|token| haystack.contains(token))
    });
    catalog
}

/// Bind the two catalog identities before a consumer merges availability.
/// The instance snapshot is advisory after this check; each invocation still
/// runs the owning subsystem's admission gate.
pub fn require_matching_identity<'a>(
    catalog: &'a Value,
    instance: &'a Value,
) -> Result<(&'a Value, &'a Value), &'static str> {
    let build_digest = catalog_digest(catalog).ok_or("build catalog has no digest")?;
    let instance_digest = catalog_digest(instance).ok_or("instance projection has no digest")?;
    if build_digest != instance_digest {
        return Err("build catalog and instance projection digests differ");
    }
    Ok((catalog, instance))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_matches_operation_title_and_intents_without_changing_identity() {
        let full = build_catalog();
        let filtered = search(Some("network profile"));
        assert_eq!(catalog_digest(&filtered), catalog_digest(full));
        assert!(
            filtered["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["operation"] == "debug.networkProfileSet")
        );
    }

    #[test]
    fn search_resolves_the_rule_four_agent_task_examples() {
        for (intent, operation) in [
            ("slow network", "debug.networkProfileSet"),
            ("upload", "asset.put"),
            ("reset the database", "app.reset"),
            ("mint session", "auth.mintSession"),
        ] {
            let matches = search(Some(intent));
            assert!(
                matches["entries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| entry["operation"] == operation),
                "{intent:?} must discover {operation}",
            );
        }
    }

    #[test]
    fn identity_binding_fails_closed_on_mismatch() {
        let catalog = json!({ "catalogDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
        let matching = json!({ "catalogDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
        let mismatched = json!({ "catalogDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
        assert!(require_matching_identity(&catalog, &matching).is_ok());
        assert_eq!(
            require_matching_identity(&catalog, &mismatched),
            Err("build catalog and instance projection digests differ")
        );
    }
}
