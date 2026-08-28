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
    println!("cargo:rerun-if-changed=../../schemas/http.routes.v1.json");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "linux" {
        // @ref LLP 0041#runtime-distribution — the Linux platform package
        // places libhermesvm.so and its bundled non-glibc dependencies (ICU)
        // at bin/../lib. Dependency build-script link args do not propagate to
        // this final binary, so Snapback itself must carry the loader-relative
        // search path. It must be the legacy DT_RPATH tag, not DT_RUNPATH:
        // only DT_RPATH applies transitively when the loader resolves
        // libhermesvm.so's own DT_NEEDED entries (bundled libicuuc/libicudata),
        // with $ORIGIN expanding relative to this executable.
        println!("cargo:rustc-link-arg=-Wl,--disable-new-dtags");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");
        return;
    }

    // Re-run if the prepared framework dir appears or changes (bootstrap copies
    // it in), so a first build after bootstrap picks up the real location.
    println!("cargo:rerun-if-changed=../../vendor/ibex/ios/Frameworks");

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
        .unwrap_or_else(|| manifest_dir.join("../../vendor/ibex/ios/Frameworks"));

    let candidates = [
        lib_root.clone(),
        lib_root.join("macosx"),
        lib_root
            .join("hermes.xcframework")
            .join("macos-arm64_x86_64"),
        lib_root.join("hermes.xcframework").join("macos-arm64"),
    ];

    let mut emitted = false;
    // @ref LLP 0041#runtime-distribution — published runtime packages place
    // the executable at bin/snapback and Hermes at Frameworks/hermesvm.framework.
    // Keep one relocatable loader-relative search path in every macOS binary;
    // checkout-absolute paths below remain useful for contributor builds but
    // cannot be the only LC_RPATH carried into a packaged artifact.
    emit_macos_rpath(Path::new("@loader_path/../Frameworks"));
    for dir in &candidates {
        if framework_present(dir) {
            emit_macos_rpath(dir);
            emitted = true;
        }
    }

    if !emitted {
        // ibex-runtime's own build.rs panics when the macOS framework is truly
        // missing, so a bootstrapped tree never reaches here. Emit the default
        // location anyway so the binary carries a plausible LC_RPATH rather than
        // none, and warn.
        emit_macos_rpath(&lib_root);
        println!(
            "cargo:warning=snapback build.rs: no Hermes framework found under {}; emitted a default LC_RPATH. Run scripts/bootstrap-ibex-runtime.",
            lib_root.display()
        );
    }
}

fn emit_macos_rpath(dir: &Path) {
    // `-Wl,-rpath,<path>` is comma-fragile because clang splits the payload on
    // every comma before forwarding to ld64. Separate `-Xlinker` args preserve
    // checkout paths such as "projects, archive/snapback" verbatim.
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
