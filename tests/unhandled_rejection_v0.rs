//! ENG-23361: unhandled rejections of detached promise chains must fail the
//! invocation instead of committing partial work as success. The only promise
//! the host observes is the invoke IIFE's own; a detached chain the handler
//! spawned (`forEach(async ...)` is the classic shape) executes during the
//! microtask drain — its earlier `ctx.db.*` writes land in the commit buffer,
//! its later ones are silently skipped when it rejects — and nothing reported
//! the rejection. These tests pin the fix: the ctx bootstrap's rejection
//! ledger plus the host's post-eval sweep turn that into
//! `SNAPBACK_HANDLER_UNHANDLED_REJECTION` with nothing committed, while
//! rejections handled anywhere before completion still succeed.

use serde_json::{Value, json};
use snapback::cron::CronRunOutcome;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, CronActivationPolicy, CronJitterPolicy, CronJobDefinition, CronOverlapPolicy,
    CronRetryMode, CronRetryPolicy, CronSchedule, FieldManifest, FieldType, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, IbexModule, SchemaManifest,
    TableManifest,
};

/// One module holding every handler these tests need; sharing one source also
/// exercises warm-pool check-in/reset behavior after a swept invocation.
const REJECTION_MODULE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  // The exact ENG-23361 failure scenario: detached async callbacks. The
  // callback for a bad item throws before its insert; the callbacks for good
  // items insert. Before the fix this returned "ok" and committed the good
  // items' writes — partial work reported as success.
  async forEachInsert(ctx, args) {
    args.items.forEach(async function(item) {
      if (item.bad) { throw new Error("validation failed: " + item.n); }
      ctx.db.insert('items', { n: item.n });
    });
    return "ok";
  },
  // The recommended shape for the same work: the handler awaits the fan-out,
  // so a rejection propagates and fails the invocation as the handler's own
  // error (not via the ledger).
  async awaitedParallelInsert(ctx, args) {
    await Promise.all(args.items.map(async function(item) {
      if (item.bad) { throw new Error("validation failed: " + item.n); }
      ctx.db.insert('items', { n: item.n });
    }));
    return "ok";
  },
  // Rejects several microtask hops deep, after the invocation promise has
  // already settled — only a post-drain host-side sweep can see this one.
  async deepDetachedRejection(ctx) {
    Promise.resolve().then(function() {}).then(function() {}).then(function() {})
      .then(function() { throw new Error("deep-boom"); });
    return "ok";
  },
  // A rejection that is handled later in the same drain must not trip the
  // sweep: the ledger entry is cleared when the handler attaches.
  async rejectionHandledLater(ctx) {
    var rejected = Promise.reject(new Error("caught-later"));
    Promise.resolve().then(function() { rejected.catch(function() {}); });
    await Promise.resolve();
    await Promise.resolve();
    return "ok";
  },
  // A handler attached before completion and dispatched during finale must
  // clear its entry too.
  async rejectionPreHandled(ctx) {
    var value = await Promise.reject(new Error("caught")).catch(function() { return "caught"; });
    return value;
  },
  async rejectionCaughtByNativeAwait(ctx) {
    try {
      await Promise.reject(new Error("caught-by-native-await"));
    } catch (_) {}
    return "caught";
  },
  // This promise is already rejected when the async handler returns control.
  // It is the handler's own failure, not a detached rejection; Linux Hermes
  // can notify its rejection hook before a native await records its reaction.
  async immediateRejectedReturn(ctx) {
    throw new Error("immediate-handler-rejection");
  },
  // A synchronous Ibex host error thrown underneath `return await` becomes a
  // rejected async-handler promise. Both harness-owned observation promises
  // must be marked handled without hiding the typed host diagnostic.
  async immediateHostCallRejection(ctx) {
    return await ctx.db.insert('items');
  },
  async poisonedHostDiagnosticExtraction(ctx, args) {
    if (args.poison === 'defineProperty') {
      Object.defineProperty = function() {};
    } else {
      String.prototype.match = function() {
        return ['', 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'];
      };
    }
    return await ctx.db.insert('items');
  },
  async functionCallPoisoningProbe(ctx) {
    ctx.db.insert('items', { n: 909 });
    var nativeCall = Function.prototype.call;
    var nativeApply = Reflect.apply;
    Function.prototype.call = function(receiver, onFulfilled, onRejected) {
      // The Ibex rejection observer used this exact dynamic call shape. Return
      // normally without attaching its rejection callback, while forwarding
      // every other call so handler settlement can still report success.
      if (arguments.length === 3 && onFulfilled === undefined &&
          typeof onRejected === "function") {
        return {};
      }
      return nativeApply(nativeCall, this, arguments);
    };
    Promise.reject(new Error("call-poison-detached-rejection"));
    return "must-not-succeed";
  },
  async detachedRejectionQuery(ctx) {
    Promise.resolve().then(function() { throw new Error("query-boom"); });
    return [];
  },
  async detachedRejectionAction(ctx) {
    Promise.resolve().then(function() { throw new Error("action-boom"); });
    return {};
  },
  async rejectionHookSurfaceProbe(ctx) {
    var instance = Promise.resolve("surface-probe");
    var Species = Promise[Symbol.species];
    var speciesInstance = new Species(function(resolve) { resolve("species-probe"); });
    var candidates = [
      globalThis.__OriginalPromise,
      Promise.prototype.constructor,
      Promise[Symbol.species],
      instance.constructor
    ];
    var NativePromise = Promise.prototype.constructor;
    var hookBDescriptor = Object.getOwnPropertyDescriptor(NativePromise, "_B");
    var hookCDescriptor = Object.getOwnPropertyDescriptor(NativePromise, "_C");
    var thenDescriptor = Object.getOwnPropertyDescriptor(NativePromise.prototype, "then");
    var functionCallDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "call");
    var nativeConstructorPathsAgree = true;
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (i > 0) nativeConstructorPathsAgree =
        nativeConstructorPathsAgree && candidate === NativePromise;
    }
    return [{
      originalAliasIsPublic: globalThis.__OriginalPromise === Promise,
      publicAliasIsHookFree:
        typeof globalThis.__OriginalPromise._B !== "function" &&
        typeof globalThis.__OriginalPromise._C !== "function",
      nativeConstructorPathsAgree: nativeConstructorPathsAgree,
      speciesResultUsesNativeConstructor: speciesInstance.constructor === NativePromise,
      functionCallIsSealed:
        !!functionCallDescriptor && typeof functionCallDescriptor.value === "function" &&
        functionCallDescriptor.configurable === false && functionCallDescriptor.writable === false,
      hookBIsSealedMediator:
        !!hookBDescriptor && typeof hookBDescriptor.value === "function" &&
        hookBDescriptor.configurable === false && hookBDescriptor.writable === false,
      hookCIsSealedMediator:
        !!hookCDescriptor && typeof hookCDescriptor.value === "function" &&
        hookCDescriptor.configurable === false && hookCDescriptor.writable === false,
      thenIsSealedMediator:
        !!thenDescriptor && typeof thenDescriptor.value === "function" &&
        thenDescriptor.configurable === false && thenDescriptor.writable === false
    }];
  },
  async rejectionHookBypassProbe(ctx) {
    var rejected = Promise.reject(new Error("hook-bypass-must-remain-visible"));
    var candidates = [
      globalThis.__OriginalPromise,
      Promise.prototype.constructor,
      Promise[Symbol.species],
      rejected.constructor
    ];
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (candidate && typeof candidate._C === "function") {
        candidate._C(rejected, new Error("forged-hook-rejection"));
      }
      if (candidate && typeof candidate._B === "function") {
        candidate._B(rejected);
      }
    }
    return {};
  },
  async rejectionHookConstructorPoison(ctx) {
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    Object.defineProperty(rejected, "constructor", {
      configurable: false,
      get: function() { throw new Error("poisoned promise constructor"); }
    });
    rejectLater(new Error("constructor-poison-must-remain-visible"));
    var NativePromise = Promise.prototype.constructor;
    NativePromise._C(rejected, new Error("forged-after-constructor-poison"));
    NativePromise._B(rejected);
    return {};
  },
  async nonThrowingConstructorBypass(ctx) {
    ctx.db.insert('items', { n: 919 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    var NativePromise = Promise.prototype.constructor;
    function IgnoringPromiseConstructor() {
      return NativePromise.resolve('already-fulfilled-decoy-child');
    }
    Object.defineProperty(IgnoringPromiseConstructor, Symbol.species, {
      configurable: false,
      value: IgnoringPromiseConstructor
    });
    Object.defineProperty(rejected, "constructor", {
      configurable: false,
      writable: false,
      value: IgnoringPromiseConstructor
    });
    // A normal return from native `then` is not proof that its executor ran or
    // that a reaction attached. The decoy is itself a genuine Promise, so a
    // child-type check would not make that inference sound either.
    try { rejected.then(undefined, function() {}); } catch (_) {}
    rejectLater(new Error("nonthrowing-constructor-must-remain-visible"));
    return {};
  },
  async noOpCapabilityConstructorBypass(ctx, args) {
    ctx.db.insert('items', { n: 929 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    function NoOpCapabilityConstructor(executor) {
      executor(function() {}, function() {});
      return {};
    }
    Object.defineProperty(NoOpCapabilityConstructor, Symbol.species, {
      configurable: false,
      value: NoOpCapabilityConstructor
    });
    if (args.path === 'inherited') {
      var hostilePrototype = Object.create(Promise.prototype);
      Object.defineProperty(hostilePrototype, "constructor", {
        configurable: false,
        writable: false,
        value: NoOpCapabilityConstructor
      });
      Object.setPrototypeOf(rejected, hostilePrototype);
    } else {
      Object.defineProperty(rejected, "constructor", {
        configurable: false,
        writable: false,
        value: NoOpCapabilityConstructor
      });
    }
    rejectLater(new Error("no-op-child-capability-must-remain-visible"));
    // With no rejection callback, native semantics propagate the reason to a
    // child. A hostile constructor must not replace that child's reject
    // capability with a no-op and make the source look safely handled.
    try { rejected.then(); } catch (_) {}
    return {};
  },
  async insertOne(ctx, args) {
    await ctx.db.insert('items', { n: args.n });
    return {};
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('_createdAt', 'asc').collect();
  }
};
"#;

fn schema() -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("unhandled-rejection-v0".to_owned()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "n".to_owned(),
                field_type: FieldType::Integer,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
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
                source: REJECTION_MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    FunctionManifest {
        functions: vec![
            define("forEachInsert", FunctionKind::Mutation),
            define("awaitedParallelInsert", FunctionKind::Mutation),
            define("deepDetachedRejection", FunctionKind::Mutation),
            define("rejectionHandledLater", FunctionKind::Mutation),
            define("rejectionPreHandled", FunctionKind::Mutation),
            define("rejectionCaughtByNativeAwait", FunctionKind::Mutation),
            define("immediateRejectedReturn", FunctionKind::Mutation),
            define("immediateHostCallRejection", FunctionKind::Mutation),
            define("poisonedHostDiagnosticExtraction", FunctionKind::Mutation),
            define("functionCallPoisoningProbe", FunctionKind::Mutation),
            define("detachedRejectionQuery", FunctionKind::Query),
            define("detachedRejectionAction", FunctionKind::Action),
            define("rejectionHookSurfaceProbe", FunctionKind::Query),
            define("rejectionHookBypassProbe", FunctionKind::Mutation),
            define("rejectionHookConstructorPoison", FunctionKind::Mutation),
            define("nonThrowingConstructorBypass", FunctionKind::Mutation),
            define("noOpCapabilityConstructorBypass", FunctionKind::Mutation),
            define("insertOne", FunctionKind::Mutation),
            define("listItems", FunctionKind::Query),
        ],
        cron_jobs: vec![CronJobDefinition {
            name: "detachedRejection".to_owned(),
            schedule: CronSchedule {
                every_ms: Some(60_000),
                cron: None,
            },
            action: "detachedRejectionAction".to_owned(),
            enabled: true,
            activation: CronActivationPolicy::default(),
            jitter_policy: CronJitterPolicy {
                enabled: false,
                max_offset_ms: 0,
            },
            overlap_policy: CronOverlapPolicy::NoOverlap,
            retry_policy: CronRetryPolicy {
                mode: CronRetryMode::NextTick,
            },
            required_capabilities: vec!["cron".to_owned()],
            target_wakeup: None,
            source_span: None,
        }],
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

fn items(snapback: &LocalSnapback) -> Vec<Value> {
    snapback
        .invoke_query("listItems", input(json!({})))
        .expect("listItems")
        .rows
}

fn mixed_items() -> Value {
    json!({ "items": [ { "n": 1 }, { "n": 2, "bad": true }, { "n": 3 } ] })
}

#[test]
fn foreach_async_rejection_fails_and_commits_nothing() {
    // The ENG-23361 repro: before the fix this returned "ok" and committed
    // items 1 and 3 — partial work, no error, no log.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("forEachInsert", input(mixed_items()))
        .expect_err("a detached rejection must fail the mutation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["validation failed: 2"]),
        "the diagnostic must carry the swallowed rejection reason"
    );
    assert!(
        items(&snapback).is_empty(),
        "the good items' buffered writes must not commit as partial work"
    );
}

#[test]
fn foreach_async_without_failures_still_succeeds() {
    // Positive control: detached chains that all resolve leave no ledger
    // entries, and their writes commit as before.
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation(
            "forEachInsert",
            input(json!({ "items": [ { "n": 1 }, { "n": 2 } ] })),
        )
        .expect("all-good forEach mutation");
    assert_eq!(output.result, json!("ok"));
    assert_eq!(items(&snapback).len(), 2);
}

#[test]
fn awaited_parallel_rejection_is_the_handlers_own_error() {
    // The recommended fix pattern fails as a plain handler error — the
    // rejection is handled (by Promise.all and the await), so the ledger
    // stays out of it — and still commits nothing.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("awaitedParallelInsert", input(mixed_items()))
        .expect_err("awaited rejection must fail the mutation");
    assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
    assert!(items(&snapback).is_empty());
}

#[test]
fn rejection_after_settlement_is_still_caught() {
    // The chain rejects microtask hops after the invocation promise settled;
    // only the post-drain host-side sweep can observe it.
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("deepDetachedRejection", input(json!({})))
        .expect_err("a post-settlement detached rejection must fail the mutation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(error.diagnostic.details["rejections"], json!(["deep-boom"]));
}

#[test]
fn rejection_handled_later_in_the_drain_succeeds() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("rejectionHandledLater", input(json!({})))
        .expect("a rejection handled before completion is not unhandled");
    assert_eq!(output.result, json!("ok"));
}

#[test]
fn rejection_with_pre_attached_handler_succeeds() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("rejectionPreHandled", input(json!({})))
        .expect("a caught rejection is not unhandled");
    assert_eq!(output.result, json!("caught"));
}

#[test]
fn rejection_caught_by_native_await_succeeds() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("rejectionCaughtByNativeAwait", input(json!({})))
        .expect("a rejection caught by native await is handled");
    assert_eq!(output.result, json!("caught"));
}

#[test]
fn harness_observes_an_immediately_rejected_handler_promise() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("immediateRejectedReturn", input(json!({})))
        .expect_err("the handler's returned rejection must fail the invocation");
    assert_eq!(
        error.diagnostic.code, "SNAPBACK_HANDLER_FAILED",
        "the harness's own reaction must keep this out of the detached-rejection ledger"
    );
    assert_eq!(
        error.diagnostic.details["message"],
        "immediate-handler-rejection"
    );
}

#[test]
fn harness_preserves_an_immediate_typed_host_rejection() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("immediateHostCallRejection", input(json!({})))
        .expect_err("the malformed host call must fail the invocation");
    assert_eq!(
        error.diagnostic.code, "SNAPBACK_HANDLER_HOST_CALL_INVALID",
        "the harness's propagated observation promise must not masquerade as detached work"
    );
    assert!(
        items(&snapback).is_empty(),
        "the rejected invocation must commit nothing"
    );
}

#[test]
fn hostile_intrinsics_cannot_erase_or_forge_a_typed_host_rejection() {
    for poison in ["defineProperty", "stringMatch"] {
        let mut snapback = configured();
        let error = snapback
            .invoke_mutation(
                "poisonedHostDiagnosticExtraction",
                input(json!({ "poison": poison })),
            )
            .expect_err("the malformed host call must fail the invocation");
        assert_eq!(
            error.diagnostic.code, "SNAPBACK_HANDLER_HOST_CALL_INVALID",
            "{poison}: application intrinsics must not control host diagnostic branding"
        );
        assert!(
            items(&snapback).is_empty(),
            "{poison}: the rejected invocation must commit nothing"
        );
    }
}

#[test]
fn function_call_poisoning_cannot_blind_the_detached_rejection_ledger() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("functionCallPoisoningProbe", input(json!({})))
        .expect_err("a detached rejection must survive Function.prototype.call poisoning");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["call-poison-detached-rejection"])
    );
    let rows = snapback
        .invoke_query("listItems", input(json!({})))
        .expect("query after poisoned invocation")
        .rows;
    assert!(
        rows.is_empty(),
        "the rejected invocation must commit nothing"
    );
}

