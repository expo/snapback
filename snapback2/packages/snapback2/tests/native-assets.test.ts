import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type NativeHarness = {
  expoFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  fileBodies: Map<string, Uint8Array>;
  fileUris: string[];
  React: typeof React;
  videoSources: unknown[];
};

const harness = globalThis as typeof globalThis & { __snapbackNative: NativeHarness };
harness.__snapbackNative = {
  expoFetch: async (input) => { throw new Error(`unexpected expo/fetch request ${input}`); },
  fileBodies: new Map(),
  fileUris: [],
  React,
  videoSources: [],
};

register(new URL("./native-mocks/loader.mjs", import.meta.url));

const { RefusalError, api, createClient } = await import("../dist/client.mjs");
const { AssetImage, AssetVideo, SnapbackProvider, useSnapbackClient } = await import("../dist/react-native.mjs");
const expoFileSystem = await import("expo-file-system") as typeof import("expo-file-system") & {
  setFileConstructorForTest(value: unknown): void;
};

const image = { id: "s2id-00000000000000000000000000000007-0000000000000001", width: 640, height: 480 } as const;
const video = { id: "s2id-00000000000000000000000000000007-0000000000000002", width: 1280, height: 720, duration: 2_500 } as const;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function nativeManifest(max = 16) {
  return {
    generation: "native-v1",
    programGeneration: "program-test",
    ops: { "assets.send": { kind: "mutation", planHash: "plan-test", args: {
      photo: { Image: { max } },
      clip: { Video: { max } },
    } } },
    channels: {},
    auth: {},
  };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function nativeImage(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType("NativeImage");
}

test("Expo File mock is Blob-shaped without inheriting from web Blob, and file:// upload uses expo/fetch without progress", async () => {
  harness.__snapbackNative.fileUris = [];
  harness.__snapbackNative.fileBodies = new Map([["file://clip.mov", new TextEncoder().encode("video")]]);
  const example = new expoFileSystem.File("file://clip.mov");
  assert.equal(example instanceof Blob, false, "the mock must fail the old instanceof Blob classifier");
  assert.equal(typeof example.arrayBuffer, "function");
  assert.equal(typeof example.stream, "function");
  let uploadBody: unknown;
  harness.__snapbackNative.expoFetch = async (input, init) => {
    assert.equal(String(input), "http://assets.test/api/upload");
    assert.equal(new Headers(init?.headers).get("Content-Length"), "5");
    uploadBody = init?.body;
    assert.equal(Object.hasOwn(init ?? {}, "duplex"), false);
    return json(video);
  };
  const ownerFetch = async (input: string | URL | Request) => {
    throw new Error(`owner fetch must not receive native upload ${input}`);
  };
  const client = createClient({ url: "http://assets.test", persona: "alice", fetch: ownerFetch });

  const record = await client.upload({ uri: "file://clip.mov", fileSize: 5, mimeType: "video/quicktime" });

  assert.deepEqual(record, video);
  assert.deepEqual(harness.__snapbackNative.fileUris, ["file://clip.mov", "file://clip.mov"]);
  assert.equal(uploadBody instanceof Blob, false);
  assert.ok(uploadBody instanceof expoFileSystem.File);
  assert.equal((uploadBody as { size: number }).size, 5);
  client.close();
});

test("a direct Expo File with progress uses expo/fetch and never constructs XMLHttpRequest", async () => {
  harness.__snapbackNative.fileUris = [];
  harness.__snapbackNative.fileBodies = new Map([["file://direct.mov", new TextEncoder().encode("video")]]);
  const expoFile = new expoFileSystem.File("file://direct.mov");
  const progress: Array<{ loaded: number; total: number }> = [];
  let expoFetchCalls = 0;
  harness.__snapbackNative.expoFetch = async (_input, init) => {
    expoFetchCalls += 1;
    assert.equal(new Headers(init?.headers).get("Content-Length"), "5");
    assert.equal(init?.body, expoFile);
    return json(video);
  };
  const originalXhr = (globalThis as any).XMLHttpRequest;
  let xhrConstructions = 0;
  (globalThis as any).XMLHttpRequest = class {
    constructor() {
      xhrConstructions += 1;
    }
  };
  const client = createClient({ url: "http://assets.test", persona: "alice" });
  try {
    const record = await client.upload(expoFile as any, {
      onProgress: (event) => progress.push(event),
    });

    assert.deepEqual(record, video);
    assert.equal(expoFetchCalls, 1);
    assert.equal(xhrConstructions, 0);
    assert.deepEqual(progress, [{ loaded: 0, total: 5 }, { loaded: 5, total: 5 }]);
  } finally {
    client.close();
    if (originalXhr === undefined) delete (globalThis as any).XMLHttpRequest;
    else (globalThis as any).XMLHttpRequest = originalXhr;
  }
});

test("content:// Expo File upload uses Content-Length and whole-body progress", async () => {
  harness.__snapbackNative.fileUris = [];
  harness.__snapbackNative.fileBodies = new Map([["content://picker/clip", new TextEncoder().encode("video")]]);
  const progress: Array<{ loaded: number; total: number }> = [];
  harness.__snapbackNative.expoFetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("Content-Length"), "5");
    assert.equal(init?.body instanceof Blob, false);
    assert.ok(init?.body instanceof expoFileSystem.File);
    assert.equal(Object.hasOwn(init ?? {}, "duplex"), false);
    return json(video);
  };
  const client = createClient({
    url: "http://assets.test",
    persona: "alice",
    fetch: async (input) => { throw new Error(`owner fetch must not receive native upload ${input}`); },
  });

  const record = await client.upload(
    { uri: "content://picker/clip", mimeType: "video/quicktime" },
    { onProgress: (event) => progress.push(event) },
  );

  assert.deepEqual(record, video);
  assert.deepEqual(harness.__snapbackNative.fileUris, ["content://picker/clip"]);
  assert.deepEqual(progress, [{ loaded: 0, total: 5 }, { loaded: 5, total: 5 }]);
  client.close();
});

