// The single-sourced handler-invocation server (LLP 0048 §Architecture): the
// fetch default export both the local twin's entry.mjs and the LLP 0040
// Cloudflare handler Worker compose in, after the ordering-critical harness
// init (trusted server/strip → allowlist → ctx bootstrap → app/handler
// module). It performs one invocation, settles it to the tagged completion
// envelope, drains detached work to quiescence, and reports the
// unhandled-rejection sweep — engine-neutral, host-agnostic. Host powers
// reach the isolate only through the HOST service binding; the routing
// headers the host needs to reach the right instance ride `body.hostHeaders`
// (the twin passes none, the Cloudflare target passes the coordinator
// Durable Object id). This module evaluates before handler.mjs and owns every
// destructive control-plane primitive lexically. Application modules can
// import this module's default fetch object, so that service is frozen before
// application evaluation; no ledger or intrinsic bag is exported from it.
// @ref LLP 0048#review-hardening-2026-07-07-eng-23574eng-23593 — the trusted
// module boundary and unforgeable settlement channel are one security seam.
import { consumeTrustedIntrinsics } from "./strip.mjs";

const kept = consumeTrustedIntrinsics();
if (!kept) {
  throw new Error("SNAPBACK_HANDLER_HARNESS_INIT_FAILED: trusted intrinsics already consumed");
}

const Response = kept.Response;
const URL = kept.URL;
// Above the platform's 4 MB application-request ceiling so schema/value
// diagnostics remain authoritative, while still bounding this private seam.
const MAX_INVOKE_BODY_BYTES = 8 * 1024 * 1024;
const RESPONSE_TOKEN_HEADER = "x-snapback-response-token";

// Response objects cross async Promise resolution after handler code has run.
// Pin an own non-then property before application evaluation so poisoning
// Object.prototype.then cannot intercept the genuine authenticated Response,
// recover its constructor/headers, and replace its body with forged success.
kept.defineProperty(Response.prototype, "then", {
  value: undefined,
  configurable: false,
  writable: false,
});
const responseThen = kept.getOwnPropertyDescriptor(Response.prototype, "then");
if (!responseThen || responseThen.value !== undefined || responseThen.configurable) {
  throw new kept.Error(
    "SNAPBACK_HANDLER_HARNESS_INIT_FAILED: Response thenability could not be sealed"
  );
}

// Native Promise.prototype.then consults both `promise.constructor` and
// `constructor[Symbol.species]` even when its returned promise is ignored.
// Pin those two dispatch points before application evaluation; otherwise one
// invocation could install an attacker constructor that the harness calls on
// the next invocation while observing its own trusted promise chain.
kept.defineProperty(kept.promisePrototype, "constructor", {
  value: kept.Promise,
  configurable: false,
  writable: false,
});
kept.defineProperty(kept.Promise, kept.promiseSpecies, {
  get: kept.promiseSpeciesGetter,
  configurable: false,
});
const promiseConstructor = kept.getOwnPropertyDescriptor(
  kept.promisePrototype,
  "constructor"
);
const promiseSpecies = kept.getOwnPropertyDescriptor(
  kept.Promise,
  kept.promiseSpecies
);
if (
  !promiseConstructor ||
  promiseConstructor.value !== kept.Promise ||
  promiseConstructor.configurable ||
  !promiseSpecies ||
  promiseSpecies.get !== kept.promiseSpeciesGetter ||
  promiseSpecies.configurable
) {
  throw new kept.Error(
    "SNAPBACK_HANDLER_HARNESS_INIT_FAILED: Promise species could not be sealed"
  );
}

// V8-leg unhandled-rejection ledger. This used to live in a sibling module
// with an exported destructive take(), which handler.mjs could import by name.
// Keep the Map and its drain in this module closure; only the fetch server below
// can consume entries.
const rejectionLedger = new kept.Map();
let rejectionDetectionSupported = false;
try {
  if (typeof kept.addEventListener === "function") {
    kept.addEventListener("unhandledrejection", (event) => {
      kept.reflectApply(kept.mapSet, rejectionLedger, [event.promise, event.reason]);
      try {
        kept.reflectApply(kept.eventPreventDefault, event, []);
      } catch (_) {}
    });
    kept.addEventListener("rejectionhandled", (event) => {
      kept.reflectApply(kept.mapDelete, rejectionLedger, [event.promise]);
    });
    rejectionDetectionSupported = true;
  }
} catch (_) {
  rejectionDetectionSupported = false;
}

