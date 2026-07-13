// The single-sourced handler-invocation server (LLP 0048 §Architecture): the
// fetch default export both the local twin's entry.mjs and the LLP 0040
// Cloudflare handler Worker compose in, after the ordering-critical harness
// init (strip → rejection ledger → allowlist → ctx bootstrap → app/handler
// module). It performs one invocation, settles it to the tagged completion
// envelope, drains detached work to quiescence, and reports the
// unhandled-rejection sweep — engine-neutral, host-agnostic. Host powers
// reach the isolate only through the HOST service binding; the routing
// headers the host needs to reach the right instance ride `body.hostHeaders`
// (the twin passes none, the Cloudflare target passes the coordinator
// Durable Object id).
import { kept } from "./strip.mjs";
import { takeUnhandledRejections } from "./rejection-ledger.mjs";

const Response = kept.Response;
const URL = kept.URL;
// Above the platform's 4 MB application-request ceiling so schema/value
// diagnostics remain authoritative, while still bounding this private seam.
const MAX_INVOKE_BODY_BYTES = 8 * 1024 * 1024;

function trustedThen(promise, onFulfilled, onRejected) {
  return kept.reflectApply(kept.promiseThen, promise, [onFulfilled, onRejected]);
}

function trustedResolve(value) {
  return kept.reflectApply(kept.promiseResolve, kept.Promise, [value]);
}

function trustedAllSettled(values) {
  return kept.reflectApply(kept.promiseAllSettled, kept.Promise, [values]);
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

function json(status, value) {
  // The application can mutate Object/Array prototypes. Copy internal
  // response data onto prototype-free containers and use the pre-handler
  // stringify intrinsic so inherited toJSON hooks cannot forge this channel.
  return new Response(kept.jsonStringify(safeJsonValue(value)), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  return kept.jsonParse(text);
}

// Isolate-local invocation mutex. The local twin runs one process per
// invocation, but a deployed Worker isolate can interleave /invoke requests —
// and the rejection ledger, the microtask drain, and the sweep are all
// isolate-global observations. One invocation at a time makes those
// observations attributable: a swept rejection belongs to the invocation
// that just ran (ENG-23574 / ENG-23585).
let invocationChain = trustedResolve();

export default {
  async fetch(request, env) {
    const requestUrl = kept.reflectApply(kept.requestUrlGetter, request, []);
    const requestMethod = kept.reflectApply(kept.requestMethodGetter, request, []);
    const url = new URL(requestUrl);
    const pathname = kept.reflectApply(kept.urlPathnameGetter, url, []);
    if (requestMethod === "GET" && pathname === "/__snapback/health") {
      const searchParams = kept.reflectApply(kept.urlSearchParamsGetter, url, []);
      return json(200, {
        ok: true,
        harness: "snapback-workerd-v8",
        nonce:
          kept.reflectApply(kept.urlSearchParamsGet, searchParams, ["nonce"]) || "",
      });
    }
    if (pathname !== "/invoke") {
      return json(404, { fatal: "unknown harness route" });
    }
    if (requestMethod !== "POST") {
      return json(405, { fatal: "invoke requires POST" });
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
      return json(401, { fatal: "invoke transport authentication failed" });
    }
    let body;
    try {
      body = await readBoundedJson(request);
    } catch (error) {
      if (error && error.tooLarge) {
        return json(413, { fatal: "invoke body exceeded the transport limit" });
      }
      return json(400, { fatal: "invoke body was not valid JSON" });
    }
    const run = trustedThen(invocationChain, () => invoke(body, env));
    invocationChain = trustedThen(
      run,
      () => undefined,
      () => undefined
    );
    return run;
  },
};

async function invoke(body, env) {
  // Hygiene for the pathological bail-out path below: if a previous
  // invocation gave up on a never-quiescing detached chain, its leftovers
  // may have settled into the isolate-global ledger since. They are not this
  // invocation's rejections — discard them before running (ENG-23585).
  takeUnhandledRejections();
  const token = kept.String(env.SNAPBACK_INVOKE_TOKEN || body.token || "");
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
    const headers = {
      "content-type": "application/json",
      "x-snapback-host-token": token,
    };
    const hostHeaderKeys = kept.objectKeys(hostHeaders);
    for (let i = 0; i < hostHeaderKeys.length; i++) {
      const key = hostHeaderKeys[i];
      headers[key] = kept.String(hostHeaders[key]);
    }
    const fetched = env.HOST.fetch("http://snapback-host/host-call", {
      method: "POST",
      headers,
      body: kept.jsonStringify({ rawOp: kept.String(rawOp), argsJson: kept.String(argsJson) }),
    });
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

  const settled = await withSettlementDeadline(
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
    kept.Number(body.settlementTimeoutMs || 0)
  );
  if (settled.didNotSettle) {
    return json(200, {
      didNotSettle: true,
      unhandledRejections: [],
      rejectionDetectionSupported: true,
    });
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
  let rounds = 0;
  for (;;) {
    while (setSize(inFlight) > 0 && rounds < 1024) {
      rounds++;
      await trustedAllSettled(setValues(inFlight));
      for (let i = 0; i < 32; i++) {
        await trustedResolve();
      }
    }
    // A real task boundary, so deferred unhandledrejection events dispatch.
    await macrotask();
    for (let i = 0; i < 32; i++) {
      await trustedResolve();
    }
    const sweep = takeUnhandledRejections();
    supported = sweep.supported;
    for (let i = 0; i < sweep.rejections.length; i++) {
      rejections[rejections.length] = sweep.rejections[i];
    }
    if (sweep.rejections.length === 0 && setSize(inFlight) === 0) break;
    if (++rounds > 1024) {
      // A detached chain issuing work forever; stop waiting and report what
      // exists rather than hanging the invocation.
      break;
    }
  }

  return json(200, {
    envelope,
    unhandledRejections: rejections,
    rejectionDetectionSupported: supported,
  });
}

function withSettlementDeadline(promise, timeoutMs) {
  if (!(timeoutMs > 0) || !kept.setTimeout) {
    return trustedThen(promise, (envelope) => ({ envelope }));
  }
  return new kept.Promise((resolve, reject) => {
    const timer = kept.setTimeout(() => resolve({ didNotSettle: true }), timeoutMs);
    trustedThen(
      promise,
      (envelope) => {
        if (kept.clearTimeout) kept.clearTimeout(timer);
        resolve({ envelope });
      },
      (error) => {
        if (kept.clearTimeout) kept.clearTimeout(timer);
        reject(error);
      }
    );
  });
}
