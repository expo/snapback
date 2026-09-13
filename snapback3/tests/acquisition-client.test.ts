import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createClient, createMemoryStorage, pages, type ClientStorage, type Op, type SnapbackClient, type Session } from '../packages/snapback3/src/client.js';
import type { DeliveryEnvelopeV1 } from '../packages/snapback3/src/resource/protocol.js';
import { validateManifest } from '../packages/snapback3/src/resource/facts.js';
import { deferred } from '../packages/snapback3/src/resource/signal.js';
import type { Manifest } from '../packages/snapback3/src/resource/types.js';
import { canonicalJson, schemaDigest, wireJson } from '../packages/evaluator/src/value-runtime.js';
import { sha256 } from '../packages/evaluator/src/hash.js';
import { canonicalProgramJson } from '../packages/evaluator/src/certificate-identity.js';
import { declarationIdentity, envelopeFromStored, resolveChain, resourceVersionKey, restoreAcquiredPool,
  storedResource } from '../packages/snapback3/src/resource/acquisition.js';

const load = (name: string): any => JSON.parse(readFileSync(new URL(`../corpus/${name}.json`, import.meta.url), 'utf8'));
const rangePages = [1, 2, 3].map(number => load(`conditional-range-page-${number}`));
const mergePages = [1, 2, 3].map(number => load(`conditional-merge-page-${number}`));
const source = rangePages[0]!;
const mutationIr = { name: 'feed.reject', kind: 'Mutation', args: {}, read_time_granularity_ms: null,
  body: [{ Return: { Literal: 'Null' } }] };
const mutationPlanHash = sha256(canonicalProgramJson(mutationIr as any));
const mutationCertificate = { ...structuredClone(source.certificate), program: mutationIr.name, plan_hash: mutationPlanHash,
  read_sites: [], merge_sites: [], result_pages: {}, write_sites: [], completeness: 'Complete', max_examined: 0,
  max_index_entries: 0, max_rule_probes: 0, max_steps: 10, derived_steps: 0, derived_scratch_bytes: 0,
  max_heap_bytes: 1024, max_output_bytes: 32, max_closure_bytes: 32, halo_rows: 0, indexes_required: [], cost_terms: [] };
const manifest: Manifest = validateManifest({ generation: sha256('acquisition-generation'), schemaHash: schemaDigest(source.schema),
  schema: source.schema, programs: { [source.program.name]: { kind: 'query', ir: source.program,
    certificate: source.certificate, planHash: source.certificate.plan_hash }, [mutationIr.name]: { kind: 'mutation', ir: mutationIr,
    certificate: mutationCertificate, planHash: mutationPlanHash } }, seq: 5 } as any);
const session = (): Session => ({ token: 'token-alice', principal: { id: 'alice', kind: 'user' }, authEpoch: 1,
  expiresAt: Date.now() + 3_600_000 });
declare const singletonPage: Op<{ c: string | null }, { id: string }>;
if (false) {
  // @ts-expect-error Typed acquisition pages must return a list; ordinary singleton queries remain supported by query/watch.
  pages(singletonPage, { c: null });
}
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json' } });

function envelope(fixture: any, seq: number, override: Partial<DeliveryEnvelopeV1> = {}, ownerManifest = manifest): DeliveryEnvelopeV1 {
  const value = (input: any): any => input === null ? null : wireJson(input);
  const rows = fixture.receipt.rows.map((row: any) => ({ table: row.table, id: row.id, row: wireJson(row.row) }));
  const ranges = fixture.receipt.ranges.map((range: any) => ({ site: range.site, table: range.table, index: range.index,
    prefix: range.prefix.map((item: any) => ({ Scalar: wireJson(item.Scalar) })), order: range.order, take: range.take,
    after: value(range.after), before: value(range.before), gt: value(range.gt), gte: value(range.gte),
    lt: value(range.lt), lte: value(range.lte), ruleHash: range.rule_hash, rowIds: range.row_ids,
    stop: range.stop, absence: range.absence, ...(range.halo ? { haloId: range.halo.id } : {}) }));
  const data = wireJson(fixture.expected.localResult);
  return { protocol: 1, generation: ownerManifest.generation, schemaHash: ownerManifest.schemaHash,
    planHash: ownerManifest.programs[fixture.program.name]!.planHash, authority: { principal: 'alice', authEpoch: 1 },
    state: 'complete', data, next: fixture.expected.next, seq, rows,
    receipt: { ranges, absences: [], verdicts: [] }, validator: sha256(canonicalJson([fixture.context.args, data])), ...override };
}

