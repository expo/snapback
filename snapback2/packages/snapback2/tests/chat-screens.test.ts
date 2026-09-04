import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../dist/client.mjs";
import { SnapbackProvider, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { DAY, fakeOwner, seededStore } from "./fake-owner.ts";

// @ref LLP 1012#7-writes-offline — the chat template's screens: the pending
// bubble is keyed by the first pinned id, shows `args.body` and "Sending…"
// with no time, and becomes the server row on `committed` without remounting.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(packageRoot, "dist/.chat-screens.test-bundle.mjs");
let App: (props: Record<string, never>) => React.ReactElement;
let Thread: (props: { conversationId: string; viewer: string | undefined; onNote(note: string): void }) => React.ReactElement;

before(async () => {
  const bundled = await build({
    // The app, and the thread screen on its own: the composer lives there, and the
    // grant test needs it on screen while the inbox drain is still held at its first page.
    stdin: {
      contents: 'export { App } from "./App";\nexport { Thread } from "./chat/Thread";\n',
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
  ({ App, Thread } = await import(pathToFileURL(bundlePath).href));
});

after(async () => { await rm(bundlePath, { force: true }); });

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

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 4_000): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await settle(20);
  }
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

test("the chat screens render the log, queue offline sends as pinned bubbles, settle them in place, and search the held log", async () => {
  const restore = installDom();
  const root = await mkdtemp(join(tmpdir(), "snapback2-screens-"));
  let dead = false;
  const owner = fakeOwner({
    seed: true,
    dead: () => dead,
    reject: (_intent, body) => body.args?.body === "reject me",
    conflict: (_intent, body) => body.op === "deliveries.edit",
    refuse: (_intent, body) => body.args?.body === "owner expired"
      ? { status: 409, envelope: {
        code: "E_OFFLINE_INTENT_EXPIRED", family: "offline",
        message: "the replay grant is older than thirty days",
        rewrite: "resume for a fresh grant and send again", guide: "offline",
      } }
      : undefined,
  });
  await seededStore(fileRangeStore(root));
  let client: any;
  function Probe() { client = useSnapbackClient(); return null; }
  const reactRoot: Root = createRoot(document.getElementById("root")!);
  const originalNow = Date.now;
  try {
    await act(async () => {
      reactRoot.render(React.createElement(
        SnapbackProvider,
        { url: "http://screens.test", as: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root), fenceDays: 2 } },
        React.createElement(Probe),
        React.createElement(App),
      ));
    });
    await waitFor(() => /log downloaded/.test(text(document.querySelector("[role=status][data-connection]"))), "the inbox drain");
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
    await waitFor(() => document.querySelector("li[data-state=queued]") !== null, "the pending bubble");
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

    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector(`li[data-message="${pinned}"]`)?.getAttribute("data-state") === "row"
      && document.querySelector("li[data-state=committed]") === null, "the settled bubble");
    const settledBubble = document.querySelector(`li[data-message="${pinned}"]`)!;
    assert.strictEqual(settledBubble, pending, "the same DOM node became the server row");
    assert.equal(settledBubble.getAttribute("data-state"), "row");
    assert.ok(settledBubble.querySelector("time"), "the server row carries the server time");
    assert.doesNotMatch(text(settledBubble), /Sending…/);
    assert.deepEqual((await client.outbox.entries()).map((item: any) => item.state), [], "a committed post whose row arrived was dismissed");

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
    const pastFence = await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "typed past the fence" });
    assert.equal(pastFence.state, "queued", "a write typed past the fence remains in durable custody");
    const mutations = owner.requests.filter((path) => path === "/api/mutation").length;
    await act(async () => { await client.outbox.drain(); });
    assert.equal(owner.requests.filter((path) => path === "/api/mutation").length, mutations,
      "before a successful resume the past-fence drain sends nothing");
    assert.deepEqual((await client.outbox.entries()).filter((item: any) => item.state === "queued")
      .map((item: any) => item.args.body), ["three days old", "typed past the fence"]);
    await act(async () => { await client.online(); await client.outbox.settled(); });
    assert.deepEqual(owner.executions.slice(-2).map((item) => (item.args as any).body), ["three days old", "typed past the fence"],
      "after resume the old queue commits FIFO");

    // Expired remains a visible, dismissible state, but only after the owner
    // refuses that intent; the next intent still commits.
    await act(async () => { await client.offline(); });
    const ownerExpired = await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "owner expired" });
    const afterExpiry = await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "after owner expiry" });
    assert.equal(ownerExpired.state, "queued");
    assert.equal(afterExpiry.state, "queued");
    const serverMutations = owner.requests.filter((path) => path === "/api/mutation").length;
    await act(async () => { await client.online(); await client.outbox.settled(); });
    await waitFor(() => document.querySelector("li[data-state=expired]") !== null, "the owner-expired bubble");
    assert.equal(owner.requests.filter((path) => path === "/api/mutation").length, serverMutations + 2,
      "the owner judged both intents and the drain continued");
    assert.match(text(document.querySelector("li[data-state=expired]")), /Expired/);
    assert.equal(owner.executions.at(-1)?.args && (owner.executions.at(-1)!.args as any).body, "after owner expiry");

    // Offline search is a filter over the downloaded log, labeled as such.
    dead = true;
    await act(async () => { await client.offline(); });
    await type(document.querySelector<HTMLInputElement>("section[aria-label=Search] input")!, "welcome");
    await waitFor(() => document.querySelectorAll("section[aria-label=Search] .hits li").length > 0, "search hits");
    assert.equal(text(document.querySelector("section[aria-label=Search] .scope")), "in downloaded messages");
    assert.deepEqual([...document.querySelectorAll("section[aria-label=Search] .hits li")].map((item) => item.getAttribute("data-message")), ["message-1"]);
    await type(document.querySelector<HTMLInputElement>("section[aria-label=Search] input")!, "nowhere");
    await settle(20);
    assert.equal(document.querySelectorAll("section[aria-label=Search] .hits li").length, 0);
  } finally {
    Date.now = originalNow;
    await act(async () => { reactRoot.unmount(); });
    restore();
    await rm(root, { recursive: true, force: true });
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
  // The inbox drain's first page waits at the owner until released; the thread's own page does not.
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
        React.createElement(Thread, { conversationId: "conversation-1", viewer: "dev:alice", onNote: () => undefined }),
      ));
    });
    // The drain the app mounts, held at its first page.
    const drain = client.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
    await waitFor(() => document.querySelector("li[data-message=message-1]") !== null, "the thread");
    const send = () => document.querySelector<HTMLButtonElement>("form[aria-label=Composer] button[type=submit]")!;
    assert.equal(send().disabled, true, "send is enabled before a grant exists");
    assert.match(text(document.querySelector("form[aria-label=Composer] small[data-waiting=grant]")), /log has downloaded/);
    assert.equal(owner.grantsMinted(), 0, "no grant was minted while the drain waited");
    await assert.rejects(client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "too early" }), (error: any) =>
      error.code === "E_OFFLINE_ID_BLOCK" && /drain/.test(error.envelope.rewrite), "a write before the grant is refused with the rewrite the composer would surface");
    release();
    await waitFor(() => !send().disabled, "the grant");
    assert.equal(owner.grantsMinted(), 1, "the drain reaching its watermark minted the first grant");
    assert.equal(document.querySelector("form[aria-label=Composer] small[data-waiting=grant]"), null, "the reason left with the grant");
    drain.close();
  } finally {
    await act(async () => { reactRoot.unmount(); });
    restore();
    await rm(root, { recursive: true, force: true });
  }
});
