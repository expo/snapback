// Snapback 2 effect compartment. Rust inserts the vendored Ibex 2 factory
// expression at the marker below. The IIFE returns exactly one host entry;
// Rust captures it once and removes the temporary global before hardening.
// @ref LLP 1003#3-the-runtime-snapback2-effects — host commands and timer delivery stay behind closure capabilities.
(function () {
  "use strict";

  const hostToken = __SNAPBACK_HOST_TOKEN__;
  const saved = globalThis.__sb_saved;
  const allowedGlobals = __SNAPBACK_ALLOWED_GLOBALS__;
  const fireTimer = globalThis.__ibex2_fire_timer;
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
    token: null,
    result: null,
    error: null,
    errorCode: null,
    contaminated: false,
    sourceEvaluations: 0,
  };
  let permanentGlobals = [];
  const timerToken = Object.freeze({});
  let timerPermit = null;
  let installedEntry = null;

  // Ibex 2's C++ pump must resolve this function by its global name. Keep the
  // name, but require a closure-held permit armed by the Rust host. Consuming
  // the permit while the real callback runs prevents job code inside a timer
  // callback from recursively firing another handle.
  const guardedFireTimer = Object.freeze(function __ibex2_fire_timer(handle) {
    if (handle === hostToken) {
      const command = arguments[1];
      if (command === "install") {
        if (installedEntry !== null) {
          throw new Error("E_EFFECT_HOST_CHANNEL: host entry already installed");
        }
        const candidate = arguments[2];
        if (typeof candidate !== "function") {
          throw new TypeError("E_EFFECT_HOST_CHANNEL: host entry is not a function");
        }
        installedEntry = candidate;
        return;
      }
      if (installedEntry === null) {
        throw new Error("E_EFFECT_HOST_CHANNEL: host entry is not installed");
      }
      return installedEntry.apply(
        undefined,
        Array.prototype.slice.call(arguments, 1)
      );
    }
    if (timerPermit !== timerToken) {
      throw new Error("effect jobs cannot fire Ibex timers");
    }
    timerPermit = null;
    try {
      return fireTimer(handle);
    } finally {
      timerPermit = timerToken;
    }
  });
  Object.freeze(fireTimer);
  Object.defineProperty(globalThis, "__ibex2_fire_timer", {
    value: guardedFireTimer,
    writable: false,
    enumerable: false,
    configurable: false,
  });

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

  function resultError() {
    const error = new TypeError("E_EFFECT_RESULT");
    error.code = "E_EFFECT_RESULT";
    return error;
  }

  function run(jobToken, payloadJson, metaJson) {
    if (state.status === "running") throw new Error("effect job already running");
    state.status = "running";
    state.token = String(jobToken);
    state.result = null;
    state.error = null;
    state.errorCode = null;
    state.contaminated = false;
    const payload = JSON.parse(payloadJson);
    const jobMeta = Object.freeze(JSON.parse(metaJson));
    const jobFetch = makeJobFetch();
    const tools = Object.freeze({ fetch: jobFetch, meta: jobMeta });
    const effect = effects[jobMeta.effect];
    if (typeof effect !== "function") throw new Error("effect source is not installed");
    fetch = jobFetch;
    meta = jobMeta;
    let effectResult;
    try {
      // Invoke synchronously while the timer permit is disarmed. The returned
      // promise is what the host pumps after it arms real timer delivery.
      effectResult = effect(payload, tools);
    } catch (error) {
      effectResult = Promise.reject(error);
    }
    return Promise.resolve(effectResult)
      .then(function (value) {
        let encoded;
        if (value === undefined) {
          encoded = "null";
        } else {
          try {
            encoded = JSON.stringify(value);
          } catch (error) {
            throw resultError(error);
          }
          if (encoded === undefined) throw resultError();
        }
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
        state.status = "failed";
        cleanJobGlobals();
        fetch = undefined;
        meta = undefined;
      });
  }

  function read(jobToken) {
    if (String(jobToken) !== state.token) {
      const error = new Error("E_EFFECT_RESULT");
      error.code = "E_EFFECT_RESULT";
      throw error;
    }
    return {
      token: state.token,
      status: state.status,
      result: state.result,
      error: state.error,
      errorCode: state.errorCode,
      contaminated: state.contaminated,
      sourceEvaluations: state.sourceEvaluations,
      effectFrozen: Object.isFrozen(effects) && Object.isFrozen(compiledEffect),
    };
  }

  function armTimers() {
    timerPermit = timerToken;
  }

  function disarmTimers() {
    timerPermit = null;
  }

  const installedGlobals = Object.getOwnPropertyNames(globalThis);
  for (let i = 0; i < installedGlobals.length; i++) {
    if (allowedGlobals.indexOf(installedGlobals[i]) === -1) {
      try { delete globalThis[installedGlobals[i]]; } catch (_) {}
    }
  }
  permanentGlobals = Object.getOwnPropertyNames(globalThis);
  Object.freeze(run);
  Object.freeze(read);
  Object.freeze(armTimers);
  Object.freeze(disarmTimers);
  const hostEntry = Object.freeze(function hostEntry(command) {
    const args = Array.prototype.slice.call(arguments, 1);
    switch (command) {
      case "run": return run.apply(undefined, args);
      case "read": return read.apply(undefined, args);
      case "armTimers": return armTimers();
      case "disarmTimers": return disarmTimers();
      default: throw new Error("E_EFFECT_HOST_CHANNEL: unknown host command");
    }
  });
  return hostEntry;
})();
