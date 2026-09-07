import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { indexedDbRangeStore, SnapbackProvider, useSnapbackClient, useSnapbackSnapshot } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { DAY, fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { RealOwnerHarness } from "./owner-harness.ts";

// @ref LLP 1012#7-writes-offline — the chat template's screens: the pending
// bubble is keyed by the first pinned id, shows `args.body` and "Sending…"
// with no time, and becomes the server row on `committed` without remounting.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens-owner.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Composer: (props: { conversationId: string; onNote(note: string): void; custody?: any }) => React.ReactElement;
let Thread: (props: { conversationId: string; viewer: string | undefined; onNote(note: string): void; changeCustody?: any }) => React.ReactElement;
let useAccountRecoveryCustody: <Unknown>(client: any, generation: number) => any;
let usableConversationView: (result: any) => any;
let authorizedHistoryRows: (result: any) => unknown[];
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
        'export { useAccountRecoveryCustody } from "../shared/recovery";',
        'export { usableConversationView, authorizedHistoryRows } from "../shared/offline.js";',
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
  ({ App, Composer, Thread, useAccountRecoveryCustody, usableConversationView, authorizedHistoryRows }
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

test("the chat screens render the log, queue offline sends as pinned bubbles, settle them in place, and use indexed search", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-"));
  const mutationBodies: any[] = [];
  const writer = createClient({ url: screenOwner.url, as: "alice" });
  let moved = false;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = requestBody(init);
    if (new URL(String(input)).pathname !== "/api/mutation" || !body) return globalThis.fetch(input, init);
    mutationBodies.push(body);
    if (body.args?.body === "reject me") return json(rejected(body.replay?.intent));
    if (body.args?.body === "owner expired") {
      return json({
        code: "E_OFFLINE_INTENT_EXPIRED", family: "offline",
        message: "the replay grant is older than thirty days",
        rewrite: "resume for a fresh grant and send again", guide: "offline",
      }, 409);
    }
    if (!moved && body.op === "deliveries.edit" && body.args?.body === "mine") {
      moved = true;
      const result = await writer.mutation(api.deliveries.edit, {
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
        { url: screenOwner.url, as: "alice", fetch, offline: { store: fileRangeStore(root), fenceDays: 2 } },
        React.createElement(Probe),
        React.createElement(App),
      ));
    });
    await waitFor(() => /log downloaded/.test(text(document.querySelector("[role=status][data-connection]")))
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
    const [entry] = await client.outbox.entries();
    assert.equal(entry.state, "queued");
    const pinned = entry.ids[0];
    const pending = document.querySelector(`li[data-message="${pinned}"]`)!;
    assert.ok(pending, "the pending bubble is keyed by the first pinned id");
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
    assert.equal(client.sharedConsumers(api.deliveries.conversationView, { conversationId: "conversation-1" }), 2);
    assert.equal(summary.hasAttribute("data-count"), true);
    assert.equal(Number.isSafeInteger(Number(summary.getAttribute("data-count"))), true);
    await act(async () => { await client.outbox.settled(); });
    await waitFor(async () => (await client.outbox.entries()).length === 0, "the settled outbox dismissal");

    // A live drain tail is incremental, while its observed value is the whole
    // held log. A post followed by a bodyless removal must not collapse the
    // mounted inbox to only the tail event's conversation.
    const transient = await client.mutation(api.deliveries.post, {
      conversationId: "conversation-1", body: "removed after a live tail",
    });
    if (transient.state !== "committed") throw new Error(`transient post was ${transient.state}`);
    await waitFor(() => document.querySelector(`li[data-message="${transient.data.id}"]`) !== null,
      "the transient live row");
    const afterTransient = client.observe(api.deliveries.inbox, { c: null }, { drain: true }).getSnapshot();
    const removedTransient = await client.mutation(api.deliveries.unsend, { messageId: transient.data.id });
    assert.equal(removedTransient.state, "committed");
    await waitFor(() => document.querySelector(`li[data-message="${transient.data.id}"]`) === null,
      "the transient row removal");
    await waitFor(() => document.querySelectorAll("nav[aria-label=Inbox] li").length === 2,
      `the complete inbox after removal: ${JSON.stringify({ afterTransient,
        afterRemoval: client.observe(api.deliveries.inbox, { c: null }, { drain: true }).getSnapshot() })}`);

    // Search is the named indexed query, including its case-normalized prefix semantics.
    const search = document.querySelector<HTMLInputElement>("section[aria-label=Search] input")!;
    await type(search, "WEL");
    await waitFor(() => document.querySelectorAll("section[aria-label=Search] .hits li").length > 0
      && ["complete", "capped"].includes(document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state") ?? ""),
    "live indexed search hits");
    assert.ok(["complete", "capped"].includes(document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state") ?? ""));
    assert.match(text(document.querySelector("section[aria-label=Search] .scope")), /Live indexed results|Indexed result limit reached/);
    assert.deepEqual([...document.querySelectorAll("section[aria-label=Search] .hits li")].map((item) => item.getAttribute("data-message")), ["message-1"]);
    await type(search, "");

    // Rejected: "Not sent" with the refusal rewrite, then dismissed by the user.
    await act(async () => { await client.offline(); });
    await type(input, "reject me");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => document.querySelector("li[data-state=queued]") !== null, "the rejected send's bubble");
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("li[data-state=rejected]") !== null, "the rejection");
    const rejected = document.querySelector("li[data-state=rejected]")!;
    assert.match(text(rejected), /Not sent · fix the rejected mutation input and retry/);
    await act(async () => { rejected.querySelector<HTMLButtonElement>("button")!.click(); });
    await waitFor(() => document.querySelector("li[data-state=rejected]") === null, "dismiss");

    // Conflict: an offline edit against a row that moved reads "Message changed" on its row.
    await act(async () => { await client.offline(); });
    const editResult = await client.mutation(api.deliveries.edit, { messageId: pinned, body: "mine", baseBody: "queued while offline" });
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
    const ownerExpired = await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "owner expired" });
    const afterExpiry = await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "after owner expiry" });
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

