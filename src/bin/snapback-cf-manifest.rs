//! Emit the LLP 0040 `cloudflare-do-sqlite-v8` capability manifest as JSON,
//! single-sourced from the Rust `CapabilityManifest` so it validates against
//! the same generated JSON Schema as every other target (LLP 0040 §Capability
//! report; the `schemas/` drift-gate pattern).
//!
//! Usage: snapback-cf-manifest [--out <path>]

use serde_json::json;
use snapback::manifest::CapabilityManifest;

fn main() {
    let runtime_facts = json!({
        "platform": "cloudflare-workers",
        "storage": "durable-object-sqlite",
        "liveTransport": "durable-object-websocket-hibernation",
        "versionAuthority": "coordinator-durable-object",
        "commit": "single-transactionSync (version + rows + journal)",
        "maxRowBytes": 2_000_000,
        "maxObjectStorageBytes": 10_000_000_000_i64,
        "maxSubscriptionsGlobal": 2_048,
        "maxSubscriptionsPerConnection": 64,
        "maxSubscriptionArgsBytes": 32_768,
        "maxLegacyProofSockets": 128,
        "maxAcceptedSockets": 256,
        "maxSocketsPerConnection": 2,
        "wallClockNote": "enforced by the platform (object/request kill); measured value in the benchmark report",
        "codeHotLoad": "missing — deployed Workers forbid dynamic eval; an app-code change is a deploy",
        "handlerHarness": "single-sourced LLP 0048 harness (packages/snapback-harness)",
    });
    let manifest = CapabilityManifest::cloudflare_do_sqlite_v8(runtime_facts);
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
