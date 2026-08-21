// `binary_identity()` and `build_distribution()` are compiled in this crate,
// so their `option_env!` stamps must be emitted by this package's own build
// script. Cargo does not propagate `cargo:rustc-env` to dependencies.
//
// @ref LLP 0031#server-binary-identity-on-health — the public build identity
// remains fail-closed when commit/dirty provenance cannot be established.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    // binary_identity() moved into this package, so its compile-time facts
    // must move with it: Cargo build-script environment is package-local.
    // @ref LLP 0283#f-5--named-exceptions-with-burn-down-tickets — preserve
    // provenance contracts in the package that owns the moved consumer.
    emit_build_identity();
}

/// Emit the git commit + dirty state consumed by `identity::binary_identity()`.
/// This is the same best-effort, runtime-input-scoped contract as
/// `crates/snapback/build.rs`: explicit deterministic CI stamps win; an
/// unknown dirty state remains unset and is therefore treated conservatively
/// by consumers.
///
/// @ref LLP 0031#server-binary-identity-on-health — the build/provenance facts
/// answering "is this MY checkout's binary?" on the ungated public /health.
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

    // @ref LLP 0110#local-and-packaged-publication-authority — distribution
    // is a compiled trust fact, with contributor source as the safe default.
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
