//! The LLP 0048 conformance twin runner: execute one handler corpus on the
//! engines with only the executor swapped, diff normalized outcomes,
//! host-call traces, and committed storage, and emit a machine-readable
//! divergence report in which every divergence is classified — convergent,
//! declared engine fact, or diagnostic noise. An unclassified divergence is a
//! contract violation and blocks the gate (exit 1).
//!
//! Three legs (ENG-23605): the Ibex and workerd legs share the Rust host-op
//! table with only the JS executor swapped; the Cloudflare-JS leg
//! (cloudflare/test/twin-engine.mjs, Miniflare) runs the same corpus through
//! the deployed target's own invocation path — coordinator, JS host-op table
//! (cloudflare/src/host-ops.js), Durable-Object SQLite. That leg exposes no
//! host-call trace, so it is diffed on normalized outcomes and committed
//! storage against the workerd leg (same V8+strip engine class, which
//! isolates host-op/coordinator semantics from engine facts).
//!
//! Usage: snapback-conformance-twin [--out <report.json>]
//!
//! Exit codes: 0 gate green; 1 contract violation / unclassified divergence;
//! 2 workerd or the Miniflare leg's node toolchain unavailable (capability
//! fact — the twin is a dev/CI tool).

// SnapbackResult's large Err is a deliberate API-wide choice (see lib.rs);
// bin crates need their own allow under clippy 1.94+.
#![allow(clippy::result_large_err)]

