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
// captured before the strip. The trusted server consumes the capture exactly
// once, before application-module evaluation; later imports by handler code
// receive no reference to the capability bag.
import allowlist from "./allowlist.mjs";

function inheritedGetter(prototype, name) {
  let current = prototype;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor && descriptor.get) return descriptor.get;
    current = Object.getPrototypeOf(current);
  }
  throw new Error("missing harness request getter: " + name);
}

function inheritedMethod(prototype, name) {
  let current = prototype;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor && typeof descriptor.value === "function") return descriptor.value;
    current = Object.getPrototypeOf(current);
  }
  throw new Error("missing harness request method: " + name);
}

let capturedIntrinsics = {
  Response: globalThis.Response,
  Request: globalThis.Request,
  Headers: globalThis.Headers,
  URL: globalThis.URL,
  Error: globalThis.Error,
  Promise: globalThis.Promise,
  promisePrototype: globalThis.Promise.prototype,
  promiseSpecies: globalThis.Symbol.species,
  promiseSpeciesGetter: globalThis.Object.getOwnPropertyDescriptor(
    globalThis.Promise,
    globalThis.Symbol.species
  ).get,
  promiseResolve: globalThis.Promise.resolve,
  promiseThen: globalThis.Promise.prototype.then,
  Set: globalThis.Set,
  setAdd: globalThis.Set.prototype.add,
  setDelete: globalThis.Set.prototype.delete,
  setForEach: globalThis.Set.prototype.forEach,
  setSizeGetter: globalThis.Object.getOwnPropertyDescriptor(
    globalThis.Set.prototype,
    "size"
  ).get,
  Map: globalThis.Map,
  mapSet: globalThis.Map.prototype.set,
  mapDelete: globalThis.Map.prototype.delete,
  mapForEach: globalThis.Map.prototype.forEach,
  mapClear: globalThis.Map.prototype.clear,
  Number: globalThis.Number,
  String: globalThis.String,
  stringCharCodeAt: globalThis.String.prototype.charCodeAt,
  stringCharAt: globalThis.String.prototype.charAt,
  defineProperty: globalThis.Object.defineProperty,
  objectFreeze: globalThis.Object.freeze,
  getOwnPropertyDescriptor: globalThis.Object.getOwnPropertyDescriptor,
  objectCreate: globalThis.Object.create,
  objectKeys: globalThis.Object.keys,
  objectSetPrototypeOf: globalThis.Object.setPrototypeOf,
  arrayIsArray: globalThis.Array.isArray,
  jsonStringify: globalThis.JSON.stringify,
  jsonParse: globalThis.JSON.parse,
  reflectApply: globalThis.Reflect.apply,
  headersGet: globalThis.Headers.prototype.get,
  responseJson: inheritedMethod(globalThis.Response.prototype, "json"),
  urlPathnameGetter: inheritedGetter(globalThis.URL.prototype, "pathname"),
  urlSearchParamsGetter: inheritedGetter(globalThis.URL.prototype, "searchParams"),
  urlSearchParamsGet: globalThis.URLSearchParams.prototype.get,
  eventPreventDefault: globalThis.Event.prototype.preventDefault,
  regExpTest: globalThis.RegExp.prototype.test,
  requestBodyGetter: inheritedGetter(globalThis.Request.prototype, "body"),
  requestHeadersGetter: inheritedGetter(globalThis.Request.prototype, "headers"),
  requestMethodGetter: inheritedGetter(globalThis.Request.prototype, "method"),
  requestUrlGetter: inheritedGetter(globalThis.Request.prototype, "url"),
  streamGetReader: globalThis.ReadableStream.prototype.getReader,
  readerRead: globalThis.ReadableStreamDefaultReader.prototype.read,
  readerCancel: globalThis.ReadableStreamDefaultReader.prototype.cancel,
  Uint8Array: globalThis.Uint8Array,
  uint8ArraySet: globalThis.Uint8Array.prototype.set,
  typedArrayByteLengthGetter: inheritedGetter(
    globalThis.Uint8Array.prototype,
    "byteLength"
  ),
  TextDecoder: globalThis.TextDecoder,
  textDecoderDecode: globalThis.TextDecoder.prototype.decode,
  addEventListener:
    typeof globalThis.addEventListener === "function"
      ? globalThis.addEventListener.bind(globalThis)
      : null,
  // Harness-internal macrotask boundary: workerd defers `unhandledrejection`
  // dispatch to a task boundary, so the handler server's rejection drain
  // must be able to yield a real task (ENG-23584/ENG-23585). Never
  // re-exposed to handlers — globalThis.setTimeout stays denied.
  setTimeout:
    typeof globalThis.setTimeout === "function"
      ? globalThis.setTimeout.bind(globalThis)
      : null,
  clearTimeout:
    typeof globalThis.clearTimeout === "function"
      ? globalThis.clearTimeout.bind(globalThis)
      : null,
};

// ESM exports are not an access-control boundary by themselves: handler.mjs is
// a sibling module and can name strip.mjs. Make the import topology carry a
// one-shot capability instead. handler-server.mjs is the first dependency of
// entry.mjs and consumes this before handler.mjs evaluates; every later import
// receives null, never the captured timers, host objects, or control methods.
export function consumeTrustedIntrinsics() {
  const result = capturedIntrinsics;
  capturedIntrinsics = null;
  return result;
}

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

