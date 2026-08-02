//! Public-surface compile test for LLP 0141's supported Rust façade.

use snapback::embed::{NativeCodePosture, ProductionBuilder, production_from_manifests};

const SCHEMA: &[u8] = include_bytes!("../demos/todo/snapback/generated/schema.manifest.json");
const FUNCTIONS: &[u8] = include_bytes!("../demos/todo/snapback/generated/functions.manifest.json");

#[test]
fn external_consumer_can_build_the_supported_self_hosted_surface() {
    let builder: ProductionBuilder = production_from_manifests(SCHEMA, FUNCTIONS)
        .expect("generated artifacts are a valid embedded carrier")
        .database(".snapback/embedded-test.sqlite3")
        .bind("127.0.0.1", 0);

    assert_eq!(
        builder.native_code_posture(),
        NativeCodePosture::SelfHostedSingleTenant
    );
}
