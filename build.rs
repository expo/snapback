// @ref LLP 0010#native-runtime-bootstrap -- emit the macOS LC_RPATH the
// snapback binary needs to load hermesvm.framework at launch (ENG-22664).
//
// The vendored ibex-runtime crate links Hermes with an @rpath-relative install
// name (`@rpath/hermesvm.framework/Versions/1/hermesvm`) and its own build.rs
// emits a matching `-rpath` link-arg. But Cargo does NOT propagate a
// dependency's `cargo:rustc-link-arg` to a downstream crate's link step -- only
// `rustc-link-lib` / `rustc-link-search` flow through. So the final `snapback`
// binary linked the framework but carried no LC_RPATH, and crashed at launch
// with "Library not loaded: @rpath/hermesvm.framework/... Reason: no LC_RPATH's
// found" once macOS SIP stripped the DYLD_* fallback for a protected process
// tree. snapback owns the final binary, so the rpath has to be emitted here,
// where `rustc-link-arg` actually applies to its bins, tests, and benches.

use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=HERMES_LIB_DIR");
    // Re-run if the prepared framework dir appears or changes (bootstrap copies
    // it in), so a first build after bootstrap picks up the real location.
    println!("cargo:rerun-if-changed=vendor/ibex/ios/Frameworks");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        // Only macOS resolves Hermes through an @rpath-relative framework; other
        // targets link libhermesvm differently (see vendor/ibex/build.rs).
        return;
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );

    // Mirror vendor/ibex/build.rs: the macOS Hermes framework lives under
    // vendor/ibex/ios/Frameworks (or HERMES_LIB_DIR), possibly in a macosx/ or
    // hermes.xcframework/ subdir. Point an LC_RPATH at every candidate dir that
    // actually holds a Hermes framework, so dyld resolves the @rpath install
    // name regardless of which framework name/layout ibex-runtime linked.
    let lib_root = std::env::var_os("HERMES_LIB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("vendor/ibex/ios/Frameworks"));

    let candidates = [
        lib_root.clone(),
        lib_root.join("macosx"),
        lib_root.join("hermes.xcframework").join("macos-arm64_x86_64"),
        lib_root.join("hermes.xcframework").join("macos-arm64"),
    ];

    let mut emitted = false;
    for dir in &candidates {
        if framework_present(dir) {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", dir.display());
            emitted = true;
        }
    }

    if !emitted {
        // ibex-runtime's own build.rs panics when the macOS framework is truly
        // missing, so a bootstrapped tree never reaches here. Emit the default
        // location anyway so the binary carries a plausible LC_RPATH rather than
        // none, and warn.
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_root.display());
        println!(
            "cargo:warning=snapback build.rs: no Hermes framework found under {}; emitted a default LC_RPATH. Run scripts/bootstrap-ibex-runtime.",
            lib_root.display()
        );
    }
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
