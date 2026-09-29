// Diagnostic preload only; no product changes. Run from snapback4/ with:
// node --import ./reports/20260929-kr-keep-remount/trace.mjs --test \
//   --test-name-pattern='^online: keep remount' packages/snapback4/test/keep-device.test.mjs
import { ReadWork } from "../../packages/snapback4/dist/read-work.js";
import { ReadObservation } from "../../packages/snapback4/dist/read-observation.js";

let ordinal = 0;
const trace = (event, detail) => console.log("KR", JSON.stringify({ ordinal: ++ordinal, event, ...detail }));
const snapshot = watch => ({ key: watch.key, snapshot: watch.snapshot, inFlight: watch.inFlight, dirty: watch.dirty });
for (const method of ["schedule", "cancel"]) {
  const original = ReadWork.prototype[method];
  ReadWork.prototype[method] = function(watch, ...args) {
    trace(method, { ...snapshot(watch), active: this.active.has(watch), pending: this.pending.has(watch), delayed: this.delayed.has(watch), stack: new Error().stack });
    return original.call(this, watch, ...args);
  };
}
for (const method of ["reload", "publish"]) {
  const original = ReadObservation.prototype[method];
  ReadObservation.prototype[method] = function(...args) {
    trace(method, { ...snapshot(this), args, stack: new Error().stack });
    return original.apply(this, args);
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  trace("request", { url: String(url) });
  const response = await originalFetch(url, init);
  trace("response", { url: String(url), status: response.status });
  if (new URL(url).pathname === "/changes") {
    // Read only a clone; the real feed continues to consume its original stream.
    void response.clone().json().then(body => trace("changes-body", { body })).catch(() => {});
  }
  return response;
};