function describeRejectionReason(reason) {
  try {
    if (reason && typeof reason === "object" && reason.message) {
      return kept.String(reason.message);
    }
    return kept.String(reason);
  } catch (_) {
    return "unserializable rejection reason";
  }
}

function takeUnhandledRejections() {
  const rejections = [];
  kept.reflectApply(kept.mapForEach, rejectionLedger, [
    (reason) => {
      rejections[rejections.length] = describeRejectionReason(reason);
    },
  ]);
  kept.reflectApply(kept.mapClear, rejectionLedger, []);
  const snapshot = kept.objectCreate(null);
  snapshot.supported = rejectionDetectionSupported;
  snapshot.rejections = rejections;
  return snapshot;
}

function trustedThen(promise, onFulfilled, onRejected) {
  return kept.reflectApply(kept.promiseThen, promise, [onFulfilled, onRejected]);
}

function trustedResolve(value) {
  return kept.reflectApply(kept.promiseResolve, kept.Promise, [value]);
}

function setSize(set) {
  return kept.reflectApply(kept.setSizeGetter, set, []);
}

function setValues(set) {
  const values = [];
  kept.reflectApply(kept.setForEach, set, [
    (value) => { values[values.length] = value; },
  ]);
  return values;
}

function safeJsonValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (kept.arrayIsArray(value)) {
    const copy = [];
    kept.objectSetPrototypeOf(copy, null);
    for (let i = 0; i < value.length; i++) copy[i] = safeJsonValue(value[i]);
    return copy;
  }
  const copy = kept.objectCreate(null);
  const keys = kept.objectKeys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    copy[key] = safeJsonValue(value[key]);
  }
  return copy;
}

function promiseRecord(key, value) {
  const record = kept.objectCreate(null);
  record[key] = value;
  return record;
}

// One timer starts before the handler runs and remains armed through the
// detached-work drain. Reusing that same promise makes every later await
// consume the invocation's REMAINING budget instead of accidentally granting
// a fresh full timeout after the handler promise settles. The private abort
// signal also cancels HOST fetches when the budget expires, so a deployed
// isolate does not retain a transport that the invocation has abandoned.
function createInvocationDeadline(timeoutMs) {
  const deadline = kept.objectCreate(null);
  deadline.expired = false;
  deadline.timer = null;
  deadline.timeout = null;
  deadline.controller = null;
  deadline.signal = null;
  if (!(timeoutMs > 0) || !kept.setTimeout) return deadline;

  if (
    kept.AbortController &&
    kept.abortControllerAbort &&
    kept.abortControllerSignalGetter
  ) {
    deadline.controller = new kept.AbortController();
    deadline.signal = kept.reflectApply(
      kept.abortControllerSignalGetter,
      deadline.controller,
      []
    );
  }
  deadline.timeout = new kept.Promise((resolve) => {
    deadline.timer = kept.setTimeout(() => {
      deadline.expired = true;
      // Resolve the private deadline race first, then abort transport I/O.
      // Both effects happen in this task; this ordering makes the timeout
      // verdict deterministic even if abort rejection settles a tracked call.
      resolve();
      if (deadline.controller) {
        try {
          kept.reflectApply(
            kept.abortControllerAbort,
            deadline.controller,
            []
          );
        } catch (_) {}
      }
    }, timeoutMs);
  });
  return deadline;
}

function cancelInvocationDeadline(deadline) {
  if (deadline.timer !== null && kept.clearTimeout) {
    kept.clearTimeout(deadline.timer);
  }
  deadline.timer = null;
}

function withinInvocationDeadline(promise, deadline, resultKey) {
  // Always return a genuine harness-owned Promise. The source promise and the
  // shared deadline race only through captured native then, never mutable
  // Promise.race/species machinery.
  return new kept.Promise((resolve, reject) => {
    let completed = false;
    trustedThen(
      promise,
      (value) => {
        if (completed) return;
        completed = true;
        resolve(
          deadline.expired
            ? promiseRecord("didNotSettle", true)
            : promiseRecord(resultKey, value)
        );
      },
      (error) => {
        if (completed) return;
        completed = true;
        if (deadline.expired) {
          resolve(promiseRecord("didNotSettle", true));
        } else {
          reject(error);
        }
      }
    );
    if (deadline.timeout) {
      trustedThen(deadline.timeout, () => {
        if (completed) return;
        completed = true;
        resolve(promiseRecord("didNotSettle", true));
      });
    }
  });
}

