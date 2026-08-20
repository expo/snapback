// @ref LLP 0010#native-runtime-bootstrap -- this crate owns binaries and
// benches that link the runtime composition, so their final link steps need
// the Hermes loader paths. Cargo does not propagate rustc-link-arg downstream.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=HERMES_LIB_DIR");
    println!("cargo:rerun-if-changed=../../vendor/ibex/ios/Frameworks");

    // The telemetry and fork-promotion evidence binaries retain the exact
    // source-identity contract they had in the facade package.
    // @ref LLP 0283#f-5--named-exceptions-with-burn-down-tickets —
    // rank-7 tool composition must preserve evidence provenance while moving.
    emit_build_identity();

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

/// Emit the git commit + dirty state used by provenance-sensitive binaries.
/// This is the same best-effort, runtime-input-scoped contract as
/// `crates/snapback/build.rs`: explicit deterministic CI stamps win; an
/// unknown dirty state remains unset and is therefore treated conservatively
/// by consumers.
fn emit_build_identity() {
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_DIRTY");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_DISTRIBUTION");

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let repo_root = manifest_dir.join("../..");

    if let Some(pathspecs) = runtime_input_pathspecs(&repo_root) {
        for pathspec in pathspecs {
            println!("cargo:rerun-if-changed=../../{pathspec}");
        }
    }
    println!("cargo:rerun-if-changed=../../scripts/runtime-build-inputs.txt");

    if let Some(git_dir) = resolve_git_dir(&repo_root) {
        let common_dir = resolve_common_dir(&git_dir);
        let inputs = [
            git_dir.join("HEAD"),
            git_dir.join("index"),
            common_dir.join("refs").join("heads"),
            common_dir.join("packed-refs"),
        ];
        for path in inputs {
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }

    let commit = env_nonempty("SNAPBACK_BUILD_GIT_COMMIT")
        .or_else(|| git(&repo_root, &["rev-parse", "HEAD"]));
    if let Some(commit) = commit {
        println!("cargo:rustc-env=SNAPBACK_BUILD_GIT_COMMIT={commit}");
    }

    let dirty = env_nonempty("SNAPBACK_BUILD_GIT_DIRTY")
        .and_then(|v| match v.as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        })
        .or_else(|| {
            let mut args = vec![
                "status".to_owned(),
                "--porcelain".to_owned(),
                "--ignore-submodules=untracked".to_owned(),
            ];
            if let Some(pathspecs) = runtime_input_pathspecs(&repo_root) {
                args.push("--".to_owned());
                args.extend(pathspecs);
            }
            let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
            git_output(&repo_root, &arg_refs).map(|s| !s.is_empty())
        });
    if let Some(dirty) = dirty {
        println!("cargo:rustc-env=SNAPBACK_BUILD_GIT_DIRTY={dirty}");
    }

    let distribution = env_nonempty("SNAPBACK_BUILD_DISTRIBUTION")
        .unwrap_or_else(|| "contributor-source".to_owned());
    assert!(
        matches!(
            distribution.as_str(),
            "contributor-source" | "public-package"
        ),
        "SNAPBACK_BUILD_DISTRIBUTION must be contributor-source or public-package"
    );
    println!("cargo:rustc-env=SNAPBACK_BUILD_DISTRIBUTION={distribution}");
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn runtime_input_pathspecs(repo_root: &Path) -> Option<Vec<String>> {
    let content = fs::read_to_string(repo_root.join("scripts/runtime-build-inputs.txt")).ok()?;
    let pathspecs: Vec<String> = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .collect();
    if pathspecs.is_empty() {
        None
    } else {
        Some(pathspecs)
    }
}

fn git_output(dir: &Path, args: &[&str]) -> Option<String> {
    let text = String::from_utf8(git_output_bytes(dir, args)?).ok()?;
    Some(text.trim().to_owned())
}

fn git_output_bytes(dir: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .ok()?;
    output.status.success().then_some(output.stdout)
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    git_output(dir, args).filter(|s| !s.is_empty())
}

fn resolve_common_dir(git_dir: &Path) -> PathBuf {
    match fs::read_to_string(git_dir.join("commondir")) {
        Ok(content) => {
            let pointed = PathBuf::from(content.trim());
            if pointed.is_absolute() {
                pointed
            } else {
                git_dir.join(pointed)
            }
        }
        Err(_) => git_dir.to_path_buf(),
    }
}

fn resolve_git_dir(manifest_dir: &Path) -> Option<PathBuf> {
    let dot_git = manifest_dir.join(".git");
    let meta = fs::metadata(&dot_git).ok()?;
    if meta.is_dir() {
        return Some(dot_git);
    }
    let content = fs::read_to_string(&dot_git).ok()?;
    let path = content
        .lines()
        .find_map(|line| line.strip_prefix("gitdir:"))?;
    let pointed = PathBuf::from(path.trim());
    Some(if pointed.is_absolute() {
        pointed
    } else {
        manifest_dir.join(pointed)
    })
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
