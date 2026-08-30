// Snapback 2 effect compartment. Rust inserts the vendored Ibex 2 factory
// expression at the marker below.
(function () {
  "use strict";

  const saved = globalThis.__sb_saved;
  const allowedGlobals = __SNAPBACK_ALLOWED_GLOBALS__;
  globalThis.__ibex2_response_field = saved.field;
  globalThis.__ibex2_text_decode = saved.decode;
  globalThis.__ibex2_text_encode = saved.encode;
  globalThis.__ibex2_text_encode_into = saved.encodeInto;

  // The factory captures the restored accessors and deletes them itself.
  const makeFetch = __SNAPBACK_FETCH_FACTORY__;
  const grantedFetch = makeFetch(globalThis.__ibex2_fetch);
  delete globalThis.__ibex2_fetch;
  delete globalThis.__sb_saved;
  // Effects never load ESM, so its lowering-only helpers have no job here.
  delete globalThis.__ibex2_default;
  delete globalThis.__ibex2_dynamic_import;
  delete globalThis.__ibex2_export_all;

  function makeJobFetch() {
    // The capability-bearing function handed to application code is a fresh
    // wrapper each job. Project code can neither contaminate another job's
    // function object nor mutate this one.
    const boundFetch = grantedFetch.bind(undefined);
    const jobFetch = function fetch(input, init) {
      return boundFetch.apply(undefined, arguments).catch(function (error) {
        const message = error && error.message ? String(error.message) : String(error);
        if (message.indexOf("denied: net.fetch") !== -1) {
          let origin = String(input);
          try { origin = new URL(String(input)).origin; } catch (_) {}
          const tagged = new Error("denied: net.fetch " + origin + "; declare " + origin);
          tagged.code = "E_EFFECT_GRANT";
          tagged.origin = origin;
          throw tagged;
        }
        throw error;
      });
    };
    Object.freeze(boundFetch);
    return Object.freeze(jobFetch);
  }

  const state = {
    status: "idle",
    result: null,
    error: null,
    errorCode: null,
    errorOrigin: null,
    contaminated: false,
    sourceEvaluations: 0,
  };
  let permanentGlobals = [];

  // These lexical bindings let a compiled one-parameter effect use `fetch`
  // and `meta` without putting either capability on globalThis. Their values
  // are replaced with fresh frozen job objects for every invocation.
  let fetch;
  let meta;
  state.sourceEvaluations++;
  const compiledEffect = (__SNAPBACK_EFFECT_SOURCE__);
  if (typeof compiledEffect !== "function") {
    throw new TypeError("effect source did not evaluate to a function");
  }
  Object.freeze(compiledEffect);
  const effects = {};
  Object.defineProperty(effects, __SNAPBACK_EFFECT_NAME__, {
    value: compiledEffect,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  Object.freeze(effects);

  function cleanJobGlobals() {
    const names = Object.getOwnPropertyNames(globalThis);
    for (let i = 0; i < names.length; i++) {
      if (permanentGlobals.indexOf(names[i]) === -1) {
        try { delete globalThis[names[i]]; } catch (_) {}
      }
    }
    state.contaminated = Object.getOwnPropertyNames(globalThis)
      .some(function (name) { return permanentGlobals.indexOf(name) === -1; });
  }

  function errorText(error) {
    if (error && error.stack) return String(error.stack);
    if (error && error.message) return String(error.message);
    return String(error);
  }

  const api = {};
  Object.defineProperties(api, {
    status: { get: function () { return state.status; } },
    result: { get: function () { return state.result; } },
    error: { get: function () { return state.error; } },
    errorCode: { get: function () { return state.errorCode; } },
    errorOrigin: { get: function () { return state.errorOrigin; } },
    contaminated: { get: function () { return state.contaminated; } },
    sourceEvaluations: { get: function () { return state.sourceEvaluations; } },
    effects: { value: effects, writable: false, enumerable: true, configurable: false },
    run: {
      value: function run(payloadJson, metaJson) {
        if (state.status === "running") throw new Error("effect job already running");
        state.status = "running";
        state.result = null;
        state.error = null;
        state.errorCode = null;
        state.errorOrigin = null;
        state.contaminated = false;
        const payload = JSON.parse(payloadJson);
        const jobMeta = Object.freeze(JSON.parse(metaJson));
        const jobFetch = makeJobFetch();
        const tools = Object.freeze({ fetch: jobFetch, meta: jobMeta });
        const effect = effects[jobMeta.effect];
        if (typeof effect !== "function") throw new Error("effect source is not installed");
        fetch = jobFetch;
        meta = jobMeta;
        return Promise.resolve()
          .then(function () { return effect(payload, tools); })
          .then(function (value) {
            const encoded = JSON.stringify(value);
            if (encoded === undefined) throw new TypeError("effect result is not JSON");
            state.result = encoded;
            state.status = "sent";
            cleanJobGlobals();
            fetch = undefined;
            meta = undefined;
            return value;
          })
          .catch(function (error) {
            state.error = errorText(error);
            state.errorCode = error && error.code ? String(error.code) : null;
            state.errorOrigin = error && error.origin ? String(error.origin) : null;
            state.status = "failed";
            cleanJobGlobals();
            fetch = undefined;
            meta = undefined;
          });
      },
    },
  });
  Object.freeze(api);
  Object.defineProperty(globalThis, "__snapback", {
    value: api,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  const installedGlobals = Object.getOwnPropertyNames(globalThis);
  for (let i = 0; i < installedGlobals.length; i++) {
    if (allowedGlobals.indexOf(installedGlobals[i]) === -1) {
      try { delete globalThis[installedGlobals[i]]; } catch (_) {}
    }
  }
  permanentGlobals = Object.getOwnPropertyNames(globalThis);
  // Effects do not load modules after boot. Combined with Ibex 2's harden()
  // pass, a non-extensible global is fully frozen before any job runs.
  Object.preventExtensions(globalThis);
})();
