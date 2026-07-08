(function(g) {
  function snapbackError(code, message) {
    var error = new Error(code + ": " + message);
    try { Object.defineProperty(error, "__snapbackCode", { value: code }); } catch (_) { error.__snapbackCode = code; }
    return error;
  }
  function codeFromMessage(message) {
    var match = String(message || "").match(/^(?:Error:\s*)?(SNAPBACK_[A-Z0-9_]+)(?::|\b)/);
    return match ? match[1] : null;
  }
  function literal(value) { return { Literal: value }; }
  function normalizeDirection(direction) {
    return String(direction || "asc").toLowerCase() === "desc" ? "Desc" : "Asc";
  }
  function readonlyDenied(op) {
    return function() { throw snapbackError("SNAPBACK_HANDLER_WRITE_IN_QUERY", op); };
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
  function makeDescriptorHandle(name, cursor) {
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
    var handle = {
      expose: failClosed("expose"),
      asBearer: failClosed("asBearer"),
      toString: function() { return marker; },
      toJSON: function() { return marker; },
      __snapbackDescriptor: { name: name, cursor: cursor }
    };
    try {
      Object.defineProperty(handle, Symbol.toPrimitive, {
        value: function() { return marker; }
      });
    } catch (_) {}
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
        var cursor = rotate ? (entry.cursor || 0) % entry.memberCount : 0;
        return makeDescriptorHandle(name, cursor);
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
  // every microtask before the host reads the invocation result, but the
  // only promise anything observes is the invoke IIFE's own — a rejection
  // in a detached chain the handler spawned (forEach(async ...) is the
  // classic shape) is observed by nobody, so its earlier ctx.db.* writes
  // stayed buffered while its later ones were silently skipped, and the
  // invocation still reported success. The vendored polyfill exposes
  // then/promise's internal hook slots on __OriginalPromise: _C fires on
  // every rejection, _B whenever a handler is attached or dispatched
  // (handlers attached before the rejection re-enter handle() during
  // finale, so they clear their entry too). A promise still in the ledger
  // after the final drain therefore rejected with no handler at completion.
  // The host sweeps the ledger after every successful eval and fails the
  // invocation if entries remain.
  //
  // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
  // Obligation 3: settlement of the invocation promise does not prove the
  // handler's detached chains succeeded; the ledger closes that gap.
  (function installRejectionLedger() {
    if (typeof g.__snapbackTakeUnhandledRejections === "function") return;
    var OriginalPromise = g.__OriginalPromise;
    var ledger = OriginalPromise && typeof Map === "function" ? new Map() : null;
    if (ledger) {
      OriginalPromise._C = function(promise, reason) { ledger.set(promise, reason); };
      OriginalPromise._B = function(promise) { ledger.delete(promise); };
      // Self-check: if a vendored-runtime upgrade moves the pinned hook
      // slots, disable detection (reverting to rejections going unseen)
      // rather than misreport; tests/unhandled_rejection_v0.rs pins that
      // detection works on the vendored runtime, so an upgrade that breaks
      // this fails CI instead of shipping silently.
      var working = false;
      try {
        var probe = new OriginalPromise(function(_, rej) { rej("snapback-ledger-probe"); });
        working = ledger.get(probe) === "snapback-ledger-probe";
        probe.then(undefined, function() {});
        working = working && !ledger.has(probe);
      } catch (_) { working = false; }
      if (!working) {
        OriginalPromise._C = null;
        OriginalPromise._B = null;
        ledger = null;
      }
    }
    function describeReason(reason) {
      try {
        if (reason instanceof Error && reason.message) { return String(reason.message); }
        return String(reason);
      } catch (_) { return "unserializable rejection reason"; }
    }
    var take = function() {
      if (!ledger) { return { supported: false, rejections: [] }; }
      var rejections = [];
      ledger.forEach(function(reason) { rejections.push(describeReason(reason)); });
      ledger.clear();
      return { supported: true, rejections: rejections };
    };
    try {
      Object.defineProperty(g, "__snapbackTakeUnhandledRejections", {
        value: take, configurable: false, writable: false
      });
    } catch (_) { g.__snapbackTakeUnhandledRejections = take; }
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
  g.__snapbackInvoke = async function(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall) {
    var hostCallFn = typeof hostCall === "function" ? hostCall : g.__hostCall;
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
      var plan = { table: table, filters: [], order: [], limit: null, indexed_by: null };
      var builder = {
        withIndex: function(name) { plan.indexed_by = name; return builder; },
        eq: function(field, value) {
          plan.filters.push({ field: field, op: "Eq", value: literal(value) });
          return builder;
        },
        in: function(field, values) {
          plan.filters.push({ field: field, op: "In", value: literal(values) });
          return builder;
        },
        lt: function(field, value) {
          plan.filters.push({ field: field, op: "Lt", value: literal(value) });
          return builder;
        },
        lte: function(field, value) {
          plan.filters.push({ field: field, op: "Lte", value: literal(value) });
          return builder;
        },
        gt: function(field, value) {
          plan.filters.push({ field: field, op: "Gt", value: literal(value) });
          return builder;
        },
        gte: function(field, value) {
          plan.filters.push({ field: field, op: "Gte", value: literal(value) });
          return builder;
        },
        order: function(field, direction) {
          plan.order.push({ field: field, direction: normalizeDirection(direction) });
          return builder;
        },
        take: function(limit) { plan.limit = Number(limit); return builder; },
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
    var text = String(value);
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 < text.length) {
          var next = text.charCodeAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            out += text.charAt(i) + text.charAt(i + 1);
            i++;
            continue;
          }
        }
        out += "\uFFFD";
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        out += "\uFFFD";
      } else {
        out += text.charAt(i);
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
  g.__snapbackSettle = async function(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall) {
    try {
      var value = await g.__snapbackInvoke(name, argsJson, authJson, mode, runJson, secretsJson, epoch, hostCall);
      var encodedValue = JSON.stringify(value === undefined ? null : value, __snapbackJsonReplacer);
      if (encodedValue === undefined) {
        var resultError = new Error("handler returned a value that is not JSON-serializable");
        try { Object.defineProperty(resultError, "__snapbackCode", { value: "SNAPBACK_HANDLER_RESULT_INVALID" }); } catch (_) { resultError.__snapbackCode = "SNAPBACK_HANDLER_RESULT_INVALID"; }
        throw resultError;
      }
      return '{"r":{"__snapbackOk":true,"value":' + encodedValue + '}}';
    } catch (error) {
      var code = error && error.__snapbackCode || null;
      var message = __snapbackSafeString(error && error.message || error);
      return JSON.stringify({ r: { __snapbackOk: false, code: code, message: message } }, __snapbackJsonReplacer);
    }
  };
})(globalThis);