function json(status, value, responseToken) {
  // The application can mutate Object/Array prototypes. Copy internal
  // response data onto prototype-free containers and use the pre-handler
  // stringify intrinsic so inherited toJSON hooks cannot forge this channel.
  const headers = kept.objectCreate(null);
  headers["content-type"] = "application/json";
  if (responseToken) headers[RESPONSE_TOKEN_HEADER] = responseToken;
  const options = kept.objectCreate(null);
  options.status = status;
  options.headers = headers;
  return new Response(kept.jsonStringify(safeJsonValue(value)), options);
}

function header(request, name) {
  const headers = kept.reflectApply(kept.requestHeadersGetter, request, []);
  return kept.reflectApply(kept.headersGet, headers, [name]);
}

async function readBoundedJson(request) {
  const declared = header(request, "content-length");
  if (declared !== null) {
    if (!kept.reflectApply(kept.regExpTest, /^[0-9]+$/, [declared])) {
      throw new kept.Error("invoke content-length was invalid");
    }
    if (kept.Number(declared) > MAX_INVOKE_BODY_BYTES) {
      const error = new kept.Error("invoke body exceeded the transport limit");
      kept.defineProperty(error, "tooLarge", { value: true });
      throw error;
    }
  }
  const stream = kept.reflectApply(kept.requestBodyGetter, request, []);
  if (!stream) return kept.objectCreate(null);
  const reader = kept.reflectApply(kept.streamGetReader, stream, []);
  const chunks = [];
  let total = 0;
  for (;;) {
    const next = await kept.reflectApply(kept.readerRead, reader, []);
    if (next.done) break;
    const chunkLength = kept.reflectApply(
      kept.typedArrayByteLengthGetter,
      next.value,
      []
    );
    total += chunkLength;
    if (total > MAX_INVOKE_BODY_BYTES) {
      try { await kept.reflectApply(kept.readerCancel, reader, []); } catch (_) {}
      const error = new kept.Error("invoke body exceeded the transport limit");
      kept.defineProperty(error, "tooLarge", { value: true });
      throw error;
    }
    chunks[chunks.length] = next.value;
  }
  const bytes = new kept.Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    kept.reflectApply(kept.uint8ArraySet, bytes, [chunk, offset]);
    offset += kept.reflectApply(kept.typedArrayByteLengthGetter, chunk, []);
  }
  const decoder = new kept.TextDecoder("utf-8", { fatal: true });
  const text = kept.reflectApply(kept.textDecoderDecode, decoder, [bytes]);
  // A prior invocation may have poisoned Object.prototype.then. Returning the
  // ordinary object produced by JSON.parse from this async function would let
  // Promise resolution assimilate that inherited then hook before fetch sees
  // the request. Deep-copy the transport record onto prototype-free objects.
  return safeJsonValue(kept.jsonParse(text));
}

// Isolate-local invocation mutex. The local twin runs one process per
// invocation, but a deployed Worker isolate can interleave /invoke requests —
// and the rejection ledger, the microtask drain, and the sweep are all
// isolate-global observations. One invocation at a time makes those
// observations attributable: a swept rejection belongs to the invocation
// that just ran (ENG-23574 / ENG-23585).
let invocationChain = trustedResolve();