class AcquisitionHarness {
  seq = 5;
  generation = manifest.generation;
  network = true;
  unauthorized = false;
  deny = false;
  denyGlobal?: boolean;
  capped = false;
  connectedPage = false;
  terminalState: 'committed' | 'rejected' | 'conflict' = 'committed';
  failAcquireAtCall?: number;
  pagesPerRequest = Number.POSITIVE_INFINITY;
  advanceAfterCall?: number;
  rootEmptyAtSeq?: number;
  readonly calls: any[] = [];
  fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!this.network) throw new TypeError('network disconnected');
    const path = new URL(String(input)).pathname, body = init.body ? JSON.parse(String(init.body)) : {};
    if (path === '/api/manifest') return json({ ...manifest, generation: this.generation, seq: this.seq });
    if (path === '/api/auth/persona') return json(session());
    if (path === '/api/auth/logout') return json({ ok: true });
    if (path.startsWith('/api/operation/')) return json(null);
    if (path === '/api/mutation') return json({ state: this.terminalState, intent: body.intent, seq: ++this.seq,
      ...(this.terminalState === 'committed' ? { data: null } : { code: 'DECLINED', message: 'The owner declined this change.' }) });
    if (path === '/api/read') {
      const resources = body.queries.map((query: any) => {
        const fixtures = query.args.global ? rangePages : mergePages;
        const fixture = fixtures.find(item => wireJson(item.context.args.c) === query.args.c)!;
        let message = envelope(fixture, this.seq);
        if (query.args.global && this.rootEmptyAtSeq !== undefined && this.seq >= this.rootEmptyAtSeq)
          message = { ...message, data: [], validator: sha256(canonicalJson([fixture.context.args, 'empty-root'])) };
        return { key: query.key, envelope: { ...message, generation: this.generation } };
      });
      return json({ generation: this.generation, seq: this.seq, resources });
    }
    if (path === '/api/acquire') {
      this.calls.push(body);
      if (this.calls.length === this.failAcquireAtCall) throw new TypeError('network disconnected');
      if (this.unauthorized) return json({ error: { code: 'S3_AUTH', message: 'session revoked' } }, 401);
      if (body.expectedSeq !== undefined && body.expectedSeq !== this.seq)
        return json({ error: { code: 'S3_SEQUENCE_CHANGED', message: 'sequence changed' } }, 409);
      const delivered: any[] = [];
      const continuations: any[] = [];
      for (const chain of body.chains) {
        const denied = this.deny || this.denyGlobal === chain.args.global;
        const fixtures = chain.args.global ? rangePages : mergePages;
        const index = fixtures.findIndex(item => wireJson(item.context.args.c) === chain.args.c);
        if (index < 0) return json({ error: { code: 'S3_ARGS', message: 'unknown cursor' } }, 400);
        const available = chain.follow === false ? fixtures.slice(index, index + 1) : fixtures.slice(index);
        const selected = available.slice(0, this.pagesPerRequest);
        for (const fixture of selected) {
          let message = envelope(fixture, this.seq);
          if (chain.args.global && this.rootEmptyAtSeq !== undefined && this.seq >= this.rootEmptyAtSeq) {
            message = { ...message, data: [], validator: sha256(canonicalJson([fixture.context.args, 'empty-root'])) };
          }
          if (denied) message = envelope(fixture, this.seq, { state: 'denied', rule: 'NOT_MEMBER', data: null,
            next: null, rows: [], receipt: { ranges: [], absences: [], verdicts: [] },
            validator: sha256(canonicalJson([fixture.context.args, 'denied'])) });
          if (this.capped) message = envelope(fixture, this.seq, { state: 'capped', next: null });
          if (this.connectedPage) message = envelope(fixture, this.seq, { connected: true });
          message = { ...message, generation: this.generation };
          if (chain.follow === false && chain.validator === message.validator)
            delivered.push({ key: chain.key, op: chain.op, args: { ...chain.args, c: wireJson(fixture.context.args.c) },
              message: { state: 'unchanged', seq: this.seq, validator: message.validator } });
          else delivered.push({ key: chain.key, op: chain.op, args: { ...chain.args, c: wireJson(fixture.context.args.c) }, message });
          if (denied || this.capped) break;
        }
        if (!denied && !this.capped && chain.follow && selected.length < available.length) {
          continuations.push({ ...chain, args: { ...chain.args, c: selected.at(-1)!.expected.next }, follow: true });
        }
      }
      const result = json({ generation: this.generation, seq: this.seq, pages: delivered, continuations,
        more: continuations.length > 0 });
      if (this.calls.length === this.advanceAfterCall) this.seq++;
      return result;
    }
    return json({ error: { code: 'S3_NOT_FOUND', message: path } }, 404);
  }) as typeof fetch;
  client(storage: ClientStorage): SnapbackClient {
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: this.fetch, live: false });
    clients.push(client); return client;
  }
}

const clients: SnapbackClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });
const root = () => pages('feed.conditional', { c: null, global: true }, { key: 'rooms', cursor: 'c' });
const spec = () => ({ id: 'history', revision: 'v1', root: root(),
  expand: (items: unknown[]) => items.length ? [pages('feed.conditional', { c: null, global: false },
    { key: 'messages', cursor: 'c' })] : [] });
async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('condition did not become true');
}

function delayedAcquisition(harness: AcquisitionHarness, target = 1): {
  fetch: typeof fetch; reached: Promise<void>; release(): void;
} {
  let calls = 0, reachedResolve!: () => void, releaseResolve!: () => void;
  const reached = new Promise<void>(resolve => { reachedResolve = resolve; });
  const released = new Promise<void>(resolve => { releaseResolve = resolve; });
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const response = await harness.fetch(input, init);
    if (new URL(String(input)).pathname === '/api/acquire' && ++calls === target) {
      reachedResolve(); await released;
    }
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, reached, release: releaseResolve };
}

