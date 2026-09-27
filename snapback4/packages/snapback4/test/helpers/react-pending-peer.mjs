export const pendingPeerHarness = `// Real custody plus a controlled wire; both pages share browser storage.
window.openPendingPeer = async () => {
  // Force Chromium's cross-process ordering: BroadcastChannel can arrive
  // while this tab still sees the old localStorage image. Its storage event
  // arrives later, after that image becomes visible.
  let heldStorage, earlyReads = 0;
  const storageEvents = [];
  const holdEvent = event => {
    if (!heldStorage || (event.key !== null && !event.key.endsWith('.writes'))) return;
    event.stopImmediatePropagation(); storageEvents.push(event);
  };
  window.addEventListener('storage', holdEvent, true);
  const store = { get: async key => {
    if (heldStorage) { earlyReads++; return heldStorage[key] ?? null; }
    return localStorage.getItem(key);
  }, set: async (key, value) => localStorage.setItem(key, value), remove: async key => localStorage.removeItem(key) };
  let gate, latest = [], notices = 0;
  const raw = createClient({ url: "https://pending-shared.invalid", persona: "alice", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/probe") return Response.json({ ok: true, store_id: "shared", seq: 0 });
    if (path === "/changes") return new Promise(() => {});
    if (path === "/m/write") { gate = deferred(); return gate.promise; }
    throw Error(path);
  } });
  const custody = await onlineCustody(raw, "https://pending-shared.invalid", store, error => { throw error; }, false);
  custody.client.onPendingWrites(() => notices++);
  function List() { latest = usePendingWrites(); return h("div", null, latest.map(w => w.state).join(",")); }
  return {
    client: custody.client, snapshot: () => latest, notices: () => notices,
    holdStorage() { heldStorage = { ...localStorage }; },
    earlyReads: () => earlyReads, storageEvents: () => storageEvents.length,
    async releaseStorage() {
      // Finish every early invalidation's read before advancing visibility.
      await custody.client.pendingWrites();
      await act(async () => {});
      equal(latest, [], 'the early broadcast really read the pre-admission image');
      heldStorage = undefined;
      await act(async () => {
        for (const event of storageEvents.splice(0)) window.dispatchEvent(new StorageEvent('storage', {
          key: event.key, oldValue: event.oldValue, newValue: event.newValue,
          storageArea: event.storageArea, url: event.url,
        }));
      });
    },
    mount: () => mount(h(List), custody.client), unmount,
    async closeOnAdmission() {
      await identifyDispatch(raw); await custody.client.pendingWrites();
      let closing;
      const stop = custody.client.onPendingWrites(() => { stop(); closing = custody.client.close(); });
      const write = await custody.client.mutate(mutation, { body: "close at admission" }, { waitSeconds: 0 });
      await closing;
      return write;
    },
    async submit() {
      gate = undefined;
      const write = await custody.client.mutate(mutation, { body: "shared intent" }, { waitSeconds: 0 });
      for (let n = 0; n < 100 && !gate; n++) await new Promise(resolve => setTimeout(resolve, 5));
      check(gate, "the admitted write dispatched"); return write;
    },
    async settle() {
      gate.resolve(Response.json({ state: "sent", seq: 0 }));
      for (let n = 0; n < 100 && (await custody.client.pendingWrites()).length; n++) await new Promise(resolve => setTimeout(resolve, 5));
      equal(await custody.client.pendingWrites(), [], "B settled its journal entry");
    },
    pause: custody.pause,
    async close() { window.removeEventListener('storage', holdEvent, true); await unmount(); await custody.client.close(); },
  };
};
cases["shared online journal updates A's hook on B's admission and settlement after remount"] = async () => {
  localStorage.clear();
  const a = await window.openPendingPeer(), b = await window.openPendingPeer();
  async function wait(checkState) {
    for (let n = 0; n < 100 && !checkState(); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    check(checkState(), "A hook follows shared custody");
  }
  try {
    await a.mount();
    await act(async () => { await b.submit(); });
    await wait(() => a.snapshot()[0]?.state === "sent");
    await a.unmount(); await a.mount();
    await wait(() => a.snapshot()[0]?.state === "sent");
    await act(async () => { await b.settle(); });
    await wait(() => a.snapshot().length === 0);
    equal(await a.client.pendingWrites(), [], "A direct read agrees with its hook");
    await act(async () => { a.pause(); });
    const before = a.notices();
    await b.submit();
    equal(a.notices(), before, "paused custody receives no journal invalidation");
  } finally { await a.close(); await b.close(); }
};
window.reactCases = cases;
`;
