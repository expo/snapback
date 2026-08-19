use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{fs, io};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../guide");
    let build_commit = emit_build_commit();
    emit_embedded_guide(build_commit.as_deref());
    emit_runtime_loader_paths();
}

/// Emit the git commit consumed by the served-guide response headers. The
/// transport moved into this crate, so Cargo must stamp this crate directly;
/// build-script output from the remainder does not propagate to dependencies.
///
/// @ref LLP 0031#server-binary-identity-on-health — build-bound transport
/// responses identify the exact server source revision that produced them.
fn emit_build_commit() -> Option<String> {
    println!("cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_COMMIT");

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let repo_root = manifest_dir.join("../..");

    // Preserve the original build-identity invalidation semantics: HEAD and
    // the index live in the per-worktree git dir, while branch refs and
    // packed refs live in the common git dir.
    if let Some(git_dir) = resolve_git_dir(&repo_root) {
        let common_dir = resolve_common_dir(&git_dir);
        for path in [
            git_dir.join("HEAD"),
            git_dir.join("index"),
            common_dir.join("refs").join("heads"),
            common_dir.join("packed-refs"),
        ] {
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }

    let commit = env_nonempty("SNAPBACK_BUILD_GIT_COMMIT")
        .or_else(|| git(&repo_root, &["rev-parse", "HEAD"]));
    if let Some(commit) = &commit {
        println!("cargo:rustc-env=SNAPBACK_BUILD_GIT_COMMIT={commit}");
    }
    commit
}

// @ref LLP 0010#native-runtime-bootstrap — this crate links the runtime
// composition directly, so its own test/link units need the Hermes loader
// paths. Cargo does not propagate a dependency's rustc-link-arg downstream.
fn emit_runtime_loader_paths() {
    println!("cargo:rerun-if-env-changed=HERMES_LIB_DIR");
    println!("cargo:rerun-if-changed=../../vendor/ibex/ios/Frameworks");

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
            "cargo:warning=snapback-server build.rs: no Hermes framework found under {}; emitted a default LC_RPATH. Run scripts/bootstrap-ibex-runtime.",
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

// @ref LLP 0061#4-distribution-and-discovery — the transport owner embeds the
// exact checked Guide snapshot served by its read-only routes.
fn emit_embedded_guide(stamped_build_commit: Option<&str>) {
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
        "reference/index.md",
        "reference/registry.json",
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
    let build_commit = stamped_build_commit
        .map(str::to_owned)
        .unwrap_or_else(|| "unknown".to_owned());
    let build_commit = if build_commit
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-._".contains(character))
    {
        build_commit
    } else {
        "unknown".to_owned()
    };
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

fn collect_guide_files(root: &Path, dir: &Path, files: &mut Vec<String>) -> io::Result<()> {
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
            files.push(
                path.strip_prefix(root)
                    .expect("guide entry stays beneath guide root")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
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

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (!value.is_empty()).then_some(value)
}

/// The shared git directory holding the ref store (`refs/`, `packed-refs`).
/// Linked worktrees keep this pointer in their per-worktree git directory.
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

/// Resolve a primary checkout or linked-worktree `.git` location.
fn resolve_git_dir(repo_root: &Path) -> Option<PathBuf> {
    let dot_git = repo_root.join(".git");
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
        repo_root.join(pointed)
    })
}