// The Date CONSTRUCTOR's ambient clock read is denied too (ENG-23588):
// zero-arg `new Date()` and `Date()` called as a function read the engine
// wall clock, which breaks LLP 0007 deterministic replay exactly like
// `Date.now`. Explicit-timestamp construction and the static parsers stay —
// they are pure functions of their arguments. On the Ibex leg the whole
// deterministic-member surface is a declared engine fact (codegen-banned
// only), pinned by tests/workerd_twin_v0.rs; this extends the V8 side of
// that same declared asymmetry to the constructor path.
const NativeDate = Date;
try {
  const WrappedDate = function Date() {
    if (!new.target) {
      throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", "Date()");
    }
    if (arguments.length === 0) {
      throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", "new Date()");
    }
    return Reflect.construct(NativeDate, arguments, new.target);
  };
  WrappedDate.prototype = NativeDate.prototype;
  WrappedDate.parse = NativeDate.parse;
  WrappedDate.UTC = NativeDate.UTC;
  WrappedDate.now = deny("Date.now");
  // Close the `new Date(0).constructor` escape back to the native clock.
  Object.defineProperty(NativeDate.prototype, "constructor", { value: WrappedDate });
  Object.defineProperty(globalThis, "Date", {
    value: WrappedDate,
    configurable: false,
    writable: false,
  });
} catch (_) {
  // Verified by the probe below: a still-reachable ambient Date clock fails init.
}

// Intl and Temporal are KEEP intrinsics, but two of their entry points read
// the ambient clock natively (they do not go through the patched Date):
// zero-argument Intl.DateTimeFormat format()/formatToParts() format the
// CURRENT time per ECMA-402, and Temporal.Now is a clock namespace outright
// (ENG-23588 review finding). Deny exactly the clock reads; formatting an
// explicit value stays.
try {
  const denyZeroArgFormat = (proto, name, member) => {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc) return;
    if (desc.get) {
      // `format` is an accessor returning a bound formatter.
      Object.defineProperty(proto, name, {
        get() {
          const native = desc.get.call(this);
          return function (value) {
            if (value === undefined) {
              throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", member);
            }
            return native(value);
          };
        },
        configurable: false,
      });
    } else if (typeof desc.value === "function") {
      const native = desc.value;
      Object.defineProperty(proto, name, {
        value: function (value) {
          if (value === undefined) {
            throw snapbackError("SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED", member);
          }
          return native.call(this, value);
        },
        configurable: false,
        writable: false,
      });
    }
  };
  if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    denyZeroArgFormat(Intl.DateTimeFormat.prototype, "format", "Intl.DateTimeFormat.format()");
    denyZeroArgFormat(Intl.DateTimeFormat.prototype, "formatToParts", "Intl.DateTimeFormat.formatToParts()");
  }
  if (typeof Temporal !== "undefined" && Temporal && Temporal.Now) {
    Object.defineProperty(Temporal, "Now", { value: deny("Temporal.Now"), configurable: false, writable: false });
  }
} catch (_) {
  // Verified by the probe below.
}

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
// The probe covers the FULL banned surface, not a curated subset
// (ENG-23590): the shadow loop above swallows defineProperty/assignment
// failures, so an engine release that makes any banned name non-configurable
// and non-writable would otherwise survive with full authority. Probing a
// name that never existed is a harmless no-op, so probing everything is
// cheap. `stripProbes` remains the twin-pinned cross-engine subset.
const probeGlobals = new Set([
  ...allowlist.bannedEverywhere.globals,
  ...allowlist.stripProbes.globals,
]);
const probeMembers = new Set([
  ...allowlist.bannedEverywhere.members,
  ...allowlist.stripProbes.members,
]);
for (const name of probeGlobals) {
  if (!unreachable(name)) survivors.push(name);
}
for (const member of probeMembers) {
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
// The ambient clocks (ENG-23588): zero-arg Date construction and the Intl
// current-time formatting path must both be denied, while explicit-value
// use stays.
const denied = (probe) => {
  try {
    probe();
    return false;
  } catch (error) {
    return (
      String((error && error.message) || "").indexOf(
        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED"
      ) === 0
    );
  }
};
if (!denied(() => new globalThis.Date())) survivors.push("new Date()");
if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
  if (!denied(() => new Intl.DateTimeFormat("en").format())) {
    survivors.push("Intl.DateTimeFormat.format()");
  }
  try {
    if (new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(0) !== new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(0)) {
      survivors.push("Intl.DateTimeFormat.format(value) broke");
    }
  } catch (_) {
    survivors.push("Intl.DateTimeFormat.format(value) broke");
  }
}
if (typeof Temporal !== "undefined" && Temporal && typeof Temporal.Now === "object") {
  survivors.push("Temporal.Now");
}

if (survivors.length > 0) {
  throw snapbackError(
    "SNAPBACK_V8_GLOBAL_STRIP_INCOMPLETE",
    "off-allowlist globals survived the strip: " + survivors.join(", ")
  );
}
