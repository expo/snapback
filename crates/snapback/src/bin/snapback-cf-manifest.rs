//! Emit the LLP 0040 `cloudflare-do-sqlite-v8` capability manifest as JSON,
//! single-sourced from the Rust `CapabilityManifest` so it validates against
//! the same generated JSON Schema as every other target (LLP 0040 §Capability
//! report; the `schemas/` drift-gate pattern).
//!
//! Usage: snapback-cf-manifest [--out <path>]

use snapback::manifest::{CapabilityManifest, CapabilityManifestLocalExt as _};

fn main() {
    let manifest = CapabilityManifest::cloudflare_do_sqlite_v8_declared();
    let rendered = serde_json::to_string_pretty(&manifest).expect("manifest serializes");

    let arguments: Vec<String> = std::env::args().collect();
    if let Some(index) = arguments.iter().position(|argument| argument == "--out")
        && let Some(path) = arguments.get(index + 1)
    {
        std::fs::write(path, format!("{rendered}\n")).expect("manifest written");
        println!("cloudflare capability manifest written to {path}");
        return;
    }
    println!("{rendered}");
}
