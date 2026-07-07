// V8-leg unhandled-rejection ledger (LLP 0048: the LLP 0009 conformance
// floor is engine-neutral in practice). The *contract* is shared with the
// Ibex leg — `__snapbackTakeUnhandledRejections()` returns
// `{ supported, rejections }` and the host fails the invocation when entries
// remain after the final drain — but the detection mechanism is per-engine:
// Ibex pins the vendored promise polyfill's hook slots; workerd dispatches
// the standard `unhandledrejection` / `rejectionhandled` events.
//
// The ledger is isolate-global (the `unhandledrejection` event carries no
// invocation identity), so attribution rests on the handler server's
// invocation mutex: exactly one invocation runs — and drains to quiescence —
// at a time, so everything `take()` returns belongs to the invocation that
// just finished (ENG-23585).
//
// This module must evaluate before ctx-bootstrap.js: the bootstrap's
// hook-slot installer no-ops when a take function is already defined.
import { kept } from "./strip.mjs";

const ledger = new Map();
let supported = false;
try {
  if (typeof kept.addEventListener === "function") {
    kept.addEventListener("unhandledrejection", (event) => {
      ledger.set(event.promise, event.reason);
      try {
        event.preventDefault();
      } catch (_) {}
    });
    kept.addEventListener("rejectionhandled", (event) => {
      ledger.delete(event.promise);
    });
    supported = true;
  }
} catch (_) {
  supported = false;
}

function describeReason(reason) {
  try {
    if (reason instanceof Error && reason.message) {
      return String(reason.message);
    }
    return String(reason);
  } catch (_) {
    return "unserializable rejection reason";
  }
}

const take = function () {
  const rejections = [];
  ledger.forEach((reason) => rejections.push(describeReason(reason)));
  ledger.clear();
  return { supported, rejections };
};

try {
  Object.defineProperty(globalThis, "__snapbackTakeUnhandledRejections", {
    value: take,
    configurable: false,
    writable: false,
  });
} catch (_) {
  globalThis.__snapbackTakeUnhandledRejections = take;
}
