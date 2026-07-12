//! LLP 0048 conformance-twin gate: the workerd/V8 leg runs the same handler
//! corpus as Ibex with only the executor swapped, and the LLP 0009
//! conformance floor (settlement, unhandled rejection, ambient denial) holds
//! engine-neutrally. These are the suites LLP 0048 proposes as the minimum
//! gate for LLP 0040's first deploy.
//!
//! The twin backend is a dev/CI dependency, not a product requirement
//! (LLP 0048 §Distribution posture): when workerd is absent every test here
//! skips cleanly with the capability code on stdout.

// SnapbackResult's large Err is a deliberate API-wide choice (see lib.rs);
// integration-test crates need their own allow under clippy 1.94+.
#![allow(clippy::result_large_err)]

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};
use snapback::workerd_exec::{
    HandlerBackend, detect_workerd_binary, with_forced_backend, with_wall_clock_timeout_ms,
};

const TWIN_MODULE_SOURCE: &str = include_str!("conformance/twin-corpus.handlers.js");

// Same adversarial module bytes on both engines (ENG-24339). It tries every
// harness-control interception shape before registering its handler: reserve a
// frozen settle global, replace invoke with an accessor, assign over settle,
// and wrap the raw Ibex transport. Trusted helpers must already be sealed.
const HARNESS_TAMPER_SOURCE: &str = r#"
var harnessTamper = {
  nonWritableBlocked: false,
  accessorBlocked: false,
  assignmentBlocked: false,
  wrapperCalls: 0
};
(function(g) {
  var originalSettle = g.__snapbackSettle;
  var originalInvoke = g.__snapbackInvoke;
  try {
    Object.defineProperty(g, '__snapbackSettle', {
      value: async function() { return 'attacker'; },
      configurable: false,
      writable: false
    });
  } catch (_) {
    harnessTamper.nonWritableBlocked = true;
  }
  try {
    Object.defineProperty(g, '__snapbackInvoke', {
      get: function() { throw new Error('invoke accessor intercepted'); },
      configurable: false
    });
  } catch (_) {
    harnessTamper.accessorBlocked = true;
  }
  try {
    g.__snapbackSettle = async function() { return 'assigned attacker'; };
  } catch (_) {}
  harnessTamper.assignmentBlocked = g.__snapbackSettle === originalSettle;
  harnessTamper.nonWritableBlocked =
    harnessTamper.nonWritableBlocked && g.__snapbackSettle === originalSettle;
  harnessTamper.accessorBlocked =
    harnessTamper.accessorBlocked && g.__snapbackInvoke === originalInvoke;

  var originalHostCall = g.__hostCall;
  try {
    g.__hostCall = function(rawOp, argsJson) {
      harnessTamper.wrapperCalls++;
      if (typeof originalHostCall === 'function') {
        return originalHostCall(rawOp, argsJson);
      }
      throw new Error('raw host transport unavailable');
    };
  } catch (_) {}
})(globalThis);

globalThis.__snapbackHandlers = {
  async harnessTamperProbe(ctx) {
    var beforeCtxCall = harnessTamper.wrapperCalls;
    await ctx.runtime.now();
    var ctxWrapperIntercepted = harnessTamper.wrapperCalls !== beforeCtxCall;
    var rawCallDenied = false;
    try {
      globalThis.__hostCall('db.get', JSON.stringify({ table: 'items', id: 'secret' }));
    } catch (_) {
      rawCallDenied = true;
    }
    return [{
      nonWritableBlocked: harnessTamper.nonWritableBlocked,
      accessorBlocked: harnessTamper.accessorBlocked,
      assignmentBlocked: harnessTamper.assignmentBlocked,
      ctxWrapperIntercepted: ctxWrapperIntercepted,
      rawCallDenied: rawCallDenied
    }];
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("workerd-twin-v0".to_owned()),
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
        }],
        ..SchemaManifest::default()
    }
}

