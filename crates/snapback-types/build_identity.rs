use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Emit the git commit + dirty state provenance-sensitive binaries report.
/// Both facts are best-effort: a build outside a git checkout (or without git)
/// leaves the commit unset, which the runtime reports as `"unknown"`, and an
/// unknown dirty state remains unset so consumers conservatively treat it as
/// dirty. The dirty fact is scoped to the runtime input set
/// (`scripts/runtime-build-inputs.txt`): `dirty=true` means "this binary's
/// *inputs* were uncommitted", not "some file somewhere in the checkout was".
/// Explicit `SNAPBACK_BUILD_GIT_COMMIT` / `SNAPBACK_BUILD_GIT_DIRTY` stamps win
/// over the git probe.
///
/// This file is the source of truth included by every crate whose package-local
/// build-script environment must expose the shared binary-identity contract.
///
/// @ref LLP 0031#server-binary-identity-on-health — the build/provenance facts
/// answering "is this MY checkout's binary?" on the ungated public /health.
pub fn emit_build_identity() {
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_DIRTY");
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_DISTRIBUTION");

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let repo_root = manifest_dir.join("../..");

    // The stamp must track the binary's *real* inputs, not just git metadata:
    // cargo replays cached `rustc-env` output unless a tracked input changes, so
    // without these an incremental rebuild after a source edit recompiled the
    // crate with the previous build's commit/dirty pair — a binary containing
    // uncommitted code that self-reported the old clean commit (ENG-23365).
    // Directory paths are scanned recursively by cargo. Derive this set from
    // the same source used by the dirty probe so newly embedded runtime inputs
    // cannot silently miss build-script invalidation.
    if let Some(pathspecs) = runtime_input_pathspecs(&repo_root) {
        for pathspec in pathspecs {
            println!("cargo:rerun-if-changed=../../{pathspec}");
        }
    }

    // The dirty probe below is scoped by this shared definition; a changed
    // definition must re-run the probe.
    println!("cargo:rerun-if-changed=../../scripts/runtime-build-inputs.txt");

    // Re-stamp when the git side moves: HEAD and the index live in the
    // (possibly per-worktree) git dir; the branch-tip ref store lives in the
    // *common* git dir. Tracking refs/heads + packed-refs catches ref-only
    // moves (`git reset --soft`, `git update-ref`) that touch neither HEAD —
    // still the same symbolic ref — nor the index (ENG-23365).
    if let Some(git_dir) = resolve_git_dir(&repo_root) {
        let common_dir = resolve_common_dir(&git_dir);
        let inputs = [
            git_dir.join("HEAD"),
            git_dir.join("index"),
            common_dir.join("refs").join("heads"),
            common_dir.join("packed-refs"),
        ];
        for path in inputs {
            // Only existing paths: cargo treats a missing tracked path as
            // always-changed, which would rerun this script on every build.
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }

    if let Some(commit) = resolve_git_commit(&repo_root) {
        println!("cargo:rustc-env=SNAPBACK_BUILD_GIT_COMMIT={commit}");
    }

    let dirty = env_nonempty("SNAPBACK_BUILD_GIT_DIRTY")
        .and_then(|v| match v.as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        })
        .or_else(|| {
            // Must go through `git_output`, not `git`: a clean tree is exactly
            // the success-with-empty-output case, which `git` conflates with
            // failure — under `git` the probe could never yield Some(false)
            // and every clean build was stamped dirty-by-default (ENG-23419).
            //
            // The probe is scoped to the runtime binary's input set (shared
            // definition: scripts/runtime-build-inputs.txt), not the whole
            // tree: a demo/LLP/issue edit cannot change this binary's bytes,
            // so it must not flip the dirty fact and force identity-consuming
            // crates to recompile. A missing/empty definition falls back to
            // whole-tree status — conservative, never under-reporting
            // (issues/closed/20260805-whole-tree-dirty-flag-forces-runtime-rebuild.md).
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
    // Only a proven-clean tree emits "false"; an unknown result stays unset and
    // the runtime defaults it to dirty (conservative: no reuse on doubt).
    if let Some(dirty) = dirty {
        println!("cargo:rustc-env=SNAPBACK_BUILD_GIT_DIRTY={dirty}");
    }

    // @ref LLP 0110#local-and-packaged-publication-authority — contributor
    // source builds may consume the source-embedded relation/activity carrier,
    // while public packages must carry a release-key attestation. The current
    // package pipeline has no such attestation, so it compiles an explicit
    // fail-closed distribution fact that withholds both capabilities.
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

/// Resolve the explicit deterministic stamp or the checkout's current commit.
/// Consumers embedding another build-bound artifact use the same precedence.
pub fn resolve_git_commit(repo_root: &Path) -> Option<String> {
    env_nonempty("SNAPBACK_BUILD_GIT_COMMIT")
        .or_else(|| git(repo_root, &["rev-parse", "HEAD"]))
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// The git pathspecs bounding the runtime binary's input set, from the shared
/// definition file `scripts/runtime-build-inputs.txt` (one pathspec per line,
/// `#` comments). `None` — file missing, unreadable, or empty — means "no
/// scoped definition"; callers fall back to whole-tree status, which can only
/// over-report dirtiness.
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

/// Run `git <args>` in `dir`, returning trimmed stdout on success — including
/// an *empty* string when the command succeeded with no output (e.g.
/// `git status --porcelain` on a clean tree). `None` means only "the command
/// failed or git is unavailable" (ENG-23419).
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

/// Run `git <args>` in `dir`, returning trimmed stdout only when non-empty —
/// for probes like `rev-parse HEAD` where empty output is as useless as failure.
fn git(dir: &Path, args: &[&str]) -> Option<String> {
    git_output(dir, args).filter(|s| !s.is_empty())
}

/// The shared git directory holding the ref store (`refs/`, `packed-refs`).
/// A linked worktree's per-worktree git dir carries a `commondir` file pointing
/// (often relatively) at the main repository's git dir; a primary checkout has
/// no such file and is its own common dir.
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

/// The real git directory for `manifest_dir`, handling a linked worktree whose
/// `.git` is a `gitdir: <path>` pointer file rather than a directory.
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
