import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";
import { photo, clip, payload, deferred, delivery, nativeFixture } from "./native-fixture.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative ??= { React, fileBodies: new Map(), fileUris: [], videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const { AssetImage, AssetVideo, SnapbackProvider } = await import("../dist/expo.mjs");
const tick = () => act(async () => { await new Promise((done) => setTimeout(done, 1)); });
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await tick();
  assert.ok(predicate(), "native source did not settle");
}
const image = (renderer: ReactTestRenderer) => renderer.root.findByType("NativeImage").props.source;
async function mount(f: Awaited<ReturnType<typeof nativeFixture>>, child = React.createElement(AssetImage, { asset: photo, width: 4 })) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client: f.client }, child)); });
  return renderer;
}

test("view-once delayed fetch tombstoned before admission renders nothing", async () => {
  const f = await nativeFixture({ once: true }); const gate = deferred();
  f.hooks.network = () => gate.promise;
  const renderer = await mount(f);
  try {
    await until(() => f.requests.length === 1);
    await act(async () => f.store.commit({ tombstones: [{ table: "messages", id: "m1", seq: 2 }] }));
    gate.resolve(); await tick(); await tick();
    assert.equal(image(renderer), undefined); assert.deepEqual(f.writes, []);
    assert.equal(f.requests[0].cache, "no-store");
    assert.equal(new Headers(f.requests[0].headers).get("Cache-Control"), "no-store");
  } finally { gate.resolve(); await act(async () => renderer.unmount()); await f.close(); }
});

test("failed durable viewed mark renders nothing; reopen grants only one successful viewing", async () => {
  const f = await nativeFixture({ once: true }); f.hooks.failCommit = true;
  let renderer = await mount(f);
  try {
    await until(() => f.client.snapshot.lastRefusal?.code === "E_OFFLINE_CARRIER");
    assert.equal(image(renderer), undefined); assert.deepEqual(f.writes, []);
    await act(async () => renderer.unmount());
    f.hooks.failCommit = false;
    f.client.assetCache!.forget(); await f.store.close(); await f.store.open("dev:alice");
    renderer = await mount(f); await until(() => Boolean(image(renderer)));
    assert.match(image(renderer).uri, /^data:/);
    assert.equal(await f.client.assetCache!.viewed(photo.id), true);
    await act(async () => renderer.unmount());
    f.client.assetCache!.forget(); await f.store.close(); await f.store.open("dev:alice");
    renderer = await mount(f); await tick(); await tick();
    assert.equal(image(renderer), undefined); assert.deepEqual(f.writes, []);
    assert.equal(f.requests.length, 2, "failed admission plus the single successful viewing; no second view");
  } finally { await act(async () => renderer.unmount()); await f.close(); }
});

test("ordinary oversize media renders uncached memory and a later mount retries", async () => {
  const f = await nativeFixture({ maxAssetBytes: 1 }); let renderer = await mount(f);
  try {
    await until(() => Boolean(image(renderer))); assert.match(image(renderer).uri, /^data:/);
    assert.deepEqual((await f.client.assetCache!.status()).entries, []); assert.deepEqual(f.writes, []);
    await act(async () => renderer.unmount()); renderer = await mount(f);
    await until(() => Boolean(image(renderer))); assert.equal(f.requests.length, 2);
  } finally { await act(async () => renderer.unmount()); await f.close(); }
});

test("unrelated message and watermark swaps keep the ordinary video player and position", async () => {
  const f = await nativeFixture();
  await f.store.commit({ deliveries: [delivery("video", clip)] });
  await f.client.assetCache!.putBytes(clip.id, null, { ...payload, type: "video/mp4" });
  const renderer = await mount(f, React.createElement(AssetVideo, { asset: clip }));
  try {
    await until(() => renderer.root.findAllByType("NativeVideo").length === 1);
    const player = renderer.root.findByType("NativeVideo").props.player; player.currentTime = 12;
    const revision = f.files.getAssetRevision(clip.id);
    await act(async () => { await f.store.commit({ deliveries: [{ ...delivery("other"), rows: [], data: ["unrelated"] }] }); await f.store.commit({ watermark: { op: "inbox", args: { c: null }, watermark: null, updatedAt: 2 }, grants: { current: null } }); });
    assert.equal(f.files.getAssetRevision(clip.id), revision);
    assert.equal(renderer.root.findByType("NativeVideo").props.player, player);
    assert.equal(player.currentTime, 12);
  } finally { await act(async () => renderer.unmount()); await f.close(); }
});

