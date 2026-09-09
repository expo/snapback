import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { OfflineRuntime } from "../dist/sqlite-test.mjs";
import { fixtureClient as createClient } from "./live-fixture.ts";
import { certifiedDrain, certifiedDrainProgram, generation, schemaHash, planHash, metadataResponse } from "./offline-metadata-fixture.ts";

const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-offline-"));
}
function sse(value?: unknown, hang = false): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      if (value !== undefined) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      if (!hang) controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function envelope(data: unknown, validator = "1".repeat(64), seq = 3) {
  return {
    protocol: 1, generation, schemaHash, planHash,
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows: [], receipt: emptyReceipt(), validator,
  };
}
async function seededResumeStore(root: string, exact = false): Promise<void> {
  const identity = exact ? certifiedDrain : { op: "messages.inbox", generation, schemaHash };
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({
    deliveries: [{
      op: identity.op, args: { c: null }, state: "complete", data: [], next: null, seq: 3,
      validator: "1".repeat(64), receipt: emptyReceipt(),
    }],
    watermark: {
      op: identity.op, args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64),
      generation: identity.generation, schemaHash: identity.schemaHash, authEpoch: 7, updatedAt: 10,
    },
  });
  await store.close?.();
}

test('native cursor metadata survives cold custody and transport clears every typed local token after page support is lost', async () => {
  const root = await tempRoot(), factory = fileRangeStore(root);
  let runtime = new OfflineRuntime({ store: factory });
  try {
    await runtime.open('dev:alice');
    const args = { a: { Optional: 'Cursor' }, c: { Optional: 'Cursor' }, text: { Text: { max: 200 } } };
    const metadata = { generation, programGeneration: generation, channels: {}, auth: {}, ops: {
      composite: { kind: 'query', planHash, args, cursor: 'c', drain: { reason: 'cursor-binding' } },
    } };
    const request = { a: 'h1.auxiliary', c: 'h1.selected', text: 'h1.ordinary text' };
    runtime.manifest(metadata);
    assert.equal(runtime.declaredCursorArg('composite'), 'c');
    assert.deepEqual(runtime.serverArguments('composite', request), { a: null, c: null, text: request.text });
    runtime.manifest({ ...metadata, ops: { composite: { ...metadata.ops.composite, cursor: null } } });
    assert.equal(runtime.declaredCursorArg('composite'), undefined);
    assert.deepEqual(runtime.serverArguments('composite', request), { a: null, c: null, text: request.text });
    const packet = certifiedDrainProgram();
    Object.assign(packet.programs[certifiedDrain.op], { cursor: 'c' });
    await runtime.program(packet);
    await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open('dev:alice');
    const stored = (await runtime.store.outbox.programs())[packet.generation];
    assert.equal(stored.programs[certifiedDrain.op].cursor, 'c');
    assert.equal(runtime.declaredCursorArg(certifiedDrain.op), 'c');
    assert.deepEqual(runtime.serverArguments(certifiedDrain.op, { c: request.c }), { c: null });
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('conditional public query states preserve denial/partial shape and complete/capped cursors warm and cold', async context => {
  for (const state of ['denied', 'partial', 'complete', 'capped']) for (const cold of [false, true])
    await context.test(`${state}/${cold}`, async () => {
      const root = await tempRoot(); await seededResumeStore(root);
      const full = { ...envelope(state === 'denied' ? null : ['held']), state,
        next: state === 'capped' ? 'server-page' : null,
        ...(state === 'denied' ? { rule: 'MEMBERSHIP_REQUIRED' } : state === 'partial' ? { reason: 'missing-authority' } : {}) };
      const factory = fileRangeStore(root);
      const options = { url: 'http://conditional-state.test', persona: 'alice', offline: { store: factory },
        fetch: async (input: any, init: any) => {
          const metadata = metadataResponse(input); if (metadata) return metadata;
          if (String(input).endsWith('/api/resume')) return Response.json({ seq: 3, generation, schemaHash,
            authority: full.authority, log: { unchanged: true }, mounted: [] });
          const request = JSON.parse(String(init.body));
          return Response.json(request.validator ? { state: 'unchanged', seq: 4, validator: full.validator } : full);
        } };
      let client = createClient(options);
      try {
        await client.ready;
        const first = await client.query(api.example.read as any, {});
        if (cold) { await client.close(); client = createClient(options); await client.ready; }
        const second = await client.query(api.example.read as any, {});
        assert.deepEqual(second, { ...first, seq: 4 });
        if (state === 'denied' || state === 'partial') assert(!Object.hasOwn(second, 'next'));
        else assert.equal(second.next, full.next);
        if (state === 'denied') assert(!Object.hasOwn(second, 'data'));
        await client.close();
        const store = factory(); await store.open('dev:alice');
        assert.equal((await store.answer('example.read', {})).next, full.next, 'private receipt custody keeps its original next');
        await store.close();
      } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
    });
  const client = createClient({ url: 'http://strict-denied.test', persona: 'alice',
    fetch: async () => Response.json({ state: 'denied', rule: 'NO', seq: 1, next: null }) });
  try { await assertRefused(client.query(api.example.read as any, {}), /must not carry next/); }
  finally { await client.close(); }
});

test('held public query states omit denied payload and nonpage cursors through offline entrypoints', async context => {
  // Synthetic protocol frames enter the real Client decoder/runtime; no native emission claim.
  for (const state of ['denied', 'partial', 'complete', 'capped']) for (const mode of ['forced', 'hydrating', 'retry'])
    await context.test(`${state}/${mode}`, async () => {
      const root = await tempRoot(); await seededResumeStore(root);
      const full = { ...envelope(['private wire payload']), state, next: state === 'complete' ? null : 'server-page',
        ...(state === 'denied' ? { rule: 'NO' } : state === 'partial' ? { reason: 'missing-authority' } : {}) };
      const factory = fileRangeStore(root); let fail = false, requests = 0, unblock!: () => void;
      const waiting = new Promise<void>(resolve => { unblock = resolve; });
      const fetch = async (input: any) => {
        const metadata = metadataResponse(input); if (metadata) return metadata;
        if (String(input).endsWith('/api/auth/me')) { await waiting; return Response.json({ viewer: 'dev:alice', kind: 'user', authEpoch: 7 }); }
        if (String(input).endsWith('/api/resume')) return Response.json({ seq: 3, generation, schemaHash,
          authority: full.authority, log: { unchanged: true }, mounted: [] });
        requests++; if (fail) throw new TypeError('offline transport');
        return Response.json(full);
      };
      let client = createClient({ url: 'http://held-state.test', persona: 'alice', offline: { store: factory }, fetch });
      let sub: ReturnType<typeof subscribe> | undefined;
      try {
        await client.ready; await client.query(api.example.read as any, {});
        if (mode === 'forced') await client.offline();
        if (mode === 'retry') { fail = true; requests = 0; }
        if (mode === 'hydrating') {
          await client.close(); client = createClient({ url: 'http://held-state.test', offline: { store: factory }, fetch,
            tokenStore: { load: () => 'held-token', save: () => {}, loadPrincipalBinding: () => ({ token: 'held-token', principal: 'dev:alice' }) } });
        }
        const result = await client.query(api.example.read as any, {});
        if (mode === 'hydrating') assert.equal(client.snapshot.auth.state, 'hydrating');
        if (mode === 'retry') assert.equal(requests, 3);
        const check = (answer: any) => {
          assert.equal(answer.state, state); assert.equal(answer.connection, 'offline'); assert.equal(answer.live, false);
          assert.equal(Object.hasOwn(answer, 'next'), state === 'complete' || state === 'capped');
          if (state === 'complete' || state === 'capped') assert.equal(answer.next, full.next);
          assert.equal(Object.hasOwn(answer, 'data'), state !== 'denied');
          if (state !== 'denied') assert.deepEqual(answer.data, full.data);
        };
        check(result);
        if (mode === 'forced') {
          let delivered!: (answer: any) => void; const update = new Promise<any>(resolve => { delivered = resolve; });
          sub = subscribe(client, api.example.read as any, {}, answer => { if (answer.state === state) delivered(answer); });
          check(await update); sub.close();
        }
        unblock(); await client.close();
        const inspect = factory(); await inspect.open('dev:alice');
        const held = await inspect.answer('example.read', {});
        assert.equal(held.next, full.next, 'private next custody survives projection');
        assert.deepEqual(held.data, full.data, 'public omission does not rewrite retained protocol data');
        await inspect.close();
      } finally { sub?.close(); unblock(); await client.close(); await rm(root, { recursive: true, force: true }); }
    });
});

test('resume rejects equivocation with the same typed refusal exposed by query and snapshot', async () => {
  const root = await tempRoot(); await seededResumeStore(root);
  let resumes = 0, conflicting = false;
  const disk = fileRangeStore(root), full = envelope(['before']); let active: any;
  const factory = () => active = disk();
  const pending = { intent: 'keep', ids: [], op: 'send', args: { body: 'pending' }, state: 'queued', createdAt: 1, updatedAt: 1 };
  const client = createClient({ url: 'http://typed-resume.test', persona: 'alice', offline: { store: factory },
    fetch: async (input, init) => {
      const metadata = metadataResponse(input); if (metadata) return metadata;
      const bad = envelope(['equivocation'], '2'.repeat(64));
      if (String(input).endsWith('/api/resume')) return Response.json({ seq: 3, generation, schemaHash,
        authority: full.authority, log: { unchanged: true }, mounted: ++resumes === 1 ? [] : [bad] });
      if (init?.body) return Response.json(conflicting ? bad : full);
      return sse(undefined, true);
    } });
  try {
    await client.ready; await client.query(api.messages.body as any, {});
    const sub = subscribe(client, api.messages.body as any, {}, () => undefined);
    await new Promise(resolve => setTimeout(resolve, 5)); await client.offline();
    await active.outbox.put(pending);
    let refusal: any;
    await assert.rejects(client.online(), error => { refusal = error; return isRefusalError(error) && error.code === 'E_OFFLINE_DELIVERY'; });
    assert.deepEqual(client.snapshot.lastRefusal, refusal.envelope);
    conflicting = true;
    await assertRefused(client.query(api.messages.body as any, {}), error => (error.state === "rejected" || error.state === "refused") && error.code === refusal.code);
    await client.offline(); assert.deepEqual((await client.query(api.messages.body as any, {})).data, ['before']);
    sub.close();
  } finally {
    await client.close(); const inspect = factory(); await inspect.open('dev:alice');
    assert.deepEqual((await inspect.outbox.all()).map(({ order, ...entry }) => entry),[pending]);
    await inspect.close(); await rm(root, { recursive: true, force: true });
  }
});

test('aborting an in-flight resume preserves AbortError without publishing a delivery refusal', async () => {
  const root = await tempRoot(); await seededResumeStore(root);
  let resumes = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const client = createClient({ url: 'http://abort-resume.test', persona: 'alice', offline: { store: fileRangeStore(root) },
    fetch: async (input,init) => {
      const metadata = metadataResponse(input); if (metadata) return metadata;
      if (String(input).endsWith('/api/resume')) {
        if (++resumes > 1) {
          release(); return new Promise<Response>((_,reject) => {
            const abort = () => reject(new DOMException('cancelled','AbortError'));
            if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort',abort,{ once: true });
          });
        }
        return Response.json({ seq: 3,generation,schemaHash,authority: envelope([]).authority,log: { unchanged: true },mounted: [] });
      }
      return sse(undefined,true);
    } });
  try {
    await client.ready; await client.offline();
    const resumed = client.online(); const rejection = assert.rejects(resumed,error => error.name === 'AbortError' && !(isRefusalError(error)));
    await waiting; await client.offline(); await rejection;
    assert.equal(client.snapshot.lastRefusal,undefined);
    assert.equal((await client.query(api.messages.inbox as any,{ c: null })).state,'complete');
  } finally { await client.close(); await rm(root,{ recursive: true,force: true }); }
});
