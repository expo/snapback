(function(g) {
  // Capture every intrinsic used by the settlement/rejection control plane
  // before application source evaluates. Handler code is allowed to mutate
  // its own global object; those mutations must not be able to rewrite the
  // host's success/failure envelope or blind rejection detection.
  var TrustedError = Error;
  var TrustedFunction = Function;
  var TrustedMap = Map;
  var TrustedPromise = Promise;
  var trustedString = String;
  var trustedJsonParse = JSON.parse;
  var trustedJsonStringify = JSON.stringify;
  var trustedCreate = Object.create;
  var trustedDefineProperty = Object.defineProperty;
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
  var trustedPromiseResolve = TrustedPromise && TrustedPromise.resolve;
  var trustedPromiseThen = TrustedPromise && TrustedPromise.prototype.then;
  var trustedRegExpExec = RegExp.prototype.exec;
  var snapbackCodePattern = /^(?:Error:\s*)?(SNAPBACK_[A-Z0-9_]+)(?::|\b)/;
  var harnessPromiseThen = trustedPromiseThen;
  var trustedArrayJoin = Array.prototype.join;
  var trustedArraySlice = Array.prototype.slice;
  var trustedStringCharCodeAt = String.prototype.charCodeAt;
  var trustedStringCharAt = String.prototype.charAt;
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
  // Unhandled-rejection ledger (ENG-23361). The vendored eval loop drains
  // every microtask before the host reads the invocation result, but the only
  // promise anything observes is the invoke IIFE's own. A rejection in a
  // detached chain the handler spawned (forEach(async ...) is the classic
  // shape) could therefore leave earlier ctx.db.* writes buffered while later
  // work silently stopped, and the invocation still reported success.
  //
  // Hermes' internal Promise bytecode exposes its rejection and handle hooks
  // as constructor properties. Constructor identity cannot be replaced:
  // Promise.prototype.then deliberately branches on that exact identity.
  // Patched Hermes therefore exposes a one-shot registrar consumed first by
  // the trusted Ibex bundle. That bundle owns the engine callback, feeds the
  // generic tracker, and publishes the distinct downstream one-shot bridge
  // this bootstrap consumes before application source. Rejection records and matching
  // reaction-completion generations remain inside the engine's Promise
  // closure; `_B`/`_C` are sealed inert. This covers native `await`, adoption,
  // and combinator paths without accepting handler-reachable assertions.
  // An engine without this seam fails harness initialization: a stale runtime
  // may not silently weaken the proof. A hostile own constructor can make
  // native `then` return without attaching, so the canonical constructor gate
  // remains independently required.
  // Calling the reachable hook functions therefore cannot turn a real
  // unhandled rejection into success; an invalid direct call can at worst fail
  // the caller's own invocation closed.
  // The host inspects the ledger after every successful eval and burns a VM
  // with any remaining rejection.
  //
  // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
  // Obligation 3: settlement of the invocation promise does not prove the
  // handler's detached chains succeeded; the ledger closes that gap.
  (function installRejectionLedger() {
    var OriginalPromise = g.__OriginalPromise;
    // V8/workerd owns a closure-private event ledger in handler-server.mjs.
    // It still needs the same constructor-path gate: native `then` lets an own
    // constructor supply no-op child resolve/reject capabilities, which would
    // make a propagated rejection disappear from the event ledger.
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
    function makeBuilder(table) {
      var plan = { table: table, filters: [], order: [], limit: QUERY_MAX_LIMIT, indexed_by: null };
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
          return builder;
        },
        // The host boundary is engine-shaped: synchronous FFI on Ibex, an
        // async RPC on the V8 leg (LLP 0014 one-way door 3). collect()/first()
        // unwrap either shape from one source, so handlers `await` both.
        collect: function() {
          var output = host("db.query", { plan: plan });
          if (output && typeof output.then === "function") {
            return output.then(function(resolved) { return resolved.rows; });
          }
          return output.rows;
        },
        first: function() {
          var firstPlan = {
            table: plan.table,
            filters: plan.filters.slice(),
            order: plan.order.slice(),
            limit: 1,
            indexed_by: plan.indexed_by
          };
          var output = host("db.query", { plan: firstPlan });
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
    var authKeys = ["userId", "sessionId", "isAuthenticated", "provider", "roles", "kind", "actor"];
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
    var db = {
      get: function(table, id) { return host("db.get", { table: table, id: id }); },
      query: makeBuilder,
      insert: function(table, values) { return host("db.insert", { table: table, values: values }); },
      patch: function(table, id, values) { return host("db.patch", { table: table, id: id, values: values }); },
      delete: function(table, id) { return host("db.delete", { table: table, id: id }); }
    };
    if (mode !== "mutation") {
      db.insert = readonlyDenied("insert");
      db.patch = readonlyDenied("patch");
      db.delete = readonlyDenied("delete");
    }
    if (mode === "action") {
      db.get = readonlyDenied("get");
      db.query = readonlyDenied("query");
    }
    var ctx = {
      auth: auth,
      // @ref LLP 0055#principal-kinds —
      // both conjuncts are load-bearing: kind alone admits delegation, while
      // actor absence alone admits autonomous agents.
      isDirectHuman: function() {
        return auth.kind === "human" && auth.actor == null;
      },
      db: db,
      runtime: {
        now: function() { return host("runtime.now", {}); },
        id: function() { return host("runtime.id", {}); }
      }
    };
    if (mode === "action") {
      ctx.run = run || host("action.metadata", {});
      ctx.cron = ctx.run;
      ctx.secrets = makeSecrets(secretsJson ? trustedJsonParse(secretsJson) : null);
      ctx.runMutation = function(mutationName, mutationArgs) {
        return host("action.runMutation", { name: mutationName, args: mutationArgs || {} });
      };
      // Host-mediated fetch with secret placement slots (LLP 0049 §Action
      // Egress): the action passes URL/method/headers/body/timeout plus
      // slots that reference DESCRIPTOR handles; the host resolves each
      // descriptor to its value only at its own fetch boundary and redacts
      // every error envelope before it re-enters this isolate. Available in
      // actions only; on hosts without the host.fetch op the call fails with
      // the host's unknown-op diagnostic rather than falling back to ambient
      // fetch.
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
    } else {
      ctx.runMutation = function() {
        throw snapbackError("SNAPBACK_ACTION_CONTEXT_UNAVAILABLE", "runMutation");
      };
      // LLP 0056 M3: ctx.permissions.<declaration>.requireRole(resource, ...roles).
      // The imperative role-gate twin, available in queries and mutations only
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
              return {
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
                  bootstrap: function(values) {
                    return host("membership.write", {
                      declaration: declaration,
                      operation: "bootstrap",
                      values: values || {}
                    });
                  },
                  insert: function(values) {
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
                  removeSelf: function(resource) {
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
      throw snapbackError("SNAPBACK_HANDLER_EXPORT_MISSING", name);
    }
    var previousActionFetchHost = activeActionFetchHost;
    if (mode === "action" && hostCallFn === ibexHostCall) {
      activeActionFetchHost = host;
    }
    try {
      return await observeHarnessPromise(handler(ctx, args));
    } finally {
      activeActionFetchHost = previousActionFetchHost;
    }
  };
  function __snapbackSafeString(value) {
    var text = trustedString(value);
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var code = trustedReflectApply(trustedStringCharCodeAt, text, [i]);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 < text.length) {
          var next = trustedReflectApply(trustedStringCharCodeAt, text, [i + 1]);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            out += trustedReflectApply(trustedStringCharAt, text, [i]) +
              trustedReflectApply(trustedStringCharAt, text, [i + 1]);
            i++;
            continue;
          }
        }
        out += "\uFFFD";
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        out += "\uFFFD";
      } else {
        out += trustedReflectApply(trustedStringCharAt, text, [i]);
      }
    }
    return out;
  }
  function __snapbackJsonReplacer(_key, value) {
    return typeof value === "string" ? __snapbackSafeString(value) : value;
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
      var encodedValue = trustedJsonStringify(value === undefined ? null : value, __snapbackJsonReplacer);
      if (encodedValue === undefined) {
        var resultError = new TrustedError("handler returned a value that is not JSON-serializable");
        try { trustedDefineProperty(resultError, "__snapbackCode", { value: "SNAPBACK_HANDLER_RESULT_INVALID" }); } catch (_) { resultError.__snapbackCode = "SNAPBACK_HANDLER_RESULT_INVALID"; }
        throw resultError;
      }
      return '{"r":{"__snapbackOk":true,"value":' + encodedValue + '}}';
    } catch (error) {
      var rawCode = null;
      try { rawCode = error && error.__snapbackCode; } catch (_) {}
      var code = typeof rawCode === "string" ? rawCode : null;
      var message = "handler failure could not be safely inspected";
      try { message = __snapbackSafeString(error && error.message || error); } catch (_) {}
      // Build the trusted outer envelope from separately encoded primitives.
      // A handler may poison Object.prototype.toJSON; serializing a plain
      // envelope object here would let that inherited hook turn a thrown
      // handler failure into a forged success.
      return '{"r":{"__snapbackOk":false,"code":' +
        trustedJsonStringify(code) + ',"message":' +
        trustedJsonStringify(message, __snapbackJsonReplacer) + '}}';
    }
  };
  installTrustedFunction("__snapbackInvoke", snapbackInvoke);
  installTrustedFunction("__snapbackSettle", snapbackSettle);
})(globalThis);
