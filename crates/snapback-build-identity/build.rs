use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — 1c's decision
// lives beside this script so every forbidden-channel class has a unit test
// that does not cost a fat-LTO build.
#[path = "build_recipe_policy.rs"]
mod build_recipe_policy;

use build_recipe_policy::{PRODUCTION_PROFILE, SHIP_OPT_LEVEL, StampInputs};

/// Environment names whose value the ship-recipe policy reads. Cargo reruns a
/// build script only for the variables it is told about, so an override added
/// after a cached stamp would otherwise never be seen.
const RECIPE_SENSITIVE_ENVIRONMENT: [&str; 11] = [
    "CARGO_INCREMENTAL",
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTFLAGS",
    "RUSTC",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "CARGO_BUILD_RUSTC",
    "CARGO_BUILD_RUSTC_WRAPPER",
    "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
    "CARGO_HOME",
];

const RECIPE_SENSITIVE_PROFILE_KNOBS: [&str; 11] = [
    "LTO",
    "CODEGEN_UNITS",
    "INCREMENTAL",
    "STRIP",
    "OPT_LEVEL",
    "DEBUG",
    "DEBUG_ASSERTIONS",
    "OVERFLOW_CHECKS",
    "PANIC",
    "RPATH",
    "SPLIT_DEBUGINFO",
];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=build_recipe_policy.rs");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_DIRTY");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_DISTRIBUTION");

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let repo_root = manifest_dir.join("../..");

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
    println!("cargo:rustc-env=SNAPBACK_BUILD_DISTRIBUTION={distribution}");

    emit_build_recipe(&repo_root);
}

/// Stamp the resolved profile plus, on the ship profile only, the
/// `[profile.production]` recipe the root manifest declares.
///
/// @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — 1c: without
/// this the identity cannot tell a real production build from an
/// env-overridden ordinary release, because `build_profile` is derived from
/// `cfg!(debug_assertions)` and reports `release` for both. The refusal is
/// raised here rather than at assembly because this is the one point inside
/// the very Cargo invocation being attested.
fn emit_build_recipe(repo_root: &Path) {
    let root_manifest_path = repo_root.join("Cargo.toml");
    println!("cargo:rerun-if-changed=../../Cargo.toml");
    for name in RECIPE_SENSITIVE_ENVIRONMENT {
        println!("cargo:rerun-if-env-changed={name}");
    }
    for profile in ["PRODUCTION", "RELEASE"] {
        for knob in RECIPE_SENSITIVE_PROFILE_KNOBS {
            println!("cargo:rerun-if-env-changed=CARGO_PROFILE_{profile}_{knob}");
        }
    }

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo");
    let discovered_config_files = discover_cargo_config_files(repo_root);
    for (path, _) in &discovered_config_files {
        println!("cargo:rerun-if-changed={path}");
    }
    let root_manifest = fs::read_to_string(&root_manifest_path).unwrap_or_else(|error| {
        panic!(
            "{}: root manifest is unreadable at {}: {error}",
            build_recipe_policy::UNATTESTABLE_CODE,
            root_manifest_path.display()
        )
    });

    let cargo_profile_class = std::env::var("PROFILE").expect("PROFILE is set by cargo");
    let opt_level = std::env::var("OPT_LEVEL").expect("OPT_LEVEL is set by cargo");
    let inputs = StampInputs {
        out_dir: &out_dir,
        cargo_profile_class: &cargo_profile_class,
        opt_level: &opt_level,
        root_manifest: &root_manifest,
        environment: std::env::vars().collect(),
        cargo_argv: invoking_cargo_command_line(&out_dir),
        discovered_config_files,
        expected_opt_level: SHIP_OPT_LEVEL,
    };
    let recipe = match build_recipe_policy::evaluate(&inputs) {
        Ok(recipe) => recipe,
        Err(message) => panic!(
            "{message}\n\nThe published runtime's recipe stamp is only worth what \
             the build can prove. Re-run the plain ship command from a clean \
             environment: SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build \
             --profile production --bin snapback"
        ),
    };
    println!("cargo:rustc-env=SNAPBACK_BUILD_RECIPE={}", recipe.to_json());
}

/// Cargo discovers `.cargo/config.toml` from its invocation directory upward
/// and from `CARGO_HOME`, and none of that reaches a build script's resolved
/// profile. Collect the same files so the policy can refuse the ones that
/// would re-shape the ship recipe.
fn discover_cargo_config_files(repo_root: &Path) -> Vec<(String, String)> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut directory = fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    loop {
        roots.push(directory.join(".cargo"));
        match directory.parent() {
            Some(parent) if parent != directory => directory = parent.to_path_buf(),
            _ => break,
        }
    }
    if let Some(cargo_home) = std::env::var_os("CARGO_HOME") {
        roots.push(PathBuf::from(cargo_home));
    }

    let mut discovered: Vec<(String, String)> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for root in roots {
        for name in ["config.toml", "config"] {
            let candidate = root.join(name);
            let display = candidate.display().to_string();
            if seen.contains(&display) {
                continue;
            }
            seen.push(display.clone());
            if let Ok(contents) = fs::read_to_string(&candidate) {
                discovered.push((display, contents));
            }
        }
    }
    discovered
}

/// The invoking `cargo` process is this build script's parent, and its command
/// line is the only place `--config` and trailing `cargo rustc -- -C …` flags
/// are visible. Off the ship profile this is never consulted; on it, an
/// unreadable command line fails closed in the policy.
#[cfg(unix)]
fn invoking_cargo_command_line(out_dir: &str) -> Vec<String> {
    if build_recipe_policy::profile_directory_name(out_dir).as_deref() != Some(PRODUCTION_PROFILE) {
        return Vec::new();
    }
    let parent = std::os::unix::process::parent_id();
    if let Ok(raw) = fs::read(format!("/proc/{parent}/cmdline")) {
        let argv: Vec<String> = raw
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
            .map(|part| String::from_utf8_lossy(part).into_owned())
            .collect();
        if !argv.is_empty() {
            return argv;
        }
    }
    let Ok(output) = Command::new("ps")
        .args(["-ww", "-o", "args=", "-p", &parent.to_string()])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

// The ship profile is manufactured on darwin-arm64 and linux-x64 only; on any
// other host the command line cannot be read and the policy fails closed.
#[cfg(not(unix))]
fn invoking_cargo_command_line(_out_dir: &str) -> Vec<String> {
    Vec::new()
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
