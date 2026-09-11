import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { subscribe } from "../src/internal.js";
import { fixtureClient as createClient } from "./live-fixture.ts";
// Lane O4-web, fix round 1: view-once custody (LLP 1012 §9). The session allowance
// obeys the partition fence; a clip is viewed at play, never at mount; every byte
// path consults the viewed guard; live frames and coverage hide viewed rows; view-once
// is per row; blob: URLs follow the client identity and the partition.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api, browserTokenStore } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { AssetImage, AssetVideo, SnapbackProvider, useAssetUrl, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { OfflineRuntime } from "../dist/sqlite-test.mjs";
import { domEnvironment, settle, until } from "./dom-environment.ts";

const A = "s2id-00000000000000000000000000000007-0000000000000001";
const B = "s2id-00000000000000000000000000000007-0000000000000002";
const V = "s2id-00000000000000000000000000000007-0000000000000003";
const W = "s2id-00000000000000000000000000000007-0000000000000004";
const generation = "d".repeat(64);
const schemaHash = "e".repeat(64);
const planHash = "f".repeat(64);
const VALIDATOR = "1".repeat(64);

const photo = (id: string, width = 8) => ({ id, width, height: 8 });
const clip = (id: string) => ({ id, width: 2, height: 2, duration: 2_000 });
const ref = (table: string, id: string) => ({ $row: { table, id } });
const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
const bytesOf = (length: number, fill: number) => new Uint8Array(length).fill(fill);
const bytes = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
const messageRow = (id: string, media: Record<string, unknown>) => ({
  table: "messages",
  id,
  row: { id, conversationId: "c1", at: Number(id.slice(1)), ...media, ...(id === "m2" && media.photo ? { oncePhoto: media.photo, photo: null } : {}) },
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const THREAD_ARGS = { conversationId: "c1", c: null };

test("web assetBlob and byte fetch read the transport cut after readiness resolves", async () => {
  for (const method of ["assetBlob", "assetBytes"] as const) {
    let release!: (token: string) => void;
    const token = new Promise<string>((done) => { release = done; });
    let requests = 0;
    const client = createClient({ url: "http://assets.test", tokenStore: { load: () => token, save() {} },
      fetch: async () => { requests++; return new Response(new Uint8Array([1])); } });
    const pending = client[method](`http://assets.test/api/asset/${B}`);
    const refused = assert.rejects(pending, (error: unknown) => isRefusalError(error));
    const cut = client.offline(); release("restored");
    try { await cut; await refused; assert.equal(requests, 0); }
    finally { await client.close(); }
  }
});

test("web viewed allowance belongs to its viewing instance, never a second consumer or URL hook", async () => {
  const root = await tempRoot(); const owner = bearerServer();
  const client = createClient({ url: "http://assets.test", token: "token-a", offlinePrincipal: "principal-a",
    fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  const viewing = {};
  try {
    await client.ready;
    await client.query(api.messages.thread, THREAD_ARGS);
    const url = (await client.assetUrl(photo(B)))!;
    const shown = await client.assetBlob(url, { viewing });
    assert.deepEqual(await bytes(shown), [5, 5, 5, 5]);
    await assert.rejects(client.assetBlob(url), (error: unknown) => isRefusalError(error) && error.code === "E_ASSET_VIEWED"
      && error.envelope.rewrite === "render this image once; request a new image for another delivery");
    await assert.rejects(client.assetBytes(url, { viewing: {} }), (error: unknown) => isRefusalError(error) && error.code === "E_ASSET_VIEWED");
    assert.equal(await client.assetCache!.get(B, null), undefined);
    assert.equal(await client.assetUrl(photo(B)), undefined);
    assert.deepEqual(await bytes(await client.assetBlob(url, { viewing })), [5, 5, 5, 5]);
    assert.equal(owner.state.assetFetches, 1);
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("a row viewed during URL minting cannot shift another asset's URL onto its list entry", async () => {
  const directory = await tempRoot(); const owner = bearerServer(); const env = domEnvironment();
  const client = createClient({ url: "http://assets.test", token: "token-a", offlinePrincipal: "principal-a",
    fetch: owner.fetch, offline: { store: fileRangeStore(directory) } });
  const root = createRoot(env.dom.window.document.getElementById("root")!);
  let urls: Array<string | undefined> | undefined;
  function Probe() { urls = useAssetUrl([photo(B), photo(A)]); return null; }
  try {
    await client.ready;
    await client.query(api.messages.thread, THREAD_ARGS);
    const mint = client.assetUrl.bind(client);
    client.assetUrl = (async (assets, options) => {
      await client.assetCache!.markViewed(B);
      return mint(assets, options);
    }) as typeof client.assetUrl;
    await act(async () => root.render(React.createElement(SnapbackProvider, { client }, React.createElement(Probe))));
    assert.ok(await until(() => urls !== undefined));
    assert.equal(urls![0], undefined);
    assert.equal(urls![1], `http://assets.test/api/asset/${A}`);
  } finally { await act(async () => root.unmount()); await client.close(); env.restore(); await rm(directory, { recursive: true, force: true }); }
});

function envelope(data: unknown, rows: unknown[], principal = "dev:alice", seq = 3, validator = VALIDATOR) {
  return {
    protocol: 1, generation, schemaHash, planHash,
    authority: { principal, authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows, receipt: emptyReceipt(), validator,
  };
}

function metadataResponse(url: URL): Response | undefined {
  if (url.pathname === "/api/manifest") {
    return json({
      generation: "schema-generation", programGeneration: generation, ops: {}, channels: {}, auth: {},
      tables: { messages: { retain: "until-revoked", columns: { oncePhoto: { Optional: { Image: { max: 5000000, once: true } } } } } },
    });
  }
  if (url.pathname === "/api/program") {
    return json({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }, 404);
  }
  return undefined;
}

function sse(value: unknown): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-view-once-"));
}

async function inspect(root: string, partition = "dev:alice"): Promise<{ assets: string[]; viewed: string[] }> {
  const store: any = fileRangeStore(root)();
  await store.open(partition);
  const status = await store.bytes();
  await store.close?.();
  return {
    assets: status.entries.map((entry: any) => entry.assetId).sort(),
    viewed: status.viewed.map((row: any) => row.id).sort(),
  };
}

/** A bearer-token server for two principals whose threads both carry the view-once photo B on m2. */
function bearerServer(options: { rows?: (principal: string) => unknown[] } = {}) {
  const state = { assetFetches: 0, fill: 5, expired: false, carrierCalls: 0, offline: false };
  const principals: Record<string, string> = { "token-a": "principal-a", "token-b": "principal-b" };
  const rows = options.rows ?? (() => [messageRow("m1", { photo: photo(A) }), messageRow("m2", { photo: photo(B) })]);
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const metadata = metadataResponse(url);
    if (metadata) return metadata;
    const token = new Headers(init?.headers).get("Authorization")?.slice("Bearer ".length) ?? "";
    if (url.pathname === "/api/auth/login") {
      const who = String(JSON.parse(String(init?.body)).email).startsWith("a@") ? "a" : "b";
      return json({ token: `token-${who}`, viewer: `principal-${who}`, kind: "user" });
    }
    if (url.pathname === "/api/auth/logout") return json({ ok: true });
    if (url.pathname === "/api/auth/me") return json({ viewer: principals[token], kind: "user" });
    if (url.pathname === "/api/query") {
      if (state.expired) return json({ code: "E_AUTH_SESSION", family: "auth", message: "session expired", guide: "auth/session" }, 401);
      const principal = principals[token]!;
      const held = rows(principal);
      return json(envelope(held.map((row: any) => ref(row.table, row.id)), held, principal));
    }
    if (state.offline) throw new Error(`network used offline: ${url.pathname}`);
    if (url.pathname === "/api/auth/asset-session") {
      state.carrierCalls += 1;
      return json({ token: "carrier", expiresAt: Date.now() + 120_000 });
    }
    if (url.pathname.startsWith("/api/asset/")) {
      state.assetFetches += 1;
      return new Response(bytesOf(4, state.fill), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  return { state, fetch };
}

function memoryTokenStore() {
  const values = new Map<string, string>();
  return browserTokenStore({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  }, "auth");
}

test("the view-once session allowance obeys custody: a partition switch, a wipe, and a seal all drop it", async () => {
  const viewing = {};
  const root = await tempRoot();
  try {
    const { state, fetch } = bearerServer();
    const client = createClient({
      url: "http://custody.test", tokenStore: memoryTokenStore(),
      offline: { store: fileRangeStore(root) }, fetch,
    });
    await client.auth.login({ email: "a@example.com", password: "pw" });
    await client.query(api.messages.thread, THREAD_ARGS);
    const urlB = (await client.assetUrl(photo(B) as any, { width: 8 }))!;
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing })), [5, 5, 5, 5], "the first view renders");
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing })), [5, 5, 5, 5], "the viewing instance keeps rendering what it showed");
    assert.equal(state.assetFetches, 1);
    assert.equal(await client.assetCache!.viewed(B), true, "viewed is the truth while the session serves");
    assert.deepEqual((await client.assetCache!.status()).entries, [], "view-once bytes are never cached");

    // A partition switch: another principal signs in on the same client.
    state.fill = 6;
    await client.auth.login({ email: "b@example.com", password: "pw" });
    assert.equal(await client.assetCache!.get(B, 8), undefined, "a partition switch drops the session blob");
    await client.query(api.messages.thread, THREAD_ARGS);
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing })), [6, 6, 6, 6], "the other principal's view is its own fetch, never the first principal's blob");
    assert.equal(state.assetFetches, 2);

    // A wipe: sign out, then the first principal returns to a fresh partition.
    await client.auth.logout();
    assert.equal(await client.assetCache!.get(B, 8), undefined, "a wipe drops the session blob");
    state.fill = 7;
    await client.auth.login({ email: "a@example.com", password: "pw" });
    assert.equal(await client.assetCache!.get(B, 8), undefined, "the returning principal's partition holds nothing");
    await client.query(api.messages.thread, THREAD_ARGS);
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing })), [7, 7, 7, 7], "the blob is gone: the view fetches again");
    assert.equal(state.assetFetches, 3);
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing })), [7, 7, 7, 7], "and this instance's new session serves it");

    // A seal: a terminal session refusal seals the partition; the session is not served past it.
    state.expired = true;
    await assertRefused(client.query(api.messages.thread, THREAD_ARGS), (error: unknown) =>
      (error.state === "rejected" || error.state === "refused") && error.code === "E_AUTH_SESSION");
    assert.equal(client.snapshot.token, undefined, "the session expired");
    assert.equal(await client.assetCache!.get(B, 8), undefined, "a sealed partition serves no session blob");
    state.expired = false;
    state.fill = 8;
    const afterSeal = await client.assetBlob(urlB, { viewing }).then(bytes).catch(() => "refused");
    assert.notDeepEqual(afterSeal, [7, 7, 7, 7], "the byte path never falls back to the sealed session's blob");
    await client.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a byte read in flight during a partition change never serves the previous principal's session blob", async () => {
  const root = await tempRoot();
  try {
    const { state, fetch } = bearerServer();
    const base = fileRangeStore(root);
    let opens = 0;
    let midOpen: Promise<Blob | undefined> | undefined;
    let client!: ReturnType<typeof createClient>;
    // A store whose open() lets a read land after the carrier opened the incoming
    // partition and before the runtime bound the byte cache to it. Two things close
    // the window and this test holds both: a switch wipes the outgoing partition, so
    // the incoming one has no viewed row to serve under, and the runtime drops the
    // session allowance before its first await.
    const store = () => {
      const inner = base();
      const open = inner.open.bind(inner);
      inner.open = async (partition) => {
        const result = await open(partition);
        opens += 1;
        if (opens === 3) midOpen = client.assetCache!.get(B, 8);
        return result;
      };
      return inner;
    };
    client = createClient({
      url: "http://custody-race.test", tokenStore: memoryTokenStore(),
      offline: { store }, fetch,
    });
    // b views the clip once, so b's partition records it viewed while still holding the row.
    state.fill = 6;
    await client.auth.login({ email: "b@example.com", password: "pw" });
    await client.query(api.messages.thread, THREAD_ARGS);
    const urlB = (await client.assetUrl(photo(B) as any, { width: 8 }))!;
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing: {} })), [6, 6, 6, 6]);
    // a views it too; a's session now holds a's blob.
    state.fill = 5;
    await client.auth.login({ email: "a@example.com", password: "pw" });
    await client.query(api.messages.thread, THREAD_ARGS);
    assert.deepEqual(await bytes(await client.assetBlob(urlB, { viewing: {} })), [5, 5, 5, 5]);
    // b returns: the read that lands inside open() must not see a's blob.
    await client.auth.login({ email: "b@example.com", password: "pw" });
    assert.equal(opens, 3, "the probe ran on b's second open");
    assert.equal(await midOpen, undefined, "a's session blob is gone before b's partition can be read");
    assert.equal(await client.assetCache!.get(B, 8), undefined, "and it stays gone");
    await client.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});



