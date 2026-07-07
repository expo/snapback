//! The LLP 0048 conformance twin runner: execute one handler corpus on both
//! engines with only the executor swapped, diff normalized outcomes,
//! host-call traces, and committed storage, and emit a machine-readable
//! divergence report in which every divergence is classified — convergent,
//! declared engine fact, or diagnostic noise. An unclassified divergence is a
//! contract violation and blocks the gate (exit 1).
//!
//! Usage: snapback-conformance-twin [--out <report.json>]
//!
//! Exit codes: 0 gate green; 1 contract violation / unclassified divergence;
//! 2 workerd unavailable (capability fact — the twin is a dev/CI tool).

use serde_json::{Map, Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, CapabilityManifest, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};
use snapback::runtime::with_host_call_trace;
use snapback::workerd_exec::{
    HandlerBackend, compat_config, detect_workerd_binary, with_forced_backend,
    with_wall_clock_timeout_ms, workerd_version,
};

const CORPUS_MODULE_SOURCE: &str = include_str!("../../tests/conformance/twin-corpus.handlers.js");

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
}

fn corpus() -> Vec<Case> {
    vec![
        Case { name: "mutation-insert", handler: "addItem", kind: FunctionKind::Mutation, args: json!({"label": "alpha", "rank": 1}), engines: Engines::Both, declared_fact: None },
        Case { name: "query-order-filter-take", handler: "listRanked", kind: FunctionKind::Query, args: json!({"min": 0}), engines: Engines::Both, declared_fact: None },
        Case { name: "query-first", handler: "firstItem", kind: FunctionKind::Query, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "read-your-writes", handler: "readYourWrites", kind: FunctionKind::Mutation, args: json!({"label": "ryw"}), engines: Engines::Both, declared_fact: None },
        Case { name: "patch-get-delete", handler: "patchAndDelete", kind: FunctionKind::Mutation, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "runtime-now-id", handler: "nowAndId", kind: FunctionKind::Mutation, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "console-diagnostics-routed", handler: "logsThings", kind: FunctionKind::Query, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "allowlist-slice-encoding-base64", handler: "allowlistSlice", kind: FunctionKind::Query, args: json!({"text": "héllo ✓ 𝒮"}), engines: Engines::Both, declared_fact: None },
        Case { name: "write-in-query-denied", handler: "writeInQuery", kind: FunctionKind::Query, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "export-missing", handler: "noSuchExport", kind: FunctionKind::Query, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "result-not-serializable", handler: "returnsFunction", kind: FunctionKind::Mutation, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "settlement-hang", handler: "hangForever", kind: FunctionKind::Mutation, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "unhandled-detached-rejection", handler: "detachedRejection", kind: FunctionKind::Mutation, args: json!({}), engines: Engines::Both, declared_fact: None },
        // ENG-23584: the detached chain parks on a HOST CALL before rejecting,
        // so the V8 leg only observes it if the drain waits for host-call
        // quiescence instead of a fixed microtask-tick count.
        Case { name: "unhandled-detached-rejection-after-host-call", handler: "detachedHostCallRejection", kind: FunctionKind::Mutation, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case { name: "detached-host-call-success", handler: "detachedHostCallSuccess", kind: FunctionKind::Mutation, args: json!({"label": "detached-ok", "rank": 7}), engines: Engines::Both, declared_fact: None },
        // ENG-23593: decoder fidelity on view windows and invalid utf-8 must
        // CONVERGE — the Ibex polyfill is spec-corrected, not declared.
        Case { name: "allowlist-decoder-fidelity", handler: "decoderFidelity", kind: FunctionKind::Query, args: json!({}), engines: Engines::Both, declared_fact: None },
        Case {
            name: "deterministic-date-constructor",
            handler: "probeDateConstructor",
            kind: FunctionKind::Query,
            args: json!({}),
            engines: Engines::Both,
            declared_fact: Some(
                "the zero-arg Date constructor (like Date.now/Math.random) is denied by the V8                  strip but reachable (codegen-banned only) on Ibex in v1 — the same declared                  engine fact, extended to the constructor path (ENG-23588)",
            ),
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
        },
        Case { name: "ambient-denial-fetch", handler: "probeFetch", kind: FunctionKind::Query, args: json!({}), engines: Engines::Both, declared_fact: None },
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
        },
    ]
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("conformance-twin-v0".to_owned()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![
                FieldManifest { name: "label".to_owned(), field_type: FieldType::String, optional: true },
                FieldManifest { name: "rank".to_owned(), field_type: FieldType::Integer, optional: true },
            ],
            indexes: Vec::new(),
            syncable: true,
        }],
        ..SchemaManifest::default()
    }
}

