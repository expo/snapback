// @ref LLP 3000.008.002.000#6 — actual downloader cooldowns and one recovery per event.
// Inserted into react-harness so these cases share its mounted React fixture.
export const assetRecoveryHarness = `
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
