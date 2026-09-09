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
import { indexedDbRangeStore, SnapbackProvider, useSnapbackClient, useSnapbackSnapshot } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { DAY, fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { RealOwnerHarness } from "./owner-harness.ts";

// @ref LLP 1018.004#5-hooks-and-templates — a follower tab's pending bubble is
// keyed by its inbox alias until the writer assigns ids (one accepted rekey),
// shows `args.body` and "Sending…" with no time, and becomes the server row.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens-recovery.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Composer: (props: { conversationId: string; onNote(note: string): void }) => React.ReactElement;
let Thread: (props: { conversationId: string; viewer: string | undefined; onNote(note: string): void }) => React.ReactElement;
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
  ({ App, Composer, Thread } = await import(pathToFileURL(bundlePath).href));
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


/** jsdom's `Event` replaces Node's while the DOM is installed, which breaks Node's BroadcastChannel dispatch; the test's tabs share this one instead. */
class MemoryBroadcastChannel {
  static members = new Map<string, Set<MemoryBroadcastChannel>>();
  onmessage?: (event: { data: unknown }) => void;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    const members = MemoryBroadcastChannel.members.get(name) ?? new Set();
    members.add(this); MemoryBroadcastChannel.members.set(name, members);
  }
  postMessage(message: unknown) {
    const copy = structuredClone(message);
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

// @ref LLP 1018.004#2-the-inbox — a follower tab's send is a durable inbox row
// before `run()` resolves: the draft clears on custody, the bubble renders from
// the row across a reload, and the writer's admission turns it into the row's
// entry and then the server row, exactly once.
test("a follower Composer's send is durable before it resolves, survives a reload as a queued bubble, and is admitted exactly once", async (t) => {
  const restore = installDom();
  const OriginalBroadcastChannel = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear();
  const database = new FakeIndexedDb(), locks = new FakeLocks();
  const store = () => indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const serverPosts: any[] = [];
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const body = requestBody(init);
    if (new URL(String(input)).pathname === "/api/mutation" && body?.op === "messages.send") serverPosts.push(body);
    return globalThis.fetch(input, init);
  };
  // The writer holds no grant until its drain runs, so rows it cannot admit yet stay durable and visible.
  const writer = createClient({ url: screenOwner.url, persona: "alice", fetch: transport, offline: { store: store() } });
  let follower: ReturnType<typeof createClient> | undefined;
  let reloaded: ReturnType<typeof createClient> | undefined;
  let drain: any;
  const notes: string[] = [];
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  const waitForUi = async (predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 6_000) => {
    const started = performance.now();
    while (!(await predicate())) {
      if (performance.now() - started > timeoutMs) {
        const status = document.querySelector("form[aria-label=Composer] small[data-waiting]");
        throw new Error(`timed out waiting for ${label}; notes=${JSON.stringify(notes)} waiting=${status?.getAttribute("data-waiting")} `
          + `text=${JSON.stringify(status?.textContent)} input=${JSON.stringify(document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")?.value)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      await act(async () => undefined);
    }
  };
  const typeInto = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value")!.set!;
    const view = globalThis.window as any;
    flushSync(() => {
      input.focus();
      input.dispatchEvent(new view.FocusEvent("focusin", { bubbles: true }));
      setter.call(input, value);
      input.dispatchEvent(new view.KeyboardEvent("keyup", { bubbles: true, key: "End" }));
    });
  };
  const render = (client: any, conversationId: string) => React.createElement(SnapbackProvider, { client },
    React.createElement(Thread, { conversationId, viewer: "dev:alice", onNote: (note: string) => notes.push(note) }));
  try {
    await writer.ready;
    follower = createClient({ url: screenOwner.url, persona: "alice", fetch: transport, offline: { store: store() } });
    await follower.ready;
    await waitForUi(async () => (await follower!.outbox.status()).reason === "forwarding", "the follower's inbox route");
    flushSync(() => reactRoot.render(render(follower, "conversation-1")));
    await waitForUi(() => document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")?.disabled === false,
      "the follower Composer enabled by its durable route");
    const input = document.querySelector<HTMLInputElement>("form[aria-label=Composer] input")!;
    typeInto(input, "one durable send");
    flushSync(() => document.querySelector<HTMLFormElement>("form[aria-label=Composer]")!.requestSubmit());
    await waitForUi(() => input.value === "", "the draft clearing on durable custody");
    assert.equal(serverPosts.length, 0, "the grantless writer has sent nothing");
    await waitForUi(() => document.querySelector("li[data-state=queued]") !== null, "the queued bubble from the row");
    const bubble = document.querySelector("li[data-state=queued]")!;
    assert.match(text(bubble), /one durable send/);
    assert.match(text(bubble), /Sending…/);
    assert.equal(document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!.disabled, false,
      "a queued row does not block the next send");
    const rows = await follower.outbox.entries();
    assert.deepEqual(rows.map((entry) => [entry.state, entry.ids.length, entry.inbox]), [["queued", 0, 1]]);

    // Reload: a new tab on the same device shows the row before any admission.
    flushSync(() => reactRoot.unmount());
    await follower.close();
    reloaded = createClient({ url: screenOwner.url, persona: "alice", fetch: transport, offline: { store: store() } });
    await reloaded.ready;
    const reloadRoot: Root = createRoot(document.getElementById("root")!);
    flushSync(() => reloadRoot.render(render(reloaded, "conversation-1")));
    await waitForUi(() => document.querySelector("li[data-state=queued]") !== null, "the reloaded tab's queued bubble from durable state");
    assert.match(text(document.querySelector("li[data-state=queued]")), /one durable send/);

    // The writer earns its grant; the row is admitted, replayed once, and becomes the server row under the same body.
    drain = subscribe(writer, api.messages.inbox, { c: null }, () => undefined, { drain: true });
    await drain.until((event: any) => event.caughtUp === true, 4_000);
    await waitForUi(() => serverPosts.filter((post) => post.args?.body === "one durable send").length === 1, "the writer's single replay");
    await waitForUi(() => document.querySelector("li[data-state=queued]") === null
      && [...document.querySelectorAll("li[data-message]")].some((node) => /one durable send/.test(text(node)) && node.getAttribute("data-state") === "row"),
    "the bubble becoming the server row");
    assert.equal(serverPosts.filter((post) => post.args?.body === "one durable send").length, 1, "admitted and executed exactly once");
    const entries = await reloaded.outbox.entries();
    assert.equal(entries.filter((entry) => entry.inbox === 1).length, 1, "the admitted row appears once, as its ledger entry");
    assert.equal(entries.find((entry) => entry.inbox === 1)!.state, "committed");
    flushSync(() => reloadRoot.unmount());
  } catch (error) {
    t.diagnostic(`inbox screen failure before cleanup: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  } finally {
    drain?.close(); await reloaded?.close(); await follower?.close().catch(() => undefined); await writer.close();
    MemoryBroadcastChannel.members.clear(); (globalThis as any).BroadcastChannel = OriginalBroadcastChannel;
    restore();
  }
});
