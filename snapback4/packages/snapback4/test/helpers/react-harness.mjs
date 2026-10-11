import { pendingItemsHarness } from "./react-pending-items.mjs";
import { assetRecoveryHarness } from "./react-asset-recovery.mjs";
import { pendingPeerHarness } from "./react-pending-peer.mjs";

export const reactHarness = (expiryRecipe, receiptsRecipe) => `
import { waitFor as awaitState } from '/@fs/${new URL('./wait.mjs', import.meta.url).pathname}';
import { Activity, StrictMode, act, useEffect, useLayoutEffect, useMemo, useRef, useState, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, useAuth, useClient, useSeen, SnapbackProvider, useQuery, usePage, useMutation, usePendingWrite, usePendingWrites, usePendingItems, usePendingState, useAcquired, useAction, useViewer, useAsset, useNow, usePersonaApp } from "snapback4/react";
import { createApp } from "snapback4/app";
import { createClient } from "snapback4/client";
import { memorySessionStore, keepSession, restoreSession } from "snapback4/auth";
import { onlineCustody } from "test-online-custody";
import { identifyDispatch } from "test-online-dispatch";
import { guardClient } from "test-guard-client";
import { registerPendingIntents, registerIntentObserver, pendingIntentAccess } from "test-pending-items";
import { ServerClock } from "test-server-clock";
import { Composer } from "web-composer";
import { ViewState } from "web-state";
import { Thread } from "expo-thread";
import { Inbox as ExpoInbox } from "expo-inbox";
import { App as WebApp } from "web-app";
import { App as ExpoApp } from "expo-app";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.process = { env: {} };
const query = { kind: "query", name: "read" };
const mutation = { kind: "mutation", name: "write" };
const ready = (data, next = null, flags = {}) => {
  const read = { data, complete: true, cut: null, fresh: true, since: 100, next, ...flags };
  return { ...read, existence: data !== null && !(Array.isArray(data) && !data.length) ? "present" : read.complete && read.cut === null && read.next == null ? "absent" : "partial" };
};
const check = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sent = id => ({ state: "sent", id, seq: 1, result: { reused: id } });
const failed = id => ({ state: "failed", id, why: { code: "E_INPUT", family: "input", message: "message refused" } });

function controlled(read = () => ready([])) {
  const records = [], writes = [], viewerListeners = new Set(), writeListeners = new Set(), acquiredListeners = new Set();
  const sessionListeners = new Set(), linkListeners = new Set();
  const receipts = new Map();
  let viewer = "dev:test";
  const client = {
    records, writes, receipts, closes: 0, acquired: false,
    listenerCount: () => [viewerListeners, writeListeners, acquiredListeners, sessionListeners, linkListeners].reduce((sum, listeners) => sum + listeners.size, 0)
      + records.reduce((sum, record) => sum + record.listenerCount(), 0),
    onSession(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
    onAcquired(listener) { acquiredListeners.add(listener); return () => acquiredListeners.delete(listener); },
    setAcquired(value) { client.acquired = value; for (const listener of acquiredListeners) listener(value); },
    write: async id => receipts.get(id),
    observe(op, args) {
      const listeners = new Set();
      const record = {
        op, args, value: op.name === "myMembership" ? ready({ id: "member" }) : read(args), closes: 0,
        getSnapshot() { return record.value; },
        listenerCount: () => listeners.size,
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        close() { record.closes++; },
        set(value) { record.value = value; for (const callback of listeners) callback(); },
      };
      records.push(record);
      return record;
    },
    query: async (_, args) => read(args),
    mutate(_, args, options) { const result = deferred(); writes.push({ ...result, args, options }); return result.promise; },
    upload: async () => ({ ok: false, why: { code: "E_ASSET_UNKNOWN", family: "asset", message: "no upload" } }),
    asset: async id => ({ denied: { code: "E_ASSET_UNKNOWN", family: "asset", message: id } }),
    assetSource: id => ({ uri: "mock://" + id, headers: {} }),
    link: () => "online", onLink(listener) { linkListeners.add(listener); return () => linkListeners.delete(listener); },
    viewer: () => viewer,
    onViewer(listener) { viewerListeners.add(listener); return () => viewerListeners.delete(listener); },
    onWrite(listener) { writeListeners.add(listener); return () => writeListeners.delete(listener); },
    setViewer(next) { viewer = next; for (const listener of viewerListeners) listener(next); },
    emitWrite(write) { receipts.set(write.id, write); for (const listener of writeListeners) listener(write); },
    close: async () => { client.closes++; },
  };
  return client;
}
let root, host;
async function mount(component, client) {
  await unmount();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(component, client);
}
async function render(component, client) {
  await act(async () => { root.render(h(StrictMode, null, client ? h(SnapbackProvider, { client }, component) : component)); });
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
}
const active = client => client.records.filter(record => !record.closes);
const one = client => { check(active(client).length === 1, "one live observation"); return active(client)[0]; };
const allClosed = client => check(client.records.every(record => record.closes === 1), "every acquired observation closed exactly once");
async function edit(text) {
  await act(async () => {
    const input = host.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    const form = host.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else [...host.querySelectorAll("button")].find(button => button.textContent === "Send").click();
  });
}

// Exercise the existing online custody/hook contract directly. Public browser
// createApp now requires synchronous web custody and refuses this async tier.
async function onlineHooks(options) {
  const session = options.persona ? undefined : await restoreSession(options.url, options.sessionStore);
  const raw = createClient({ ...options, session });
  const { client } = await onlineCustody(raw, options.url, options.sessionStore, () => {});
  return { client, mutate: client.mutate, close: client.close, ready: Promise.resolve() };
}

${expiryRecipe}
const api = { history: { kind: "query", name: "history" }, receiptMember: { kind: "query", name: "receiptMember" }, seen: { kind: "mutation", name: "seen" }, delivered: { kind: "mutation", name: "delivered" } };
api.messageReceipts = {kind:"query",name:"decorations"};
api.receiptFamilies = {chat:{name:"chat",fingerprint:"test",member:api.receiptMember,seen:api.seen,scopeArgument:"conversation",throughArgument:"through",mapping:{floor:"joinedOrdinal",seen:"seenOrdinal"}}};
${receiptsRecipe}
const ordinals = (from, to) => Array.from({ length: from - to + 1 }, (_, n) => ({ id: "m" + (from - n), ordinal: from - n }));
const memberOf = seen => ready({ id: "member", deliveredOrdinal: 0, joinedOrdinal: 0, seenOrdinal: seen });
function receiptsClient(history, progress) {
  const client = controlled(args => "c" in args ? history.get(args.c) : progress);
  client.acks = [];
  client.calls = [];
  client.mutate = (op, args) => { client.calls.push({ op: op.name, ...args }); client.acks.push(op.name + ":" + (op.name === "delivered" ? args.from + "-" : "") + args.through); return Promise.resolve(sent("ack")); };
  return client;
}
const stream = client => active(client).find(record => !("c" in record.args));
function Receipts({ visible, conversation = "c1" }) { useReceipts(conversation, visible, new Set(ordinals(1000, 1).map(m => m.id))); return null; }
const acked = client => [...new Set(client.acks)];
const cases = {
  async "the receipts card leaves delivery to the SDK and never acquires catch-up pages by itself"() {
    const client = receiptsClient(new Map([[null, ready(ordinals(60, 41), "p2")], ["p2", ready(ordinals(40, 21))]]), memberOf(0));
    await mount(h(Receipts, { visible: false }), client);
    equal(client.acks, [], "a background hook reports no delivery or view");
    equal(active(client).filter(record => record.op.name === "history").length, 1, "no automatic page walk");
    check(active(client).some(record => record.op.name === "receiptMember"), "seen reads the member directly");
    check(!active(client).some(record => record.op.name === "progress"), "no progress subscription");
    await render(h(Receipts, { visible: true }), client);
    equal(acked(client), ["seen:60"], "the visible screen still records seen");
    await unmount();
  },
  // @ref LLP 3000.022#8 — the SDK owns delivery; this card hook owns only seen.
  async "the receipts card leaves delivery to the SDK and reports only visible settled rows"() {
    const pages = new Map([[null, ready(ordinals(60, 41), "p2")], ["p2", ready(ordinals(40, 21))]]);
    const client = receiptsClient(pages, memberOf(0));
    await mount(h(Receipts, { visible: false }), client);
    equal(client.acks, [], "fetched rows and membership never make the hook report delivery");
    equal(active(client).filter(record => record.op.name === "history").length, 1, "delivery no longer walks pages from a mounted hook");
    await act(async () => stream(client).set(ready({ id: "member", deliveredOrdinal: 20, joinedOrdinal: 0, seenOrdinal: 0 })));
    equal(client.acks, [], "moving the prefix still sends no delivery");
    await render(h(Receipts, { visible: true }), client);
    equal(acked(client), ["seen:60"], "the newest message on screen is seen");
    client.acks.length = 0;
    await act(async () => stream(client).set(memberOf(60)));
    equal(client.acks, [], "a seen message is not sent again");
    await unmount();

    const pending = receiptsClient(new Map([[null, ready([{ ordinal: 104, pending: true }, ...ordinals(103, 101)])]]), memberOf(100));
    await mount(h(Receipts, { visible: true }), pending);
    equal(acked(pending), ["seen:103"], "pending rows are not seen");
    await unmount();

    const offline = receiptsClient(new Map([[null, ready(ordinals(600, 581), "p2", { fresh: false, since: 50 })]]), ready({ id: "member", deliveredOrdinal: 0, joinedOrdinal: 0, seenOrdinal: 0 }, null, { complete: false, fresh: false, since: 50 }));
    await mount(h(Receipts, { visible: true }), offline);
    equal(acked(offline), ["seen:600"], "a retained visible row can be seen offline, without hook delivery");
    await unmount();
  },
  async "the receipts card requires current membership and resets on withdrawal and hidden remount"() {
    const client = receiptsClient(new Map([[null, ready(ordinals(20, 1))]]), { loading: true });
    await mount(h(Receipts, { visible: true }), client);
    equal(client.acks, [], "a withdrawn member is no progress authority");
    await act(async () => stream(client).set(memberOf(0)));
    equal(client.acks, ["seen:20"], "current visible confirmed rows report after membership arrives");
    await render(h(Receipts, { visible: false }), client);
    await act(async () => stream(client).set({ loading: true }));
    await act(async () => stream(client).set(memberOf(0)));
    equal(client.acks, ["seen:20"], "withdrawal cannot replay hidden progress");
    await unmount(); await mount(h(Receipts, { visible: false }), client);
    equal(client.acks, ["seen:20"], "hidden remount has no view debt");
    await unmount(); allClosed(client);
  },
  async "useSeen shares two Strict Mode screens and obeys the explicit viewport on both hosts"() {
    const client = receiptsClient(new Map([[null, ready(ordinals(20, 1))]]), memberOf(0));
    function Screen({ ids }) { useReceipts("c1", true, new Set(ids)); return null; }
    await mount(h("div", null, h(Screen, {ids:["m3"]}), h(Screen, {ids:["m5"]})), client);
    equal(client.calls.map(c => c.through), [5], "one shared call for the committed visible range");
    equal(active(client).filter(r => r.op.name === "receiptMember").length, 1, "one member observation");
    await unmount(); allClosed(client);
    equal(client.listenerCount(), 0, "final Strict Mode unmount releases client and observation listeners");
  },
  async "useNow hides a server-answered row at its deadline and after a clock advance"() {
    let wall = 1000, offset = 90000000, revision = 0, requestDelay = 40;
    const clock = new ServerClock(() => wall);
    const client = createClient({ url: "https://clock.invalid", persona: "alice", fetch: clock.wrap(async (input, init) => {
      if (String(input).includes("/changes")) return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
      // Force dispatch-to-stamp latency without sleeping: the midpoint estimate
      // starts 20 ms ahead. Later revisions have zero request latency.
      wall += requestDelay;
      return Response.json({ ok: true, data: [], tables: [], seq: 0, store_id: "clock-react" }, { headers: {
        "x-snapback-time": String(wall + offset), "x-snapback-clock": "react:" + revision,
      } });
    }) });
    const timers = new Map(), schedule = window.setTimeout, cancel = window.clearTimeout;
    let nextTimer = -1, rowAnswers = 0;
    function Typing({ rows }) { return h("span", null, useExpiringRows(rows).map(row => row.principal).join(",")); }
    const answer = (principal, expiresAt) => { rowAnswers++; return h(Typing, { rows: [{ principal, expiresAt }] }); };
    const onlyTimer = () => {
      equal(timers.size, 1, "one future render timer");
      return [...timers.values()][0];
    };
    const advanceWall = async to => {
      wall = to;
      await act(async () => {
        for (const [id, timer] of [...timers]) if (timer.at <= wall) {
          timers.delete(id);
          timer.fire();
        }
      });
    };
    const sample = async () => {
      revision++;
      await act(async () => { await client.query(query, {}); });
    };
    try {
      await client.query(query, {});
      requestDelay = 0;
      equal(client.now(), wall + offset + 20, "the injected request latency biases the initial estimate by 20 ms");
      await unmount();
      window.setTimeout = (fn, delay, ...args) => {
        const id = nextTimer--;
        timers.set(id, { at: wall + delay, delay, fire: () => fn(...args) });
        return id;
      };
      window.clearTimeout = id => { timers.delete(id); if (id >= 0) cancel(id); };
      const initial = client.now() + 200;
      await mount(answer("alice", initial), client);
      equal(host.textContent, "alice", "the server-clock deadline begins live");
      equal(onlyTimer().delay, 200, "the first timer targets the deadline");
      const oldTimer = [...timers.keys()][0], extended = client.now() + 500;
      await render(answer("alice", extended), client);
      check(!timers.has(oldTimer), "a replacement answer cancels its old deadline timer");
      equal(onlyTimer().delay, 500, "the replacement timer targets its own deadline");
      await advanceWall(wall + 200);
      equal(client.now(), initial, "visit the old deadline exactly");
      equal(host.textContent, "alice", "a replacement answer cancels its old deadline");
      await advanceWall(wall + 299);
      equal(client.now(), extended - 1, "visit one millisecond before the replacement deadline");
      equal(host.textContent, "alice", "the replacement row is still live before its deadline");
      await advanceWall(wall + 1);
      equal(client.now(), extended, "visit the replacement deadline exactly");
      equal(host.textContent, "", "the published hook owns the replacement deadline render");
      equal(rowAnswers, 2, "expiry needed no further row answer");
      equal(timers.size, 0, "expiry leaves no render timer");

      const bobDeadline = client.now() + 120000;
      await render(answer("bob", bobDeadline), client);
      equal(host.textContent, "bob", "new server answer begins live");
      equal(onlyTimer().delay, 120000, "one future render timer");
      // The old test assumed this offset jump also advanced client.now() by
      // 120000. A faster revision drops the prior midpoint bias instead.
      offset += 120000;
      await sample();
      equal(client.now(), bobDeadline - 20, "the new estimate is still 20 ms short of the row deadline");
      equal(host.textContent, "bob", "a clock advance cannot expire a still-live row");
      equal(onlyTimer().delay, 20, "the hook reschedules the remaining lifetime");
      offset += 20;
      await sample();
      equal(client.now(), bobDeadline, "the next clock sample reaches the exact deadline");
      equal(host.textContent, "", "clock advance repaints without another row answer");
      equal(rowAnswers, 3, "clock advances needed no further row answer");
      equal(timers.size, 0, "clock advance cancels the old deadline");

      await render(answer("carol", client.now() + 120000), client);
      equal(onlyTimer().delay, 120000, "the replacement answer installs its timer");
      const issued = client.now();
      offset -= 120000;
      await sample();
      equal(client.now(), issued, "a shrinking offset never moves device time backward");
      equal(host.textContent, "carol", "the replacement row remains live during clock rollback");
      equal(onlyTimer().delay, 240000, "a frozen clock schedules at the estimated deadline without repeated early wakes");
      await unmount();
      equal(timers.size, 0, "unmount cancels the replacement timer");
    } finally {
      await unmount();
      window.setTimeout = schedule; window.clearTimeout = cancel;
      await client.close();
    }
  },
  async "AppProvider switches real clients, resets account state and routes existing mutation/query hooks"() {
    const seen = [];
    const app = createApp({ url: "https://app.invalid", sessionStore: memorySessionStore(), fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/probe") return Response.json({ ok: true, store_id: "react-app", seq: 1 });
      if (path === "/auth/signup") {
        const principal = JSON.parse(init.body).email;
        return Response.json({ session: { principal, token: principal, kind: "user", expiresAt: Date.now() + 7 * 86400000 } });
      }
      if (path === "/auth/logout") return Response.json({ ok: true });
      if (path === "/q/read") return Response.json({ data: init.headers.authorization, tables: ["notes"], seq: 1 });
      if (path === "/m/write") { const write = JSON.parse(init.body); seen.push([init.headers.authorization, write]); return Response.json({ state: "sent", id: write.id, seq: 1, result: null }); }
      if (path === "/changes") return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
      throw Error("unexpected route " + path);
    } });
    let auth, client, read, write, setDraft;
    function Screen() {
      auth = useAuth(); client = useClient(); read = useQuery(query, {}); write = useMutation(mutation);
      const [draft, set] = useState("empty"); setDraft = set;
      return h("p", null, auth.state + ":" + auth.viewer + ":" + draft);
    }
    try {
      await mount(h(AppProvider, { app }, h(Screen)));
      await act(async () => { await app.ready; });
      check(auth.state === "signed-out", "restore publishes signed out");
      await act(async () => { await auth.signup("alice", "password"); });
      const alice = client;
      await act(async () => { setDraft("alice draft"); await write.run({ body: "alice write" }); });
      await awaitState(async () => !(read.data !== "Bearer alice"), 'helpers/react-harness.mjs: read.data !== "Bearer alice"', { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } });
      equal(read.data, "Bearer alice", "query hook uses Alice");
      await act(async () => { await auth.signup("bob", "password"); });
      check(client !== alice && auth.viewer === "bob", "provider switched clients");
      check(host.textContent.endsWith(":empty"), "account-owned draft was reset");
      await awaitState(async () => !(read.data !== "Bearer bob"), 'helpers/react-harness.mjs: read.data !== "Bearer bob"', { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } });
      equal(read.data, "Bearer bob", "query hook uses Bob: " + JSON.stringify(read));
      await act(async () => { await write.run({ body: "bob write" }); });
      equal(write.last?.state, "failed", "the current browser client refuses unsafe admission");
      equal(write.last?.why.code, "E_ADMISSION", "no durable web device is explicit");
      equal(seen, [], "an unjournaled browser write never reaches transport");
      await act(async () => { await auth.logout(); });
      equal(auth.state, "signed-out", "logout updates useAuth");
      check(client !== alice && client.viewer() === null, "no stale account client remains");
    } finally { await unmount(); await app.close(); }
  },

  async "failed receipt saves settle pending-write hooks and stay settled after remount"() {
    const memory = memorySessionStore(), held = deferred(), id = "00000000000000000000000002";
    const url = "https://failed-receipt.invalid";
    await keepSession(url, { principal: "alice", token: "alice", kind: "user", expiresAt: Date.now() + 7 * 86400000 }, memory);
    let fail = true, failures = 0, sends = 0, latest;
    const store = { ...memory, async set(key, text) {
      if (fail && key.endsWith(".writes") && JSON.parse(text).receipts.length) { failures++; throw Error("disk full"); }
      await memory.set(key, text);
    } };
    const app = await onlineHooks({ url, sessionStore: store, fetch: async (input, init) => {
      if (new URL(input).pathname === "/probe") return Response.json({ ok: true, store_id: "react-receipt", seq: 0 });
      if (new URL(input).pathname !== "/m/write") throw Error("unexpected route");
      sends++; await held.promise;
      return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: 3 });
    } });
    function Pending() { latest = usePendingWrite(mutation, id); return h("p", null, latest.last?.state ?? "unknown"); }
    try {
      await app.ready;
      let settled = false;
      const writing = app.mutate(mutation, { body: "one row" }, { id }).then(value => { settled = true; return value; });
      // Store discovery now precedes fresh admission. This receipt-recovery
      // witness mounts against an admitted intent, with its response held.
      await awaitState(async () => !(!sends), 'helpers/react-harness.mjs: !sends', { poll: async () => { await new Promise(resolve => setTimeout(resolve, 5)); } });
      equal(sends, 1, "the intent was admitted before mounting its receipt lookup");
      await mount(h(SnapbackProvider, { client: app.client }, h(Pending)));
      await awaitState(async () => !(latest.last?.state !== "pending"), 'helpers/react-harness.mjs: latest.last?.state !== "pending"', { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } });
      equal(latest.last?.state, "pending", "hook observed the admitted intent");
      await act(async () => { held.resolve(); await writing; });
      check(settled && !latest.pending && latest.last?.state === "sent", "known outcome must notify without durable receipt");
      await mount(h(SnapbackProvider, { client: app.client }, h(Pending)));
      await awaitState(async () => !(!latest.last), 'helpers/react-harness.mjs: !latest.last', { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } });
      equal(latest.last?.state, "sent", "remount looks up the same confirmed id while disk still fails");
      check(!latest.pending && failures >= 2, "persistent fault cannot turn sent back into pending");
      equal(sends, 1, "remount did not submit a new id");
      fail = false;
      await act(async () => { equal((await app.client.write(id)).state, "sent", "receipt retirement succeeds after repair"); });
    } finally { held.resolve(); await unmount(); await app.close(); }
  },

  async "two online owners notify both pending-write hooks when the shared journal settles once"() {
    const store = memorySessionStore(), owners = [], waits = [deferred(), deferred()], entered = [false, false];
    const initial = { principal: "alice", token: "same-session", kind: "user", expiresAt: Date.now() + 7 * 86400000 };
    await keepSession("https://shared.invalid", initial, store);
    let a, b;
    const calls = [0, 0], events = [[], []], id = "00000000000000000000000001";
    function Pending({ index }) {
      const write = usePendingWrite(mutation, id);
      return h("p", { id: "owner-" + index }, write.last?.state ?? "unknown");
    }
    const until = async (check, message) => {
      return awaitState(check, message);
    };
    try {
      for (let index = 0; index < 2; index++) {
        const app = await onlineHooks({ url: "https://shared.invalid", sessionStore: store, fetch: async (url, init) => {
          if (new URL(url).pathname === "/probe") return Response.json({ ok: true, store_id: "react-shared", seq: 0 });
          if (new URL(url).pathname !== "/m/write") throw Error("unexpected route " + url);
          if (++calls[index] === 1) throw Error("initial request offline");
          entered[index] = true;
          await waits[index].promise;
          return Response.json({ state: "sent", id, seq: 1, replayed: index === 1 });
        } });
        owners.push(app); await app.ready;
        app.client.onWrite(write => events[index].push(write.state));
      }
      a = owners[0]; b = owners[1];
      equal((await a.mutate(mutation, { body: "shared" }, { id })).state, "pending", "A queued");
      equal((await b.mutate(mutation, { body: "shared" }, { id })).state, "pending", "B queued same ID");
      await mount(h("div", null, ...owners.map((app, index) => h(SnapbackProvider, { client: app.client, key: index }, h(Pending, { index })))));
      await awaitState(async () => !(![...host.querySelectorAll("p")].every(p => p.textContent === "pending")), 'helpers/react-harness.mjs: ![...host.querySelectorAll("p")].every(p => p.textContent === "pending")', { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } });
      equal([...host.querySelectorAll("p")].map(p => p.textContent), ["pending", "pending"], "both hooks pending");
      await until(() => entered.every(Boolean), "both retry requests held");
      await act(async () => { waits[0].resolve(); await until(() => events[0].length === 1, "A terminal notification"); });
      equal(host.querySelector("#owner-0").textContent, "sent", "A hook settled");
      equal(host.querySelector("#owner-1").textContent, "pending", "B still waits for its confirmation");
      await act(async () => { waits[1].resolve(); await until(() => events[1].length === 1, "B must notify even after A retired the entry"); });
      equal(host.querySelector("#owner-1").textContent, "sent", "B hook settled without polling write(id)");
      await act(async () => { await a.client.write(id); await b.client.write(id); });
      equal(events, [["sent"], ["sent"]], "notifications deduplicate separately for each owner");
    } finally { waits.forEach(wait => wait.resolve()); await unmount(); await Promise.all(owners.map(app => app.close())); }
  },

  // Wave 6 (LLP 3000.013 §6.7): one hook owns a persona's app; StrictMode replays its effect.
  async "usePersonaApp opens one app per persona, closes the previous on switch and unmount, and never shows a stale app"() {
    const opened = [], seen = [];
    const open = persona => { const app = { persona, closes: 0, close: async () => { app.closes++; } }; opened.push(app); return app; };
    let latest;
    function Probe({ persona }) { latest = usePersonaApp(persona, persona => open(persona)); seen.push([persona, latest?.persona ?? null]); return null; }
    await mount(h(Probe, { persona: null }));
    check(latest === null && opened.length === 0, "no persona opens nothing");
    await render(h(Probe, { persona: "alice" }));
    const alice = opened.at(-1);
    check(latest === alice && alice.persona === "alice" && alice.closes === 0, "alice's app is current");
    check(opened.every(app => app === alice || app.closes === 1), "a StrictMode replay closes its first app exactly once");
    const before = opened.length;
    await render(h(Probe, { persona: "alice" }));
    check(opened.length === before && latest === alice, "a re-render with the same persona and a new inline opener keeps the app");
    await render(h(Probe, { persona: "bob" }));
    const bob = opened.at(-1);
    check(latest === bob && bob.persona === "bob" && alice.closes === 1, "switching closes alice and shows bob");
    check(seen.every(([persona, shown]) => shown === null || shown === persona), "no render shows another persona's app: " + JSON.stringify(seen));
    await render(h(Probe, { persona: null }));
    check(latest === null && bob.closes === 1, "clearing the persona closes its app");
    await unmount();
    check(opened.every(app => app.closes === 1), "every opened app closed exactly once");
  },
  async "useQuery owns observations through Strict Mode, equivalent arguments and unmount"() {
    const client = controlled(args => ready(args)); let latest;
    function Probe({ value }) { latest = useQuery(query, { value }); return null; }
    await mount(h(Probe, { value: 1 }), client);
    equal(latest.data, { value: 1 }, "ready after effect replay");
    check(client.records.length === 2, "discarded render acquired no resource");
    const original = one(client);
    await render(h(Probe, { value: 1 }), client);
    check(one(client) === original, "equivalent arguments keep the observation");
    await render(h(Probe, { value: 2 }), client);
    check(original.closes === 1, "old arguments release the observation");
    await act(async () => one(client).set(ready({ value: 3 })));
    equal(latest.data, { value: 3 }, "new observation remains live");
    await unmount(); allClosed(client);
  },
  async "useMutation passes admission options and saved identity; custody clears inFlight"() {
    const client = controlled(); let latest, running;
    function Probe() { latest = useMutation(mutation); return null; }
    await mount(h(Probe), client);
    await act(async () => { running = latest.run({ n: 1 }, { waitSeconds: 0 }); });
    check(latest.inFlight, "admission is in flight");
    equal(client.writes[0].options, { waitSeconds: 0 }, "option forwarded");
    await act(async () => { client.writes[0].resolve({ state: "pending", id: "admitted" }); await running; });
    check(!latest.inFlight && latest.last.state === "pending", "custody releases composer");
    await act(async () => { client.emitWrite(sent("admitted")); });
    equal(latest.last.state, "sent", "onWrite settles last");
    await act(async () => { running = latest.run({ n: 2 }, { id: "saved-id" }); });
    equal(client.writes[1].options, { id: "saved-id" }, "saved ID forwarded");
    await act(async () => { client.writes[1].resolve(sent("saved-id")); await running; });
    await unmount();
  },
  async "useMutation survives replay, rejection, concurrent writes and an obsolete lifetime"() {
    const client = controlled(); let latest;
    function Probe() { latest = useMutation(mutation); return null; }
    await mount(h(Probe), client);
    let first;
    await act(async () => { first = latest.run({ n: 1 }); });
    check(latest.inFlight, "write is in flight");
    await act(async () => { client.writes[0].resolve(sent("first")); await first; });
    equal((await first).result, { reused: "first" }, "run resolves with the server result");
    equal(latest.last.result, { reused: "first" }, "last carries the server result");
    check(latest.last.id === "first" && !latest.inFlight, "write settles after Strict Mode replay");
    let rejected;
    await act(async () => { rejected = latest.run({ n: 2 }); });
    await act(async () => { client.writes[1].reject(Error("storage failed")); await rejected; });
    check(latest.last.state === "failed" && latest.last.why.code === "E_CLIENT" && !latest.inFlight, "foreign client rejection is an explicit outcome");
    check(latest.last.id === "" && !latest.last.why.retryable, "unknown outcome invents neither identity nor retry safety");
    let a, b;
    await act(async () => { a = latest.run({ n: 3 }); b = latest.run({ n: 4 }); });
    await act(async () => { client.writes[2].resolve(sent("a")); await a; });
    check(latest.inFlight, "another write still owns inFlight");
    await act(async () => { client.writes[3].resolve(sent("b")); await b; });
    check(!latest.inFlight, "last concurrent write clears inFlight");
    let pending;
    await act(async () => { pending = latest.run({ n: 4.5 }); client.writes[4].resolve({ state: "pending", id: "queued" }); await pending; });
    check(latest.last.state === "pending", "durably admitted write is initially pending");
    await act(async () => client.emitWrite(failed("queued")));
    check(latest.last.state === "failed" && latest.last.id === "queued", "terminal settlement replaces pending state");
    let raced;
    await act(async () => {
      raced = latest.run({ n: 4.75 });
      client.emitWrite({ state: "sent", id: "raced", seq: 1, replayed: true });
      client.writes[5].resolve({ state: "pending", id: "raced" });
      await raced;
    });
    check(latest.last.state === "sent" && latest.last.id === "raced", "terminal settlement wins a race with the pending return");
    const receipt = { state: "sent", id: "raced", seq: 1, replayed: true };
    equal(latest.last, receipt, "the hook preserves replay identity without fabricating a result");
    let obsolete;
    await act(async () => { obsolete = latest.run({ n: 5 }); });
    const replacement = controlled();
    await render(h(Probe), replacement);
    await act(async () => { client.writes[6].resolve(sent("obsolete")); await obsolete; });
    check(latest.last === undefined && !latest.inFlight, "old client's write does not settle into the new lifetime");
    let abandoned;
    await act(async () => { abandoned = latest.run({ n: 6 }); });
    await unmount();
    replacement.writes[0].resolve(sent("after-unmount")); await abandoned;
  },
  async "useMutation preserves fresh null and direct, queued and early replay receipts"() {
    const client = controlled(); let latest;
    function Probe() { latest = useMutation(mutation); return null; }
    await mount(h(Probe), client);
    const nil = { state: "sent", id: "nil", seq: 1, result: null };
    let first;
    await act(async () => { first = latest.run({}); client.writes[0].resolve(nil); await first; });
    equal(await first, nil, "run keeps fresh null");
    equal(latest.last, nil, "last keeps fresh null");
    const replay = { state: "sent", id: "replayed", seq: 2, replayed: true };
    let direct;
    await act(async () => { direct = latest.run({}); client.writes[1].resolve(replay); await direct; });
    equal(await direct, replay, "run keeps direct replay");
    equal(latest.last, replay, "last keeps direct replay");
    check(!("result" in latest.last), "a replay never acquires a result property");
    const queued = { ...replay, id: "queued" };
    await act(async () => { const pending = latest.run({}); client.writes[2].resolve({ state: "pending", id: queued.id }); await pending; });
    await act(async () => client.emitWrite(queued));
    equal(latest.last, queued, "onWrite preserves the queued replay");
    const early = { ...replay, id: "early" };
    await act(async () => {
      const pending = latest.run({});
      client.emitWrite(early);
      client.writes[3].resolve({ state: "pending", id: early.id });
      await pending;
    });
    equal(latest.last, early, "early replay notification wins over pending");
    check(!("result" in latest.last) && !latest.inFlight, "early replay has no invented result");
    await unmount();
  },
  async "W5c acquisition and pending writes survive remount, receipt races and client replacement"() {
    const client = controlled(); let latest, acquired;
    function Probe({ id }) { latest = usePendingWrite(mutation, id); acquired = useAcquired(); return null; }
    await mount(h(Probe), client);
    check(acquired === false && !latest.pending, "an unacquired idle client is explicit");
    await act(async () => client.setAcquired(true));
    check(acquired === true, "acquisition notifies React");
    let submit;
    await act(async () => { submit = latest.run({}); });
    check(latest.pending && latest.inFlight, "the chip starts at submit before an id returns");
    await act(async () => { client.writes[0].resolve({ state: "pending", id: "held", reason: "queued without a row: not acquired yet" }); await submit; });
    check(latest.pending && !latest.inFlight && latest.last.id === "held", "admitted pending keeps the chip");
    await act(async () => client.emitWrite(sent("held")));
    check(!latest.pending && latest.last.state === "sent", "sent removes pending");
    await act(async () => { const p = latest.run({}); client.writes[1].resolve({ state: "pending", id: "refused" }); await p; });
    await act(async () => client.emitWrite(failed("refused")));
    check(!latest.pending && latest.last.state === "failed", "failed removes pending and preserves refusal");
    await unmount();
    const reopened = controlled(); reopened.acquired = true;
    reopened.receipts.set("restored", { state: "pending", id: "restored" });
    await mount(h(Probe, { id: "restored" }), reopened);
    check(latest.pending && latest.last.id === "restored" && !latest.inFlight, "an id restores pending after reopen without resubmission");
    const replay = { state: "sent", id: "restored", seq: 2, replayed: true };
    await act(async () => reopened.emitWrite(replay));
    equal(latest.last, replay, "replay preserves execution identity alone");
    check(!latest.pending && reopened.writes.length === 0, "recovery never resubmits");
    await unmount();
    await mount(h(Probe, { id: "restored" }), reopened);
    equal(latest.last, replay, "terminal receipt settled before mount is restored too");
    const delayed = deferred(); reopened.write = () => delayed.promise;
    await render(h(Probe, { id: "race" }), reopened);
    await act(async () => reopened.emitWrite(failed("race")));
    await act(async () => delayed.resolve({ state: "pending", id: "race" }));
    check(latest.last.state === "failed" && !latest.pending, "late hydration cannot replace a terminal event");
    await render(h(Probe, { id: "unknown" }), controlled());
    check(latest.last === undefined && !latest.pending && acquired === false, "new client and unknown id clear the old outcome");
    await unmount();
  },
  async "useAction tracks concurrent results, retry ids and obsolete lifetimes"() {
    const client = controlled(), calls = [];
    client.act = (_, args, options) => { const call = deferred(); calls.push({ ...call, args, options }); return call.promise; };
    const op = { kind: "action", name: "invite" };
    let latest;
    function Probe() { latest = useAction(op); return null; }
    await mount(h(Probe), client);
    let first, second;
    await act(async () => { first = latest.run({ email: "one" }); second = latest.run({ email: "two" }); });
    check(latest.inFlight, "concurrent actions are in flight");
    const done = { state: "done", id: "two", result: { principal: "member:two" } };
    await act(async () => { calls[1].resolve(done); await second; });
    equal(latest.last, done, "latest action's result");
    await act(async () => { calls[0].resolve({ state: "failed", id: "one", why: { code: "E_ACTION_FAILED" } }); await first; });
    equal(latest.last, done, "older failure cannot overwrite the newest result");
    check(!latest.inFlight, "both settled");
    let pending;
    await act(async () => { pending = latest.run({}, { id: "same" }); });
    equal(calls[2].options, { id: "same" }, "the retry id is forwarded");
    await act(async () => { calls[2].resolve({ state: "pending", id: "same" }); await pending; });
    check(latest.last.state === "pending", "pending is visible");
    let denied;
    await act(async () => { denied = latest.run({}); });
    await act(async () => { calls[3].resolve({ denied: { code: "E_OFFLINE" }, id: "offline" }); await denied; });
    check(latest.last.denied.code === "E_OFFLINE", "offline denial is visible");
    let obsolete;
    await act(async () => { obsolete = latest.run({}); });
    const replacement = controlled(); replacement.act = async () => done;
    await render(h(Probe), replacement);
    await act(async () => { calls[4].resolve(done); await obsolete; });
    check(latest.last === undefined && !latest.inFlight, "old action cannot enter a new lifetime");
    await unmount();
  },
  async "useViewer subscribes and useAsset has empty and failed outcomes"() {
    const client = controlled();
    let viewer, asset, calls = 0, revoked = 0;
    client.asset = async id => {
      calls++;
      if (id === "broken") throw Error("blob construction failed");
      return { url: "blob:" + id, type: "image/png", bytes: 1, revoke: () => { revoked++; } };
    };
    function Probe({ id }) { viewer = useViewer(); asset = useAsset(id); return null; }
    await mount(h(Probe, { id: null }), client);
    check(viewer === "dev:test" && asset.status === "empty" && calls === 0, "null asset is empty and performs no fetch");
    await act(async () => client.setViewer(null));
    check(viewer === null, "viewer change re-renders without another hook");
    await act(async () => client.setViewer("dev:test"));
    await render(h(Probe, { id: "broken" }), client);
    await act(async () => {});
    check(asset.status === "error" && asset.why.code === "E_CLIENT", "asset rejection becomes a typed hook outcome");
    await render(h(Probe, { id: "photo" }), client);
    await act(async () => {});
    check(asset.status === "ready" && asset.url === "blob:photo", "asset readiness is observed");
    await render(h(Probe, { id: null }), client);
    check(asset.status === "empty" && revoked === 1, "clearing the id revokes the old object URL");
    await unmount();
  },
  async "useAsset never commits a previous id, client or principal's handle"() {
    const client = controlled(), replacement = controlled(), waiting = new Map(), commits = [];
    const links = new Set(); let signedOut = false;
    replacement.link = () => signedOut ? "signed-out" : "online";
    replacement.onLink = listener => { links.add(listener); return () => links.delete(listener); };
    let revoked = 0, calls = 0;
    client.asset = id => { calls++; const result = deferred(); waiting.set(id, result); return result.promise; };
    replacement.asset = client.asset;
    function Probe({ id }) {
      const asset = useAsset(id);
      useLayoutEffect(() => { commits.push({ id, ...asset }); });
      return null;
    }
    const handle = id => ({ url: "blob:" + id, type: "image/png", bytes: 1, revoke: () => { revoked++; } });
    await mount(h(Probe, { id: null }), client);
    await render(h(Probe, { id: "old" }), client);
    await act(async () => waiting.get("old").resolve(handle("old")));
    check(commits.at(-1).status === "ready", "initial asset ready");
    commits.length = 0;
    await render(h(Probe, { id: "new" }), client);
    check(commits.every(s => s.status === "loading"), "new id must not commit the old ready URL");
    check(revoked === 1, "replacement releases old handle");
    const oldRequest = waiting.get("new");
    commits.length = 0;
    await render(h(Probe, { id: "new" }), replacement);
    await act(async () => waiting.get("new").resolve(handle("new")));
    check(commits.at(-1).url === "blob:new", "current client ready");
    await act(async () => oldRequest.resolve(handle("late-old-client")));
    check(commits.at(-1).status === "ready" && commits.at(-1).url === "blob:new", "obsolete completion after current readiness cannot replace it");
    check(revoked === 2, "late obsolete response released");
    await render(h(Probe, { id: null }), replacement);
    check(revoked === 3, "clearing releases the current handle");
    commits.length = 0;
    await render(h(Probe, { id: "new" }), replacement);
    check(commits.every(s => s.status === "loading"), "reselecting an id cannot revive its revoked handle");
    await act(async () => waiting.get("new").resolve(handle("new-again")));
    commits.length = 0;
    const before = calls;
    await act(async () => { signedOut = true; replacement.setViewer(null); for (const listener of links) listener("signed-out"); });
    check(commits.length > 0 && commits.every(s => s.status === "denied" && s.why.code === "E_AUTH"), "in-place sign-out immediately hides the handle");
    check(calls === before && revoked === 4, "signed-out hook performs no fetch and releases its URL");
    await render(h(Probe, { id: null }), replacement);
    check(commits.at(-1).status === "empty", "missing id is still empty while signed out");
    await unmount();
  },
  async "unmounting one avatar hook preserves another hook for the same id"() {
    const client = controlled(), states = {}, revoked = [];
    client.asset = async () => {
      const url = URL.createObjectURL(new Blob(["avatar"], { type: "image/png" }));
      return { url, type: "image/png", revoke() { revoked.push(url); URL.revokeObjectURL(url); } };
    };
    function Probe({ name }) { states[name] = useAsset("same"); return null; }
    const pair = first => h("section", null, first ? h(Probe, { key: "first", name: "first" }) : null, h(Probe, { key: "second", name: "second" }));
    await mount(pair(true), client);
    const first = states.first.url, second = states.second.url;
    check(first && second && first !== second, "each hook owns its own handle");
    await render(pair(false), client);
    equal(revoked, [first], "only the unmounted hook releases its handle");
    equal(states.second.status, "ready", "the other hook stays ready");
    equal(await (await fetch(second)).text(), "avatar", "the held URL remains usable");
    let gone = false; try { await fetch(first); } catch { gone = true; }
    check(gone, "the unmounted URL is revoked");
    await unmount(); equal(revoked, [first, second], "both handles eventually released");
  },
  async "useAsset effect lifetime survives Activity and initial StrictMode replay"() {
    const client = controlled(), waiting = [], revoked = [], commits = [];
    client.asset = () => { const request = deferred(); waiting.push(request); return request.promise; };
    function Probe() {
      const state = useAsset("once");
      useLayoutEffect(() => { commits.push(state); });
      return null;
    }
    const screen = mode => h(Activity, { mode }, h(Probe));
    const handle = url => ({ url, type: "image/png", revoke() { revoked.push(url); } });
    await mount(screen("visible"), client);
    equal(waiting.length, 1, "initial non-null StrictMode setup fetches once");
    await act(async () => waiting[0].resolve(handle("blob:first")));
    equal(commits.at(-1).status, "ready", "initial view ready");
    await render(screen("hidden"), client);
    equal(revoked, ["blob:first"], "Activity hiding revokes the owned handle");
    commits.length = 0;
    await render(screen("visible"), client);
    check(commits.every(state => state.status === "loading"), "reveal never commits a revoked URL while replacement is held");
    equal(waiting.length, 2, "one replacement download");
    await act(async () => waiting[1].resolve(handle("blob:next")));
    equal(commits.at(-1).url, "blob:next", "replacement ready");
    await unmount(); equal(revoked, ["blob:first", "blob:next"], "each handle released once");
  },
  async "useAsset recovers transport errors on focus and reconnect, never denials or consumed views"() {
    const client = controlled(), listeners = new Set(); let link = "online", outcome, state, calls = 0, revokes = 0;
    client.link = () => link;
    client.onLink = cb => { listeners.add(cb); return () => listeners.delete(cb); };
    client.asset = async () => { calls++; return outcome; };
    function Probe({ id }) { state = useAsset(id); return null; }
    const error = (code, retryable) => ({ denied: { code, family: "link", message: "explained", retryable } });
    const ready = () => ({ url: "blob:owned", type: "image/png", revoke() { revokes++; } });
    for (const trigger of ["focus", "reconnect"]) {
      outcome = error("E_OFFLINE", true);
      await mount(h(Probe, { id: trigger }), client);
      equal(state.status, "error", "transport failure is an explained error");
      const before = calls;
      outcome = ready();
      await act(async () => {
        if (trigger === "focus") window.dispatchEvent(new Event("focus"));
        else { link = "offline"; for (const cb of listeners) cb(link); link = "online"; for (const cb of listeners) cb(link); }
      });
      equal(calls, before + 1, "one recovery attempt"); equal(state.status, "ready", "recovery is ready");
      await act(async () => window.dispatchEvent(new Event("focus")));
      equal(calls, before + 1, "ready handle is never refetched");
      await unmount();
    }
    for (const [code, retryable] of [["E_ASSET_UNKNOWN", true], ["E_ASSET_VIEWED", false], ["E_AUTH", true], ["E_OFFLINE", false]]) {
      outcome = error(code, retryable); await mount(h(Probe, { id: code }), client); const before = calls;
      await act(async () => { window.dispatchEvent(new Event("focus")); link = "offline"; for (const cb of listeners) cb(link); link = "online"; for (const cb of listeners) cb(link); });
      equal(calls, before, "refusal or ambiguous once view cannot restart"); await unmount();
    }
    equal(listeners.size, 0, "recovery listeners released"); check(revokes >= 2, "held handles released");
  },
${assetRecoveryHarness}
  async "useAsset with a bearer before viewer discovery fetches only once"() {
    const client = controlled(); client.setViewer(null);
    let asset, calls = 0, revoked = 0;
    client.asset = async () => { calls++; return { url: "blob:once", type: "image/png", bytes: 1, revoke: () => { revoked++; } }; };
    function Probe({ id }) { const viewer = useViewer(); asset = useAsset(id); return null; }
    await mount(h(Probe, { id: null }), client);
    await render(h(Probe, { id: "once" }), client);
    check(asset.status === "ready" && calls === 1, "unknown viewer with an online bearer can resolve an asset");
    await act(async () => client.setViewer("user:discovered"));
    check(asset.status === "ready" && calls === 1 && revoked === 0, "viewer discovery neither revokes nor consumes a second view");
    await unmount();
    check(revoked === 1, "the one handle is released once");
  },
  async "usePage rebinds insertion, deletion and reorder boundaries and aggregates read state"() {
    const pages = new Map([[null, ready(["a", "b"], "b")], ["b", ready(["c", "d"], "d")], ["a", ready(["b", "c"], "c")], ["c", ready(["d", "e"], "e")]]);
    const client = controlled(args => pages.get(args.c)); let latest;
    function Probe({ scope }) { latest = usePage(query, { scope }); return null; }
    await mount(h(Probe, { scope: "one" }), client);
    check(client.records.length === 2, "page construction is inert under discarded render");
    await act(async () => latest.loadMore());
    equal(latest.items, ["a", "b", "c", "d"], "initial two pages");
    check(latest.read.cut === null, "complete page collection has no cut");
    const first = active(client)[0], oldSecond = active(client)[1];
    await act(async () => first.set(ready(["z", "a"], "a")));
    equal(latest.items, ["z", "a", "b", "c"], "insertion loses no boundary row");
    check(oldSecond.closes === 1, "obsolete suffix closed");
    await act(async () => first.set(ready(["b", "c"], "c")));
    equal(latest.items, ["b", "c", "d", "e"], "deletion duplicates no boundary row");
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, cut: "words", fresh: false, since: 10 })));
    equal(latest.items, ["e", "a", "b", "c"], "reorder replaces the suffix");
    check(!latest.read.complete && !latest.read.fresh && latest.read.since === 10, "combined state includes the earlier page");
    check(latest.read.cut === "words", "earlier page word cut survives aggregation");
    const second = active(client)[1];
    await act(async () => second.set(ready(["b", "c"], "c", { complete: false, cut: "meter" })));
    check(latest.read.cut === "meter", "later meter cut wins over earlier words");
    await act(async () => second.set(ready(["b", "c"], "c", { complete: false, cut: "words" })));
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, cut: "meter" })));
    check(latest.read.cut === "meter", "earlier meter cut wins over later words");
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, cut: null })));
    check(latest.read.cut === "words", "withheld earlier reason does not erase a later disclosed cut");
    await act(async () => second.set(ready(["b", "c"], "c", { complete: false, cut: null })));
    check(latest.read.cut === null && !latest.read.complete, "withheld reasons stay incomplete across pages");
    equal(latest.read.data, latest.items, "read data describes all combined items");
    await render(h(Probe, { scope: "two" }), client);
    equal(latest.items, ["a", "b"], "new arguments reset the requested depth");
    check(active(client).length === 1, "new arguments close every old page");
    await unmount(); allClosed(client);
  },
  async "usePage keeps the oldest stale timestamp across fresh and stale pages"() {
    const client = controlled();
    let latest;
    function Screen() { latest = usePage(query, {}); return null; }
    await mount(h(Screen), client);
    try {
      await act(async () => active(client)[0].set(ready(["a"], "a", { fresh: false, since: 80 })));
      await act(async () => latest.loadMore());
      await act(async () => active(client)[1].set(ready(["b"], "b", { since: undefined })));
      check(latest.read.since === 80 && !latest.read.fresh, "fresh page without since preserves the stale timestamp");
      await act(async () => latest.loadMore());
      await act(async () => active(client)[2].set(ready(["c"], null, { fresh: false, since: 40 })));
      check(latest.read.since === 40, "minimum of stale pages");
      await act(async () => active(client)[1].set(ready(["b"], "b", { since: 1 })));
      check(latest.read.since === 40, "fresh pages do not contribute old timestamps");
      await act(async () => active(client)[2].set(ready(["c"], null, { fresh: false, since: undefined })));
      check(latest.read.since === undefined, "unknown stale timestamp remains unknown");
    } finally { await unmount(); }
  },

  async "keep hooks preserve loaded pages and an editor during re-reads, then accept refusal and reset"() {
    let phase = "ready", seq = 0, latest, reading = 0;
    const held = [];
    const { client: raw } = await onlineHooks({ url: "http://keep-hooks.test", persona: "alice", sessionStore: memorySessionStore(), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
      if (path === "/probe") return Response.json({ ok: true, store_id: "keep-hooks", seq });
      if (path === "/m/write") return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: ++seq });
      if (path === "/q/read") {
        reading++;
        if (phase === "held") await new Promise(resolve => held.push(resolve));
        const { c } = JSON.parse(init.body).args;
        return Response.json(phase === "denied" ? { denied: { code: "HIDDEN", family: "rule", message: "withdrawn" }, seq }
          : { data: c === "b" ? ["c"] : c ? ["b"] : ["a"], next: c === "b" ? null : c ? "b" : "a", complete: true, seq });
      }
      throw Error(path);
    } });
    function Probe({ keep = true }) {
      latest = { query: useQuery(query, {}, { keep }), page: usePage(query, {}, { keep }) };
      return latest.query.loading || latest.page.read.loading ? h("span", null, "Loading")
        : latest.query.denied || latest.page.read.denied ? h("span", null, "Refused") : h("input", { defaultValue: "draft" });
    }
    const settle = async condition => {
      // Flush React once even when the requested state is already true.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      return awaitState(condition, "kept hooks did not settle: " + JSON.stringify({ phase, latest, held: held.length, reading }), { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } });
    };
    try {
      await mount(h(Probe), raw); await settle(() => latest.page.hasMore);
      const editor = host.querySelector("input"); editor.value = "unsent draft";
      await act(async () => latest.page.loadMore()); await settle(() => latest.page.items.length === 2);
      phase = "held";
      await act(async () => latest.page.loadMore()); await settle(() => held.length > 0);
      equal(latest.page.items, ["a", "b"], "ready pages stay while a new page loads");
      check(host.querySelector("input") === editor && editor.value === "unsent draft", "load-more preserves the editor");
      await act(async () => { await raw.mutate(mutation, {}); });
      await settle(() => latest.query.revalidating && latest.page.read.revalidating);
      equal(latest.page.items, ["a", "b"], "a mutation re-read keeps both pages");
      check(!latest.query.loading && !latest.page.read.loading && latest.query.fresh && latest.page.read.fresh, "kept metadata reaches both hooks");
      check(host.querySelector("input") === editor && editor.value === "unsent draft", "re-read preserves the editor and draft");
      phase = "ready"; await act(async () => held.splice(0).forEach(resolve => resolve()));
      await settle(() => latest.page.items.length === 3 && latest.query.fresh);
      phase = "denied"; await act(async () => { await raw.mutate(mutation, {}); });
      await settle(() => latest.query.denied && latest.page.read.denied);
      check(!host.querySelector("input"), "a refusal replaces kept data");
      phase = "ready"; await act(async () => { await raw.mutate(mutation, {}); });
      await settle(() => latest.page.read.data && latest.query.data);
      phase = "held"; const before = reading;
      await render(h(Probe, { keep: false }), raw); await settle(() => reading > before);
      check(latest.query.loading && latest.page.read.loading, "turning keep off opens default watches");
      phase = "ready"; await act(async () => held.splice(0).forEach(resolve => resolve()));
      await render(h(Probe), raw); await settle(() => latest.query.data);
      await act(async () => { await raw.signOut(); });
      check(!latest.query.data && !latest.page.read.data, "sign-out clears both hooks");
    } finally { held.splice(0).forEach(resolve => resolve()); await unmount(); await raw.close(); }
  },
  async "online observations clear pages during fetches and on unavailable settlement, refusal and close"() {
    let phase = "ready", seq = 0, latest;
    const held = [];
    const { client } = await onlineHooks({ url: "http://observation.test", persona: "alice", sessionStore: memorySessionStore(), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/probe") return Response.json({ ok: true, store_id: "observation-test", seq });
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(Error("closed"));
        else init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
      });
      if (path === "/m/write") return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: ++seq, result: null });
      if (path === "/q/read") {
        if (phase === "held") { await new Promise(resolve => held.push(resolve)); return Response.json({ loading: true, seq }); }
        if (phase === "loading") return Response.json({ loading: true, seq });
        if (phase === "missing") return Response.json({ seq });
        if (phase === "denied") return Response.json({ denied: { code: "E_RULE", family: "rule", message: "access withdrawn" } });
        const { c } = JSON.parse(init.body).args;
        return Response.json({ data: c ? ["b"] : ["a"], next: c ? null : "a", complete: true, seq });
      }
      throw Error(path);
    } });
    function Probe() { latest = { query: useQuery(query, {}, { keep: false }), page: usePage(query, {}, { keep: false }) }; return null; }
    const settle = async condition => {
      // Flush React once even when the requested state is already true.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      return awaitState(condition, "observation did not settle", { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } });
    };
    const rerun = async value => {
      phase = value;
      await act(async () => { await client.mutate(mutation, {}); });
      await settle(() => true);
    };
    try {
      await mount(h(Probe), client);
      await settle(() => latest.page.hasMore);
      await act(async () => latest.page.loadMore());
      await settle(() => latest.page.items.length === 2);
      equal(latest.page.items, ["a", "b"], "two published pages");
      await rerun("held");
      equal(latest.page.items, [], "online pages retain nothing during fetches");
      check(latest.query.loading && latest.page.read.loading, "both online hooks are loading");
      phase = "loading";
      await act(async () => held.splice(0).forEach(resolve => resolve()));
      await settle(() => latest.query.loading && latest.page.read.loading);
      equal(latest.page.items, [], "unavailable settlement clears the first page and suffix");
      await rerun("missing");
      check(latest.query.loading && latest.page.read.loading, "missing-data reruns cannot resurrect answers");
      await rerun("denied");
      check(latest.query.denied?.code === "E_RULE" && latest.page.read.denied?.code === "E_RULE", "refusals replace kept answers");
      equal(latest.page.items, [], "refused first page clears visible items");
      await rerun("loading");
      check(latest.query.loading && latest.page.read.loading, "the next unavailable result is loading and cannot resurrect old data");
      await rerun("ready");
      await act(async () => client.close());
      check(latest.query.denied?.code === "E_CLOSED" && latest.page.read.denied?.code === "E_CLOSED", "close clears both hooks");
      equal(latest.page.items, [], "closed client retains no page");
    } finally { held.splice(0).forEach(resolve => resolve()); await unmount(); await client.close(); }
  },
  async "usePage treats every non-array ready value as loading and keeps the earlier pages"() {
    for (const invalid of [null, undefined, {}, "text", 7, false]) {
      const client = controlled(args => args.c == null ? ready(["a"], "a") : args.c === "a" ? ready(["b"], "b") : ready(["c"]));
      let latest;
      function Probe() { latest = usePage(query, {}); return null; }
      await mount(h(Probe), client);
      await act(async () => latest.loadMore());
      await act(async () => latest.loadMore());
      equal(latest.items, ["a", "b", "c"], "three resolved pages");
      const [first, second, third] = active(client);
      await act(async () => second.set(ready(invalid, "b")));
      equal(latest.items, ["a"], "an unavailable middle page keeps the prefix");
      check("loading" in latest.read && !latest.hasMore, "invalid data is not a ready combined read or a continuation");
      check(third.closes === 1, "the suffix of an invalid page is closed");
      await act(async () => latest.loadMore());
      check(active(client).length === 2, "loadMore cannot follow an invalid page's cursor");
      await act(async () => second.set(ready(["b"], "b")));
      equal(latest.items, ["a", "b", "c"], "recovery restores requested depth");
      await act(async () => first.set(ready(invalid, "a")));
      equal(latest.items, [], "an invalid first page has no visible items");
      check("loading" in latest.read && !latest.hasMore, "the first page also waits");
      await unmount(); allClosed(client);
    }
  },
  async "usePage keeps the ready prefix while replacing an in-flight suffix"() {
    const client = controlled(args => args.c == null ? ready(["a", "b"], "b") : { loading: true }); let latest;
    function Probe() { latest = usePage(query, {}); return null; }
    await mount(h(Probe), client);
    await act(async () => { latest.loadMore(); latest.loadMore(); });
    check(active(client).length === 2, "only one next page request at a time");
    equal(latest.read.data, ["a", "b"], "unresolved suffix keeps the ready prefix");
    check(!latest.hasMore, "unresolved suffix admits no further request");
    const first = active(client)[0], obsolete = active(client)[1];
    await act(async () => first.set(ready(["z", "a"], "a")));
    check(obsolete.closes === 1, "pending old boundary is closed");
    await act(async () => obsolete.set(ready(["obsolete"], null)));
    equal(latest.items, ["z", "a"], "late old page cannot reenter the result");
    await act(async () => active(client)[1].set(ready(["b", "c"], null, { fresh: false, since: 30 })));
    equal(latest.items, ["z", "a", "b", "c"], "replacement completes the contiguous range");
    check(!latest.read.fresh && latest.read.since === 30 && !latest.hasMore, "last page contributes freshness and end position");
    await unmount(); allClosed(client);
  },
  async "usePage keeps loaded pages while another loads and withdraws them on a first-page reset"() {
    const client = controlled(() => ({ loading: true })); let latest, mounts = 0;
    function Content() { useEffect(() => { mounts++; }, []); return h("input", { defaultValue: "draft" }); }
    function Probe() { latest = usePage(query, {}); return latest.read.loading ? null : h(Content); }
    await mount(h(Probe), client);
    check(latest.read.loading && latest.items.length === 0, "the first page starts loading");
    const first = active(client)[0];
    await act(async () => first.set(ready(["a"], "a", { fresh: false, since: 30, complete: false, cut: "words" })));
    const input = host.querySelector("input"), mounted = mounts;
    input.value = "unsent draft";
    await act(async () => latest.loadMore());
    equal(latest.read.data, ["a"], "a pending second page leaves the first ready");
    check(host.querySelector("input") === input && input.value === "unsent draft" && mounts === mounted, "loading more preserves the mounted editor and draft");
    const second = active(client)[1];
    await act(async () => second.set(ready(["b"], "b")));
    await act(async () => latest.loadMore());
    equal(latest.read.data, ["a", "b"], "a pending third page keeps both loaded pages");
    check(!latest.read.fresh && latest.read.since === 30 && !latest.read.complete && latest.read.cut === "words", "the prefix retains its freshness, completeness and cut");
    const third = active(client)[2];
    await act(async () => third.set({ denied: { code: "E_RULE", family: "rule", message: "revoked" } }));
    check(latest.read.denied?.code === "E_RULE", "a later refusal is not hidden by the prefix");
    await act(async () => first.set({ loading: true }));
    check(latest.read.loading && latest.items.length === 0 && active(client).length === 1, "a first-page reset immediately discards every old page");
    await act(async () => third.set(ready(["late"], null)));
    check(latest.read.loading && latest.items.length === 0, "an old suffix cannot reappear after reset");
    await act(async () => first.set(ready([], "empty")));
    equal(latest.read.data, [], "an empty ready prefix also stays ready while the next page loads");
    await unmount(); allClosed(client);
  },
};

for (const [name, Component] of [["web", WebApp], ["Expo", ExpoApp]]) {
  cases[name + " app closes asynchronous opens before/after cleanup and ignores obsolete failures"] = async () => {
    let opens = [];
    globalThis.openClient = () => { const result = deferred(); opens.push(result); return result.promise; };
    await mount(h(Component));
    check(opens.length === 2, "Strict Mode replays the client-open effect");
    const live = controlled();
    await act(async () => { opens[0].reject(Error("obsolete open")); opens[1].resolve(live); });
    check(!host.textContent.includes("obsolete open") && !host.textContent.includes("Opening"), "only current open result renders");
    await unmount(); check(live.closes === 1, "resolved client closes on cleanup");
    opens = [];
    await mount(h(Component)); await unmount();
    const abandoned = opens.map(() => controlled());
    await act(async () => opens.forEach((open, n) => open.resolve(abandoned[n])));
    check(abandoned.every(client => client.closes === 1), "clients resolving after cleanup close immediately");
    opens = [];
    await mount(h(Component));
    await act(async () => { opens[0].reject(Error("obsolete")); opens[1].reject(Error("current open failed")); });
    check(host.textContent.includes("current open failed") && !host.textContent.includes("obsolete"), "current rejection is visible");
    await unmount();
  };
}

cases["web sign-out reports completion only after durable clearing and offers retry on failure"] = async () => {
  const client = controlled();
  let opens = 0, ending = deferred();
  globalThis.openClient = () => Promise.resolve(opens++ === 0 ? controlled() : client);
  client.signOut = () => ending.promise;
  await mount(h(WebApp));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Sign out").click());
  check(host.textContent.includes("Signing out…") && !host.textContent.includes("Signed out"), "pending deletion cannot announce sign-out");
  check(client.closes === 0, "effect cleanup does not race the SDK sign-out lifecycle");
  await act(async () => ending.reject(Error("session storage unavailable")));
  check(host.textContent.includes("session storage unavailable") && !host.textContent.includes("Continue as a guest"), "failure is visible without a completed sign-out path");
  ending = deferred();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Retry").click());
  await act(async () => ending.resolve());
  check(host.textContent.includes("Signed out") && host.textContent.includes("Continue as a guest"), "completion follows successful retry");
  await unmount();
};

for (const hook of ["useQuery", "usePage"]) for (const guarded of [false, true]) {
  cases[hook + " lingering remount has data in its first committed render" + (guarded ? " through the app facade" : "")] = async () => {
    let latest, queries = 0, commits = [];
    const originalNow = performance.now;
    let monotonic = originalNow.call(performance);
    const raw = createClient({ url: "http://first-commit.test", persona: "alice", fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
      if (path === "/q/read") { queries++; return Response.json({ data: ["secret"], complete: true, seq: 0 }); }
      throw Error(path);
    } });
    const facade = guarded ? guardClient(raw, async () => true, () => true, () => ({ code: "ENDED", family: "auth", message: "ended" })) : null;
    const client = facade?.client ?? raw;
    function Probe() {
      const value = hook === "useQuery" ? useQuery(query, {}, { keep: true }) : usePage(query, {}, { keep: true }).read;
      latest = value;
      useLayoutEffect(() => { commits.push({ read: value, html: host.innerHTML }); });
      return value.loading ? h("span", null, "Loading") : h("input", { defaultValue: value.data?.[0] });
    }
    try {
      await mount(h(Probe), client);
      await awaitState(async () => !(!latest.data), 'helpers/react-harness.mjs: !latest.data', { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } });
      equal(latest.data, ["secret"], "initial query settled");
      performance.now = () => monotonic;
      await unmount();
      const before = queries, snapshot = latest;
      commits = [];
      await mount(h(Probe), client);
      equal(commits[0]?.read, snapshot, "first layout effect sees the lingering snapshot with unchanged metadata");
      check(commits[0].html.includes('value="secret"') && !commits[0].html.includes("Loading"), "first committed DOM contains the editor");
      check(commits.every(commit => !commit.read.loading), "subscription replay never commits loading either");
      equal(queries, before, "remount joins the same live watch without another read");
      await unmount();
      monotonic += 30_000;
      commits = [];
      await mount(h(Probe), client);
      check(commits[0]?.read.loading, "first commit at the exact linger cutoff starts loading, even before its timer fires");
    } finally { performance.now = originalNow; await unmount(); facade?.fence()(); await raw.close(); }
  };
}

for (const hook of ["useQuery", "usePage"]) {
  cases[hook + " createApp remount first commits the lingering answer during a held re-read"] = async () => {
    const url = "http://lingering-reread-" + hook + ".test", memory = memorySessionStore();
    await keepSession(url, { kind: "user", token: "alice", principal: "alice", expiresAt: Date.now() + 7 * 86400000 }, memory);
    let latest, queries = 0, commits = [], changed = false, holding = false;
    const change = deferred(), replacement = deferred();
    const app = createApp({ url, sessionStore: memory, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/schema") return Response.json({ schema: { tables: {} }, programs: [] });
      if (path === "/probe") return Response.json({ ok: true, principal: "alice" });
      if (path === "/changes") {
        if (!changed) { changed = true; return change.promise; }
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
      }
      if (path === "/q/read") {
        queries++;
        if (holding) await replacement.promise;
        return Response.json({ data: [holding ? "replacement" : "secret"], complete: true, tables: ["notes"], seq: holding ? 1 : 0 });
      }
      throw Error(path);
    } });
    const settle = async condition => {
      // Flush React once even when the requested state is already true.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      return awaitState(condition, "lingering re-read did not settle: " + JSON.stringify({ latest, queries }), { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } });
    };
    function Probe() {
      latest = hook === "useQuery" ? useQuery(query, {}, { keep: true }) : usePage(query, {}, { keep: true }).read;
      useLayoutEffect(() => { commits.push({ read: latest, html: host.innerHTML }); });
      return latest.loading ? h("span", null, "Loading") : h("input", { defaultValue: latest.data?.[0] });
    }
    try {
      check((await app.ready).ok, "createApp restored authority");
      await mount(h(Probe), app.client);
      await settle(() => latest.data?.[0] === "secret" && latest.fresh);
      await unmount();
      holding = true;
      change.resolve(Response.json({ tables: ["notes"], seq: 1 }));
      await settle(() => queries >= 2);
      const before = queries;
      commits = [];
      await mount(h(Probe), app.client);
      equal(commits[0]?.read.data, ["secret"], "first commit keeps the previously authorized answer");
      check(commits[0].read.fresh === true && commits[0].read.revalidating === true, "first commit preserves freshness and carries revalidation");
      check(commits[0].html.includes('value="secret"') && !commits[0].html.includes("Loading"), "the editor is in the first committed DOM");
      check(commits.every(commit => !commit.read.loading), "StrictMode subscription replay never flashes loading");
      equal(queries, before, "joining the running watch adds no duplicate read");
      replacement.resolve();
      await settle(() => latest.data?.[0] === "replacement");
    } finally {
      change.resolve(Response.json({ tables: [], seq: 1 })); replacement.resolve();
      await unmount(); await app.close();
    }
  };
}

for (const [name, Component] of [["web", Composer], ["Expo", Thread]]) {
  cases[name + " composer preserves edits, immediate failure and offline admission"] = async () => {
    const client = controlled();
    localStorage.clear();
    const view = new ViewState(client, "http://starter-test", client.viewer());
    await mount(h(Component, { conversationId: "c", backend: "http://starter-test", view, onBack: () => {} }), client);
    await edit("draft A"); await submit();
    check(client.writes.length === 1, "draft submitted once");
    await edit("draft B");
    await act(async () => client.writes[0].resolve(sent("a")));
    check(host.querySelector("input").value === "draft B", "settling A preserves new draft B");
    await submit();
    await act(async () => client.writes[1].resolve(failed("b")));
    check(host.querySelector("input").value === "draft B" && host.textContent.includes("message refused"), "refusal preserves and explains the draft");
    await submit();
    await act(async () => client.writes[2].resolve({ state: "pending", id: "pending-b" }));
    check(host.querySelector("input").value === "" && host.textContent.includes("Queued"), "durable offline admission releases the draft");
    await edit("draft C"); await submit();
    check(client.writes.length === 4, "another draft need not await acknowledgement of the pending one");
    await act(async () => client.writes[3].resolve(sent("c")));
    check(host.querySelector("input").value === "", "successful unchanged draft clears");
    await edit("failed earlier draft"); await submit(); await edit("newer draft");
    await act(async () => client.writes[4].resolve(failed("earlier")));
    check(host.querySelector("input").value === "newer draft" && host.textContent.includes("failed earlier draft"), "failure retains both the submitted and current drafts");
    await submit();
    await act(async () => client.writes[5].resolve(sent("newer")));
    check(host.textContent.includes("failed earlier draft"), "a later success does not discard an unsent message");
    await unmount(); allClosed(client);
  };
}

for (const [name, Component] of [["web", Composer], ["Expo", Thread]]) {
  cases[name + " submit owns a fresh field and storage failure keeps the draft"] = async () => {
    localStorage.clear(); const client = controlled();
    const view = new ViewState(client, "http://starter-test", client.viewer());
    await mount(h(Component, { backend: "http://starter-test", conversationId: "c", view, onBack: () => {} }), client);
    await edit("hello");
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw Error("disk full"); };
    try { await submit(); } finally { Storage.prototype.setItem = save; }
    check(client.writes.length === 0 && host.querySelector("input").value === "hello", "storage failure cannot dispatch or clear");
    check(localStorage.length === 0, "storage failure saved nothing");
    check(host.textContent.includes("Not sent: could not save it on this device; your draft is kept."), "storage failure explains that nothing was sent");
    await submit(); equal(host.querySelector("input").value, "", "clear at submit");
    await edit(""); await edit("hello again");
    equal(client.writes[0].options.waitSeconds, 0, "composer returns at custody");
    await act(async () => client.writes[0].resolve({ state: "pending", id: client.writes[0].options.id }));
    equal(host.querySelector("input").value, "hello again", "clear-and-retype keeps the whole new draft");
    await unmount();
  };
}
cases["Expo composer uses membership presence without losing its draft"] = async () => {
  localStorage.clear(); const client = controlled();
  await mount(h(Thread, { backend: "http://starter-test", conversationId: "c", onBack: () => {} }), client);
  await edit("kept draft"); const input = host.querySelector("input");
  const member = client.records.find(record => record.op.name === "myMembership" && record.closes === 0);
  for (const [read, disabled] of [[{ loading: true }, false], [ready(null, null, { complete: false }), false],
    [ready(null), true], [{ denied: { message: "Membership refused" } }, true], [ready({ id: "member" }, null, { revalidating: true }), false]]) {
    await act(async () => member.set(read));
    equal([...host.querySelectorAll("button")].find(button => button.textContent === "Send").disabled, disabled, "membership control");
    check(host.querySelector("input") === input && input.value === "kept draft", "membership status preserves the mounted draft");
  }
  await unmount(); allClosed(client);
};

cases["Expo observes every saved ID across reload, late refusal, unknown receipt and account switch"] = async () => {
  localStorage.clear(); const client = controlled();
  const props = { backend: "http://starter-test", conversationId: "c", onBack: () => {} };
  await mount(h(Thread, props), client);
  for (const body of ["A text", "B text", "C text"]) {
    await edit(body); await submit(); const call = client.writes.at(-1);
    await act(async () => { const write = { state: "pending", id: call.options.id }; client.receipts.set(write.id, write); call.resolve(write); });
  }
  const [a, b, c] = client.writes.map(call => call.options.id);
  const key = 'snapback4-chat:' + JSON.stringify([props.backend, client.viewer()]);
  equal(JSON.parse(localStorage.getItem(key)).intents.map(i => i.id), [a, b, c], "three saved IDs");
  await unmount(); await mount(h(Thread, props), client);
  check(client.writes.length === 3 && host.textContent.match(/Queued on this device/g).length === 3, "reopen observes all three without dispatch");
  await act(async () => client.emitWrite(sent(b)));
  await act(async () => client.emitWrite(failed(a)));
  check(host.textContent.includes("A text") && host.textContent.includes("message refused"), "A refusal after B is visible with its text");
  check(!JSON.parse(localStorage.getItem(key)).intents.some(i => i.id === b), "sent ID leaves the journal");
  client.receipts.delete(c);
  await unmount(); await mount(h(Thread, props), client);
  check(host.textContent.includes("Outcome unknown — check the conversation before sending again"), "missing receipt stays unknown");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Edit").click());
  equal(host.querySelector("input").value, "A text", "edit restores refused text as a new draft");
  await submit(); check(client.writes[3].options.id !== a, "deliberate edited send is a new intent");
  const next = controlled(); next.setViewer("dev:other");
  await render(h(Thread, props), next);
  await act(async () => client.writes[3].resolve(failed(client.writes[3].options.id)));
  check(!host.textContent.includes("A text") && !host.textContent.includes("message refused") && !host.textContent.includes("Outcome unknown"), "account switch fences references and late responses");
  check(next.writes.length === 0, "no other-account resubmission"); await unmount();
};
cases["Expo read gaps preserve the composer while hiding protected rows; inbox distinguishes empty and incomplete"] = async () => {
  localStorage.clear();
  const client = controlled(() => ready([{ id: "m", body: "protected body", authorId: "dev:test", at: 1 }], "older"));
  await mount(h(Thread, { backend: "http://starter-test", conversationId: "c", onBack: () => {} }), client);
  await edit("my draft"); const input = host.querySelector("input");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Load more").click());
  await act(async () => client.records.at(-1).set({ loading: true }));
  check(host.textContent.includes("protected body"), "page two loading keeps page one's current rows");
  await act(async () => { for (const record of client.records.filter(r => r.closes === 0)) record.set({ loading: true }); });
  check(host.querySelector("input") === input && input.value === "my draft", "same mounted composer and draft");
  check(host.textContent.includes("Updating…") && !host.textContent.includes("protected body"), "read gap hides all previous rows");
  await unmount();
  const inbox = controlled(() => ({ loading: true })); await mount(h(ExpoInbox, { onSelect: () => {} }), inbox);
  check(host.textContent.includes("Loading…") && !host.textContent.includes("No conversations"), "loading is not empty");
  const record = inbox.records.at(-1);
  await act(async () => record.set(ready([{ conversationId: "c", conversation: { title: "Private room" }, count: undefined }], null, { complete: false })));
  check(!host.textContent.includes("may be incomplete") && host.textContent.includes("–"), "nonempty is present; unavailable count stays explicit");
  await act(async () => record.set({ loading: true }));
  check(host.textContent.includes("Updating…") && !host.textContent.includes("Private room"), "inbox gap keeps shell without old rows");
  await act(async () => record.set({ denied: { message: "No access" } }));
  check(host.textContent.includes("No access"), "denial message"); await unmount();
};
cases["web composer fences old account callbacks and preserves saved write identities"] = async () => {
  localStorage.clear();
  const a = controlled(), b = controlled();
  b.setViewer("dev:other");
  const av = new ViewState(a, "http://starter-test", a.viewer());
  const bv = new ViewState(b, "http://starter-test", b.viewer());
  const admit = a.mutate;
  a.mutate = (op, args, options) => {
    check(av.read().intents.some(intent => intent.id === options.id), "reference is durable before SDK dispatch");
    return admit(op, args, options);
  };
  await mount(h(Composer, { key: av.key, conversationId: "a-room", view: av }), a);
  await edit("A private draft"); await submit();
  const original = av.read().intents[0].id;
  check(original.length === 26 && a.writes.length === 1 && a.writes[0].options.id === original, "saved ID is the SDK admission ID");
  av.active = false;
  await render(h(Composer, { key: bv.key, conversationId: "b-room", view: bv }), b);
  await act(async () => a.writes[0].resolve(failed(original)));
  check(!host.textContent.includes(original) && !host.textContent.includes("A private draft") && !host.textContent.includes("message refused"), "A result cannot enter B UI");
  check(b.writes.length === 0 && bv.read().intents.length === 0, "account switch does not replay A as B");
  check(av.read().intents[0].id === original, "switch preserves A reference");
  let refused = false;
  try { av.remember({ id: "late", room: "a-room", operation: "send" }); } catch { refused = true; }
  check(refused, "a delayed A callback cannot admit another reference");
  const otherBackend = new ViewState(a, "http://different-backend", a.viewer());
  check(otherBackend.read().intents.length === 0, "references do not cross backends");
  await unmount();
};
cases["receipt notifications read one pending list for ten thousand message hooks"] = async () => {
  const client = controlled(), listeners = new Set();
  let reads = 0, renders = 0, entries = [];
  client.onPendingWrites = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  client.pendingWrites = async () => { reads++; return entries.map(entry => ({ ...entry })); };
  function Bubble() { const writes = usePendingWrites(mutation); renders++; return h("span", null, writes.length); }
  await mount(h("div", null, Array.from({ length: 10000 }, (_, key) => h(Bubble, { key }))), client);
  equal(listeners.size, 1, "the message history shares one pending-list subscription");
  const startReads = reads, startRenders = renders;
  for (let peer = 1; peer < 50; peer++) {
    await act(async () => { for (const notify of listeners) notify(); });
  }
  equal(reads - startReads, 49, "per-receipt work is independent of message count");
  equal(renders, startRenders, "unchanged empty outboxes do not rerender the history");
  entries = [{ id: "own", op: "write", args: {}, state: "queued", predicted: [] }];
  await act(async () => { for (const notify of listeners) notify(); });
  check([...host.querySelectorAll("span")].every(span => span.textContent === "1"), "every hook sees an admitted own write");
  entries = [];
  await act(async () => { for (const notify of listeners) notify(); });
  check([...host.querySelectorAll("span")].every(span => span.textContent === "0"), "settlement reaches every hook");
  await unmount();
  equal(listeners.size, 0, "last unmount releases the shared subscription");
};

cases["pending-write lists filter, update, fence old reads, and release StrictMode subscriptions"] = async () => {
  const listeners = new Set(), reads = [];
  let values = [], current;
  const client = controlled();
  client.onPendingWrites = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  client.pendingWrites = () => { const read = deferred(); reads.push(read); return read.promise; };
  function List({ op }) { current = usePendingWrites(op); return h("div", null, current.map(w => w.id + ":" + w.state).join(",")); }
  await mount(h(List, { op: mutation }), client);
  equal(listeners.size, 1, "StrictMode leaves one listener");
  const queued = { id: "one", op: "write", args: { text: "typed" }, state: "queued", predicted: [] };
  await act(async () => { for (const read of reads.splice(0)) read.resolve([queued]); });
  equal(current, [queued], "initial queue is visible without a predicted row");
  await act(async () => { for (const notify of listeners) notify(); });
  const older = reads.pop();
  await act(async () => { for (const notify of listeners) notify(); });
  const sent = { ...queued, state: "sent" };
  await act(async () => { reads.pop().resolve([sent, { ...queued, id: "other", op: "edit" }]); });
  equal(current, [sent], "filter retains only this operation");
  await act(async () => { older.resolve([queued]); });
  equal(current, [sent], "overtaken list cannot regress dispatch");
  const held = { ...sent, state: "held", reason: "E_BUSY" };
  await act(async () => { for (const notify of listeners) notify(); });
  await act(async () => { reads.pop().resolve([held]); });
  equal(current, [held], "retryable hold is visible");
  await render(h(List), client);
  await act(async () => { reads.pop().resolve([held, { ...queued, id: "other", op: "edit" }]); });
  equal(current.length, 2, "omitting the filter lists every mutation");
  await act(async () => { for (const notify of listeners) notify(); });
  await act(async () => { reads.pop().resolve([]); });
  equal(current, [], "settlement removes writes");
  await act(async () => { for (const notify of listeners) notify(); });
  const detached = reads.pop();
  await unmount();
  equal(listeners.size, 0, "unmount releases listeners");
  await act(async () => detached.resolve([held]));
  await mount(h(List), client);
  equal(current, [], "remount cannot publish the old lifetime");
  await act(async () => { for (const read of reads.splice(0)) read.resolve([]); });
  await unmount();
};


for (const [name, Component] of [["web", Composer], ["Expo", Thread]]) {
  cases[name + " receipt labels separate admission, restoration and unknown; late refusal offers text"] = async () => {
    localStorage.clear(); const client = controlled();
    const view = new ViewState(client, "http://starter-test", client.viewer());
    const props = { backend: "http://starter-test", conversationId: "c", view, onBack: () => {} };
    let lookup = deferred(); client.write = () => lookup.promise;
    await mount(h(Component, props), client);
    await edit("saved text"); await submit();
    check(host.textContent.includes("Saving…") && !host.textContent.includes("Outcome unknown"), "admitting label");
    check(![...host.querySelectorAll("button")].some(b => b.textContent.startsWith("Dismiss")), "admission cannot be dismissed");
    await edit("next draft");
    const id = client.writes[0].options.id;
    await act(async () => client.writes[0].resolve({ state: "pending", id }));
    equal(host.querySelector("input").value, "next draft", "typing during admission survives");
    await unmount(); await mount(h(Component, props), client);
    check(host.textContent.includes("Checking…") && !host.textContent.includes("Outcome unknown"), "restoring label");
    check(![...host.querySelectorAll("button")].some(b => b.textContent.startsWith("Dismiss")), "lookup cannot be dismissed");
    await act(async () => lookup.resolve(undefined));
    check(host.textContent.includes("Outcome unknown — check the conversation before sending again") && host.textContent.includes("saved text"), "unknown has saved text after lookup");
    check([...host.querySelectorAll("button")].some(b => b.textContent.startsWith("Dismiss")), "unknown can be dismissed");
    await act(async () => client.emitWrite(failed(id)));
    check(host.textContent.includes("saved text") && host.textContent.includes("message refused"), "late refusal has saved text");
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Edit").click());
    equal(host.querySelector("input").value, "saved text", "Edit fills an empty draft");
    await edit("new typing");
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Edit").click());
    equal(host.querySelector("input").value, "new typing saved text", "Edit appends to current typing");
    await unmount();
  };
}
cases["saved write restoration ends on reject or live outcome and restarts for another id"] = async () => {
  const client = controlled(), lookups = [];
  client.write = () => { const d = deferred(); lookups.push(d); return d.promise; };
  let latest;
  function Probe({ id }) { latest = usePendingWrite(mutation, id); return null; }
  await mount(h(Probe, { id: "saved" }), client);
  check(latest.restoring, "given id restores from mount");
  await act(async () => client.emitWrite(sent("saved")));
  check(!latest.restoring && latest.last.state === "sent", "live outcome ends restoration");
  await act(async () => { for (const lookup of lookups) lookup.resolve(undefined); });
  check(latest.last.state === "sent", "late lookup cannot replace live outcome");
  await render(h(Probe, { id: "other" }), client);
  check(latest.restoring && latest.last === undefined, "new saved id restores separately");
  await act(async () => lookups.at(-1).reject(Error("read unavailable")));
  check(!latest.restoring && latest.last === undefined, "rejection is unknown after lookup");
  await render(h(Probe, {}), client); check(!latest.restoring, "no id never restores");
  await unmount();
};
cases["web room loading keeps the same input and legacy intents disclose missing text"] = async () => {
  localStorage.clear(); location.hash = "room=c";
  const client = controlled(() => ready({ conversation: { title: "Private room" }, membership: { id: "member" } }));
  globalThis.openClient = async () => client;
  await mount(h(WebApp), client); await act(async () => {});
  await edit("draft through loading"); const input = host.querySelector("input");
  await act(async () => { for (const record of active(client)) record.set({ loading: true }); });
  check(host.querySelector("input") === input && input.value === "draft through loading", "room loading preserves input ownership");
  check(!host.textContent.includes("Private room"), "protected title is not retained");
  await unmount(); location.hash = "";
  const view = new ViewState(client, "http://starter-test", client.viewer());
  view.remember({ id: "legacy", room: "c", operation: "send" });
  await mount(h(Composer, { view, conversationId: "c" }), client);
  check(host.textContent.includes("text not kept") && host.textContent.includes("Outcome unknown"), "legacy journal opens without a body");
  await unmount();
};
${pendingItemsHarness}
${pendingPeerHarness}
`;