#[test]
fn detached_rejection_fails_queries_too() {
    let snapback = configured();
    let error = snapback
        .invoke_query("detachedRejectionQuery", input(json!({})))
        .expect_err("a detached rejection must fail the query");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
}

#[test]
fn detached_rejection_fails_actions_too() {
    // Actions never pool (fresh-VM path), so this pins the sweep on the
    // fresh path as well as the warm one.
    let mut snapback = configured();
    let record = snapback
        .run_cron_job_now("detachedRejection", 1_000)
        .expect("run cron job");
    assert_eq!(record.outcome, CronRunOutcome::Failed);
    let diagnostic = record.diagnostic.expect("failed run carries a diagnostic");
    assert_eq!(diagnostic.code, "SNAPBACK_HANDLER_UNHANDLED_REJECTION");
}

#[test]
fn exact_promise_rejection_hooks_are_sealed_mediators() {
    let snapback = configured();
    let rows = snapback
        .invoke_query("rejectionHookSurfaceProbe", input(json!({})))
        .expect("rejection hook surface probe")
        .rows;
    assert_eq!(
        rows,
        vec![json!({
            "originalAliasIsPublic": true,
            "publicAliasIsHookFree": true,
            "nativeConstructorPathsAgree": true,
            "speciesResultUsesNativeConstructor": true,
            "functionCallIsSealed": true,
            "hookBIsSealedMediator": true,
            "hookCIsSealedMediator": true,
            "thenIsSealedMediator": true,
        })],
        "every native constructor path must terminate at the same sealed rejection-hook mediators"
    );
}