fn functions() -> FunctionManifest {
    let define = |name: &str, kind: FunctionKind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: TWIN_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("addItem", FunctionKind::Mutation),
            define("listItems", FunctionKind::Query),
            define("firstItem", FunctionKind::Query),
            define("readYourWrites", FunctionKind::Mutation),
            define("patchAndDelete", FunctionKind::Mutation),
            define("writeInQuery", FunctionKind::Query),
            define("hangForever", FunctionKind::Mutation),
            define("detachedRejection", FunctionKind::Mutation),
            define("busyLoop", FunctionKind::Mutation),
            define("probeGlobalName", FunctionKind::Query),
            define("probeMember", FunctionKind::Query),
            define("allowlistSlice", FunctionKind::Query),
            define("atobRejectsGarbage", FunctionKind::Query),
            define("encodingBoundaryFidelity", FunctionKind::Query),
            define("detachedHostCallRejection", FunctionKind::Mutation),
            define("detachedHostCallSuccess", FunctionKind::Mutation),
            define("probeDateConstructor", FunctionKind::Query),
            define("decoderFidelity", FunctionKind::Query),
            define("ledgeredIds", FunctionKind::Mutation),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());
    snapback
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

/// Skip cleanly (capability fact, not failure) when workerd is unavailable.
macro_rules! require_workerd {
    () => {
        if detect_workerd_binary().is_none() {
            println!("SNAPBACK_CAPABILITY_WORKERD_MISSING: skipping workerd twin test");
            return;
        }
    };
}

fn on_v8<T>(f: impl FnOnce() -> T) -> T {
    with_forced_backend(HandlerBackend::WorkerdV8, f)
}

fn probe(snapback: &LocalSnapback, backend: HandlerBackend, handler: &str, name: &str) -> Value {
    let output = with_forced_backend(backend, || {
        snapback.invoke_query(handler, input(json!({ "name": name })))
    })
    .unwrap_or_else(|error| panic!("{backend:?} probe {name} errored: {error}"));
    output.rows[0].clone()
}

#[test]
fn v8_mutation_commits_end_to_end() {
    require_workerd!();
    let mut snapback = configured();
    let output =
        on_v8(|| snapback.invoke_mutation("addItem", input(json!({"label": "a", "rank": 1}))))
            .expect("workerd mutation");
    assert_eq!(output.changed_count, 1);
    // The committed row is visible to a subsequent Ibex-leg query — same
    // storage, same version stream, only the executor differed.
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("ibex query after v8 mutation")
        .rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("label"), Some(&json!("a")));
}