test("blob: URLs are revoked and re-minted when the client identity or the partition changes, not only on unmount", async () => {
  const root = await tempRoot();
  const env = domEnvironment();
  const document = env.dom.window.document;
  let reactRoot: Root | undefined;
  const providerClients = new Set<any>();
  function TrackClient() {
    const client = useSnapbackClient();
    useEffect(() => { providerClients.add(client); }, [client]);
    return null;
  }
  try {
    // Part 1: a client identity change (persona swap) on a mounted image.
    let offlinePhase = false;
    const fetch = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const metadata = metadataResponse(url);
      if (metadata) return metadata;
      if (url.pathname === "/api/query") {
        return json(envelope([ref("messages", "m1")], [messageRow("m1", { photo: photo(A) })]));
      }
      if (offlinePhase) throw new Error(`network used offline: ${url.pathname}`);
      if (url.pathname.startsWith("/api/asset/")) {
        return new Response(bytesOf(4, 1), { status: 200, headers: { "Content-Type": "image/jpeg" } });
      }
      throw new Error(`unexpected path ${url.pathname}`);
    };
    const offline = { store: fileRangeStore(root) };
    const seed = createClient({ url: "http://assets.test", persona: "alice", offline, fetch });
    await seed.ready;
    await seed.query(api.messages.thread, THREAD_ARGS);
    await seed.assetBlob((await seed.assetUrl(photo(A) as any, { width: 240 }))!);
    await seed.close();
    offlinePhase = true;
    const render = async (persona: string) => {
      await act(async () => {
        reactRoot!.render(React.createElement(
          SnapbackProvider, { url: "http://assets.test", persona, fetch, offline } as any,
          React.createElement(React.Fragment, null,
            React.createElement(TrackClient),
            React.createElement(AssetImage, { asset: photo(A) as any, alt: "photo" }),
          ),
        ));
      });
    };
    const src = () => document.querySelector("img")!.getAttribute("src") ?? "";
    reactRoot = createRoot(document.getElementById("root")!);
    await render("alice");
    assert.ok(await until(() => src().startsWith("blob:")), "alice renders from her byte cache");
    const first = src();
    await render("bob");
    assert.ok(await until(() => env.revoked.includes(first)), "the identity change revoked alice's blob: URL");
    assert.ok(await until(() => src() !== first), "the image no longer shows a revoked URL");
    await render("alice");
    assert.ok(await until(() => src().startsWith("blob:") && src() !== first), "alice's return re-mints a fresh blob: URL");
    assert.equal(env.revoked.includes(src()), false);
    await act(async () => reactRoot!.unmount());
    reactRoot = undefined;
  } finally {
    if (reactRoot) await act(async () => reactRoot!.unmount());
    await Promise.all([...providerClients].map(client => client.close()));
    env.restore();
    await rm(root, { recursive: true, force: true });
  }

  // Part 2: a partition change on the same client (another principal signs in).
  const root2 = await tempRoot();
  const env2 = domEnvironment();
  const document2 = env2.dom.window.document;
  reactRoot = undefined;
  try {
    const { state, fetch } = bearerServer({ rows: () => [messageRow("m1", { photo: photo(A) })] });
    const tokenStore = memoryTokenStore();
    const offline = { store: fileRangeStore(root2) };
    const seed = createClient({ url: "http://custody.test", tokenStore, offline, fetch });
    await seed.auth.login({ email: "a@example.com", password: "pw" });
    await seed.query(api.messages.thread, THREAD_ARGS);
    await seed.assetBlob((await seed.assetUrl(photo(A) as any, { width: 240 }))!);
    await seed.close();
    let client: any;
    function Grab() {
      const value = useSnapbackClient();
      useEffect(() => { client = value; }, [value]);
      return null;
    }
    reactRoot = createRoot(document2.getElementById("root")!);
    await act(async () => {
      reactRoot!.render(React.createElement(
        SnapbackProvider, { url: "http://custody.test", tokenStore, fetch, offline } as any,
        React.createElement(React.Fragment, null,
          React.createElement(Grab),
          React.createElement(AssetImage, { asset: photo(A) as any, alt: "photo" }),
        ),
      ));
    });
    const src = () => document2.querySelector("img")!.getAttribute("src") ?? "";
    assert.ok(await until(() => src().startsWith("blob:")), "the restored bearer renders from principal-a's cache");
    const first = src();
    const fetchesBefore = state.assetFetches;
    await act(async () => { await client.auth.login({ email: "b@example.com", password: "pw" }); });
    assert.ok(await until(() => env2.revoked.includes(first)), "the partition switch revoked the blob: URL");
    assert.ok(await until(() => src() !== first && src() !== ""), "the image was re-minted for the new partition");
    assert.ok(state.assetFetches > fetchesBefore, "the new partition holds nothing, so the rendition was fetched");
  } finally {
    if (reactRoot) await act(async () => reactRoot!.unmount());
    env2.restore();
    await rm(root2, { recursive: true, force: true });
  }
});

