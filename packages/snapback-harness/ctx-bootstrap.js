(function(g) {
  // Capture every intrinsic used by the settlement/rejection control plane
  // before application source evaluates. Handler code is allowed to mutate
  // its own global object; those mutations must not be able to rewrite the
  // host's success/failure envelope or blind rejection detection.
  var TrustedError = Error;
  var TrustedFunction = Function;
  var TrustedArray = Array;
  var TrustedMap = Map;
  var TrustedWeakMap = WeakMap;
  var TrustedPromise = Promise;
  var TrustedUint8Array = Uint8Array;
  var trustedAsyncIterator = typeof Symbol === "function" ? Symbol.asyncIterator : null;
  var trustedString = String;
  var trustedJsonParse = JSON.parse;
  var trustedJsonStringify = JSON.stringify;
  var trustedCreate = Object.create;
  var trustedDefineProperty = Object.defineProperty;
  var trustedSetPrototypeOf = Object.setPrototypeOf;
  var trustedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var trustedGetPrototypeOf = Object.getPrototypeOf;
  var trustedHasOwnProperty = Object.prototype.hasOwnProperty;
  var trustedFreeze = Object.freeze;
  var trustedFunctionPrototype = TrustedFunction && TrustedFunction.prototype;
  var trustedFunctionCall = trustedFunctionPrototype && trustedFunctionPrototype.call;
  var trustedReflectApply = Reflect.apply;
  var trustedReflectConstruct = Reflect.construct;
  var trustedMapSet = TrustedMap && TrustedMap.prototype.set;
  var trustedMapGet = TrustedMap && TrustedMap.prototype.get;
  var trustedMapDelete = TrustedMap && TrustedMap.prototype.delete;
  var trustedMapForEach = TrustedMap && TrustedMap.prototype.forEach;
  var trustedWeakMapSet = TrustedWeakMap && TrustedWeakMap.prototype.set;
  var trustedWeakMapGet = TrustedWeakMap && TrustedWeakMap.prototype.get;
  var trustedWeakMapDelete = TrustedWeakMap && TrustedWeakMap.prototype.delete;
  var trustedPromiseResolve = TrustedPromise && TrustedPromise.resolve;
  var trustedPromiseThen = TrustedPromise && TrustedPromise.prototype.then;
  var trustedRegExpExec = RegExp.prototype.exec;
  var snapbackCodePattern = /^(?:Error:\s*)?(SNAPBACK_[A-Z0-9_]+)(?::|\b)/;
  var snapbackErrorClassPattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
  var harnessPromiseThen = trustedPromiseThen;
  var trustedArrayJoin = Array.prototype.join;
  var trustedArraySlice = Array.prototype.slice;
  var trustedArrayConcat = Array.prototype.concat;
  var trustedObjectKeys = Object.keys;
  var trustedReflectDeleteProperty = Reflect.deleteProperty;
  var trustedStringCharCodeAt = String.prototype.charCodeAt;
  var trustedStringCharAt = String.prototype.charAt;
  function nullPrototypeArray() {
    var array = trustedReflectConstruct(TrustedArray, []);
    trustedReflectApply(trustedSetPrototypeOf, null, [array, null]);
    return array;
  }
  function defineArrayEntry(array, index, value) {
    trustedDefineProperty(array, trustedString(index), {
      value: value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  function snapbackError(code, message) {
    var error = new TrustedError(code + ": " + message);
    try { trustedDefineProperty(error, "__snapbackCode", { value: code }); } catch (_) { error.__snapbackCode = code; }
    return error;
  }
  function codeFromMessage(message) {
    if (typeof message !== "string") return null;
    try {
      var match = trustedReflectApply(trustedRegExpExec, snapbackCodePattern, [message]);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }
  // @ref LLP 0009#harness-control-plane-boundary — only a getter-free native
  // constructor path may create a child capability the rejection floor trusts.
  function promiseReactionPathIsCanonical(promise, constructor, prototype) {
    if (!promise || (typeof promise !== "object" && typeof promise !== "function")) return false;
    try {
      if (trustedReflectApply(trustedGetPrototypeOf, undefined, [promise]) !== prototype) {
        return false;
      }
      var ownConstructor = trustedGetOwnPropertyDescriptor(promise, "constructor");
      return !ownConstructor ||
        (trustedReflectApply(trustedHasOwnProperty, ownConstructor, ["value"]) &&
          ownConstructor.value === constructor);
    } catch (_) {
      return false;
    }
  }
  function failUnsafePromiseReaction() {
    throw new TrustedError("Promise reaction receiver has a non-canonical constructor path");
  }
  // Normalize every promise the harness itself awaits through captured
  // intrinsics, then attach a real reaction before the await. Hermes builds
  // differ on whether an immediately rejected async result reaches the
  // rejection hook before a native `await` records its internal reaction. The
  // Hermes branch below swaps in the sealed mediator, making the harness-owned
  // reaction explicit and portable without trusting the reachable `_B` hook.
  // @ref LLP 0009#harness-control-plane-boundary — harness-owned promise
  // observations cross the sealed mediator before native settlement awaits.
  function observeHarnessPromise(value) {
    var promise = trustedReflectApply(trustedPromiseResolve, TrustedPromise, [value]);
    var observed = trustedReflectApply(harnessPromiseThen, promise, [
      function(resolved) { return resolved; },
      function(error) { throw error; }
    ]);
    // The propagating reaction above creates its own child promise. Linux
    // Hermes can report that child's rejection before native `await` records
    // its internal reaction, so mark the child handled through the same sealed
    // mediator. Both callbacks return undefined, which guarantees that the
    // ignored guard promise fulfills; `observed` still carries the exact value
    // or rejection to native `await`. Application-detached promises never
    // cross this helper and remain visible to the rejection ledger.
    trustedReflectApply(harnessPromiseThen, observed, [
      function() { return undefined; },
      function() { return undefined; }
    ]);
    return observed;
  }
  function literal(value) { return { Literal: value }; }
  var QUERY_MAX_LIMIT = 1024;
  var QUERY_MAX_IN_ITEMS = 500;
  var QUERY_MAX_FILTER_BINDINGS = 500;
  var BATCH_READ_MAX_ITEMS = 256;
  function normalizeDirection(direction) {
    return String(direction || "asc").toLowerCase() === "desc" ? "Desc" : "Asc";
  }
  function readonlyDenied(op) {
    return function() { throw snapbackError("SNAPBACK_HANDLER_WRITE_IN_QUERY", op); };
  }
  // @ref LLP 0009#harness-control-plane-boundary — Capture the Ibex FFI
  // transport before application code evaluates. Workerd supplies an
  // invocation-local transport explicitly; on Ibex,
  // reading g.__hostCall later would let a handler replace it with a wrapper
  // and observe the otherwise-opaque invocation epoch.
  var ibexHostCall = typeof g.__hostCall === "function" ? g.__hostCall : null;
  var trustedNativeFetch = typeof g.fetch === "function" ? g.fetch : null;
  var trustedNativeFetchDescriptor = trustedGetOwnPropertyDescriptor(g, "fetch");
  var TrustedRequest = typeof g.Request === "function" ? g.Request : null;
  var activeActionFetchHost = null;
  function installTrustedFunction(name, value) {
    // These names are control-plane entry points, not application extension
    // points. Install non-writable/non-configurable properties before the
    // handler module runs, and fail harness initialization if the runtime
    // cannot enforce that boundary.
    var existing = trustedGetOwnPropertyDescriptor(g, name);
    // Some engines expose native fetch as non-configurable but writable. Such
    // a property may still replace its value and transition writable→false;
    // its enumerable bit must remain unchanged by ECMAScript invariants.
    var enumerable = existing && !existing.configurable ? existing.enumerable : false;
    trustedDefineProperty(g, name, {
      value: value,
      enumerable: enumerable,
      configurable: false,
      writable: false
    });
    var descriptor = trustedGetOwnPropertyDescriptor(g, name);
    if (!descriptor || descriptor.value !== value || descriptor.configurable || descriptor.writable) {
      throw snapbackError("SNAPBACK_HANDLER_HARNESS_INIT_FAILED", name);
    }
    try { trustedFreeze(value); } catch (_) {}
  }
  // @ref LLP 0009#harness-control-plane-boundary — every harness entry point
  // reached through `globalThis.<name>` also depends on `globalThis` resolving
  // to the real global object. Seal that lookup root before application code
  // can replace it with a lookalike dispatcher, and fail initialization if
  // the engine cannot enforce the descriptor.
  function sealGlobalThisLookupRoot() {
    var existing = trustedGetOwnPropertyDescriptor(g, "globalThis");
    var enumerable = existing && !existing.configurable ? existing.enumerable : false;
    trustedDefineProperty(g, "globalThis", {
      value: g,
      enumerable: enumerable,
      configurable: false,
      writable: false
    });
    var descriptor = trustedGetOwnPropertyDescriptor(g, "globalThis");
    if (!descriptor || descriptor.value !== g || descriptor.configurable || descriptor.writable) {
      throw snapbackError("SNAPBACK_HANDLER_HARNESS_INIT_FAILED", "globalThis");
    }
  }
  sealGlobalThisLookupRoot();
  // The deterministic Ibex ambient layer has already installed a sealed deny
  // function in this slot; replacing it would both weaken that boundary and
  // collide with Ibex's lazy ambient installer. Egress-action fetch is the
  // distinct configurable native slot. Workerd owns its invocation-local
  // request lifecycle and does not need the process service fence.
  if (trustedNativeFetch && ibexHostCall !== null &&
      trustedNativeFetchDescriptor && trustedNativeFetchDescriptor.configurable) {
    installTrustedFunction("fetch", function guardedSnapbackFetch() {
      // @ref LLP 0059#finite-service-authority-fence — terminal premark and
      // native enqueue are ordered by an exact Begin/Initiated handshake.
      // Workerd supplies an invocation-local transport and owns its own
      // request lifecycle. Ibex is the native process in which finite scoped
      // authority can race a durable auth transaction, so its action fetches
      // cross an explicit begin-to-initiated handshake around native enqueue.
      if (activeActionFetchHost === null) {
        throw snapbackError("SNAPBACK_AUTH_POLICY_UNAVAILABLE", "fetch has no active action authority");
      }
      // Normalize every application-controlled input before reserving the
      // authority cut. Request construction may invoke Proxy/string coercion;
      // once this trusted native Request exists, begin-to-enqueue contains no
      // application callback and is bounded by the native synchronous call.
      if (TrustedRequest === null) {
        throw snapbackError("SNAPBACK_AUTH_POLICY_UNAVAILABLE", "trusted Request construction is unavailable");
      }
      var request = trustedReflectConstruct(TrustedRequest, [arguments[0], arguments[1]]);
      activeActionFetchHost("action.externalEffectBegin", trustedCreate(null));
      try {
        return trustedReflectApply(trustedNativeFetch, g, [request]);
      } finally {
        activeActionFetchHost("action.externalEffectInitiated", trustedCreate(null));
      }
    });
  }
  // The opaque secret handle (LLP 0036 D5/D8): every accidental
  // materialization path — stringify, JSON, template coercion, console —
  // yields a redacted marker; expose() is the explicit, greppable escape
  // hatch; asBearer() is v1 sugar over expose() (a true host-boundary unwrap
  // awaits host-mediated fetch on the egress seam). Pure helpers: they close
  // over nothing invocation-specific, and actions run on fresh VMs (DK-4
  // scope fence), so module scope is safe.
  function makeSecretHandle(name, value) {
    var marker = "[snapback secret " + name + "]";
    var handle = {
      expose: function() { return value; },
      asBearer: function() { return "Bearer " + value; },
      toString: function() { return marker; },
      toJSON: function() { return marker; }
    };
    try {
      Object.defineProperty(handle, Symbol.toPrimitive, {
        value: function() { return marker; }
      });
    } catch (_) {}
    return handle;
  }
  // Descriptor-only handle for deploy-time-binding profiles (LLP 0049
  // §Config And Secrets / LLP 0036 host-boundary unwrap): the isolate never
  // holds the value. expose()/asBearer() fail CLOSED with a coded error —
  // code that believes it holds a key must fail loudly, not silently carry a
  // token that stopped being a key. The serializable __snapbackDescriptor is
  // what the action-only host fetch capability accepts in a placement slot;
  // the coordinator resolves it to the real value only at its own fetch
  // boundary.
  function makeDescriptorHandle(name, capabilityId) {
    var marker = "[snapback secret " + name + "]";
    function failClosed(method) {
      return function() {
        throw snapbackError(
          "SNAPBACK_CONFIG_EXPOSE_UNSUPPORTED",
          name + ": " + method + "() is unavailable on this profile — secret values resolve only at the " +
            "host fetch boundary; pass the handle in a host-fetch placement slot instead"
        );
      };
    }
    var descriptor = { capabilityId: capabilityId };
    try { Object.freeze(descriptor); } catch (_) {}
    var handle = {
      expose: failClosed("expose"),
      asBearer: failClosed("asBearer"),
      toString: function() { return marker; },
      toJSON: function() { return marker; },
      __snapbackDescriptor: descriptor
    };
    try {
      Object.defineProperty(handle, Symbol.toPrimitive, {
        value: function() { return marker; }
      });
    } catch (_) {}
    try { Object.freeze(handle); } catch (_) {}
    return handle;
  }
  function makeSecrets(grants) {
    var entries = (grants && grants.entries) || {};
    var descriptorsOnly = !!(grants && grants.descriptorsOnly);
    function lookup(name, rotate) {
      var entry = entries[name];
      if (!entry) {
        throw snapbackError("SNAPBACK_CONFIG_UNDECLARED", name + " is not in this function's uses grant");
      }
      if (descriptorsOnly) {
        if (!entry.set || !(entry.memberCount > 0)) {
          throw snapbackError("SNAPBACK_CONFIG_MISSING", name + " has no value set");
        }
        var capabilityId = rotate ? entry.rotatingCapabilityId : entry.firstCapabilityId;
        if (typeof capabilityId !== "string" || capabilityId.length === 0) {
          throw snapbackError("SNAPBACK_CONFIG_UNDECLARED", name + " has no invocation-scoped capability");
        }
        return makeDescriptorHandle(name, capabilityId);
      }
      if (!entry.set || !entry.values || !entry.values.length) {
        throw snapbackError("SNAPBACK_CONFIG_MISSING", name + " has no value set");
      }
      var index = rotate ? (entry.cursor || 0) % entry.values.length : 0;
      return makeSecretHandle(name, entry.values[index]);
    }
    return {
      get: function(name) { return lookup(name, false); },
      rotating: function(name) { return lookup(name, true); }
    };
  }
  // Unhandled-rejection floor (ENG-23361). Both targets keep enrollment and
  // handled-state cancellation outside handler reach: current Ibex publishes
  // rooted failures through its owner-thread native queue, while workerd owns
  // a closure-private event ledger in handler-server.mjs. The host drains its
  // target-native reporter after every successful evaluation and burns a VM
  // with any remaining rejection. The only handler-reachable control here is
  // a sealed canonical-constructor gate around `then`, which prevents hostile
  // child capabilities from making propagation disappear before either
  // reporter can observe it.
  //
  // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
  // Obligation 3: settlement of the invocation promise does not prove the
  // handler's detached chains succeeded; the target-native checkpoint closes
  // that gap.
  (function installRejectionFloor() {
    var OriginalPromise = g.__OriginalPromise;
    // Current Ibex keeps rejection enrollment, handled-state cancellation,
    // and the rooted failure queue inside Hermes; V8/workerd owns its event
    // ledger in handler-server.mjs. Neither target gives this realm an observer
    // callback. Both still need the same constructor-path gate: native `then`
    // lets an own constructor supply no-op child resolve/reject capabilities,
    // which would make a propagated rejection disappear before either native
    // reporter can observe it.
    // @ref LLP 0009#harness-control-plane-boundary
    if (!OriginalPromise) {
      var workerdPromisePrototype = TrustedPromise.prototype;
      var workerdMediatedThen = function(onFulfilled, onRejected) {
        if (!promiseReactionPathIsCanonical(
          this,
          TrustedPromise,
          workerdPromisePrototype
        )) {
          return failUnsafePromiseReaction();
        }
        return trustedReflectApply(trustedPromiseThen, this, [onFulfilled, onRejected]);
      };
      try {
        trustedDefineProperty(workerdPromisePrototype, "then", {
          value: workerdMediatedThen,
          enumerable: false,
          configurable: false,
          writable: false
        });
      } catch (_) {
        throw snapbackError(
          "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
          "Promise reaction constructor gate could not be sealed"
        );
      }
      var workerdThenDescriptor = trustedGetOwnPropertyDescriptor(
        workerdPromisePrototype,
        "then"
      );
      if (
        !workerdThenDescriptor ||
        workerdThenDescriptor.value !== workerdMediatedThen ||
        workerdThenDescriptor.configurable ||
        workerdThenDescriptor.writable
      ) {
        throw snapbackError(
          "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
          "Promise reaction constructor gate was not sealed"
        );
      }
      harnessPromiseThen = workerdMediatedThen;
      return;
    }
    var originalPromisePrototype = OriginalPromise.prototype;
    var observerRegistrarName = "__ibexRegisterPromiseObserver";
    var observerRegistrarDescriptor = trustedGetOwnPropertyDescriptor(
      OriginalPromise,
      observerRegistrarName
    );
    if (
      !observerRegistrarDescriptor ||
      typeof observerRegistrarDescriptor.value !== "function" ||
      !observerRegistrarDescriptor.configurable ||
      !observerRegistrarDescriptor.writable
    ) {
      throw snapbackError(
        "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
        "authenticated Ibex Promise observer is unavailable or invalid"
      );
    }
    var ledger = typeof TrustedMap === "function" ? new TrustedMap() : null;
    var rejectionRecords = typeof TrustedMap === "function" ? new TrustedMap() : null;
    if (
      !ledger ||
      !rejectionRecords ||
      !trustedFunctionPrototype ||
      typeof trustedFunctionCall !== "function" ||
      typeof trustedMapGet !== "function" ||
      typeof trustedPromiseThen !== "function"
    ) {
      throw snapbackError(
        "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
        "rejection ledger primitives unavailable"
      );
    }
    var handled = function() {
      // Hermes calls this hook whenever a reaction is attached, but the hook
      // is also reachable through retained native-constructor paths. Trust
      // only the authenticated engine callbacks below. Direct legacy hook
      // calls intentionally do nothing.
    };
    var authenticatedRejected = function(promise, reason, rejectionRecord) {
      if (
        !promise ||
        (typeof promise !== "object" && typeof promise !== "function") ||
        !rejectionRecord ||
        (typeof rejectionRecord !== "object" && typeof rejectionRecord !== "function")
      ) {
        return;
      }
      // The registrar stores this callback inside Hermes' Promise closure.
      // Its generation record is likewise closure-private, so application
      // calls to reachable legacy hooks cannot forge either the reason or the
      // identity that a completion must match.
      trustedReflectApply(trustedMapSet, ledger, [promise, reason]);
      trustedReflectApply(trustedMapSet, rejectionRecords, [promise, rejectionRecord]);
    };
    var authenticatedReactionCompleted = function(promise, rejectionRecord) {
      if (!promise || (typeof promise !== "object" && typeof promise !== "function")) {
        return;
      }
      var currentRecord = trustedReflectApply(trustedMapGet, rejectionRecords, [promise]);
      if (currentRecord !== rejectionRecord) return;
      trustedReflectApply(trustedMapDelete, rejectionRecords, [promise]);
      trustedReflectApply(trustedMapDelete, ledger, [promise]);
    };
    try {
      // @ref LLP 0009#harness-control-plane-boundary — rejection-ledger
      // mutation is a host control-plane power. Reachable then/promise hooks
      // mediate real promise state; they do not accept handler assertions.
      // Ibex's captured pre-application `then` wrapper already performs the
      // getter-free canonical constructor/species checks used by its captured
      // catch/finally wrappers, then dispatches with captured Reflect.apply.
      // Seal that same wrapper in place; replacing it with a second mediator
      // would make ordinary catch/finally fail their authenticated dynamic-
      // then check. Function.prototype.call is pinned separately as a general
      // harness control-plane intrinsic. On patched Hermes, consume and seal
      // the trusted runtime's downstream one-shot bridge before application
      // source evaluates.
      trustedDefineProperty(trustedFunctionPrototype, "call", {
        value: trustedFunctionCall,
        enumerable: false,
        configurable: false,
        writable: false
      });
      var observerInstalled = trustedReflectApply(
        observerRegistrarDescriptor.value,
        OriginalPromise,
        [authenticatedRejected, authenticatedReactionCompleted]
      );
      if (observerInstalled !== true) {
        throw snapbackError(
          "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
          "Ibex Promise observer registrar was already consumed"
        );
      }
      trustedDefineProperty(OriginalPromise, observerRegistrarName, {
        value: observerRegistrarDescriptor.value,
        enumerable: observerRegistrarDescriptor.enumerable,
        configurable: false,
        writable: false
      });
      trustedDefineProperty(OriginalPromise, "_C", {
        value: handled, configurable: false, writable: false
      });
      trustedDefineProperty(OriginalPromise, "_B", {
        value: handled, configurable: false, writable: false
      });
      trustedDefineProperty(originalPromisePrototype, "then", {
        value: trustedPromiseThen,
        enumerable: false,
        configurable: false,
        writable: false
      });
      trustedDefineProperty(originalPromisePrototype, "constructor", {
        value: OriginalPromise,
        enumerable: false,
        configurable: false,
        writable: false
      });
      trustedDefineProperty(g, "__OriginalPromise", {
        value: g.Promise,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {
      throw snapbackError(
        "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
        "rejection hook mediators could not be sealed"
      );
    }
    var hookBDescriptor = trustedGetOwnPropertyDescriptor(OriginalPromise, "_B");
    var hookCDescriptor = trustedGetOwnPropertyDescriptor(OriginalPromise, "_C");
    var sealedObserverRegistrarDescriptor = trustedGetOwnPropertyDescriptor(
      OriginalPromise,
      observerRegistrarName
    );
    var functionCallDescriptor = trustedGetOwnPropertyDescriptor(
      trustedFunctionPrototype,
      "call"
    );
    var thenDescriptor = trustedGetOwnPropertyDescriptor(originalPromisePrototype, "then");
    var constructorDescriptor = trustedGetOwnPropertyDescriptor(
      originalPromisePrototype,
      "constructor"
    );
    var originalAliasDescriptor = trustedGetOwnPropertyDescriptor(g, "__OriginalPromise");
    if (
      !hookBDescriptor ||
      hookBDescriptor.value !== handled ||
      hookBDescriptor.configurable ||
      hookBDescriptor.writable ||
      !hookCDescriptor ||
      hookCDescriptor.value !== handled ||
      hookCDescriptor.configurable ||
      hookCDescriptor.writable ||
      (
        !sealedObserverRegistrarDescriptor ||
        sealedObserverRegistrarDescriptor.value !== observerRegistrarDescriptor.value ||
        sealedObserverRegistrarDescriptor.configurable ||
        sealedObserverRegistrarDescriptor.writable
      ) ||
      !functionCallDescriptor ||
      functionCallDescriptor.value !== trustedFunctionCall ||
      functionCallDescriptor.configurable ||
      functionCallDescriptor.writable ||
      !thenDescriptor ||
      thenDescriptor.value !== trustedPromiseThen ||
      thenDescriptor.configurable ||
      thenDescriptor.writable ||
      !constructorDescriptor ||
      constructorDescriptor.value !== OriginalPromise ||
      constructorDescriptor.configurable ||
      constructorDescriptor.writable ||
      !originalAliasDescriptor ||
      originalAliasDescriptor.value !== g.Promise ||
      originalAliasDescriptor.configurable ||
      originalAliasDescriptor.writable
    ) {
      throw snapbackError(
        "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
        "rejection hook mediators were not sealed"
      );
    }
    // Only this closure can select the sealed generic wrapper for
    // harness-owned reactions.
    // Direct `_B`/`_C` calls remain inert; the private engine lifecycle
    // observer is the sole authority for record/delete.
    harnessPromiseThen = trustedPromiseThen;
    function describeReason(reason) {
      try {
        if (reason && typeof reason === "object" && reason.message) { return trustedString(reason.message); }
        return trustedString(reason);
      } catch (_) { return "unserializable rejection reason"; }
    }
    // Deliberately non-destructive. This function must be callable by the
    // host through eval, which also makes its name knowable to handler code.
    // A handler may inspect its own ledger, but cannot drain it before the
    // host's post-microtask sweep. A VM with a non-empty ledger is burned.
    var inspect = function() {
      if (!ledger) {
        return '{"supported":false,"rejections":[]}';
      }
      var rejections = [];
      trustedReflectApply(trustedMapForEach, ledger, [function(reason) {
        // Serialize each primitive reason separately. Passing the report as
        // an ordinary object/array to JSON.stringify would invoke poisoned
        // Object.prototype.toJSON or Array.prototype.toJSON hooks.
        rejections[rejections.length] = trustedJsonStringify(describeReason(reason));
      }]);
      return '{"supported":true,"rejections":[' +
        trustedReflectApply(trustedArrayJoin, rejections, [',']) + ']}';
    };
    installTrustedFunction("__snapbackInspectUnhandledRejections", inspect);
  })();
  // `host`, `makeBuilder`, and the whole `ctx` are built *per invocation* so
  // that they close over this invocation's `epoch`. A continuation captured
  // in module scope by a prior invocation therefore carries that prior
  // epoch, and the host rejects it (stale-continuation guard) rather than
  // routing it through whatever invocation is currently live on this VM.
  //
  // `hostCall` is optional and invocation-local (ENG-23574): the workerd
  // handler server passes the transport carrying THIS invocation's token and
  // routing headers, captured here once, so an overlapping invocation on the
  // same isolate can never swap it mid-flight. The Ibex leg passes nothing
  // and uses the host-injected `__hostCall` FFI global, which is
  // process-stable (the epoch guard, not the transport, is its staleness
  // defense).
  var snapbackInvoke = async function(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall) {
    var hostCallFn = typeof hostCall === "function" ? hostCall : ibexHostCall;
    if (typeof hostCallFn !== "function") {
      throw snapbackError("SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT", "host transport unavailable");
    }
    function host(op, args) {
      try {
        return hostCallFn(epoch + "|" + op, trustedJsonStringify(args || {}));
      } catch (error) {
        var code = null;
        try { code = codeFromMessage(error && error.message); } catch (_) {}
        if (code) {
          try {
            trustedDefineProperty(error, "__snapbackCode", { value: code });
          } catch (_) {
            try { error.__snapbackCode = code; } catch (_) {}
          }
        }
        throw error;
      }
    }
    // Media provenance is invocation-local and non-visible. Rust places an
    // opaque marker only on host-produced media objects; this trusted shim
    // removes it before application code can observe the value and retains
    // identity in a WeakMap. Structural copies therefore lose custody.
    // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    var mediaProvenance = new TrustedWeakMap();
    var mediaMarker = "__snapbackMediaProvenanceV1";
    function adoptMedia(value, seen) {
      if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
      if (!seen) seen = new TrustedWeakMap();
      if (trustedReflectApply(trustedWeakMapGet, seen, [value])) return value;
      trustedReflectApply(trustedWeakMapSet, seen, [value, true]);
      var token = null;
      try {
        if (trustedReflectApply(trustedHasOwnProperty, value, [mediaMarker])) {
          token = value[mediaMarker];
          trustedReflectApply(trustedReflectDeleteProperty, Reflect, [value, mediaMarker]);
        }
      } catch (_) {}
      if (typeof token === "string" && token.length > 0) {
        trustedReflectApply(trustedWeakMapSet, mediaProvenance, [value, token]);
      }
      var keys = trustedReflectApply(trustedObjectKeys, Object, [value]);
      for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        adoptMedia(value[keys[keyIndex]], seen);
      }
      return value;
    }
    function adoptHostResult(value) {
      if (value && typeof value.then === "function") {
        return value.then(function(resolved) { return adoptMedia(resolved); });
      }
      return adoptMedia(value);
    }
    function makeBuilder(table, hostOp) {
      hostOp = hostOp || "db.query";
      var plan = { table: table, filters: [], order: [], limit: QUERY_MAX_LIMIT, indexed_by: null };
      // @ref LLP 0004#ctxdb-contract — reaching the portable cap without an
      // explicit take cannot silently claim the predicate was complete.
      var explicitLimit = false;
      var filterBindings = 0;
      var inItems = 0;
      function appendFilter(filter, addedBindings) {
        var nextBindings = filterBindings + addedBindings;
        if (nextBindings > QUERY_MAX_FILTER_BINDINGS) {
          throw snapbackError(
            "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
            "query filters exceed maxFilterBindings " + QUERY_MAX_FILTER_BINDINGS
          );
        }
        filterBindings = nextBindings;
        plan.filters.push(filter);
      }
      var builder = {
        withIndex: function(name) { plan.indexed_by = name; return builder; },
        eq: function(field, value) {
          appendFilter({ field: field, op: "Eq", value: literal(value) }, 1);
          return builder;
        },
        in: function(field, values) {
          if (!Array.isArray(values)) {
            throw snapbackError("SNAPBACK_QUERY_FILTER_VALUE_INVALID", "query In expects an array");
          }
          var nextInItems = inItems + values.length;
          if (nextInItems > QUERY_MAX_IN_ITEMS) {
            throw snapbackError("SNAPBACK_QUERY_IN_ITEMS_EXCEEDED", "query In operands exceed maxInItems " + QUERY_MAX_IN_ITEMS);
          }
          appendFilter({ field: field, op: "In", value: literal(values) }, values.length);
          inItems = nextInItems;
          return builder;
        },
        lt: function(field, value) {
          appendFilter({ field: field, op: "Lt", value: literal(value) }, 1);
          return builder;
        },
        lte: function(field, value) {
          appendFilter({ field: field, op: "Lte", value: literal(value) }, 1);
          return builder;
        },
        gt: function(field, value) {
          appendFilter({ field: field, op: "Gt", value: literal(value) }, 1);
          return builder;
        },
        gte: function(field, value) {
          appendFilter({ field: field, op: "Gte", value: literal(value) }, 1);
          return builder;
        },
        order: function(field, direction) {
          plan.order.push({ field: field, direction: normalizeDirection(direction) });
          return builder;
        },
        take: function(limit) {
          if (!Number.isSafeInteger(limit) || limit < 0 || limit > QUERY_MAX_LIMIT) {
            throw snapbackError("SNAPBACK_QUERY_LIMIT_INVALID", "query limit must be a non-negative safe integer no greater than " + QUERY_MAX_LIMIT);
          }
          plan.limit = limit;
          explicitLimit = true;
          return builder;
        },
        // The host boundary is engine-shaped: synchronous FFI on Ibex, an
        // async RPC on the V8 leg (LLP 0014 one-way door 3). collect()/first()
        // unwrap either shape from one source, so handlers `await` both.
        collect: function() {
          var output = adoptHostResult(host(hostOp, { plan: plan }));
          function collectRows(resolved) {
            if (!explicitLimit && resolved.rows.length === QUERY_MAX_LIMIT) {
              throw snapbackError(
                "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED",
                "query collect reached the implicit 1024-row cap; add order(...).take(n) for an intentional bounded prefix"
              );
            }
            return resolved.rows;
          }
          if (output && typeof output.then === "function") {
            return output.then(collectRows);
          }
          return collectRows(output);
        },
        first: function() {
          var firstPlan = {
            table: plan.table,
            filters: plan.filters.slice(),
            order: plan.order.slice(),
            limit: 1,
            indexed_by: plan.indexed_by
          };
          var output = adoptHostResult(host(hostOp, { plan: firstPlan }));
          function pick(resolved) {
            return resolved.rows.length ? resolved.rows[0] : null;
          }
          if (output && typeof output.then === "function") {
            return output.then(pick);
          }
          return pick(output);
        }
      };
      return builder;
    }
    // Diagnostics-routed console (allowlist slice 1): the routed console shim
    // forwards to this sink, which carries the invocation's epoch AND its
    // invocation-local transport through the ordinary host-call path (the
    // `host` closure above). The global slot is per-invocation; on workerd
    // the handler server serializes invocations, so it cannot be swapped
    // mid-invocation (ENG-23574). Logging is diagnostics, never control
    // flow — a failed or stale sink call is dropped, not raised.
    try {
      g.__snapbackConsoleSink = function(level, parts) {
        try {
          var logged = host("runtime.log", { level: level, message: parts });
          if (logged && typeof logged.then === "function") {
            logged.then(function() {}, function() {});
          }
        } catch (_) {}
      };
    } catch (_) {}
    var args = trustedJsonParse(argsJson || "{}");
    // @ref LLP 0058#handlerauthprojection — authority is copied from the
    // closed Rust projection into an own-property-only null-prototype object.
    // Freeze nested roles before freezing the projection, so application code
    // cannot mutate authority in place or inherit polluted Object.prototype
    // members.
    var parsedAuth = trustedJsonParse(authJson || "{}");
    var auth = trustedReflectApply(trustedCreate, Object, [null]);
    var authKeys = ["userId", "sessionId", "isAuthenticated", "provider", "roles", "kind", "actor", "actorKind", "claims"];
    for (var authIndex = 0; authIndex < authKeys.length; authIndex++) {
      var authKey = authKeys[authIndex];
      if (!trustedReflectApply(trustedHasOwnProperty, parsedAuth, [authKey])) continue;
      var authValue = parsedAuth[authKey];
      if (authKey === "roles") {
        authValue = trustedFreeze(trustedReflectApply(trustedArraySlice, authValue || [], []));
      } else if (authKey === "actor") {
        // Delegation attribution is another sealed projection, not a plain
        // parsed object whose prototype or surplus keys application code can
        // observe. Copy only the enumerated server-owned keys, then freeze it
        // before installing it on ctx.auth.
        var parsedActor = authValue || {};
        var actor = trustedReflectApply(trustedCreate, Object, [null]);
        var actorKeys = ["userId", "kind", "grantId"];
        for (var actorIndex = 0; actorIndex < actorKeys.length; actorIndex++) {
          var actorKey = actorKeys[actorIndex];
          if (!trustedReflectApply(trustedHasOwnProperty, parsedActor, [actorKey])) continue;
          trustedDefineProperty(actor, actorKey, {
            value: parsedActor[actorKey],
            enumerable: true,
            writable: false,
            configurable: false
          });
        }
        authValue = trustedFreeze(actor);
      } else if (authKey === "claims") {
        // @ref LLP 0214#62-projection-rules — copy the closed
        // catalog projection claim-by-claim into captured-intrinsic,
        // null-prototype arrays and deep-freeze it. Parsed JSON is never
        // handed to application code directly, and application mutation of
        // Array.prototype cannot forge or amplify the projection.
        var parsedClaims = authValue || {};
        var claims = trustedReflectApply(trustedCreate, Object, [null]);
        var claimCollections = [
          ["identities", ["kind", "providerKey", "issuer", "subject", "value"]],
          ["assurances", ["kind", "provenance", "issuedAt", "expiresAt", "governingAuthority"]]
        ];
        for (var claimCollectionIndex = 0; claimCollectionIndex < claimCollections.length; claimCollectionIndex++) {
          var claimCollection = claimCollections[claimCollectionIndex];
          var parsedEntries = parsedClaims[claimCollection[0]] || [];
          var entries = nullPrototypeArray();
          for (var entryIndex = 0; entryIndex < parsedEntries.length; entryIndex++) {
            var parsedEntry = parsedEntries[entryIndex] || {};
            var entry = trustedReflectApply(trustedCreate, Object, [null]);
            var entryKeys = claimCollection[1];
            if (claimCollection[0] === "identities") {
              if (parsedEntry.kind === "email" || parsedEntry.kind === "phone" || parsedEntry.kind === "username") {
                entryKeys = ["kind", "providerKey", "subject", "value"];
              } else if (parsedEntry.kind === "oidc") {
                entryKeys = ["kind", "providerKey", "issuer", "subject"];
              } else if (parsedEntry.kind === "oauth2" || parsedEntry.kind === "external") {
                entryKeys = ["kind", "providerKey", "issuer", "subject"];
              }
            }
            for (var entryKeyIndex = 0; entryKeyIndex < entryKeys.length; entryKeyIndex++) {
              var entryKey = entryKeys[entryKeyIndex];
              if (!trustedReflectApply(trustedHasOwnProperty, parsedEntry, [entryKey])) continue;
              trustedDefineProperty(entry, entryKey, {
                value: parsedEntry[entryKey], enumerable: true, writable: false, configurable: false
              });
            }
            defineArrayEntry(entries, entryIndex, trustedFreeze(entry));
          }
          trustedDefineProperty(claims, claimCollection[0], {
            value: trustedFreeze(entries), enumerable: true, writable: false, configurable: false
          });
        }
        authValue = trustedFreeze(claims);
      }
      trustedDefineProperty(auth, authKey, {
        value: authValue,
        enumerable: true,
        writable: false,
        configurable: false
      });
    }
    trustedFreeze(auth);
    var run = runJson ? trustedJsonParse(runJson) : null;
    function batchRead(op, table, index, items) {
      if (!Array.isArray(items)) {
        throw snapbackError(
          "SNAPBACK_BATCH_READ_INPUT_INVALID",
          op + " expects an array"
        );
      }
      if (items.length > BATCH_READ_MAX_ITEMS) {
        throw snapbackError(
          "SNAPBACK_BATCH_READ_ITEMS_EXCEEDED",
          op + " accepts at most " + BATCH_READ_MAX_ITEMS + " items"
        );
      }
      if (items.length === 0) return [];
      var args = { table: table };
      if (index !== null) args.index = index;
      args[op.endsWith(".getMany") ? "ids" : "keys"] = items;
      return adoptHostResult(host(op, args));
    }
    var elevatedDb = {
      get: function(table, id) { return adoptHostResult(host("db.elevated.get", { table: table, id: id })); },
      getMany: function(table, ids) { return batchRead("db.elevated.getMany", table, null, ids); },
      uniqueMany: function(table, index, keys) { return batchRead("db.elevated.uniqueMany", table, index, keys); },
      query: function(table) { return makeBuilder(table, "db.elevated.query"); }
    };
    var db = {
      get: function(table, id) { return adoptHostResult(host("db.get", { table: table, id: id })); },
      getMany: function(table, ids) { return batchRead("db.getMany", table, null, ids); },
      uniqueMany: function(table, index, keys) { return batchRead("db.uniqueMany", table, index, keys); },
      query: makeBuilder,
      elevated: elevatedDb,
      insert: function(table, values) { return host("db.insert", { table: table, values: values }); },
      patch: function(table, id, values) { return host("db.patch", { table: table, id: id, values: values }); },
      delete: function(table, id) { return host("db.delete", { table: table, id: id }); }
    };
    if (mode !== "mutation") {
      db.insert = readonlyDenied("insert");
      db.patch = readonlyDenied("patch");
      db.delete = readonlyDenied("delete");
    }
    // Typed asset attachment (LLP 0044): mutations only. attach records a
    // transaction-scoped admission on the host and returns the typed value to
    // write; the storage commit boundary is the authority that re-verifies it.
    var assets = {
      attach: function(assetId, options) {
        var upload = null;
        if (options && options.upload != null) {
          upload = typeof options.upload === "object"
            ? (options.upload.name || options.upload.id || null)
            : options.upload;
        }
        return host("assets.attach", { assetId: assetId, upload: upload });
      },
      grant: function(assetId, principal, options) {
        var state = options && options.state != null ? options.state : "active";
        return host("assets.grant", { assetId: assetId, principal: principal, state: state });
      },
      activate: function(grantId) {
        return host("assets.activate", { grantId: grantId });
      },
      revoke: function(grantId) {
        return host("assets.revoke", { grantId: grantId });
      }
    };
    if (mode !== "mutation") {
      assets.attach = readonlyDenied("attach");
      assets.grant = readonlyDenied("grant");
      assets.activate = readonlyDenied("activate");
      assets.revoke = readonlyDenied("revoke");
    }
    // Scoped transactional sequence allocation. Scope is a required API
    // argument; the host resolves the declaration's scope table and access
    // proof and buffers the counter advance with the mutation.
    // @ref LLP 0135#12-allocation-surfaces — handler allocation is mutation
    //   only and closed by the function manifest's `sequences` member.
    // @ref LLP 0128#contract-guardrails-before-choosing-a-substrate
    var sequence = {
      allocate: mode === "mutation"
        ? function(counterName, scopeId) {
            return host("sequence.allocate", { counter: counterName, scopeId: scopeId });
          }
        : function() {
            throw snapbackError(
              "SNAPBACK_SEQUENCE_UNDECLARED",
              "ctx.sequence.allocate is available only inside a declared mutation"
            );
          }
    };
    if (mode === "action") {
      db.get = readonlyDenied("get");
      db.getMany = readonlyDenied("getMany");
      db.uniqueMany = readonlyDenied("uniqueMany");
      db.query = readonlyDenied("query");
      elevatedDb.get = readonlyDenied("elevated.get");
      elevatedDb.getMany = readonlyDenied("elevated.getMany");
      elevatedDb.uniqueMany = readonlyDenied("elevated.uniqueMany");
      elevatedDb.query = readonlyDenied("elevated.query");
    }
    // Declared application refusals (LLP 0108 §Declared application refusals).
    // The thrown code is *claimed*, never trusted: the host admits `appCode`
    // only when the invoked function declares it, and folds anything else to
    // SNAPBACK_HANDLER_FAILED. Details are ordinary JSON validated host-side.
    var refuse = function(appCode, details) {
      var error = snapbackError(
        "SNAPBACK_APP_REFUSAL",
        typeof appCode === "string" ? appCode : "application refusal"
      );
      try {
        trustedDefineProperty(error, "__snapbackAppCode", {
          value: typeof appCode === "string" ? appCode : null
        });
        trustedDefineProperty(error, "__snapbackAppDetails", {
          value: details === undefined ? null : details
        });
      } catch (_) {
        error.__snapbackAppCode = typeof appCode === "string" ? appCode : null;
        error.__snapbackAppDetails = details === undefined ? null : details;
      }
      throw error;
    };
    var ctx = {
      auth: auth,
      refuse: refuse,
      // @ref LLP 0055#principal-kinds —
      // both conjuncts are load-bearing: kind alone admits delegation, while
      // actor absence alone admits autonomous agents.
      isDirectHuman: function() {
        return auth.kind === "human" && auth.actor == null;
      },
      db: db,
      assets: assets,
      sequence: sequence,
      runtime: {
        now: function() { return host("runtime.now", {}); },
        id: function() { return host("runtime.id", {}); }
      }
    };
    // @ref LLP 0043#handler-visible-settlement-identity-2026-08-08 — only mutations
    // carry the durable identity whose settled duplicate bypasses handler
    // dispatch. Queries are reads and actions must enter through runMutation.
    // Copy only the two host-owned scalar fields into a fresh, frozen,
    // null-prototype value so handler code cannot mutate host state or retain
    // a shared mutable projection across calls.
    function freezeMutationSettlement(resolved) {
      resolved = resolved || {};
      var projected = trustedReflectApply(trustedCreate, Object, [null]);
      var clientMutationId = typeof resolved.clientMutationId === "string"
        ? resolved.clientMutationId
        : null;
      var settlementId = typeof resolved.settlementId === "string"
        ? resolved.settlementId
        : null;
      trustedDefineProperty(projected, "clientMutationId", {
        value: clientMutationId,
        enumerable: true,
        writable: false,
        configurable: false
      });
      trustedDefineProperty(projected, "settlementId", {
        value: settlementId,
        enumerable: true,
        writable: false,
        configurable: false
      });
      return trustedFreeze(projected);
    }
    var mutation = trustedReflectApply(trustedCreate, Object, [null]);
    trustedDefineProperty(mutation, "settlement", {
      value: mode === "mutation"
        ? function() {
            var answer = host("mutation.settlement", {});
            return answer && typeof answer.then === "function"
              ? answer.then(freezeMutationSettlement)
              : freezeMutationSettlement(answer);
          }
        : function() {
            throw snapbackError(
              "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE",
              mode === "action"
                ? "actions carry no settlement identity; call ctx.runMutation and read ctx.mutation.settlement() inside that mutation"
                : "queries are never queued or settled; only mutations carry a settlement identity"
            );
          },
      enumerable: true,
      writable: false,
      configurable: false
    });
    ctx.mutation = trustedFreeze(mutation);
    // Transactional one-off durable work (LLP 0070 first slice): mutations
    // buffer enqueues that commit or roll back with their writes. Queries
    // cannot enqueue; actions enqueue only through an explicit mutation —
    // the host refuses both with SNAPBACK_JOB_ENQUEUE_UNAVAILABLE, and the
    // non-mutation stub throws the same code without a host round-trip.
    ctx.jobs = {
      enqueue: mode === "mutation"
        ? function(action, jobArgs, options) {
            return host("jobs.enqueue", {
              action: action,
              args: jobArgs || {},
              options: options || {}
            });
          }
        : function() {
            throw snapbackError(
              "SNAPBACK_JOB_ENQUEUE_UNAVAILABLE",
              mode === "action"
                ? "actions enqueue follow-up work only through an explicit mutation"
                : "queries cannot enqueue durable work"
            );
          }
    };
    if (mode === "action") {
      ctx.run = run || host("action.metadata", {});
      ctx.cron = ctx.run;
      ctx.secrets = makeSecrets(secretsJson ? trustedJsonParse(secretsJson) : null);
      ctx.runMutation = function(mutationName, mutationArgs) {
        return host("action.runMutation", { name: mutationName, args: mutationArgs || {} });
      };
      // @ref LLP 0222#design-detail — connectivity is an
      // action-only host observation; no durable db view is exposed.
      ctx.realtime = {
        hasFreshClient: function(request) {
          return host("realtime.hasFreshClient", request || {});
        }
      };
      // @ref LLP 0143#d2-the-send-lane — actions address a generated audience
      // reference; token resolution, authorization, batching, and provider
      // custody stay entirely behind this host operation.
      var pushAudience = function(name, args) {
        if (typeof name !== "string" || name.length === 0) {
          throw snapbackError("SNAPBACK_PUSH_SEND_INVALID", "push audience name is required");
        }
        return { audience: name, args: args || {} };
      };
      ctx.push = {
        audience: pushAudience,
        audiences: (typeof Proxy === "function")
          ? new Proxy(Object.create(null), {
              get: function(_target, audience) {
                if (typeof audience !== "string") { return undefined; }
                return function(args) { return pushAudience(audience, args); };
              }
            })
          : Object.create(null),
        send: function(request) {
          return host("push.send", request || {});
        }
      };
      // Host-mediated fetch with secret placement slots (LLP 0049 §Action
      // Egress): the action passes URL/method/headers/body/timeout plus
      // slots that reference DESCRIPTOR handles; the hosted profile resolves
      // each descriptor to its value only at its own fetch boundary and
      // redacts every error envelope before it re-enters this isolate. The
      // local profile serves host.fetch from the detached action host under
      // the same egress gate as ctx.fetchStream, staging secret VALUES via
      // ctx.secrets and refusing descriptor slots (0137 a4-f1/a5-f1).
      // Available in actions only; a host without an implementation fails
      // typed rather than falling back to ambient fetch.
      ctx.fetch = function(request) {
        var req = request || {};
        var given = req.secretSlots || [];
        var slots = [];
        for (var i = 0; i < given.length; i++) {
          var slot = given[i] || {};
          var descriptor = slot.handle && slot.handle.__snapbackDescriptor;
          slots.push({
            placement: slot.placement,
            name: slot.name,
            secret: descriptor || null
          });
        }
        return host("host.fetch", {
          url: req.url,
          method: req.method || "GET",
          headers: req.headers || {},
          body: req.body == null ? null : req.body,
          timeoutMs: req.timeoutMs == null ? null : req.timeoutMs,
          secretSlots: slots
        });
      };
      // @ref LLP 0076#surface — pull one host-bounded byte chunk per read;
      // durable application progress still crosses ctx.runMutation and the
      // ordinary commit/live-query path.
      ctx.fetchStream = async function(request) {
        var req = request || {};
        // @ref LLP 0036#runtime-exposure-d5-d8 — the same opaque placement
        // slots as ordinary host-mediated fetch: descriptors resolve only at
        // the host's own boundary and never enter this isolate.
        var givenSlots = req.secretSlots || [];
        var slots = [];
        for (var slotIndex = 0; slotIndex < givenSlots.length; slotIndex++) {
          var slot = givenSlots[slotIndex] || {};
          var descriptor = slot.handle && slot.handle.__snapbackDescriptor;
          slots.push({
            placement: slot.placement,
            name: slot.name,
            secret: descriptor || null
          });
        }
        var opened;
        if (hostCallFn === ibexHostCall) {
          host("action.externalEffectBegin", trustedCreate(null));
        }
        try {
          opened = await host("action.streamOpen", {
            url: req.url,
            method: req.method || "GET",
            headers: req.headers || {},
            body: req.body == null ? null : req.body,
            idempotencyKey: req.idempotencyKey == null ? null : req.idempotencyKey,
            attemptToken: req.attemptToken == null ? null : req.attemptToken,
            secretSlots: slots
          });
        } finally {
          if (hostCallFn === ibexHostCall) {
            host("action.externalEffectInitiated", trustedCreate(null));
          }
        }
        var streamId = opened.streamId;
        var locked = false;
        var closed = false;
        function makeReader() {
          if (locked) {
            throw snapbackError("SNAPBACK_ACTION_STREAM_INVALID", "response body is already locked to a reader");
          }
          locked = true;
          var reading = false;
          var reader = {
            read: async function() {
              if (closed) {
                return { done: true, value: undefined };
              }
              // @ref LLP 0076#surface — one in-flight pull per cursor: the
              // bridge serializes read() so application backpressure stays
              // the default and host buffering stays bounded.
              if (reading) {
                throw snapbackError("SNAPBACK_ACTION_STREAM_INVALID", "the response stream already has a pull in flight");
              }
              reading = true;
              var chunk;
              try {
                chunk = await host("action.streamRead", { streamId: streamId });
              } finally {
                reading = false;
              }
              if (chunk.done) closed = true;
              var value = chunk.done
                ? undefined
                : trustedReflectConstruct(TrustedUint8Array, [chunk.bytes || []]);
              // @ref LLP 0076#author-decisions--2026-07-23 — decision 6: the
              // host-owned monotonic progress clock rides every read result.
              return {
                done: !!chunk.done,
                value: value,
                elapsedMs: chunk.elapsedMs || 0,
                deltaMs: chunk.deltaMs || 0
              };
            },
            cancel: async function() {
              if (!closed) await host("action.streamCancel", { streamId: streamId });
              closed = true;
            },
            // @ref LLP 0076#surface — deliberate deviation from the Web
            // reader contract: releaseLock throws unless the stream reached
            // EOF or was cancelled.
            releaseLock: function() {
              if (!closed) {
                throw snapbackError("SNAPBACK_ACTION_STREAM_INVALID", "releaseLock requires EOF or cancellation in the v1 reader profile");
              }
            }
          };
          return reader;
        }
        var body = { getReader: makeReader };
        if (trustedAsyncIterator) {
          trustedDefineProperty(body, trustedAsyncIterator, {
            value: function() {
              var reader = makeReader();
              var iterator = {
                next: reader.read,
                return: function() {
                  return trustedReflectApply(trustedPromiseThen, reader.cancel(), [
                    function() { return { done: true, value: undefined }; }
                  ]);
                }
              };
              trustedDefineProperty(iterator, trustedAsyncIterator, { value: function() { return iterator; } });
              return iterator;
            }
          });
        }
        return {
          status: opened.status,
          statusText: opened.statusText,
          ok: opened.status >= 200 && opened.status < 300,
          url: opened.url,
          headers: opened.headers || {},
          body: body
        };
      };
      // @ref LLP 0076#settlement-and-retry — the host-owned StreamAttemptV1
      // surface: an opaque attempt token binding fetch (via the request's
      // attemptToken field), progress, and terminal settlement under the
      // single-runner lease. settle() returns the committed durable winner
      // verbatim, which the action must return rather than local inference.
      ctx.streamAttempt = {
        start: function(clientKey) {
          return host("action.streamAttemptStart", { clientKey: clientKey });
        },
        settle: function(attemptToken, cause) {
          return host("action.streamAttemptSettle", { attemptToken: attemptToken, cause: cause });
        }
      };
      // @ref LLP 0204#d91--streaming-conversations — the host
      // checks the compiled stream fact, bounds, lease, and private room.
      ctx.stream = {
        emit: function(chunk) {
          return host("action.streamEmit", { chunk: chunk });
        }
      };
    } else {
      ctx.push = {
        audience: function() {
          throw snapbackError("SNAPBACK_PUSH_SEND_UNAVAILABLE", "push audiences are action-only");
        },
        audiences: Object.create(null),
        send: function() {
          throw snapbackError("SNAPBACK_PUSH_SEND_UNAVAILABLE", "push.send is action-only");
        }
      };
      ctx.runMutation = function() {
        throw snapbackError("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE", "runMutation");
      };
      ctx.fetchStream = function() {
        throw snapbackError("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE", "fetchStream");
      };
      ctx.streamAttempt = {
        start: function() {
          throw snapbackError("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE", "streamAttempt");
        },
        settle: function() {
          throw snapbackError("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE", "streamAttempt");
        }
      };
      ctx.stream = {
        emit: function() {
          throw snapbackError("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE", "stream.emit");
        }
      };
      // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
      // — declaration-bound role evaluation uses the shared authority IR.
      // allowsRole is the captured non-terminal read used by generated
      // authority-profile read admission; requireRole is its terminal write
      // gate twin. Both are available in queries and mutations only
      // (actions carry no transactional read set — the host op refuses there
      // too). The ergonomic per-declaration spelling is LLP 0004 codegen; this
      // is the host-backed binding it lowers onto. The membership read is
      // captured server-side; a failed check throws the trusted
      // SNAPBACK_AUTH_PERMISSION_DENIED, which the host records out-of-band so a
      // handler cannot un-deny it by catching.
      ctx.permissions = (typeof Proxy === "function")
        ? new Proxy(Object.create(null), {
            get: function(_target, declaration) {
              if (typeof declaration !== "string") { return undefined; }
              if (declaration === "__snapbackCustomAuthorization") {
                return {
                  deny: function() {
                    return host("permissions.deny", {});
                  }
                };
              }
              return {
                allowsRole: function(resource) {
                  var roles = Array.prototype.slice.call(arguments, 1);
                  return host("permissions.allowsRole", {
                    declaration: declaration,
                    resource: resource === undefined ? null : resource,
                    roles: roles
                  });
                },
                requireRole: function(resource) {
                  var roles = Array.prototype.slice.call(arguments, 1);
                  return host("permissions.requireRole", {
                    declaration: declaration,
                    resource: resource === undefined ? null : resource,
                    roles: roles
                  });
                }
              };
            }
          })
        : Object.create(null);
      // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — the
      // generated facade hands only declaration/scope/page values to the
      // host. Private row ids, ordering boundaries, and projection fields are
      // never represented in application JavaScript.
      ctx.authority = (typeof Proxy === "function")
        ? new Proxy(Object.create(null), {
            get: function(_target, declaration) {
              if (typeof declaration !== "string") { return undefined; }
              return {
                list: function(scopeId, page) {
                  return host("authority.list", {
                    declaration: declaration,
                    scopeId: scopeId,
                    page: page === undefined ? null : page
                  });
                },
                myRole: function(scopeId) {
                  return host("authority.myRole", {
                    declaration: declaration,
                    scopeId: scopeId
                  });
                },
                history: function(scopeId, page) {
                  return host("authority.history", {
                    declaration: declaration,
                    scopeId: scopeId,
                    page: page === undefined ? null : page
                  });
                },
                incarnations: function(scopeId, page) {
                  return host("authority.incarnations", {
                    declaration: declaration,
                    scopeId: scopeId,
                    page: page === undefined ? null : page
                  });
                },
                snapshotRecipients: function(scopeId) {
                  if (mode !== "mutation") {
                    throw new Error("SNAPBACK_AUTHORITY_RECIPIENT_SNAPSHOT_MUTATION_REQUIRED");
                  }
                  return host("authority.snapshotRecipients", {
                    declaration: declaration,
                    scopeId: scopeId
                  });
                }
              };
            }
          })
        : Object.create(null);
      // @ref LLP 0278#d3-closed-membership-semi-join — generated composition
      // handlers use a typed host refusal when their bounded actor precondition
      // is exceeded; app-authored code cannot select a different error class.
      ctx.composition = {
        semiJoinActorCeilingExceeded: function(ceiling) {
          return host("composition.semiJoinActorCeilingExceeded", { ceiling: ceiling });
        },
        aggregateRowCeilingExceeded: function(ceiling) {
          return host("composition.aggregateRowCeilingExceeded", { ceiling: ceiling });
        }
      };
      // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
      // declaration-bound helpers are generated sugar over one host op. The
      // declaration id is resolved to its table by Rust and the writer carrier
      // comes from the prepared invocation, never from this application-visible
      // object.
      if (mode === "mutation") {
        ctx.membership = (typeof Proxy === "function")
          ? new Proxy(Object.create(null), {
              get: function(_target, declaration) {
                if (typeof declaration !== "string") { return undefined; }
                return {
                  bootstrap: function(values, initialMembers) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "bootstrap",
                      values: values || {},
                      initialMembers: initialMembers === undefined ? [] : initialMembers
                    });
                  },
                  insert: function(values) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "insert",
                      values: values || {}
                    });
                  },
                  invite: function(values) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "insert",
                      values: values || {}
                    });
                  },
                  setRole: function(memberId, role) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "setRole",
                      memberId: memberId,
                      role: role
                    });
                  },
                  remove: function(memberId) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "remove",
                      memberId: memberId
                    });
                  },
                  patch: function(memberId, values) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "patch",
                      memberId: memberId,
                      values: values || {}
                    });
                  },
                  setSelfRole: function(resource, role) {
                    if (arguments.length === 1) {
                      role = resource;
                      resource = null;
                    }
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "setSelfRole",
                      resource: resource === undefined ? null : resource,
                      role: role
                    });
                  },
                  join: function(resource, invitation) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "setSelfRole",
                      resource: resource === undefined ? null : resource,
                      role: invitation
                    });
                  },
                  removeSelf: function(resource) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "removeSelf",
                      resource: resource === undefined ? null : resource
                    });
                  },
                  leave: function(resource) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "removeSelf",
                      resource: resource === undefined ? null : resource
                    });
                  },
                  patchSelf: function(resource, values) {
                    if (arguments.length === 1) {
                      values = resource;
                      resource = null;
                    }
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "patchSelf",
                      resource: resource === undefined ? null : resource,
                      values: values || {}
                    });
                  },
                  removePrincipal: function(resource, principal) {
                    if (arguments.length === 1) {
                      principal = resource;
                      resource = null;
                    }
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "removePrincipal",
                      resource: resource === undefined ? null : resource,
                      principal: principal
                    });
                  },
                  changeRole: function(resource, principal, role) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "changeRolePrincipal",
                      resource: resource === undefined ? null : resource,
                      principal: principal,
                      role: role
                    });
                  },
                  transferOwner: function(resource, principal) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "transferOwner",
                      resource: resource === undefined ? null : resource,
                      principal: principal
                    });
                  },
                  removeAuthorityPrincipal: function(resource, principal) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "removeAuthorityPrincipal",
                      resource: resource === undefined ? null : resource,
                      principal: principal
                    });
                  }
                };
              }
            })
          : Object.create(null);
      }
    }
    var handlers = g.__snapbackHandlers || {};
    var handler = handlers[name];
    if (typeof handler !== "function") {
      // Name the registration contract: handler source files are closed
      // scripts, and `exportName` resolves here — not via ES exports. Without
      // this steering the authoring loop dead-ends between codegen's
      // BUNDLE_UNSUPPORTED_EXPORT and this refusal (0137 a4-f1).
      throw snapbackError(
        "SNAPBACK_HANDLER_EXPORT_MISSING",
        name + " is not registered; the handler source file must assign globalThis.__snapbackHandlers = { " + name + ": async (ctx, args) => { ... } } (ES exports are refused at generation)"
      );
    }
    var previousActionFetchHost = activeActionFetchHost;
    if (mode === "action" && hostCallFn === ibexHostCall) {
      activeActionFetchHost = host;
    }
    try {
      var handlerValue = await observeHarnessPromise(handler(ctx, args));
      var occurrences = [];
      function collectMedia(value, path, seenPairs) {
        if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
        if (trustedReflectApply(trustedWeakMapGet, seenPairs, [value])) return;
        trustedReflectApply(trustedWeakMapSet, seenPairs, [value, true]);
        var token = trustedReflectApply(trustedWeakMapGet, mediaProvenance, [value]);
        if (typeof token === "string") {
          occurrences[occurrences.length] = { path: path, token: token };
        }
        var keys = trustedReflectApply(trustedObjectKeys, Object, [value]);
        for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
          var key = keys[keyIndex];
          collectMedia(value[key], trustedReflectApply(trustedArrayConcat, path, [[key]]), seenPairs);
        }
        trustedReflectApply(trustedWeakMapDelete, seenPairs, [value]);
      }
      collectMedia(handlerValue, [], new TrustedWeakMap());
      if (mode !== "action") host("media.handoff", { occurrences: occurrences });
      return handlerValue;
    } finally {
      activeActionFetchHost = previousActionFetchHost;
    }
  };
  var SNAPBACK_FAILURE_EXTRACTION_MAX_BYTES = 16 * 1024;
  function __snapbackSafeStringRecord(value, maxBytes) {
    var text = trustedString(value);
    var out = "";
    var bytes = 0;
    var truncated = false;
    for (var i = 0; i < text.length; i++) {
      var code = trustedReflectApply(trustedStringCharCodeAt, text, [i]);
      var units = 1;
      var width = 0;
      var valueText = "";
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 < text.length) {
          var next = trustedReflectApply(trustedStringCharCodeAt, text, [i + 1]);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            valueText = trustedReflectApply(trustedStringCharAt, text, [i]) +
              trustedReflectApply(trustedStringCharAt, text, [i + 1]);
            units = 2;
            width = 4;
          }
        }
        if (width === 0) {
          valueText = "\uFFFD";
          width = 3;
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        valueText = "\uFFFD";
        width = 3;
      } else {
        valueText = trustedReflectApply(trustedStringCharAt, text, [i]);
        width = code <= 0x7F ? 1 : (code <= 0x7FF ? 2 : 3);
      }
      if (maxBytes !== null && bytes + width > maxBytes) {
        truncated = true;
        break;
      }
      out += valueText;
      bytes += width;
      i += units - 1;
    }
    return { value: out, truncated: truncated };
  }
  function __snapbackBoundedSafeString(value) {
    return __snapbackSafeStringRecord(value, SNAPBACK_FAILURE_EXTRACTION_MAX_BYTES);
  }
  function __snapbackSafeString(value) {
    return __snapbackBoundedSafeString(value).value;
  }
  // JSON.stringify is well-formed for JavaScript lone surrogates, but its
  // `\\uD800` spelling is not a Unicode scalar and the Rust JSON boundary
  // deliberately rejects it. Successful results therefore normalize only
  // unpaired surrogate code units while preserving every other code unit and
  // the complete string length. Failure metadata uses the separately bounded
  // sanitizer above.
  function __snapbackCompleteSafeString(value) {
    return __snapbackSafeStringRecord(value, null).value;
  }
  function __snapbackValidatedErrorClass(error) {
    // Each access/conversion is independent. A poisoned name, constructor, or
    // constructor.name must not suppress the remaining candidate or the
    // separately extracted message/stack.
    var rawName = null;
    var nameAvailable = false;
    try {
      rawName = error === null || error === undefined ? null : error.name;
      nameAvailable = rawName !== null && rawName !== undefined;
    } catch (_) {}
    if (nameAvailable) {
      var nameCandidate = null;
      try { nameCandidate = trustedString(rawName); } catch (_) { nameAvailable = false; }
      if (nameAvailable) {
        return nameCandidate !== "unclassified" &&
          trustedReflectApply(trustedRegExpExec, snapbackErrorClassPattern, [nameCandidate])
          ? nameCandidate
          : "unclassified";
      }
    }
    var constructor = null;
    try {
      constructor = error === null || error === undefined ? null : error.constructor;
    } catch (_) {}
    var rawConstructorName = null;
    try { rawConstructorName = constructor && constructor.name; } catch (_) {}
    if (rawConstructorName !== null && rawConstructorName !== undefined) {
      var constructorCandidate = null;
      try { constructorCandidate = trustedString(rawConstructorName); } catch (_) {}
      if (
        constructorCandidate !== null &&
        constructorCandidate !== "unclassified" &&
        trustedReflectApply(trustedRegExpExec, snapbackErrorClassPattern, [constructorCandidate])
      ) {
        return constructorCandidate;
      }
    }
    return "unclassified";
  }
  function __snapbackFailureJsonReplacer(_key, value) {
    return typeof value === "string" ? __snapbackSafeString(value) : value;
  }
  function __snapbackResultJsonReplacer(_key, value) {
    return typeof value === "string" ? __snapbackCompleteSafeString(value) : value;
  }
  function __snapbackJsonHexDigit(code) {
    if (code >= 0x30 && code <= 0x39) return code - 0x30;
    if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
    if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
    return -1;
  }
  function __snapbackJsonEscapedCodeAt(encoded, slashIndex) {
    if (
      slashIndex + 5 >= encoded.length ||
      trustedReflectApply(trustedStringCharCodeAt, encoded, [slashIndex]) !== 0x5C ||
      trustedReflectApply(trustedStringCharCodeAt, encoded, [slashIndex + 1]) !== 0x75
    ) return -1;
    var d0 = __snapbackJsonHexDigit(trustedReflectApply(trustedStringCharCodeAt, encoded, [slashIndex + 2]));
    var d1 = __snapbackJsonHexDigit(trustedReflectApply(trustedStringCharCodeAt, encoded, [slashIndex + 3]));
    var d2 = __snapbackJsonHexDigit(trustedReflectApply(trustedStringCharCodeAt, encoded, [slashIndex + 4]));
    var d3 = __snapbackJsonHexDigit(trustedReflectApply(trustedStringCharCodeAt, encoded, [slashIndex + 5]));
    return d0 < 0 || d1 < 0 || d2 < 0 || d3 < 0
      ? -1
      : (d0 << 12) | (d1 << 8) | (d2 << 4) | d3;
  }
  function __snapbackNormalizeJsonKeySurrogates(encoded) {
    // A replacer can normalize string values but cannot replace property
    // names. Well-formed JSON.stringify spells a lone surrogate in a name as
    // a `\uD800` escape, which Rust correctly refuses as a non-scalar. This
    // lexical pass consumes JSON escapes atomically, leaving a user's literal
    // `\\uD800` text and escaped or raw valid surrogate pairs unchanged.
    var out = "";
    var inString = false;
    for (var i = 0; i < encoded.length; ) {
      var code = trustedReflectApply(trustedStringCharCodeAt, encoded, [i]);
      if (!inString) {
        out += trustedReflectApply(trustedStringCharAt, encoded, [i]);
        if (code === 0x22) inString = true;
        i += 1;
        continue;
      }
      if (code === 0x22) {
        out += '"';
        inString = false;
        i += 1;
        continue;
      }
      if (code === 0x5C) {
        var escaped = __snapbackJsonEscapedCodeAt(encoded, i);
        if (escaped >= 0xD800 && escaped <= 0xDBFF) {
          var low = __snapbackJsonEscapedCodeAt(encoded, i + 6);
          if (low >= 0xDC00 && low <= 0xDFFF) {
            for (var pairIndex = 0; pairIndex < 12; pairIndex++) {
              out += trustedReflectApply(trustedStringCharAt, encoded, [i + pairIndex]);
            }
            i += 12;
          } else {
            out += "\\uFFFD";
            i += 6;
          }
        } else if (escaped >= 0xDC00 && escaped <= 0xDFFF) {
          out += "\\uFFFD";
          i += 6;
        } else {
          // Consume a non-Unicode escape (including `\\`) atomically so the
          // following literal `uD800` cannot be mistaken for a JSON escape.
          var escapeLength = escaped >= 0 ? 6 : (i + 1 < encoded.length ? 2 : 1);
          for (var escapeIndex = 0; escapeIndex < escapeLength; escapeIndex++) {
            out += trustedReflectApply(trustedStringCharAt, encoded, [i + escapeIndex]);
          }
          i += escapeLength;
        }
        continue;
      }
      if (code >= 0xD800 && code <= 0xDBFF) {
        var next = i + 1 < encoded.length
          ? trustedReflectApply(trustedStringCharCodeAt, encoded, [i + 1])
          : -1;
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += trustedReflectApply(trustedStringCharAt, encoded, [i]);
          out += trustedReflectApply(trustedStringCharAt, encoded, [i + 1]);
          i += 2;
        } else {
          out += "\uFFFD";
          i += 1;
        }
        continue;
      }
      if (code >= 0xDC00 && code <= 0xDFFF) {
        out += "\uFFFD";
        i += 1;
        continue;
      }
      out += trustedReflectApply(trustedStringCharAt, encoded, [i]);
      i += 1;
    }
    return out;
  }
  // Single-sourced settlement wrapper (LLP 0048): both engines resolve an
  // invocation to the tagged completion envelope through this one function.
  // The envelope is only constructed after the awaited handler value exists,
  // so an untagged output on any engine means the handler never settled
  // (SNAPBACK_HANDLER_DID_NOT_SETTLE on the host side).
  var snapbackSettle = async function(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall) {
    try {
      var value = await observeHarnessPromise(
        snapbackInvoke(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall)
      );
      // @ref LLP 0108#result-contract-vocabulary — successful results cross
      // this engine-neutral JSON boundary at full fidelity; the host-side
      // validator owns the declared 1 MiB-per-string and 4 MiB-result ceilings.
      var encodedValue = trustedJsonStringify(
        value === undefined ? null : value,
        __snapbackResultJsonReplacer
      );
      if (encodedValue === undefined) {
        var resultError = new TrustedError("handler returned a value that is not JSON-serializable");
        try { trustedDefineProperty(resultError, "__snapbackCode", { value: "SNAPBACK_HANDLER_RESULT_INVALID" }); } catch (_) { resultError.__snapbackCode = "SNAPBACK_HANDLER_RESULT_INVALID"; }
        throw resultError;
      }
      encodedValue = __snapbackNormalizeJsonKeySurrogates(encodedValue);
      return '{"r":{"__snapbackOk":true,"value":' + encodedValue + '}}';
    } catch (error) {
      var rawCode = null;
      try { rawCode = error && error.__snapbackCode; } catch (_) {}
      var code = typeof rawCode === "string" ? rawCode : null;
      var messageRecord = {
        value: "handler failure could not be safely inspected",
        truncated: false
      };
      try {
        messageRecord = __snapbackBoundedSafeString(error && error.message || error);
      } catch (_) {}
      var stackRecord = { value: null, truncated: false };
      try {
        var rawStack = error === null || error === undefined ? null : error.stack;
        if (rawStack !== null && rawStack !== undefined) {
          stackRecord = __snapbackBoundedSafeString(rawStack);
        }
      } catch (_) {}
      var errorClass = __snapbackValidatedErrorClass(error);
      var encodedCarrier = ',"errorClass":' + trustedJsonStringify(errorClass) +
        ',"stack":' + trustedJsonStringify(stackRecord.value, __snapbackFailureJsonReplacer) +
        ',"messageExtractionTruncated":' + (messageRecord.truncated ? 'true' : 'false') +
        ',"stackExtractionTruncated":' + (stackRecord.truncated ? 'true' : 'false');
      // A declared application refusal carries its claimed app code and JSON
      // details beside the platform code. Both stay claims: the host admits
      // them only against the function's declared refusal set.
      var appCode = null;
      var appDetails = null;
      try { appCode = error && error.__snapbackAppCode; } catch (_) {}
      try { appDetails = error && error.__snapbackAppDetails; } catch (_) {}
      if (code === "SNAPBACK_APP_REFUSAL" && typeof appCode === "string") {
        var encodedDetails = trustedJsonStringify(
          appDetails === undefined ? null : appDetails,
          __snapbackFailureJsonReplacer
        );
        if (encodedDetails === undefined) encodedDetails = "null";
        return '{"r":{"__snapbackOk":false,"code":' +
          trustedJsonStringify(code) + ',"message":' +
          trustedJsonStringify(messageRecord.value, __snapbackFailureJsonReplacer) + encodedCarrier + ',"appCode":' +
          trustedJsonStringify(appCode) + ',"appDetails":' +
          encodedDetails + '}}';
      }
      // Build the trusted outer envelope from separately encoded primitives.
      // A handler may poison Object.prototype.toJSON; serializing a plain
      // envelope object here would let that inherited hook turn a thrown
      // handler failure into a forged success.
      return '{"r":{"__snapbackOk":false,"code":' +
        trustedJsonStringify(code) + ',"message":' +
        trustedJsonStringify(messageRecord.value, __snapbackFailureJsonReplacer) + encodedCarrier + '}}';
    }
  };
  // @ref LLP 0009#harness-control-plane-boundary —
  // the fixed Ibex tail hands its one serialized payload to a helper that
  // captured JSON.parse before application source evaluated. Export selection
  // is host control-plane work: a handler that replaces reachable JSON.parse
  // must not turn the host-selected export into undefined.
  var snapbackDispatch = function(invocationJson, hostCall) {
    var invocation = trustedJsonParse(invocationJson);
    return snapbackSettle(
      invocation.export,
      invocation.argsJson,
      invocation.authJson,
      invocation.mode,
      invocation.runJson,
      invocation.secretsJson,
      invocation.epoch,
      hostCall
    );
  };
  installTrustedFunction("__snapbackDispatch", snapbackDispatch);
  installTrustedFunction("__snapbackInvoke", snapbackInvoke);
  installTrustedFunction("__snapbackSettle", snapbackSettle);
})(globalThis);