#[test]
fn v8_and_ibex_agree_on_query_and_read_your_writes() {
    require_workerd!();
    let mut on_ibex = configured();
    let mut on_workerd = configured();
    for (label, backend, snapback) in [
        ("ibex", HandlerBackend::Ibex, &mut on_ibex),
        ("workerd-v8", HandlerBackend::WorkerdV8, &mut on_workerd),
    ] {
        let visible = with_forced_backend(backend, || {
            snapback.invoke_mutation("readYourWrites", input(json!({"label": "ryw"})))
        })
        .unwrap_or_else(|error| panic!("{label} readYourWrites failed: {error}"));
        assert_eq!(
            visible.result.get("visible"),
            Some(&json!(1)),
            "{label}: buffered insert must be visible to the same invocation's query"
        );
        let first = with_forced_backend(backend, || {
            snapback.invoke_query("firstItem", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{label} firstItem failed: {error}"));
        assert_eq!(
            first.rows.len(),
            1,
            "{label}: first() sees the committed row"
        );
        let patch = with_forced_backend(backend, || {
            snapback.invoke_mutation("patchAndDelete", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{label} patchAndDelete failed: {error}"));
        assert_eq!(patch.result.get("existed"), Some(&json!(true)), "{label}");
        assert_eq!(
            patch.result.get("label"),
            Some(&json!("patched")),
            "{label}"
        );
        assert_eq!(patch.result.get("removed"), Some(&json!(true)), "{label}");
    }
}

#[test]
fn settlement_floor_is_engine_neutral() {
    require_workerd!();
    let mut snapback = configured();
    let error = with_wall_clock_timeout_ms(1_500, || {
        on_v8(|| snapback.invoke_mutation("hangForever", input(json!({}))))
    })
    .expect_err("an unsettled handler must fail on the V8 leg too");
    assert_eq!(
        error.diagnostic.code, "SNAPBACK_HANDLER_DID_NOT_SETTLE",
        "unexpected diagnostic: {error}"
    );
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("query")
        .rows;
    assert!(rows.is_empty(), "an unsettled mutation must commit nothing");
}

#[test]
fn unhandled_rejection_floor_is_engine_neutral() {
    require_workerd!();
    let mut snapback = configured();
    let error =
        on_v8(|| snapback.invoke_mutation("detachedRejection", input(json!({"label": "x"}))))
            .expect_err("a detached rejection must fail the invocation on the V8 leg too");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("query")
        .rows;
    assert!(rows.is_empty(), "a rejected invocation must commit nothing");
}

#[test]
fn write_in_query_is_denied_on_both_engines() {
    require_workerd!();
    let snapback = configured();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let error = with_forced_backend(backend, || {
            snapback.invoke_query("writeInQuery", input(json!({})))
        })
        .expect_err("query-mode writes must fail");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_HANDLER_WRITE_IN_QUERY",
            "{backend:?}: write-in-query must carry its stable code"
        );
    }
}

/// ENG-24339: harness entry points are installed before untrusted module
/// evaluation and cannot be reserved, accessor-shadowed, assigned over, or
/// used to wrap the live invocation transport. A direct raw call is denied.
#[test]
fn harness_control_plane_resists_tampering_on_both_engines() {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(FunctionManifest {
        functions: vec![FunctionDefinition::new(
            "harnessTamperProbe",
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: HARNESS_TAMPER_SOURCE.to_owned(),
                export: "harnessTamperProbe".to_owned(),
            }),
        )],
        ..FunctionManifest::default()
    });
    let expected = json!({
        "nonWritableBlocked": true,
        "accessorBlocked": true,
        "assignmentBlocked": true,
        "ctxWrapperIntercepted": false,
        "rawCallDenied": true
    });
    let mut backends = vec![HandlerBackend::Ibex];
    if detect_workerd_binary().is_some() {
        backends.push(HandlerBackend::WorkerdV8);
    } else {
        println!("SNAPBACK_CAPABILITY_WORKERD_MISSING: workerd half of tamper twin skipped");
    }
    for backend in backends {
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("harnessTamperProbe", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{backend:?} harness tamper probe failed: {error}"));
        assert_eq!(
            output.rows[0], expected,
            "{backend:?}: harness control-plane tampering escaped"
        );
    }
}

/// The two-direction ambient-power denial suite (LLP 0040 §App subset via
/// LLP 0048 §Acceptance): ambient globals and host-object reach-through are
/// unreachable from handler code on both engines.
#[test]
fn ambient_powers_are_unreachable_on_both_engines() {
    require_workerd!();
    let snapback = configured();
    // The probe list is the allowlist itself (ENG-23590): a retyped literal
    // drifts, so parse bannedEverywhere.globals from the single source. The
    // one exclusion is HermesInternal, the declared engine fact pinned by
    // deterministic_member_denial_is_a_declared_engine_fact below.
    let allowlist: Value =
        serde_json::from_str(include_str!("../packages/snapback-harness/allowlist.json"))
            .expect("allowlist.json parses");
    let probes: Vec<String> = allowlist["bannedEverywhere"]["globals"]
        .as_array()
        .expect("bannedEverywhere.globals is an array")
        .iter()
        .filter_map(Value::as_str)
        .filter(|name| *name != "HermesInternal")
        .map(ToOwned::to_owned)
        .collect();
    assert!(
        probes.len() >= 40,
        "allowlist banned set unexpectedly small: {}",
        probes.len()
    );
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        for name in &probes {
            let result = probe(&snapback, backend, "probeGlobalName", name);
            assert_eq!(
                result.get("reachable"),
                Some(&json!(false)),
                "{backend:?}: {name} must be unreachable, got {result}"
            );
        }
    }
}

/// Deterministic-member denial is CONVERGENT for the deterministic tier
/// (LLP 0051 Increment 2, ENG-23892): queries and mutations get runtime
/// member denial on BOTH engines — the Ibex leg single-sources its deny
/// stubs from the same allowlist `members` list the V8 strip consumes, plus
/// the zero-arg `Date`-constructor rule (ENG-23588). The previous version of
/// this test pinned the v1 asymmetry as a declared engine fact; the flip is
/// deliberate — the pin existed precisely so this would be a decision, not
/// drift. Actions keep the ambient members (the busy-wait watchdog tests are
/// action tests and stay untouched).
#[test]
fn deterministic_member_denial_is_convergent_for_the_deterministic_tier() {
    require_workerd!();
    let snapback = configured();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        for member in ["Date.now", "Math.random"] {
            let result = probe(&snapback, backend, "probeMember", member);
            assert_eq!(
                result.get("reachable"),
                Some(&json!(false)),
                "{backend:?}: {member} must be denied in the deterministic tier, got {result}"
            );
        }
        // The Date CONSTRUCTOR's ambient clock read is denied the same way on
        // both engines (ENG-23588): zero-arg construction and Date() as a
        // function; explicit-timestamp construction stays usable.
        let ctor = probe(&snapback, backend, "probeDateConstructor", "");
        assert_eq!(
            ctor.get("explicit"),
            Some(&json!(true)),
            "{backend:?}: new Date(ms) must stay usable; got {ctor}"
        );
        assert_eq!(
            ctor.get("zeroArgReachable"),
            Some(&json!(false)),
            "{backend:?}: new Date() must be denied; got {ctor}"
        );
        assert_eq!(
            ctor.get("callReachable"),
            Some(&json!(false)),
            "{backend:?}: Date() as a function must be denied; got {ctor}"
        );
    }

    // HermesInternal is non-configurable AND non-writable on the vendored
    // engine, so it cannot be shadowed at the JS layer; it carries engine
    // introspection, not ambient authority. Declared engine fact until the
    // vendored runtime disables it at construction (follow-up filed in the
    // LLP 0048 report). Absent on the V8 leg by construction.
    let on_workerd = probe(
        &snapback,
        HandlerBackend::WorkerdV8,
        "probeGlobalName",
        "HermesInternal",
    );
    assert_eq!(on_workerd.get("reachable"), Some(&json!(false)));
    let on_ibex = probe(
        &snapback,
        HandlerBackend::Ibex,
        "probeGlobalName",
        "HermesInternal",
    );
    assert_eq!(
        on_ibex.get("reachable"),
        Some(&json!(true)),
        "ibex: HermesInternal is a declared engine fact in v1; got {on_ibex}"
    );
}

#[test]
fn busy_loop_is_killed_with_no_commit_and_no_collateral() {
    require_workerd!();
    let mut snapback = configured();
    let error = with_wall_clock_timeout_ms(1_500, || {
        on_v8(|| snapback.invoke_mutation("busyLoop", input(json!({}))))
    })
    .expect_err("a busy loop on the V8 leg must be killed");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED"
    );
    let details = error.diagnostic.details.clone();
    assert_eq!(
        details.get("killDomain"),
        Some(&json!("process-per-invocation"))
    );
    // The pre-kill buffered insert must not have committed.
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("query")
        .rows;
    assert!(rows.is_empty(), "a killed mutation commits nothing");
    // No collateral: an unrelated invocation immediately afterwards succeeds
    // (its own fresh process on the V8 leg).
    let output =
        on_v8(|| snapback.invoke_mutation("addItem", input(json!({"label": "after", "rank": 2}))))
            .expect("post-kill invocation");
    assert_eq!(output.changed_count, 1);
}