const handlerServer = {
  async fetch(request, env) {
    const responseToken = kept.String(env.SNAPBACK_RESPONSE_TOKEN || "");
    const respond = (status, value) => json(status, value, responseToken);
    const requestUrl = kept.reflectApply(kept.requestUrlGetter, request, []);
    const requestMethod = kept.reflectApply(kept.requestMethodGetter, request, []);
    const url = new URL(requestUrl);
    const pathname = kept.reflectApply(kept.urlPathnameGetter, url, []);
    if (requestMethod === "GET" && pathname === "/__snapback/health") {
      const searchParams = kept.reflectApply(kept.urlSearchParamsGetter, url, []);
      return respond(200, {
        ok: true,
        harness: "snapback-workerd-v8",
        nonce:
          kept.reflectApply(kept.urlSearchParamsGet, searchParams, ["nonce"]) || "",
      });
    }
    if (pathname !== "/invoke") {
      return respond(404, { fatal: "unknown harness route" });
    }
    if (requestMethod !== "POST") {
      return respond(405, { fatal: "invoke requires POST" });
    }
    // A Cloudflare service binding is already an invocation capability. The
    // local workerd socket is not, so its generated config supplies this
    // bearer and the server authenticates it before reading or allocating
    // the request body.
    const expectedInvokeToken = kept.String(env.SNAPBACK_INVOKE_TOKEN || "");
    if (
      expectedInvokeToken &&
      header(request, "x-snapback-invoke-token") !== expectedInvokeToken
    ) {
      return respond(401, { fatal: "invoke transport authentication failed" });
    }
    let body;
    try {
      body = await readBoundedJson(request);
    } catch (error) {
      if (error && error.tooLarge) {
        return respond(413, { fatal: "invoke body exceeded the transport limit" });
      }
      return respond(400, { fatal: "invoke body was not valid JSON" });
    }
    const run = trustedThen(invocationChain, () => invoke(body, env, responseToken));
    invocationChain = trustedThen(
      run,
      () => undefined,
      () => undefined
    );
    return run;
  },
};

// The application module is a later sibling in the same ESM graph and can
// import this module by name. Seal the service object before that module
// evaluates: otherwise it could replace `fetch`, receive the Workerd `env`
// bindings directly, and bypass every invocation/host/response capability.
// Use the pre-application intrinsic because handler code may poison
// `Object.freeze` after initialization.
kept.objectFreeze(handlerServer);
const handlerFetchDescriptor = kept.getOwnPropertyDescriptor(
  handlerServer,
  "fetch"
);
if (
  !handlerFetchDescriptor ||
  handlerFetchDescriptor.writable ||
  handlerFetchDescriptor.configurable
) {
  throw new kept.Error(
    "SNAPBACK_HANDLER_HARNESS_INIT_FAILED: service fetch could not be sealed"
  );
}
export default handlerServer;

