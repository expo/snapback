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

test("Thread keeps a refused edit in its editor and drops unsend refusals with the conversation", async () => {
  const restore = installDom();
  let edits = 0;
  const client = createClient({ url: screenOwner.url, persona: "alice", fetch: async (input, init) => {
    if (new URL(String(input)).pathname !== "/api/mutation") return globalThis.fetch(input, init);
    if (requestBody(init)?.op === "messages.edit") edits++;
    return json(rejected());
  } });
  const root = createRoot(document.getElementById("root")!);
  const render = (conversationId: string) => React.createElement(SnapbackProvider, { client },
    React.createElement(Thread, { conversationId }));
  const bubble = "li[data-message=message-1]";
  const form = () => document.querySelector<HTMLFormElement>(`${bubble} form[aria-label="Edit message"]`);
  try {
    await client.ready; await client.auth.me();
    await act(async () => root.render(render("conversation-1")));
    await waitFor(() => document.querySelector(`${bubble} .actions`) !== null, "owner actions");
    const actions = () => document.querySelectorAll<HTMLButtonElement>(`${bubble} .actions button`);
    await act(async () => actions()[0]!.click());
    assert.equal(form()!.querySelector("input")!.value, text(document.querySelector(`${bubble} > p`)), "the editor starts from the rendered message");
    await type(form()!.querySelector("input")!, "edited text");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => /Could not confirm edit\. Your edit is still here/.test(text(form()?.querySelector("[role=alert]"))), "edit refusal");
    assert.equal(form()!.querySelector("input")!.value, "edited text", "the refused attempt stays editable");
    const editDetails = form()!.querySelector("details")!;
    assert.equal(editDetails.open, false, "structured advice is hidden by default");
    await act(async () => editDetails.querySelector("summary")!.click());
    assert.match(text(editDetails), /MEMBERSHIP_REQUIRED/);
    assert.match(text(editDetails), /Join this conversation before sending/);
    await act(async () => { [...form()!.querySelectorAll("button")].find(button => text(button) === "Cancel")!.click(); });
    assert.equal(form(), null, "Cancel closes the editor");
    await act(async () => actions()[1]!.click());
    await waitFor(() => /Could not confirm removal\. Open details/.test(text(document.querySelector("section header"))), "unsend refusal");
    const removeDetails = document.querySelector("section header details")!;
    await act(async () => removeDetails.querySelector("summary")!.click());
    assert.match(text(removeDetails), /MEMBERSHIP_REQUIRED/);
    await act(async () => root.render(render("conversation-2")));
    assert.equal(document.querySelector("[role=alert]"), null);
    assert.equal(edits, 1, "a terminal refusal is never reissued, even after later actions");
  } finally { await act(async () => root.unmount()); await client.close(); restore(); }
});

