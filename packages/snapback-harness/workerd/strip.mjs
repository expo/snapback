// Subtractive global strip for the V8 leg (LLP 0048 §Handler-visible API
// surface): workerd ships the whole Workers platform, so ambient authority is
// removed here, at module init, before any handler module evaluates. `fetch`
// and friends are *globals* in an isolate — declining to pass bindings is not
// enough (LLP 0040 §App subset).
//
// The keep set is generated data (allowlist.mjs wraps allowlist.json): the
// ECMAScript intrinsics, the compute-only allowlist, and the harness's own
// internals. Everything else reachable on globalThis or its prototype chain
// is shadowed with a denier. Constructors the harness itself needs are
// captured into `kept` before the strip and never re-exposed to handlers.
import allowlist from "./allowlist.mjs";

export const kept = {
  Response: globalThis.Response,
  Request: globalThis.Request,
  Headers: globalThis.Headers,
  addEventListener:
    typeof globalThis.addEventListener === "function"
      ? globalThis.addEventListener.bind(globalThis)
      : null,
};

function snapbackError(code, message) {
  const error = new Error(code + ": " + message);
  try {
    Object.defineProperty(error, "__snapbackCode", { value: code });
  } catch (_) {
    error.__snapbackCode = code;
  }
  return error;
}

function deny(name) {
  return function () {
    throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", name);
  };
}

const KEEP = new Set([
  ...allowlist.ecmascriptIntrinsics,
  ...allowlist.computeOnlyAllowlist.map((entry) => entry.name),
  ...allowlist.harnessInternals,
]);

const names = new Set();
let scope = globalThis;
while (scope && scope !== Object.prototype) {
  for (const name of Object.getOwnPropertyNames(scope)) {
    names.add(name);
  }
  scope = Object.getPrototypeOf(scope);
}

for (const name of names) {
  if (KEEP.has(name)) continue;
  try {
    Object.defineProperty(globalThis, name, {
      value: deny(name),
      configurable: false,
      writable: false,
    });
  } catch (_) {
    try {
      globalThis[name] = undefined;
    } catch (_) {
      // verified by the probe below; an unremovable reachable global fails init
    }
  }
}

// Deterministic-replay members (LLP 0007): entropy and time come from the
// runtime host ops (`runtime.now`, `runtime.id`), never from the engine.
try {
  Date.now = deny("Date.now");
} catch (_) {}
try {
  Math.random = deny("Math.random");
} catch (_) {}

// Negative probe: the generated allowlist names what must now be unreachable.
// A survivor is a structured init failure, not a warning — the strip is the
// V8 leg's whole security posture until Workers for Platforms enforces it
// (LLP 0048 §Security posture, stated asymmetrically).
function unreachable(name) {
  let value;
  try {
    value = globalThis[name];
  } catch (_) {
    return true;
  }
  if (value === undefined || value === null) return true;
  if (typeof value === "function") {
    try {
      value();
      return false;
    } catch (error) {
      return (
        String((error && error.message) || "").indexOf(
          "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED"
        ) === 0
      );
    }
  }
  return false;
}

const survivors = [];
for (const name of allowlist.stripProbes.globals) {
  if (!unreachable(name)) survivors.push(name);
}
for (const member of allowlist.stripProbes.members) {
  const [holder, prop] = member.split(".");
  const target = globalThis[holder];
  const value = target ? target[prop] : undefined;
  if (typeof value === "function") {
    try {
      value.call(target);
      survivors.push(member);
    } catch (error) {
      if (
        String((error && error.message) || "").indexOf(
          "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED"
        ) !== 0
      ) {
        survivors.push(member);
      }
    }
  }
}

if (survivors.length > 0) {
  throw snapbackError(
    "SNAPBACK_V8_GLOBAL_STRIP_INCOMPLETE",
    "off-allowlist globals survived the strip: " + survivors.join(", ")
  );
}
