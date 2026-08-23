use snapback_types::manifest::FunctionManifest;

#[test]
fn emitted_graph_function_manifest_admits() {
    let Ok(path) = std::env::var("SNAPBACK_GRAPH_CODEGEN_MANIFEST") else {
        eprintln!("graph_codegen_admission: skipped without SNAPBACK_GRAPH_CODEGEN_MANIFEST");
        return;
    };
    let bytes = std::fs::read(&path).expect("read codegen-emitted functions manifest");
    let manifest: FunctionManifest =
        serde_json::from_slice(&bytes).expect("deserialize codegen-emitted FunctionManifest");
    manifest
        .validate_artifact()
        .expect("Rust host admits codegen-emitted graph carrier");
    assert!(
        manifest
            .functions
            .iter()
            .any(|function| function.name == "issueGraph"),
        "emitted manifest contains issueGraph"
    );
    println!("graph_codegen_admission: emitted GraphQuery FunctionManifest admitted");
}

