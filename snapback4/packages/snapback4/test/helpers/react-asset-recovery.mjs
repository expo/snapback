// @ref LLP 3000.008.002.000#6 — actual downloader cooldowns and one recovery per event.
// Inserted into react-harness so these cases share its mounted React fixture.
// The busy-frame probes from both round-2 reviews deliberately allow only
// microtasks between overdue callbacks: act() there would hide the regression.
const busyWaitCase = kind => `
  async "useAsset retains the ${kind} stream diagnosis when a busy thread delivers both deadlines"() {
    const kind = ${JSON.stringify(kind)};
    const originalNow = Date.now, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalRandom = Math.random;
    let now = 1000000;
    const timers = new Map();
    Date.now = () => now; Math.random = () => 0;
    globalThis.setTimeout = (cb, delay, ...args) => {
      if (delay < 250) return originalTimeout(cb, delay, ...args);
      const id = {}; timers.set(id, { at: now + delay, run: () => cb(...args) }); return id;
    };
    globalThis.clearTimeout = id => { if (!timers.delete(id)) originalClear(id); };
    const advance = async ms => {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); await act(async () => next[1].run());
      }
      now = end;
    };
    try {
      for (const order of ["deadline", "abort-first"]) {
        let state, stream;
        const requests = [], commits = [], client = controlled();
        const transport = createClient({ url: "https://assets.invalid", persona: "test", fetch: async (_url, init) => {
          requests.push({ range: init.headers.range, signal: init.signal });
          return new Response(new ReadableStream({ start(value) { stream = value; } }),
            { status: 206, headers: { "content-length": "12" } });
        } });
        client.asset = transport.asset;
        function Probe() {
          state = useAsset("photo");
          useLayoutEffect(() => { commits.push(state); }, [state]);
          return h("span", null, state.waiting?.why?.code ?? state.status);
        }
        try {
          await mount(h(Probe), client);
          equal(requests.length, 1, "initial dispatch");
          if (kind !== "empty") {
            await advance(500);
            await act(async () => stream.enqueue(new Uint8Array([1, 2, 3])));
            equal(state.waiting.received, 3, "partial bytes observed");
            if (kind === "restart") {
              await act(async () => stream.error(Error("connection reset")));
              equal(state.waiting.why, undefined, "an early reset has no stall diagnostic");
              equal(state.waiting.interrupted, undefined, "an early reset invents no stalled stage");
              await advance(400);
              equal(requests.length, 2, "safe reset restarted");
              equal(state.waiting.received, 0, "restarted body is empty");
            }
          }
          const stalled = state.waiting, request = requests.at(-1), requestCount = requests.length;
          now = stalled.since + 5010;
          const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
          equal(due.map(([, timer]) => timer.at), [stalled.since + 4999, stalled.since + 5000], "both deadlines are overdue in one advance");
          // Also prove capture works if the abort runs before the diagnostic.
          if (order === "abort-first") due.reverse();
          globalThis.IS_REACT_ACT_ENVIRONMENT = false;
          for (const [id, timer] of due) {
            timers.delete(id); timer.run();
            for (let i = 0; i < 15; i++) await Promise.resolve();
          }
          await awaitState(() => commits.at(-1)?.waiting?.stage === "backoff", "busy-frame backoff commit");
          globalThis.IS_REACT_ACT_ENVIRONMENT = true;
          equal(request.signal.aborted, true, "unchanged inactivity limit aborts");
          equal(requests.length, requestCount, "notice does not replay the transfer");
          equal(host.textContent, "E_ASSET_WAIT", "backoff commits the diagnostic to the DOM");
          equal(state.waiting.stage, "backoff", "current stage remains visible");
          equal(state.waiting.why?.code, "E_ASSET_WAIT", "backoff preserves the explanation without an intermediate commit");
          equal(state.waiting.why?.site, "useAsset.body", "explanation names its originating stage");
          const interrupted = state.waiting.interrupted;
          equal(interrupted, { ...stalled, why: state.waiting.why }, "originating stage, progress and deadline survive intact");
          equal(interrupted.received, kind === "partial" ? 3 : 0, "snapshot preserves the interrupted attempt's bytes");
          equal(interrupted.total, 12, "known total survives backoff");
          await advance(500);
          equal(requests.length, requestCount + 1, "existing safe backoff admits the next attempt");
          equal(requests.map(r => r.range), Array(requests.length).fill("bytes=0-"), "every attempt restarts the full range");
          equal(state.waiting.stage, "body", "next body starts normally");
          equal(state.waiting.why, undefined, "new attempt clears the old diagnostic");
          equal(state.waiting.interrupted, undefined, "new attempt clears its origin snapshot");
          equal(state.waiting.received, 0, "new attempt resets received bytes");
        } finally {
          globalThis.IS_REACT_ACT_ENVIRONMENT = true;
          await unmount(); await act(async () => transport.close());
        }
        equal(timers.size, 0, "owned timers released");
      }
    } finally {
      Date.now = originalNow; Math.random = originalRandom;
      globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear;
    }
  },
`;
export const assetRecoveryHarness = `
  ${["empty", "restart", "partial"].map(busyWaitCase).join("\n")}
  async "useAsset diagnoses empty and restarted streams before abort, and opaque waits before expiry"() {
    const originalNow = Date.now, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    let now = 100000;
    const timers = new Map();
    Date.now = () => now;
    globalThis.setTimeout = (cb, delay, ...args) => {
      // Leave React's scheduler and harness polling on real time. Asset timers
      // (including backoff) are >= 250 ms and run in deadline/insertion order.
      if (delay < 250) return originalTimeout(cb, delay, ...args);
      const id = {}; timers.set(id, { at: now + delay, run: () => cb(...args) }); return id;
    };
    globalThis.clearTimeout = id => { if (!timers.delete(id)) originalClear(id); };
    const advance = async ms => {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]);
        await act(async () => next[1].run());
      }
      now = end;
    };
    try {
      for (const kind of ["empty", "restart", "opaque", "headers"]) {
        let state, stream;
        const requests = [], observations = [], client = controlled();
        const transport = createClient({ url: "https://assets.invalid", persona: "test", fetch: async (_url, init) => {
          requests.push({ range: init.headers.range, signal: init.signal });
          if (kind === "headers") return new Promise(() => {});
          if (kind === "opaque") return { ok: true, status: 206, body: null,
            headers: new Headers({ "content-type": "image/png", "content-length": "12" }), blob: () => new Promise(() => {}) };
          return new Response(new ReadableStream({ start(value) { stream = value; } }), { status: 206 });
        } });
        client.asset = transport.asset; // Preserve the actual method's progress observer.
        function Probe() { state = useAsset("photo"); observations.push(state); return null; }
        try {
          await mount(h(Probe), client);
          equal(requests.length, 1, kind + ": dispatch once");
          const firstSince = state.waiting.since;
          if (kind === "empty" || kind === "restart") {
            equal(state.waiting.progress, "bytes", "stream progress is observable");
            equal(state.waiting.received, 0, "initial body has no bytes");
            if (kind === "restart") {
              await advance(500);
              await act(async () => stream.enqueue(new Uint8Array([1, 2, 3])));
              equal(state.waiting.received, 3, "partial first attempt is visible");
              await act(async () => stream.error(Error("connection reset")));
              await advance(400);
              equal(requests.length, 2, "a reset restarts the safe range once");
              equal(requests.map(r => r.range), ["bytes=0-", "bytes=0-"], "never resume a partial range");
              equal(state.waiting.received, 0, "restart clears the prior byte count");
              check(state.waiting.since > firstSince, "restart has its own progress interval");
            }
            const request = requests.at(-1), due = state.waiting.diagnosticAt;
            equal(due, state.waiting.since + 4999, "stream diagnostic precedes the unchanged abort");
            await advance(due - now - 1);
            equal(state.waiting.why, undefined, "no premature stall diagnostic");
            await advance(1);
            equal(state.waiting.why.code, "E_ASSET_WAIT", kind + ": no-byte stall is visible");
            equal(state.waiting.why.site, "useAsset.body", "stalled stage named");
            equal(request.signal.aborted, false, "diagnostic publishes before abort");
            await advance(1);
            equal(request.signal.aborted, true, "transport still aborts at five seconds");
            equal(state.waiting.stage, "backoff", "safe retry follows the visible diagnosis");
            equal(state.waiting.why.code, "E_ASSET_WAIT", "backoff retains the diagnosis already committed");
            equal(state.waiting.interrupted.stage, "body", "backoff records the interrupted stage");
          } else {
            equal(state.waiting.stage, kind === "headers" ? "headers" : "body", "opaque stage is named");
            equal(state.waiting.progress, "unknown", "do not fabricate opaque byte progress");
            equal(state.waiting.received, undefined, "opaque received bytes are unknown");
            equal(state.waiting.diagnosticAt, firstSince + 15000, "unknown progress has a fixed bounded wait");
            await advance(14999);
            equal(state.waiting.why, undefined, "healthy six-second opaque transfers have room to finish");
            await advance(1);
            equal(state.waiting.why.code, "E_ASSET_WAIT", "opaque wait is visible at fifteen seconds");
            check(state.waiting.why.message.includes("Progress is unknown"), "diagnostic admits unknown progress");
            equal(requests[0].signal.aborted, false, "diagnostic does not shorten the transport budget");
            equal(requests.length, 1, "diagnostic never replays a transfer");
            if (kind === "opaque") {
              await advance(firstSince + 60001 - now - 1);
              equal(requests[0].signal.aborted, false, "size allowance remains 60001 ms for twelve bytes");
              equal(state.waiting.why.code, "E_ASSET_WAIT", "diagnostic remains visible before expiry");
              await advance(1);
              equal(requests[0].signal.aborted, true, "opaque allowance still expires");
              equal(state.waiting.stage, "backoff", "expiry cannot erase the earlier observation");
              equal(state.waiting.why.code, "E_ASSET_WAIT", "opaque diagnosis survives expiry");
              equal(state.waiting.interrupted.progress, "unknown", "opaque origin keeps unknown progress");
            }
          }
          check(observations.some(s => s.waiting?.why?.code === "E_ASSET_WAIT"), kind + ": React rendered the diagnostic");
        } finally { await unmount(); await act(async () => transport.close()); }
        equal(timers.size, 0, "unmount and close own all diagnostic/transfer timers");
      }
    } finally { Date.now = originalNow; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
  },
  async "useAsset names a held session before any request and diagnoses it without replay"() {
    const originalNow = Date.now, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    let now = 100000, state, calls = 0, revoked = 0;
    const timers = new Map(), session = deferred(), outcome = deferred(), raw = controlled();
    raw.asset = () => { calls++; return outcome.promise; };
    const { client } = guardClient(raw, () => session.promise, () => true, () => ({ code: "E_AUTH", family: "auth", message: "ended" }));
    function Probe() { state = useAsset("photo"); return null; }
    Date.now = () => now;
    globalThis.setTimeout = (cb, delay, ...args) => {
      if (delay !== 5000) return originalTimeout(cb, delay, ...args);
      const id = {}; timers.set(id, () => cb(...args)); return id;
    };
    globalThis.clearTimeout = id => { if (!timers.delete(id)) originalClear(id); };
    try {
      await mount(h(Probe), client);
      equal(calls, 0, "session custody blocks dispatch");
      equal(state.waiting.stage, "session", "the blocking precondition is named");
      equal(state.waiting.diagnosticAt, 105000, "diagnostic has a bounded due time");
      now = 105000;
      await act(async () => { const callbacks = [...timers.values()]; timers.clear(); for (const cb of callbacks) cb(); });
      equal(state.waiting.why.code, "E_ASSET_WAIT", "a hung session is never silent loading");
      equal(state.waiting.why.site, "useAsset.session", "diagnostic names the held stage");
      await act(async () => window.dispatchEvent(new Event("focus")));
      equal(calls, 0, "diagnosing or refocusing cannot bypass custody");
      await act(async () => session.resolve(true));
      equal(calls, 1, "resumed session dispatches once");
      equal(state.waiting.stage, "client", "custom reader is identified honestly");
      equal(state.waiting.why, undefined, "a stage change clears the stale diagnostic");
      equal(state.waiting.since, 105000, "stage change records fresh progress");
      equal(state.waiting.diagnosticAt, 110000, "the new stage gets five seconds without progress");
      now = 110000;
      await act(async () => { const callbacks = [...timers.values()]; timers.clear(); for (const cb of callbacks) cb(); });
      equal(state.waiting.why.code, "E_ASSET_WAIT", "a second real stall is diagnosed");
      equal(state.waiting.why.site, "useAsset.client", "diagnostic follows the stalled stage");
      await act(async () => outcome.resolve({ url: "blob:photo", type: "image/png", revoke: () => revoked++ }));
      equal(state.status, "ready", "late completion replaces the diagnostic");
      equal(calls, 1, "a successful once outcome never replays a pending focus event");
      await unmount(); equal(revoked, 1, "unmount owns exactly one release");
      equal(timers.size, 0, "diagnostic timers are cleaned up");
    } finally { await unmount(); Date.now = originalNow; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
  },
  async "useAsset converts a synchronous custom-reader throw into a typed error"() {
    const client = controlled(); let state;
    client.asset = () => { throw Error("native module unavailable"); };
    function Probe() { state = useAsset("photo"); return null; }
    await mount(h(Probe), client);
    equal(state.status, "error", "a synchronous exception cannot strand loading");
    equal(state.why.code, "E_CLIENT", "host exception is a client refusal");
    check(state.why.message.includes("native module unavailable"), "original cause is visible");
    await unmount();
  },
  async "useAsset preserves real admission cooldown through focus and reconnect"() {
    const originalNow = Date.now;
    const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Map();
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay !== 55000) return originalTimeout(callback, delay, ...args);
      const timer = {}; timers.set(timer, () => callback(...args)); return timer;
    };
    globalThis.clearTimeout = timer => { if (!timers.delete(timer)) originalClear(timer); };
    let now = 100000;
    Date.now = () => now;
    try {
      for (const recovery of ["focus", "reconnect", "deferred", "unmount"]) {
        const client = controlled(), listeners = new Set(); let link = "online", state, calls = 0, fetching;
        const transport = createClient({ url: "https://asset.invalid", persona: "test", fetch: async () => {
          calls++;
          return calls === 1
            ? Response.json({ denied: { code: "E_RATE_LIMIT", family: "limit", message: "wait for admission", retryable: true } }, { status: 503, headers: { "Retry-After": "60" } })
            : new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
        } });
        client.asset = id => (fetching = transport.asset(id));
        client.link = () => link;
        client.onLink = cb => { listeners.add(cb); return () => listeners.delete(cb); };
        const reconnect = () => { link = "offline"; for (const cb of listeners) cb(link); link = "online"; for (const cb of listeners) cb(link); };
        function Probe() { state = useAsset("avatar"); return null; }
        try {
          await mount(h(Probe), client);
          await act(async () => { await fetching; });
          equal(state.status, "error", "real downloader exhaustion reaches the hook");
          equal(state.why.code, "E_RATE_LIMIT", "admission refusal is preserved");
          equal(calls, 1, "long minimum ends the original call");
          now += 5000;
          await act(async () => window.dispatchEvent(new Event("focus")));
          equal(calls, 1, "focus before Retry-After cannot send");
          await act(async () => reconnect());
          equal(calls, 1, "reconnect before Retry-After cannot send");
          equal(state.status, "error", "cooldown keeps the explained error");
          if (recovery === "unmount") {
            equal(timers.size, 1, "unmount has a pending recovery to cancel");
          } else {
            now += 55000;
            await act(async () => {
              if (recovery === "deferred") {
                equal(timers.size, 1, "early recovery events keep exactly one delayed retry");
                const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback();
              } else if (recovery === "focus") window.dispatchEvent(new Event("focus")); else reconnect();
              await fetching;
            });
            equal(calls, 2, recovery + " after Retry-After sends once");
            equal(state.status, "ready", "the permitted recovery completes");
          }
        } finally { await unmount(); await transport.close(); }
        equal(listeners.size, 0, "listeners released");
        equal(timers.size, 0, "cooldown timer released");
      }
    } finally { Date.now = originalNow; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
  },
  async "useAsset remembers one recovery event while busy without looping"() {
    const client = controlled(), pending = deferred(); let calls = 0, state;
    const error = { denied: { code: "E_OFFLINE", family: "link", message: "reset", retryable: true } };
    client.asset = () => ++calls === 1 ? pending.promise : Promise.resolve(error);
    function Probe() { state = useAsset("avatar"); return null; }
    await mount(h(Probe), client);
    await act(async () => window.dispatchEvent(new Event("focus")));
    equal(calls, 1, "busy recovery does not overlap transfers");
    await act(async () => pending.resolve(error));
    equal(calls, 2, "busy recovery runs after a safe failure");
    await act(async () => {});
    equal(calls, 2, "one event never creates an automatic retry loop");
    equal(state.status, "error", "second failure stays explained");
    await unmount();
  },
`;
