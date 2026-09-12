import { subscribe } from "../src/internal.js";
import { sharedConsumers } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { api, createClient } from "../dist/client.mjs";
import { indexedDbRangeStore, SnapbackProvider, useAuth, useSnapbackClient, useSnapbackSnapshot } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { DAY, fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { RealOwnerHarness } from "./owner-harness.ts";

// @ref LLP 1012#7-writes-offline — the chat template's screens: the pending
// bubble is keyed by the first pinned id, shows `args.body` and "Sending…"
// with no time, and becomes the server row on `committed` without remounting.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens-transition.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Composer: (props: { conversationId: string }) => React.ReactElement;
let Thread: (props: { conversationId: string }) => React.ReactElement;
let screenOwner: RealOwnerHarness;

before(async () => {
  const bundled = await build({
    // The full app exercises the actual Thread; Composer remains independently
    // renderable for the transport-order test below.
    stdin: {
      contents: [
        'export { App } from "./App";',
        'export { Composer } from "./Composer";',
        'export { Thread } from "./Thread";',
      ].join("\n"),
      resolveDir: resolve(packageRoot, "templates/chat/react/src"),
      sourcefile: "screens.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    external: ["react", "react-dom", "react/jsx-runtime"],
    plugins: [{
      name: "package-dist",
      setup(plugin) {
        plugin.onResolve({ filter: /^snapback2\/(react|client)$/ }, (args) => ({ path: `./${args.path.slice("snapback2/".length)}.mjs`, external: true }));
      },
    }],
  });
  await writeFile(bundlePath, bundled.outputFiles[0]!.text);
  ({ App, Composer, Thread }
    = await import(pathToFileURL(bundlePath).href));
  // The harness starts the production chat fixture when this file runs alone,
  // or uses the suite's already-qualified full-chat owner.
  screenOwner = await RealOwnerHarness.create({ fullChat: true });
});

after(async () => { await screenOwner?.close(); await rm(bundlePath, { force: true }); });

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function requestBody(init?: RequestInit): any | undefined {
  if (typeof init?.body !== "string") return undefined;
  try { return JSON.parse(init.body); } catch { return undefined; }
}

const rejected = (intent?: string) => ({
  state: "rejected", code: "NOT_MEMBER", family: "input",
  message: "E_REQUIRE:NOT_MEMBER: program requirement failed",
  rewrite: "fix the rejected mutation input and retry", guide: "input/runtime", intent,
});

function installDom(): () => void {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://app.test" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "navigator", "Event"] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: (dom.window as any)[name] });
  }
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // react-dom decided `isInputEventSupported` when it loaded without a window,
  // so it drives text inputs through its focusin/keyup polyfill, which calls the
  // IE-era attachEvent on the focused element; jsdom has no such method.
  const inputPrototype = dom.window.HTMLInputElement.prototype as any;
  inputPrototype.attachEvent ??= () => undefined;
  inputPrototype.detachEvent ??= () => undefined;
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  };
}

async function settle(ms = 30): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 4_000): Promise<void> {
  const started = performance.now();
  while (!(await predicate())) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await settle(20);
  }
}

class MemoryBroadcastChannel {
  static members = new Map<string, Set<MemoryBroadcastChannel>>();
  static messages: any[] = [];
  static drop: (message: any) => boolean = () => false;
  onmessage?: (event: { data: unknown }) => void;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    const members = MemoryBroadcastChannel.members.get(name) ?? new Set();
    members.add(this); MemoryBroadcastChannel.members.set(name, members);
  }
  postMessage(message: unknown) {
    const copy = structuredClone(message);
    MemoryBroadcastChannel.messages.push(copy);
    if (MemoryBroadcastChannel.drop(copy)) return;
    for (const peer of MemoryBroadcastChannel.members.get(this.name) ?? []) if (peer !== this) {
      setTimeout(() => peer.onmessage?.({ data: structuredClone(copy) }), 0);
    }
  }
  close() { MemoryBroadcastChannel.members.get(this.name)?.delete(this); }
}

function text(element: Element | null | undefined): string {
  return element?.textContent ?? "";
}

