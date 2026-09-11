import { sharedConsumers, subscribe } from "../src/internal.js";
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
import { api, createClient, mutationTarget } from "../dist/client.mjs";
import { indexedDbRangeStore, SnapbackProvider, useSnapbackClient, useSnapbackSnapshot } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { DAY, fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { RealOwnerHarness } from "./owner-harness.ts";

// @ref LLP 1012#7-writes-offline — the chat template's screens: the pending
// bubble is keyed by its certified message target, shows `args.body` and "Sending…"
// with no time, and becomes the server row on `committed` without remounting.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens-owner.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Composer: (props: { conversationId: string }) => React.ReactElement;
let Thread: (props: { conversationId: string }) => React.ReactElement;
let conversationItems: any;
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
        'export { conversationItems } from "../../shared/thread";',
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
  ({ App, Composer, Thread, conversationItems } = await import(pathToFileURL(bundlePath).href));
  // The harness starts the production chat fixture when this file runs alone,
  // or uses the suite's already-qualified full-chat owner.
  screenOwner = await RealOwnerHarness.create({ fullChat: true });
});

after(async () => { await screenOwner?.close(); await rm(bundlePath, { force: true }); });

// Both Thread screens import this exact conversationView → withHistory → threadItems binding.
test("never-opened Thread binding renders a cold drained chat and predicts one offline send", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-never-opened-screen-"));
  const reads: string[] = [], attempts: unknown[] = [];
  let offline = false;
  const options = { url: screenOwner.url, persona: "never-opened-bob", offline: { store: fileRangeStore(root) },
    fetch: async (input: any, init?: RequestInit) => {
      if (offline) { attempts.push({ input, init }); assert.fail("offline screen attempted transport"); }
      const body = requestBody(init);
      if (body?.op) reads.push(body.op);
      for (const mounted of body?.mounted ?? []) reads.push(mounted.op);
      return globalThis.fetch(input, init);
    } };
  const alice = createClient({ url: screenOwner.url, persona: "never-opened-alice" });
  let bob: any = createClient(options), drain: any, stop: (() => void) | undefined;
  let reactRoot: Root | undefined, restoreDom: (() => void) | undefined;
  try {
    await Promise.all([alice.ready, bob.ready]);
    const created: any = await alice.mutation(api.groups.groupCreate, { title: "Never opened", members: [(await bob.auth.me()).viewer] });
    assert.equal(created.state, "committed");
    const conversationId = created.data.id;
    const first: any = await alice.mutation(api.messages.send, { conversationId, body: "only the log was drained" });
    assert.equal(first.state, "committed");
    drain = subscribe(bob, api.messages.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((value: any) => value.live && value.caughtUp, 10000);
    drain.close(); drain = undefined;
    await bob.outbox.drain(); await bob.offline(); offline = true; bob = await bob.restart();
    assert(!reads.includes("messages.conversationView") && !reads.includes("messages.thread"), "neither screen query was opened online");
    const observed = bob.observe(api.messages.conversationView, { conversationId }, { items: conversationItems });
    stop = observed.subscribe(() => {});
    await waitFor(() => observed.getSnapshot().itemsFrom === "history", "the screen's declared history");
    assert.deepEqual(observed.getSnapshot().items.map((item: any) => item.data?.body), ["only the log was drained"]);
    const queued = await bob.mutation(api.messages.send, { conversationId, body: "predicted into the screen" });
    assert.equal(queued.state, "queued");
    const entry = (await bob.outbox.entries()).find((item: any) => item.intent === queued.intent);
    assert.equal(entry?.predicted, true);
    const id = mutationTarget(api.messages.send, "messages").id(entry);
    await waitFor(() => observed.getSnapshot().items.some((item: any) => item.data?.id === id), "the predicted screen item");
    const snapshot = observed.getSnapshot();
    assert.equal(snapshot.itemsFrom, "history");
    assert.deepEqual(snapshot.items.map((item: any) => item.data?.body), ["only the log was drained", "predicted into the screen"]);
    assert.equal(snapshot.items.filter((item: any) => item.data?.id === id).length, 1);
    assert.equal(snapshot.items.find((item: any) => item.data?.id === id).predicted, true);
    restoreDom = installDom(); reactRoot = createRoot(document.getElementById("root")!);
    await act(async () => { reactRoot!.render(React.createElement(SnapbackProvider, { client: bob },
      React.createElement(Thread, { conversationId }))); });
    await waitFor(() => document.querySelectorAll("section[aria-label=Thread] ol.bubbles > li").length === 2
      && document.querySelector("section[aria-label=Thread] .thread-history-note") !== null, "the mounted cold Thread");
    const bubbles = document.querySelector("section[aria-label=Thread] ol.bubbles")!;
    assert.equal(bubbles.getAttribute("data-view-source"), "partial-history");
    assert.match(text(document.querySelector(".thread-history-note")), /Downloaded history/);
    assert.deepEqual([...bubbles.querySelectorAll("li > p")].map(node => text(node)),
      ["only the log was drained", "predicted into the screen"]);
    assert.deepEqual(attempts, [], "the screen binding and send use held custody without any transport attempt");
  } finally {
    if (reactRoot) await act(async () => { reactRoot!.unmount(); });
    stop?.(); drain?.close(); await Promise.all([alice.close(), bob.close()]); restoreDom?.();
    await rm(root, { recursive: true, force: true });
  }
});

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