async function invoke(body, env, responseToken) {
  // Hygiene for the pathological bail-out path below: if a previous
  // invocation gave up on a never-quiescing detached chain, its leftovers
  // may have settled into the isolate-global ledger since. They are not this
  // invocation's rejections — discard them before running (ENG-23585).
  takeUnhandledRejections();
  const deadline = createInvocationDeadline(
    kept.Number(body.settlementTimeoutMs || 0)
  );
  if (!deadline.timeout || !deadline.signal) {
    cancelInvocationDeadline(deadline);
    return json(200, {
      fatal: "invocation deadline or HOST abort capability unavailable",
    }, responseToken);
  }
  const deadlineResponse = (phase) => {
    cancelInvocationDeadline(deadline);
    return json(200, {
      didNotSettle: true,
      deadlinePhase: phase,
      unhandledRejections: [],
      rejectionDetectionSupported: true,
    }, responseToken);
  };
  const token = kept.String(env.SNAPBACK_HOST_TOKEN || body.token || "");
  const hostHeaders =
    body.hostHeaders && typeof body.hostHeaders === "object"
      ? body.hostHeaders
      : {};

  // Outstanding host-call round trips launched by THIS invocation — the
  // drain below waits on them, so a detached chain parked on a host call can
  // still reject before the sweep (ENG-23584).
  const inFlight = new kept.Set();

  // The host-call transport is invocation-local: it is handed to the sealed
  // __snapbackSettle helper rather than read from a mutable global at call
  // time, so an overlapping invocation can never swap the token/routing out
  // from under an in-flight continuation (ENG-23574 / ENG-24339).
  const hostCall = function (rawOp, argsJson) {
    const headers = kept.objectCreate(null);
    headers["content-type"] = "application/json";
    headers["x-snapback-host-token"] = token;
    const hostHeaderKeys = kept.objectKeys(hostHeaders);
    for (let i = 0; i < hostHeaderKeys.length; i++) {
      const key = hostHeaderKeys[i];
      headers[key] = kept.String(hostHeaders[key]);
    }
    const hostBody = kept.objectCreate(null);
    hostBody.rawOp = kept.String(rawOp);
    hostBody.argsJson = kept.String(argsJson);
    const hostOptions = kept.objectCreate(null);
    hostOptions.method = "POST";
    hostOptions.headers = headers;
    hostOptions.body = kept.jsonStringify(hostBody);
    if (deadline.signal) hostOptions.signal = deadline.signal;
    // The host-call seam lives inside the reserved system namespace on every
    // arm (LLP 0031 invariant; hosted migration LLP 0094 §0A.3) — the local
    // loopback listener and the Cloudflare gateway accept the same path.
    const fetched = env.HOST.fetch("http://snapback-host/_snapback/host-call", hostOptions);
    const decoded = trustedThen(fetched, (response) =>
      kept.reflectApply(kept.responseJson, response, [])
    );
    const call = trustedThen(decoded, (data) => {
        if (!data.ok) {
          const code = data.code || "SNAPBACK_HANDLER_HOST_CALL_FAILED";
          const error = new kept.Error(code + ": " + (data.message || "host call failed"));
          try {
            kept.defineProperty(error, "__snapbackCode", { value: code });
          } catch (_) {
            error.__snapbackCode = code;
          }
          throw error;
        }
        return data.value === undefined ? null : data.value;
      });
    const tracked = trustedThen(
      call,
      () => {},
      () => {}
    );
    kept.reflectApply(kept.setAdd, inFlight, [tracked]);
    trustedThen(tracked, () => {
      kept.reflectApply(kept.setDelete, inFlight, [tracked]);
    });
    return call;
  };

  const settled = await withinInvocationDeadline(
    globalThis.__snapbackSettle(
      body.export,
      body.argsJson,
      body.authJson,
      body.mode,
      body.runJson,
      body.secretsJson,
      body.epoch,
      hostCall
    ),
    deadline,
    "envelope"
  );
  if (settled.didNotSettle) {
    return deadlineResponse("settlement");
  }
  const envelope = settled.envelope;

  // Drain to quiescence before the sweep (ENG-23584). A fixed microtask tick
  // count is not enough on this leg, twice over: host calls are real I/O
  // (env.HOST.fetch), so a detached chain parked on one rejects only after
  // the event loop delivers the response — and workerd defers the
  // `unhandledrejection` EVENT to a task boundary, so a rejection that has
  // already happened may not be in the ledger yet. The drain is therefore a
  // contract: keep going while this invocation has host calls in flight,
  // then keep yielding real tasks until a full round adds no ledger entries.
  // Only then has the sweep observed everything the invocation could still
  // do — the same quiescence point the Ibex host sweeps at, where
  // synchronous-FFI host calls make the engine's own drain sufficient.
  const macrotask = () =>
    kept.setTimeout
      ? new kept.Promise((resolve) => kept.setTimeout(resolve, 0))
      : trustedResolve();
  const rejections = [];
  let supported = true;
  for (;;) {
    while (setSize(inFlight) > 0) {
      // Every host call was started already; awaiting the snapshot by index
      // preserves concurrency without Promise.allSettled's dynamic constructor
      // and Array-iterator lookups, both mutable by handler code.
      const pending = setValues(inFlight);
      for (let i = 0; i < pending.length; i++) {
        const waited = await withinInvocationDeadline(
          pending[i],
          deadline,
          "value"
        );
        if (waited.didNotSettle) return deadlineResponse("quiescence");
      }
      for (let i = 0; i < 32; i++) {
        await trustedResolve();
      }
      if (deadline.expired) return deadlineResponse("quiescence");
    }
    // A real task boundary, so deferred unhandledrejection events dispatch.
    const yielded = await withinInvocationDeadline(
      macrotask(),
      deadline,
      "value"
    );
    if (yielded.didNotSettle) return deadlineResponse("quiescence");
    for (let i = 0; i < 32; i++) {
      await trustedResolve();
    }
    if (deadline.expired) return deadlineResponse("quiescence");
    const sweep = takeUnhandledRejections();
    supported = sweep.supported;
    for (let i = 0; i < sweep.rejections.length; i++) {
      rejections[rejections.length] = sweep.rejections[i];
    }
    if (sweep.rejections.length === 0 && setSize(inFlight) === 0) break;
  }

  cancelInvocationDeadline(deadline);
  return json(200, {
    envelope,
    unhandledRejections: rejections,
    rejectionDetectionSupported: supported,
  }, responseToken);
}
