(function(g) {
  // Capture every intrinsic used by the settlement/rejection control plane
  // before application source evaluates. Handler code is allowed to mutate
  // its own global object; those mutations must not be able to rewrite the
  // host's success/failure envelope or blind rejection detection.
  var TrustedError = Error;
  var TrustedMap = Map;
  var TrustedWeakSet = WeakSet;
  var trustedString = String;
  var trustedJsonStringify = JSON.stringify;
  var trustedDefineProperty = Object.defineProperty;
  var trustedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var trustedFreeze = Object.freeze;
  var trustedReflectApply = Reflect.apply;
  var trustedMapSet = TrustedMap && TrustedMap.prototype.set;
  var trustedMapDelete = TrustedMap && TrustedMap.prototype.delete;
  var trustedMapForEach = TrustedMap && TrustedMap.prototype.forEach;
  var trustedWeakSetAdd = TrustedWeakSet && TrustedWeakSet.prototype.add;
  var trustedWeakSetHas = TrustedWeakSet && TrustedWeakSet.prototype.has;
  var trustedArrayJoin = Array.prototype.join;
  var trustedStringCharCodeAt = String.prototype.charCodeAt;
  var trustedStringCharAt = String.prototype.charAt;
  function snapbackError(code, message) {
    var error = new TrustedError(code + ": " + message);
    try { trustedDefineProperty(error, "__snapbackCode", { value: code }); } catch (_) { error.__snapbackCode = code; }
    return error;
  }
  function codeFromMessage(message) {
    var match = String(message || "").match(/^(?:Error:\s*)?(SNAPBACK_[A-Z0-9_]+)(?::|\b)/);
    return match ? match[1] : null;
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
  function installTrustedFunction(name, value) {
    // These names are control-plane entry points, not application extension
    // points. Install non-writable/non-configurable properties before the
    // handler module runs, and fail harness initialization if the runtime
    // cannot enforce that boundary.
    trustedDefineProperty(g, name, {
      value: value,
      enumerable: false,
      configurable: false,
      writable: false
    });
    var descriptor = trustedGetOwnPropertyDescriptor(g, name);
    if (!descriptor || descriptor.value !== value || descriptor.configurable || descriptor.writable) {
      throw snapbackError("SNAPBACK_HANDLER_HARNESS_INIT_FAILED", name);
    }
    try { trustedFreeze(value); } catch (_) {}
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
  // Instead, install sealed mediator hooks. `_C` ignores its caller-supplied
  // reason and observes the promise through the captured pre-application
  // `then`; `_B` is inert. A sealed wrapper around `then` is the only path that
  // marks a promise handled, and does so only after the real method succeeds.
  // Calling the reachable hook functions therefore cannot turn a real
  // unhandled rejection into success or replace its first diagnostic; an
  // invalid direct call can at worst fail the caller's own invocation closed.
  // The host inspects the ledger after every successful eval and burns a VM
  // with any remaining rejection.
  //
  // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
  // Obligation 3: settlement of the invocation promise does not prove the
  // handler's detached chains succeeded; the ledger closes that gap.
  (function installRejectionLedger() {
    var OriginalPromise = g.__OriginalPromise;
    // V8/workerd owns a closure-private event ledger in handler-server.mjs.
    // This mediated then/promise hook mechanism is Hermes-only.
    if (!OriginalPromise) return;
    var ledger = typeof TrustedMap === "function" ? new TrustedMap() : null;
    var handledPromises = typeof TrustedWeakSet === "function" ? new TrustedWeakSet() : null;
    var observedPromises = typeof TrustedWeakSet === "function" ? new TrustedWeakSet() : null;
    var trustedPromiseThen = OriginalPromise.prototype.then;
    if (
      !ledger ||
      !handledPromises ||
      !observedPromises ||
      typeof trustedPromiseThen !== "function"
    ) {
      throw snapbackError(
        "SNAPBACK_HANDLER_HARNESS_INIT_FAILED",
        "rejection ledger primitives unavailable"
      );
    }

    function weakHas(set, value) {
      return trustedReflectApply(trustedWeakSetHas, set, [value]);
    }
    function weakAdd(set, value) {
      trustedReflectApply(trustedWeakSetAdd, set, [value]);
    }
    var handled = function() {
      // Hermes calls this hook whenever a reaction is attached, but the hook
      // is also reachable through retained native-constructor paths. Trust
      // only the sealed `then` wrapper below, which can prove the underlying
      // attachment succeeded; direct `_B` calls intentionally do nothing.
    };
    var rejected = function(promise, claimedReason) {
      if (!promise || (typeof promise !== "object" && typeof promise !== "function")) return;
      try {
        if (weakHas(handledPromises, promise) || weakHas(observedPromises, promise)) return;
        // Never trust `_C`'s reason argument: handler code can call this
        // reachable hook directly. The captured native chain yields the real
        // rejection reason, so calls on fulfilled/non-Promise values cannot
        // forge a ledger entry.
        trustedReflectApply(trustedPromiseThen, promise, [undefined, function(actualReason) {
          if (!weakHas(handledPromises, promise)) {
            trustedReflectApply(trustedMapSet, ledger, [promise, actualReason]);
          }
        }]);
        weakAdd(observedPromises, promise);
      } catch (_) {
        // A handler can give a real promise a non-configurable throwing
        // `constructor` before it rejects, which prevents even the captured
        // native `then` from observing it. Fail closed with the hook's reason
        // in that exceptional case. First write wins, so a direct hook call
        // after the engine callback cannot replace the real diagnostic.
        trustedReflectApply(trustedMapSet, ledger, [promise, claimedReason]);
        weakAdd(observedPromises, promise);
      }
    };
    var mediatedThen = function(onFulfilled, onRejected) {
      var promise = this;
      var child = trustedReflectApply(trustedPromiseThen, promise, [onFulfilled, onRejected]);
      // Mark handled only after the real Promise method returned. A hostile
      // receiver/constructor getter that makes it throw cannot clear a prior
      // rejection by merely attempting `.then()`.
      if (promise && (typeof promise === "object" || typeof promise === "function")) {
        weakAdd(handledPromises, promise);
        trustedReflectApply(trustedMapDelete, ledger, [promise]);
      }
      return child;
    };
    try {
      // @ref LLP 0009#harness-control-plane-boundary — rejection-ledger
      // mutation is a host control-plane power. Reachable then/promise hooks
      // mediate real promise state; they do not accept handler assertions.
      trustedDefineProperty(OriginalPromise, "_C", {
        value: rejected, configurable: false, writable: false
      });
      trustedDefineProperty(OriginalPromise, "_B", {
        value: handled, configurable: false, writable: false
      });
      trustedDefineProperty(OriginalPromise.prototype, "then", {
        value: mediatedThen,
        enumerable: false,
        configurable: false,
        writable: false
      });
      trustedDefineProperty(OriginalPromise.prototype, "constructor", {
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
    var thenDescriptor = trustedGetOwnPropertyDescriptor(OriginalPromise.prototype, "then");
    var constructorDescriptor = trustedGetOwnPropertyDescriptor(
      OriginalPromise.prototype,
      "constructor"
    );
    var originalAliasDescriptor = trustedGetOwnPropertyDescriptor(g, "__OriginalPromise");
    if (
      !hookBDescriptor ||
      hookBDescriptor.value !== handled ||
      hookBDescriptor.configurable ||
      hookBDescriptor.writable ||
      !hookCDescriptor ||
      hookCDescriptor.value !== rejected ||
      hookCDescriptor.configurable ||
      hookCDescriptor.writable ||
      !thenDescriptor ||
      thenDescriptor.value !== mediatedThen ||
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
        return hostCallFn(epoch + "|" + op, JSON.stringify(args || {}));
      } catch (error) {
        var code = codeFromMessage(error && error.message);
        if (code) {
          try { Object.defineProperty(error, "__snapbackCode", { value: code }); } catch (_) { error.__snapbackCode = code; }
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
    var args = JSON.parse(argsJson || "{}");
    var auth = JSON.parse(authJson || "{}");
    var run = runJson ? JSON.parse(runJson) : null;
    if (auth.user_id && !auth.userId) auth.userId = auth.user_id;
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
      db: db,
      runtime: {
        now: function() { return host("runtime.now", {}); },
        id: function() { return host("runtime.id", {}); }
      }
    };
    if (mode === "action") {
      ctx.run = run || host("action.metadata", {});
      ctx.cron = ctx.run;
      ctx.secrets = makeSecrets(secretsJson ? JSON.parse(secretsJson) : null);
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
    }
    var handlers = g.__snapbackHandlers || {};
    var handler = handlers[name];
    if (typeof handler !== "function") {
      throw snapbackError("SNAPBACK_HANDLER_EXPORT_MISSING", name);
    }
    return await handler(ctx, args);
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
      var value = await snapbackInvoke(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall);
      var encodedValue = trustedJsonStringify(value === undefined ? null : value, __snapbackJsonReplacer);
      if (encodedValue === undefined) {
        var resultError = new TrustedError("handler returned a value that is not JSON-serializable");
        try { trustedDefineProperty(resultError, "__snapbackCode", { value: "SNAPBACK_HANDLER_RESULT_INVALID" }); } catch (_) { resultError.__snapbackCode = "SNAPBACK_HANDLER_RESULT_INVALID"; }
        throw resultError;
      }
      return '{"r":{"__snapbackOk":true,"value":' + encodedValue + '}}';
    } catch (error) {
      var rawCode = error && error.__snapbackCode;
      var code = typeof rawCode === "string" ? rawCode : null;
      var message = __snapbackSafeString(error && error.message || error);
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