test("the chat screens render the log, queue offline sends as pinned bubbles, settle them in place, and use indexed search", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-"));
  const mutationBodies: any[] = [];
  const writer = createClient({ url: screenOwner.url, persona: "alice" });
  let moved = false;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = requestBody(init);
    if (new URL(String(input)).pathname !== "/api/mutation" || !body) return globalThis.fetch(input, init);
    if (!body.op?.startsWith("_delivery.")) mutationBodies.push(body);
    if (body.args?.body === "reject me") return json(rejected(body.replay?.intent));
    if (body.args?.body === "owner expired") {
      return json({
        code: "E_OFFLINE_INTENT_EXPIRED", family: "offline",
        message: "the replay grant is older than thirty days",
        rewrite: "resume for a fresh grant and send again", guide: "offline",
      }, 409);
    }
    if (!moved && body.op === "messages.edit" && body.args?.body === "mine") {
      moved = true;
      const result = await writer.mutation(api.messages.edit, {
        messageId: body.args.messageId, body: "changed at the owner", baseBody: body.args.baseBody,
      });
      assert.equal(result.state, "committed", "the second real client creates the edit conflict");
    }
    return globalThis.fetch(input, init);
  };
  let client: any;
  function Probe() { client = useSnapbackClient(); return null; }
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  const originalNow = Date.now;
  try {
    await act(async () => {
      reactRoot.render(React.createElement(
        SnapbackProvider,
        { url: screenOwner.url, persona: "alice", fetch, offline: { store: fileRangeStore(root), fenceDays: 2 } },
        React.createElement(Probe),
        React.createElement(App),
      ));
    });
    await waitFor(() => /messages available on this device/.test(text(document.querySelector("[role=status][data-connection]")))
      && document.querySelectorAll("nav[aria-label=Inbox] li").length === 2, "the current inbox drain");
    const inboxItems = [...document.querySelectorAll("nav[aria-label=Inbox] li")].map((item) => item.getAttribute("data-conversation"));
    assert.deepEqual(inboxItems, ["conversation-1", "conversation-2"], "the inbox lists every conversation in the held log");

    await act(async () => { document.querySelector<HTMLButtonElement>("nav[aria-label=Inbox] li[data-conversation=conversation-1] button")!.click(); });
    await waitFor(() => document.querySelector("li[data-message=message-1]") !== null, "the thread");
    const welcome = document.querySelector("li[data-message=message-1]")!;
    assert.equal(welcome.getAttribute("data-state"), "row");
    assert.ok(welcome.querySelector("time"), "a server row shows the server time");
    await act(async () => { await client.offline(); });
    const input = document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!;
    await type(input, "queued while offline");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => document.querySelector("li[data-state=queued]") !== null, "the pending fallback bubble");
    const entry = (await client.outbox.entries()).find((entry: any) => entry.op === "messages.send" && entry.state === "queued");
    assert.equal(entry.state, "queued");
    assert.equal(entry.presentation, "messages", "the actual Composer submits its selected semantic target");
    const pinned = mutationTarget(api.messages.send, "messages").id(entry);
    assert.ok(pinned, "the writer certifies the message address at admission");
    const pending = document.querySelector(`li[data-message="${pinned}"]`)!;
    assert.ok(pending, "the pending bubble is keyed by its certified message target");
    assert.equal(pending.getAttribute("data-state"), "queued");
    assert.match(text(pending), /queued while offline/);
    assert.match(text(pending), /Sending…/);
    assert.equal(pending.querySelector("time"), null, "a pending bubble never shows a clock");
    assert.match(text(document.querySelector("form[aria-label=Composer] small")), /1 queued/);
    assert.match(text(document.querySelector("[role=alert]")), /Queued/);

    const retry = [...document.querySelectorAll<HTMLButtonElement>("form[aria-label=Composer] button")].find((button) => text(button) === "Sync now");
    assert.ok(retry, "queued sends expose a recovery action");
    await act(async () => { retry.click(); });
    await waitFor(() => {
      const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
      const bubbles = document.querySelector("section[aria-label=Thread] ol.bubbles");
      return ["complete", "capped"].includes(summary?.getAttribute("data-view-state") ?? "")
        && bubbles?.getAttribute("data-view-source") === "composite"
        && summary?.getAttribute("data-view-seq") === bubbles?.getAttribute("data-view-seq")
        && document.querySelector(`li[data-message="${pinned}"]`)?.getAttribute("data-state") === "row";
    }, "the partial history became the coherent settled conversation view");
    const summary = document.querySelector("section[aria-label=Thread] .thread-summary")!;
    const bubbles = document.querySelector("section[aria-label=Thread] ol.bubbles")!;
    const settledBubble = document.querySelector(`li[data-message="${pinned}"]`)!;
    assert.strictEqual(settledBubble, pending, "the same DOM node crossed prediction and composite settlement");
    assert.ok(settledBubble.querySelector("time"), "the server row carries the server time");
    assert.doesNotMatch(text(settledBubble), /Sending…/);
    assert.ok(["complete", "capped"].includes(summary.getAttribute("data-view-state") ?? ""));
    assert.equal(summary.getAttribute("data-view-state"), bubbles.getAttribute("data-view-state"));
    assert.equal(summary.getAttribute("data-view-seq"), bubbles.getAttribute("data-view-seq"));
    assert.equal(bubbles.getAttribute("data-view-source"), "composite");
    assert.equal(sharedConsumers(client, api.messages.conversationView, { conversationId: "conversation-1" }), 1,
      "one composite observer feeds both the summary and message list");
    assert.equal(summary.hasAttribute("data-count"), true);
    assert.equal(Number.isSafeInteger(Number(summary.getAttribute("data-count"))), true);
    const publicSettlement = await client.outbox.settled();
    assert.deepEqual(publicSettlement, { stopped: false, remaining: 0 },
      "the public settlement joins the completed replay outside React's render flush");
    assert.equal((await client.outbox.entries()).find((entry: any) => entry.ids[0] === pinned)?.state, "committed",
      "observing the server row retires its indicator without dismissing recovery history");

    // A live drain tail is incremental, while its observed value is the whole
    // held log. A post followed by a bodyless removal must not collapse the
    // mounted inbox to only the tail event's conversation.
    const transient = await client.mutation(api.messages.send, {
      conversationId: "conversation-1", body: "removed after a live tail",
    });
    if (transient.state !== "committed") throw new Error(`transient post was ${transient.state}`);
    await waitFor(() => document.querySelector(`li[data-message="${transient.data.id}"]`) !== null,
      "the transient live row");
    const afterTransient = client.observe(api.messages.inbox, { c: null }, { drain: true }).getSnapshot();
    const removedTransient = await client.mutation(api.messages.unsend, { messageId: transient.data.id });
    assert.equal(removedTransient.state, "committed");
    await waitFor(() => document.querySelector(`li[data-message="${transient.data.id}"]`) === null,
      "the transient row removal");
    await waitFor(() => document.querySelectorAll("nav[aria-label=Inbox] li").length === 2,
      `the complete inbox after removal: ${JSON.stringify({ afterTransient,
        afterRemoval: client.observe(api.messages.inbox, { c: null }, { drain: true }).getSnapshot() })}`);

    // Search is the named indexed query, including its case-normalized prefix semantics.
    const search = document.querySelector<HTMLInputElement>("section[aria-label=Search] input")!;
    await type(search, "WEL");
    await waitFor(() => document.querySelectorAll("section[aria-label=Search] .hits li").length > 0
      && ["complete", "capped"].includes(document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state") ?? ""),
    "live indexed search hits");
    assert.ok(["complete", "capped"].includes(document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state") ?? ""));
    assert.match(text(document.querySelector("section[aria-label=Search] .scope")), /Matching messages/);
    assert.deepEqual([...document.querySelectorAll("section[aria-label=Search] .hits li")].map((item) => item.getAttribute("data-message")), ["message-1"]);
    await type(search, "");

    // Rejected: a brief label; the work list keeps structured diagnostics in Details.
    await act(async () => { await client.offline(); });
    await type(input, "reject me");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => document.querySelector("li[data-state=queued]") !== null, "the rejected send's bubble");
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("li[data-state=rejected]") !== null, "the rejection");
    const rejected = document.querySelector("li[data-state=rejected]")!;
    assert.match(text(rejected), /Not sent/);
    assert.doesNotMatch(text(rejected), /fix the rejected mutation input/);
    assert.match(text(document.querySelector("main header details")), /fix the rejected mutation input/);
    await act(async () => { rejected.querySelector<HTMLButtonElement>("button")!.click(); });
    await waitFor(() => document.querySelector("li[data-state=rejected]") === null, "dismiss");

    // Conflict: an offline edit against a row that moved reads "Message changed" on its row.
    await act(async () => { await client.offline(); });
    const editResult = await client.mutation(api.messages.edit, { messageId: pinned, body: "mine", baseBody: "queued while offline" });
    assert.equal(editResult.state, "queued");
    await waitFor(() => document.querySelector(`li[data-message="${pinned}"] small[data-edit=queued]`) !== null, "the pending edit note");
    assert.match(text(document.querySelector(`li[data-message="${pinned}"] small[data-edit]`)), /Edit sending…/);
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector(`li[data-message="${pinned}"] small[data-edit=rejected]`) !== null, "the conflict note");
    assert.match(text(document.querySelector(`li[data-message="${pinned}"] small[data-edit=rejected]`)), /Edit not sent · message changed/);

    // Past the fence: custody continues without prediction, but replay waits
    // for a successful resume and then sends every queued intent in order.
    await act(async () => { await client.offline(); });
    await type(input, "three days old");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => document.querySelector("li[data-state=queued]") !== null, "the late send's bubble");
    Date.now = () => originalNow() + 3 * DAY;
    await type(input, "typed past the fence");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => document.querySelector("small[data-waiting=fence]") !== null, "the composer fence status");
    assert.equal(await client.outbox.ready(), true, "the composer remains ready past the fence");
    assert.equal(document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!.disabled, false);
    assert.match(text(document.querySelector("small[data-waiting=fence]")), /Queued until the next sync/);
    assert.match(text(document.querySelector("ol")), /Will be checked by the server/);
    const mutations = mutationBodies.length;
    await act(async () => { await client.outbox.drain(); });
    assert.equal(mutationBodies.length, mutations,
      "before a successful resume the past-fence drain sends nothing");
    assert.deepEqual((await client.outbox.entries()).filter((item: any) => item.state === "queued")
      .map((item: any) => item.args.body), ["three days old", "typed past the fence"]);
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("small[data-waiting=fence]") === null, "the composer fence reopened after resume");
    assert.deepEqual(mutationBodies.slice(-2).map((item) => item.args.body), ["three days old", "typed past the fence"],
      "after resume the old queue commits FIFO");

    // Expired remains a visible, dismissible state, but only after the owner
    // refuses that intent; the next intent still commits.
    await act(async () => { await client.offline(); });
    const ownerExpired = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "owner expired" });
    const afterExpiry = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "after owner expiry" });
    assert.equal(ownerExpired.state, "queued");
    assert.equal(afterExpiry.state, "queued");
    const serverMutations = mutationBodies.length;
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("li[data-state=expired]") !== null, "the owner-expired bubble");
    assert.equal(mutationBodies.length, serverMutations + 2,
      "the owner judged both intents and the drain continued");
    assert.match(text(document.querySelector("li[data-state=expired]")), /Expired/);
    assert.equal(mutationBodies.at(-1)?.args.body, "after owner expiry");
    await act(async () => { await client.offline(); });
  } finally {
    Date.now = originalNow;
    await act(async () => { reactRoot.unmount(); });
    // The provider defers its close a tick; wait for the carrier to go quiet before
    // the root is removed, or node:test sees activity after the test end.
    await client.close();
    await writer.close();
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("React Thread renders ordinary photos and clips with accessible loading and refusal states", async () => {
  const restore = installDom();
  const alice = createClient({ url: screenOwner.url, persona: "alice" });
  const bob = createClient({ url: screenOwner.url, persona: "bob", fetch: async (input, init) => {
    if (new URL(String(input)).pathname.startsWith("/api/asset/")) {
      return json({ code: "E_ASSET_VIEWED", family: "input", message: "asset viewed", rewrite: "ask for the photo again" }, 410);
    }
    return globalThis.fetch(input, init);
  } });
  const root = createRoot(document.getElementById("root")!);
  const render = (client: any) => React.createElement(SnapbackProvider, { client },
    React.createElement(Thread, { conversationId: "conversation-1" }));
  const fixture = (name: string) => readFile(resolve(packageRoot, "templates/chat/snapback/tests/fixtures", name));
  const figure = (id: string, media: string) => document.querySelector(`li[data-message="${id}"] figure[data-media=${media}]`);
  try {
    await Promise.all([alice.ready, bob.ready]); await alice.auth.me(); await bob.auth.me();
    const photo: any = await alice.mutation(api.messages.sendPhoto, { conversationId: "conversation-1",
      photo: new File([await fixture("photo.jpg")], "photo.jpg", { type: "image/jpeg" }) });
    const clip: any = await alice.mutation(api.messages.sendClip, { conversationId: "conversation-1",
      clip: new File([await fixture("clip.mp4")], "clip.mp4", { type: "video/mp4" }) });
    assert.equal(photo.state, "committed"); assert.equal(clip.state, "committed");
    await act(async () => root.render(render(alice)));
    await waitFor(() => !!figure(photo.data.id, "photo")?.querySelector("img[alt=Photo]")?.getAttribute("src")
      && !!figure(clip.data.id, "clip")?.querySelector("video[aria-label=Video]"), "ordinary photo bytes and the video player");
    assert.doesNotMatch(text(document.querySelector("ol.bubbles")), /\[photo\]|\[clip\]/);
    assert.match(text(figure(photo.data.id, "photo")), /Loading photo…/, "the photo says it is loading until it decodes");
    await act(async () => { figure(photo.data.id, "photo")!.querySelector("img")!.dispatchEvent(new (globalThis.window as any).Event("load")); });
    assert.equal(figure(photo.data.id, "photo")!.getAttribute("data-state"), "ready");
    assert.equal(figure(photo.data.id, "photo")!.querySelector("figcaption"), null);
    assert.ok(figure(clip.data.id, "clip")!.querySelector("video")!.hasAttribute("controls"));
    await act(async () => root.render(render(bob)));
    await waitFor(() => figure(photo.data.id, "photo")?.getAttribute("data-state") === "unavailable", "a refused photo");
    assert.match(text(figure(photo.data.id, "photo")), /Photo unavailable/);
    await act(async () => root.render(render(alice)));
    await waitFor(() => !!figure(photo.data.id, "photo")?.querySelector("img")?.getAttribute("src"), "Alice's photo bytes again");
    assert.equal(figure(photo.data.id, "photo")!.getAttribute("data-state"), "loading", "another account's refusal does not carry back");
    assert.match(text(figure(photo.data.id, "photo")), /Loading photo…/);
  } finally { await act(async () => root.unmount()); await Promise.all([alice.close(), bob.close()]); restore(); }
});

test("React Thread says a photo is not downloaded while offline and fetches it when the connection returns", async () => {
  const restore = installDom();
  const directory = await mkdtemp(join(tmpdir(), "snapback2-photo-offline-"));
  const alice = createClient({ url: screenOwner.url, persona: "alice" });
  const bob = createClient({ url: screenOwner.url, persona: "bob", offline: { store: fileRangeStore(directory) } });
  const root = createRoot(document.getElementById("root")!);
  const figure = (id: string) => document.querySelector(`li[data-message="${id}"] figure[data-media=photo]`);
  let stop: (() => void) | undefined;
  try {
    await Promise.all([alice.ready, bob.ready]); await alice.auth.me(); await bob.auth.me();
    const photo: any = await alice.mutation(api.messages.sendPhoto, { conversationId: "conversation-1",
      photo: new File([await readFile(resolve(packageRoot, "templates/chat/snapback/tests/fixtures/photo.jpg"))], "photo.jpg", { type: "image/jpeg" }) });
    assert.equal(photo.state, "committed");
    const observed = bob.observe(api.messages.conversationView, { conversationId: "conversation-1" }, { items: conversationItems });
    stop = observed.subscribe(() => undefined);
    await waitFor(() => observed.getSnapshot().items.some((item: any) => item.key === photo.data.id), "Bob's held conversation with the photo");
    stop(); stop = undefined;
    await act(async () => { await bob.offline(); });
    await act(async () => root.render(React.createElement(SnapbackProvider, { client: bob },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await waitFor(() => figure(photo.data.id)?.getAttribute("data-state") === "not-downloaded", "the offline byte refusal");
    assert.equal(text(figure(photo.data.id)), "Photo not downloaded", "an offline transport refusal is not reported as unavailable");
    await act(async () => { await bob.online(); });
    await waitFor(() => !!figure(photo.data.id)?.querySelector("img")?.getAttribute("src"), "the photo's bytes after the connection returns");
    assert.equal(figure(photo.data.id)!.getAttribute("data-state"), "loading");
  } finally {
    stop?.(); await act(async () => root.unmount()); await Promise.all([alice.close(), bob.close()]); restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("React Thread says a clip is not downloaded while offline and mints its player URL when the connection returns", async () => {
  const restore = installDom();
  const directory = await mkdtemp(join(tmpdir(), "snapback2-clip-offline-"));
  const alice = createClient({ url: screenOwner.url, persona: "alice" });
  const bob = createClient({ url: screenOwner.url, persona: "bob", offline: { store: fileRangeStore(directory) } });
  const root = createRoot(document.getElementById("root")!);
  const figure = (id: string) => document.querySelector(`li[data-message="${id}"] figure[data-media=clip]`);
  let stop: (() => void) | undefined;
  try {
    await Promise.all([alice.ready, bob.ready]); await alice.auth.me(); await bob.auth.me();
    const clip: any = await alice.mutation(api.messages.sendClip, { conversationId: "conversation-1",
      clip: new File([await readFile(resolve(packageRoot, "templates/chat/snapback/tests/fixtures/clip.mp4"))], "clip.mp4", { type: "video/mp4" }) });
    assert.equal(clip.state, "committed");
    const observed = bob.observe(api.messages.conversationView, { conversationId: "conversation-1" }, { items: conversationItems });
    stop = observed.subscribe(() => undefined);
    await waitFor(() => observed.getSnapshot().items.some((item: any) => item.key === clip.data.id), "Bob's held conversation with the clip");
    stop(); stop = undefined;
    await act(async () => { await bob.offline(); });
    await act(async () => root.render(React.createElement(SnapbackProvider, { client: bob },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await waitFor(() => text(figure(clip.data.id)) === "Video not downloaded", "the offline clip caption");
    assert.equal(figure(clip.data.id)!.querySelector("video")!.getAttribute("src"), null, "offline, no player URL could be minted");
    await act(async () => { await bob.online(); });
    await waitFor(() => !!figure(clip.data.id)?.querySelector("video")?.getAttribute("src"), "the player URL after the connection returns");
    assert.equal(text(figure(clip.data.id)), "", "a clip loading online shows no caption");
  } finally {
    stop?.(); await act(async () => root.unmount()); await Promise.all([alice.close(), bob.close()]); restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("React Thread treats unreachable photo bytes as not downloaded and retries them a bounded number of times", async () => {
  const restore = installDom();
  let byteRequests = 0, assetId: string | undefined;
  const alice = createClient({ url: screenOwner.url, persona: "alice" });
  const bob = createClient({ url: screenOwner.url, persona: "bob", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (!path.startsWith("/api/asset/")) return globalThis.fetch(input, init);
    // Earlier tests leave other photos in this conversation; count only this test's bytes.
    if (assetId !== undefined && path.includes(assetId)) byteRequests++;
    return new Response("resize failed", { status: 503 });
  } });
  const root = createRoot(document.getElementById("root")!);
  const figure = (id: string) => document.querySelector(`li[data-message="${id}"] figure[data-media=photo]`);
  try {
    await Promise.all([alice.ready, bob.ready]); await alice.auth.me(); await bob.auth.me();
    const photo: any = await alice.mutation(api.messages.sendPhoto, { conversationId: "conversation-1",
      photo: new File([await readFile(resolve(packageRoot, "templates/chat/snapback/tests/fixtures/photo.jpg"))], "photo.jpg", { type: "image/jpeg" }) });
    assert.equal(photo.state, "committed");
    assetId = photo.data.photo.id;
    await act(async () => root.render(React.createElement(SnapbackProvider, { client: bob },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await waitFor(() => figure(photo.data.id)?.getAttribute("data-state") === "not-downloaded", "unreachable photo bytes");
    assert.equal(text(figure(photo.data.id)), "Photo not downloaded", "a transport failure is not reported as a server refusal");
    await settle(1_000);
    assert.ok(byteRequests >= 1 && byteRequests <= 4, `this photo's automatic retries stay bounded: ${byteRequests} byte requests`);
  } finally { await act(async () => root.unmount()); await Promise.all([alice.close(), bob.close()]); restore(); }
});