test("native source length comes from Expo File and refuses oversize or inaccessible URIs before upload", async () => {
  harness.__snapbackNative.fileBodies = new Map([["content://oversize", new Uint8Array(6)]]);
  let uploads = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(nativeManifest(5));
    if (path === "/api/upload") { uploads += 1; return json(image); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", persona: "alice", fetch });

  await assertRefused(
    () => client.mutation(api.assets.send, { photo: { uri: "content://oversize", mimeType: "image/jpeg" } } as any),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_ASSET_TOO_LARGE",
  );
  await assert.rejects(
    () => client.upload({ uri: "file://missing.jpg", mimeType: "image/jpeg" }),
    (error: unknown) => isRefusalError(error) && error.code === "E_ASSET_TYPE",
  );
  assert.equal(uploads, 0);
  client.close();
});

test("file:// clip runs through Expo File upload, mutation substitution, and carrier URL", async () => {
  harness.__snapbackNative.fileUris = [];
  harness.__snapbackNative.fileBodies = new Map([["file://journey.mov", new Uint8Array([1, 2, 3, 4, 5])]]);
  let uploads = 0;
  let mutationArgs: unknown;
  harness.__snapbackNative.expoFetch = async (_input, init) => {
    uploads += 1;
    assert.equal(new Headers(init?.headers).get("Content-Length"), "5");
    assert.ok(init?.body instanceof expoFileSystem.File);
    return json(video);
  };
  const ownerFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(nativeManifest());
    if (path === "/api/mutation") {
      mutationArgs = JSON.parse(String(init?.body)).args;
      return json({ state: "committed", seq: 4, data: video });
    }
    if (path === "/api/auth/asset-session") {
      return json({ token: "native-journey-carrier", expiresAt: Date.now() + 120_000 });
    }
    throw new Error(`unexpected owner path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", persona: "alice", fetch: ownerFetch });

  const sent = await client.mutation(api.assets.send, {
    clip: { uri: "file://journey.mov", fileSize: 5, mimeType: "video/quicktime" },
  } as any);

  assert.equal(sent.state, "committed");
  assert.equal(uploads, 1);
  assert.deepEqual(mutationArgs, { clip: video });
  if (sent.state !== "committed") throw new Error("unreachable");
  assert.equal(
    await client.assetUrl(sent.data, { carrier: true }),
    `http://assets.test/api/asset/${video.id}?s=native-journey-carrier`,
  );
  client.close();
});

test("native AssetImage fetches bytes with persona headers and renders an in-memory source without Blob", async (context) => {
  const requests: RequestInit[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/api/manifest") return json(nativeManifest());
    requests.push(init!);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
  };
  const plainClient = createClient({ url: "http://assets.test", persona: "alice", fetch });
  context.after(() => plainClient.close());
  let renderer!: ReactTestRenderer;
  const Original = globalThis.Blob;
  globalThis.Blob = class { constructor() { throw new Error("native Blob is forbidden"); } } as any;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider,
      { client: plainClient }, React.createElement(AssetImage, { asset: image, width: 100 }))); });
    await settle();
    assert.deepEqual(nativeImage(renderer).props.source, { uri: "data:image/png;base64,AQID" });
    assert.equal(new Headers(requests[0]?.headers).get("X-Snapback-As"), "alice");
  } finally { globalThis.Blob = Original; await act(async () => renderer.unmount()); }
});

test("native AssetImage exposes bearer restoration failure without fetching unauthenticated bytes", async (context) => {
  let rejectLoad!: (error: Error) => void;
  const load = new Promise<string>((_resolve, reject) => { rejectLoad = reject; });
  const refusals: any[] = [];
  const plainClient = createClient({ url: "http://assets.test", tokenStore: { load: () => load, save: () => undefined },
    fetch: async () => { throw new Error("network must wait for token restore"); } });
  context.after(() => plainClient.close());
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider,
    { client: plainClient },
    React.createElement(AssetImage, { asset: image, onRefusal: (error) => refusals.push(error) }))); });
  assert.equal(nativeImage(renderer).props.source, undefined);
  rejectLoad(new Error("secure store unavailable"));
  await settle();
  assert.equal(nativeImage(renderer).props.source, undefined);
  assert.equal(refusals[0]?.code, "E_AUTH_TOKEN_STORE");
  await act(async () => renderer.unmount());
});

