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

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{fs, io::Write};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=HERMES_LIB_DIR");
    println!("cargo:rerun-if-changed=../../guide");
    println!("cargo:rerun-if-changed=../../schemas/http.routes.v1.json");

    // @ref LLP 0061#4-distribution-and-discovery — served-guide §4a:
    // every binary carries the checked guide snapshot; eval evidence is not
    // part of the served authoring corpus.
    emit_embedded_guide();

    // Stamp the server-binary provenance the ungated `/health` reports so an
    // externally started server is verifiable before any app bundle loads
    // (ENG-22798). Runs on every target, so it precedes the macOS-only rpath work.
    emit_build_identity();
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

fn emit_embedded_guide() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let guide_dir = manifest_dir.join("../../guide");
    let mut files = Vec::new();
    collect_guide_files(&guide_dir, &guide_dir, &mut files).expect("walk the checked guide corpus");
    files.sort();
    let section_flat_paths = files
        .iter()
        .filter(|path| {
            path.as_str() != "guide-flat.generated.md"
                && path.starts_with("guide-flat.")
                && path.ends_with(".generated.md")
        })
        .cloned()
        .collect::<Vec<_>>();
    assert!(
        !section_flat_paths.is_empty(),
        "served guide is missing generated section flat projections"
    );

    for required in [
        "index.md",
        "capabilities.md",
        "guide-manifest.generated.json",
        "guide-flat.generated.md",
        // @ref LLP 0194#design — the native binary is the build-bound carrier
        // for the compact reference index and canonical registry, not only pages.
        "reference/index.md",
        "reference/registry.json",
        // @ref LLP 0193#program — exact diagnostic lookup uses the same
        // embedded, manifest-bound Guide artifact as the human projection.
        "reference/diagnostics.md",
        "reference/diagnostics-registry.json",
    ] {
        assert!(
            files.iter().any(|path| path == required),
            "served guide is missing required generated/input file {required}"
        );
    }

    let manifest = fs::read_to_string(guide_dir.join("guide-manifest.generated.json"))
        .expect("read generated guide manifest");
    let content_hash = generated_json_string(&manifest, "contentHash")
        .expect("generated guide manifest carries contentHash");
    assert!(
        content_hash.len() == 64 && content_hash.chars().all(|c| c.is_ascii_hexdigit()),
        "generated guide contentHash must be a SHA-256 hex digest"
    );

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let build_commit = env_nonempty("SNAPBACK_BUILD_GIT_COMMIT")
        .or_else(|| git(&manifest_dir, &["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_owned());
    let build_commit = if build_commit
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-._".contains(character))
    {
        build_commit
    } else {
        "unknown".to_owned()
    };
    // @ref LLP 0232#d-2-prepared-execution-and-rebase-stable-records — the checked source record is content-bound. The
    // binary carrier adds its exact commit only while embedding the manifest.
    let identity_prefix = "\"buildIdentity\": {";
    let embedded_manifest = manifest.replacen(
        identity_prefix,
        &format!("{identity_prefix}\n    \"commit\": \"{build_commit}\","),
        1,
    );
    assert_ne!(
        embedded_manifest, manifest,
        "generated guide manifest carries buildIdentity"
    );
    fs::write(
        out_dir.join("embedded-guide-manifest.json"),
        embedded_manifest,
    )
    .expect("write build-bound embedded guide manifest");

    let mut output = fs::File::create(out_dir.join("embedded_guide.rs"))
        .expect("create generated embedded guide module");
    writeln!(
        output,
        "pub const GUIDE_CONTENT_SHA256: &str = {content_hash:?};"
    )
    .expect("write guide hash");
    writeln!(
        output,
        "pub static EMBEDDED_GUIDE_FILES: &[EmbeddedGuideFile] = &["
    )
    .expect("start embedded guide table");
    for path in files {
        let content_type = guide_content_type(&path);
        if path == "guide-manifest.generated.json" {
            writeln!(
                output,
                "    EmbeddedGuideFile {{ path: {path:?}, bytes: include_bytes!(concat!(env!(\"OUT_DIR\"), \"/embedded-guide-manifest.json\")), content_type: {content_type:?} }},"
            )
            .expect("write build-bound embedded guide manifest entry");
        } else {
            let include_suffix = format!("/../../guide/{path}");
            writeln!(
                output,
                "    EmbeddedGuideFile {{ path: {path:?}, bytes: include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), {include_suffix:?})), content_type: {content_type:?} }},"
            )
            .expect("write embedded guide entry");
        }
    }
    writeln!(output, "];").expect("finish embedded guide table");
    writeln!(output, "pub static SECTION_FLAT_PATHS: &[&str] = &[")
        .expect("start embedded guide section path table");
    for path in section_flat_paths {
        writeln!(output, "    {path:?},").expect("write embedded guide section path");
    }
    writeln!(output, "];").expect("finish embedded guide section path table");
}

fn collect_guide_files(root: &Path, dir: &Path, files: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if entry.file_name() != "eval-runs" {
                collect_guide_files(root, &path, files)?;
            }
            continue;
        }
        if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .expect("guide entry stays beneath guide root")
                .to_string_lossy()
                .replace('\\', "/");
            files.push(relative);
        }
    }
    Ok(())
}

