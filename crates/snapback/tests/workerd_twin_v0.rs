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

use serde_json::{Map, Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, IndexManifest, SchemaManifest, SeedData,
    TableManifest,
};
use snapback::runtime::with_development_handler_error_exposure;
use snapback::workerd_exec::{
    HandlerBackend, HostCallTestMode, InvokeAuthTestMode, detect_workerd_binary,
    with_forced_backend, with_host_call_test_mode, with_invoke_auth_test_mode,
    with_wall_clock_timeout_ms,
};
use std::collections::BTreeMap;

const TWIN_MODULE_SOURCE: &str = include_str!("../../../tests/conformance/twin-corpus.handlers.js");

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

// Workerd-only module-boundary probes. The first names the strip module after
// the trusted server has consumed its one-shot capture; the second attempts to
// import the former rejection-ledger sibling outright. Neither source is fed
// to Hermes because static ESM imports are intentionally a workerd concern.
const STRIP_IMPORT_SOURCE: &str = r#"
import { consumeTrustedIntrinsics } from './strip.mjs';
var captured = consumeTrustedIntrinsics();
globalThis.__snapbackHandlers = {
  async importTrustedIntrinsicsProbe() {
    return [{ captured: captured !== null }];
  }
};
"#;

const LEDGER_IMPORT_SOURCE: &str = r#"
import { takeUnhandledRejections } from './rejection-ledger.mjs';
globalThis.__snapbackHandlers = {
  async importRejectionDrainProbe(ctx) {
    Promise.resolve().then(function() { throw new Error('must remain visible'); });
    takeUnhandledRejections();
    await ctx.db.insert('items', { label: 'must-not-commit-import-drain', rank: 34 });
    return {};
  }
};
"#;

const SERVER_IMPORT_SOURCE: &str = r#"
import handlerServer from './handler-server.mjs';

var originalFetch = handlerServer.fetch;
var assignmentBlocked = false;
var descriptorBlocked = false;
try {
  handlerServer.fetch = async function() {
    throw new Error('attacker received the Workerd env');
  };
} catch (_) {}
assignmentBlocked = handlerServer.fetch === originalFetch;

try {
  Object.defineProperty(handlerServer, 'fetch', {
    value: async function() {
      throw new Error('attacker replaced the service descriptor');
    }
  });
} catch (_) {}
descriptorBlocked = handlerServer.fetch === originalFetch;

globalThis.__snapbackHandlers = {
  async importHandlerServerProbe() {
    return [{
      assignmentBlocked: assignmentBlocked,
      descriptorBlocked: descriptorBlocked,
      frozen: Object.isFrozen(handlerServer)
    }];
  }
};
"#;

const BATCH_TWIN_SOURCE: &str = r#"
function publicRows(rows) {
  return rows.map(function(row) {
    return row === null ? null : { id: row._id, key: row.key, payload: row.payload };
  });
}

