use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../control-catalog/generated/control-catalog.v1.json");

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let catalog_path = manifest_dir.join("../../control-catalog/generated/control-catalog.v1.json");
    let mut catalog: serde_json::Value =
        serde_json::from_slice(&fs::read(&catalog_path).expect("read generated control catalog"))
            .expect("generated control catalog must be valid JSON");

    // @ref LLP 0316#phase-4--leaf-crates-for-non-rust-inputs — this build
    // script embeds only semantic catalog bytes. Runtime access stamps the
    // enclosing binary identity, so the storage kernel never watches Git.
    catalog
        .as_object_mut()
        .expect("generated control catalog must be an object")
        .remove("buildIdentity")
        .expect("generated control catalog carries buildIdentity");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    fs::write(
        out_dir.join("embedded-control-catalog.v1.json"),
        serde_json::to_vec_pretty(&catalog).expect("serialize embedded control catalog"),
    )
    .expect("write embedded control catalog");
}