test("Thread editor closes for committed and queued edits, and newer text saves over an accepted older attempt", async () => {
  const restore = installDom();
  const directory = await mkdtemp(join(tmpdir(), "snapback2-edit-lifecycle-"));
  let release: (() => void) | undefined, entered: (() => void) | undefined, lateDone: ((value: any) => void) | undefined;
  const client = createClient({ url: screenOwner.url, persona: "alice", offline: { store: fileRangeStore(directory) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/mutation" && requestBody(init)?.args?.body === "late edit") {
        await new Promise<void>(done => { release = done; entered?.(); });
      }
      return globalThis.fetch(input, init);
    } });
  const mutate = client.mutation.bind(client);
  client.mutation = ((ref: any, args: any) => {
    const result = mutate(ref, args);
    if (args?.body === "late edit") void result.then(value => lateDone?.(value));
    return result;
  }) as typeof client.mutation;
  const root = createRoot(document.getElementById("root")!);
  try {
    await client.ready; await client.auth.me();
    const sent: any = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "edit lifecycle" });
    assert.equal(sent.state, "committed");
    const bubble = `li[data-message="${sent.data.id}"]`;
    const form = () => document.querySelector<HTMLFormElement>(`${bubble} form[aria-label="Edit message"]`);
    const input = () => form()?.querySelector<HTMLInputElement>("input") ?? null;
    const body = () => text(document.querySelector(`${bubble} > p`));
    const openEditor = async () => {
      await waitFor(() => document.querySelector(`${bubble} .actions button`) !== null, "the Edit action");
      await act(async () => document.querySelector<HTMLButtonElement>(`${bubble} .actions button`)!.click());
      assert.equal(input()!.value, body(), "the editor starts from the rendered message");
    };
    await act(async () => root.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await openEditor();
    await type(input()!, "committed edit");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => form() === null && body() === "committed edit", "a committed edit closes its editor");

    await openEditor();
    await type(input()!, "late edit");
    const late = new Promise<any>(done => { lateDone = done; });
    await act(async () => { await new Promise<void>(done => { entered = done; form()!.requestSubmit(); }); });
    await type(input()!, "newer text");
    await act(async () => {
      release!();
      assert.equal((await late).state, "committed");
      await new Promise<void>(done => setImmediate(done));
    });
    assert.equal(input()?.value, "newer text", "the older result neither closes nor erases newer text");
    assert.equal(form()!.querySelector("[role=alert]"), null, "an accepted older attempt is not reported as a conflict");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => form() === null && body() === "newer text", "newer text saves on top of the accepted attempt");

    await waitFor(async () => await client.outbox.ready(), "offline write readiness");
    await act(async () => { await client.offline(); });
    await openEditor();
    await type(input()!, "queued edit");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => form() === null && document.querySelector(`${bubble} small[data-edit=queued]`) !== null, "a queued edit closes its editor");
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => body() === "queued edit", "the queued edit settles");
  } finally {
    release?.(); await act(async () => root.unmount()); await client.close(); restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Thread editor ignores an older refusal for newer text and keeps one editor open at a time", async () => {
  const restore = installDom();
  let release: (() => void) | undefined, entered: (() => void) | undefined, refusedDone: ((value: any) => void) | undefined;
  const client = createClient({ url: screenOwner.url, persona: "alice", fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation" && requestBody(init)?.args?.body === "late refusal") {
      await new Promise<void>(done => { release = done; entered?.(); });
      return json(rejected());
    }
    return globalThis.fetch(input, init);
  } });
  const mutate = client.mutation.bind(client);
  client.mutation = ((ref: any, args: any) => {
    const result = mutate(ref, args);
    if (args?.body === "late refusal") void result.then(value => refusedDone?.(value));
    return result;
  }) as typeof client.mutation;
  const root = createRoot(document.getElementById("root")!);
  try {
    await client.ready; await client.auth.me();
    const first: any = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "one editor" });
    const second: any = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "another message" });
    assert.equal(first.state, "committed"); assert.equal(second.state, "committed");
    const bubble = `li[data-message="${first.data.id}"]`, other = `li[data-message="${second.data.id}"] .actions button`;
    const form = () => document.querySelector<HTMLFormElement>(`${bubble} form[aria-label="Edit message"]`);
    const input = () => form()?.querySelector<HTMLInputElement>("input") ?? null;
    await act(async () => root.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await waitFor(() => document.querySelector(`${bubble} .actions button`) !== null && document.querySelector(other) !== null, "both Edit actions");
    await act(async () => document.querySelector<HTMLButtonElement>(`${bubble} .actions button`)!.click());
    assert.equal(document.querySelector<HTMLButtonElement>(other)!.disabled, true, "another editor cannot silently replace the open one");
    await type(input()!, "late refusal");
    const refused = new Promise<any>(done => { refusedDone = done; });
    await act(async () => { await new Promise<void>(done => { entered = done; form()!.requestSubmit(); }); });
    await type(input()!, "after refusal");
    await act(async () => {
      release!();
      assert.equal((await refused).state, "rejected");
      await new Promise<void>(done => setImmediate(done));
    });
    assert.equal(input()?.value, "after refusal");
    assert.equal(form()!.querySelector("[role=alert]"), null, "an older refusal does not describe newer text");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => form() === null && text(document.querySelector(`${bubble} > p`)) === "after refusal", "newer text saves after the older refusal");
    assert.equal(document.querySelector<HTMLButtonElement>(other)!.disabled, false, "closing the editor re-enables other edits");
  } finally { release?.(); await act(async () => root.unmount()); await client.close(); restore(); }
});

test("Thread releases the open editor when its message is removed elsewhere", async () => {
  const restore = installDom();
  const client = createClient({ url: screenOwner.url, persona: "alice" });
  const writer = createClient({ url: screenOwner.url, persona: "alice" });
  const root = createRoot(document.getElementById("root")!);
  const editAction = (id: string) => document.querySelector<HTMLButtonElement>(`li[data-message="${id}"] .actions button`);
  try {
    await Promise.all([client.ready, writer.ready]); await client.auth.me();
    const doomed: any = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: "removed while editing" });
    const other: any = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: "still here" });
    assert.equal(doomed.state, "committed"); assert.equal(other.state, "committed");
    await act(async () => root.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await waitFor(() => editAction(doomed.data.id) !== null && editAction(other.data.id) !== null, "both Edit actions");
    await act(async () => editAction(doomed.data.id)!.click());
    assert.equal(editAction(other.data.id)!.disabled, true, "one editor at a time");
    assert.equal((await writer.mutation(api.messages.unsend, { messageId: doomed.data.id })).state, "committed");
    await waitFor(() => document.querySelector(`li[data-message="${doomed.data.id}"]`) === null
      && editAction(other.data.id)?.disabled === false, "the removed message releases the editor");
  } finally { await act(async () => root.unmount()); await Promise.all([client.close(), writer.close()]); restore(); }
});