globalThis.__snapbackHandlers = {
  async batchAgreement(ctx) {
    return [{
      getMany: publicRows(await ctx.db.getMany('batch_items', ['item-b', 'missing', 'item-a', 'item-b'])),
      uniqueMany: publicRows(await ctx.db.uniqueMany('batch_items', 'byKey', [
        { key: 'beta' }, { key: 'missing' }, { key: 'alpha' }, { key: 'beta' }
      ]))
    }];
  },
  async batchUnknownIndex(ctx) {
    return await ctx.db.uniqueMany('batch_items', 'missing', [{ key: 'alpha' }]);
  },
  async batchNonUniqueIndex(ctx) {
    return await ctx.db.uniqueMany('batch_items', 'byPayload', [{ payload: 1 }]);
  },
  async batchMalformedKey(ctx) {
    return await ctx.db.uniqueMany('batch_items', 'byKey', [{ wrong: 'alpha' }]);
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
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
            history: None,
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
            define("queryLimitValidation", FunctionKind::Query),
            define("implicitLimitProbe", FunctionKind::Query),
            define("firstItem", FunctionKind::Query),
            define("readYourWrites", FunctionKind::Mutation),
            define("patchAndDelete", FunctionKind::Mutation),
            define("writeInQuery", FunctionKind::Query),
            define("hangForever", FunctionKind::Mutation),
            define("detachedRejection", FunctionKind::Mutation),
            define("nonThrowingConstructorRejection", FunctionKind::Mutation),
            define("noOpCapabilityConstructorRejection", FunctionKind::Mutation),
            define("rejectionDrainProbe", FunctionKind::Mutation),
            define("settlementForgeryProbe", FunctionKind::Mutation),
            define("settlementHostileErrorGetterProbe", FunctionKind::Mutation),
            define("settlementThenableForgeryProbe", FunctionKind::Mutation),
            define("busyLoop", FunctionKind::Mutation),
            define("probeGlobalName", FunctionKind::Query),
            define("probeDynamicCode", FunctionKind::Query),
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

fn configured_batch_twin() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("batch twin snapback");
    snapback
        .apply_schema(SchemaManifest {
            schema_hash: Some("workerd-batch-twin-v1".to_owned()),
            tables: vec![TableManifest {
                name: "batch_items".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "key".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "payload".to_owned(),
                        field_type: FieldType::Integer,
                        optional: false,
                    },
                ],
                indexes: vec![
                    IndexManifest {
                        name: "byKey".to_owned(),
                        fields: vec!["key".to_owned()],
                        unique: true,
                        where_applicable: false,
                    },
                    IndexManifest {
                        name: "byPayload".to_owned(),
                        fields: vec!["payload".to_owned()],
                        unique: false,
                        where_applicable: false,
                    },
                ],
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("batch twin schema");
    snapback
        .seed(SeedData {
            tables: BTreeMap::from([(
                "batch_items".to_owned(),
                vec![
                    Map::from_iter([
                        ("_id".to_owned(), json!("item-a")),
                        ("key".to_owned(), json!("alpha")),
                        ("payload".to_owned(), json!(1)),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!("item-b")),
                        ("key".to_owned(), json!("beta")),
                        ("payload".to_owned(), json!(2)),
                    ]),
                ],
            )]),
        })
        .expect("batch twin seed");
    let define = |name: &str| {
        let mut function = FunctionDefinition::new(
            name,
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: BATCH_TWIN_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        function.required_capabilities = vec!["bounded_batch_reads_v1".to_owned()];
        function
    };
    snapback.load_functions(FunctionManifest {
        acknowledged_experimental_capabilities: vec!["bounded_batch_reads_v1".to_owned()],
        functions: vec![
            define("batchAgreement"),
            define("batchUnknownIndex"),
            define("batchNonUniqueIndex"),
            define("batchMalformedKey"),
        ],
        ..FunctionManifest::default()
    });
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

fn workerd_capability_receipt(status: &str, executed_count: u64, reason: Option<&str>) {
    println!(
        "{}",
        json!({
            "schemaVersion": "snapback.test-capability-receipt.v1",
            "suite": "workerd-twin-v0",
            "capability": "workerd",
            "status": status,
            "executedCount": executed_count,
            "reason": reason,
        })
    );
}

fn require_workerd_capability() -> bool {
    if detect_workerd_binary().is_some() {
        return true;
    }
    workerd_capability_receipt("skipped", 0, Some("workerd-binary-missing"));
    assert_ne!(
        std::env::var("SNAPBACK_EXPECT_WORKERD").as_deref(),
        Ok("1"),
        "workerd was expected by this proof gate but no twin case executed"
    );
    false
}

/// Skip with a structured capability receipt when workerd is optional.
macro_rules! require_workerd {
    () => {
        if !require_workerd_capability() {
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
    .unwrap_or_else(|error| {
        panic!(
            "{backend:?} probe {name} errored: {error}; details={}",
            error.diagnostic.details
        )
    });
    output.rows[0].clone()
}

#[test]
fn workerd_capability_gate_executes_at_least_one_twin() {
    require_workerd!();
    let snapback = configured();
    let output = on_v8(|| snapback.invoke_query("listItems", input(json!({}))))
        .expect("workerd capability-gate query");
    assert!(output.rows.is_empty());
    workerd_capability_receipt("executed", 1, None);
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

/// Regression for the reservation-to-spawn port handoff race
/// (issues/20260803-workerd-port-handoff-collision.md): the runner used to
/// release its reserved ephemeral port before spawning workerd, so a parallel
/// start could reclaim the number during the handoff and turn a healthy
/// invocation into `SNAPBACK_V8_RUNNER_START_FAILED`. The bound listener is
/// now handed to workerd as an owned descriptor, so many simultaneous starts
/// must all come up under the normal parallel test runner.
#[test]
fn v8_parallel_starts_do_not_collide_on_the_worker_port() {
    require_workerd!();
    let threads: Vec<_> = (0..8)
        .map(|rank: i64| {
            std::thread::spawn(move || {
                let mut snapback = configured();
                let output = on_v8(|| {
                    snapback.invoke_mutation(
                        "addItem",
                        input(json!({ "label": format!("parallel-{rank}"), "rank": rank })),
                    )
                })
                .unwrap_or_else(|error| {
                    panic!(
                        "parallel workerd start {rank} errored: {error}; details={}",
                        error.diagnostic.details
                    )
                });
                assert_eq!(output.changed_count, 1);
            })
        })
        .collect();
    for handle in threads {
        handle
            .join()
            .expect("parallel workerd start thread panicked");
    }
}

#[test]
fn local_workerd_invoke_requires_its_generated_bearer() {
    require_workerd!();
    for mode in [InvokeAuthTestMode::Missing, InvokeAuthTestMode::Wrong] {
        let mut snapback = configured();
        let error = with_invoke_auth_test_mode(mode, || {
            on_v8(|| {
                snapback.invoke_mutation(
                    "addItem",
                    input(json!({"label": "unauthorized", "rank": 1})),
                )
            })
        })
        .expect_err("an unauthenticated local invoke must be refused");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
            "{mode:?}: {error}; details={}",
            error.diagnostic.details
        );
        assert!(
            snapback
                .invoke_query("listItems", input(json!({})))
                .expect("list items")
                .rows
                .is_empty(),
            "{mode:?}: an unauthenticated invoke must commit nothing"
        );
    }
}

#[test]
fn local_workerd_invoke_rejects_oversized_bodies_before_handler_execution() {
    require_workerd!();
    let mut snapback = configured();
    let error = with_invoke_auth_test_mode(InvokeAuthTestMode::OversizedBody, || {
        on_v8(|| {
            snapback.invoke_mutation("addItem", input(json!({"label": "oversized", "rank": 1})))
        })
    })
    .expect_err("an oversized private invoke must be refused");
    assert_eq!(error.diagnostic.code, "SNAPBACK_V8_RUNNER_INVOKE_FAILED");
    // The harness rejects from authenticated Content-Length before reading
    // the body. Depending on Workerd/HTTP timing, the caller observes either
    // its authenticated 413 or the upload socket closing early; both are the
    // same fail-closed transport result, and neither executes the handler.
    assert!(
        snapback
            .invoke_query("listItems", input(json!({})))
            .expect("list items")
            .rows
            .is_empty(),
        "an oversized invoke must execute no handler and commit nothing"
    );
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

// @ref LLP 0248#rollout — the shared local dispatch
// must keep the Ibex and workerd/V8 execution legs byte- and code-equivalent.
#[test]
fn bounded_batch_reads_are_engine_neutral() {
    require_workerd!();
    let mut encoded_results = Vec::new();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let snapback = configured_batch_twin();
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("batchAgreement", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{backend:?} batch agreement failed: {error}"));
        encoded_results
            .push(serde_json::to_vec(&output.rows).expect("serialize engine-neutral batch result"));

        for (function, expected_code) in [
            ("batchUnknownIndex", "SNAPBACK_BATCH_READ_INDEX_INVALID"),
            ("batchNonUniqueIndex", "SNAPBACK_BATCH_READ_INDEX_INVALID"),
            ("batchMalformedKey", "SNAPBACK_BATCH_READ_KEY_INVALID"),
        ] {
            let error = with_forced_backend(backend, || {
                snapback.invoke_query(function, input(json!({})))
            })
            .expect_err("invalid batch descriptor must fail closed");
            assert_eq!(
                error.diagnostic.code, expected_code,
                "{backend:?}/{function}"
            );
        }
    }
    assert_eq!(
        encoded_results[0], encoded_results[1],
        "Ibex and workerd/V8 batch results must be byte-identical",
    );
}

#[test]
fn query_limit_edge_values_fail_with_the_portable_diagnostic_on_both_engines() {
    require_workerd!();
    let expected = vec![json!({
        "codes": [
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "SNAPBACK_QUERY_LIMIT_INVALID"
        ]
    })];
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let snapback = configured();
        let output = with_forced_backend(backend, || {
            snapback.invoke_query("queryLimitValidation", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{backend:?} query-limit validation failed: {error}"));
        assert_eq!(output.rows, expected, "{backend:?}");
    }
}

#[test]
fn implicit_collection_limit_refusal_is_engine_neutral() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut snapback = configured();
        let rows = (0..1_025)
            .map(|rank| {
                Map::from_iter([
                    ("_id".to_owned(), json!(format!("item-{rank:04}"))),
                    ("label".to_owned(), json!(format!("item {rank}"))),
                    ("rank".to_owned(), json!(rank)),
                ])
            })
            .collect();
        snapback
            .seed(SeedData {
                tables: BTreeMap::from([("items".to_owned(), rows)]),
            })
            .expect("seed over-cap twin fixture");
        let error = with_forced_backend(backend, || {
            snapback.invoke_query("implicitLimitProbe", input(json!({})))
        })
        .expect_err("implicit collection at the portable cap must fail closed");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED",
            "{backend:?} must preserve the completeness refusal across its handler envelope"
        );
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
fn hostile_promise_constructor_cannot_forge_handling_on_either_engine() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        for (function, reason, path) in [
            (
                "nonThrowingConstructorRejection",
                "nonthrowing-constructor-must-remain-visible",
                "own",
            ),
            (
                "noOpCapabilityConstructorRejection",
                "no-op-child-capability-must-remain-visible",
                "own",
            ),
            (
                "noOpCapabilityConstructorRejection",
                "no-op-child-capability-must-remain-visible",
                "inherited",
            ),
        ] {
            let mut snapback = configured();
            let error = with_forced_backend(backend, || {
                snapback.invoke_mutation(function, input(json!({ "path": path })))
            })
            .expect_err("a hostile Promise constructor must not forge a handled reaction");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
                "{backend:?}/{function}/{path}: the detached rejection must remain visible"
            );
            assert_eq!(
                error.diagnostic.details["rejections"],
                json!([reason]),
                "{backend:?}/{function}/{path}: the engine must report the real rejection reason"
            );
            assert!(
                snapback
                    .invoke_query("listItems", input(json!({})))
                    .expect("the backend must remain healthy after the rejection")
                    .rows
                    .is_empty(),
                "{backend:?}/{function}/{path}: constructor poisoning must not commit buffered writes"
            );
        }
    }
}

#[test]
fn rejection_ledger_cannot_be_drained_by_handler_code_on_either_engine() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut snapback = configured();
        let error = with_forced_backend(backend, || {
            snapback.invoke_mutation("rejectionDrainProbe", input(json!({})))
        })
        .expect_err("handler-visible inspection must not drain rejection state");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
            "{backend:?}: unexpected rejection result: {error}"
        );
        assert!(
            snapback
                .invoke_query("listItems", input(json!({})))
                .expect("list items")
                .rows
                .is_empty(),
            "{backend:?}: a drain attempt must commit nothing"
        );
    }
}

#[test]
fn settlement_serialization_cannot_be_forged_on_either_engine() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut snapback = configured();
        let error = with_forced_backend(backend, || {
            snapback.invoke_mutation("settlementForgeryProbe", input(json!({})))
        })
        .expect_err("mutating JSON serialization must not forge success");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_HANDLER_FAILED",
            "{backend:?}: unexpected settlement result: {error}"
        );
        assert!(
            snapback
                .invoke_query("listItems", input(json!({})))
                .expect("list items")
                .rows
                .is_empty(),
            "{backend:?}: a forged settlement attempt must commit nothing"
        );
    }
}

