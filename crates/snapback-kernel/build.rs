use std::fs;
use std::path::PathBuf;

mod build_identity {
    include!("../snapback-types/build_identity.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../control-catalog/generated/control-catalog.v1.json");

    let identity = build_identity::emit_build_identity();
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let catalog_path = manifest_dir.join("../../control-catalog/generated/control-catalog.v1.json");
    let mut catalog: serde_json::Value = serde_json::from_slice(
        &fs::read(&catalog_path).expect("read generated control catalog"),
    )
    .expect("generated control catalog must be valid JSON");

    // @ref LLP 0041#runtime-distribution — the packaged binary's embedded
    // catalog must carry the same source stamp as the executable around it.
    catalog["buildIdentity"] = serde_json::json!({
        "sourceCommit": identity.git_commit.unwrap_or_else(|| "unknown".to_owned()),
        "dirty": identity.git_dirty.unwrap_or(true),
    });

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    fs::write(
        out_dir.join("embedded-control-catalog.v1.json"),
        serde_json::to_vec_pretty(&catalog).expect("serialize embedded control catalog"),
    )
    .expect("write embedded control catalog");
}
