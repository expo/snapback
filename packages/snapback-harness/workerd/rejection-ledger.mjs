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
// just finished (ENG-23585). Its take/inspect functions are lexical module
// exports consumed only by handler-server.mjs; application code cannot call
// them or clear the ledger.
//
import { kept } from "./strip.mjs";

const ledger = new kept.Map();
let supported = false;
try {
  if (typeof kept.addEventListener === "function") {
    kept.addEventListener("unhandledrejection", (event) => {
      kept.reflectApply(kept.mapSet, ledger, [event.promise, event.reason]);
      try {
        kept.reflectApply(kept.eventPreventDefault, event, []);
      } catch (_) {}
    });
    kept.addEventListener("rejectionhandled", (event) => {
      kept.reflectApply(kept.mapDelete, ledger, [event.promise]);
    });
    supported = true;
  }
} catch (_) {
  supported = false;
}

function describeReason(reason) {
  try {
    if (reason && typeof reason === "object" && reason.message) {
      return kept.String(reason.message);
    }
    return kept.String(reason);
  } catch (_) {
    return "unserializable rejection reason";
  }
}

function snapshot(clear) {
  const rejections = [];
  kept.reflectApply(kept.mapForEach, ledger, [
    (reason) => { rejections[rejections.length] = describeReason(reason); },
  ]);
  if (clear) kept.reflectApply(kept.mapClear, ledger, []);
  return { supported, rejections };
}

// These lexical module exports are imported only by handler-server.mjs. They
// never become handler-visible globals, so application code cannot drain the
// isolate ledger before the trusted post-quiescence sweep.
export function inspectUnhandledRejections() {
  return snapshot(false);
}

export function takeUnhandledRejections() {
  return snapshot(true);
}
