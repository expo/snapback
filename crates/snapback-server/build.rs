use std::io::Write;
use std::path::{Path, PathBuf};
use std::{fs, io};

#[allow(dead_code)]
#[path = "../snapback-types/build_identity.rs"]
mod build_identity;

#[path = "src/guide_artifact.rs"]
mod guide_artifact;

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

    build_identity::emit_git_identity_inputs(&repo_root);

    let commit = build_identity::resolve_git_commit(&repo_root);
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
    assert!(
        files.iter().any(|path| is_section_flat_path(path)),
        "served guide is missing generated section flat projections"
    );

    for required in guide_artifact::REQUIRED_GUIDE_PATHS {
        assert!(
            files.iter().any(|path| path == required),
            "served guide is missing required generated/input file {required}"
        );
    }

    let manifest = fs::read_to_string(guide_dir.join(guide_artifact::MANIFEST_PATH))
        .expect("read generated guide manifest");
    let content_hash = generated_json_string(&manifest, "contentHash")
        .expect("generated guide manifest carries contentHash");
    assert!(
        content_hash.len() == 64
            && content_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "generated guide contentHash must be a lowercase SHA-256 hex digest"
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
    // One inert binary artifact crosses the build boundary. Its committed
    // decoder and exact wire format live in src/guide.rs; no generated byte is
    // ever parsed as Rust source.
    let mut output = fs::File::create(out_dir.join("embedded-guide.v1.bin"))
        .expect("create embedded Guide data artifact");
    output
        .write_all(b"SNAPBACK_EMBEDDED_GUIDE\0\x01")
        .expect("write embedded Guide artifact magic");
    output
        .write_all(content_hash.as_bytes())
        .expect("write embedded Guide content hash");
    write_u32(&mut output, files.len(), "embedded Guide file count");
    for path in files {
        let bytes = if path == guide_artifact::MANIFEST_PATH {
            embedded_manifest.as_bytes().to_vec()
        } else {
            fs::read(guide_dir.join(&path))
                .unwrap_or_else(|error| panic!("read embedded Guide file {path}: {error}"))
        };
        write_u32(&mut output, path.len(), "embedded Guide path length");
        write_u64(&mut output, bytes.len(), "embedded Guide file length");
        output
            .write_all(path.as_bytes())
            .expect("write embedded Guide path");
        output
            .write_all(&bytes)
            .expect("write embedded Guide file bytes");
    }
    output.flush().expect("flush embedded Guide data artifact");
}

fn is_section_flat_path(path: &str) -> bool {
    path != guide_artifact::FLAT_PATH
        && path.starts_with("guide-flat.")
        && path.ends_with(".generated.md")
}

fn write_u32(output: &mut impl Write, value: usize, label: &str) {
    let value = u32::try_from(value).unwrap_or_else(|_| panic!("{label} exceeds u32"));
    output
        .write_all(&value.to_be_bytes())
        .unwrap_or_else(|error| panic!("write {label}: {error}"));
}

fn write_u64(output: &mut impl Write, value: usize, label: &str) {
    let value = u64::try_from(value).unwrap_or_else(|_| panic!("{label} exceeds u64"));
    output
        .write_all(&value.to_be_bytes())
        .unwrap_or_else(|error| panic!("write {label}: {error}"));
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

fn generated_json_string<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("\"{key}\": \"");
    let rest = json.split_once(&prefix)?.1;
    Some(rest.split_once('"')?.0)
}
