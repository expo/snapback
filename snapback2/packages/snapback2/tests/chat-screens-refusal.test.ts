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
const bundlePath = resolve(packageRoot, "dist/.chat-screens-refusal.test-bundle.mjs");
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
  state: "rejected", code: "MEMBERSHIP_REQUIRED", family: "rule", rule: "MEMBERSHIP_REQUIRED",
  site: "snapback/messages.q:7:3", message: "Membership required",
  rewrite: "Join this conversation before sending", guide: "live-query", intent,
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
        { url: screenOwner.url, persona: "alice", fetch, offline: { store: fileRangeStore(root) } },
        React.createElement(Probe), React.createElement(App)));
    });
    await waitFor(() => document.querySelector("nav[aria-label=Inbox] li[data-conversation=conversation-1] button") !== null, "the inbox");
    await act(async () => { document.querySelector<HTMLButtonElement>("nav[aria-label=Inbox] li[data-conversation=conversation-1] button")!.click(); });
    const input = document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!;
    await type(input, "keep this draft");
    await waitFor(() => !document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!.disabled, "sending readiness");
    await act(async () => { document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit(); });
    await waitFor(() => /Join this conversation/.test(text(document.querySelector("[role=alert]"))), "the refusal advice");
    assert.equal(input.value, "keep this draft", "the server refusal must not discard unsent text");
  } finally {
    await act(async () => { reactRoot.unmount(); });
    await client?.close();
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

for (const transport of [false, true]) test(`Composer renders ${transport ? "transport" : "rule"} refusals inline and clears them on account change`, async () => {
  const restore = installDom();
  const client = createClient({ url: screenOwner.url, fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation") {
      if (transport) throw new TypeError("connection lost");
      return json(rejected());
    }
    return globalThis.fetch(input, init);
  } });
  const root = createRoot(document.getElementById("root")!);
  try {
    await client.ready; await client.auth.guest();
    await act(async () => root.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Composer, { conversationId: "conversation-1" }))));
    const input = document.querySelector<HTMLInputElement>("form input")!;
    await type(input, "keep my text");
    await act(async () => document.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await waitFor(() => text(document.querySelector("form [role=alert]")).startsWith("Not sent:"), "the inline refusal");
    assert.match(text(document.querySelector("form [role=alert]")), transport ? /connection|connect|retry/i : /Join this conversation/);
    assert.equal(input.value, "keep my text");
    await act(async () => { await client.auth.logout(); });
    assert.equal(document.querySelector("form [role=alert]"), null, "the previous account's result is gone");
    assert.equal(document.querySelector<HTMLInputElement>("form input")!.value, "", "the previous account's draft is gone");
  } finally { await act(async () => root.unmount()); await client.close(); restore(); }
});

test("Thread renders edit and unsend refusals locally and drops them when the conversation changes", async () => {
  const restore = installDom();
  const client = createClient({ url: screenOwner.url, persona: "alice", fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation") return json(rejected());
    return globalThis.fetch(input, init);
  } });
  const root = createRoot(document.getElementById("root")!);
  const render = (conversationId: string) => React.createElement(SnapbackProvider, { client },
    React.createElement(Thread, { conversationId }));
  try {
    await client.ready; await client.auth.me();
    await act(async () => root.render(render("conversation-1")));
    await waitFor(() => document.querySelector("li[data-message=message-1] .actions") !== null, "owner actions");
    window.prompt = () => "edited text";
    const actions = () => document.querySelectorAll<HTMLButtonElement>("li[data-message=message-1] .actions button");
    await act(async () => actions()[0]!.click());
    await waitFor(() => /Edit not sent: Join/.test(text(document.querySelector("section header"))), "edit refusal");
    await act(async () => actions()[1]!.click());
    await waitFor(() => /Unsend refused: Join/.test(text(document.querySelector("section header"))), "unsend refusal");
    await act(async () => root.render(render("conversation-2")));
    assert.equal(document.querySelector("[role=alert]"), null);
  } finally { await act(async () => root.unmount()); await client.close(); restore(); }
});

for (const state of ["committed", "rejected"]) test(`a late ${state} send cannot change another conversation's draft or result`, async () => {
  const restore = installDom();
  let release!: () => void, started!: () => void, consumed!: (value: any) => void, finished!: (value: any) => void;
  const bodyConsumed = new Promise<any>(done => { consumed = done; });
  const mutationFinished = new Promise<any>(done => { finished = done; });
  const gate = new Promise<void>(done => { release = done; });
  const entered = new Promise<void>(done => { started = done; });
  const client = createClient({ url: screenOwner.url, persona: "alice", fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation") {
      started(); await gate;
      const response = state === "rejected" ? json(rejected()) : await globalThis.fetch(input, init);
      const read = response.json.bind(response);
      response.json = async () => { const value = await read(); consumed(value); return value; };
      return response;
    }
    return globalThis.fetch(input, init);
  } });
  const mutate = client.mutation.bind(client);
  client.mutation = (...args) => { const result = mutate(...args); void result.then(finished); return result; };
  const root = createRoot(document.getElementById("root")!);
  const render = (conversationId: string) => React.createElement(SnapbackProvider, { client }, React.createElement(Composer, { conversationId }));
  try {
    await client.ready; await client.auth.me();
    await act(async () => root.render(render("conversation-1")));
    await type(document.querySelector<HTMLInputElement>("form input")!, "same draft");
    await act(async () => { document.querySelector<HTMLFormElement>("form")!.requestSubmit(); await entered; });
    await act(async () => root.render(render("conversation-2")));
    assert.equal(document.querySelector<HTMLInputElement>("form input")!.value, "", "drafts belong to a conversation");
    await type(document.querySelector<HTMLInputElement>("form input")!, "same draft");
    await act(async () => {
      release();
      assert.equal((await bodyConsumed).state, state, "the old response body was consumed");
      assert.equal((await mutationFinished).state, state);
      await new Promise<void>(done => setImmediate(done)); // Flush the hook and send continuation.
    });
    assert.equal(document.querySelector<HTMLInputElement>("form input")!.value, "same draft");
    assert.equal(document.querySelector("form [role=alert]"), null);
    assert.equal(document.querySelector<HTMLButtonElement>("form button[type=submit]")!.disabled, false);
  } finally { release(); await act(async () => root.unmount()); await client.close(); restore(); }
});