test("combined byte, file, and hook custody: seal mid-write, principal swap mid-read, wipe mid-materialization", async () => {
  const f = await nativeFixture(); let renderer: ReactTestRenderer | undefined;
  const gates: ReturnType<typeof deferred>[] = [];
  try {
    const write = deferred(); gates.push(write); const writing = deferred();
    f.hooks.write = async () => { writing.resolve(); await write.promise; };
    renderer = await mount(f); await writing.promise;
    await act(async () => f.store.seal()); write.resolve(); await tick();
    assert.equal(image(renderer), undefined); assert.equal(f.data.size, 0);
    await act(async () => renderer!.unmount()); renderer = undefined;
    f.hooks.write = undefined; f.client.assetCache!.forget();
    await f.store.close(); await f.store.open("dev:alice"); await f.store.unseal();
    await f.client.assetCache!.putBytes(photo.id, 8, payload);
    const reading = deferred(), read = deferred(); gates.push(read);
    f.hooks.read = async () => { reading.resolve(); await read.promise; };
    renderer = await mount(f); await reading.promise;
    await act(async () => { f.client.assetCache!.bind("dev:bob"); await f.store.close(); await f.store.open("dev:bob"); });
    read.resolve(); await tick(); await tick();
    assert.equal(image(renderer), undefined); assert.equal(f.data.size, 0);
    await act(async () => renderer!.unmount()); renderer = undefined; f.hooks.read = undefined;
    await f.store.commit({ deliveries: [delivery()] }); await f.client.assetCache!.putBytes(photo.id, 8, payload);
    const materializing = deferred(), materialize = deferred(); gates.push(materialize);
    f.hooks.write = async () => { materializing.resolve(); await materialize.promise; };
    renderer = await mount(f); await materializing.promise;
    const custody = f.files.getCustody(); const wiped = f.store.wipe("dev:bob");
    await until(() => f.files.getCustody() !== custody);
    materialize.resolve(); await act(async () => wiped); await tick();
    assert.equal(image(renderer), undefined); assert.equal(f.data.size, 0);
  } finally { for (const gate of gates) gate.resolve(); if (renderer) await act(async () => renderer!.unmount()); await f.close(); }
});

test("a seal cannot resurrect an uncached source even when getBytes still holds bytes", async () => {
  const f = await nativeFixture({ maxAssetBytes: 1 }); const renderer = await mount(f);
  try {
    await until(() => Boolean(image(renderer)));
    f.client.assetCache!.getBytes = async () => payload;
    await act(async () => f.store.seal()); await tick(); await tick();
    assert.equal(image(renderer), undefined);
  } finally { await act(async () => renderer.unmount()); await f.close(); }
});

test("native second viewing instance cannot borrow the first instance's session", async () => {
  const f = await nativeFixture({ once: true }); let renderer = await mount(f);
  try {
    await until(() => Boolean(image(renderer)));
    assert.equal(await f.client.assetUrl(photo), undefined);
    assert.deepEqual(await f.client.assetUrl([photo]), []);
    const second = await mount(f);
    try { await tick(); assert.equal(image(second), undefined); assert.match(image(renderer).uri, /^data:/); }
    finally { await act(async () => second.unmount()); }
    assert.equal(f.requests.length, 1);
  } finally { await act(async () => renderer.unmount()); await f.close(); }
});

test("concurrent byte consumers acquire exactly one view-once allowance", async () => {
  const f = await nativeFixture({ once: true });
  try {
    const url = (await f.client.assetUrl(photo))!;
    const results = await Promise.allSettled([f.client.assetBytes(url, { viewing: {} }), f.client.assetBytes(url, { viewing: {} })]);
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
    assert.equal(await f.client.assetCache!.viewed(photo.id), true); assert.deepEqual(f.writes, []);
  } finally { await f.close(); }
});

test("shipped chat viewOnce row policy keeps native media off disk", async () => {
  const { chatOffline } = await import("../dist/templates/chat/shared/offline.js");
  const f = await nativeFixture({ viewOnce: chatOffline.viewOnce });
  const held = delivery(); held.seq = 2; (held.rows[0].row as any).viewOnce = true;
  await f.store.commit({ deliveries: [held] }); const renderer = await mount(f);
  try {
    await until(() => Boolean(image(renderer))); assert.match(image(renderer).uri, /^data:/);
    assert.equal(await f.client.assetCache!.viewed(photo.id), true); assert.deepEqual(f.writes, []);
  } finally { await act(async () => renderer.unmount()); await f.close(); }
});