test("a viewed view-once row reads null on a fresh query, a conditional read, and a live frame, not only from the held answer", async () => {
  const root = await tempRoot();
  try {
    let conditional = false;
    const frame = () => envelope([ref("messages", "m1"), ref("messages", "m2")], [messageRow("m1", { photo: photo(A) }), messageRow("m2", { photo: photo(B) })]);
    const client = createClient({
      url: "http://live.test", persona: "alice",
      offline: { store: fileRangeStore(root) },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const metadata = metadataResponse(url);
        if (metadata) return metadata;
        if (url.pathname === "/api/query") {
          const body = JSON.parse(String(init?.body));
          if (conditional && body.validator === VALIDATOR) return json({ state: "unchanged", seq: 3, validator: VALIDATOR });
          return json(frame());
        }
        if (url.pathname === "/api/subscribe") return sse(frame());
        if (url.pathname.startsWith("/api/asset/")) {
          return new Response(bytesOf(4, 5), { status: 200, headers: { "Content-Type": "image/jpeg" } });
        }
        throw new Error(`unexpected path ${url.pathname}`);
      },
    });
    await client.ready;
    const ids = (value: any) => ("data" in value ? value.data : []).map((row: any) => row?.id ?? null);
    assert.deepEqual(ids(await client.query(api.messages.thread, THREAD_ARGS)), ["m1", "m2"], "before the view the row renders");
    await client.assetBlob((await client.assetUrl(photo(B) as any, { width: 8 }))!, { viewing: {} });
    assert.deepEqual(ids(await client.query(api.messages.thread, THREAD_ARGS)), ["m1", null], "a fresh envelope hides the viewed row");
    conditional = true;
    assert.deepEqual(ids(await client.query(api.messages.thread, THREAD_ARGS)), ["m1", null], "a conditional read hides it too");
    const seen: any[] = [];
    const subscription = subscribe(client, api.messages.thread, THREAD_ARGS, (delivery) => seen.push(delivery));
    const live = await subscription.until((delivery) => "data" in delivery, 2_000);
    assert.deepEqual(ids(live), ["m1", null], "a live frame hides it");
    subscription.close();
    await client.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("view-once expansion owns its pre-await snapshot and preserves escaped application markers", async () => {
  const root = await tempRoot();
  const store = fileRangeStore(root)();
  const runtime = new OfflineRuntime({ store: () => store });
  try {
    await runtime.open("dev:alice");
    let entered!: () => void, release!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    store.viewedRows = async () => { entered(); await waiting; return [{ table: "messages", id: "m2" }]; };
    const literal = ref("messages", "m2");
    const raw = envelope({ kept: ref("messages", "m1"), removed: ref("messages", "m2"),
      nested: [ref("messages", "m1"), ref("messages", "m2")], literal: { $row: { $value: literal } }, note: "before" },
    [messageRow("m1", { body: "before" }), messageRow("m2", { body: "viewed" })]) as any;
    const pending = runtime.accept("messages.thread", {}, raw);
    await reading;
    raw.rows[0].row.body = "caller changed during await";
    raw.data.note = "caller changed during await";
    raw.data.addedDuringRead = ref("messages", "m2");
    const callerSnapshot = structuredClone(raw);
    release();
    const data = (await pending).result.data as any;
    assert.equal(data.kept.body, "before");
    assert.equal(data.note, "before");
    assert.equal(Object.hasOwn(data, "addedDuringRead"), false, "a later caller property cannot enter the captured expansion");
    assert.equal(data.removed, null);
    assert.equal(data.nested[1], null);
    assert.deepEqual(data.literal, literal, "the escaped object is not a viewed row reference");
    assert.notEqual(data.kept, data.nested[0], "repeated references retain independent public row copies");
    assert.deepEqual(raw, callerSnapshot, "filtering mutates only the runtime's private expansion");
    const direct = await runtime.accept("messages.thread", {}, { ...raw, data: ref("messages", "m2") });
    assert.equal(direct.result.data, null, "a root reference can be replaced too");
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test("coverage() hides a viewed view-once row from the twin and marks it absent", async () => {
  const root = await tempRoot();
  try {
    const store: any = fileRangeStore(root)();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{
      op: "thread", args: {}, state: "complete", data: [ref("messages", "m1"), ref("messages", "m2")], next: null, seq: 1,
      rows: [messageRow("m1", { photo: photo(A) }), messageRow("m2", { photo: photo(B) })], receipt: emptyReceipt(),
    }] });
    assert.deepEqual((await store.coverage()).rows.map((row: any) => row.id), ["m1", "m2"]);
    await store.commit({ viewed: [{ table: "messages", id: "m2" }] });
    const coverage = await store.coverage();
    assert.deepEqual(coverage.rows.map((row: any) => row.id), ["m1"], "the viewed row is not a row the twin may evaluate");
    assert.deepEqual(coverage.absences, [["messages", "byId", ["m2"]]], "and it is a proven absence");
    assert.deepEqual(coverage.viewed, [{ table: "messages", id: "m2" }]);
    assert.deepEqual((await store.answer("thread", {}))?.data.map((row: any) => row?.id ?? null), ["m1", null]);
    await store.close?.();
  } finally { await rm(root, { recursive: true, force: true }); }
});



test("web byte consumers refuse missing viewing tokens before fetching; ordinary assets need none", async () => {
  const directory = await tempRoot(); const owner = bearerServer();
  const client = createClient({ url: "http://assets.test", token: "token-a", offlinePrincipal: "principal-a",
    fetch: owner.fetch, offline: { store: fileRangeStore(directory) } });
  try {
    await client.ready;
    await client.query(api.messages.thread, THREAD_ARGS);
    const url = (await client.assetUrl(photo(B)))!;
    for (const method of ["assetBlob", "assetBytes"] as const)
      await assert.rejects(client[method](url), (error: any) => error.code === "E_ASSET_TYPE");
    assert.equal(owner.state.assetFetches, 0); assert.equal(await client.assetCache!.viewed(B), false);
    assert.equal((await client.assetBlob((await client.assetUrl(photo(A)))!)).size, 4);
    assert.equal(owner.state.assetFetches, 1);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("web mounted image holds one viewing token; a second consumer and a remount cannot re-show it", async () => {
  const directory = await tempRoot(); const owner = bearerServer(); const env = domEnvironment();
  const client = createClient({ url: "http://assets.test", token: "token-a", offlinePrincipal: "principal-a",
    fetch: owner.fetch, offline: { store: fileRangeStore(directory) } });
  const root = createRoot(env.dom.window.document.getElementById("root")!);
  const tokens: object[] = []; const fetch = client.assetBlob.bind(client);
  client.assetBlob = async (url, options) => { tokens.push(options?.viewing); return fetch(url, options); };
  const render = async (firstKey: string, second = false) => act(async () => root.render(React.createElement(SnapbackProvider, { client },
    React.createElement(React.Fragment, null, React.createElement(AssetImage, { key: firstKey, asset: photo(B), alt: "first" }),
      second ? React.createElement(AssetImage, { key: "second", asset: photo(B), alt: "second" }) : null))));
  const src = (alt: string) => env.dom.window.document.querySelector(`img[alt="${alt}"]`)?.getAttribute("src");
  try {
    await client.ready;
    await client.query(api.messages.thread, THREAD_ARGS); await render("first");
    assert.ok(await until(() => Boolean(src("first")))); const first = src("first");
    assert.ok(tokens[0] && typeof tokens[0] === "object");
    await render("first", true); await settle(5);
    assert.equal(src("first"), first); assert.equal(src("second"), null);
    await assert.rejects(client.assetBlob(`http://assets.test/api/asset/${B}`, { viewing: {} }), (error: any) => error.code === "E_ASSET_VIEWED");
    await render("remount"); await settle(5);
    assert.equal(src("first"), null); assert.ok(env.revoked.includes(first!)); assert.equal(owner.state.assetFetches, 1);
  } finally { await act(async () => root.unmount()); await client.close(); env.restore(); await rm(directory, { recursive: true, force: true }); }
});

test("simultaneously mounted web siblings revoke the losing view-once consumer", async () => {
  const directory = await tempRoot(); const owner = bearerServer(); const env = domEnvironment();
  const releases: Array<() => void> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith("/api/asset/")) return owner.fetch(input, init);
    await new Promise<void>(resolve => releases.push(resolve));
    return owner.fetch(input, init);
  };
  const client = createClient({ url: "http://assets.test", token: "token-a", offlinePrincipal: "principal-a",
    fetch, offline: { store: fileRangeStore(directory) } });
  const root = createRoot(env.dom.window.document.getElementById("root")!);
  const src = (alt: string) => env.dom.window.document.querySelector(`img[alt="${alt}"]`)?.getAttribute("src");
  try {
    await client.ready; await client.query(api.messages.thread, THREAD_ARGS);
    await act(async () => root.render(React.createElement(SnapbackProvider, { client }, React.createElement(React.Fragment, null,
      React.createElement(AssetImage, { asset: photo(B), alt: "left" }),
      React.createElement(AssetImage, { asset: photo(B), alt: "right" })))));
    assert.ok(await until(() => releases.length === 2), "both siblings began before either viewing was admitted");
    releases.splice(0).forEach(resolve => resolve());
    assert.ok(await until(() => Boolean(src("left")) !== Boolean(src("right"))));
    assert.equal([src("left"), src("right")].filter(Boolean).length, 1);
    assert.equal(await client.assetCache!.viewed(B), true);
    assert.equal(owner.state.assetFetches, 2, "the race may move two responses but admits one mounted viewer");
  } finally {
    releases.splice(0).forEach(resolve => resolve());
    await act(async () => root.unmount()); await client.close(); env.restore();
    await rm(directory, { recursive: true, force: true });
  }
});



test("web asset fetch reads the live transport cut after a paused cache miss", async () => {
  const { deferred } = await import("./native-fixture.ts");
  for (const method of ["assetBlob", "assetBytes"] as const) {
    const directory = await tempRoot(); const owner = bearerServer();
    const client = createClient({ url: "http://assets.test", token: "token-a", offlinePrincipal: "principal-a",
      fetch: owner.fetch, offline: { store: fileRangeStore(directory) } });
    const gate = deferred(), reading = deferred();
    try {
      await client.query(api.messages.thread, THREAD_ARGS);
      const url = (await client.assetUrl(photo(A)))!;
      client.assetCache!.getBytes = async () => { reading.resolve(); await gate.promise; return undefined; };
      const pending = client[method](url);
      const refused = assert.rejects(pending, (error: any) => error.code === "E_TRANSPORT");
      await reading.promise; await client.offline(); gate.resolve(); await refused;
      assert.equal(owner.state.assetFetches, 0); assert.equal(client.snapshot.connection, "offline");
    } finally { gate.resolve(); await client.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

test("late asset validation never changes a completed offline cut back to connected", async () => {
  const { deferred } = await import("./native-fixture.ts");
  for (const method of ["assetBlob", "assetBytes"] as const) {
    const gate = deferred(), fetching = deferred();
    const client = createClient({ url: "http://assets.test", fetch: async () => {
      fetching.resolve(); await gate.promise; return new Response(new Uint8Array([1]));
    } });
    try {
      const pending = client[method](`http://assets.test/api/asset/${A}`);
      await fetching.promise; await client.offline(); gate.resolve(); await pending;
      assert.equal(client.snapshot.connection, "offline");
    } finally { gate.resolve(); await client.close(); }
  }
});