#[test]
fn settlement_diagnostic_getters_cannot_escape_the_failure_envelope() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        for (getter, expected_message) in [
            ("code", "safe settlement failure"),
            ("message", "handler failure could not be safely inspected"),
            ("name", "safe settlement failure"),
            ("constructor", "safe settlement failure"),
            ("stack", "safe settlement failure"),
        ] {
            let mut snapback = configured();
            let error = with_development_handler_error_exposure(|| {
                with_forced_backend(backend, || {
                    snapback.invoke_mutation(
                        "settlementHostileErrorGetterProbe",
                        input(json!({ "getter": getter })),
                    )
                })
            })
            .expect_err("a hostile diagnostic getter must remain a handled failure");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_HANDLER_FAILED",
                "{backend:?}/{getter}: hostile getters must not escape settlement"
            );
            assert_eq!(
                error.diagnostic.details["message"],
                json!(expected_message),
                "{backend:?}/{getter}: the failure message must be safe and engine-neutral"
            );
            assert!(
                snapback
                    .invoke_query("listItems", input(json!({})))
                    .expect("the backend must remain healthy after the rejected invocation")
                    .rows
                    .is_empty(),
                "{backend:?}/{getter}: hostile getters must not commit buffered writes"
            );
        }
    }
}

#[test]
fn settlement_thenable_assimilation_cannot_be_forged_on_either_engine() {
    require_workerd!();
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let mut snapback = configured();
        let error = with_forced_backend(backend, || {
            snapback.invoke_mutation("settlementThenableForgeryProbe", input(json!({})))
        })
        .expect_err("an inherited then hook must not forge settlement success");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_HANDLER_FAILED",
            "{backend:?}: unexpected thenable-forgery result: {error}"
        );
        assert!(
            snapback
                .invoke_query("listItems", input(json!({})))
                .expect("list items")
                .rows
                .is_empty(),
            "{backend:?}: a thenable-forgery attempt must commit nothing"
        );
    }
}

