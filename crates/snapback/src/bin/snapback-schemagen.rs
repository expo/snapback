//! Regenerate the committed Snapback-owned JSON Schemas under `schemas/`.
//!
//! Run from the repo root:
//!   DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" \
//!     cargo run --bin snapback-schemagen
//!
//! This is the *writer* half of DK-7's one-generator/two-callers design: it
//! calls [`snapback::schema_export::artifact_schemas`] and writes each schema.
//! `tests/artifact_schemas_v0.rs` calls the same generator and fails on any
//! diff, so a hand edit to `schemas/` or an unregenerated Rust type change is a
//! test failure, not a silent drift.
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — writes the generated, committed
//!   schemas that make the Rust types the single source of truth.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c) regeneration entry point.

use snapback::schema_export::{
    EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS, SchemaArtifact, artifact_instances, artifact_schemas,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn main() -> std::io::Result<()> {
    let schemas_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schemas");
    let schemas = artifact_schemas();
    write_schema_artifacts(&schemas_dir, &schemas)?;
    write_artifact_instances(&schemas_dir, &artifact_instances())
}

fn write_artifact_instances(
    schemas_dir: &Path,
    artifacts: &[SchemaArtifact],
) -> std::io::Result<()> {
    std::fs::create_dir_all(schemas_dir)?;
    for artifact in artifacts {
        let path = schemas_dir.join(artifact.file);
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&artifact.schema).expect("artifact renders to JSON")
        );
        std::fs::write(&path, rendered)?;
        println!("wrote {}", path.display());
    }
    Ok(())
}

fn write_schema_artifacts(schemas_dir: &Path, artifacts: &[SchemaArtifact]) -> std::io::Result<()> {
    std::fs::create_dir_all(schemas_dir)?;
    let expected = artifacts
        .iter()
        .map(|artifact| artifact.file)
        .chain(
            EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS
                .iter()
                .copied()
                .filter(|file| !file.contains('/')),
        )
        .collect::<BTreeSet<_>>();
    for artifact in artifacts {
        let path = schemas_dir.join(artifact.file);
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&artifact.schema).expect("schema renders to JSON")
        );
        std::fs::write(&path, rendered)?;
        println!("wrote {}", path.display());
    }
    for entry in std::fs::read_dir(schemas_dir)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if !file_type.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        // Only generated `*.schema.json` files are ours to reap: `schemas/`
        // also holds committed artifact INSTANCES (e.g. the LLP 0026
        // capability manifest `capability.manifest.local-dev-sqlite-ibex.json`)
        // that other generators own (ENG-23891 fix — the broader `.json`
        // match deleted one).
        if file_name.ends_with(".schema.json") && !expected.contains(file_name.as_ref()) {
            std::fs::remove_file(entry.path())?;
            println!("removed stale {}", entry.path().display());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn schemagen_removes_orphaned_schema_json_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("keep.schema.json"), "{}\n").expect("write keep");
        std::fs::write(dir.path().join("stale.schema.json"), "{}\n").expect("write stale");
        std::fs::write(dir.path().join("README.md"), "notes\n").expect("write notes");
        // An artifact INSTANCE another generator owns — never reaped here.
        std::fs::write(dir.path().join("capability.manifest.local.json"), "{}\n")
            .expect("write instance");
        let artifacts = [SchemaArtifact {
            file: "keep.schema.json",
            schema: json!({ "title": "Keep" }),
        }];

        write_schema_artifacts(dir.path(), &artifacts).expect("write schemas");

        assert!(dir.path().join("keep.schema.json").is_file());
        assert!(!dir.path().join("stale.schema.json").exists());
        assert!(dir.path().join("README.md").is_file());
        assert!(dir.path().join("capability.manifest.local.json").is_file());
    }
}
