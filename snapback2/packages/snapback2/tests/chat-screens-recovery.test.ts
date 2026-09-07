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
const bundlePath = resolve(packageRoot, "dist/.chat-screens-recovery.test-bundle.mjs");
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
