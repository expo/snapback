//! LLP 0048 conformance-twin gate: the workerd/V8 leg runs the same handler
//! corpus as Ibex with only the executor swapped, and the LLP 0009
//! conformance floor (settlement, unhandled rejection, ambient denial) holds
//! engine-neutrally. These are the suites LLP 0048 proposes as the minimum
//! gate for LLP 0040's first deploy.
//!
//! The twin backend is a dev/CI dependency, not a product requirement
//! (LLP 0048 §Distribution posture): when workerd is absent every test here
//! skips cleanly with the capability code on stdout.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};
use snapback::workerd_exec::{
    HandlerBackend, detect_workerd_binary, with_forced_backend, with_wall_clock_timeout_ms,
};

const TWIN_MODULE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async addItem(ctx, args) {
    var id = await ctx.db.insert('items', { label: args.label, rank: args.rank });
    return { id: id };
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('rank', 'asc').collect();
  },
  async firstItem(ctx) {
    var row = await ctx.db.query('items').order('rank', 'asc').first();
    return row ? [row] : [];
  },
  async readYourWrites(ctx, args) {
    await ctx.db.insert('items', { label: args.label, rank: 1 });
    var rows = await ctx.db.query('items').eq('label', args.label).collect();
    return { visible: rows.length };
  },
  async patchAndDelete(ctx, args) {
    var id = await ctx.db.insert('items', { label: 'temp', rank: 9 });
    var existed = await ctx.db.patch('items', id, { label: 'patched' });
    var seen = await ctx.db.get('items', id);
    var removed = await ctx.db.delete('items', id);
    return { existed: existed, label: seen && seen.label, removed: removed };
  },
  async writeInQuery(ctx) {
    await ctx.db.insert('items', { label: 'nope', rank: 0 });
    return [];
  },
  async hangForever(ctx) {
    await new Promise(function () {});
    return {};
  },
  async detachedRejection(ctx, args) {
    Promise.resolve().then(function () {
      throw new Error('detached failure');
    });
    await ctx.db.insert('items', { label: args.label, rank: 3 });
    return {};
  },
  async busyLoop(ctx) {
    await ctx.db.insert('items', { label: 'pre-kill', rank: 5 });
    for (;;) {}
  },
  async probeGlobalName(ctx, args) {
    var name = args.name;
    var value = globalThis[name];
    if (value === undefined || value === null) {
      return [{ name: name, reachable: false, how: 'absent' }];
    }
    if (typeof value === 'function') {
      try {
        value();
        return [{ name: name, reachable: true, how: 'callable' }];
      } catch (error) {
        var message = String(error && error.message || error);
        if (message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0) {
          return [{ name: name, reachable: false, how: 'denied' }];
        }
        return [{ name: name, reachable: true, how: 'callable-throws' }];
      }
    }
    return [{ name: name, reachable: true, how: 'value' }];
  },
  async probeMember(ctx, args) {
    var parts = args.name.split('.');
    var holder = globalThis[parts[0]];
    if (!holder) { return [{ reachable: false, how: 'absent' }]; }
    var member = holder[parts[1]];
    if (typeof member !== 'function') { return [{ reachable: false, how: 'absent' }]; }
    try {
      member.call(holder);
      return [{ reachable: true, how: 'callable' }];
    } catch (error) {
      var message = String(error && error.message || error);
      if (message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0) {
        return [{ reachable: false, how: 'denied' }];
      }
      return [{ reachable: true, how: 'callable-throws' }];
    }
  },
  async allowlistSlice(ctx, args) {
    var encoder = new TextEncoder();
    var bytes = encoder.encode(args.text);
    var decoder = new TextDecoder();
    var roundTrip = decoder.decode(bytes);
    var encoded = btoa('snapback');
    var decoded = atob(encoded);
    console.log('allowlist slice exercised', args.text);
    var byteList = [];
    for (var i = 0; i < bytes.length; i++) { byteList.push(bytes[i]); }
    return [{
      bytes: byteList,
      roundTrip: roundTrip,
      encoded: encoded,
      decoded: decoded
    }];
  },
  async atobRejectsGarbage(ctx) {
    try {
      atob('%%%not-base64%%%');
      return [{ threw: false }];
    } catch (error) {
      var message = String(error && error.message || error);
      return [{ threw: true, coded: message.indexOf('SNAPBACK_HANDLER_INVALID_CHARACTER') === 0 }];
    }
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
    let output = on_v8(|| snapback.invoke_mutation("addItem", input(json!({"label": "a", "rank": 1}))))
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
        assert_eq!(first.rows.len(), 1, "{label}: first() sees the committed row");
        let patch = with_forced_backend(backend, || {
            snapback.invoke_mutation("patchAndDelete", input(json!({})))
        })
        .unwrap_or_else(|error| panic!("{label} patchAndDelete failed: {error}"));
        assert_eq!(patch.result.get("existed"), Some(&json!(true)), "{label}");
        assert_eq!(patch.result.get("label"), Some(&json!("patched")), "{label}");
        assert_eq!(patch.result.get("removed"), Some(&json!(true)), "{label}");
    }
}

