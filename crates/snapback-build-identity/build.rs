use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[path = "src/build_recipe.rs"]
mod build_recipe;

use build_recipe::{CargoBuildRecipe, ambient_cargo_configs, validate_public_package_environment};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_DIRTY");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_DISTRIBUTION");
    println!("cargo:rerun-if-env-changed=CARGO_INCREMENTAL");
    println!("cargo:rerun-if-env-changed=CARGO_HOME");
    println!("cargo:rerun-if-env-changed=RUSTFLAGS");
    println!("cargo:rerun-if-env-changed=CARGO_ENCODED_RUSTFLAGS");
    println!("cargo:rerun-if-env-changed=CARGO_BUILD_RUSTFLAGS");
    println!("cargo:rerun-if-env-changed=RUSTC");
    println!("cargo:rerun-if-env-changed=CARGO_BUILD_RUSTC");
    println!("cargo:rerun-if-env-changed=RUSTC_WRAPPER");
    println!("cargo:rerun-if-env-changed=RUSTC_WORKSPACE_WRAPPER");
    for profile in ["PRODUCTION", "RELEASE"] {
        for setting in [
            "CODEGEN_UNITS",
            "DEBUG",
            "DEBUG_ASSERTIONS",
            "INCREMENTAL",
            "LTO",
            "OPT_LEVEL",
            "OVERFLOW_CHECKS",
            "PANIC",
            "RPATH",
            "SPLIT_DEBUGINFO",
            "STRIP",
        ] {
            println!("cargo:rerun-if-env-changed=CARGO_PROFILE_{profile}_{setting}");
        }
    }
    if let Ok(target) = std::env::var("TARGET") {
        let target = target.replace('-', "_").to_ascii_uppercase();
        println!("cargo:rerun-if-env-changed=CARGO_TARGET_{target}_RUSTFLAGS");
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let repo_root = manifest_dir.join("../..");
    println!("cargo:rerun-if-changed=../../Cargo.toml");

    // @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — the
    // build leaf, rather than a packaging ceremony, stamps Cargo's actual
    // named profile plus the closed root production recipe and rejects
    // override channels that could make that declaration false. Cargo's
    // `PROFILE` collapses a custom profile inheriting release to `release`, so
    // the named profile comes from the profile component of Cargo's OUT_DIR.
    let profile = cargo_profile_from_out_dir()
        .expect("Cargo OUT_DIR carries the named profile for build scripts");
    let root_manifest =
        fs::read_to_string(repo_root.join("Cargo.toml")).expect("root Cargo.toml is readable");
    let recipe = CargoBuildRecipe::for_profile(&profile, &root_manifest)
        .unwrap_or_else(|error| panic!("public package build recipe is invalid: {error}"));

    // The stamp tracks the binary's real input closure. Cargo otherwise reuses
    // a cached clean stamp after an uncommitted source edit (ENG-23365).
    if let Some(pathspecs) = runtime_input_pathspecs(&repo_root) {
        for pathspec in pathspecs {
            if pathspec == "guide" {
                continue;
            }
            println!("cargo:rerun-if-changed=../../{pathspec}");
        }
    }
    println!("cargo:rerun-if-changed=../../scripts/runtime-build-inputs.txt");
    // `snapback-guide-embed` is the sole direct Cargo watcher and producer for
    // `guide/**`. Its `links` metadata gives this sole Git probe a generated
    // trigger, so a Guide edit still recomputes conservative dirtiness without
    // making this build script a second Guide-tree watcher.
    let guide_artifact = std::env::var("DEP_SNAPBACK_GUIDE_EMBED_ARTIFACT_PATH")
        .expect("snapback-guide-embed publishes its generated artifact path");
    println!("cargo:rerun-if-changed={guide_artifact}");
    emit_git_identity_inputs(&repo_root);

    let commit = resolve_git_commit(&repo_root).unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=SNAPBACK_BUILD_GIT_COMMIT={commit}");

    let git_dirty = env_nonempty("SNAPBACK_BUILD_GIT_DIRTY")
        .and_then(|value| match value.as_str() {
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
            git_output(&repo_root, &arg_refs).map(|output| !output.is_empty())
        });
    println!(
        "cargo:rustc-env=SNAPBACK_BUILD_GIT_DIRTY={}",
        git_dirty.unwrap_or(true)
    );

    // @ref LLP 0110#local-and-packaged-publication-authority — contributor
    // source and public-package trust roots remain an explicit build fact.
    let distribution = env_nonempty("SNAPBACK_BUILD_DISTRIBUTION")
        .unwrap_or_else(|| "contributor-source".to_owned());
    assert!(
        matches!(
            distribution.as_str(),
            "contributor-source" | "public-package"
        ),
        "SNAPBACK_BUILD_DISTRIBUTION must be contributor-source or public-package"
    );
    if distribution == "public-package" {
        recipe
            .assert_ship_recipe()
            .unwrap_or_else(|error| panic!("public package build recipe is invalid: {error}"));
        let environment = std::env::vars().collect::<Vec<_>>();
        let configs = ambient_cargo_configs(&repo_root, &environment);
        validate_public_package_environment(
            &profile,
            &environment,
            parent_command_line().as_deref(),
            &configs,
        )
        .unwrap_or_else(|error| panic!("public package build recipe is invalid: {error}"));
    }
    println!("cargo:rustc-env=SNAPBACK_BUILD_DISTRIBUTION={distribution}");
    println!("cargo:rustc-env=SNAPBACK_BUILD_RECIPE={}", recipe.json());
}

