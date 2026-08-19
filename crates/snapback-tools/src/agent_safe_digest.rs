//! Clean-tree implementation digest used by the agent-safe qualification tools.
//!
//! @ref LLP 0162#8-capability-honesty -- the publication carriers bind one
//! canonical implementation-tree digest without making the source-owned
//! publication-cycle artifacts leaves of that same tree.

use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::Command;

/// Compute the canonical digest for a clean contributor checkout.
///
/// `None` is fail-closed: Git is unavailable, either checkout is dirty, the
/// Ibex gitlink is not the checked-out revision, or a tree entry is malformed.
#[doc(hidden)]
pub fn implementation_tree_sha256(repo_root: &Path) -> Option<String> {
    // This authority is stricter than the general diagnostic build identity:
    // callers may override SNAPBACK_BUILD_GIT_DIRTY for deterministic build
    // stamping, but they may not override the bytes that authorize a public
    // capability. Untracked source can participate in Rust module resolution,
    // so require the complete contributor worktree to be clean.
    if !git_output(
        repo_root,
        &["status", "--porcelain", "--untracked-files=all"],
    )?
    .is_empty()
    {
        return None;
    }
    let ibex_dir = repo_root.join("vendor/ibex");
    let parent_ibex_gitlink = git(repo_root, &["rev-parse", "HEAD:vendor/ibex"])?;
    let checked_out_ibex_head = git_output(&ibex_dir, &["rev-parse", "HEAD"])?;
    if checked_out_ibex_head != parent_ibex_gitlink
        || !git_output(
            &ibex_dir,
            &["status", "--porcelain", "--untracked-files=all"],
        )?
        .is_empty()
    {
        return None;
    }

    let listed = git_output_bytes(
        repo_root,
        &[
            "ls-tree",
            "-r",
            "-z",
            "HEAD",
            "--",
            "Cargo.toml",
            "Cargo.lock",
            "crates/snapback-activation/Cargo.toml",
            "crates/snapback-activation/src",
            "crates/snapback-auth/Cargo.toml",
            "crates/snapback-auth/src",
            "crates/snapback-cli/Cargo.toml",
            "crates/snapback-cli/src",
            "crates/snapback-conformance/Cargo.toml",
            "crates/snapback-conformance/build.rs",
            "crates/snapback-conformance/src",
            "crates/snapback-engine/Cargo.toml",
            "crates/snapback-engine/build.rs",
            "crates/snapback-engine/src",
            "crates/snapback-kernel/Cargo.toml",
            "crates/snapback-kernel/src",
            "crates/snapback-runtime/Cargo.toml",
            "crates/snapback-runtime/build.rs",
            "crates/snapback-runtime/src",
            "crates/snapback-server/Cargo.toml",
            "crates/snapback-server/build.rs",
            "crates/snapback-server/src",
            "crates/snapback-services/Cargo.toml",
            "crates/snapback-services/src",
            "crates/snapback-sync/Cargo.toml",
            "crates/snapback-sync/src",
            "crates/snapback-tools/Cargo.toml",
            "crates/snapback-tools/build.rs",
            "crates/snapback-tools/src",
            "crates/snapback-types/Cargo.toml",
            "crates/snapback-types/src",
            "crates/snapback/Cargo.toml",
            "crates/snapback/build.rs",
            ".gitmodules",
            "crates/snapback/src",
            "crates/snapback/tests",
            "packages/snapback-codegen",
            "packages/snapback-contract",
            "tests",
            "scripts/check-agent-safe-publication.mjs",
            "scripts/generated-artifact-policy.mjs",
        ],
    )?;
    let mut entries = String::from_utf8(listed)
        .ok()?
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(parse_agent_safe_tree_entry)
        .collect::<Option<Vec<_>>>()?;
    entries.retain(|entry| !agent_safe_publication_cycle_path(&entry.path));
    let ibex_entries = String::from_utf8(git_output_bytes(
        repo_root,
        &["ls-tree", "-z", "HEAD", "--", "vendor/ibex"],
    )?)
    .ok()?
    .split('\0')
    .filter(|entry| !entry.is_empty())
    .map(parse_agent_safe_tree_entry)
    .collect::<Option<Vec<_>>>()?;
    if ibex_entries.len() != 1
        || ibex_entries[0].path != "vendor/ibex"
        || ibex_entries[0].mode != "160000"
        || ibex_entries[0].object_type != "commit"
        || ibex_entries[0].oid != parent_ibex_gitlink
    {
        return None;
    }
    entries.push(ibex_entries.into_iter().next()?);
    entries.sort_unstable_by(|left, right| left.path.cmp(&right.path));
    if entries.len() == 1 {
        return None;
    }

    let mut digest = Sha256::new();
    digest.update(b"snapback:agent-safe-implementation-tree:v4\n");
    for entry in entries {
        let bytes = if entry.object_type == "blob" {
            git_output_bytes(repo_root, &["cat-file", "blob", &entry.oid])?
        } else if entry.object_type == "commit" && entry.mode == "160000" {
            entry.oid.as_bytes().to_vec()
        } else {
            return None;
        };
        digest.update(entry.mode.as_bytes());
        digest.update([0]);
        digest.update(entry.object_type.as_bytes());
        digest.update([0]);
        digest.update(entry.path.as_bytes());
        digest.update([0]);
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    Some(format!("sha256:{:x}", digest.finalize()))
}

struct AgentSafeTreeEntry {
    mode: String,
    object_type: String,
    oid: String,
    path: String,
}

fn parse_agent_safe_tree_entry(record: &str) -> Option<AgentSafeTreeEntry> {
    let (header, path) = record.split_once('\t')?;
    let mut fields = header.split_whitespace();
    let mode = fields.next()?;
    let object_type = fields.next()?;
    let oid = fields.next()?;
    if fields.next().is_some()
        || mode.len() != 6
        || !mode.bytes().all(|byte| byte.is_ascii_digit())
        || !matches!(object_type, "blob" | "commit")
        || !matches!(oid.len(), 40 | 64)
        || !oid.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(AgentSafeTreeEntry {
        mode: mode.to_owned(),
        object_type: object_type.to_owned(),
        oid: oid.to_owned(),
        path: path.to_owned(),
    })
}

fn agent_safe_publication_cycle_path(path: &str) -> bool {
    // @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04
    // Evidence about qualification C cannot be a leaf of the implementation
    // digest that certifies it. Keep tests covered, but exclude the exact
    // canonical, receipt-bound publication-cycle artifacts mirrored here.
    matches!(
        path,
        "crates/snapback-activation/src/local-agent-safe-storage-publication.anchor.json"
            | "crates/snapback-activation/src/local-agent-safe-storage-publication.carrier.json"
            | "crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json"
            | "crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.carrier.json"
            | "tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json"
            | "tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json"
            | "tests/acceptance/fixtures/agent-safe-storage/acceptance-corpus.2026-08-04.v1.json"
            | "tests/acceptance/fixtures/agent-safe-storage/agent-safe-active-covered-paired.2026-08-04.v1.json"
            | "tests/acceptance/fixtures/agent-safe-storage/fork-promotion-performance.2026-08-04.v1.json"
            | "tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json"
            | "tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json"
            | "tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json"
            | "tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json"
            | "tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json"
            | "tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.r2.v1.json"
            | "tests/acceptance/latency-kanban-move3-v1-evidence.md"
            | "tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json"
            | "tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json"
            | "tests/acceptance/triage-graph-move1-v1-evidence.md"
            | "tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json"
            | "tests/acceptance/fixtures/fleet-observatory/budget-freeze.2026-08-06.v1.json"
            | "tests/acceptance/fleet-observatory-move1-v1-evidence.md"
            | "tests/acceptance/fixtures/contention-calendar/rung2-exit.2026-08-04.r1.v1.json"
            | "tests/acceptance/contention-calendar-rung2-v1-evidence.md"
            | "tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json"
            | "tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json"
            | "tests/acceptance/local-store-carrier-exit-v1-evidence.md"
            | "crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json"
            | "crates/snapback-engine/src/local-persistent-store-publication.v1.json"
    )
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
    git_output(dir, args).filter(|output| !output.is_empty())
}
