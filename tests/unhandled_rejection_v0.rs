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
  // Generic web-event tracking inspects a private suppression symbol on the
  // reason. A hostile getter may throw there, but that independent consumer
  // must never suppress the authenticated Snapback ledger/rollback path.
  async hostileDetachedRejectionReason(ctx) {
    ctx.db.insert('items', { n: 907 });
    var reason = new Proxy({}, {
      get: function(target, key, receiver) {
        if (typeof key === 'symbol') throw new Error('hostile-reason-symbol-getter');
        return Reflect.get(target, key, receiver);
      }
    });
    Promise.reject(reason);
    return "must-not-succeed";
  },
  // Rejection enrollment must survive a throwing accessor on Hermes's public
  // pending-reaction bookkeeping. The captured reject may throw, but the
  // private generation still has to reach the downstream ledger.
  async throwingFinaleBookkeepingBypass(ctx) {
    ctx.db.insert('items', { n: 908 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    rejected.then(function() {}, function() {});
    var pendingKey = null;
    var pendingKeys = Object.keys(rejected);
    for (var i = 0; i < pendingKeys.length; i++) {
      if (rejected[pendingKeys[i]] === 1) pendingKey = pendingKeys[i];
    }
    if (pendingKey === null) throw new Error('pending bookkeeping key unavailable');
    Object.defineProperty(rejected, pendingKey, {
      configurable: true,
      get: function() { throw new Error('hostile-finale-bookkeeping'); }
    });
    try { rejectLater(new Error('throwing-finale-must-remain-visible')); }
    catch (_) {}
    return "must-not-succeed";
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
  // Promise adoption and every standard aggregate path ultimately attach
  // reactions inside Hermes rather than through the public `then` mediator.
  // Those native paths must produce the same execution proof as explicit
  // `.catch()` and `await`.
  async rejectionCaughtThroughAdoption(ctx) {
    var inner = Promise.reject(new Error("caught-through-adoption"));
    var outer = new Promise(function(resolve) { resolve(inner); });
    try { await outer; } catch (_) {}
    return "caught";
  },
  async detachedAdopterOfHandledRejection(ctx) {
    ctx.db.insert('items', { n: 905 });
    var inner = Promise.reject(new Error('detached-adopter-must-remain-visible'));
    await inner.catch(function() {});
    new Promise(function(resolve) { resolve(inner); });
    return "must-not-succeed";
  },
  async detachedThenChildAdoptsHandledRejection(ctx) {
    ctx.db.insert('items', { n: 906 });
    var inner = Promise.reject(new Error('detached-then-adopter-must-remain-visible'));
    await inner.catch(function() {});
    Promise.resolve().then(function() { return inner; });
    return "must-not-succeed";
  },
  async handledAdopterOfHandledRejection(ctx) {
    var inner = Promise.reject(new Error('handled-adopter'));
    await inner.catch(function() {});
    var outer = new Promise(function(resolve) { resolve(inner); });
    try { await outer; } catch (error) { return error.message; }
    return "unexpected";
  },
  async handledPromiseCombinators(ctx) {
    var handled = [];
    var allActual = new Error("all-private-reason");
    var allInput = Promise.reject(allActual);
    var allReasonKey = Object.keys(allInput).find(function(key) {
      return allInput[key] === allActual;
    });
    if (!allReasonKey) throw new Error("Promise.all reason key unavailable");
    allInput[allReasonKey] = new Error("forged-public-reason");
    try { await Promise.all([allInput]); }
    catch (error) {
      if (error !== allActual) throw new Error("Promise.all trusted public rejection state");
      handled.push("all");
    }
    try { await Promise.race([Promise.reject(new Error("race"))]); }
    catch (_) { handled.push("race"); }
    var settled = await Promise.allSettled([Promise.reject(new Error("allSettled"))]);
    if (settled[0] && settled[0].status === "rejected") handled.push("allSettled");
    try { await Promise.any([Promise.reject(new Error("any"))]); }
    catch (_) { handled.push("any"); }
    return handled.join(",");
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
    try {
      Function.prototype.call = function(receiver, onFulfilled, onRejected) {
        // The legacy Ibex rejection observer used this exact dynamic call
        // shape. Return normally without attaching its rejection callback,
        // while forwarding every other call so settlement can still report.
        if (arguments.length === 3 && onFulfilled === undefined &&
            typeof onRejected === "function") {
          return {};
        }
        return nativeApply(nativeCall, this, arguments);
      };
    } catch (_) {
      // The current harness seals Function.prototype.call. Keep the probe
      // running so the detached rejection still proves that failed poisoning
      // cannot blind the authenticated ledger.
    }
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
    // Pinned Hermes has a descriptor-free @@species path; its exact native
    // constructor is the default when the optional compatibility property is
    // absent.
    var Species = Promise[Symbol.species] || Promise;
    var speciesInstance = new Species(function(resolve) { resolve("species-probe"); });
    var candidates = [
      globalThis.__OriginalPromise,
      Promise.prototype.constructor,
      Promise[Symbol.species] || Promise,
      instance.constructor
    ];
    var NativePromise = Promise.prototype.constructor;
    var hookBDescriptor = Object.getOwnPropertyDescriptor(NativePromise, "_B");
    var hookCDescriptor = Object.getOwnPropertyDescriptor(NativePromise, "_C");
    var observerDescriptor = Object.getOwnPropertyDescriptor(
      NativePromise,
      "__ibexRegisterPromiseObserver"
    );
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
      publicAliasUsesSealedHooks:
        globalThis.__OriginalPromise._B === hookBDescriptor.value &&
        globalThis.__OriginalPromise._C === hookCDescriptor.value,
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
      observerRegistrarIsSealed:
        !!observerDescriptor && typeof observerDescriptor.value === "function" &&
        observerDescriptor.configurable === false && observerDescriptor.writable === false,
      observerRegistrarReplayRefused:
        !!observerDescriptor && observerDescriptor.value(function() {}, function() {}) === false,
      thenIsSealedMediator:
        !!thenDescriptor && typeof thenDescriptor.value === "function" &&
        thenDescriptor.configurable === false && thenDescriptor.writable === false
    }];
  },
  async cachedPrimitivePromiseProbe(ctx) {
    var values = [true, false, null, undefined, 0, ''];
    var labels = [];
    for (var i = 0; i < values.length; i++) {
      labels.push(await Promise.resolve(values[i]).then(function(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        return String(value);
      }));
    }
    return labels.join(',');
  },
  async catchFinallyCompatibilityProbe(ctx) {
    var finalized = 0;
    var result = await Promise.reject(new Error('caught-by-method'))
      .catch(function(error) { return error.message; })
      .finally(function() { finalized += 1; });
    return result + ':' + finalized;
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
  // Attaching a reaction is not itself proof that it can run. Hermes exposes
  // its Promise bookkeeping fields for compatibility; erase the pending
  // queue after attachment and ensure the rejection remains visible.
  async erasedPendingReactionProbe(ctx) {
    ctx.db.insert('items', { n: 939 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    rejected.then(undefined, function() {});
    Object.keys(rejected).forEach(function(key) { delete rejected[key]; });
    rejectLater(new Error("erased-reaction-must-remain-visible"));
    return {};
  },
  // A stale queued reaction must not clear a newer rejection generation on
  // the same mutable Promise object. Point the queued handler's child back at
  // its source so propagation re-rejects that source before completion.
  async staleReactionGenerationProbe(ctx) {
    ctx.db.insert('items', { n: 949 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    rejected.then();
    var deferred = null;
    Object.keys(rejected).forEach(function(key) {
      var candidate = rejected[key];
      if (candidate && typeof candidate === "object" &&
          Object.prototype.hasOwnProperty.call(candidate, "promise") &&
          Object.prototype.hasOwnProperty.call(candidate, "onRejected")) {
        deferred = candidate;
      }
    });
    if (!deferred) throw new Error("Promise reaction record unavailable");
    deferred.promise = rejected;
    rejectLater(new Error("newer-generation-must-remain-visible"));
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
  async pendingHandlerSnapshotMutationProbe(ctx) {
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    var child = rejected.then(null, function(error) { return error.message; });
    // The pending Handler is public compatibility state. Mutating its callback
    // and child after scheduling must not replace the closure-private snapshot
    // that Hermes authenticated at canonical `.then()` time.
    var handlerRecord = null;
    var recordKeys = Object.keys(rejected);
    for (var i = 0; i < recordKeys.length; i++) {
      var candidate = rejected[recordKeys[i]];
      if (candidate && typeof candidate === 'object') handlerRecord = candidate;
    }
    if (handlerRecord === null) throw new Error('Promise Handler record unavailable');
    handlerRecord.onRejected = function() { throw new Error('mutated-public-handler'); };
    handlerRecord.promise = rejected;
    rejectLater(new Error('private-handler-snapshot-wins'));
    return await child;
  },
  async crossPromiseHandlerTransplantProbe(ctx) {
    ctx.db.insert('items', { n: 935 });
    var rejectSource;
    var rejectTarget;
    var source = new Promise(function(_, reject) { rejectSource = reject; });
    var target = new Promise(function(_, reject) { rejectTarget = reject; });
    var sourceChild = source.then(null, function(error) { return error.message; });
    target.then(null, function() { return 'target-handler-must-not-be-discarded'; });

    function pendingHandlerSlot(promise) {
      var keys = Object.keys(promise);
      for (var i = 0; i < keys.length; i++) {
        var candidate = promise[keys[i]];
        if (
          candidate &&
          typeof candidate === 'object' &&
          Object.prototype.hasOwnProperty.call(candidate, 'onRejected') &&
          Object.prototype.hasOwnProperty.call(candidate, 'promise')
        ) {
          return keys[i];
        }
      }
      throw new Error('Promise Handler record unavailable');
    }

    var sourceSlot = pendingHandlerSlot(source);
    var targetSlot = pendingHandlerSlot(target);
    // Both records were created by canonical `.then()`, but only the target's
    // record may authenticate completion of the target rejection. Transplant
    // the source record through Hermes' public compatibility state.
    target[targetSlot] = source[sourceSlot];
    rejectTarget(new Error('cross-promise-handler-transplant-must-not-clear'));
    return await sourceChild;
  },
  async frozenPromiseBookkeepingBypass(ctx) {
    ctx.db.insert('items', { n: 936 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    // Hermes' compatibility fields are public and configurable. Freezing the
    // object makes the first strict-mode bookkeeping write throw; private
    // rejection enrollment must happen before that attacker-controlled edge.
    Object.freeze(rejected);
    try {
      rejectLater(new Error('frozen-public-bookkeeping-must-not-hide-rejection'));
    } catch (_) {}
    return {};
  },
  async inheritedHandlerAccessorBypass(ctx) {
    ctx.db.insert('items', { n: 937 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    Object.defineProperty(Object.prototype, 'onRejected', {
      configurable: true,
      get: function() { return function() { return 'inherited-handler-swallowed'; }; },
      set: function() {}
    });
    try {
      rejected.then();
    } finally {
      delete Object.prototype.onRejected;
    }
    rejectLater(new Error('inherited-handler-accessor-must-not-authenticate'));
    return {};
  },
  async preBindReactionReentrancyBypass(ctx) {
    ctx.db.insert('items', { n: 938 });
    var rejectTarget;
    var target = new Promise(function(_, reject) { rejectTarget = reject; });
    target.then(null, function() { return 'original-target-handler'; });
    var targetSlot = Object.keys(target).find(function(key) {
      var value = target[key];
      return value && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, 'onRejected')
        && Object.prototype.hasOwnProperty.call(value, 'promise');
    });
    if (!targetSlot) throw new Error('target Handler record unavailable');

    var source = new Promise(function() {});
    var capturedHandler = null;
    Object.defineProperty(Object.prototype, 'onFulfilled', {
      configurable: true,
      set: function() { capturedHandler = this; }
    });
    var fired = false;
    var zeroStateKeys = Object.keys(source).filter(function(key) { return source[key] === 0; });
    if (zeroStateKeys.length < 2) throw new Error('Promise zero-valued state keys unavailable');
    zeroStateKeys.forEach(function(key) {
      Object.defineProperty(source, key, {
        configurable: true,
        get: function() {
          if (!fired) {
            fired = true;
            if (capturedHandler === null) throw new Error('source Handler was not captured');
            target[targetSlot] = capturedHandler;
            rejectTarget(new Error('pre-bind-reentrancy-must-not-authenticate'));
          }
          return 0;
        },
        set: function() {}
      });
    });
    try {
      source.then(null, function() { return 'transplanted-handler-swallowed'; });
    } finally {
      delete Object.prototype.onFulfilled;
    }
    return {};
  },
  async directConstructorReinitializationBypass(ctx) {
    ctx.db.insert('items', { n: 939 });
    var rejectOriginal;
    var rejected = new Promise(function(_, reject) { rejectOriginal = reject; });
    rejectOriginal(new Error('original-generation-must-not-be-overwritten'));
    var NativePromise = Promise.prototype.constructor;
    var reinitialized = false;
    try {
      NativePromise.call(rejected, function(_, reject) {
        reject(new Error('decoy-reinitialized-generation'));
      });
      reinitialized = true;
    } catch (_) {}
    if (reinitialized) await rejected.catch(function() {});
    return {};
  },
  async fabricatedHandlerResettlementBypass(ctx) {
    ctx.db.insert('items', { n: 940 });
    function handlerSlot(promise) {
      var keys = Object.keys(promise);
      for (var i = 0; i < keys.length; i++) {
        var value = promise[keys[i]];
        if (
          value &&
          typeof value === 'object' &&
          Object.prototype.hasOwnProperty.call(value, 'onRejected') &&
          Object.prototype.hasOwnProperty.call(value, 'promise')
        ) return keys[i];
      }
      throw new Error('Promise Handler record unavailable');
    }

    var rejectChild;
    var child = new Promise(function(_, reject) { rejectChild = reject; });
    child.then();
    // Erase the genuine child reaction while retaining the generic wrapper's
    // handled assertion. Only execution-proven engine state may clear it.
    child[handlerSlot(child)] = null;

    var rejectSource;
    var source = new Promise(function(_, reject) { rejectSource = reject; });
    source.then(null, function() { return 'genuine-source-handler'; });
    source[handlerSlot(source)] = {
      onFulfilled: null,
      onRejected: null,
      promise: child
    };

    var decoy = new Error('fabricated-handler-decoy-generation');
    rejectSource(decoy);
    rejectChild(new Error('fabricated-handler-original-generation'));
    source.catch(function() {});
    await Promise.resolve();

    // On a vulnerable engine the fabricated record has re-rejected `child`
    // with the decoy through the internal settle primitive. Handle that decoy
    // to demonstrate that the original generation disappeared. The fixed
    // engine ignores the fake record, leaving the original unhandled.
    var decoyVisible = Object.keys(child).some(function(key) { return child[key] === decoy; });
    if (decoyVisible) await child.catch(function() {});
    return {};
  },
  // A Proxy can lie to Object.getPrototypeOf/getOwnPropertyDescriptor and then
  // return a different constructor when Hermes' original `then` reads it. The
  // engine observer must reject that receiver through its closure-private
  // Promise brand before safeThen can propagate a real rejection through
  // attacker-controlled no-op capabilities.
  async proxyReactionReceiverBypass(ctx) {
    ctx.db.insert('items', { n: 934 });
    var NativePromise = Promise.prototype.constructor;
    var rejected = NativePromise.reject(
      new Error('proxy-receiver-must-not-authenticate-completion')
    );
    function NoOpCapabilityConstructor(executor) {
      executor(function() {}, function() {});
      return {};
    }
    var receiver = new Proxy({}, {
      getPrototypeOf: function() { return NativePromise.prototype; },
      getOwnPropertyDescriptor: function(_target, key) {
        if (key === 'constructor') return undefined;
        return undefined;
      },
      get: function(_target, key) {
        if (key === 'constructor') return NoOpCapabilityConstructor;
        if (key === '_y') return 3;
        if (key === '_z') return rejected;
        return undefined;
      }
    });
    // Calling the polyfill constructor with attacker-selected `this` must not
    // enroll that object in the engine-private canonical-construction brand.
    try { NativePromise.call(receiver, function() {}); } catch (_) {}
    try { NativePromise.prototype.then.call(receiver); } catch (_) {}
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
            search_indexes: Vec::new(),
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
            define("hostileDetachedRejectionReason", FunctionKind::Mutation),
            define("throwingFinaleBookkeepingBypass", FunctionKind::Mutation),
            define("rejectionHandledLater", FunctionKind::Mutation),
            define("rejectionPreHandled", FunctionKind::Mutation),
            define("rejectionCaughtByNativeAwait", FunctionKind::Mutation),
            define("rejectionCaughtThroughAdoption", FunctionKind::Mutation),
            define("detachedAdopterOfHandledRejection", FunctionKind::Mutation),
            define(
                "detachedThenChildAdoptsHandledRejection",
                FunctionKind::Mutation,
            ),
            define("handledAdopterOfHandledRejection", FunctionKind::Mutation),
            define("handledPromiseCombinators", FunctionKind::Mutation),
            define("immediateRejectedReturn", FunctionKind::Mutation),
            define("immediateHostCallRejection", FunctionKind::Mutation),
            define("poisonedHostDiagnosticExtraction", FunctionKind::Mutation),
            define("functionCallPoisoningProbe", FunctionKind::Mutation),
            define("detachedRejectionQuery", FunctionKind::Query),
            define("detachedRejectionAction", FunctionKind::Action),
            define("rejectionHookSurfaceProbe", FunctionKind::Query),
            define("rejectionHookBypassProbe", FunctionKind::Mutation),
            define("erasedPendingReactionProbe", FunctionKind::Mutation),
            define("staleReactionGenerationProbe", FunctionKind::Mutation),
            define("rejectionHookConstructorPoison", FunctionKind::Mutation),
            define("nonThrowingConstructorBypass", FunctionKind::Mutation),
            define("noOpCapabilityConstructorBypass", FunctionKind::Mutation),
            define(
                "pendingHandlerSnapshotMutationProbe",
                FunctionKind::Mutation,
            ),
            define("crossPromiseHandlerTransplantProbe", FunctionKind::Mutation),
            define("frozenPromiseBookkeepingBypass", FunctionKind::Mutation),
            define("inheritedHandlerAccessorBypass", FunctionKind::Mutation),
            define("preBindReactionReentrancyBypass", FunctionKind::Mutation),
            define(
                "directConstructorReinitializationBypass",
                FunctionKind::Mutation,
            ),
            define(
                "fabricatedHandlerResettlementBypass",
                FunctionKind::Mutation,
            ),
            define("proxyReactionReceiverBypass", FunctionKind::Mutation),
            define("cachedPrimitivePromiseProbe", FunctionKind::Mutation),
            define("catchFinallyCompatibilityProbe", FunctionKind::Mutation),
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
fn generic_tracker_failure_cannot_suppress_authenticated_rejection_ledger() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("hostileDetachedRejectionReason", input(json!({})))
        .expect_err("a hostile generic-tracker reason must still fail the invocation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert!(
        items(&snapback).is_empty(),
        "a generic tracker exception must not commit buffered writes"
    );
}

#[test]
fn throwing_public_finale_bookkeeping_cannot_skip_rejection_enrollment() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("throwingFinaleBookkeepingBypass", input(json!({})))
        .expect_err("throwing public Promise bookkeeping must not skip enrollment");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["throwing-finale-must-remain-visible"])
    );
    assert!(
        items(&snapback).is_empty(),
        "throwing public Promise bookkeeping must not commit buffered writes"
    );
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
fn rejection_caught_through_promise_adoption_succeeds() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("rejectionCaughtThroughAdoption", input(json!({})))
        .expect("a rejection caught through promise adoption is handled");
    assert_eq!(output.result, json!("caught"));
}

#[test]
fn detached_adopter_gets_its_own_rejection_generation() {
    let mut snapback = configured();
    for (name, reason) in [
        (
            "detachedAdopterOfHandledRejection",
            "detached-adopter-must-remain-visible",
        ),
        (
            "detachedThenChildAdoptsHandledRejection",
            "detached-then-adopter-must-remain-visible",
        ),
    ] {
        let error = snapback
            .invoke_mutation(name, input(json!({})))
            .expect_err("a detached adopter must remain independently unhandled");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        );
        assert_eq!(error.diagnostic.details["rejections"], json!([reason]));
        assert!(
            items(&snapback).is_empty(),
            "a detached adopter must roll back buffered writes"
        );
    }
}

#[test]
fn handled_adopter_clears_its_own_rejection_generation() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("handledAdopterOfHandledRejection", input(json!({})))
        .expect("an explicitly handled adopter must succeed");
    assert_eq!(output.result, json!("handled-adopter"));
}

#[test]
fn standard_promise_combinators_produce_reaction_completion_proof() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("handledPromiseCombinators", input(json!({})))
        .expect("handled aggregate rejections must not remain in the ledger");
    assert_eq!(output.result, json!("all,race,allSettled,any"));
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
            "publicAliasUsesSealedHooks": true,
            "nativeConstructorPathsAgree": true,
            "speciesResultUsesNativeConstructor": true,
            "functionCallIsSealed": true,
            "hookBIsSealedMediator": true,
            "hookCIsSealedMediator": true,
            "observerRegistrarIsSealed": true,
            "observerRegistrarReplayRefused": true,
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
fn erased_pending_reaction_does_not_count_as_handled() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("erasedPendingReactionProbe", input(json!({})))
        .expect_err("a reaction erased before dispatch must not clear its rejection");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["erased-reaction-must-remain-visible"])
    );
    assert!(items(&snapback).is_empty());
}

#[test]
fn stale_reaction_cannot_clear_a_newer_rejection_generation() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("staleReactionGenerationProbe", input(json!({})))
        .expect_err("an old completion must not clear a new rejection generation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["newer-generation-must-remain-visible"])
    );
    assert!(items(&snapback).is_empty());
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
fn cached_primitive_promises_remain_compatible_after_observer_registration() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("cachedPrimitivePromiseProbe", input(json!({})))
        .expect("Hermes cached primitive promises must retain their native brand");
    assert_eq!(output.result, json!("true,false,null,undefined,0,"));
}

#[test]
fn sealed_promise_tracker_preserves_catch_and_finally() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("catchFinallyCompatibilityProbe", input(json!({})))
        .expect("the sealed generic then wrapper must remain compatible with catch/finally");
    assert_eq!(output.result, json!("caught-by-method:1"));
}

