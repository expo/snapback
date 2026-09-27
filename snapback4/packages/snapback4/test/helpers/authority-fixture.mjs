import { guardClient } from "../../dist/app-client.js";
import { ReadObservation } from "../../dist/read-observation.js";
import { armReadExpiry, correctReadExpiries } from "../../dist/read-expiry.js";
import { bindWatchPeek, observeWatch, observationKey } from "../../dist/observe-watch.js";
import { ServerClock } from "../../dist/clock.js";
import { RememberedAnswers } from "../../dist/local-reads.js";
const ready = data => ({ data, complete: true, fresh: true, next: null, cut: null });
const why = { code: "E_AUTH", family: "auth", message: "session ended" };

export function fixture(t, keep = true) {
  let wall = 1000, hold = false, allow = true, checks;
  const memory = new RememberedAnswers();
  const gate = Promise.withResolvers(), clock = new ServerClock(() => wall), watches = new Map();
  const notify = watch => { for (const listener of watch.subscribers) listener(); };
  const arm = (watch, d) => armReadExpiry(watch, d, clock, () => watches.get(watch.key) === watch, sweep, (due, now) => { if (due) memory.expire("read", now); });
  function sweep() {
    correctReadExpiries(watches.values(), clock, watch => {
      const deliver = watch.expire(); return () => { deliver(); notify(watch); };
    }, arm, () => {});
  }
  const stopClock = clock.subscribe(sweep);
  const raw = { observe(op, args, opts) {
    const key = observationKey(op, args, opts);
    return observeWatch(watches, key, () => Object.assign(new ReadObservation(opts?.keep), {
      key, subscribers: new Set(), presenceRefresh: null,
    }), () => {}, () => {}, () => null);
  } };
  bindWatchPeek(raw, watches, () => null);
  const facade = guardClient(raw, async () => {
    if (checks?.length) return await checks.shift().promise;
    if (hold) await gate.promise;
    if (allow === "error") throw Error("session storage failed");
    return allow;
  }, () => true, () => why);
  const client = facade.client;
  t.after(() => { gate.resolve(); facade.fence()(); for (const watch of watches.values()) watch.lingering?.close(); stopClock(); });
  const owner = (args = {}) => watches.get(observationKey({ kind: "query", name: "read" }, args, keep === "default" ? undefined : { keep }));
  const publish = (data, deadlines = {}, args = {}) => {
    const watch = owner(args);
    arm(watch, { device: null, server: null, localWakeup: false, ...deadlines });
    watch.publish(ready(data)); notify(watch);
  };
  return { client, owner, publish, clock, facade, memory, gateChecks: gates => { checks = gates; }, setWall: n => { wall = n; },
    hold: () => { hold = true; }, release: (ok = true) => { allow = ok; hold = false; gate.resolve(); } };
}