use std::collections::HashMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{Map, Value, json};
use snapback_engine::local::LocalSnapback;
use snapback_engine::manifest::CapabilityManifestLocalExt as _;
use snapback_engine::runtime::with_host_call_trace;
use snapback_engine::workerd_exec::{
    HandlerBackend, compat_config, detect_workerd_binary, with_forced_backend,
    with_wall_clock_timeout_ms, workerd_version,
};
use snapback_types::manifest::{
    AuthInput, CapabilityManifest, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

const CORPUS_MODULE_SOURCE: &str =
    include_str!("../../../../tests/conformance/twin-corpus.handlers.js");

#[derive(Clone, Copy, PartialEq)]
enum Engines {
    Both,
    V8Only,
}

struct Case {
    name: &'static str,
    handler: &'static str,
    kind: FunctionKind,
    args: Value,
    engines: Engines,
    /// Some(reason) when the two engines are *expected* to diverge — the
    /// divergence lands in the report as a declared engine fact, not a
    /// contract violation.
    declared_fact: Option<&'static str>,
    /// Some(reason) when the case cannot run on the Cloudflare-JS leg — it
    /// lands in the report as that leg's declared engine fact (ENG-23605).
    cloudflare_skip: Option<&'static str>,
    /// An optional committed ground-state mutation run before the traced
    /// case on every leg, for cases that need STORED rows (the ENG-23582
    /// buffered-overlay-over-storage shapes).
    seed: Option<(&'static str, Value)>,
}

fn corpus() -> Vec<Case> {
    vec![
        Case {
            name: "mutation-insert",
            handler: "addItem",
            kind: FunctionKind::Mutation,
            args: json!({"label": "alpha", "rank": 1}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "query-order-filter-take",
            handler: "listRanked",
            kind: FunctionKind::Query,
            args: json!({"min": 0}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "query-limit-edge-validation",
            handler: "queryLimitValidation",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "query-first",
            handler: "firstItem",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "read-your-writes",
            handler: "readYourWrites",
            kind: FunctionKind::Mutation,
            args: json!({"label": "ryw"}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "patch-get-delete",
            handler: "patchAndDelete",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "runtime-now-id",
            handler: "nowAndId",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "console-diagnostics-routed",
            handler: "logsThings",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "allowlist-slice-encoding-base64",
            handler: "allowlistSlice",
            kind: FunctionKind::Query,
            args: json!({"text": "héllo ✓ 𝒮"}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "write-in-query-denied",
            handler: "writeInQuery",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "export-missing",
            handler: "noSuchExport",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "result-not-serializable",
            handler: "returnsFunction",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "settlement-hang",
            handler: "hangForever",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "unhandled-detached-rejection",
            handler: "detachedRejection",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        // ENG-23584: the detached chain parks on a HOST CALL before rejecting,
        // so the V8 leg only observes it if the drain waits for host-call
        // quiescence instead of a fixed microtask-tick count.
        Case {
            name: "unhandled-detached-rejection-after-host-call",
            handler: "detachedHostCallRejection",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "detached-host-call-success",
            handler: "detachedHostCallSuccess",
            kind: FunctionKind::Mutation,
            args: json!({"label": "detached-ok", "rank": 7}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        // ENG-23593: decoder fidelity on view windows and invalid utf-8 must
        // CONVERGE — the Ibex polyfill is spec-corrected, not declared.
        Case {
            name: "allowlist-decoder-fidelity",
            handler: "decoderFidelity",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "allowlist-encoding-boundary-fidelity",
            handler: "encodingBoundaryFidelity",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "deterministic-date-constructor",
            handler: "probeDateConstructor",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: Some(
                "the zero-arg Date constructor (like Date.now/Math.random) is denied by the V8                  strip but reachable (codegen-banned only) on Ibex in v1 — the same declared                  engine fact, extended to the constructor path (ENG-23588)",
            ),
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "queue-microtask-interleave",
            handler: "queueMicrotaskInterleave",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: Some(
                "the fine-grained interleave of queueMicrotask jobs with promise reactions                  differs between V8 and the Ibex vendored promise polyfill (thenable adoption                  and chained .then land at different ticks) — declared engine fact; handlers                  must not depend on cross-engine job ordering (ENG-23593)",
            ),
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "ambient-denial-fetch",
            handler: "probeFetch",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "busy-loop-wall-clock-kill",
            handler: "busyLoop",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::V8Only,
            declared_fact: Some(
                "wall-clock kill is enforceable only at the workerd service boundary; the Ibex \
                 leg declares wall_clock_timeout Missing and running this case there would hang \
                 (LLP 0047 via LLP 0048 §Limits testbed)",
            ),
            cloudflare_skip: Some(
                "wall-clock kill on the Cloudflare target is the platform CPU limit, not a \
                 harness capability — in the in-process Miniflare harness a busy loop would \
                 hang the runner (the settlement deadline is a setTimeout and cannot preempt \
                 spinning JS), so this case is a declared engine fact on this leg (LLP 0047)",
            ),
            seed: None,
        },
        Case {
            name: "deterministic-members-date-now",
            handler: "probeDateNow",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: Some(
                "Date.now/Math.random are denied by the V8 strip but reachable (codegen-banned \
                 only) on Ibex in v1 — declared engine fact pinned by the twin gate tests",
            ),
            cloudflare_skip: None,
            seed: None,
        },
        // The ENG-23582 divergence class (via ENG-23605): buffered-overlay
        // semantics observable only mid-invocation — patch-on-miss stays a
        // miss, the point overlay stamps system fields, and a buffered patch
        // that moves a stored row into a filter set surfaces the FULL stored
        // row. These are the shapes the JS host-op table drifted on.
        Case {
            name: "patch-on-missing-row",
            handler: "patchMissing",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "buffered-point-overlay-timestamps",
            handler: "insertThenGet",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "buffered-patch-into-filter-set",
            handler: "patchIntoFilter",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: Some(("addItem", json!({"label": "stored-full", "rank": 1}))),
        },
        // @ref LLP 0144#acceptance-witnesses-per-axis-when-adopted — the
        // declared / undeclared / bare-claim triad is one corpus and runs on
        // both local engines plus the Cloudflare-JS serving path.
        Case {
            name: "app-refusal-declared",
            handler: "declaredAppRefusal",
            kind: FunctionKind::Mutation,
            args: json!({"revision": 2}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "app-refusal-undeclared",
            handler: "undeclaredAppRefusal",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
        Case {
            name: "app-refusal-bare-claim",
            handler: "bareAppRefusalClaim",
            kind: FunctionKind::Mutation,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: None,
            cloudflare_skip: None,
            seed: None,
        },
    ]
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("conformance-twin-v0".to_owned()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "label".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                },
                FieldManifest {
                    name: "rank".to_owned(),
                    field_type: FieldType::Integer,
                    optional: true,
                },
            ],
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

fn functions(cases: &[Case]) -> FunctionManifest {
    let mut functions: Vec<FunctionDefinition> = cases
        .iter()
        .map(|case| {
            let mut definition = FunctionDefinition::new(
                case.handler,
                case.kind.clone(),
                snapback_types::manifest::FunctionRuntime::IbexModule(IbexModule {
                    source: CORPUS_MODULE_SOURCE.to_owned(),
                    export: case.handler.to_owned(),
                }),
            );
            if matches!(
                case.handler,
                "declaredAppRefusal" | "undeclaredAppRefusal" | "bareAppRefusalClaim"
            ) {
                definition.refusals = vec!["STALE_MOVE".to_owned()];
            }
            definition
        })
        .collect();
    functions.dedup_by(|a, b| a.name == b.name);
    // The storage-dump helper every case run uses after the fact.
    functions.push(FunctionDefinition::new(
        "dumpItems",
        FunctionKind::Query,
        snapback_types::manifest::FunctionRuntime::IbexModule(IbexModule {
            source: CORPUS_MODULE_SOURCE.to_owned(),
            export: "dumpItems".to_owned(),
        }),
    ));
    FunctionManifest {
        functions,
        ..FunctionManifest::default()
    }
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

/// LLP 0010-style placeholder normalization: opaque ids become `$ID:<n>` in
/// first-appearance order, epoch-millisecond integers become `$MS`. Applied
/// to outcomes, traces, and storage dumps before comparison, so entropy and
/// clock values (host-supplied on both legs, but per-run) cannot masquerade
/// as engine divergence.
fn normalize(value: &Value, ids: &mut Vec<String>) -> Value {
    normalize_with_context(value, ids, None, None)
}

fn normalize_with_context(
    value: &Value,
    ids: &mut Vec<String>,
    key: Option<&str>,
    parent_op: Option<&str>,
) -> Value {
    match value {
        Value::String(text) => Value::String(normalize_ids_in_string(text, ids)),
        Value::Number(number) => {
            if should_normalize_ms(key, parent_op, number.as_i64()) {
                return Value::String("$MS".to_owned());
            }
            value.clone()
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| normalize_with_context(item, ids, key, parent_op))
                .collect(),
        ),
        Value::Object(entries) => {
            let op = entries.get("op").and_then(Value::as_str).or(parent_op);
            Value::Object(
                entries
                    .iter()
                    .map(|(entry_key, item)| {
                        (
                            entry_key.clone(),
                            normalize_with_context(item, ids, Some(entry_key), op),
                        )
                    })
                    .collect::<Map<String, Value>>(),
            )
        }
        _ => value.clone(),
    }
}

fn should_normalize_ms(key: Option<&str>, parent_op: Option<&str>, value: Option<i64>) -> bool {
    let Some(ms) = value else {
        return false;
    };
    if !(1_000_000_000_000..10_000_000_000_000).contains(&ms) {
        return false;
    }
    matches!(key, Some("_createdAt" | "_updatedAt" | "now"))
        || (key == Some("outcome") && parent_op == Some("runtime.now"))
}

/// Replace every uuid-shaped (8-4-4-4-12 hex) substring, wherever it appears —
/// standalone or embedded in a larger string like `stamped-<uuid>` — with a
/// first-appearance-ordered `$ID:<n>` placeholder. Per-run entropy must not
/// masquerade as engine divergence.
fn normalize_ids_in_string(text: &str, ids: &mut Vec<String>) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if let Some(uuid) = uuid_at(text, i) {
            let index = ids
                .iter()
                .position(|known| known == &uuid)
                .unwrap_or_else(|| {
                    ids.push(uuid.clone());
                    ids.len() - 1
                });
            out.push_str(&format!("$ID:{index}"));
            i += uuid.len();
        } else {
            let ch = text[i..].chars().next().expect("valid char boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn uuid_at(text: &str, start: usize) -> Option<String> {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let bytes = text.as_bytes();
    let mut cursor = start;
    for (group_index, &len) in GROUPS.iter().enumerate() {
        if group_index > 0 {
            if bytes.get(cursor) != Some(&b'-') {
                return None;
            }
            cursor += 1;
        }
        for _ in 0..len {
            match bytes.get(cursor) {
                Some(byte) if byte.is_ascii_hexdigit() => cursor += 1,
                _ => return None,
            }
        }
    }
    Some(text[start..cursor].to_owned())
}

/// One engine's raw observation of one case: outcome (result or stable
/// code), the host-call trace, and the committed storage afterwards —
/// normalization is applied per comparison view (`normalize_full`,
/// `normalize_storage_view`), because $ID placeholder indices depend on
/// first-appearance order across the dimensions being compared.
struct RawRun {
    outcome: Value,
    trace: Value,
    committed: Value,
}

/// The full three-dimension view (outcome, trace, committed) used for the
/// Ibex↔workerd diff; one placeholder sequence spans all three in order.
fn normalize_full(run: &RawRun) -> Value {
    let mut ids = Vec::new();
    json!({
        "outcome": normalize(&run.outcome, &mut ids),
        "trace": normalize(&run.trace, &mut ids),
        "committed": normalize(&run.committed, &mut ids),
    })
}

/// The trace-free view used for the Cloudflare-JS leg diff (ENG-23605): that
/// leg has no host-call trace, and ids often first appear in the trace on
/// the traced legs, so the reference leg is re-normalized over the same
/// (outcome, committed) sequence instead of reusing the full view.
fn normalize_storage_view(outcome: &Value, committed: &Value) -> Value {
    let mut ids = Vec::new();
    json!({
        "outcome": normalize(outcome, &mut ids),
        "committed": normalize(committed, &mut ids),
    })
}

fn run_case_on(case: &Case, backend: HandlerBackend) -> RawRun {
    let mut snapback = LocalSnapback::memory().expect("instance");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions(&corpus()));

    // Committed ground state for cases that need STORED rows (ENG-23582
    // shapes): the seed mutation runs before the traced case, outside the
    // trace, on the same backend.
    if let Some((seed_handler, seed_args)) = &case.seed {
        with_forced_backend(backend, || {
            snapback
                .invoke_mutation(seed_handler, input(seed_args.clone()))
                .expect("seed mutation commits");
        });
    }

    let (outcome, trace) = with_host_call_trace(|| {
        with_forced_backend(backend, || {
            match case.kind {
            FunctionKind::Mutation => snapback
                .invoke_mutation(case.handler, input(case.args.clone()))
                .map(|output| json!({"version": output.version, "changedCount": output.changed_count, "result": output.result})),
            _ => snapback
                .invoke_query(case.handler, input(case.args.clone()))
                .map(|output| json!({"version": output.version, "rows": output.rows})),
        }
        })
    });
    let outcome = match outcome {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(error) if error.diagnostic.code == "SNAPBACK_APP_REFUSAL" => json!({
            "ok": false,
            "code": error.diagnostic.code,
            "details": error.diagnostic.details,
        }),
        Err(error) => json!({"ok": false, "code": error.diagnostic.code}),
    };
    let committed = snapback
        .invoke_query("dumpItems", input(json!({})))
        .map(|output| json!({"version": output.version, "rows": output.rows}))
        .unwrap_or_else(|error| json!({"dumpFailed": error.diagnostic.code}));

    // `runtime.log` is diagnostics, not the handler contract (LLP 0048
    // §conformance contract, class 3): its delivery is fire-and-forget and
    // differs by engine transport (synchronous on Ibex, async-dropped on the
    // V8 leg), so it is normalized out before the trace comparison.
    let contract_trace: Vec<_> = trace
        .into_iter()
        .filter(|entry| entry.op != "runtime.log")
        .collect();

    RawRun {
        outcome,
        trace: serde_json::to_value(&contract_trace).unwrap_or(Value::Null),
        committed,
    }
}

// ---------------------------------------------------------------------------
// The Cloudflare-JS leg (ENG-23605): one Miniflare process runs every
// participating case through the deployed target's invocation path and
// reports raw per-case observations for classification here.

fn cloudflare_leg_toolchain() -> Result<(PathBuf, PathBuf), String> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let script = manifest_dir.join("cloudflare/test/twin-engine.mjs");
    if !script.exists() {
        return Err(format!("missing runner {}", script.display()));
    }
    if !manifest_dir.join("node_modules/miniflare").is_dir() {
        return Err(
            "the miniflare dev dependency is not installed (bun install --frozen-lockfile)"
                .to_owned(),
        );
    }
    Ok((script, manifest_dir))
}

fn run_cloudflare_leg(cases: &[Case]) -> Result<HashMap<String, Value>, String> {
    let (script, repo_root) = cloudflare_leg_toolchain()?;
    let case_list: Vec<Value> = cases
        .iter()
        .filter(|case| case.cloudflare_skip.is_none())
        .map(|case| {
            json!({
                "name": case.name,
                "handler": case.handler,
                "kind": match case.kind {
                    FunctionKind::Mutation => "mutation",
                    _ => "query",
                },
                "args": case.args,
                "seed": case.seed.as_ref().map(|(handler, args)| {
                    json!({"handler": handler, "args": args})
                }),
            })
        })
        .collect();
    let mut child = Command::new("node")
        .arg(&script)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("node unavailable: {error}"))?;
    child
        .stdin
        .take()
        .expect("stdin was piped")
        .write_all(
            serde_json::to_string(&case_list)
                .expect("case list serializes")
                .as_bytes(),
        )
        .map_err(|error| format!("writing the case list failed: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("twin-engine did not complete: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "twin-engine exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let observations: Vec<Value> = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("twin-engine output was not valid JSON: {error}"))?;
    Ok(observations
        .into_iter()
        .filter_map(|entry| {
            entry
                .get("name")
                .and_then(Value::as_str)
                .map(|name| (name.to_owned(), entry.clone()))
        })
        .collect())
}

/// Keep the committed conformance report reproducible when workerd comes from
/// this checkout. The release id remains the executable provenance; an
/// absolute path inside a developer worktree is not a portable runtime fact.
// @ref LLP 0048#reproducible-conformance-evidence-2026-07-12 — canonical reports use a stable repo-relative tool locator.
fn workerd_report_locator(workerd_bin: &Path) -> String {
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let portable = |path: &Path| {
        path.components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/")
    };

    if let Ok(relative) = workerd_bin.strip_prefix(&repo_root) {
        return portable(relative);
    }
    if workerd_bin.is_relative() {
        return portable(workerd_bin);
    }
    workerd_bin.display().to_string()
}

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    let out_path = arguments
        .iter()
        .position(|argument| argument == "--out")
        .and_then(|index| arguments.get(index + 1))
        .cloned();

    let Some(workerd_bin) = detect_workerd_binary() else {
        eprintln!(
            "SNAPBACK_CAPABILITY_WORKERD_MISSING: the conformance twin needs the workerd \
             dev dependency (bun install --frozen-lockfile) or SNAPBACK_WORKERD_BIN"
        );
        std::process::exit(2);
    };
    let compat = match compat_config() {
        Ok(compat) => compat,
        Err(error) => {
            eprintln!("compat config refused: {error}");
            std::process::exit(1);
        }
    };

    // The Cloudflare-JS leg runs as one batch up front (one Miniflare
    // process, per-case reset inside); like workerd, its toolchain is a
    // dev/CI capability, so absence is exit 2, not a silent two-leg pass.
    let cloudflare_observations = match run_cloudflare_leg(&corpus()) {
        Ok(observations) => observations,
        Err(reason) => {
            eprintln!(
                "SNAPBACK_CAPABILITY_MINIFLARE_MISSING: the conformance twin's Cloudflare-JS \
                 leg needs node plus the miniflare dev dependency — {reason}"
            );
            std::process::exit(2);
        }
    };

    let busy_loop_budget_ms: u64 = 1_500;
    let mut cases_report = Vec::new();
    let mut convergent = 0usize;
    let mut declared = 0usize;
    let mut violations = 0usize;
    let mut cloudflare_convergent = 0usize;
    let mut cloudflare_declared = 0usize;
    let mut cloudflare_violations = 0usize;

    for case in corpus() {
        let workerd_raw = with_wall_clock_timeout_ms(busy_loop_budget_ms.max(5_000), || {
            run_case_on(&case, HandlerBackend::WorkerdV8)
        });
        let workerd_run = normalize_full(&workerd_raw);
        let (ibex_run, class, notes): (Value, &str, Value) = match case.engines {
            Engines::V8Only => {
                declared += 1;
                (
                    json!({"skipped": "declared engine fact — not runnable on this leg"}),
                    "declared_engine_fact",
                    json!(case.declared_fact),
                )
            }
            Engines::Both => {
                let ibex_run = normalize_full(&run_case_on(&case, HandlerBackend::Ibex));
                if ibex_run == workerd_run {
                    convergent += 1;
                    (ibex_run, "convergent", Value::Null)
                } else if let Some(reason) = case.declared_fact {
                    declared += 1;
                    (ibex_run, "declared_engine_fact", json!(reason))
                } else {
                    violations += 1;
                    (
                        ibex_run,
                        "contract_violation",
                        json!("unclassified divergence — blocks the gate"),
                    )
                }
            }
        };
        // The third-leg diff (ENG-23605): Cloudflare-JS vs workerd on the
        // trace-free view. Both legs are V8-with-strip, so every engine fact
        // declared for Ibex↔V8 must CONVERGE here — the only expected skips
        // are capabilities the Miniflare harness itself cannot express.
        let (cloudflare_run, cloudflare_class, cloudflare_notes): (Value, &str, Value) =
            if let Some(reason) = case.cloudflare_skip {
                cloudflare_declared += 1;
                (
                    json!({"skipped": "declared engine fact — not runnable on this leg"}),
                    "declared_engine_fact",
                    json!(reason),
                )
            } else {
                match cloudflare_observations.get(case.name) {
                    Some(observed) => {
                        let observed_view = normalize_storage_view(
                            observed.get("outcome").unwrap_or(&Value::Null),
                            observed.get("committed").unwrap_or(&Value::Null),
                        );
                        let reference_view =
                            normalize_storage_view(&workerd_raw.outcome, &workerd_raw.committed);
                        if observed_view == reference_view {
                            cloudflare_convergent += 1;
                            (observed_view, "convergent", Value::Null)
                        } else {
                            cloudflare_violations += 1;
                            (
                                json!({"observed": observed_view, "workerdV8": reference_view}),
                                "contract_violation",
                                json!(
                                    "unclassified divergence vs the workerd leg — blocks the gate"
                                ),
                            )
                        }
                    }
                    None => {
                        cloudflare_violations += 1;
                        (
                            Value::Null,
                            "contract_violation",
                            json!("the Cloudflare-JS leg returned no observation for this case"),
                        )
                    }
                }
            };
        cases_report.push(json!({
            "name": case.name,
            "handler": case.handler,
            "class": class,
            "notes": notes,
            "ibex": ibex_run,
            "workerdV8": workerd_run,
            "cloudflareJsClass": cloudflare_class,
            "cloudflareJsNotes": cloudflare_notes,
            "cloudflareJs": cloudflare_run,
        }));
    }

    let runtime_facts = json!({
        "workerdVersion": workerd_version(&workerd_bin),
        "workerdBinary": workerd_report_locator(&workerd_bin),
        "compatibilityDate": compat.compatibility_date,
        "compatibilityFlags": compat.compatibility_flags,
        "killDomain": "process-per-invocation",
        "wallClockTimeoutMs": snapback_engine::workerd_exec::default_wall_clock_timeout_ms(),
        "hostCallTransport": "loopback-http-service-binding",
        "allowlist": "packages/snapback-harness/allowlist.json",
        // The third leg (ENG-23605): same corpus, the deployed target's own
        // invocation path and JS host-op table, diffed trace-free.
        "cloudflareJsLeg": {
            "harness": "miniflare (cloudflare/test/twin-engine.mjs)",
            "hostOps": "cloudflare/src/host-ops.js",
            "invocationPath": "gateway → coordinator → handler Worker → DO SQLite",
            "diffDimensions": ["outcome", "committed"],
            "referenceLeg": "workerdV8",
        },
    });
    let manifest = CapabilityManifest::conformance_workerd_v8(runtime_facts);

    let total_violations = violations + cloudflare_violations;
    let gate = if total_violations == 0 {
        "green"
    } else {
        "blocked"
    };
    let report = json!({
        "artifactKind": "conformanceTwinReport",
        "schemaVersion": "snapback.v0",
        "generatedBy": "snapback-conformance-twin",
        "gate": gate,
        "summary": {
            "total": cases_report.len(),
            "convergent": convergent,
            "declaredEngineFacts": declared,
            "contractViolations": violations,
            "cloudflareJs": {
                "convergent": cloudflare_convergent,
                "declaredEngineFacts": cloudflare_declared,
                "contractViolations": cloudflare_violations,
            },
        },
        "capabilityManifest": serde_json::to_value(&manifest).expect("manifest serializes"),
        "cases": cases_report,
    });
    let rendered = serde_json::to_string_pretty(&report).expect("report serializes");
    if let Some(path) = out_path {
        std::fs::write(&path, &rendered).expect("report written");
        println!("conformance twin report written to {path} (gate: {gate})");
    } else {
        println!("{rendered}");
    }
    std::process::exit(if total_violations == 0 { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::workerd_report_locator;
    use std::path::Path;

    #[test]
    fn repo_local_workerd_locator_is_stable_across_worktrees() {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let locator = workerd_report_locator(&repo_root.join("node_modules/.bin/workerd"));
        assert_eq!(locator, "node_modules/.bin/workerd");
        assert!(!locator.contains(&repo_root.display().to_string()));
    }
}
