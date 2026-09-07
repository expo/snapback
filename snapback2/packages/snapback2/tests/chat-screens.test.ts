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

// @ref LLP 1012#7-writes-offline — the chat template's screens: the pending
// bubble is keyed by the first pinned id, shows `args.body` and "Sending…"
// with no time, and becomes the server row on `committed` without remounting.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Composer: (props: { conversationId: string; onNote(note: string): void; custody?: any }) => React.ReactElement;
let Thread: (props: { conversationId: string; viewer: string | undefined; onNote(note: string): void; changeCustody?: any }) => React.ReactElement;
let useAccountRecoveryCustody: <Unknown>(client: any, generation: number) => any;
let usableConversationView: (result: any) => any;
let authorizedHistoryRows: (result: any) => unknown[];

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
});

after(async () => { await rm(bundlePath, { force: true }); });

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

test("the composite selector admits only complete outcomes and never bypasses denial with history", () => {
  const composite = { messages: [{ message: { id: "m" } }], count: 1, preview: [] };
  assert.strictEqual(usableConversationView({ state: "complete", data: composite }), composite);
  assert.strictEqual(usableConversationView({ state: "capped", data: composite }), composite);
  for (const state of ["partial", "denied", "refused", "hydrating", "stale"]) {
    assert.equal(usableConversationView({ state, data: composite }), undefined,
      `${state} cannot supply messages, count, or preview`);
  }
  const history = [{ message: { id: "independent" } }];
  for (const state of ["complete", "capped", "held", "partial", "stale"]) {
    assert.strictEqual(authorizedHistoryRows({ state, data: history }), history,
      `${state} history remains an independently authorized row result`);
  }
  for (const state of ["denied", "refused", "hydrating"]) {
    assert.deepEqual(authorizedHistoryRows({ state, data: history }), [],
      `${state} cannot expose fallback rows even when stale data is attached`);
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

// @ref LLP 1012#7-writes-offline — a device with a store writes only under a
// replay grant, which the inbox drain earns when it first reaches its watermark:
// the composer is disabled with the reason until then, never retried blindly.
test("the composer is disabled until the inbox drain catches up and the first grant exists, then enabled", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-grant-"));
  const owner = fakeOwner({ seed: true });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  // This is a transport-order test for Composer rather than a query rendering
  // test. The actual Thread/container is covered against screenOwner above;
  // keeping this fake narrowly avoids fabricating a composite certificate.
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const op = String(input).includes("/api/query") && init?.body ? JSON.parse(String(init.body)).op : undefined;
    if (op === "deliveries.inbox") await gate;
    return owner.fetch(input, init);
  };
  let client: any;
  function Probe() { client = useSnapbackClient(); return null; }
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      reactRoot.render(React.createElement(
        SnapbackProvider,
        { url: "http://grant.test", as: "alice", fetch, offline: { store: fileRangeStore(root) } },
        React.createElement(Probe),
        React.createElement(Composer, { conversationId: "conversation-1", onNote: () => undefined }),
      ));
    });
    const drain = client.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
    const send = () => document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!;
    await type(document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!, "a draft before downloading");
    assert.equal(send().disabled, true, "send is enabled before a grant exists");
    assert.match(text(document.querySelector("form[aria-label=Composer] small[data-waiting=grant-missing]")), /Connect to enable sending/);
    assert.equal(owner.grantsMinted(), 0, "no grant was minted while the drain waited");
    await assert.rejects(client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "too early" }), (error: any) =>
      error.code === "E_OFFLINE_ID_BLOCK" && /drain/.test(error.envelope.rewrite), "a write before the grant is refused with the rewrite the composer would surface");
    release();
    await waitFor(() => !send().disabled, "the grant");
    assert.equal(owner.grantsMinted(), 1, "the drain reaching its watermark minted the first grant");
    assert.equal(document.querySelector("form[aria-label=Composer] small[data-waiting=grant-missing]"), null, "the reason left with the grant");
    drain.close();
  } finally {
    await act(async () => { reactRoot.unmount(); });
    await client?.close();
    restore();
    await rm(root, { recursive: true, force: true });
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

// @ref LLP 1012#4-the-range-store — confirming the first session epoch adopts it; it is not a
// session change, so a drain page in flight still commits and the drain earns the first grant.
// The browser witness caught this: the template's useAuth answers /api/auth/me while the inbox
// drain's first page is still at the owner, and the composer stayed "grant-missing" forever.
test("the first identity confirmation during the inbox drain does not cost the drain its grant", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-first-epoch-"));
  const owner = fakeOwner({ seed: true, meEpoch: 7 });
  let confirmed!: () => void;
  const identity = new Promise<void>((resolve) => { confirmed = resolve; });
  // The inbox drain's first page waits at the owner until /api/auth/me has answered.
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const op = String(input).includes("/api/query") && init?.body ? JSON.parse(String(init.body)).op : undefined;
    if (op === "deliveries.inbox") await identity;
    const response = await owner.fetch(input, init);
    if (String(input).includes("/api/auth/me")) setTimeout(confirmed, 0);
    return response;
  };
  let client: any;
  function Probe() { client = useSnapbackClient(); return null; }
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      reactRoot.render(React.createElement(
        SnapbackProvider,
        { url: "http://first-epoch.test", as: "alice", fetch, offline: { store: fileRangeStore(root) } },
        React.createElement(Probe),
        React.createElement(App),
      ));
    });
    await waitFor(() => /log downloaded/.test(text(document.querySelector("[role=status][data-connection]"))), "the inbox drain");
    await waitFor(() => owner.grantsMinted() === 1, "the drain's resume minting the first grant");
    assert.equal((await client.outbox.status()).reason, "ready", "the outbox holds the grant the drain earned");
    assert.equal(client.snapshot.auth.authEpoch, 7, "the confirmed epoch is the session epoch");
  } finally {
    await act(async () => { reactRoot.unmount(); });
    await client?.close().catch(() => undefined);
    restore();
    await rm(root, { recursive: true, force: true });
  }
});