#[test]
fn exact_promise_rejection_hooks_cannot_clear_the_ledger() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("rejectionHookBypassProbe", input(json!({})))
        .expect_err("handler code must not be able to call _B/_C and hide its rejection");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["hook-bypass-must-remain-visible"]),
        "the handler must neither forge the rejection reason through _C nor delete it through _B"
    );
}

#[test]
fn exact_promise_rejection_hook_fails_closed_on_constructor_poisoning() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("rejectionHookConstructorPoison", input(json!({})))
        .expect_err("a poisoned promise constructor must not blind rejection detection");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["constructor-poison-must-remain-visible"])
    );
}

#[test]
fn exact_promise_rejection_hook_fails_closed_when_constructor_returns_without_attaching() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("nonThrowingConstructorBypass", input(json!({})))
        .expect_err("a constructor that ignores its executor must not blind rejection detection");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["nonthrowing-constructor-must-remain-visible"])
    );
    assert!(
        items(&snapback).is_empty(),
        "constructor poisoning must not commit buffered writes"
    );
}

#[test]
fn exact_promise_reaction_gate_rejects_no_op_child_capabilities() {
    for path in ["own", "inherited"] {
        let mut snapback = configured();
        let error = snapback
            .invoke_mutation(
                "noOpCapabilityConstructorBypass",
                input(json!({ "path": path })),
            )
            .expect_err("a constructor must not replace the propagated child's reject capability");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        );
        assert_eq!(
            error.diagnostic.details["rejections"],
            json!(["no-op-child-capability-must-remain-visible"]),
            "{path}: the original rejection must remain visible"
        );
        assert!(
            items(&snapback).is_empty(),
            "{path}: no-op child capabilities must not commit buffered writes"
        );
    }
}

#[test]
fn pool_stays_healthy_and_ledger_does_not_leak_across_invocations() {
    // The sweep drains the ledger and the VM is checked back in, so a failed
    // invocation must not poison the next one on the same warm VM.
    let mut snapback = configured();
    for _ in 0..2 {
        let error = snapback
            .invoke_mutation("forEachInsert", input(mixed_items()))
            .expect_err("detached rejection");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        );
    }
    let output = snapback
        .invoke_mutation("insertOne", input(json!({ "n": 7 })))
        .expect("mutation after swept invocations");
    assert_eq!(output.result, json!({}));
    let rows = items(&snapback);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["n"], json!(7));
}
