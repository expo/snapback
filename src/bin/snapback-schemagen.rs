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

use snapback::schema_export::artifact_schemas;
use std::path::PathBuf;

fn main() -> std::io::Result<()> {
    let schemas_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schemas");
    std::fs::create_dir_all(&schemas_dir)?;
    for artifact in artifact_schemas() {
        let path = schemas_dir.join(artifact.file);
        let rendered = format!(
            "{}\n",
            serde_json::to_string_pretty(&artifact.schema).expect("schema renders to JSON")
        );
        std::fs::write(&path, rendered)?;
        println!("wrote {}", path.display());
    }
    Ok(())
}
