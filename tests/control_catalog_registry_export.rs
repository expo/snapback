//! LLP 0184 Phase 1 item 2: exports the LLP 0031 route registry, the LLP
//! 0031 multiplexed operation registry, and the LLP 0024 host-ops identity
//! allowlists into one neutral JSON artifact the JS control-catalog
//! compiler (`scripts/generate-control-catalog.mjs`) joins against CLI/MCP/
//! AdminClient/console declarations, following the `network-profile-
//! authority.json` precedent (`src/network_profile.rs`'s
//! `mcp_authority_projection_matches_rust_builtins_and_ceiling`): a
//! checked-in JSON file whose truthfulness this test — not a build step —
//! verifies against the live Rust source of truth. This is the domain-
//! filtered *export*, not a second registry: every fact here is read
//! straight off `server::route_registry()` / `server::operation_registry()`
//! / `host_ops::{SERVED_HOST_OPS, CLI_ONLY_HOST_OPS, PINNED_UNBUILT_HOST_OPS}`.
//!
//! @ref LLP 0184#2-derived-ownership-not-a-second-registry — the compiler
//!   joins existing owners; this export is the neutral artifact it joins
//!   against, not an independently authored fact source.
//! @ref LLP 0184#3-completeness-and-parity-rules — the domain is
//!   `RouteClass::SystemApi` routes/operations plus every `host_ops.*`
//!   identity plus the single `app.ensure.provision` operation-identity
//!   exception; `SystemStatic` and ordinary `AppData` operations (including
//!   the two non-`provision` `/app/ensure` operations and the
//!   `ephemeral_*` family) are out of domain and excluded here by
//!   construction, not filtered downstream.

use serde_json::{Value, json};
use snapback::host_ops::{CLI_ONLY_HOST_OPS, PINNED_UNBUILT_HOST_OPS, SERVED_HOST_OPS};
use snapback::server::{OperationSpec, RouteClass, RouteSpec, operation_registry, route_registry};
use std::fs;
use std::path::PathBuf;

fn route_json(route: &RouteSpec) -> Value {
    json!({
        "method": route.method,
        "path": route.path,
        "class": format!("{:?}", route.class),
        "pathPolicy": format!("{:?}", route.path_policy),
        "credentialResolution": format!("{:?}", route.credential_resolution),
        "invocationAuthority": format!("{:?}", route.invocation_authority),
        "effectPolicy": format!("{:?}", route.effect_policy),
        "responseSensitivity": format!("{:?}", route.response_sensitivity),
    })
}

fn operation_json(operation: &OperationSpec) -> Value {
    json!({
        "operation": operation.operation,
        "parentPath": operation.parent_path,
        "transport": format!("{:?}", operation.transport),
        "class": format!("{:?}", operation.class),
        "pathPolicy": format!("{:?}", operation.path_policy),
        "credentialResolution": format!("{:?}", operation.credential_resolution),
        "invocationAuthority": format!("{:?}", operation.invocation_authority),
        "effectPolicy": format!("{:?}", operation.effect_policy),
        "responseSensitivity": format!("{:?}", operation.response_sensitivity),
    })
}

