// The single-sourced handler-invocation server (LLP 0048 §Architecture): the
// fetch default export both the local twin's entry.mjs and the LLP 0040
// Cloudflare handler Worker compose in, after the ordering-critical harness
// init (strip → rejection ledger → allowlist → ctx bootstrap → app/handler
// module). It performs one invocation, settles it to the tagged completion
// envelope, drains detached microtasks, and reports the unhandled-rejection
// sweep — engine-neutral, host-agnostic. Host powers reach the isolate only
// through the HOST service binding; the routing headers the host needs to
// reach the right instance ride `body.hostHeaders` (the twin passes none, the
// Cloudflare target passes the coordinator Durable Object id).
import { kept } from "./strip.mjs";

const Response = kept.Response;

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json(400, { fatal: "invoke body was not valid JSON" });
    }
    const token = String(body.token || "");
    const hostHeaders =
      body.hostHeaders && typeof body.hostHeaders === "object"
        ? body.hostHeaders
        : {};

    globalThis.__hostCall = function (rawOp, argsJson) {
      const headers = {
        "content-type": "application/json",
        "x-snapback-host-token": token,
      };
      for (const key of Object.keys(hostHeaders)) {
        headers[key] = String(hostHeaders[key]);
      }
      return env.HOST.fetch("http://snapback-host/host-call", {
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
    };

    const envelope = await globalThis.__snapbackSettle(
      body.export,
      body.argsJson,
      body.authJson,
      body.mode,
      body.runJson,
      body.secretsJson,
      body.epoch
    );

    // Drain the microtask queue so detached chains that reject after the
    // invocation promise settled are observed before the sweep — the same
    // "after the final drain" point the Ibex host sweeps at (ENG-23361).
    for (let i = 0; i < 32; i++) {
      await Promise.resolve();
    }
    const sweep = globalThis.__snapbackTakeUnhandledRejections();

    return json(200, {
      envelope,
      unhandledRejections: sweep.rejections,
      rejectionDetectionSupported: sweep.supported,
    });
  },
};
