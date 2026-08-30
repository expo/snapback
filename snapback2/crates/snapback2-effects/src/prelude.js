// Snapback 2 effect compartment. Rust inserts the vendored Ibex 2 factory
// expression at the marker below.
(function () {
  "use strict";

  const saved = globalThis.__sb_saved;
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

  function fetch(input, init) {
    return grantedFetch.apply(undefined, arguments).catch(function (error) {
      const message = error && error.message ? String(error.message) : String(error);
      if (message.indexOf("denied: net.fetch") !== -1) {
        let origin = String(input);
        try { origin = new URL(String(input)).origin; } catch (_) {}
        throw new Error("denied: net.fetch " + origin + "; declare " + origin);
      }
      throw error;
    });
  }

  const state = {
    status: "idle",
    result: null,
    error: null,
    contaminated: false,
  };
  let permanentGlobals = [];

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
    contaminated: { get: function () { return state.contaminated; } },
    run: {
      value: function run(effectFactory, payload, meta) {
        if (state.status === "running") throw new Error("effect job already running");
        state.status = "running";
        state.result = null;
        state.error = null;
        state.contaminated = false;
        // The host nests the compiled function expression inside this factory.
        // Calling it here gives one-parameter effects lexical `fetch` and
        // `meta`; two-parameter effects receive the same values explicitly.
        const effect = effectFactory(fetch, meta);
        return Promise.resolve()
          .then(function () { return effect(payload, { fetch: fetch, meta: meta }); })
          .then(function (value) {
            const encoded = JSON.stringify(value);
            if (encoded === undefined) throw new TypeError("effect result is not JSON");
            state.result = encoded;
            state.status = "sent";
            cleanJobGlobals();
            return value;
          })
          .catch(function (error) {
            state.error = errorText(error);
            state.status = "failed";
            cleanJobGlobals();
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
  permanentGlobals = Object.getOwnPropertyNames(globalThis);
  // Effects do not load modules after boot. Combined with Ibex 2's harden()
  // pass, a non-extensible global is fully frozen before any job runs.
  Object.preventExtensions(globalThis);
})();
