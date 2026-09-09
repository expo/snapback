import { assertRefused } from "./live-fixture.ts";
import { subscribe } from "../src/internal.js";
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
import { indexedDbRangeStore, SnapbackProvider, useSnapbackClient, useSnapbackSnapshot, useAuth, useQuery } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { DAY, fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

// @ref LLP 1012#7-writes-offline — the chat template's screens: the pending
// bubble is keyed by the first pinned id, shows `args.body` and "Sending…"
// with no time, and becomes the server row on `committed` without remounting.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Composer: (props: { conversationId: string; onNote(note: string): void }) => React.ReactElement;
let Thread: (props: { conversationId: string; onNote(note: string): void }) => React.ReactElement;

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
  ({ App, Composer, Thread } = await import(pathToFileURL(bundlePath).href));
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
  // test. The actual Thread/container is covered in chat-screens-owner.test.ts;
  // keeping this fake narrowly avoids fabricating a composite certificate.
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const op = String(input).includes("/api/query") && init?.body ? JSON.parse(String(init.body)).op : undefined;
    if (op === "messages.inbox") await gate;
    return owner.fetch(input, init);
  };
  let client: any;
  function Probe() { client = useSnapbackClient(); return null; }
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      reactRoot.render(React.createElement(
        SnapbackProvider,
        { url: "http://grant.test", persona: "alice", fetch, offline: { store: fileRangeStore(root) } },
        React.createElement(Probe),
        React.createElement(Composer, { conversationId: "conversation-1", onNote: () => undefined }),
      ));
    });
    const drain = subscribe(client, api.messages.inbox, { c: null }, () => undefined, { drain: true });
    const send = () => document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!;
    await type(document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!, "a draft before downloading");
    assert.equal(send().disabled, true, "send is enabled before a grant exists");
    assert.match(text(document.querySelector("form[aria-label=Composer] small[data-waiting=grant-missing]")), /Connect to enable sending/);
    assert.equal(owner.grantsMinted(), 0, "no grant was minted while the drain waited");
    await assertRefused(client.mutation(api.messages.send, { conversationId: "conversation-1", body: "too early" }), (error: any) =>
      error.code === "E_OFFLINE_ID_BLOCK" && /drain/.test(error.rewrite), "a write before the grant is refused with the rewrite the composer would surface");
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

// @ref LLP 1012#4-the-range-store — confirming the first session epoch adopts it; it is not a
// session change, so a drain page in flight still commits and the drain earns the first grant.
// The auth starter gates its app until identity is known; keep the earlier race
// covered explicitly: a sibling useAuth answers /api/auth/me while the inbox
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
    if (op === "messages.inbox") await identity;
    const response = await owner.fetch(input, init);
    if (String(input).includes("/api/auth/me")) setTimeout(confirmed, 0);
    return response;
  };
  let client: any;
  function Probe() { client = useSnapbackClient(); useAuth(); return null; }
  function Drain() {
    const inbox = useQuery(api.messages.inbox, { c: null }, { drain: true });
    return React.createElement("p", { role: "status", "data-connection": "connected" }, inbox.local.caughtUp ? "log downloaded" : "loading");
  }
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      reactRoot.render(React.createElement(
        SnapbackProvider,
        { url: "http://first-epoch.test", persona: "alice", fetch, offline: { store: fileRangeStore(root) } },
        React.createElement(Probe),
        React.createElement(Drain),
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