test("native AssetImage waits for bearer bytes and keeps its source across callback changes", async () => {
  let resolveLoad!: (token: string) => void;
  const load = new Promise<string>((resolve) => { resolveLoad = resolve; });
  let calls = 0;
  const client = createClient({ url: "http://assets.test", tokenStore: { load: () => load, save: () => undefined },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/manifest") return json(nativeManifest());
      if (new URL(String(input)).pathname === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer restored");
      calls++;
      return new Response(new Uint8Array([4]), { headers: { "Content-Type": "image/png" } });
    } });
  const tree = () => React.createElement(SnapbackProvider, { client }, React.createElement(AssetImage, { asset: image, onRefusal: () => {} }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(tree()); });
  assert.equal(nativeImage(renderer).props.source, undefined);
  assert.equal(calls, 0);
  resolveLoad("restored"); await settle();
  const source = nativeImage(renderer).props.source;
  assert.deepEqual(source, { uri: "data:image/png;base64,BA==" });
  await act(async () => renderer.update(tree()));
  assert.deepEqual(nativeImage(renderer).props.source, source);
  assert.equal(calls, 1);
  await act(async () => renderer.unmount()); await client.close();
});

test("native URI refuses E_ASSET_NATIVE_FILE_API when expo-file-system has no File constructor", async () => {
  const FileConstructor = expoFileSystem.File;
  expoFileSystem.setFileConstructorForTest(undefined);
  const client = createClient({
    url: "http://assets.test",
    persona: "alice",
    fetch: async (input) => { throw new Error(`unexpected owner request ${input}`); },
  });
  try {
    await assert.rejects(
      () => client.upload({ uri: "file://clip.mov", fileSize: 5, mimeType: "video/quicktime" }),
      (error: unknown) => isRefusalError(error)
        && error.code === "E_ASSET_NATIVE_FILE_API"
        && error.message.includes("expo-file-system >=19")
        && error.message.includes("Expo SDK 54"),
    );
  } finally {
    client.close();
    expoFileSystem.setFileConstructorForTest(FileConstructor);
  }
});


test("native AssetImage and ordinary AssetVideo serve cached files and clear mounted sources on custody change", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { NativeAssetFiles, attachAssetFiles, fileBackend, PersistentRangeStore, SqliteBackend, nodeSqliteDriver } = await import("../dist/sqlite-test.mjs");
  const root = await mkdtemp(join(tmpdir(), "e2-native-image-"));
  const held = new Map<string, Uint8Array>();
  const files = new NativeAssetFiles({ root: "file:///cache/snapback2", async list() { return []; }, async remove(uri) { held.delete(uri); },
    async write(uri, bytes) { held.set(uri, bytes); } });
  const store = new PersistentRangeStore(fileBackend(new SqliteBackend(() => nodeSqliteDriver(join(root, "state.db"))), files));
  attachAssetFiles(store, files);
  let fetches = 0;
  const client = createClient({ url: "http://assets.test", persona: "alice", offline: { store: () => store },
    fetch: async (input) => {
      if (new URL(String(input)).pathname === "/api/manifest") return json(nativeManifest());
      if (new URL(String(input)).pathname === "/api/program") return json({ code: "E_ROUTE", family: "op", message: "absent", guide: "op/reference" }, 404);
      fetches++; return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    } });
  let renderer: ReactTestRenderer | undefined;
  try {
    await client.ready;
    await store.commit({ deliveries: [{ op: "thread", args: {}, seq: 1, state: "complete", next: null,
      rows: [{ table: "messages", id: "photo-row", row: { id: "photo-row", photo: image, clip: video } }],
      data: [{ $row: { table: "messages", id: "photo-row" } }], receipt: { ranges: [], absences: [], verdicts: [] } }] });
    await client.assetCache!.putBytes(video.id, null, { bytes: new Uint8Array([4]), type: "video/mp4" });
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(AssetImage, { asset: image, width: 64 }), React.createElement(AssetVideo, { asset: video }))); });
    for (let i = 0; i < 10 && !nativeImage(renderer!).props.source; i++) await settle();
    const source = nativeImage(renderer!).props.source;
    assert.equal(source.uri, `file:///cache/snapback2/dev%3Aalice/${image.id}.w128.png`);
    assert.ok(held.has(source.uri)); assert.equal(fetches, 1);
    assert.equal(renderer!.root.findByType("NativeVideo").props.player.source, `file:///cache/snapback2/dev%3Aalice/${video.id}.mp4`);
    await act(async () => store.seal()); await settle();
    assert.equal(nativeImage(renderer!).props.source, undefined); assert.equal(fetches, 1);
    assert.equal(renderer!.root.findAllByType("NativeVideo").length, 0);
  } finally { if (renderer) await act(async () => renderer!.unmount()); await client.close(); await rm(root, { recursive: true, force: true }); }
});
