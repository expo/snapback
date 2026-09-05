// Fresh process: no built client/Expo entry is imported until these methods are absent.
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

// Initialize Node's host HTTP primitives before restricting the application global.
new Response(); new Headers();
// Node's Response converts string bodies with ES2024 toWellFormed. Expo's host
// response does not; use byte bodies in this host double, leaving the globals absent.
const HostResponse = Response;
globalThis.Response = class extends HostResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(typeof body === "string" ? new TextEncoder().encode(body) : body, init);
  }
};
const missing: Array<[object, string[]]> = [
  [AbortSignal.prototype, ["throwIfAborted"]], [Promise, ["withResolvers", "try"]],
  [AbortSignal, ["any", "timeout"]], [Array, ["fromAsync"]],
  [RegExp, ["escape"]], [JSON, ["rawJSON", "isRawJSON"]],
  [Math, ["sumPrecise"]], [Atomics, ["pause"]], [Error, ["isError"]],
  [Object, ["groupBy"]], [Map, ["groupBy"]],
  [Array.prototype, ["findLast", "findLastIndex", "toReversed", "toSorted", "toSpliced", "with"]],
  [String.prototype, ["isWellFormed", "toWellFormed"]],
  [Object.getPrototypeOf(Uint8Array.prototype), ["findLast", "findLastIndex", "toReversed", "toSorted", "with"]],
  [Uint8Array, ["fromBase64", "fromHex"]], [Uint8Array.prototype, ["toBase64", "toHex", "setFromBase64", "setFromHex"]],
  [ArrayBuffer.prototype, ["resize", "transfer", "transferToFixedLength"]],
  [SharedArrayBuffer.prototype, ["grow"]], [DataView.prototype, ["getFloat16", "setFloat16"]],
  [Set.prototype, ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]],
];
if ((globalThis as any).Iterator) {
  missing.push([(globalThis as any).Iterator, ["from"]], [(globalThis as any).Iterator.prototype,
    ["map", "filter", "take", "drop", "flatMap", "reduce", "toArray", "forEach", "some", "every", "find"]]);
}
for (const [target, names] of missing) for (const name of names) Reflect.deleteProperty(target, name);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative = { React, fileBodies: new Map(), fileUris: [], videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const { createExpoClient, SnapbackProvider, AssetImage } = await import("../dist/expo.mjs");
const { api } = await import("../dist/client.mjs");
const { fileRangeStore } = await import("../dist/test.mjs");
const { fakeOwner } = await import("./fake-owner.ts");
const root = await mkdtemp(join(tmpdir(), "e2-hermes-"));
const owner = fakeOwner({ seed: true, cursorArg: "c" });
const photo = { id: "s2id-00000000000000000000000000000008-0000000000000001", width: 8, height: 8 };
let logins = 0, photos = 0;
(globalThis as any).__snapbackNative.expoFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  if (path === "/api/auth/login") { logins++; return Response.json({ token: "hermes-session", viewer: "dev:alice" }); }
  if (path === "/api/auth/me") return Response.json({ viewer: "dev:alice", kind: "user" });
  if (path.startsWith("/api/asset/")) { photos++; return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }); }
  return owner.fetch(input, init);
};
const store = fileRangeStore(root)();
const client = createExpoClient({ url: "http://hermes.test", tokenStore: { load: () => null, save() {} }, offline: { store: () => store } });
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let drain: ReturnType<typeof client.subscribe> | undefined;
try {
  await client.ready; await client.auth.login({ email: "alice@example.test", password: "password" });
  drain = client.subscribe(api.deliveries.inbox, { c: null }, () => {}, { drain: true });
  await drain.until((value: any) => value.caughtUp === true);
  await store.commit({ deliveries: [{ op: "photo", args: {}, state: "complete", seq: 5, next: null,
    rows: [{ table: "messages", id: "photo", row: { id: "photo", photo } }], data: [{ $row: { table: "messages", id: "photo" } }],
    receipt: { ranges: [], absences: [], verdicts: [] } }] });
  await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(AssetImage, { asset: photo, width: 4 }))); });
  for (let i = 0; i < 100 && !renderer!.root.findByType("NativeImage").props.source; i++)
    await act(async () => { await new Promise((done) => setTimeout(done, 1)); });
  assert.match(renderer!.root.findByType("NativeImage").props.source.uri, /^data:image\/png;base64,/);
  assert.equal(logins, 1); assert.equal(photos, 1);
  assert.ok(owner.requests.includes("/api/query"));
  for (const [target, names] of missing) for (const name of names) assert.equal((target as any)[name], undefined);
  console.log("Hermes-like built Expo: login, drain, photo PASS");
} finally { drain?.close(); if (renderer) await act(async () => renderer!.unmount()); await client.close(); await rm(root, { recursive: true, force: true }); }
