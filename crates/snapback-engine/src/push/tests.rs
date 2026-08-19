use super::*;

#[test]
fn packaged_push_schema_stages_before_the_sessions_catalog_exists() {
    let mut schema: crate::manifest::SchemaManifest = serde_json::from_str(include_str!(
        "../../../../packages/snapback-cli/fixtures/push-seam/app/snapback/generated/schema.manifest.json"
    ))
    .unwrap();
    // This fixture proves pre-catalog staging, not remote governance
    // custody. The generated policy remains owner/membership-shaped while
    // its optional deployment-governance carrier is out of scope here.
    schema.visibility_governance = None;
    let functions = serde_json::from_str(include_str!(
        "../../../../packages/snapback-cli/fixtures/push-seam/app/snapback/generated/functions.manifest.json"
    ))
    .unwrap();
    let mut snapback = crate::local::LocalSnapback::memory().unwrap();
    let prepared = snapback
        .prepare_auth_provision(
            crate::local::EnsureAppMode::Sessions,
            Some(schema),
            Some(functions),
            None,
        )
        .unwrap();
    snapback.commit_auth_provision(prepared, "test").unwrap();
}