#[test]
fn settlement_floor_is_engine_neutral() {
    require_workerd!();
    let mut snapback = configured();
    let error = on_v8(|| snapback.invoke_mutation("hangForever", input(json!({}))))
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
    let error = on_v8(|| snapback.invoke_mutation("detachedRejection", input(json!({"label": "x"}))))
        .expect_err("a detached rejection must fail the invocation on the V8 leg too");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_UNHANDLED_REJECTION");
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

/// The two-direction ambient-power denial suite (LLP 0040 §App subset via
/// LLP 0048 §Acceptance): ambient globals and host-object reach-through are
/// unreachable from handler code on both engines.
#[test]
fn ambient_powers_are_unreachable_on_both_engines() {
    require_workerd!();
    let snapback = configured();
    let probes = [
        "fetch",
        "WebSocket",
        "setTimeout",
        "setInterval",
        "performance",
        "navigator",
        "caches",
        "crypto",
        "scheduler",
        "process",
        "require",
        "Buffer",
        "print",
        "URL",
        "URLSearchParams",
        "structuredClone",
        "Request",
        "Response",
        "Headers",
        "ReadableStream",
        "WebAssembly",
        "addEventListener",
    ];
    for backend in [HandlerBackend::Ibex, HandlerBackend::WorkerdV8] {
        for name in probes {
            let result = probe(&snapback, backend, "probeGlobalName", name);
            assert_eq!(
                result.get("reachable"),
                Some(&json!(false)),
                "{backend:?}: {name} must be unreachable, got {result}"
            );
        }
    }
}

/// Deterministic-member denial is a *declared engine fact*, asymmetric by
/// design in v1: the V8 strip denies `Date.now`/`Math.random` at runtime,
/// while the Ibex leg still exposes them and relies on the LLP 0009 codegen
/// ban (existing watchdog tests depend on handler-visible `Date.now`). The
/// capability manifests state this; this test pins the asymmetry so a change
/// on either side is a deliberate decision, not drift.
#[test]
fn deterministic_member_denial_is_a_declared_engine_fact() {
    require_workerd!();
    let snapback = configured();
    for member in ["Date.now", "Math.random"] {
        let on_workerd = probe(&snapback, HandlerBackend::WorkerdV8, "probeMember", member);
        assert_eq!(
            on_workerd.get("reachable"),
            Some(&json!(false)),
            "workerd-v8: {member} must be denied, got {on_workerd}"
        );
        let on_ibex = probe(&snapback, HandlerBackend::Ibex, "probeMember", member);
        assert_eq!(
            on_ibex.get("reachable"),
            Some(&json!(true)),
            "ibex: {member} is expected reachable in v1 (codegen-banned, declared fact); got {on_ibex}"
        );
    }
    // HermesInternal is non-configurable AND non-writable on the vendored
    // engine, so it cannot be shadowed at the JS layer; it carries engine
    // introspection, not ambient authority. Declared engine fact until the
    // vendored runtime disables it at construction (follow-up filed in the
    // LLP 0048 report). Absent on the V8 leg by construction.
    let on_workerd = probe(&snapback, HandlerBackend::WorkerdV8, "probeGlobalName", "HermesInternal");
    assert_eq!(on_workerd.get("reachable"), Some(&json!(false)));
    let on_ibex = probe(&snapback, HandlerBackend::Ibex, "probeGlobalName", "HermesInternal");
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
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED");
    let details = error.diagnostic.details.clone();
    assert_eq!(details.get("killDomain"), Some(&json!("process-per-invocation")));
    // The pre-kill buffered insert must not have committed.
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("query")
        .rows;
    assert!(rows.is_empty(), "a killed mutation commits nothing");
    // No collateral: an unrelated invocation immediately afterwards succeeds
    // (its own fresh process on the V8 leg).
    let output = on_v8(|| snapback.invoke_mutation("addItem", input(json!({"label": "after", "rank": 2}))))
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
