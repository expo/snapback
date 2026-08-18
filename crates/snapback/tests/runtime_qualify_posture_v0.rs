//! LLP 0123 posture-neutrality regression for the landed CV-2 qualification
//! shape (`snapback runtime-qualify`, landed 814acd77).
//!
//! The hazard LLP 0123 §Option 2 names: the strict-Host handoff is one-shot —
//! `ensure_host_installed()` installs `Host::strict()` once per process, the
//! install arms a single-use thread-bound pending creation token, the first
//! `RuntimeGuard::create()` claims it, and later diagnostic constructions
//! fall back to a `SecurityMode::Audit` context. A boot probe running
//! *inside a serving process* would therefore spend the one strict claim on a
//! diagnostic VM — readiness evidence weakening the posture it verifies.
//!
//! The landed shape avoids the hazard by process isolation: `runtime-qualify`
//! is a CLI subcommand every consumer (`qualifyRuntimeBinary`,
//! `runtime-link-smoke`, `verify-local-proof`) spawns as a separate,
//! short-lived process. The qualification consumes only that disposable
//! process's handoff; a serving process's first invocation still claims its
//! own freshly armed strict token. This test pins the neutrality-bearing
//! ordering end to end: run the qualification exactly as consumers do (child
//! process, loader overrides scrubbed), then prove the current process's
//! handler invocations — the first (strict-claimed) and a second fresh VM
//! (the diagnostic-fallback path) — retain identical fail-closed ambient
//! enforcement.
//!
//! What this deliberately does not claim: the Enforce-vs-Audit mode of an
//! individual VM's Ibex capability context is not observable at Snapback's
//! product surface (denials layer through the JS ambient shadowing and
//! Snapback's own host-call dispatcher before Ibex's capability gate). That
//! mode is now pinned where it *is* observable — at the claim itself, by
//! `runtime::strict_host_context_tests`, since 2026-08-01 arms the strict
//! context per construction so every VM on every thread claims its own
//! (issues/closed/20260731-first-vm-only-strict-host-context.md).

use std::process::Command;

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

/// Two byte-distinct module sources so each probe forces its own
/// `RuntimeGuard::create` instead of reusing one warm VM: the first creation
/// in this process claims the one-shot strict context, the second exercises
/// the diagnostic-fallback path. Both must present the same fail-closed
/// surface.
fn probe_source(tag: &str) -> String {
    format!(
        r#"// posture probe {tag}
globalThis.__snapbackHandlers = {{
  async postureProbe(ctx) {{
    function denialState(fn) {{
      try {{
        fn();
        return 'available';
      }} catch (error) {{
        var message = String(error && error.message || error);
        return message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0
          ? 'denied'
          : 'blocked';
      }}
    }}
    var out = {{
      fetchState: typeof fetch === 'undefined'
        ? 'unavailable'
        : denialState(function () {{ return fetch('https://example.com'); }}),
      webSocketState: denialState(function () {{ return new WebSocket('wss://x'); }}),
      evalState: (function () {{
        try {{ eval('1'); return 'available'; }} catch (_) {{ return 'blocked'; }}
      }})(),
      processAbsent: typeof process === 'undefined',
      requireAbsent: typeof require === 'undefined'
    }};
    await ctx.db.insert('probes', {{ note: '{tag}' }});
    return out;
  }}
}};
"#
    )
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("runtime-qualify-posture-v0".to_owned()),
        tables: vec![TableManifest {
            name: "probes".to_owned(),
            fields: vec![FieldManifest {
                name: "note".to_owned(),
                field_type: FieldType::String,
                optional: true,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let define = |name: &str, tag: &str| {
        FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: probe_source(tag),
                export: "postureProbe".to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("postureProbeFirst", "first-vm-strict-claim"),
            define("postureProbeSecond", "second-vm-diagnostic-fallback"),
        ],
        ..FunctionManifest::default()
    }
}

fn input() -> HandlerInput {
    HandlerInput {
        args: json!({}),
        auth: Default::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn assert_fail_closed(probe: &Value, label: &str) {
    let fetch_state = probe
        .get("fetchState")
        .and_then(Value::as_str)
        .unwrap_or("");
    assert!(
        fetch_state == "denied" || fetch_state == "unavailable",
        "{label}: the transactional path must never get network, got {probe}"
    );
    assert_eq!(
        probe.get("webSocketState"),
        Some(&json!("denied")),
        "{label}: WebSocket must stay ambient-denied: {probe}"
    );
    assert_eq!(
        probe.get("evalState"),
        Some(&json!("blocked")),
        "{label}: dynamic evaluation must stay unavailable (no-eval VM): {probe}"
    );
    assert_eq!(
        probe.get("processAbsent"),
        Some(&json!(true)),
        "{label}: {probe}"
    );
    assert_eq!(
        probe.get("requireAbsent"),
        Some(&json!(true)),
        "{label}: {probe}"
    );
}

#[test]
fn external_qualification_leaves_serving_posture_fail_closed() {
    // Step 1 — the landed consumer shape: qualification runs in a SEPARATE
    // process with dynamic-loader overrides scrubbed, exactly as
    // `qualifyRuntimeBinary` / bootstrap / verify-local-proof invoke it. Its
    // one-shot strict-Host handoff is spent inside that disposable process.
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback"));
    command.arg("runtime-qualify");
    for (key, _) in std::env::vars() {
        if key.starts_with("DYLD_") || key == "LD_LIBRARY_PATH" {
            command.env_remove(&key);
        }
    }
    let output = command.output().expect("runtime-qualify child spawns");
    let verdict: Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("structured verdict expected: {error}"));
    assert_eq!(
        verdict.get("ok"),
        Some(&json!(true)),
        "external qualification must pass against this build: {verdict}"
    );
    assert!(output.status.success());

    // Step 2 — the serving analog: THIS process now boots its runtime and
    // runs handlers. The first invocation's VM claims this process's own
    // strict handoff (untouched by the child above); the second, source-
    // distinct invocation forces a second VM creation through the
    // diagnostic-fallback path. Both must present the same fail-closed
    // ambient enforcement — qualification bought readiness evidence without
    // weakening the posture it verified.
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());

    let first = snapback
        .invoke_mutation("postureProbeFirst", input())
        .expect("first post-qualify invocation runs");
    assert_fail_closed(&first.result, "first VM (strict-claimed)");

    let second = snapback
        .invoke_mutation("postureProbeSecond", input())
        .expect("second post-qualify invocation runs");
    assert_fail_closed(&second.result, "second VM (diagnostic fallback)");
}