#[test]
fn handler_import_cannot_recover_consumed_trusted_intrinsics() {
    require_workerd!();
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(FunctionManifest {
        functions: vec![FunctionDefinition::new(
            "importTrustedIntrinsicsProbe",
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: STRIP_IMPORT_SOURCE.to_owned(),
                export: "importTrustedIntrinsicsProbe".to_owned(),
            }),
        )],
        ..FunctionManifest::default()
    });

    let output = on_v8(|| snapback.invoke_query("importTrustedIntrinsicsProbe", input(json!({}))))
        .expect("trusted intrinsic import probe");
    assert_eq!(output.rows, vec![json!({ "captured": false })]);
}

#[test]
fn handler_import_cannot_reach_or_drain_rejection_ledger() {
    require_workerd!();
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(FunctionManifest {
        functions: vec![
            FunctionDefinition::new(
                "importRejectionDrainProbe",
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(IbexModule {
                    source: LEDGER_IMPORT_SOURCE.to_owned(),
                    export: "importRejectionDrainProbe".to_owned(),
                }),
            ),
            FunctionDefinition::new(
                "listItems",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source: TWIN_MODULE_SOURCE.to_owned(),
                    export: "listItems".to_owned(),
                }),
            ),
        ],
        ..FunctionManifest::default()
    });

    let error = on_v8(|| snapback.invoke_mutation("importRejectionDrainProbe", input(json!({}))))
        .expect_err("the closure-private rejection ledger must not resolve as a module");
    assert_eq!(error.diagnostic.code, "SNAPBACK_V8_RUNNER_START_FAILED");
    assert!(
        snapback
            .invoke_query("listItems", input(json!({})))
            .expect("list items")
            .rows
            .is_empty(),
        "the unresolvable handler module must execute no writes"
    );
}