#[test]
fn allowlist_slice_agrees_on_both_engines() {
    require_workerd!();
    let snapback = configured();
    let mut outputs = Vec::new();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("allowlistSlice", input(json!({ "text": "héllo ✓" })))
        })
        .unwrap_or_else(|error| panic!("{backend:?} allowlistSlice failed: {error}"));
        outputs.push(output.rows);
    }
    assert_eq!(
        outputs[0], outputs[1],
        "TextEncoder/TextDecoder/atob/btoa must have identical observable semantics on both engines"
    );
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("atobRejectsGarbage", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{backend:?} atobRejectsGarbage failed: {error}"));
        assert_eq!(
            output.rows[0],
            json!({ "threw": true, "coded": true }),
            "{backend:?}: atob must reject garbage with the Snapback-owned code"
        );
    }
}

/// ENG-23584: a detached chain that rejects only AFTER awaiting a host call
/// must still fail the invocation on the V8 leg, where the host call is a
/// real async round trip — the drain must be a quiescence contract, not a
/// fixed microtask-tick count. Both legs must refuse to commit the chain's
/// partial writes.
#[test]
fn detached_rejection_after_host_call_fails_closed_on_both_engines() {
    require_workerd!();
    let mut snapback = configured();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let error = with_forced_backend(backend, || {
            snapback.invoke_mutation("detachedHostCallRejection", input(json!({})))
        })
        .expect_err("a detached rejection parked on a host call must fail the invocation");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
            "{backend:?}: unexpected diagnostic: {error}"
        );
        let rows = snapback
            .invoke_query("listItems", input(json!({})))
            .expect("query")
            .rows;
        assert!(
            rows.is_empty(),
            "{backend:?}: a failed invocation must commit none of its detached writes"
        );
    }
}

