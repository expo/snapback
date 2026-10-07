// @ref LLP 3000.008.002.000#6 — actual downloader cooldowns and one recovery per event.
// Inserted into react-harness so these cases share its mounted React fixture.
export const assetRecoveryHarness = `
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