#[test]
fn exact_promise_reaction_snapshot_is_not_mutable_handler_state() {
    let mut snapback = configured();
    let output = snapback
        .invoke_mutation("pendingHandlerSnapshotMutationProbe", input(json!({})))
        .expect("pending Handler mutation must not replace the private snapshot");
    assert_eq!(output.result, json!("private-handler-snapshot-wins"));
}

#[test]
fn exact_promise_reaction_authentication_is_bound_to_its_source_promise() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("crossPromiseHandlerTransplantProbe", input(json!({})))
        .expect_err(
            "a reaction transplanted from another Promise must not authenticate completion",
        );
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["cross-promise-handler-transplant-must-not-clear"])
    );
    assert!(
        items(&snapback).is_empty(),
        "the transplanted reaction must not allow the mutation to commit"
    );
}

#[test]
fn private_rejection_enrollment_precedes_mutable_public_bookkeeping() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("frozenPromiseBookkeepingBypass", input(json!({})))
        .expect_err("frozen public Promise fields must not suppress private enrollment");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["frozen-public-bookkeeping-must-not-hide-rejection"])
    );
    assert!(
        items(&snapback).is_empty(),
        "frozen public bookkeeping must not allow the mutation to commit"
    );
}

#[test]
fn private_reaction_snapshot_does_not_read_inherited_handler_accessors() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("inheritedHandlerAccessorBypass", input(json!({})))
        .expect_err("an inherited Handler accessor must not inject an authenticated callback");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["inherited-handler-accessor-must-not-authenticate"])
    );
    assert!(
        items(&snapback).is_empty(),
        "an inherited Handler accessor must not allow the mutation to commit"
    );
}