/// ENG-23579: the same detached-host-call drain must not overcorrect by
/// dropping legitimate all-good detached writes. A detached chain that awaits
/// a host call and resolves cleanly is drained before commit on both legs.
#[test]
fn detached_success_after_host_call_commits_on_both_engines() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut snapback = configured();
        let output = with_forced_backend(backend, || {
            snapback.invoke_mutation(
                "detachedHostCallSuccess",
                input(json!({ "label": format!("{backend:?}"), "rank": 7 })),
            )
        })
        .unwrap_or_else(|error| panic!("{backend:?} detachedHostCallSuccess failed: {error}"));
        assert_eq!(
            output.changed_count, 1,
            "{backend:?}: detached write must commit"
        );
        let rows = snapback
            .invoke_query("listItems", input(json!({})))
            .expect("query")
            .rows;
        assert_eq!(
            rows.len(),
            1,
            "{backend:?}: committed detached write must be visible"
        );
        assert_eq!(
            rows[0].get("rank"),
            Some(&json!(7)),
            "{backend:?}: got {rows:?}"
        );
    }
}

/// ENG-23593: TextDecoder must agree byte-for-byte across engines on view
/// windows, invalid utf-8 (U+FFFD replacement), BOM handling, and fatal mode
/// — and agree with the WHATWG-expected values, so both legs being wrong the
/// same way cannot pass.
#[test]
fn decoder_fidelity_agrees_on_both_engines_and_with_the_spec() {
    require_workerd!();
    let snapback = configured();
    let expected = json!({
        "dataViewWindow": "cde",
        "int8Window": "ef",
        "truncated": "\u{FFFD}",
        "invalidByte": "\u{FFFD}",
        "badContinuation": "\u{FFFD}A",
        "bomStripped": "a",
        "bomKept": true,
        "encodeIntoFit": "3:4:104,195,169,33",
        "encodeIntoTruncates": "1:1",
        "fatalThrew": true
    });
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("decoderFidelity", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{backend:?} decoderFidelity failed: {error}"));
        assert_eq!(
            output.rows[0], expected,
            "{backend:?}: TextDecoder fidelity diverged from the WHATWG-expected values"
        );
    }
}