#[test]
fn handler_import_cannot_replace_workerd_service_fetch() {
    require_workerd!();
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(FunctionManifest {
        functions: vec![FunctionDefinition::new(
            "importHandlerServerProbe",
            FunctionKind::Query,
            FunctionRuntime::IbexModule(IbexModule {
                source: SERVER_IMPORT_SOURCE.to_owned(),
                export: "importHandlerServerProbe".to_owned(),
            }),
        )],
        ..FunctionManifest::default()
    });

    let output = on_v8(|| snapback.invoke_query("importHandlerServerProbe", input(json!({}))))
        .expect("handler-server import probe");
    assert_eq!(
        output.rows,
        vec![json!({
            "assignmentBlocked": true,
            "descriptorBlocked": true,
            "frozen": true
        })],
        "untrusted modules must not replace the Workerd service and receive env bindings"
    );
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
    let allowlist: Value = serde_json::from_str(include_str!(
        "../../../packages/snapback-harness/allowlist.json"
    ))
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

/// Dynamic source compilation is denied by each engine configuration, not
/// merely by the codegen scanner. This includes Hermes's historical cached
/// `Function("return this")` fast path and aliases that never mention the
/// global constructor directly.
#[test]
fn dynamic_code_is_unreachable_on_both_engines() {
    require_workerd!();
    let snapback = configured();
    let expected = json!({
        "directEval": true,
        "indirectEval": true,
        "functionBody": true,
        "functionReturnThis": true,
        "functionWhitespace": true,
        "constructorWalk": true,
        "reflectApply": true,
        "reflectConstruct": true,
        "asyncFunction": true,
        "generatorFunction": true,
    });
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        let actual = probe(&snapback, backend, "probeDynamicCode", "");
        assert_eq!(actual, expected, "{backend:?}: dynamic code escaped");
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
    // This budget includes per-invocation workerd materialization, startup,
    // and readiness. Leave enough post-startup time under full-suite load for
    // the handler to enter its loop before the outer process deadline wins.
    let error = with_wall_clock_timeout_ms(5_000, || {
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

/// A detached HOST fetch that never returns must consume only the invocation's
/// remaining settlement budget. The harness must abort that transport and
/// report its structured fail-closed verdict before Rust's outer process-kill
/// deadline fires; otherwise this would surface WALL_CLOCK_EXCEEDED instead.
#[test]
fn detached_host_call_drain_is_bounded_by_the_remaining_invocation_deadline() {
    require_workerd!();
    let mut snapback = configured();
    let error = with_wall_clock_timeout_ms(1_500, || {
        with_host_call_test_mode(HostCallTestMode::NeverRespond, || {
            on_v8(|| {
                snapback.invoke_mutation(
                    "detachedHostCallSuccess",
                    input(json!({ "label": "must-not-commit", "rank": 88 })),
                )
            })
        })
    })
    .expect_err("a never-returning detached host call must fail at the harness deadline");
    assert_eq!(
        error.diagnostic.code, "SNAPBACK_HANDLER_DID_NOT_SETTLE",
        "the shared harness deadline must win before the outer process kill: {error}; details={}",
        error.diagnostic.details
    );
    assert_eq!(
        error.diagnostic.details.get("signal"),
        Some(&json!("structured harness quiescence deadline"))
    );
    assert_eq!(
        error.diagnostic.details.get("phase"),
        Some(&json!("quiescence"))
    );
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("query after bounded detached-host-call failure")
        .rows;
    assert!(
        rows.is_empty(),
        "a detached host call abandoned at the invocation deadline must commit nothing"
    );
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

/// ENG-24375: forgiving-base64 validation, the complete UTF-8 label table and
/// Web IDL conversion, and streaming UTF-8 state are handler-visible allowlist
/// semantics. Both engines must match the native/WHATWG expected values rather
/// than merely agree with each other.
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
            "utf8Hyphen": true,
            "utf8Compact": true,
            "unicode11Hyphen": true,
            "unicode11Compact": true,
            "unicode20Compact": true,
            "xUnicode20Compact": true,
            "asciiWhitespace": true,
            "aliasAsciiWhitespace": true,
            "internalSpaceRejected": true,
            "verticalTabRejected": true,
            "nonBreakingSpaceRejected": true,
            "nonUtf8Rejected": true,
            "symbolTypeError": true,
            "constructorIsWrapped": true,
            "constructorEscapeRejected": true
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

/// LLP 0094 §0F item 1 / LLP 0051 §D4: the REAL bytes the workerd leg puts on
/// the private handler-boundary transport — the JS harness's response
/// envelope and host-call bodies, and the Rust-serialized invocation request
/// — validate against the committed `handler.*` marker-envelope schemas. This
/// is the local-arm real-bytes half of the drift gate; the hosted half is
/// `cloudflare/test/wire-schema-gate.mjs`.
#[test]
fn handler_boundary_wire_bytes_validate_against_committed_schemas() {
    require_workerd!();
    let mut snapback = configured();
    let (result, captured) = snapback::workerd_exec::with_handler_wire_capture(|| {
        on_v8(|| snapback.invoke_mutation("addItem", input(json!({"label": "wire", "rank": 7}))))
    });
    result.expect("captured workerd mutation succeeds");

    let validate = |file: &str, raw: &str, role: &str| {
        let path = std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("schemas")
            .join(file);
        let schema: Value = serde_json::from_str(
            &std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("read {file}")),
        )
        .unwrap_or_else(|error| panic!("parse {file}: {error}"));
        let validator = jsonschema::validator_for(&schema)
            .unwrap_or_else(|error| panic!("compile {file}: {error}"));
        let value: Value = serde_json::from_str(raw)
            .unwrap_or_else(|error| panic!("{role} bytes were not JSON: {error}"));
        let errors: Vec<String> = validator
            .iter_errors(&value)
            .map(|error| format!("  {}: {error}", error.instance_path()))
            .collect();
        assert!(
            errors.is_empty(),
            "{role}: real workerd-transport bytes do not validate against {file}:\n{}\nbytes: {raw}",
            errors.join("\n")
        );
    };

    let invoke_request = captured
        .invoke_request
        .as_deref()
        .expect("capture recorded the invocation request");
    validate(
        "handler.invoke.input.schema.json",
        invoke_request,
        "invoke request",
    );
    let invoke_response = captured
        .invoke_response
        .as_deref()
        .expect("capture recorded the response envelope");
    validate(
        "handler.invoke.output.schema.json",
        invoke_response,
        "invoke response (workerd-produced)",
    );
    assert!(
        !captured.host_call_bodies.is_empty(),
        "the addItem mutation must issue ctx host calls through the loopback transport"
    );
    for (index, body) in captured.host_call_bodies.iter().enumerate() {
        validate(
            "handler.host-call.input.schema.json",
            body,
            &format!("host call #{index} (workerd-produced)"),
        );
    }
}
