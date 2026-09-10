// Snapback 2 effect compartment. Rust inserts the vendored Ibex 2 factory
// expression at the marker below. The IIFE returns exactly one host entry;
// Rust captures it once and removes the temporary global before hardening.
// Effect source is evaluated later, by a separate top-level host eval, so it
// cannot resolve any of this prelude's privileged lexical state.
// @ref LLP 1003#3-the-runtime-snapback2-effects — host commands and timer delivery stay behind closure capabilities.
(function () {
  "use strict";

  const hostToken = __SNAPBACK_HOST_TOKEN__;
  const effectName = __SNAPBACK_EFFECT_NAME__;
  const saved = globalThis.__sb_saved;
  const allowedGlobals = __SNAPBACK_ALLOWED_GLOBALS__;
  const fireTimer = globalThis.__ibex2_fire_timer;
  const scheduleTimer = globalThis.setTimeout;
  const NativeReferenceError = globalThis.ReferenceError;
  globalThis.__ibex2_response_field = saved.field;
  globalThis.__ibex2_response_read = saved.read;
  globalThis.__ibex2_fetch_control = saved.control;
  globalThis.__ibex2_text_decode = saved.decode;
  globalThis.__ibex2_text_encode = saved.encode;
  globalThis.__ibex2_text_encode_into = saved.encodeInto;

  // The factory captures the restored accessors and deletes them itself.
  // A body streams in after its fetch resolved, so its reads count as the
  // job's pending network I/O alongside the fetches themselves.
  const provider = globalThis.__sb_provider;
  delete globalThis.__sb_provider;
  const makeFetch = __SNAPBACK_FETCH_FACTORY__;
  const trackBodyRead = function (delta) { state.pendingFetches += delta; };
  const grantedFetch = makeFetch(globalThis.__ibex2_fetch, tagRawGrantError, trackBodyRead, !!provider);
  delete globalThis.__ibex2_fetch;
  delete globalThis.__sb_saved;
  // Effects never load ESM, so its lowering-only helpers have no job here.
  delete globalThis.__ibex2_default;
  delete globalThis.__ibex2_dynamic_import;
  delete globalThis.__ibex2_export_all;

  const state = {
    status: "idle",
    token: null,
    result: null,
    error: null,
    errorCode: null,
    failureKind: null,
    thrownError: null,
    contaminated: false,
    sourceEvaluations: 0,
    pendingFetches: 0,
  };
  // Failure classification is an isolation decision, not application data.
  // Only errors created inside this closure can enter either identity set.
  const deniedErrors = new WeakSet();
  const resultErrors = new WeakSet();
  let permanentGlobals = [];
  let timerPermit = 0;
  let installedEntry = null;
  let compiledEffect = null;
  let jobFetchBinding;
  let jobMetaBinding;
  const timerDeadlines = Object.create(null);

  // The compiler's one-parameter form resolves only these two job-scoped
  // accessors from the hardened global. Their capability values are never
  // installed as mutable global properties and are cleared at settlement.
  Object.defineProperty(globalThis, "fetch", {
    get: Object.freeze(function () { return jobFetchBinding; }),
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(globalThis, "meta", {
    get: Object.freeze(function () { return jobMetaBinding; }),
    enumerable: false,
    configurable: false,
  });

  function timerKey(handle) {
    return String(handle);
  }

  // The timer wrapper records only scheduling state, never authority. Handles
  // remain inside the prelude closure so the host can distinguish quiescence
  // from a settled job that left work behind.
  const trackedSetTimeout = Object.freeze(function setTimeout(callback, delay) {
    const handle = scheduleTimer.apply(undefined, arguments);
    let millis = 0;
    try {
      const number = Number(delay);
      if (isFinite(number) && number > 0) millis = number;
    } catch (_) {}
    timerDeadlines[timerKey(handle)] = Date.now() + millis;
    return handle;
  });
  Object.freeze(scheduleTimer);
  Object.defineProperty(globalThis, "setTimeout", {
    value: trackedSetTimeout,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  function tagRawGrantError(error, attemptedUrl) {
    const message = error && error.message ? String(error.message) : String(error);
    // The test owner's bound transport refuses an unbound origin in front of
    // the raw binding; tagged here, from this closure, it is terminal like a
    // grant denial, and application code cannot forge it: only a raw
    // rejection reaches this function.
    // @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — `E_EFFECT_UNBOUND` is a terminal failure, never external transport.
    if (message.indexOf("E_EFFECT_UNBOUND: ") === 0) {
      const unbound = new Error(message);
      unbound.code = "E_EFFECT_UNBOUND";
      try { unbound.origin = new URL(String(attemptedUrl)).origin; } catch (_) {}
      deniedErrors.add(unbound);
      return unbound;
    }
    if (message !== "denied: net.fetch") return error;
    let origin = String(attemptedUrl);
    try { origin = new URL(origin).origin; } catch (_) {}
    const tagged = new Error("denied: net.fetch " + origin + "; declare " + origin);
    tagged.code = "E_EFFECT_GRANT";
    tagged.origin = origin;
    deniedErrors.add(tagged);
    return tagged;
  }

  function makeJobFetch() {
    // The capability-bearing function handed to application code is a fresh
    // wrapper each job. Project code can neither contaminate another job's
    // function object nor mutate this one.
    const boundFetch = grantedFetch.bind(undefined);
    const jobFetch = function fetch(input, init) {
      state.pendingFetches++;
      let pending;
      try {
        pending = boundFetch.apply(undefined, arguments);
      } catch (error) {
        state.pendingFetches--;
        return Promise.reject(error);
      }
      return pending.then(
        function (value) {
          state.pendingFetches--;
          return value;
        },
        function (error) {
          state.pendingFetches--;
          throw error;
        }
      );
    };
    Object.freeze(boundFetch);
    return Object.freeze(jobFetch);
  }

  // Ibex 2's C++ pump must resolve this function by its global name. The host
  // arms one permit immediately before each pump call; the first timer entry
  // consumes it. Application microtasks in the same pump therefore cannot use
  // a captured alias to deliver a second handle.
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
    if (timerPermit !== 1) {
      throw new Error("effect jobs cannot fire Ibex timers");
    }
    timerPermit = 0;
    const key = timerKey(handle);
    if (timerDeadlines[key] === undefined || timerDeadlines[key] > Date.now()) {
      throw new Error("effect jobs cannot fire Ibex timers");
    }
    delete timerDeadlines[key];
    return fireTimer(handle);
  });
  Object.freeze(fireTimer);
  Object.defineProperty(globalThis, "__ibex2_fire_timer", {
    value: guardedFireTimer,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  function installEffect(candidate) {
    if (compiledEffect !== null) {
      throw new Error("E_EFFECT_HOST_CHANNEL: effect already installed");
    }
    if (typeof candidate !== "function") {
      throw new TypeError("effect source did not evaluate to a function");
    }
    Object.freeze(candidate);
    compiledEffect = candidate;
    state.sourceEvaluations++;
  }

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
    try {
      if (error && error.stack) return String(error.stack);
      if (error && error.message) return String(error.message);
      return String(error);
    } catch (_) {
      return "effect failed";
    }
  }

  function errorCode(error) {
    try {
      return error && error.code ? String(error.code) : null;
    } catch (_) {
      return null;
    }
  }

  function errorMessage(error, fallback) {
    try {
      return String(error && error.message ? error.message : fallback);
    } catch (_) {
      return fallback;
    }
  }

  function resultError(message) {
    const error = new TypeError(message || "E_EFFECT_RESULT");
    error.code = "E_EFFECT_RESULT";
    resultErrors.add(error);
    return error;
  }

  function recordedBy(errors, value) {
    return value !== null
      && (typeof value === "object" || typeof value === "function")
      && errors.has(value);
  }

  function isReferenceFailure(value) {
    try {
      return typeof NativeReferenceError === "function"
        && value instanceof NativeReferenceError;
    } catch (_) {
      return false;
    }
  }

  function isJsonResult(value, stack) {
    const kind = typeof value;
    if (kind === "undefined" || kind === "function" || kind === "symbol" || kind === "bigint") {
      return false;
    }
    if (kind === "number" && !isFinite(value)) return false;
    if (value === null || kind !== "object") return true;
    if (stack.has(value)) return false;
    stack.add(value);
    const names = Object.keys(value);
    for (let i = 0; i < names.length; i++) {
      if (!isJsonResult(value[names[i]], stack)) {
        stack.delete(value);
        return false;
      }
    }
    stack.delete(value);
    return true;
  }

  function run(jobToken, payloadJson, metaJson) {
    if (state.status === "running") throw new Error("effect job already running");
    if (compiledEffect === null) throw new Error("effect source is not installed");
    state.status = "running";
    state.token = String(jobToken);
    state.result = null;
    state.error = null;
    state.errorCode = null;
    state.failureKind = null;
    state.thrownError = null;
    state.contaminated = false;
    state.pendingFetches = 0;
    if (provider) provider(true);
    let effectResult;
    try {
      const payload = JSON.parse(payloadJson);
      const jobMeta = Object.freeze(JSON.parse(metaJson));
      if (jobMeta.effect !== effectName) throw new Error("effect source is not installed");
      const jobFetch = makeJobFetch();
      const tools = Object.freeze({ fetch: jobFetch, meta: jobMeta });
      jobFetchBinding = jobFetch;
      jobMetaBinding = jobMeta;
      // Invoke synchronously while the timer permit is disarmed. The returned
      // promise is what the host drives with one separately armed pump at a time.
      effectResult = compiledEffect(payload, tools);
    } catch (error) {
      effectResult = Promise.reject(error);
    }
    return Promise.resolve(effectResult)
      .then(function (value) {
        if (value === undefined) {
          throw resultError("E_EFFECT_RESULT: effect returned undefined; return null explicitly");
        }
        let encoded;
        try {
          if (!isJsonResult(value, new Set())) throw resultError();
          encoded = JSON.stringify(value);
        } catch (error) {
          if (recordedBy(resultErrors, error)) throw error;
          throw resultError();
        }
        if (encoded === undefined) throw resultError();
        state.result = encoded;
        state.status = "sent";
        state.thrownError = null;
        cleanJobGlobals();
        jobFetchBinding = undefined;
        jobMetaBinding = undefined;
        return value;
      })
      .catch(function (error) {
        // Settle and revoke job capabilities before inspecting application
        // error fields so even hostile accessors cannot strand shared state.
        state.thrownError = error;
        state.status = "failed";
        jobFetchBinding = undefined;
        jobMetaBinding = undefined;
        const referenceFailure = isReferenceFailure(error);
        const resultFailure = recordedBy(resultErrors, error);
        // Classified once, here, from closure-held identity, and carried by
        // the snapshot that reports the failure: the host learns it with the
        // settlement and needs no entrance of its own — none the deadline
        // could refuse after the job has already failed.
        state.failureKind = recordedBy(deniedErrors, error) ? "grant"
          : (resultFailure || referenceFailure) ? "result"
          : "retryable";
        state.errorCode = errorCode(error)
          || (referenceFailure ? "E_EFFECT_RESULT" : null);
        if (resultFailure || referenceFailure) {
          state.error = referenceFailure
            ? "E_EFFECT_RESULT: " + errorText(error)
            : errorMessage(error, "E_EFFECT_RESULT");
        } else {
          state.error = errorText(error);
        }
        cleanJobGlobals();
      });
  }

  function timerSnapshot() {
    const names = Object.keys(timerDeadlines);
    if (names.length === 0) return { count: 0, next: null };
    const now = Date.now();
    let next = null;
    for (let i = 0; i < names.length; i++) {
      const remaining = Math.max(0, timerDeadlines[names[i]] - now);
      if (next === null || remaining < next) next = remaining;
    }
    return { count: names.length, next };
  }

  function read(jobToken) {
    if (String(jobToken) !== state.token) {
      const error = new Error("E_EFFECT_RESULT");
      error.code = "E_EFFECT_RESULT";
      throw error;
    }
    const timers = timerSnapshot();
    return {
      token: state.token,
      status: state.status,
      provider: provider ? provider(false) : null,
      result: state.result,
      error: state.error,
      errorCode: state.errorCode,
      failureKind: state.failureKind,
      contaminated: state.contaminated,
      sourceEvaluations: state.sourceEvaluations,
      effectFrozen: compiledEffect !== null && Object.isFrozen(compiledEffect),
      pendingFetches: state.pendingFetches,
      pendingTimers: timers.count,
      nextTimerDelay: timers.next,
    };
  }

  function armTimers() {
    timerPermit = 1;
  }

  function disarmTimers() {
    timerPermit = 0;
  }

  const installedGlobals = Object.getOwnPropertyNames(globalThis);
  for (let i = 0; i < installedGlobals.length; i++) {
    if (allowedGlobals.indexOf(installedGlobals[i]) === -1) {
      try { delete globalThis[installedGlobals[i]]; } catch (_) {}
    }
  }
  permanentGlobals = Object.getOwnPropertyNames(globalThis);
  Object.freeze(installEffect);
  Object.freeze(run);
  Object.freeze(read);
  Object.freeze(armTimers);
  Object.freeze(disarmTimers);
  const hostEntry = Object.freeze(function hostEntry(command) {
    const args = Array.prototype.slice.call(arguments, 1);
    switch (command) {
      case "installEffect": return installEffect.apply(undefined, args);
      case "run": return run.apply(undefined, args);
      case "read": return read.apply(undefined, args);
      case "armTimers": return armTimers();
      case "disarmTimers": return disarmTimers();
      default: throw new Error("E_EFFECT_HOST_CHANNEL: unknown host command");
    }
  });
  return hostEntry;
})();