/// ENG-24375: forgiving-base64 padding validation and streaming UTF-8 state
/// are handler-visible allowlist semantics, so both engines must match the
/// native/WHATWG expected values rather than merely agree with each other.
#[test]
fn encoding_boundaries_agree_on_both_engines_and_with_the_spec() {
    require_workerd!();
    let snapback = configured();
    let expected = json!({
        "base64": {
            "canonical": "a",
            "missingPadding": "a",
            "whitespace": "a",
            "splitPaddingWhitespace": "a",
            "fullQuantum": "abcd",
            "allPaddingRejected": true,
            "shortPaddingRejected": true,
            "extraPaddingRejected": true,
            "triplePaddingRejected": true,
            "leadingPaddingRejected": true,
            "truncatedPaddingRejected": true
        },
        "labels": {
            "asciiWhitespace": true,
            "aliasAsciiWhitespace": true,
            "internalSpaceRejected": true
        },
        "streaming": {
            "twoByte": ["", "¢", ""],
            "threeByte": ["", "", "€", ""],
            "fourByte": ["", "", "", "😀", ""],
            "fatalFourByte": ["", "", "", "😀", ""],
            "flush": ["", "�", "A"],
            "fatalFlush": { "first": "", "threw": true, "reuse": "A" },
            "fatalInvalid": { "first": "", "threw": true, "reuse": "B" },
            "bomReuse": { "first": "", "second": "", "complete": "A", "reuse": "B" }
        }
    });
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("encodingBoundaryFidelity", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{backend:?} encodingBoundaryFidelity failed: {error}"));
        assert_eq!(
            output.rows[0], expected,
            "{backend:?}: base64/TextDecoder boundary semantics diverged"
        );
    }
}

/// LLP 0051 D1 (Increment 2): the ctx-answer ledger is engine-equivalent.
/// A ledger recorded on either leg replays on the other to a byte-identical
/// result — the record/replay channel lives on the shared host-call seam, so
/// only the executor differs. Divergence (consuming past the ledger end) is
/// the same typed error on both engines.
#[test]
fn ctx_answer_ledger_is_equivalent_across_engines() {
    require_workerd!();
    // Record on the Ibex leg.
    let mut recorder = configured();
    let recorded = recorder
        .invoke_mutation("ledgeredIds", input(json!({ "tag": "twin" })))
        .expect("record-mode mutation on ibex");
    let ledger = recorded
        .ctx_ledger
        .clone()
        .expect("ibex mutation carries a ledger");
    assert_eq!(
        ledger.ids.len(),
        3,
        "two runtime.id answers + one insert id"
    );

    // Replay the SAME ledger on both legs (fresh instances): identical
    // results, identical echoed ledgers.
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut replayer = configured();
        let mut replay_input = input(json!({ "tag": "twin" }));
        replay_input.ctx_ledger = Some(ledger.clone());
        let replayed = with_forced_backend(backend, || {
            replayer.invoke_mutation("ledgeredIds", replay_input)
        })
        .unwrap_or_else(|error| panic!("{backend:?} replay failed: {error}"));
        assert_eq!(
            replayed.result, recorded.result,
            "{backend:?}: replay must reproduce the recorded result exactly"
        );
        assert_eq!(
            replayed.ctx_ledger.as_ref().map(|l| &l.ids),
            Some(&ledger.ids),
            "{backend:?}: replay echoes the consumed ledger"
        );
    }

    // Record on the V8 leg too — the ledger channel is not Ibex-shaped.
    let mut v8_recorder = configured();
    let v8_recorded =
        on_v8(|| v8_recorder.invoke_mutation("ledgeredIds", input(json!({ "tag": "twin-v8" }))))
            .expect("record-mode mutation on workerd-v8");
    let v8_ledger = v8_recorded
        .ctx_ledger
        .expect("v8 mutation carries a ledger");
    assert_eq!(v8_ledger.ids.len(), 3);
    assert_eq!(
        v8_recorded.result.get("rowId"),
        Some(&json!(v8_ledger.ids[2]))
    );

    // Divergence is the same typed error on both legs.
    let mut short = ledger.clone();
    short.ids.truncate(1);
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut replayer = configured();
        let mut replay_input = input(json!({ "tag": "twin" }));
        replay_input.ctx_ledger = Some(short.clone());
        let error = with_forced_backend(backend, || {
            replayer.invoke_mutation("ledgeredIds", replay_input)
        })
        .expect_err("consuming past the ledger end must fail");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_CTX_LEDGER_EXHAUSTED",
            "{backend:?}: unexpected diagnostic: {error}"
        );
    }
}