/** Types into a controlled input through react-dom's polyfill path: focus, value, key. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value")!.set!;
  const view = globalThis.window as any;
  await act(async () => {
    input.focus();
    input.dispatchEvent(new view.FocusEvent("focusin", { bubbles: true }));
    setter.call(input, value);
    input.dispatchEvent(new view.KeyboardEvent("keyup", { bubbles: true, key: "End" }));
  });
}

test("partial history becomes one coherent view without remounting its pending bubble", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-partial-"));
  const store = fileRangeStore(root);
  const warm = createClient({ url: screenOwner.url, persona: "alice", offline: { store } });
  const writer = createClient({ url: screenOwner.url, persona: "alice" });
  let client: any;
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  try {
    await warm.ready;
    const group: any = await writer.mutation(api.groups.groupCreate, { title: "Partial transition", members: ["dev:bob"] });
    assert.equal(group.state, "committed");
    const conversationId = group.data.id;
    const heldThread: any = await warm.query(api.messages.thread, { conversationId, c: null });
    assert.ok(heldThread.state === "complete" || heldThread.state === "capped",
      "the fallback's kind-scoped range is independently held before the owner is cut");
    const drain = subscribe(warm, api.messages.inbox, { c: null }, () => undefined, { drain: true });
    await drain.until((event: any) => event.live === true && event.caughtUp === true, 5_000);
    drain.close();
    await warm.close();
    client = createClient({ url: screenOwner.url, persona: "alice", startOffline: true, offline: { store } });
    await client.ready;
    await act(async () => reactRoot.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId }))));
    await waitFor(() => document.querySelector("ol.bubbles")?.getAttribute("data-view-source") === "partial-history",
      "the independently covered history fallback");
    assert.equal(sharedConsumers(client, api.messages.thread, { conversationId, c: null }), 1,
      "the partial composite opens one independently authorized history observer");
    assert.match(text(document.querySelector(".thread-history-note")), /Count and preview unavailable/);
    assert.match(text(document.querySelector(".thread-summary")), /Message count unavailable/);
    assert.equal(document.querySelector(".thread-summary")?.hasAttribute("data-count"), false,
      "the partial composite cannot publish its count while history supplies rows");
    const result = await client.mutation(api.messages.send, { conversationId, body: "kept through transition" });
    assert.equal(result.state, "queued");
    await waitFor(() => document.querySelector(`li[data-message="${result.ids[0]}"][data-state=queued]`) !== null,
      "the fallback pending bubble");
    const pending = document.querySelector(`li[data-message="${result.ids[0]}"]`)!;
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("ol.bubbles")?.getAttribute("data-view-source") === "composite"
      && document.querySelector(`li[data-message="${result.ids[0]}"][data-state=row]`) !== null,
    "the usable composite after resume");
    assert.equal(document.querySelector(`li[data-message="${result.ids[0]}"]`) === pending, true,
      "the BubbleList ancestor and keyed row survive partial history to composite publication");
    assert.equal(document.querySelector(".thread-history-note"), null, "the fallback unmounts once the composite is usable");
    assert.equal(sharedConsumers(client, api.messages.thread, { conversationId, c: null }), 0,
      "the history observer detaches once the composite is complete or capped");
    assert.equal(sharedConsumers(client, api.messages.conversationView, { conversationId }), 1,
      "the composite alone remains subscribed after the fallback retires");
  } finally {
    await act(async () => reactRoot.unmount());
    await warm.close(); await client?.close(); await writer.close(); restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("the cold chat keeps both intents queued after a committed replay loses its response", async (t) => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-503-"));
  const files = fileRangeStore(root);
  let carrier: ReturnType<typeof files>;
  const store = () => carrier = files();
  let token: string | null = null, binding: { token: string; principal: string } | null = null;
  const tokenStore = { load: () => token, save: (value: string | null) => { token = value; },
    loadPrincipalBinding: () => binding,
    savePrincipal: (principal: string | null, bearer?: string) => { binding = principal && bearer ? { token: bearer, principal } : null; } };
  const warm = createClient({ url: screenOwner.url, tokenStore, offline: { store } });
  let writer: any;
  const replays: string[] = [];
  let cut = true, fault = true;
  let replayAck: any;
  let client: any;
  const reactRoot = createRoot(document.getElementById("root")!);
  try {
    await warm.ready;
    await warm.auth.guest();
    const principal = warm.snapshot.auth.viewer;
    assert.ok(principal, "the persisted session binds a real guest principal");
    writer = createClient({ url: screenOwner.url, tokenStore });
    await writer.ready;
    const group: any = await writer.mutation(api.groups.groupCreate, { title: "503 transition", members: ["dev:bob"] });
    assert.equal(group.state, "committed");
    const conversationId = group.data.id;
    const held = await writer.mutation(api.messages.send, { conversationId, body: "held message" });
    assert.equal(held.state, "committed");
    const drain = subscribe(warm, api.messages.inbox, {}, () => undefined, { drain: true });
    await drain.until((event: any) => event.live === true && event.caughtUp === true, 5_000);
    assert.deepEqual(await warm.outbox.settled(), { stopped: false, remaining: 0 }, "initial delivery acknowledgements settle before the offline fixture");
    await warm.offline();
    const first = await warm.mutation(api.messages.send, { conversationId, body: "first durable send" });
    assert.equal(first.state, "queued");
    drain.close();
    await warm.close();
    client = createClient({ url: screenOwner.url, tokenStore, offline: { store },
      fetch: async (input: any, init: any) => {
        const path = new URL(String(input)).pathname;
        if (cut) throw new TypeError("owner unreachable");
        if (path === "/api/mutation" && JSON.parse(String(init.body)).op === "messages.send") replays.push(init.body);
        const response = await globalThis.fetch(input, init);
        if (fault && path === "/api/mutation" && JSON.parse(String(init.body)).op === "messages.send") {
          fault = false;
          const committed = await response.json();
          assert.equal(committed.state, "committed", "the 503 replaces a real commit receipt");
          // Hold that response until independent live disclosure has earned its
          // own acknowledgement. This makes the extra FIFO work deterministic.
          await waitFor(async () => {
            const entries = await client.outbox.entries();
            const state = (await carrier!.changes()).snapshot!;
            replayAck = entries.find((entry: any) => entry.op === "_delivery.deliveries.ack" && entry.state === "queued"
              && entry.args.events.some((event: string) => state.rows[`deliveries\0${event}`]?.row.row === committed.data.id
                && state.deliveryAcks[`deliveries\0${event}`]?.[0] >= committed.seq));
            return !!replayAck;
          }, "independent accepted delivery earns its acknowledgement before response loss");
          cut = true; // No genuine reconnect opportunity until the manual fallback below.
          return json({ message: "injected 503" }, 503);
        }
        return response;
      },
    });
    await act(async () => reactRoot.render(React.createElement(React.StrictMode, null,
      React.createElement(SnapbackProvider, { client }, React.createElement(App)))));
    await client.offline();
    await waitFor(() => !!document.querySelector(`nav li[data-conversation="${conversationId}"] button`), "cold inbox");
    await act(async () => { document.querySelector<HTMLButtonElement>(`nav li[data-conversation="${conversationId}"] button`)!.click(); });
    await waitFor(() => document.querySelector("ol.bubbles")?.getAttribute("data-view-source") === "partial-history", "cold partial history");
    await type(document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!, "second durable send");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => document.querySelectorAll("li[data-state=queued]").length === 2, "two queued bubbles");
    const pending = document.querySelector(`li[data-message="${first.ids[0]}"]`)!;
    const queued = (await client.outbox.entries()).filter((e: any) => e.state === "queued");
    assert.deepEqual(queued.map((entry: any) => entry.op), ["messages.send", "messages.send"]);
    assert.equal(client.snapshot.auth.viewer, undefined, "the cold bearer is not confirmed yet");
    assert.equal(client.snapshot.auth.restoringViewer, principal, "the token-bound principal preserves the held app");
    cut = false;
    let verdict: any;
    await act(async () => { await client.online(); verdict = await client.outbox.settled(); });
    const stopped = (await client.outbox.entries()).filter((entry: any) => entry.state === "queued");
    assert.deepEqual(stopped.map((entry: any) => [entry.intent, entry.op]), [
      ...queued.map((entry: any) => [entry.intent, "messages.send"]), [replayAck.intent, "_delivery.deliveries.ack"],
    ], "the only new queued work is the acknowledgement of the independently delivered first send");
    assert.equal(replayAck.args.events.length, 1);
    assert.deepEqual(verdict, { stopped: "transport", remaining: 3 });
    assert.equal(client.snapshot.auth.viewer, principal);
    const custody = (entries: any[]) => entries.filter(entry => entry.op === "messages.send").map(({ intent, state, ids, args }) => ({ intent, state, ids, args }));
    assert.deepEqual(custody(await client.outbox.entries()), custody(queued), "neither intent settled or changed after the lost receipt");
    await waitFor(() => document.querySelectorAll("li[data-state=queued]").length === 2,
      "both queued bubbles through the continuing outage after the lost response");
    assert.equal(document.querySelector(`li[data-message="${first.ids[0]}"]`) === pending, true, "auth confirmation must not remount the pinned bubble");
    assert.equal(replays.length, 1, "mounting and confirming auth must not start an additional replay");
    await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>("form button")].some(button => text(button) === "Sync now" && !button.disabled),
      "manual recovery after the bounded automatic flight stops");
    const sync = [...document.querySelectorAll<HTMLButtonElement>("form button")].find(button => text(button) === "Sync now");
    assert.ok(sync && !sync.disabled, "the stopped queue exposes usable recovery");
    cut = false;
    await act(async () => { sync.click(); });
    await waitFor(async () => (await client.outbox.entries()).every((e: any) => e.state === "committed")
      && queued.every((e: any) => document.querySelector(`li[data-message="${e.ids[0]}"]`)?.getAttribute("data-state") === "row"), "both sends settle through Sync");
    assert.deepEqual(replays.map(body => JSON.parse(body).replay.intent), [queued[0].intent, queued[0].intent, queued[1].intent]);
    assert.equal(replays[1], replays[0], "recovery retries byte-identical pinned intent bytes");
    // @ref LLP 1018.008.005.000#page-and-history-lifecycle — settled rows can
    // become unreadable while a newly eligible history reacquires its source.
    // DOM continuity above covers the uninterrupted draft through auth/loss;
    // after source requalification every original message must return once.
    assert.deepEqual([...document.querySelectorAll("ol.bubbles li[data-message]")]
      .map(element => element.getAttribute("data-message")).sort(), [held.data.id, ...queued.map((entry: any) => entry.ids[0])].sort());
    const thread = await writer.query(api.messages.thread, { conversationId });
    const bodies = thread.data.map((row: any) => row.message?.body);
    assert.equal(bodies.filter((body: string) => body === "first durable send").length, 1);
    assert.equal(bodies.filter((body: string) => body === "second durable send").length, 1);
    assert.ok(bodies.indexOf("second durable send") < bodies.indexOf("first durable send"), "the newest-first thread proves FIFO execution");
    t.diagnostic("503: 2 unchanged queued sends + 1 independently earned delivery acknowledgement = 3 queued entries; 2 queued bubbles, 1 send request, same pinned node through auth/loss. Sync: 3 send attempts [first, first, second], 1 owner row each, all acknowledgements committed, exact 3 final message IDs after source requalification.");
  } finally {
    await act(async () => reactRoot.unmount());
    await warm.close(); await client?.close(); await writer?.close(); restore();
    await rm(root, { recursive: true, force: true });
  }
});

// @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction — the selected image keeps its mounted viewing instance through consumed-row removal, within one viewer.
test("preserving the conversation does not carry a photo-opening choice to another viewer", async (t) => {
  const restore = installDom();
  let bobAssetRequests = 0;
  let releasePhoto!: () => void, receivedPhoto!: () => void;
  const photoReady = new Promise<void>(resolve => { receivedPhoto = resolve; });
  const heldPhoto = new Promise<void>(resolve => { releasePhoto = resolve; });
  const alice = createClient({ url: screenOwner.url, persona: "alice", fetch: async (input, init) => {
    if (!new URL(String(input)).pathname.startsWith("/api/asset/")) return globalThis.fetch(input, init);
    let response: Response, bytes: ArrayBuffer;
    try { response = await globalThis.fetch(input, init); bytes = await response.arrayBuffer(); }
    finally { receivedPhoto(); }
    await heldPhoto;
    return new Response(bytes, { status: response.status, headers: response.headers });
  } });
  const bob = createClient({ url: screenOwner.url, persona: "bob", fetch: async (input, init) => {
    if (new URL(String(input)).pathname.startsWith("/api/asset/")) bobAssetRequests++;
    return globalThis.fetch(input, init);
  } });
  const root = createRoot(document.getElementById("root")!);
  const render = (client: any) => React.createElement(SnapbackProvider, { client },
    React.createElement(Thread, { conversationId: "conversation-1" }));
  try {
    await alice.ready; await alice.auth.me(); await bob.ready; await bob.auth.me();
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await alice.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const sent = await alice.mutation(api.messages.sendOncePhoto, { conversationId: "conversation-1", photo });
    assert.equal(sent.state, "committed");
    const selector = `li[data-message="${sent.data.id}"]`;
    const button = () => [...document.querySelectorAll<HTMLButtonElement>(`${selector} button`)]
      .find(node => text(node) === "View photo once");
    await act(async () => root.render(render(alice)));
    await waitFor(() => !!button(), "Alice's unopened photo");
    await act(async () => { button()!.click(); });
    const viewing = document.querySelector(`${selector} img`);
    assert.ok(viewing, "Alice explicitly mounts one viewing instance");
    await act(async () => { await photoReady; });
    await act(async () => {
      const consumed = await alice.query(api.messages.conversationView, { conversationId: "conversation-1" });
      assert.ok(consumed.state === "complete" || consumed.state === "capped");
      assert.ok(!JSON.stringify(consumed.data).includes(photo.id), "the real owner has redacted the consumed descriptor");
    });
    assert.ok(document.querySelector(`${selector} img`) === viewing, "the consumed join keeps the mounted viewing instance before bytes resolve");
    releasePhoto();
    await waitFor(() => !!document.querySelector(`${selector} img`)?.getAttribute("src"), "Alice's opened photo bytes");
    const list = document.querySelector("ol.bubbles");
    await act(async () => root.render(render(bob)));
    await waitFor(() => !!button(), "Bob's separate photo-opening choice");
    assert.ok(document.querySelector("ol.bubbles") === list, "viewer changes preserve the conversation/list");
    assert.equal(document.querySelector(`${selector} img`), null, "Bob's photo is unopened before his click");
    assert.equal(bobAssetRequests, 0, "changing viewers cannot spend the new viewer's once delivery");
    const unopened = document.querySelector(selector);
    await act(async () => { button()!.click(); });
    await waitFor(() => !!document.querySelector(`${selector} img`)?.getAttribute("src"), "Bob's explicitly opened photo bytes");
    assert.equal(bobAssetRequests, 1, "Bob's click requests his photo bytes exactly once");
    assert.strictEqual(document.querySelector("ol.bubbles"), list);
    assert.strictEqual(document.querySelector(selector), unopened, "opening preserves Bob's bubble");
    t.diagnostic("Alice → Bob: 0 Bob byte requests before click; exactly 1 after explicit open; list and Bob bubble unchanged");
  } finally { releasePhoto(); await act(async () => root.unmount()); await alice.close(); await bob.close(); restore(); }
});


for (const boundary of ["navigation", "account", "anonymous"]) test(`React cold Composer preserves confirmation and clears draft/Sync state at ${boundary}`, async (t) => {
  const restore = installDom();
  const renderer = createRoot(document.getElementById("root")!);
  const update = async (client: any, conversationId: string) => { await act(async () => renderer.render(
    React.createElement(SnapbackProvider, { client }, React.createElement(Composer, { conversationId }), React.createElement(CommitProbe, { conversationId })))); };
  const input = () => document.querySelector<HTMLInputElement>("form input")!;
  const body = () => input().value;
  const typeDraft = (value: string) => type(input(), value);
  const tree = () => text(document.querySelector("form"));
  const syncButton = (title: string) => [...document.querySelectorAll<HTMLButtonElement>("form button")].find(button => text(button) === title)!;
  const pressSync = async () => { await act(async () => { syncButton("Sync now").click(); }); };
  const wait = (predicate: () => boolean) => waitFor(predicate, "cold Composer state");
  const commits: { conversationId: string; state: string; viewer?: string; body: string }[] = [];
  function CommitProbe({ conversationId }: { conversationId: string }) {
    const { session: auth } = useAuth();
    React.useLayoutEffect(() => {
      if (renderer) commits.push({ conversationId, state: auth.state, viewer: auth.viewer, body: body() });
    });
    return null;
  }
  const directory = await mkdtemp(join(tmpdir(), "a2-cold-composer-"));
  const store = fileRangeStore(directory);
  const warm = createClient({ url: screenOwner.url, persona: "alice", offline: { store } });
  const other = createClient({ url: screenOwner.url });
  let client: any, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const replayEntered = new Promise<void>(done => { entered = done; });
  let sends = 0;
  try {
    await warm.ready;
    await warm.query(api.messages.thread, { conversationId: "conversation-1" });
    const drain = subscribe(warm, api.messages.inbox, {}, () => undefined, { drain: true });
    await drain.until(event => event.live === true && event.caughtUp === true, 5_000);
    await warm.offline();
    const queued = await warm.mutation(api.messages.send, { conversationId: "conversation-1", body: "queued before cold confirmation" });
    assert.equal(queued.state, "queued");
    drain.close(); await warm.close();
    client = createClient({ url: screenOwner.url, persona: "alice", startOffline: true, offline: { store }, fetch: async (input, init) => {
      const response = await globalThis.fetch(input, init);
      if (new URL(String(input)).pathname !== "/api/mutation") return response;
      sends++;
      assert.equal((await response.json()).state, "committed");
      entered(); await gate;
      return new Response(JSON.stringify({ message: "lost receipt" }), { status: 503 });
    } });
    await client.ready;
    await update(client, "conversation-1");
    assert.equal(client.snapshot.auth.viewer, undefined);
    await typeDraft("unfinished cold draft");
    const coldInput = input();
    await pressSync();
    await act(async () => { await replayEntered; });
    assert.equal(client.snapshot.auth.viewer, "dev:alice");
    assert.equal(body(), "unfinished cold draft", "first confirmation preserves the unsent draft");
    assert.strictEqual(input(), coldInput, "first confirmation keeps the Composer mounted");
    assert.equal(syncButton("Syncing…").disabled, true, "Sync stays in flight while its response is held");
    release();
    await wait(() => tree().includes("1 queued; sync paused. Your messages are saved."));
    assert.equal(body(), "unfinished cold draft");
    assert.equal(syncButton("Sync now").disabled, false);
    assert.equal(sends, 1, "confirmation must not trigger an extra replay");
    assert.equal((await client.outbox.entries()).find((entry: any) => entry.op === "messages.send")!.state, "queued");
    await other.ready; await other.auth.guest();
    if (boundary === "anonymous") await other.auth.logout();
    commits.length = 0;
    await update(boundary === "navigation" ? client : other, boundary === "navigation" ? "conversation-2" : "conversation-1");
    assert.ok(commits.length > 0);
    assert.ok(commits.every(commit => commit.body === ""), `${boundary}: no committed frame exposes the old draft`);
    assert.equal(body(), "", `${boundary}: draft reset is synchronous`);
    assert.ok(!tree().includes("sync paused"), `${boundary}: old Sync advice is gone`);
    assert.ok(!tree().includes("Syncing…"), `${boundary}: old Sync activity is gone`);
    // Exercise navigation and a live logout independently of the boundary above.
    await typeDraft("navigation draft");
    commits.length = 0;
    await update(boundary === "navigation" ? client : other, boundary === "navigation" ? "conversation-1" : "conversation-2");
    assert.ok(commits.length > 0 && commits.every(commit => commit.body === ""));
    await update(other, "conversation-1");
    if (boundary === "anonymous") await act(async () => { await other.auth.guest(); });
    await typeDraft("logout draft");
    commits.length = 0;
    await act(async () => { await other.auth.logout(); });
    const anonymous = commits.filter(commit => commit.state === "anonymous");
    assert.ok(anonymous.length > 0);
    assert.ok(anonymous.every(commit => commit.body === ""), "no anonymous commit exposes the old draft");
    assert.equal(other.snapshot.auth.state, "anonymous");
    assert.equal(body(), "", "logout resets the draft synchronously");
    t.diagnostic("cold confirmation: unsent draft + input identity + in-flight Sync + stopped advice preserved; 1 replay; all scope resets verified");
  } finally {
    release(); await act(async () => renderer?.unmount());
    await warm.close(); await client?.close(); await other.close();
    restore();
    await rm(directory, { recursive: true, force: true });
  }
});
