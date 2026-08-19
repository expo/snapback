//! ENG-23581 regression pin: the egress-action ambient surface.
//!
//! Egress actions (`SNAPBACK_OUTBOUND_ACTIONS=1`, kind=Action) keep the wide
//! compute-plus-fetch surface the all-aboard 511.org poller depends on. The
//! LLP 0048 data-driven denial applies to queries and mutations only; the
//! egress posture denies process/require/WebSocket, dynamic string compilation,
//! and WebAssembly. This suite runs in `cargo test` so a denial-list change
//! that breaks the egress surface fails CI instead of only the demo acceptance
//! suite nobody runs.
//!
//! The load-bearing subtlety this pins: Ibex installs `fetch`/`Headers`/
//! `Response` lazily as *configurable* properties, so the denial layer must
//! never pre-install a non-configurable stub in their slots — that made the
//! lazy installer itself throw ("property is not configurable").

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

const HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async egressSurfaceProbe(ctx) {
    function state(fn) {
      try {
        return fn() ? 'available' : 'unavailable';
      } catch (error) {
        var message = String(error && error.message || error);
        if (message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0) {
          return 'denied';
        }
        return 'error: ' + message;
      }
    }
    function dynamicState(fn) {
      try {
        fn();
        return 'available';
      } catch (_) {
        return 'blocked';
      }
    }
    return {
      fetchState: state(function () { return typeof fetch === 'function'; }),
      urlState: state(function () { return new URL('https://example.com/x').host === 'example.com'; }),
      cryptoState: state(function () { return typeof crypto === 'object' && crypto !== null; }),
      headersState: state(function () { return typeof Headers === 'function'; }),
      abortState: state(function () { return typeof AbortController === 'function' && new AbortController().signal != null; }),
      timerState: state(function () { return typeof setTimeout === 'function'; }),
      webSocketState: state(function () { WebSocket; return typeof WebSocket === 'function' && new WebSocket('wss://x') != null; }),
      webAssemblyState: state(function () { WebAssembly(); return true; }),
      directEvalState: dynamicState(function () { return eval('1'); }),
      indirectEvalState: dynamicState(function () { return (0, eval)('1'); }),
      functionState: dynamicState(function () { return Function('return 1')(); }),
      functionReturnThisState: dynamicState(function () { return Function('return this')(); }),
      functionWhitespaceState: dynamicState(function () { return Function('  return this;  ')(); }),
      constructorWalkState: dynamicState(function () { return ({}).constructor.constructor('return this')(); }),
      computedConstructorWalkState: dynamicState(function () {
        var name = ['con', 'structor'].join('');
        return ({})[name][name]('return this')();
      }),
      destructuredConstructorState: dynamicState(function () {
        var Ctor = (function () {
          var source = async function () {};
          var { constructor } = source;
          return constructor;
        })();
        return Ctor('return this')();
      }),
      reflectApplyState: dynamicState(function () { return Reflect.apply(Function, undefined, ['return this'])(); }),
      reflectConstructState: dynamicState(function () { return Reflect.construct(Function, ['return this'])(); }),
      asyncFunctionState: dynamicState(function () { return (async function () {}).constructor('return 1'); }),
      generatorFunctionState: dynamicState(function () { return (function* () {}).constructor('return 1'); }),
      authorityConstructorState: dynamicState(function () { return Function('ctx', 'return ctx.runMutation')(ctx); }),
      processState: typeof process === 'undefined' ? 'absent' : 'present',
      requireState: typeof require === 'undefined' ? 'absent' : 'present'
    };
  },

  async mutationFetchProbe(ctx) {
    var out;
    try {
      out = typeof fetch === 'function' ? (fetch('https://example.com'), 'callable') : 'unavailable';
    } catch (error) {
      var message = String(error && error.message || error);
      out = message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0 ? 'denied' : 'error: ' + message;
    }
    await ctx.db.insert('probes', { note: 'ran' });
    return { fetchState: out };
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("egress-ambient-v0".to_owned()),
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
                source: HANDLERS.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("egressSurfaceProbe", FunctionKind::Action),
            define("mutationFetchProbe", FunctionKind::Mutation),
        ],
        ..FunctionManifest::default()
    }
}

fn configured() -> LocalSnapback {
    // SAFETY: set before the first Ibex host/VM use in this test binary, and
    // every test in this file wants the same value.
    unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", "1") };
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback.apply_schema(schema()).expect("schema");
    snapback.load_functions(functions());
    snapback
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

fn run_action(snapback: &mut LocalSnapback, name: &str) -> Value {
    let run = snapback.run_function(name, input());
    assert!(run.ok, "{name} failed: {:?}", run.diagnostic);
    run.result.expect("action result")
}

#[test]
fn egress_action_keeps_the_wide_ambient_surface() {
    let mut snapback = configured();
    let probe = run_action(&mut snapback, "egressSurfaceProbe");
    assert_eq!(
        probe.get("fetchState"),
        Some(&json!("available")),
        "egress actions must see a callable fetch (lazy installer intact): {probe}"
    );
    for (key, expected) in [
        ("urlState", "available"),
        ("cryptoState", "available"),
        ("headersState", "available"),
        ("abortState", "available"),
        ("timerState", "available"),
        ("webSocketState", "denied"),
        ("webAssemblyState", "denied"),
        ("directEvalState", "blocked"),
        ("indirectEvalState", "blocked"),
        ("functionState", "blocked"),
        ("functionReturnThisState", "blocked"),
        ("functionWhitespaceState", "blocked"),
        ("constructorWalkState", "blocked"),
        ("computedConstructorWalkState", "blocked"),
        ("destructuredConstructorState", "blocked"),
        ("reflectApplyState", "blocked"),
        ("reflectConstructState", "blocked"),
        ("asyncFunctionState", "blocked"),
        ("generatorFunctionState", "blocked"),
        ("authorityConstructorState", "blocked"),
        ("processState", "absent"),
        ("requireState", "absent"),
    ] {
        assert_eq!(
            probe.get(key),
            Some(&json!(expected)),
            "egress ambient surface regressed at {key}: {probe}"
        );
    }
}

#[test]
fn mutations_still_deny_fetch_even_with_outbound_enabled() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("mutationFetchProbe", input())
        .expect("mutation runs");
    let probe = output.result;
    let state = probe
        .get("fetchState")
        .and_then(Value::as_str)
        .unwrap_or("");
    assert!(
        state == "denied" || state == "unavailable",
        "the transactional path must never get network, got {probe}"
    );
}