/// Build the exact JSON value the committed export must equal. Domain
/// filtering happens here, once, in the Rust source of truth: a
/// `SystemStatic` route or an ordinary `AppData` operation never reaches
/// the exported artifact at all (LLP 0184 §3's "a row for an out-of-domain
/// route or operation is a domain error, not merely an omission" — the
/// export enforces that at the source rather than trusting every JS
/// consumer to re-derive the filter).
fn build_export() -> Value {
    let routes: Vec<Value> = route_registry()
        .into_iter()
        .filter(|route| route.class == RouteClass::SystemApi)
        .map(|route| route_json(&route))
        .collect();

    let operations: Vec<Value> = operation_registry()
        .into_iter()
        .filter(|operation| {
            operation.class == RouteClass::SystemApi
                || operation.operation == "app.ensure.provision"
        })
        .map(|operation| operation_json(&operation))
        .collect();

    json!({
        "schemaNote": "Domain-filtered export of the LLP 0031 route/operation registries plus the LLP 0024 host-ops identity allowlists, for the LLP 0184 ControlCatalogV1 compiler. Generated fact source: src/server.rs route_registry()/operation_registry() and src/host_ops.rs's SERVED_HOST_OPS/CLI_ONLY_HOST_OPS/PINNED_UNBUILT_HOST_OPS. routes[] are RouteClass::SystemApi HTTP path entries; operations[] are RouteClass::SystemApi multiplexed operations plus the single app.ensure.provision operation-identity exception (its route is AppData, but this one dispatched operation is in-domain per LLP 0184 §3). hostOpsIdentities are the LLP 0024 operation identities served by POST /_snapback/api/host-ops; note these are spelled WITHOUT the 'host_ops.' prefix that operation_registry() uses for its own multiplexed rows over the same path (e.g. 'app.inspect' here vs 'host_ops.app.inspect' in operations[]) — the compiler joins the two spellings by stripping that prefix.",
        "routes": routes,
        "operations": operations,
        "hostOpsIdentities": {
            "served": SERVED_HOST_OPS.to_vec(),
            "cliOnly": CLI_ONLY_HOST_OPS.to_vec(),
            "pinnedUnbuilt": PINNED_UNBUILT_HOST_OPS.to_vec(),
        },
    })
}

fn export_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("packages/snapback-cli/control-plane-registry.json")
}

#[test]
fn control_plane_registry_export_matches_live_registries() {
    let expected = build_export();
    let expected_pretty = serde_json::to_string_pretty(&expected).unwrap() + "\n";

    let path = export_path();
    let committed = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "failed to read committed control-plane registry export at {}: {error}. \
             Regenerate it by running this test with SNAPBACK_WRITE_CONTROL_CATALOG_EXPORT=1.",
            path.display()
        )
    });

    if committed != expected_pretty {
        if std::env::var("SNAPBACK_WRITE_CONTROL_CATALOG_EXPORT").is_ok() {
            fs::write(&path, &expected_pretty).expect("write control-plane registry export");
        } else {
            panic!(
                "packages/snapback-cli/control-plane-registry.json is stale relative to the \
                 live LLP 0031/0024 registries. Regenerate with:\n\n  \
                 SNAPBACK_WRITE_CONTROL_CATALOG_EXPORT=1 DYLD_FRAMEWORK_PATH=\"$PWD/vendor/ibex/ios/Frameworks\" \
                 cargo test --test control_catalog_registry_export\n\nthen re-run \
                 `node scripts/generate-control-catalog.mjs` and commit both files."
            );
        }
    }
}

#[test]
fn domain_boundary_excludes_system_static_and_ordinary_app_data() {
    // Negative proof that the filter above is the real gate, not a comment:
    // route_registry() and operation_registry() both carry SystemStatic and
    // AppData entries (the console shell, served guide, ephemeral_*,
    // app.ensure.legacy/.attest) — this test fails if a future edit widens
    // build_export()'s filter to leak them into the exported domain.
    let export = build_export();
    let routes = export["routes"].as_array().unwrap();
    let operations = export["operations"].as_array().unwrap();

    assert!(
        routes.iter().all(|route| route["class"] == "SystemApi"),
        "every exported route must be RouteClass::SystemApi"
    );
    assert!(
        operations.iter().all(|operation| {
            operation["class"] == "SystemApi" || operation["operation"] == "app.ensure.provision"
        }),
        "every exported operation must be RouteClass::SystemApi or the app.ensure.provision exception"
    );
    assert!(
        operations
            .iter()
            .all(|operation| operation["operation"] != "app.ensure.legacy"
                && operation["operation"] != "app.ensure.attest"
                && operation["operation"] != "ephemeral_publish"
                && operation["operation"] != "ephemeral_delete"
                && operation["operation"] != "ephemeral_subscribe"
                && operation["operation"] != "ephemeral_unsubscribe"),
        "out-of-domain AppData operations must never appear in the export"
    );
}
