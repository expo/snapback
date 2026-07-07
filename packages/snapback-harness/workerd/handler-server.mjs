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

const Response = kept.Response;
const URL = kept.URL;

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Isolate-local invocation mutex. The local twin runs one process per
// invocation, but a deployed Worker isolate can interleave /invoke requests —
// and the rejection ledger, the microtask drain, and the sweep are all
// isolate-global observations. One invocation at a time makes those
// observations attributable: a swept rejection belongs to the invocation
// that just ran (ENG-23574 / ENG-23585).
let invocationChain = Promise.resolve();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/__snapback/health") {
      return json(200, {
        ok: true,
        harness: "snapback-workerd-v8",
        nonce: url.searchParams.get("nonce") || "",
      });
    }
    if (url.pathname !== "/invoke") {
      return json(404, { fatal: "unknown harness route" });
    }
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json(400, { fatal: "invoke body was not valid JSON" });
    }
    const run = invocationChain.then(() => invoke(body, env));
    invocationChain = run.then(
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
  try {
    globalThis.__snapbackTakeUnhandledRejections();
  } catch (_) {}
  const token = String(body.token || "");
  const hostHeaders =
    body.hostHeaders && typeof body.hostHeaders === "object"
      ? body.hostHeaders
      : {};

  // Outstanding host-call round trips launched by THIS invocation — the
  // drain below waits on them, so a detached chain parked on a host call can
  // still reject before the sweep (ENG-23584).
  const inFlight = new Set();

  // The host-call transport is invocation-local: it is handed to
  // __snapbackSettle rather than read from a mutable global at call time, so
  // an overlapping invocation can never swap the token/routing out from
  // under an in-flight continuation (ENG-23574).
  const hostCall = function (rawOp, argsJson) {
    const headers = {
      "content-type": "application/json",
      "x-snapback-host-token": token,
    };
    for (const key of Object.keys(hostHeaders)) {
      headers[key] = String(hostHeaders[key]);
    }
    const call = env.HOST.fetch("http://snapback-host/host-call", {
      method: "POST",
      headers,
      body: JSON.stringify({ rawOp: String(rawOp), argsJson: String(argsJson) }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) {
          const code = data.code || "SNAPBACK_HANDLER_HOST_CALL_FAILED";
          const error = new Error(code + ": " + (data.message || "host call failed"));
          try {
            Object.defineProperty(error, "__snapbackCode", { value: code });
          } catch (_) {
            error.__snapbackCode = code;
          }
          throw error;
        }
        return data.value === undefined ? null : data.value;
      });
    const tracked = call.then(
      () => {},
      () => {}
    );
    inFlight.add(tracked);
    tracked.then(() => inFlight.delete(tracked));
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
    Number(body.settlementTimeoutMs || 0)
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
      ? new Promise((resolve) => kept.setTimeout(resolve, 0))
      : Promise.resolve();
  const rejections = [];
  let supported = true;
  let rounds = 0;
  for (;;) {
    while (inFlight.size > 0 && rounds < 1024) {
      rounds++;
      await Promise.allSettled([...inFlight]);
      for (let i = 0; i < 32; i++) {
        await Promise.resolve();
      }
    }
    // A real task boundary, so deferred unhandledrejection events dispatch.
    await macrotask();
    for (let i = 0; i < 32; i++) {
      await Promise.resolve();
    }
    const sweep = globalThis.__snapbackTakeUnhandledRejections();
    supported = sweep.supported;
    for (const reason of sweep.rejections) {
      rejections.push(reason);
    }
    if (sweep.rejections.length === 0 && inFlight.size === 0) break;
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
    return promise.then((envelope) => ({ envelope }));
  }
  return new Promise((resolve, reject) => {
    const timer = kept.setTimeout(() => resolve({ didNotSettle: true }), timeoutMs);
    promise.then(
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