fn functions(cases: &[Case]) -> FunctionManifest {
    let mut functions: Vec<FunctionDefinition> = cases
        .iter()
        .map(|case| {
            FunctionDefinition::new(
                case.handler,
                case.kind.clone(),
                snapback::manifest::FunctionRuntime::IbexModule(IbexModule {
                    source: CORPUS_MODULE_SOURCE.to_owned(),
                    export: case.handler.to_owned(),
                }),
            )
        })
        .collect();
    functions.dedup_by(|a, b| a.name == b.name);
    // The storage-dump helper every case run uses after the fact.
    functions.push(FunctionDefinition::new(
        "dumpItems",
        FunctionKind::Query,
        snapback::manifest::FunctionRuntime::IbexModule(IbexModule {
            source: CORPUS_MODULE_SOURCE.to_owned(),
            export: "dumpItems".to_owned(),
        }),
    ));
    FunctionManifest { functions, ..FunctionManifest::default() }
}

fn input(args: Value) -> HandlerInput {
    HandlerInput { args, auth: AuthInput::default(), read_set: Vec::new(), correlation: None }
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
            let op = entries
                .get("op")
                .and_then(Value::as_str)
                .or(parent_op);
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
            let index = ids.iter().position(|known| known == &uuid).unwrap_or_else(|| {
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

/// One engine's observation of one case: outcome (result or stable code),
/// the normalized host-call trace, and the committed storage afterwards.
fn run_case_on(case: &Case, backend: HandlerBackend) -> Value {
    let mut snapback = LocalSnapback::memory().expect("instance");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions(&corpus()));

    let (outcome, trace) = with_host_call_trace(|| {
        with_forced_backend(backend, || match case.kind {
            FunctionKind::Mutation => snapback
                .invoke_mutation(case.handler, input(case.args.clone()))
                .map(|output| json!({"version": output.version, "changedCount": output.changed_count, "result": output.result})),
            _ => snapback
                .invoke_query(case.handler, input(case.args.clone()))
                .map(|output| json!({"version": output.version, "rows": output.rows})),
        })
    });
    let outcome = match outcome {
        Ok(value) => json!({"ok": true, "value": value}),
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

    let mut ids = Vec::new();
    json!({
        "outcome": normalize(&outcome, &mut ids),
        "trace": normalize(&serde_json::to_value(&contract_trace).unwrap_or(Value::Null), &mut ids),
        "committed": normalize(&committed, &mut ids),
    })
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
             dev dependency (npm install) or SNAPBACK_WORKERD_BIN"
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

    let busy_loop_budget_ms: u64 = 1_500;
    let mut cases_report = Vec::new();
    let mut convergent = 0usize;
    let mut declared = 0usize;
    let mut violations = 0usize;

    for case in corpus() {
        let workerd_run = with_wall_clock_timeout_ms(busy_loop_budget_ms.max(5_000), || {
            run_case_on(&case, HandlerBackend::WorkerdV8)
        });
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
                let ibex_run = run_case_on(&case, HandlerBackend::Ibex);
                if ibex_run == workerd_run {
                    convergent += 1;
                    (ibex_run, "convergent", Value::Null)
                } else if let Some(reason) = case.declared_fact {
                    declared += 1;
                    (ibex_run, "declared_engine_fact", json!(reason))
                } else {
                    violations += 1;
                    (ibex_run, "contract_violation", json!("unclassified divergence — blocks the gate"))
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
        }));
    }

    let runtime_facts = json!({
        "workerdVersion": workerd_version(&workerd_bin),
        "workerdBinary": workerd_bin.display().to_string(),
        "compatibilityDate": compat.compatibility_date,
        "compatibilityFlags": compat.compatibility_flags,
        "killDomain": "process-per-invocation",
        "wallClockTimeoutMs": snapback::workerd_exec::default_wall_clock_timeout_ms(),
        "hostCallTransport": "loopback-http-service-binding",
        "allowlist": "packages/snapback-harness/allowlist.json",
    });
    let manifest = CapabilityManifest::conformance_workerd_v8(runtime_facts);

    let gate = if violations == 0 { "green" } else { "blocked" };
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
    std::process::exit(if violations == 0 { 0 } else { 1 });
}