fn cargo_profile_from_out_dir() -> Option<String> {
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR")?);
    out_dir
        .ancestors()
        .nth(3)?
        .file_name()?
        .to_str()
        .map(str::to_owned)
}

fn parent_command_line() -> Option<String> {
    let parent = Command::new("ps")
        .args(["-o", "ppid=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    if !parent.status.success() {
        return None;
    }
    let parent_pid = String::from_utf8(parent.stdout).ok()?.trim().to_owned();
    if parent_pid.is_empty() {
        return None;
    }
    let command = Command::new("ps")
        .args(["-o", "command=", "-p", &parent_pid])
        .output()
        .ok()?;
    if !command.status.success() {
        return None;
    }
    String::from_utf8(command.stdout)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Track only Git facts that can change this worktree's reported revision.
///
/// @ref LLP 0316#phase-1--build-identity-invalidation-surgical — the index
/// and sibling worktree refs are not identity inputs.
fn emit_git_identity_inputs(repo_root: &Path) {
    if let Some(git_dir) = resolve_git_dir(repo_root) {
        let common_dir = resolve_common_dir(&git_dir);
        let mut inputs = vec![git_dir.join("HEAD"), git_dir.join("logs").join("HEAD")];
        if let Some(current_branch_ref) = resolve_current_branch_ref(&git_dir, &common_dir) {
            inputs.push(current_branch_ref);
        }
        inputs.push(common_dir.join("packed-refs"));
        for path in inputs {
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }
}

fn resolve_git_commit(repo_root: &Path) -> Option<String> {
    env_nonempty("SNAPBACK_BUILD_GIT_COMMIT").or_else(|| git(repo_root, &["rev-parse", "HEAD"]))
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn runtime_input_pathspecs(repo_root: &Path) -> Option<Vec<String>> {
    let content = fs::read_to_string(repo_root.join("scripts/runtime-build-inputs.txt")).ok()?;
    let pathspecs: Vec<String> = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .collect();
    (!pathspecs.is_empty()).then_some(pathspecs)
}

fn git_output(dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|text| text.trim().to_owned())
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    git_output(dir, args).filter(|output| !output.is_empty())
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

fn resolve_current_branch_ref(git_dir: &Path, common_dir: &Path) -> Option<PathBuf> {
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let symbolic_ref = head
        .lines()
        .find(|line| !line.trim().is_empty())?
        .trim()
        .strip_prefix("ref:")?
        .trim();
    let branch_name = symbolic_ref.strip_prefix("refs/heads/")?;
    (!branch_name.is_empty()).then(|| common_dir.join("refs").join("heads").join(branch_name))
}

fn resolve_git_dir(manifest_dir: &Path) -> Option<PathBuf> {
    let dot_git = manifest_dir.join(".git");
    let metadata = fs::metadata(&dot_git).ok()?;
    if metadata.is_dir() {
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