#[test]
fn reaction_source_binding_cannot_be_stolen_by_pre_bind_reentrancy() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("preBindReactionReentrancyBypass", input(json!({})))
        .expect_err("reentrant Handler transplantation must not steal source authentication");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["pre-bind-reentrancy-must-not-authenticate"])
    );
    assert!(
        items(&snapback).is_empty(),
        "pre-bind reentrancy must not allow the mutation to commit"
    );
}

#[test]
fn branded_promises_cannot_be_reinitialized_by_direct_constructor_call() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("directConstructorReinitializationBypass", input(json!({})))
        .expect_err("direct constructor reentry must not overwrite a live rejection generation");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["original-generation-must-not-be-overwritten"])
    );
    assert!(
        items(&snapback).is_empty(),
        "constructor reentry must not allow the mutation to commit"
    );
}

#[test]
fn fabricated_public_handlers_cannot_resettle_branded_children() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("fabricatedHandlerResettlementBypass", input(json!({})))
        .expect_err("an unauthenticated public Handler must not invoke internal settlement");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["fabricated-handler-original-generation"])
    );
    assert!(
        items(&snapback).is_empty(),
        "a fabricated Handler must not allow the mutation to commit"
    );
}

#[test]
fn exact_promise_reaction_gate_rejects_proxy_spoofed_receivers() {
    let mut snapback = configured();
    let error = snapback
        .invoke_mutation("proxyReactionReceiverBypass", input(json!({})))
        .expect_err("a Proxy receiver must not authenticate Promise reaction completion");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
    );
    assert_eq!(
        error.diagnostic.details["rejections"],
        json!(["proxy-receiver-must-not-authenticate-completion"])
    );
    assert!(
        items(&snapback).is_empty(),
        "a Proxy-spoofed receiver must not commit buffered writes"
    );
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