test("Thread editor keeps its draft when the connection drops and returns", async () => {
  const restore = installDom();
  const directory = await mkdtemp(join(tmpdir(), "snapback2-edit-drop-"));
  const client = createClient({ url: screenOwner.url, persona: "alice", offline: { store: fileRangeStore(directory) } });
  const root = createRoot(document.getElementById("root")!);
  try {
    await client.ready; await client.auth.me();
    const sent: any = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "draft across a drop" });
    assert.equal(sent.state, "committed");
    const form = () => document.querySelector<HTMLFormElement>('form[aria-label="Edit message"]');
    const editAction = () => document.querySelector<HTMLButtonElement>(`li[data-message="${sent.data.id}"] .actions button`);
    await act(async () => root.render(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId: "conversation-1" }))));
    await waitFor(() => editAction() !== null, "the Edit action");
    await act(async () => editAction()!.click());
    await type(form()!.querySelector("input")!, "typed before the drop");
    await waitFor(async () => await client.outbox.ready(), "offline write readiness");
    await act(async () => { await client.offline(); });
    await settle(300);
    assert.equal(form()?.querySelector("input")?.value, "typed before the drop", "going offline keeps the open editor and its draft");
    await act(async () => { await client.online(); });
    await settle(300);
    assert.equal(form()?.querySelector("input")?.value, "typed before the drop", "reconnecting keeps the open editor and its draft");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => form() === null && text(document.querySelector(`li[data-message="${sent.data.id}"] > p`)) === "typed before the drop",
      "the draft saves after reconnecting");
  } finally {
    await act(async () => root.unmount()); await client.close(); restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Thread editor rebases on a conflict, saves the attempt deliberately, and forgets drafts across accounts", async () => {
  const restore = installDom();
  const alice = createClient({ url: screenOwner.url, persona: "alice" });
  const bob = createClient({ url: screenOwner.url, persona: "bob" });
  const writer = createClient({ url: screenOwner.url, persona: "alice" });
  const root = createRoot(document.getElementById("root")!);
  const render = (client: any) => React.createElement(SnapbackProvider, { client },
    React.createElement(Thread, { conversationId: "conversation-1" }));
  try {
    await Promise.all([alice.ready, bob.ready, writer.ready]); await alice.auth.me(); await bob.auth.me();
    const sent: any = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: "before conflict" });
    assert.equal(sent.state, "committed");
    const bubble = `li[data-message="${sent.data.id}"]`;
    const form = () => document.querySelector<HTMLFormElement>(`${bubble} form[aria-label="Edit message"]`);
    const input = () => form()?.querySelector<HTMLInputElement>("input") ?? null;
    const body = () => text(document.querySelector(`${bubble} > p`));
    const openEditor = async () => {
      await waitFor(() => document.querySelector(`${bubble} .actions button`) !== null, "the Edit action");
      await act(async () => document.querySelector<HTMLButtonElement>(`${bubble} .actions button`)!.click());
    };
    await act(async () => root.render(render(alice)));
    await openEditor();
    await type(input()!, "my attempt");
    const moved: any = await writer.mutation(api.messages.edit, { messageId: sent.data.id, body: "changed elsewhere", baseBody: "before conflict" });
    assert.equal(moved.state, "committed");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => /Edit not sent\. Current message: changed elsewhere\. Save again to replace it\./.test(text(form()?.querySelector("[role=alert]"))), "the conflict note");
    assert.equal(input()!.value, "my attempt", "the attempt survives the conflict");
    await act(async () => { form()!.requestSubmit(); });
    await waitFor(() => form() === null && body() === "my attempt", "saving again deliberately replaces the current message");

    await openEditor();
    await type(input()!, "private draft");
    await act(async () => root.render(render(bob)));
    await waitFor(() => body() === "my attempt" && form() === null, "Bob's view of the message");
    await act(async () => root.render(render(alice)));
    await waitFor(() => document.querySelector(`${bubble} .actions button`) !== null, "Alice's actions, not her earlier editor");
    assert.equal(form(), null, "returning to the account does not reopen the earlier editor");
    assert.doesNotMatch(text(document.querySelector("section[aria-label=Thread]")), /private draft/);
  } finally { await act(async () => root.unmount()); await Promise.all([alice.close(), bob.close(), writer.close()]); restore(); }
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