test("partial history becomes one coherent view without remounting its pending bubble", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-partial-"));
  const store = fileRangeStore(root);
  const warm = createClient({ url: screenOwner.url, as: "alice", offline: { store } });
  const writer = createClient({ url: screenOwner.url, as: "alice" });
  let client: any;
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  try {
    await warm.ready;
    const drain = warm.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
    await drain.until((event: any) => event.live === true && event.caughtUp === true, 5_000);
    drain.close();
    await warm.close();
    const group: any = await writer.mutation(api.groups.groupCreate, { title: "Partial transition", members: ["dev:bob"] });
    assert.equal(group.state, "committed");
    const conversationId = group.data.id;
    client = createClient({ url: screenOwner.url, as: "alice", startOffline: true, offline: { store } });
    await client.ready;
    await act(async () => reactRoot.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId, viewer: "dev:alice", onNote: () => undefined }))));
    await waitFor(() => document.querySelector("ol.bubbles")?.getAttribute("data-view-source") === "partial-history",
      "the independently covered history fallback");
    assert.match(text(document.querySelector(".thread-history-note")), /Count and preview unavailable/);
    assert.match(text(document.querySelector(".thread-summary")), /Message count unavailable/);
    assert.equal(document.querySelector(".thread-summary")?.hasAttribute("data-count"), false,
      "the partial composite cannot publish its count while history supplies rows");
    const result = await client.mutation(api.deliveries.post, { conversationId, body: "kept through transition" });
    assert.equal(result.state, "queued");
    await waitFor(() => document.querySelector(`li[data-message="${result.ids[0]}"][data-state=queued]`) !== null,
      "the fallback pending bubble");
    const pending = document.querySelector(`li[data-message="${result.ids[0]}"]`)!;
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("ol.bubbles")?.getAttribute("data-view-source") === "composite"
      && document.querySelector(`li[data-message="${result.ids[0]}"][data-state=row]`) !== null,
    "the usable composite after resume");
    assert.strictEqual(document.querySelector(`li[data-message="${result.ids[0]}"]`), pending,
      "the BubbleList ancestor and keyed row survive partial history to composite publication");
    assert.equal(document.querySelector(".thread-history-note"), null, "the fallback unmounts once the composite is usable");
    assert.equal(client.sharedConsumers(api.deliveries.conversationView, { conversationId }), 2);
  } finally {
    await act(async () => reactRoot.unmount());
    await warm.close(); await client?.close(); await writer.close(); restore();
    await rm(root, { recursive: true, force: true });
  }
});

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — the
// actual Composer treats a lost follower acknowledgment as an unresolved
// request and recovers its opaque identity instead of submitting fresh args.
test("a follower Composer keeps a lost-ack draft across route remounts and recovers the same admitted send", async (t) => {
  const restore = installDom();
  const OriginalBroadcastChannel = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  MemoryBroadcastChannel.drop = () => false;
  const database = new FakeIndexedDb(), locks = new FakeLocks();
  const store = () => indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const serverPosts: any[] = [];
  const serverChanges: any[] = [];
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const body = requestBody(init);
    if (new URL(String(input)).pathname === "/api/mutation" && body?.op === "deliveries.post") serverPosts.push(body);
    if (new URL(String(input)).pathname === "/api/mutation" && ["deliveries.edit", "deliveries.unsend"].includes(body?.op)) serverChanges.push(body);
    return globalThis.fetch(input, init);
  };
  const writer = createClient({ url: screenOwner.url, as: "alice", fetch: transport, offline: { store: store() } });
  let follower: ReturnType<typeof createClient> | undefined;
  let drain: any;
  const notes: string[] = [];
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  const waitForForwardedUi = async (predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 4_000) => {
    const started = performance.now();
    while (!(await predicate())) {
      if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await act(async () => undefined);
    }
  };
  const typeForwarded = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value")!.set!;
    const view = globalThis.window as any;
    flushSync(() => {
      input.focus();
      input.dispatchEvent(new view.FocusEvent("focusin", { bubbles: true }));
      setter.call(input, value);
      input.dispatchEvent(new view.KeyboardEvent("keyup", { bubbles: true, key: "End" }));
    });
  };
  function SendHarness({ conversationId, visible }: { conversationId: string; visible: boolean }) {
    const client = useSnapbackClient();
    const generation = useSnapbackSnapshot().authGeneration;
    const custody = useAccountRecoveryCustody(client, generation);
    return visible
      ? React.createElement(Composer, { conversationId, custody, onNote: (note: string) => notes.push(note) })
      : React.createElement("p", null, "Inbox route");
  }
  function ChangeHarness({ conversationId }: { conversationId: string }) {
    const client = useSnapbackClient();
    const generation = useSnapbackSnapshot().authGeneration;
    const changeCustody = useAccountRecoveryCustody(client, generation);
    return React.createElement(Thread, {
      conversationId, viewer: "dev:alice", changeCustody, onNote: (note: string) => notes.push(note),
    });
  }
  try {
    await writer.ready;
    drain = writer.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
    await drain.until((event: any) => event.caughtUp === true, 4_000);
    await waitForForwardedUi(async () => (await writer.outbox.status()).ready, "the writer replay grant");
    follower = createClient({ url: screenOwner.url, as: "alice", fetch: transport, offline: { store: store() } });
    await follower.ready;
    await waitForForwardedUi(async () => (await follower!.outbox.status(api.deliveries.post)).ready,
      "the follower writer admission");
    const render = (conversationId: string, visible = true) => React.createElement(SnapbackProvider, { client: follower! },
      React.createElement(SendHarness, { conversationId, visible }));
    flushSync(() => reactRoot.render(render("conversation-1")));
    await waitForForwardedUi(() => document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")?.disabled === false,
      "the mounted follower Composer to discover its writer route");
    let input = document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!;
    MemoryBroadcastChannel.drop = message => message.type === "mutation-answer";
    typeForwarded(input, "one uncertain UI send");
    flushSync(() => document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit());
    await waitForForwardedUi(() => [...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), "the same-send recovery action");
    assert.equal(input.value, "one uncertain UI send", "an unknown admission does not clear the draft");
    assert.match(notes.at(-1) ?? "", /confirmation was lost/);
    assert.equal(serverPosts.filter(post => post.args?.body === "one uncertain UI send").length, 1,
      "the writer admitted and sent the command exactly once before its answer was lost");
    const initial = MemoryBroadcastChannel.messages.find(message => message.type === "mutation"
      && message.args?.body === "one uncertain UI send");
    assert.ok(initial, "the first forwarded request is observable");
    flushSync(() => reactRoot.render(render("conversation-1", false)));
    assert.equal(document.querySelector("form[aria-label=Composer]"), null, "Inbox unmounts the Composer");
    flushSync(() => reactRoot.render(render("conversation-2")));
    await waitForForwardedUi(() => document.querySelector("[data-send-unknown=conversation-1]") !== null, "the recovery notice on B");
    assert.match(text(document.querySelector("[data-send-unknown]")), /conversation-1.*Return there/);
    assert.equal(document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!.disabled, true,
      "conversation B cannot send while A is unresolved");
    assert.equal([...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), false, "only A offers recovery");
    flushSync(() => reactRoot.render(render("conversation-1")));
    await waitForForwardedUi(() => [...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), "the recovery after A-B-A navigation");
    input = document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!;
    await waitForForwardedUi(() => input.value === "one uncertain UI send", "the remounted exact draft");
    MemoryBroadcastChannel.drop = () => false;
    flushSync(() => [...document.querySelectorAll<HTMLButtonElement>("form[aria-label=Composer] button")]
      .find((button) => text(button) === "Check send")!.click());
    await waitForForwardedUi(() => input.value === "" && ![...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), "the recovered admission");
    const recovery = MemoryBroadcastChannel.messages.filter(message => message.type === "mutation"
      && message.args?.body === "one uncertain UI send").at(-1);
    assert.equal(recovery.requestId, initial.requestId, "the UI recovered the original request identity");
    assert.equal(serverPosts.filter(post => post.args?.body === "one uncertain UI send").length, 1,
      "recovery read the durable receipt instead of admitting a duplicate");

    // A result from the old conversation may arrive after the same component
    // has become the successor conversation; it must not install recovery UI
    // or overwrite that successor's note.
    MemoryBroadcastChannel.drop = message => message.type === "mutation-answer";
    typeForwarded(input, "old conversation uncertainty");
    flushSync(() => document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit());
    await waitForForwardedUi(() => MemoryBroadcastChannel.messages.some(message => message.type === "mutation"
      && message.args?.body === "old conversation uncertainty"), "the predecessor send");
    const noteCount = notes.length;
    flushSync(() => reactRoot.render(render("conversation-2")));
    await waitForForwardedUi(() => document.querySelector("[data-send-unknown=conversation-1]") !== null,
      "the late predecessor recovery held while B is visible");
    assert.equal(notes.length, noteCount, "the predecessor result cannot update the successor conversation");
    assert.equal([...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), false);
    flushSync(() => reactRoot.render(render("conversation-1")));
    await waitForForwardedUi(() => [...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), "the predecessor recovery on A");
    MemoryBroadcastChannel.drop = () => false;
    flushSync(() => [...document.querySelectorAll<HTMLButtonElement>("form[aria-label=Composer] button")]
      .find((button) => text(button) === "Check send")!.click());
    await waitForForwardedUi(() => ![...document.querySelectorAll("form[aria-label=Composer] button")]
      .some((button) => text(button) === "Check send"), "the predecessor recovery settled");
    const lateRequests = MemoryBroadcastChannel.messages.filter(message => message.type === "mutation"
      && message.args?.body === "old conversation uncertainty");
    assert.equal(new Set(lateRequests.map(message => message.requestId)).size, 1,
      "late navigation recovery preserves the request identity");
    assert.equal(serverPosts.filter(post => post.args?.body === "old conversation uncertainty").length, 1);

    // The first edit owns the account's change slot synchronously. An unsend
    // clicked in the same turn cannot replace that command's recovery identity.
    const renderChange = (conversationId: string) => React.createElement(SnapbackProvider, { client: follower! },
      React.createElement(ChangeHarness, { conversationId }));
    flushSync(() => reactRoot.render(renderChange("conversation-1")));
    await waitForForwardedUi(() => document.querySelector("li[data-message=message-1] .actions") !== null,
      "the editable real message");
    (globalThis.window as any).prompt = () => "one uncertain edit";
    const actionButtons = [...document.querySelectorAll<HTMLButtonElement>("li[data-message=message-1] .actions button")];
    MemoryBroadcastChannel.drop = message => message.type === "mutation-answer";
    flushSync(() => {
      actionButtons.find((button) => text(button) === "Edit")!.click();
      actionButtons.find((button) => text(button) === "Unsend")!.click();
    });
    await waitForForwardedUi(() => [...document.querySelectorAll("button")].some((button) => text(button) === "Check edit"),
      "the edit recovery action");
    const editRequests = MemoryBroadcastChannel.messages.filter(message => message.type === "mutation"
      && message.op === "deliveries.edit" && message.args?.body === "one uncertain edit");
    assert.equal(editRequests.length, 1);
    assert.equal(MemoryBroadcastChannel.messages.filter(message => message.type === "mutation"
      && message.op === "deliveries.unsend").length, 0,
    "the overlapping unsend cannot overwrite the edit recovery");
    assert.equal(serverChanges.filter(request => request.op === "deliveries.edit"
      && request.args?.body === "one uncertain edit").length, 1);

    flushSync(() => reactRoot.render(renderChange("conversation-2")));
    await waitForForwardedUi(() => document.querySelector("[data-mutation-unknown=edit]") !== null,
      "the edit recovery while B is visible");
    assert.match(text(document.querySelector("[data-mutation-unknown=edit]")), /conversation-1.*Return there/);
    assert.equal([...document.querySelectorAll("button")].some((button) => text(button) === "Check edit"), false);
    flushSync(() => reactRoot.render(renderChange("conversation-1")));
    await waitForForwardedUi(() => [...document.querySelectorAll("button")].some((button) => text(button) === "Check edit"),
      "the edit recovery after A-B-A");
    MemoryBroadcastChannel.drop = () => false;
    flushSync(() => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => text(button) === "Check edit")!.click());
    await waitForForwardedUi(() => document.querySelector("[data-mutation-unknown]") === null, "the edit recovery settled");
    const recoveredEdits = MemoryBroadcastChannel.messages.filter(message => message.type === "mutation"
      && message.op === "deliveries.edit" && message.args?.body === "one uncertain edit");
    assert.equal(new Set(recoveredEdits.map(message => message.requestId)).size, 1,
      "edit recovery preserves the original request identity");
    assert.equal(serverChanges.filter(request => request.op === "deliveries.edit"
      && request.args?.body === "one uncertain edit").length, 1);
  } catch (error) {
    t.diagnostic(`primary recovery failure before cleanup: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  } finally {
    MemoryBroadcastChannel.drop = () => false;
    flushSync(() => reactRoot.unmount());
    drain?.close(); await follower?.close(); await writer.close();
    MemoryBroadcastChannel.members.clear(); (globalThis as any).BroadcastChannel = OriginalBroadcastChannel;
    restore();
  }
});

test("a refused send keeps the draft and shows the recovery advice", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-draft-"));
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = requestBody(init);
    if (new URL(String(input)).pathname === "/api/mutation" && body?.args?.body === "keep this draft") {
      return json(rejected(body.replay?.intent));
    }
    return globalThis.fetch(input, init);
  };
  let client: any;
  function Probe() { client = useSnapbackClient(); return null; }
  const reactRoot = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      reactRoot.render(React.createElement(SnapbackProvider,
        { url: screenOwner.url, as: "alice", fetch, offline: { store: fileRangeStore(root) } },
        React.createElement(Probe), React.createElement(App)));
    });
    await waitFor(() => document.querySelector("nav[aria-label=Inbox] li[data-conversation=conversation-1] button") !== null, "the inbox");
    await act(async () => { document.querySelector<HTMLButtonElement>("nav[aria-label=Inbox] li[data-conversation=conversation-1] button")!.click(); });
    const input = document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!;
    await type(input, "keep this draft");
    await waitFor(() => !document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!.disabled, "sending readiness");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => /fix the rejected mutation input/.test(text(document.querySelector("[role=alert]"))), "the refusal advice");
    assert.equal(input.value, "keep this draft", "the server refusal must not discard unsent text");
  } finally {
    await act(async () => { reactRoot.unmount(); });
    await client?.close();
    restore();
    await rm(root, { recursive: true, force: true });
  }
});