describe('SDK-owned dataset acquisition', () => {
  test('persists one coherent fresh traversal without redundant normalization and serves exact pages after offline reopen', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice');
    const completed = await first.acquire(spec()).completed;
    expect(completed).toMatchObject({ status: 'ready', pages: 6, chains: 2, seq: 5 });
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls.every(call => call.chains.every((chain: any) => chain.follow === true && chain.validator === undefined))).toBe(true);
    const stored = await storage.load();
    expect(stored.acquisitions?.[0]).toMatchObject({ status: 'ready', pages: 6, seq: 5 });
    expect(stored.acquisitionRows!.length).toBeLessThan(100);
    first.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    const secondPage = await reopened.query<any[]>('feed.conditional', {
      c: wireJson(rangePages[1].context.args.c), global: true,
    });
    expect(secondPage).toEqual(wireJson(rangePages[1].expected.localResult));
  });

  test('a known later sequence durably suspends an old dataset before offline process reopen', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice'); await first.acquire(spec()).completed;
    harness.seq = 6; await first.reconnect(); first.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: false })).rejects.toThrow('not available');
    expect((await storage.load()).acquisitions?.[0]?.status).toBe('acquiring');
  });

  test('a changed revision restarts from root instead of reusing a checkpoint made by another declaration', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const previous = client.acquire(spec()); await previous.completed;
    const before = harness.calls.length;
    const replacement = client.acquire({ ...spec(), revision: 'v2' });
    expect(replacement).not.toBe(previous);
    expect(previous.getSnapshot().status).toBe('sealed');
    await replacement.completed;
    expect(harness.calls[before].chains).toEqual([{ key: 'rooms', op: 'feed.conditional',
      args: { c: null, global: true }, cursor: 'c', follow: true }]);
  });

  test('an offline changed declaration withdraws only its old scope before a physical reopen', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    await client.acquire({ ...spec(), id: 'root-only', expand: () => [] }).completed;
    await client.acquire(spec()).completed;
    const heldRemoved = client.watch('feed.conditional', { c: null, global: false });
    expect(heldRemoved.getSnapshot().data).toBeDefined();
    client.setOnline(false);
    const replacement = client.acquire({ ...spec(), revision: 'v2', expand: () => [] });
    const completion = replacement.completed;
    expect(heldRemoved.getSnapshot().data).toBeUndefined();
    expect(client.watch('feed.conditional', { c: wireJson(mergePages[1].context.args.c), global: false })
      .getSnapshot().data).toBeUndefined();
    await eventually(() => replacement.getSnapshot().status === 'error');
    replacement.cancel();
    await expect(completion).rejects.toThrow('cancelled');
    expect(client.watch('feed.conditional', { c: null, global: false }).getSnapshot().data).toBeUndefined();
    expect(client.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeDefined();
    const changed = (await storage.load()).acquisitions!;
    expect(changed.find(item => item.id === 'history')).toMatchObject({ status: 'acquiring', resourceKeys: [] });
    expect(changed.find(item => item.id === 'root-only')?.status).toBe('ready');
    client.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: false })).rejects.toThrow('not available');
    await expect(reopened.query('feed.conditional', { c: null, global: true })).resolves.toBeDefined();
  });

  test('cancelling a ready dataset withdraws held and newly requested RAM values until explicit resume', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const held = client.watch('feed.conditional', { c: null, global: false });
    expect(held.getSnapshot().data).toBeDefined();
    client.setOnline(false); acquisition.cancel();
    await expect(acquisition.completed).rejects.toMatchObject({ code: 'S3_ACQUISITION_CANCELLED' });
    await eventually(async () => (await storage.load()).acquisitions?.[0]?.status === 'cancelled');
    expect(held.getSnapshot().data).toBeUndefined();
    expect(client.watch('feed.conditional', { c: wireJson(mergePages[1].context.args.c), global: false })
      .getSnapshot().data).toBeUndefined();
    await expect(client.query('feed.conditional', { c: null, global: false })).rejects.toThrow('not available');
    client.setOnline(true);
    await expect(acquisition.resume()).resolves.toMatchObject({ status: 'ready', seq: 5 });
    expect(held.getSnapshot().data).toBeDefined();
  });

  test('acquisition registration owns mutable declaration identity, root arguments, and expand reference', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const rootArgs: any = { c: null, global: true };
    const originalRoot: any = { key: 'rooms', op: 'feed.conditional', args: rootArgs, cursor: 'c' };
    const originalExpand = (items: unknown[]) => items.length ? [pages('feed.conditional', { c: null, global: false },
      { key: 'messages', cursor: 'c' })] : [];
    const declaration: any = { id: 'history', revision: 'v1', root: originalRoot, expand: originalExpand };
    const original = client.acquire(declaration);
    declaration.id = 'sibling'; declaration.revision = 'mutated';
    declaration.root = pages('feed.conditional', { c: null, global: false }, { key: 'replacement-root', cursor: 'c' });
    declaration.expand = () => []; rootArgs.global = false;
    await expect(original.completed).resolves.toMatchObject({ id: 'history', chains: 2, pages: 6 });
    expect(harness.calls[0]!.chains[0]).toMatchObject({ key: 'rooms', args: { c: null, global: true } });
    const expectedHash = declarationIdentity('history', 'v1', resolveChain(manifest,
      pages('feed.conditional', { c: null, global: true }, { key: 'rooms', cursor: 'c' })));
    expect((await storage.load()).acquisitions?.find(item => item.id === 'history')?.declarationHash).toBe(expectedHash);

    const sibling = client.acquire({ id: 'sibling', revision: 'v1',
      root: pages('feed.conditional', { c: null, global: false }, { key: 'sibling-root', cursor: 'c' }), expand: () => [] });
    await sibling.completed;
    const heldOriginal = client.watch('feed.conditional', { c: null, global: true });
    const heldSibling = client.watch('feed.conditional', { c: null, global: false });
    expect(heldOriginal.getSnapshot().data).toBeDefined(); expect(heldSibling.getSnapshot().data).toBeDefined();
    client.setOnline(false); original.cancel();
    await expect(original.completed).rejects.toMatchObject({ code: 'S3_ACQUISITION_CANCELLED' });
    await eventually(async () => (await storage.load()).acquisitions?.find(item => item.id === 'history')?.status === 'cancelled');
    expect(heldOriginal.getSnapshot().data).toBeUndefined(); expect(heldSibling.getSnapshot().data).toBeDefined();
    expect((await storage.load()).acquisitions?.find(item => item.id === 'sibling')?.status).toBe('ready');
  });

  test('failed ready cancellation cleanup blocks immediate same-adapter restore of its old checkpoint', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let fail = true;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (fail && patch.cancelAcquisition) {
        fail = false; started.resolve(); await release.promise; throw new Error('cancellation disk full');
      }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    expect(client.watch('feed.conditional', { c: null, global: false }).getSnapshot().data).toBeDefined();
    acquisition.cancel(); const cancelled = acquisition.completed.catch(error => error); await started.promise;
    client.close(); harness.network = false;
    const reopened = harness.client(storage); let restored = false;
    void reopened.ready.then(() => { restored = true; });
    await new Promise(resolve => setTimeout(resolve, 5)); expect(restored).toBe(false);
    release.resolve(); expect((await cancelled).code).toBe('S3_ACQUISITION_CANCELLED');
    await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: false })).rejects.toMatchObject({ code: 'S3_AUTH' });
  });

  test('failed declaration retirement cannot revive its removed scope on immediate reopen', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let fail = true;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (fail && patch.cancelAcquisition) {
        fail = false; started.resolve(); await release.promise; throw new Error('retirement disk full');
      }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice'); await client.acquire(spec()).completed;
    const removed = client.watch('feed.conditional', { c: null, global: false });
    expect(removed.getSnapshot().data).toBeDefined();
    const replacement = client.acquire({ ...spec(), revision: 'v2', expand: () => [] });
    void replacement.completed.catch(() => {}); await started.promise;
    expect(removed.getSnapshot().data).toBeUndefined();
    client.close(); harness.network = false;
    const reopened = harness.client(storage); let restored = false;
    void reopened.ready.then(() => { restored = true; });
    await new Promise(resolve => setTimeout(resolve, 5)); expect(restored).toBe(false);
    release.resolve(); await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: false })).rejects.toMatchObject({ code: 'S3_AUTH' });
  });

  test('a delayed old cancellation cannot cancel a successor declaration with the same id', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let block = false;
    const storage: ClientStorage = {
      load: memory.load,
      async write(patch) {
        if (block && patch.cancelAcquisition) {
          block = false; started.resolve(); await release.promise; throw new Error('old cancellation failed');
        }
        await memory.write(patch);
      },
      subscribe: listener => memory.subscribe!(listener),
    };
    const client = harness.client(storage); await client.auth.persona('alice');
    const v1 = client.acquire(spec()); await v1.completed;
    block = true; v1.cancel(); const cancelled = v1.completed.catch(error => error); await started.promise;
    const successorStorage: ClientStorage = { load: memory.load, write: memory.write,
      subscribe: listener => memory.subscribe!(listener) };
    const successor = harness.client(successorStorage); await successor.ready;
    const v2 = successor.acquire({ ...spec(), revision: 'v2' });
    await v2.completed;
    const held = successor.watch('feed.conditional', { c: null, global: true });
    expect(held.getSnapshot().data).toBeDefined();
    expect((await memory.load()).acquisitions?.[0]).toMatchObject({ status: 'ready', declarationHash: expect.any(String) });
    release.resolve(); expect((await cancelled).code).toBe('S3_ACQUISITION_CANCELLED');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await memory.load()).acquisitions?.[0]?.status).toBe('ready');
    expect(v2.getSnapshot().status).toBe('ready'); expect(held.getSnapshot().data).toBeDefined();
  });

  test('a delayed old cancellation cannot cancel another account checkpoint with the same id', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let block = false;
    const storage: ClientStorage = {
      load: memory.load,
      async write(patch) {
        if (block && patch.cancelAcquisition) {
          block = false; started.resolve(); await release.promise; throw new Error('old cancellation failed');
        }
        await memory.write(patch);
      },
    };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const alice = await memory.load(), checkpoint = alice.acquisitions![0]!;
    block = true; acquisition.cancel(); const cancelled = acquisition.completed.catch(error => error); await started.promise;
    const bob = { ...session(), token: 'token-bob', principal: { id: 'bob', kind: 'user' as const }, authEpoch: 2 };
    await memory.write({ session: bob });
    await memory.write({ acquisition: { acquisition: { ...checkpoint, principal: 'bob', authEpoch: 2, status: 'ready' },
      rows: alice.acquisitionRows!, resources: alice.acquisitionResources! } });
    release.resolve(); expect((await cancelled).code).toBe('S3_ACQUISITION_CANCELLED');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await memory.load()).acquisitions?.[0]).toMatchObject({ principal: 'bob', authEpoch: 2, status: 'ready' });
  });

  test('a delayed old cancellation cannot cancel a same-principal checkpoint under a newer token', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let block = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (block && patch.cancelAcquisition) { block = false; started.resolve(); await release.promise; }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const old = await memory.load(), checkpoint = old.acquisitions![0]!;
    block = true; acquisition.cancel(); const cancelled = acquisition.completed.catch(error => error); await started.promise;
    await memory.write({ session: { ...session(), token: 'token-alice-new' } });
    await memory.write({ acquisition: { acquisition: checkpoint, rows: old.acquisitionRows!, resources: old.acquisitionResources! } });
    release.resolve(); expect((await cancelled).code).toBe('S3_ACQUISITION_CANCELLED');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await memory.load()).acquisitions?.[0]).toMatchObject({ status: 'ready' });
  });

  test('a commit between chunks revalidates the durable prefix instead of borrowing old membership', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    harness.pagesPerRequest = 1; harness.advanceAfterCall = 1;
    await client.auth.persona('alice');
    const completed = await client.acquire(spec()).completed;
    expect(completed).toMatchObject({ status: 'ready', pages: 6, seq: 6 });
    expect(harness.calls.some(call => call.expectedSeq === 5)).toBe(true);
    expect(harness.calls.some(call => call.expectedSeq === 6)).toBe(true);
    expect(harness.calls.some(call => call.chains.some((chain: any) => chain.follow === false))).toBe(true);
  });

  test('a durable prefix validates after process reopen instead of using the fresh traversal shortcut', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), first = harness.client(storage);
    harness.pagesPerRequest = 1; harness.failAcquireAtCall = 2;
    await first.auth.persona('alice');
    const interrupted = first.acquire(spec());
    await eventually(() => interrupted.getSnapshot().status === 'error');
    first.close(); harness.failAcquireAtCall = undefined;
    const before = harness.calls.length, reopened = harness.client(storage); await reopened.ready;
    await reopened.acquire(spec()).completed;
    expect(harness.calls.slice(before).some(call => call.chains.some((chain: any) => chain.follow === false))).toBe(true);
  });

  test('a retryable failure keeps completed pending and automatically resumes on same-sequence reconnect', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    harness.pagesPerRequest = 1; harness.failAcquireAtCall = 2;
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()), completion = acquisition.completed;
    let settled = false; void completion.then(() => { settled = true; }, () => { settled = true; });
    await eventually(() => acquisition.getSnapshot().status === 'error');
    expect(settled).toBe(false);
    harness.failAcquireAtCall = undefined;
    await client.reconnect();
    await expect(completion).resolves.toMatchObject({ status: 'ready', seq: 5 });
    expect(acquisition.completed).toBe(completion);
  });

  test('cancel rejects current awaiters and a delayed reply cannot publish', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), delayed = delayedAcquisition(harness);
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: delayed.fetch, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()), completion = acquisition.completed;
    await delayed.reached; acquisition.cancel();
    await expect(completion).rejects.toMatchObject({ code: 'S3_ACQUISITION_CANCELLED' });
    delayed.release(); await new Promise(resolve => setTimeout(resolve, 5));
    expect(acquisition.getSnapshot().status).toBe('cancelled');
    await eventually(async () => (await storage.load()).acquisitions?.[0]?.status === 'cancelled');
  });

  test('resume after cancel returns a new completion cycle and continues durable progress', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), delayed = delayedAcquisition(harness);
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: delayed.fetch, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()), cancelled = acquisition.completed;
    await delayed.reached; acquisition.cancel();
    await expect(cancelled).rejects.toMatchObject({ code: 'S3_ACQUISITION_CANCELLED' });
    delayed.release();
    const resumed = acquisition.resume();
    expect(resumed).toBe(acquisition.completed); expect(resumed).not.toBe(cancelled);
    await expect(resumed).resolves.toMatchObject({ status: 'ready', seq: 5 });
  });

  test('resume after a terminal acquisition error creates a new cycle', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); harness.capped = true;
    const acquisition = client.acquire(spec()), failed = acquisition.completed;
    await expect(failed).rejects.toThrow('without complete evidence');
    harness.capped = false;
    const resumed = acquisition.resume();
    expect(resumed).toBe(acquisition.completed); expect(resumed).not.toBe(failed);
    await expect(resumed).resolves.toMatchObject({ status: 'ready', seq: 5 });
  });

  test('repeated public resume while acquiring joins the current cycle without another run', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), delayed = delayedAcquisition(harness);
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: delayed.fetch, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()), completion = acquisition.completed;
    await delayed.reached;
    expect(acquisition.resume()).toBe(completion); expect(acquisition.resume()).toBe(completion);
    expect(harness.calls).toHaveLength(1);
    delayed.release(); await expect(completion).resolves.toMatchObject({ status: 'ready' });
  });

  test('a sealed acquisition remains permanently rejected and cannot resume', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); harness.deny = true;
    const acquisition = client.acquire(spec()); await expect(acquisition.completed).rejects.toThrow('no longer authorized');
    const calls = harness.calls.length, sealed = acquisition.completed;
    expect(acquisition.resume()).toBe(sealed);
    await expect(sealed).rejects.toThrow('no longer authorized');
    expect(harness.calls).toHaveLength(calls);
  });

  test('changed root membership recomputes derived chains and excludes their old physical pages', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); await client.acquire(spec()).completed;
    harness.rootEmptyAtSeq = 6; harness.seq = 6; await client.reconnect();
    await eventually(async () => (await storage.load()).acquisitions?.[0]?.status === 'ready'
      && (await storage.load()).acquisitions?.[0]?.seq === 6);
    client.setOnline(false);
    await expect(client.query('feed.conditional', { c: null, global: false })).rejects.toThrow('not available');
    const stored = await storage.load();
    expect(stored.acquisitions?.[0]?.resourceKeys).toHaveLength(3);
    expect(stored.acquisitionResources?.some(item => item.args.global === false)).toBe(true);
  });

  test('failed durable progress exposes no acquired data', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.acquisition) throw new Error('quota reached');
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    await expect(client.acquire(spec()).completed).rejects.toThrow('quota reached');
    client.setOnline(false);
    await expect(client.query('feed.conditional', { c: null, global: true })).rejects.toThrow('not available');
  });

  test('denial seals the dataset and withdraws its durable checkpoint', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); harness.deny = true;
    const acquisition = client.acquire(spec());
    await expect(acquisition.completed).rejects.toThrow('no longer authorized');
    expect(acquisition.getSnapshot().status).toBe('sealed');
    expect((await storage.load()).acquisitions?.[0]).toMatchObject({ status: 'cancelled', resourceKeys: [] });
  });

  test('denial withdraws only its dataset and preserves a sibling through offline reopen', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const kept = client.acquire({ id: 'kept', revision: 'v1', root: pages('feed.conditional', { c: null, global: true },
      { key: 'kept-root', cursor: 'c' }), expand: () => [] });
    await kept.completed;
    const denied = client.acquire({ id: 'denied', revision: 'v1', root: pages('feed.conditional', { c: null, global: false },
      { key: 'denied-root', cursor: 'c' }), expand: () => [] });
    await denied.completed;
    const deniedResource = client.watch('feed.conditional', { c: null, global: false });
    expect(deniedResource.getSnapshot().data).toBeDefined();
    harness.denyGlobal = false; harness.seq = 6; await client.reconnect();
    await eventually(() => denied.getSnapshot().status === 'sealed' && kept.getSnapshot().status === 'ready');
    expect(deniedResource.getSnapshot().data).toBeUndefined();
    expect(kept.getSnapshot().status).toBe('ready');
    const checkpoints = (await storage.load()).acquisitions!;
    expect(checkpoints.find(item => item.id === 'kept')?.status).toBe('ready');
    expect(checkpoints.find(item => item.id === 'denied')).toMatchObject({ status: 'cancelled', resourceKeys: [] });
    client.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: true })).resolves.toBeDefined();
  });

  test('account logout seals handles and redacts acquired values immediately', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    await client.auth.logout();
    expect(acquisition.getSnapshot().status).toBe('sealed');
    expect(client.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('a delayed old-account response cannot republish or persist acquisition data', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage();
    let reachedResolve!: () => void, releaseResolve!: () => void;
    const reached = new Promise<void>(resolve => { reachedResolve = resolve; });
    const release = new Promise<void>(resolve => { releaseResolve = resolve; });
    const delayed = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (new URL(String(input)).pathname === '/api/acquire') { reachedResolve(); await release; }
      return harness.fetch(input, init);
    }) as typeof fetch;
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: delayed, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await reached;
    await client.auth.logout(); releaseResolve();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(acquisition.getSnapshot().status).toBe('sealed');
    const stored = await storage.load();
    expect(stored.acquisitions).toEqual([]);
    expect(stored.acquisitionRows).toEqual([]);
    expect(stored.acquisitionResources).toEqual([]);
  });

  test('a shared-storage floor advance rejects a delayed old checkpoint before RAM publication', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage();
    let reachedResolve!: () => void, releaseResolve!: () => void;
    const reached = new Promise<void>(resolve => { reachedResolve = resolve; });
    const release = new Promise<void>(resolve => { releaseResolve = resolve; });
    let delayed = true;
    const delayedFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = await harness.fetch(input, init);
      if (delayed && new URL(String(input)).pathname === '/api/acquire') {
        delayed = false; reachedResolve(); await release;
      }
      return response;
    }) as typeof fetch;
    const first = createClient({ url: 'http://acquisition.test', storage, fetch: delayedFetch, live: false }); clients.push(first);
    await first.auth.persona('alice');
    const second = harness.client(storage); await second.ready;
    const acquisition = first.acquire(spec()); await reached;
    harness.seq = 6; await second.reconnect();
    await eventually(async () => (await storage.load()).acquisitionFloor === 6);
    releaseResolve();
    await expect(acquisition.completed).rejects.toThrow('durable authority or sequence changed');
    expect(acquisition.getSnapshot().status).toBe('error');
    first.setOnline(false);
    await expect(first.query('feed.conditional', { c: null, global: true })).rejects.toThrow('not available');
    expect((await storage.load()).acquisitions?.some(item => item.status === 'ready' && item.seq === 5)).toBe(false);
  });

  test('same-sequence invalidation discards the final traversal response and validates retained progress', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage();
    let reachedResolve!: () => void, releaseResolve!: () => void;
    const reached = new Promise<void>(resolve => { reachedResolve = resolve; });
    const release = new Promise<void>(resolve => { releaseResolve = resolve; });
    let acquireCalls = 0;
    const delayedFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = await harness.fetch(input, init);
      if (new URL(String(input)).pathname === '/api/acquire' && ++acquireCalls === 2) {
        reachedResolve(); await release;
      }
      return response;
    }) as typeof fetch;
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: delayedFetch, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await reached;
    (client as any).invalidate(); releaseResolve();
    await expect(acquisition.completed).resolves.toMatchObject({ status: 'ready', seq: 5 });
    expect(harness.calls.slice(2).some(call => call.chains.some((chain: any) => chain.follow === false))).toBe(true);
  });

  test('initial acquisition pins the known sequence and invalidates a delayed older ordinary read', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage();
    let reachedResolve!: () => void, releaseResolve!: () => void;
    const reached = new Promise<void>(resolve => { reachedResolve = resolve; });
    const release = new Promise<void>(resolve => { releaseResolve = resolve; });
    let delayed = true;
    const delayedFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = await harness.fetch(input, init);
      if (delayed && new URL(String(input)).pathname === '/api/read') {
        delayed = false; reachedResolve(); await release;
      }
      return response;
    }) as typeof fetch;
    const client = createClient({ url: 'http://acquisition.test', storage, fetch: delayedFetch, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const oldRead = client.query<any[]>('feed.conditional', { c: null, global: true }); await reached;
    harness.seq = 6; harness.rootEmptyAtSeq = 6;
    const acquisition = client.acquire(spec());
    await eventually(() => harness.calls.some(call => call.expectedSeq === 6));
    releaseResolve();
    await expect(acquisition.completed).resolves.toMatchObject({ status: 'ready', seq: 6 });
    await expect(oldRead).resolves.toEqual([]);
    expect(harness.calls[0]?.expectedSeq).toBe(5);
  });

  test('generation replacement resets its sequence domain and never resurrects an old generation', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const original = client.acquire(spec()); await original.completed;
    const generationB = sha256('acquisition-generation-b');
    harness.generation = generationB; harness.seq = 6; await client.reconnect();
    expect(original.getSnapshot().status).toBe('sealed');
    expect(await storage.load()).toMatchObject({ acquisitionFloor: 6, acquisitions: [], acquisitionRows: [], acquisitionResources: [] });
    harness.generation = manifest.generation; harness.seq = 7; await client.reconnect();
    expect(await storage.load()).toMatchObject({ acquisitionFloor: 7, acquisitions: [], acquisitionRows: [], acquisitionResources: [] });
    client.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: true })).rejects.toThrow('not available');
  });

  test('a failed successor-manifest write seals RAM and clears durable authority before offline reopen', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const generationB = sha256('failed-successor-generation');
    let rejectSuccessor = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (rejectSuccessor && patch.manifest?.generation === generationB) throw new Error('manifest disk full');
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    rejectSuccessor = true; harness.generation = generationB; harness.seq = 6;
    await client.reconnect();
    expect(acquisition.getSnapshot().status).toBe('sealed');
    expect(await memory.load()).toMatchObject({ session: null, acquisitions: [], acquisitionRows: [], acquisitionResources: [] });
    client.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    expect(reopened.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('closing during a delayed successor-manifest failure still prevents old-generation offline restore', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const generationB = sha256('delayed-failed-successor'), started = deferred<void>();
    const release = deferred<void>();
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.manifest?.generation === generationB) { started.resolve(); await release.promise; throw new Error('late disk failure'); }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice'); await client.acquire(spec()).completed;
    harness.generation = generationB; harness.seq = 6;
    const reconnect = client.reconnect(); await started.promise; client.close(); release.resolve(); await reconnect;
    await eventually(async () => (await memory.load()).session === null);
    harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    expect(reopened.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('delayed fail-closed cleanup cannot erase a newer durable account', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const generationB = sha256('new-account-successor-race'), started = deferred<void>();
    const release = deferred<void>();
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.manifest?.generation === generationB) { started.resolve(); await release.promise; throw new Error('late disk failure'); }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice'); await client.acquire(spec()).completed;
    harness.generation = generationB; harness.seq = 6;
    const reconnect = client.reconnect(); await started.promise; client.close();
    const bob = { ...session(), token: 'token-bob', principal: { id: 'bob', kind: 'user' as const } };
    await memory.write({ session: bob }); release.resolve(); await reconnect;
    expect((await memory.load()).session?.principal.id).toBe('bob');
  });

  test('acquisition authentication loss seals every retained dataset and erases the session', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const retained = client.acquire(spec()); await retained.completed;
    harness.unauthorized = true;
    const rejected = client.acquire({ ...spec(), id: 'new-history' });
    await expect(rejected.completed).rejects.toThrow('previous account session');
    expect(retained.getSnapshot().status).toBe('sealed');
    expect(rejected.getSnapshot().status).toBe('sealed');
    expect((await storage.load()).session).toBeNull();
    client.setOnline(false);
    expect(client.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('a denial whose checkpoint deletion fails erases the persisted session fallback', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    let rejectDeletion = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (rejectDeletion && patch.acquisition?.acquisition.status === 'cancelled') throw new Error('disk full');
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    rejectDeletion = true; harness.deny = true; harness.seq = 6; await client.reconnect();
    await eventually(() => acquisition.getSnapshot().status === 'sealed');
    expect((await memory.load()).session).toBeNull();
    expect(client.watch('feed.conditional', { c: null, global: false }).getSnapshot().data).toBeUndefined();
  });

  test('failed same-sequence invalidation cannot republish a swallowed durable-ready checkpoint', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    let rejectInvalidation = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (rejectInvalidation && patch.invalidateAcquisitions) throw new Error('invalidation disk full');
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const calls = harness.calls.length; rejectInvalidation = true;
    (client as any).invalidate();
    expect(acquisition.getSnapshot().status).toBe('acquiring');
    expect(client.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
    await eventually(async () => (await memory.load()).session === null);
    expect(acquisition.getSnapshot().status).toBe('sealed');
    expect(harness.calls).toHaveLength(calls);
    client.close(); harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    expect(reopened.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('closing during a delayed invalidation failure still prevents offline checkpoint restore', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let delay = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (delay && patch.invalidateAcquisitions) { started.resolve(); await release.promise; throw new Error('late invalidation failure'); }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice'); await client.acquire(spec()).completed;
    delay = true; (client as any).invalidate(); await started.promise; client.close(); release.resolve();
    await eventually(async () => (await memory.load()).session === null);
    harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    expect(reopened.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('an immediate same-adapter reopen waits for delayed withdrawal cleanup', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let delay = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (delay && patch.invalidateAcquisitions) { started.resolve(); await release.promise; throw new Error('late invalidation failure'); }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice'); await client.acquire(spec()).completed;
    delay = true; (client as any).invalidate(); await started.promise; client.close(); harness.network = false;
    const reopened = harness.client(storage);
    let restored = false; void reopened.ready.then(() => { restored = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(restored).toBe(false);
    release.resolve(); await reopened.ready; reopened.setOnline(false);
    expect(reopened.watch('feed.conditional', { c: null, global: true }).getSnapshot().data).toBeUndefined();
  });

  test('cancelling during a delayed suspension prevents its captured automatic restart', async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let delay = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (delay && patch.invalidateAcquisitions) { delay = false; started.resolve(); await release.promise; }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const calls = harness.calls.length;
    delay = true; (client as any).invalidate(); await started.promise;
    acquisition.cancel(); const cancelled = acquisition.completed;
    release.resolve(); await expect(cancelled).rejects.toMatchObject({ code: 'S3_ACQUISITION_CANCELLED' });
    await eventually(async () => (await memory.load()).acquisitions?.[0]?.status === 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(harness.calls).toHaveLength(calls);
    expect((await memory.load()).acquisitions?.[0]?.status).toBe('cancelled');
    harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    await expect(reopened.query('feed.conditional', { c: null, global: true })).rejects.toThrow('not available');
    reopened.close(); harness.network = true;
    await expect(acquisition.resume()).resolves.toMatchObject({ status: 'ready', seq: 5 });
  });

  for (const terminalState of ['committed', 'rejected', 'conflict'] as const) test(`${terminalState} receipt advance withdraws acquired readiness before terminal persistence`, async () => {
    const harness = new AcquisitionHarness(), memory = createMemoryStorage();
    let terminalStarted = false, release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.operations?.some(entry => entry.receipt)) { terminalStarted = true; await released; }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const held = client.watch<any[]>('feed.conditional', { c: null, global: true });
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', seq: 5 });
    harness.terminalState = terminalState;
    const operation = client.mutate('feed.reject', {}); await operation.durable;
    await eventually(() => terminalStarted);
    expect(acquisition.getSnapshot().status).toBe('acquiring');
    expect(held.getSnapshot()).toMatchObject({ data: undefined, status: 'loading', fresh: false });
    client.setOnline(false); release();
    await expect(operation.settled).resolves.toMatchObject({ state: terminalState, seq: 6 });
    await expect(client.query('feed.conditional', { c: null, global: true })).rejects.toThrow('not available');
    expect(acquisition.getSnapshot().status).not.toBe('ready');
  });

  test('same-sequence invalidation withdraws a held acquired snapshot and revalidation republishes it', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage();
    const started = deferred<void>(), release = deferred<void>();
    let delay = false;
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = await harness.fetch(input, init);
      if (delay && new URL(String(input)).pathname === '/api/acquire') {
        delay = false; started.resolve(); await release.promise;
      }
      return response;
    }) as typeof globalThis.fetch;
    const client = createClient({ url: 'http://acquisition.test', storage, fetch, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const acquisition = client.acquire(spec()); await acquisition.completed;
    const held = client.watch<any[]>('feed.conditional', { c: null, global: true });
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', seq: 5 });
    delay = true; (client as any).invalidate(); await started.promise;
    expect(held.getSnapshot()).toMatchObject({ data: undefined, status: 'loading' });
    release.resolve();
    await eventually(() => acquisition.getSnapshot().status === 'ready' && held.getSnapshot().data !== undefined);
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', seq: 5 });
  });

  test('a directly delivered resource retains ordinary stale data across a receipt advance', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const held = client.watch<any[]>('feed.conditional', { c: null, global: true });
    const original = await held.refresh();
    expect(original).toMatchObject({ status: 'ready', seq: 5, fresh: true });
    harness.terminalState = 'rejected';
    await expect(client.mutate('feed.reject', {}).settled).resolves.toMatchObject({ state: 'rejected', seq: 6 });
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', seq: 5, fresh: false });
    client.setOnline(false);
    await expect(client.query<any[]>('feed.conditional', { c: null, global: true })).resolves.toEqual(original.data!);
  });

  test('restored row custody rejects changed bytes and invalid row identity', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); await client.acquire(spec()).completed;
    const stored = await storage.load(), checkpoint = stored.acquisitions![0]!;
    const changed = structuredClone(stored.acquisitionRows!);
    changed[0]!.row.row.body = 'forged';
    expect(() => restoreAcquiredPool(manifest, session(), checkpoint, changed, stored.acquisitionResources!))
      .toThrow('content-addressed version');
    const wrongIdentity = structuredClone(stored.acquisitionRows!);
    wrongIdentity[0]!.row.row.id = 'another-row';
    expect(() => restoreAcquiredPool(manifest, session(), checkpoint, wrongIdentity, stored.acquisitionResources!))
      .toThrow('invalid table or row identity');
    const wrongTable = structuredClone(stored.acquisitionRows!);
    wrongTable[0]!.row.table = 'not_in_schema';
    expect(() => restoreAcquiredPool(manifest, session(), checkpoint, wrongTable, stored.acquisitionResources!))
      .toThrow('invalid table or row identity');
    const resource = stored.acquisitionResources![0]!, expectedKey = resource.rowVersionKeys[0]!;
    const mismatched = { ...structuredClone(stored.acquisitionRows![0]!), versionKey: sha256('another-version') };
    expect(() => envelopeFromStored(resource, new Map([[expectedKey, mismatched]]), manifest))
      .toThrow('invalid table or row identity');
    expect(resourceVersionKey(stored.acquisitionRows![0]!.row)).toBe(stored.acquisitionRows![0]!.versionKey);
  });

  test('an owner-certified composite page is refused before durable dataset admission', () => {
    const fixture = load('composite-range-page-1');
    const compositeManifest = validateManifest({ generation: sha256('composite-acquisition'),
      schemaHash: schemaDigest(fixture.schema), schema: fixture.schema, programs: { [fixture.program.name]: {
        kind: 'query', ir: fixture.program, certificate: fixture.certificate, planHash: fixture.certificate.plan_hash,
      } }, seq: 5 });
    const chain = resolveChain(compositeManifest,
      pages(fixture.program.name, { c: null, global: true }, { key: 'composite', cursor: 'c' }));
    expect(chain.cursor).toBe('c');
    const delivered = envelope(fixture, 5, {}, compositeManifest);
    expect(Array.isArray(delivered.data)).toBe(false);
    expect(() => storedResource('composite', chain.key, chain.op, chain.args, delivered))
      .toThrow('page results must be lists');
  });

  test('a capped page without a continuation never becomes dataset-ready', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); harness.capped = true;
    await expect(client.acquire(spec()).completed).rejects.toThrow('without complete evidence');
    expect((await storage.load()).acquisitions?.[0]?.status).not.toBe('ready');
  });

  test('connected and clock-sensitive pages are refused as durable offline datasets', async () => {
    const harness = new AcquisitionHarness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); harness.connectedPage = true;
    await expect(client.acquire(spec()).completed).rejects.toThrow('cannot form a durable offline dataset');
    expect((await storage.load()).acquisitions?.[0]?.status).not.toBe('ready');

    const timed = JSON.parse(JSON.stringify(manifest)) as Manifest;
    timed.programs[source.program.name]!.ir.read_time_granularity_ms = 1_000;
    expect(() => resolveChain(timed, root())).toThrow('clock-sensitive');
  });
});