fn guide_content_type(path: &str) -> &'static str {
    if path.ends_with(".md") {
        "text/markdown; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn generated_json_string<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("\"{key}\": \"");
    let rest = json.split_once(&prefix)?.1;
    Some(rest.split_once('"')?.0)
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

/// Emit the git commit + dirty state the running binary reports as its
/// server-binary identity on `/health` (ENG-22798). Both are best-effort: a
/// build outside a git checkout (or without git) leaves the commit unset, which
/// the runtime reports as `"unknown"`, and an unknown/dirty state is treated as
/// dirty by provenance consumers so a not-soundly-identifiable build never
/// enables reuse. The dirty fact is scoped to the runtime input set
/// (`scripts/runtime-build-inputs.txt`): `dirty=true` means "this binary's
/// *inputs* were uncommitted", not "some file somewhere in the checkout was".
/// `SNAPBACK_BUILD_GIT_COMMIT` / `SNAPBACK_BUILD_GIT_DIRTY` can
/// be set explicitly (e.g. a deterministic CI stamp) and win over the git probe.
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

    // These additional paths feed the agent-safe implementation digest below.
    println!("cargo:rerun-if-changed=../../packages/snapback-codegen");
    println!("cargo:rerun-if-changed=../../packages/snapback-contract");
    println!("cargo:rerun-if-changed=../../crates/snapback-activation/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-activation/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-auth/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-auth/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-engine/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-engine/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-kernel/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-kernel/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-runtime/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-runtime/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-services/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-services/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-sync/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-sync/src");
    println!("cargo:rerun-if-changed=../../crates/snapback-types/Cargo.toml");
    println!("cargo:rerun-if-changed=../../crates/snapback-types/src");
    println!("cargo:rerun-if-changed=../../tests");
    println!("cargo:rerun-if-changed=../../scripts/check-agent-safe-publication.mjs");
    println!("cargo:rerun-if-changed=../../scripts/generated-artifact-policy.mjs");
    println!("cargo:rerun-if-changed=../../.gitmodules");
    // The agent-safe digest binds vendored Ibex source and submodule state,
    // so Snapback's build script must rerun whenever Cargo may rebuild that
    // path dependency. Tracking only the parent gitlink is insufficient for
    // an incremental build whose checked-out submodule changes in place.
    if repo_root.join("vendor/ibex").exists() {
        // Cargo scans directory inputs recursively. Ibex's build consumes
        // build_support, capsec, schemas, native tests, public headers, and
        // vendored-generated inputs in addition to its Rust source.
        println!("cargo:rerun-if-changed=../../vendor/ibex");
    }
    let ibex_dir = repo_root.join("vendor/ibex");
    if let Some(ibex_git_dir) = resolve_git_dir(&ibex_dir) {
        for relative in ["HEAD", "index", "commondir"] {
            let path = ibex_git_dir.join(relative);
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
        let ibex_common_dir = resolve_common_dir(&ibex_git_dir);
        for relative in ["HEAD", "packed-refs", "refs"] {
            let path = ibex_common_dir.join(relative);
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }

    // @ref LLP 0162#8-capability-honesty — the two agent-safe publication
    // carriers bind one canonical implementation-tree digest. The source-owned
    // anchor/carrier bytes are deliberately outside that tree, breaking the
    // publication cycle without letting the receipt omit implementation code.
    if let Some(digest) = agent_safe_implementation_tree_sha256(&repo_root) {
        println!("cargo:rustc-env=SNAPBACK_AGENT_SAFE_IMPLEMENTATION_SHA256={digest}");
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

fn agent_safe_implementation_tree_sha256(repo_root: &Path) -> Option<String> {
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
            "crates/snapback-engine/Cargo.toml",
            "crates/snapback-engine/src",
            "crates/snapback-kernel/Cargo.toml",
            "crates/snapback-kernel/src",
            "crates/snapback-runtime/Cargo.toml",
            "crates/snapback-runtime/src",
            "crates/snapback-services/Cargo.toml",
            "crates/snapback-services/src",
            "crates/snapback-sync/Cargo.toml",
            "crates/snapback-sync/src",
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
    match std::fs::read_to_string(git_dir.join("commondir")) {
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
    let meta = std::fs::metadata(&dot_git).ok()?;
    if meta.is_dir() {
        return Some(dot_git);
    }
    let content = std::fs::read_to_string(&dot_git).ok()?;
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
