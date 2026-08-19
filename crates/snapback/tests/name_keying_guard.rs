//! Guard for the name-keyed-encoding invariant: no Snapback-owned persisted
//! or wire encoding may depend on declaration order surviving edits.
//!
//! @ref LLP 0037#dated-constraint-name-keyed-encodings — the standing rule
//!   this file enforces; the semantic pin catches ordinal encodings even when
//!   both sides of the artifact-schema drift gate are regenerated together.

use snapback::assets::{
    AssetAttemptState, AssetDeliveryProfile, AssetIntegrityGrade, AssetPublicationState,
    AssetWorkState,
};
use snapback::live_wire::LiveDeltaOpKind;
use snapback::manifest::FieldType;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
}

/// The serialized form of representative Snapback-owned enum-like values is
/// the variant *name* — a scalar for unit variants, the object key for
/// data-bearing variants — never the declaration index.
#[test]
fn representative_enum_encodings_are_name_keyed() {
    assert_eq!(
        serde_json::to_value(FieldType::String).unwrap(),
        serde_json::json!("String"),
    );
    assert_eq!(
        serde_json::to_value(FieldType::Principal).unwrap(),
        serde_json::json!("Principal"),
    );
    assert_eq!(
        serde_json::to_value(FieldType::Id {
            table: "todos".to_owned(),
        })
        .unwrap(),
        serde_json::json!({ "Id": { "table": "todos" } }),
    );

    for (kind, wire) in [
        (LiveDeltaOpKind::Add, "add"),
        (LiveDeltaOpKind::Update, "update"),
        (LiveDeltaOpKind::Remove, "remove"),
    ] {
        assert_eq!(
            serde_json::to_value(kind).unwrap(),
            serde_json::json!(wire),
            "live_wire op kind must serialize as its lowercase variant name",
        );
    }

    for (value, wire) in [
        (
            serde_json::to_value(AssetAttemptState::Finalizing).unwrap(),
            "finalizing",
        ),
        (
            serde_json::to_value(AssetPublicationState::Condemned).unwrap(),
            "condemned",
        ),
        (
            serde_json::to_value(AssetWorkState::Retrying).unwrap(),
            "retrying",
        ),
        (
            serde_json::to_value(AssetDeliveryProfile::PrivateStrict).unwrap(),
            "private-strict",
        ),
        (
            serde_json::to_value(AssetIntegrityGrade::EndToEndVerified).unwrap(),
            "end-to-end-verified",
        ),
    ] {
        assert_eq!(
            value,
            serde_json::json!(wire),
            "asset state vocabularies must serialize as their closed names",
        );
    }

    let ordinal_probe = serde_json::json!(0);
    assert!(
        serde_json::from_value::<FieldType>(ordinal_probe.clone()).is_err(),
        "an ordinal FieldType encoding must not deserialize",
    );
    assert!(
        serde_json::from_value::<AssetAttemptState>(ordinal_probe.clone()).is_err(),
        "an ordinal asset attempt-state encoding must not deserialize",
    );
    assert!(
        serde_json::from_value::<LiveDeltaOpKind>(ordinal_probe).is_err(),
        "an ordinal live_wire op-kind encoding must not deserialize",
    );
}

fn rust_sources(dir: &Path, files: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("readable source directory") {
        let path = entry.expect("readable directory entry").path();
        if path.is_dir() {
            rust_sources(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}

/// Ordinal serialization must arrive as an explicit decision: `serde_repr`
/// may appear as a dependency or in `src/` only next to an `@ref` naming the
/// deciding document.
#[test]
fn serde_repr_requires_an_allowlisting_ref() {
    let needle = "serde_repr";
    let cargo_manifest =
        std::fs::read_to_string(repo_root().join("Cargo.toml")).expect("readable Cargo.toml");
    assert!(
        !cargo_manifest.contains(needle),
        "serde_repr must not be a direct dependency without an allowlisting \
         decision recorded in LLP 0037",
    );

    let mut files = Vec::new();
    rust_sources(&repo_root().join("crates/snapback/src"), &mut files);
    rust_sources(&repo_root().join("crates/snapback-cli/src"), &mut files);
    assert!(!files.is_empty(), "expected Rust sources under src/");
    let mut violations = Vec::new();
    for file in files {
        let source = std::fs::read_to_string(&file).expect("readable Rust source");
        let lines: Vec<&str> = source.lines().collect();
        for (index, line) in lines.iter().enumerate() {
            if !line.contains(needle) {
                continue;
            }
            let context_start = index.saturating_sub(3);
            // Concatenated so this file's own scanner token is not itself a
            // reference annotation.
            let marker = concat!('@', "ref LLP");
            let allowlisted = lines[context_start..=index]
                .iter()
                .any(|context| context.contains(marker));
            if !allowlisted {
                violations.push(format!("{}:{}", file.display(), index + 1));
            }
        }
    }
    assert!(
        violations.is_empty(),
        "serde_repr found in src/ without an adjacent reference-annotation \
         allowlist entry naming the deciding document: {violations:?}",
    );
}
