// @ref LLP 0010#native-runtime-bootstrap -- this crate owns binaries and
// benches that link the runtime composition, so their final link steps need
// the Hermes loader paths. Cargo does not propagate rustc-link-arg downstream.

use std::path::{Path, PathBuf};

mod build_identity {
    include!("../snapback-types/build_identity.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=HERMES_LIB_DIR");
    println!("cargo:rerun-if-changed=../../vendor/ibex/ios/Frameworks");

    // The telemetry and fork-promotion evidence binaries retain the exact
    // source-identity contract they had in the facade package.
    // @ref LLP 0283#f-5--named-exceptions-with-burn-down-tickets —
    // rank-7 tool composition must preserve evidence provenance while moving.
    build_identity::emit_build_identity();

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "linux" {
        println!("cargo:rustc-link-arg=-Wl,--disable-new-dtags");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");
        return;
    }
    if target_os != "macos" {
        return;
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let lib_root = std::env::var_os("HERMES_LIB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("../../vendor/ibex/ios/Frameworks"));
    let candidates = [
        lib_root.clone(),
        lib_root.join("macosx"),
        lib_root
            .join("hermes.xcframework")
            .join("macos-arm64_x86_64"),
        lib_root.join("hermes.xcframework").join("macos-arm64"),
    ];

    emit_macos_rpath(Path::new("@loader_path/../Frameworks"));
    let mut emitted = false;
    for dir in &candidates {
        if framework_present(dir) {
            emit_macos_rpath(dir);
            emitted = true;
        }
    }
    if !emitted {
        emit_macos_rpath(&lib_root);
        println!(
            "cargo:warning=snapback-tools build.rs: no Hermes framework found under {}; emitted a default LC_RPATH. Run scripts/bootstrap-ibex-runtime.",
            lib_root.display()
        );
    }
}

fn emit_macos_rpath(dir: &Path) {
    println!("cargo:rustc-link-arg=-Xlinker");
    println!("cargo:rustc-link-arg=-rpath");
    println!("cargo:rustc-link-arg=-Xlinker");
    println!("cargo:rustc-link-arg={}", dir.display());
}

fn framework_present(dir: &Path) -> bool {
    for name in ["hermesvm", "hermes"] {
        let framework = dir.join(format!("{name}.framework"));
        let binaries = [
            framework.join("Versions").join("Current").join(name),
            framework.join("Versions").join("1").join(name),
            framework.join("Versions").join("0").join(name),
            framework.join(name),
        ];
        if binaries.iter().any(|path| path.exists()) {
            return true;
        }
    }
    false
}
