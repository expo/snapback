import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createClient, createMemoryStorage, createPlatformClient, type ClientStorage, type SnapbackClient,
  type Session } from '../packages/snapback3/src/client.js';
import { FactPool, queryKey, taggedArgs, validateManifest } from '../packages/snapback3/src/resource/facts.js';
import { deferred } from '../packages/snapback3/src/resource/signal.js';
import type { DeliveryEnvelopeV1 } from '../packages/snapback3/src/resource/protocol.js';
import type { Manifest, StoragePatch } from '../packages/snapback3/src/resource/types.js';
import { canonicalProgramJson } from '../packages/evaluator/src/certificate-identity.js';
import { schemaDigest, wireJson } from '../packages/evaluator/src/value-runtime.js';
import { sha256 } from '../packages/evaluator/src/hash.js';

const fixture = JSON.parse(readFileSync(new URL('../corpus/named-helper-wrapped-scan.json', import.meta.url), 'utf8'));
const clients: SnapbackClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });

function program(name: string, kind = 'Query', changes: Record<string, unknown> = {}) {
  // The Rust golden's scan bounds remain unchanged. These aliases exercise
  // structural reuse across operation names, with a narrower typed Id input.
  const ir = { ...structuredClone(fixture.program), name, kind, args: { columnId: 'Id' }, ...changes };
  const certificate = { ...structuredClone(fixture.certificate), program: name, plan_hash: sha256(canonicalProgramJson(ir)) };
  return { kind: kind.toLowerCase(), ir, certificate, planHash: certificate.plan_hash } as Manifest['programs'][string];
}

function makeManifest(): Manifest {
  const list = program('cards.list');
  const unseen = program('cards.unseen');
  const count = program('cards.count', 'Query', { body: [{ Return: { Field: { name: 'value', base: {
    Get: { site: 'count.0', table: 'cardCounts', index: 'byId', key: [{ Variable: 'columnId' }], provenance: 'Arg' },
  } } } }] });
  const send = program('cards.add', 'Mutation', {
    args: { columnId: 'Id', title: { Text: { max: 64 } }, tag: { Optional: { Text: { max: 10 } } } },
    body: [{ Return: { Literal: 'Null' } }],
  });
  send.certificate.write_sites = [{ site: 'add.0', table: 'cards', kind: 'insert', max_calls: 1 }];
  return validateManifest({ generation: sha256('resource-test'), schemaHash: fixture.certificate.schema_hash,
    schema: structuredClone(fixture.schema), programs: { 'cards.list': list, 'cards.unseen': unseen,
      'cards.count': count, 'cards.add': send }, seq: 5 });
}

const sessionFor = (name: string): Session => ({ token: `token-${name}`, principal: { id: name, kind: 'user', name },
  authEpoch: 1, expiresAt: Date.now() + 3_600_000 });

function envelope(manifest: Manifest, op: string, principal = 'alice', override: Partial<DeliveryEnvelopeV1> = {}): DeliveryEnvelopeV1 {
  const rows = fixture.receipt.rows.map((row: any) => ({ ...row, row: wireJson(row.row) }));
  const ranges = fixture.receipt.ranges.map((range: any) => ({ site: range.site, table: range.table, index: range.index,
    prefix: range.prefix.map((item: any) => ({ Scalar: wireJson(item.Scalar) })), order: range.order, take: range.take,
    after: null, before: null, gt: null, gte: null, lt: null, lte: null, ruleHash: range.rule_hash,
    rowIds: range.row_ids, stop: range.stop, absence: range.absence }));
  return { protocol: 1, generation: manifest.generation, schemaHash: manifest.schemaHash,
    planHash: manifest.programs[op]!.planHash, authority: { principal, authEpoch: 1 }, state: 'complete',
    data: rows.map((row: any) => ({ $row: { table: row.table, id: row.id } })), next: null,
    seq: manifest.seq, rows, receipt: { ranges, absences: [], verdicts: [] }, validator: sha256('fixture-delivery'), ...override };
}

const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json' } });

class Harness {
  manifest = structuredClone(makeManifest());
  network = true;
  countState: 'partial' | 'error' | 'zero' = 'partial';
  readonly calls: Array<{ path: string; body: string | undefined; principal: string }> = [];
  readonly ledger = new Map<string, any>();
  applied = 0;
  beforeRead?: (queries: any[], principal: string) => Promise<void>;
  afterMutation?: () => void;
  eventStream?: ReadableStreamDefaultController<Uint8Array>;
  eventQueries: any[] = [];
  eventPrincipal = '';
  rowTitle = 'Ship';
  denyRows = false;
  readonly fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const principal = new Headers(init.headers).get('Authorization')?.replace('Bearer token-', '') ?? '';
    const rawBody = init.body as string | undefined;
    this.calls.push({ path, body: rawBody, principal });
    if (!this.network) throw new TypeError('network disconnected');
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (path === '/api/manifest') return response(this.manifest);
    if (path === '/api/auth/persona') return response(sessionFor(body.name));
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/events') {
      this.eventQueries = body.queries;
      this.eventPrincipal = principal;
      return new Response(new ReadableStream<Uint8Array>({
        start: controller => { this.eventStream = controller; controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n')); },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (path === '/api/read') {
      const manifest = this.manifest;
      const resources = body.queries.map((query: any) => {
        if (query.op === 'cards.count') {
          if (this.countState === 'error') return { key: query.key, error: { code: 'S3_OPERATION_UNKNOWN', message: 'Count unavailable.' } };
          return { key: query.key, envelope: envelope(manifest, query.op, principal, this.countState === 'zero'
            ? { data: 0, rows: [], receipt: { ranges: [], absences: [], verdicts: [] } }
            : { state: 'partial', reason: 'missing-authority', data: null, rows: [], receipt: { ranges: [], absences: [], verdicts: [] } }) };
        }
        const base = envelope(manifest, query.op, principal);
        return { key: query.key, envelope: { ...base, rows: base.rows.map(row => ({ ...row, row: { ...row.row, title: this.rowTitle } })) } };
      });
      await this.beforeRead?.(body.queries, principal);
      return response({ generation: manifest.generation, seq: manifest.seq, resources });
    }
    if (path.startsWith('/api/operation/')) return response(this.ledger.get(`${principal}:${path.split('/').at(-1)}`) ?? null);
    if (path === '/api/mutation') {
      const key = `${principal}:${body.intent}`;
      let terminal = this.ledger.get(key);
      if (!terminal) {
        this.applied++;
        terminal = { state: 'committed', intent: body.intent, seq: ++this.manifest.seq, data: { id: `created-${this.applied}` } };
        this.ledger.set(key, terminal);
      }
      this.afterMutation?.();
      return response(terminal);
    }
    return response({ code: 'S3_NOT_FOUND', message: path }, 404);
  }) as typeof fetch;

  client(storage: ClientStorage = createMemoryStorage(), live = false): SnapbackClient {
    const client = createClient({ url: 'http://snapback.test', storage, fetch: this.fetch, live });
    clients.push(client); return client;
  }
  invalidate(): void { this.eventStream?.enqueue(new TextEncoder().encode('event: invalidate\ndata: {}\n\n')); }
  resources(): void {
    const resources = this.eventQueries.map(query => {
      const base = envelope(this.manifest, query.op, this.eventPrincipal);
      if (query.op === 'cards.count') return { key: query.key, envelope: { ...base, data: this.countState === 'zero' ? 0 : null,
        ...(this.countState === 'zero' ? {} : { state: 'partial', reason: 'missing-authority' }),
        rows: [], receipt: { ranges: [], absences: [], verdicts: [] } } };
      if (this.denyRows) return { key: query.key, envelope: { ...base, state: 'denied', rule: 'NOT_MEMBER', data: null,
        rows: [], receipt: { ranges: [], absences: [], verdicts: [] } } };
      return { key: query.key, envelope: { ...base, rows: base.rows.map(row => ({ ...row, row: { ...row.row, title: this.rowTitle } })) } };
    });
    this.eventStream?.enqueue(new TextEncoder().encode(`event: resources\ndata: ${JSON.stringify({ seq: this.manifest.seq,
      generation: this.manifest.generation, resources })}\n\n`));
  }
}

async function eventually(predicate: () => boolean, message = 'condition did not become true'): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error(message);
}

describe('independent resources', () => {
  for (const source of ['after-mutation', 'local-query'] as const) test(`empty revocation after ${source} stays redacted through a failed replacement`, async () => {
    const harness = new Harness(), memory = createMemoryStorage();
    let revoke = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.frame && revoke) throw new Error('quota reached');
      await memory.write(patch);
    } };
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const result = await harness.fetch(input, init);
      if (!revoke || !String(input).endsWith('/api/read')) return result;
      const frame = await result.json();
      for (const item of frame.resources) item.envelope = { ...item.envelope, state: 'complete', data: [], rows: [],
        receipt: { ranges: [], absences: [], verdicts: [] } };
      return response(frame);
    }) as typeof fetch;
    const client = createClient({ url: 'http://snapback.test', storage, fetch: fetcher, live: false }); clients.push(client);
    await client.auth.persona('alice'); await client.query('cards.list', { columnId: 'col1' });
    const rows = client.watch(source === 'after-mutation' ? 'cards.list' : 'cards.unseen', { columnId: 'col1' });
    expect(rows.getSnapshot().data).toBeDefined();
    if (source === 'after-mutation') {
      const stop = rows.subscribe(() => {}); await rows.refresh();
      harness.afterMutation = () => { revoke = true; };
      await client.mutate('cards.add', { columnId: 'col1', title: 'Renew then revoke' }).settled;
      await eventually(() => rows.getSnapshot().error?.code === 'S3_STORAGE');
      stop();
    } else {
      revoke = true; harness.manifest.seq = 6; await rows.refresh();
    }
    expect(rows.getSnapshot().data).toBeUndefined();
    expect(rows.getSnapshot().complete).toBe(false);
    expect((await memory.load()).frame).toBeNull();
  });

  test('a durable newer terminal fences an older cached frame after an offline process restart', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice'); await first.query('cards.list', { columnId: 'col1' });
    first.setOnline(false);
    const operation = first.mutate('cards.add', { columnId: 'col1', title: 'Receipt before crash' });
    await operation.durable; first.close();
    const entry = (await storage.load()).operations[0]!;
    await storage.write({ operations: [{ ...entry, status: 'committed', receipt: {
      state: 'committed', intent: entry.id, seq: 6, data: null,
    } }] });
    expect((await storage.load()).frame?.seq).toBe(5);
    harness.network = false;
    const reopened = harness.client(storage); await reopened.ready; reopened.setOnline(false);
    expect(reopened.watch('cards.list', { columnId: 'col1' }).getSnapshot().data).toBeUndefined();
    expect(reopened.watch('cards.unseen', { columnId: 'col1' }).getSnapshot().data).toBeUndefined();
    expect((await reopened.operation(entry.id)!.settled).seq).toBe(6);
  });

  test('a failed frame transaction never exposes its new rows or coverage', async () => {
    const harness = new Harness(), memory = createMemoryStorage();
    let rejectFrames = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.frame && rejectFrames) throw new Error('disk full');
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const rows = client.watch<any[]>('cards.list', { columnId: 'col1' });
    await rows.refresh(); expect(rows.getSnapshot().data?.[0]?.title).toBe('Ship');
    rejectFrames = true; harness.manifest.seq = 6; harness.rowTitle = 'Not yet durable';
    await rows.refresh();
    expect(rows.getSnapshot().data?.[0]?.title).toBe('Ship');
    expect(rows.getSnapshot().fresh).toBe(false);
    expect(rows.getSnapshot().error?.code).toBe('S3_STORAGE');
    client.setOnline(false);
    expect(client.watch('cards.unseen', { columnId: 'col1' }).getSnapshot().data).toBeUndefined();
    expect((await memory.load()).frame).toBeNull();
  });

  for (const state of ['denied', 'empty'] as const) test(`a received ${state} revocation redacts old rows even when persistence fails`, async () => {
    const harness = new Harness(), memory = createMemoryStorage();
    let revoke = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.frame && revoke) throw new Error('quota reached');
      await memory.write(patch);
    } };
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const result = await harness.fetch(input, init);
      if (!revoke || !String(input).endsWith('/api/read')) return result;
      const frame = await result.json();
      frame.resources = frame.resources.map((item: any) => {
        if (JSON.parse(String(init.body)).queries.find((query: any) => query.key === item.key)?.op !== 'cards.list') return item;
        return { ...item, envelope: { ...item.envelope, state: state === 'denied' ? 'denied' : 'complete',
          ...(state === 'denied' ? { rule: 'NOT_MEMBER' } : {}), data: state === 'denied' ? null : [], rows: [],
          receipt: { ranges: [], absences: [], verdicts: [] } } };
      });
      return response(frame);
    }) as typeof fetch;
    const client = createClient({ url: 'http://snapback.test', storage, fetch: fetcher, live: false }); clients.push(client);
    await client.auth.persona('alice');
    harness.countState = 'zero';
    const rows = client.watch('cards.list', { columnId: 'col1' }), count = client.watch('cards.count', { columnId: 'col1' });
    const stopRows = rows.subscribe(() => {}), stopCount = count.subscribe(() => {}); await rows.refresh();
    expect(rows.getSnapshot().data).toBeDefined(); expect(count.getSnapshot().data).toBe(0);
    revoke = true; harness.manifest.seq = 6;
    await rows.refresh();
    expect(rows.getSnapshot().data).toBeUndefined();
    expect(rows.getSnapshot().status).toBe('error');
    expect(rows.getSnapshot().error?.code).toBe('S3_STORAGE');
    expect(count.getSnapshot().data).toBe(0);
    expect((await memory.load()).frame).toBeNull();
    stopRows(); stopCount();
  });

  test('a missing or failing count does not blank the independently authorized rows', async () => {
    const harness = new Harness(), client = harness.client();
    await client.auth.persona('alice');
    const messages = client.watch<any[]>('cards.list', { columnId: 'col1' });
    const count = client.watch<number>('cards.count', { columnId: 'col1' });
    const stopMessages = messages.subscribe(() => {}), stopCount = count.subscribe(() => {});
    await messages.refresh();
    expect(messages.getSnapshot().data?.[0]?.title).toBe('Ship');
    expect(messages.getSnapshot().complete).toBe(true);
    expect(count.getSnapshot().data).toBeUndefined();
    expect(count.getSnapshot().complete).toBe(false);
    harness.countState = 'error';
    await count.refresh();
    expect(count.getSnapshot().status).toBe('error');
    expect(messages.getSnapshot().data?.[0]?.title).toBe('Ship');
    harness.countState = 'zero';
    await count.refresh();
    expect(count.getSnapshot().data).toBe(0);
    expect(count.getSnapshot().complete).toBe(true);
    stopMessages(); stopCount();
  });

  test('a capped page with no next cursor stays incomplete', () => {
    const manifest = makeManifest(), facts = new FactPool(manifest, sessionFor('alice'));
    facts.admit([{ key: queryKey('cards.list', { columnId: 'col1' }), op: 'cards.list', args: { columnId: 'col1' },
      envelope: envelope(manifest, 'cards.list', 'alice', { state: 'capped', next: null }) }]);
    const value = facts.read<any[]>('cards.list', { columnId: 'col1' })!;
    expect(value.data).toHaveLength(1);
    expect(value.next).toBeNull();
    expect(value.complete).toBe(false);
  });

  test('a never-requested query can reuse complete evidence after a durable cold reopen', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice');
    await first.query('cards.list', { columnId: 'col1' });
    first.close(); harness.network = false;
    const reopened = harness.client(storage);
    await reopened.ready; reopened.setOnline(false);
    const result = await reopened.query<any[]>('cards.unseen', { columnId: 'col1' });
    expect(result[0]!.title).toBe('Ship');
    expect(reopened.watch('cards.unseen', { columnId: 'col1' }).getSnapshot().fresh).toBe(false);
    const absentScope = reopened.watch('cards.unseen', { columnId: 'never-loaded' });
    expect(absentScope.getSnapshot().data).toBeUndefined();
    expect(absentScope.getSnapshot().complete).toBe(false);
    expect(harness.calls.filter(call => call.path === '/api/read')).toHaveLength(1);
  });

  test('authorized rows alone never imply complete range coverage', () => {
    const manifest = makeManifest(), facts = new FactPool(manifest, sessionFor('alice'));
    facts.admit([{ key: queryKey('cards.list', { columnId: 'col1' }), op: 'cards.list', args: { columnId: 'col1' },
      envelope: envelope(manifest, 'cards.list', 'alice', { receipt: { ranges: [], absences: [], verdicts: [] } }) }]);
    expect(facts.read('cards.list', { columnId: 'col1' })?.data).toBeDefined();
    expect(facts.read('cards.unseen', { columnId: 'col1' })).toBeUndefined();
  });

  test('new sequence evidence cannot borrow prior sequence membership', () => {
    const manifest = makeManifest(), facts = new FactPool(manifest, sessionFor('alice'));
    facts.admit([{ key: queryKey('cards.list', { columnId: 'col1' }), op: 'cards.list', args: { columnId: 'col1' }, envelope: envelope(manifest, 'cards.list') }]);
    expect(facts.read('cards.unseen', { columnId: 'col1' })?.data).toBeDefined();
    facts.admit([{ key: queryKey('cards.count', { columnId: 'col1' }), op: 'cards.count', args: { columnId: 'col1' },
      envelope: envelope(manifest, 'cards.count', 'alice', { seq: 6, state: 'partial', reason: 'missing-authority', data: null,
        rows: [], receipt: { ranges: [], absences: [], verdicts: [] } }) }]);
    expect(facts.read('cards.unseen', { columnId: 'col1' })).toBeUndefined();
    expect(facts.admit([{ key: 'late', op: 'cards.list', args: { columnId: 'col1' }, envelope: envelope(manifest, 'cards.list') }])).toBeNull();
    expect(facts.read('cards.unseen', { columnId: 'col1' })).toBeUndefined();
  });
});

describe('durable operations', () => {
  test('committed work stays observing until the active row resource observes its sequence', async () => {
    const harness = new Harness(), client = harness.client();
    await client.auth.persona('alice');
    const rows = client.watch('cards.list', { columnId: 'col1' });
    const count = client.watch('cards.count', { columnId: 'col1' });
    const stopRows = rows.subscribe(() => {}), stopCount = count.subscribe(() => {});
    await rows.refresh();
    const release = deferred<void>(); let waiting = false;
    harness.beforeRead = async () => { waiting = true; await release.promise; };
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Visible continuity' });
    await operation.settled;
    await eventually(() => waiting);
    expect(operation.getSnapshot().status).toBe('observing');
    expect(client.getSnapshot().pending.find(entry => entry.id === operation.id)?.status).toBe('observing');
    expect(rows.getSnapshot().data).toBeDefined();
    release.resolve();
    await eventually(() => operation.getSnapshot().status === 'committed');
    expect(rows.getSnapshot().seq).toBe(6);
    expect(count.getSnapshot().data).toBeUndefined();
    expect(client.getSnapshot().pending).toHaveLength(0);
    stopRows(); stopCount();
  });

  test('unmounting the last relevant query does not strand a committed operation', async () => {
    const harness = new Harness(), client = harness.client();
    await client.auth.persona('alice');
    const rows = client.watch('cards.list', { columnId: 'col1' });
    const stop = rows.subscribe(() => {}); await rows.refresh();
    const release = deferred<void>(); harness.beforeRead = async () => { await release.promise; };
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Navigate away' });
    await operation.settled;
    expect(operation.getSnapshot().status).toBe('observing');
    stop();
    await eventually(() => operation.getSnapshot().status === 'committed');
    expect(client.getSnapshot().pending).toHaveLength(0);
    release.resolve();
  });

  test('a reconnect completes observation without submitting an already committed operation again', async () => {
    const harness = new Harness(), client = harness.client();
    await client.auth.persona('alice');
    const rows = client.watch('cards.list', { columnId: 'col1' });
    const stop = rows.subscribe(() => {}); await rows.refresh();
    harness.afterMutation = () => { harness.network = false; };
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Reconnect observation' });
    await operation.settled;
    await eventually(() => client.getSnapshot().status === 'offline');
    expect(operation.getSnapshot().status).toBe('observing');
    harness.network = true; harness.afterMutation = undefined;
    await client.reconnect();
    await eventually(() => operation.getSnapshot().status === 'committed');
    expect(harness.applied).toBe(1);
    expect(rows.getSnapshot().seq).toBe(6);
    stop();
  });

  test('admission owns arguments and fills optional values without changing the immutable request', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); client.setOnline(false);
    const args = { columnId: 'col1', title: 'Original', tag: undefined };
    const operation = client.mutate('cards.add', args);
    args.title = 'Changed by caller';
    await operation.durable;
    const entry = (await storage.load()).operations[0]!;
    expect(JSON.parse(entry.body).args).toEqual({ columnId: 'col1', title: 'Original' });
    expect(taggedArgs(harness.manifest, 'cards.add', { columnId: 'col1', title: 'Original' }).tag).toBe('Null');
    expect(() => taggedArgs(harness.manifest, 'cards.add', { columnId: 'col1' })).toThrow('required argument');
    expect(() => taggedArgs(harness.manifest, 'cards.add', { columnId: 'col1', title: 'ok', surprise: true })).toThrow('unknown argument');
    expect(JSON.parse(entry.body).schemaHash).toBe(harness.manifest.schemaHash);
    expect(harness.calls.some(call => call.path === '/api/mutation')).toBe(false);
  });

  test('a lost reply followed by restart recovers one server commit with the same identity', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice');
    harness.afterMutation = () => { harness.network = false; throw new TypeError('reply lost after commit'); };
    const operation = first.mutate('cards.add', { columnId: 'col1', title: 'Send once' });
    await operation.durable;
    await eventually(() => harness.applied === 1 && first.getSnapshot().status === 'offline');
    const submitted = harness.calls.find(call => call.path === '/api/mutation')!.body;
    first.close();
    harness.afterMutation = undefined; harness.network = true;
    const reopened = harness.client(storage);
    await reopened.ready;
    const restored = reopened.operation(operation.id)!;
    const receipt = await restored.settled;
    expect(receipt.state).toBe('committed');
    expect(harness.applied).toBe(1);
    expect(harness.calls.filter(call => call.path === '/api/mutation')).toHaveLength(1);
    expect((await storage.load()).operations[0]!.body).toBe(submitted);
    expect((await storage.load()).operations[0]!.receipt?.intent).toBe(operation.id);
  });

  test('a transport failure before commit retries exactly the persisted bytes', async () => {
    const harness = new Harness(), storage = createMemoryStorage();
    let failed = false;
    const transport = (async (input: RequestInfo | URL, init: RequestInit) => {
      if (String(input).endsWith('/api/mutation') && !failed) {
        failed = true; harness.network = false;
        harness.calls.push({ path: '/api/mutation', body: init.body as string, principal: 'alice' });
        throw new TypeError('request dropped before server');
      }
      return harness.fetch(input, init);
    }) as typeof fetch;
    const client = createClient({ url: 'http://snapback.test', storage, fetch: transport, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const operation = client.mutate('cards.add', { title: 'Exact bytes', columnId: 'col1' });
    await operation.durable;
    await eventually(() => client.getSnapshot().status === 'offline');
    harness.network = true;
    await client.reconnect();
    await operation.settled;
    const bodies = harness.calls.filter(call => call.path === '/api/mutation').map(call => call.body);
    expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]); expect(harness.applied).toBe(1);
  });

  test('429 and worker timeout outcomes retry automatically without an active query or live stream', async () => {
    const harness = new Harness();
    let attempts = 0;
    const bodies: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).endsWith('/api/mutation')) {
        bodies.push(String(init.body));
        if (++attempts === 1) return response({ code: 'S3_OWNER_BUSY', message: 'Try again.' }, 429);
        if (attempts === 2) return response({ code: 'S3_WORKER_TIMEOUT', message: 'Outcome is unknown.' }, 503);
      }
      return harness.fetch(input, init);
    }) as typeof fetch;
    const client = createClient({ url: 'http://snapback.test', fetch: fetcher, storage: false, live: false }); clients.push(client);
    await client.auth.persona('alice');
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Wait for owner' });
    await operation.settled;
    expect(attempts).toBe(3);
    expect(new Set(bodies).size).toBe(1);
    expect(harness.applied).toBe(1);
    expect(operation.getSnapshot().status).toBe('committed');
  });

  test('a schema-only successor parks uncommitted work without rewriting its payload', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); client.setOnline(false);
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Old meaning' });
    await operation.durable;
    const before = (await storage.load()).operations[0]!.body;
    const successor = structuredClone(harness.manifest);
    successor.schema.tables.cards.columns.note = { Optional: { Text: { max: 10 } } };
    successor.schemaHash = schemaDigest(successor.schema); successor.generation = sha256('successor');
    for (const item of Object.values(successor.programs)) item.certificate.schema_hash = successor.schemaHash;
    harness.manifest = successor;
    client.setOnline(true); await client.reconnect();
    await eventually(() => operation.getSnapshot().status === 'parked');
    expect(operation.getSnapshot().error?.code).toBe('S3_OPERATION_CHANGED');
    expect(harness.applied).toBe(0);
    expect((await storage.load()).operations[0]!.body).toBe(before);
  });

  test('lookup recovers a committed old-generation receipt before successor parking', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice');
    harness.afterMutation = () => { harness.network = false; throw new TypeError('lost'); };
    const operation = first.mutate('cards.add', { columnId: 'col1', title: 'Settled before upgrade' });
    await operation.durable; await eventually(() => first.getSnapshot().status === 'offline'); first.close();
    const successor = structuredClone(harness.manifest);
    successor.programs['cards.add']!.ir.body = [{ Return: { Literal: { Int: 4 } } }];
    successor.programs['cards.add']!.planHash = sha256(canonicalProgramJson(successor.programs['cards.add']!.ir));
    successor.programs['cards.add']!.certificate.plan_hash = successor.programs['cards.add']!.planHash;
    successor.generation = sha256('upgraded-program'); harness.manifest = successor;
    harness.network = true; harness.afterMutation = undefined;
    const reopened = harness.client(storage); await reopened.ready;
    expect((await reopened.operation(operation.id)!.settled).state).toBe('committed');
    expect(harness.applied).toBe(1);
  });

  test('a failed durable admission sends nothing', async () => {
    const harness = new Harness(), memory = createMemoryStorage();
    const storage: ClientStorage = { load: memory.load, write: patch => patch.operations
      ? Promise.reject(new Error('disk full')) : memory.write(patch) };
    const client = harness.client(storage); await client.auth.persona('alice');
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Keep my text' });
    await expect(operation.durable).rejects.toThrow('disk full');
    expect(operation.getSnapshot().status).toBe('error');
    expect(harness.calls.some(call => call.path === '/api/mutation')).toBe(false);
  });

  test('settlement is not exposed before its local terminal transaction completes', async () => {
    const harness = new Harness(), memory = createMemoryStorage(), release = deferred<void>();
    let terminalStarted = false;
    const storage: ClientStorage = { load: memory.load, async write(patch) {
      if (patch.operations?.some(entry => entry.receipt)) { terminalStarted = true; await release.promise; }
      await memory.write(patch);
    } };
    const client = harness.client(storage); await client.auth.persona('alice');
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Durable terminal' });
    await operation.durable; await eventually(() => terminalStarted);
    expect(operation.getSnapshot().status).toBe('sending');
    expect((await memory.load()).operations[0]!.receipt).toBeUndefined();
    release.resolve(); await operation.settled;
    expect((await memory.load()).operations[0]!.status).toBe('committed');
  });
});

describe('account and live boundaries', () => {
  test('a delayed older manifest cannot replace a newer completed reconnect', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), release = deferred<void>();
    let delay = false, waiting = false;
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const result = await harness.fetch(input, init);
      if (String(input).endsWith('/api/manifest') && delay) { delay = false; waiting = true; await release.promise; }
      return result;
    }) as typeof fetch;
    const client = createClient({ url: 'http://snapback.test', storage, fetch: fetcher, live: false }); clients.push(client);
    await client.auth.persona('alice');
    delay = true; const old = client.reconnect(); await eventually(() => waiting);
    harness.manifest.generation = sha256('newer manifest');
    await client.reconnect();
    expect((await storage.load()).manifest?.generation).toBe(harness.manifest.generation);
    release.resolve(); await old;
    expect((await storage.load()).manifest?.generation).toBe(harness.manifest.generation);
    await client.query('cards.list', { columnId: 'col1' });
    expect((await storage.load()).frame?.generation).toBe(harness.manifest.generation);
  });

  test('retained operation handles seal on account change and late terminal replies cannot unseal them', async () => {
    const harness = new Harness();
    const release = deferred<void>(); let replyWaiting = false;
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const result = await harness.fetch(input, init);
      if (String(input).endsWith('/api/mutation')) { replyWaiting = true; await release.promise; }
      return result;
    }) as typeof fetch;
    const owner = createClient({ url: 'http://snapback.test', storage: false, fetch: fetcher, live: false }); clients.push(owner);
    await owner.auth.persona('alice');
    const operation = owner.mutate('cards.add', { columnId: 'col1', title: 'Private Alice input' });
    await operation.durable; await eventually(() => replyWaiting);
    await owner.auth.persona('bob');
    expect(operation.getSnapshot()).toMatchObject({ status: 'sealed', args: {} });
    expect(operation.getSnapshot().receipt).toBeUndefined();
    let notifications = 0; const stop = operation.subscribe(() => notifications++);
    release.resolve(); await new Promise(resolve => setTimeout(resolve, 5));
    expect(notifications).toBe(0);
    expect(operation.getSnapshot().status).toBe('sealed');
    await expect(operation.settled).rejects.toThrow('previous account');
    expect(owner.operation(operation.id)).toBeUndefined();
    await owner.auth.persona('alice');
    const recovered = owner.operation(operation.id)!;
    expect(recovered).not.toBe(operation);
    expect(recovered.getSnapshot().args.title).toBe('Private Alice input');
    expect((await recovered.settled).state).toBe('committed');
    expect(harness.applied).toBe(1);
    expect(operation.getSnapshot().status).toBe('sealed');
    stop();
  });

  test('a delayed old stream frame cannot cross the known commit floor after its facts were cleared', async () => {
    const harness = new Harness(), client = harness.client(createMemoryStorage(), true);
    await client.auth.persona('alice');
    const rows = client.watch('cards.list', { columnId: 'col1' });
    const seen: Array<{ fresh: boolean; seq?: number }> = [];
    const stop = rows.subscribe(() => seen.push({ fresh: rows.getSnapshot().fresh, seq: rows.getSnapshot().seq }));
    await eventually(() => !!harness.eventStream); harness.resources();
    await eventually(() => rows.getSnapshot().seq === 5);
    const release = deferred<void>(); let waiting = false;
    harness.beforeRead = async () => { waiting = true; await release.promise; };
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Sequence six' });
    await operation.settled; await eventually(() => waiting);
    const index = seen.length;
    harness.manifest.seq = 5; harness.resources(); harness.manifest.seq = 6;
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(rows.getSnapshot().fresh).toBe(false);
    expect(seen.slice(index).some(value => value.fresh && (value.seq ?? 0) < 6)).toBe(false);
    release.resolve(); await eventually(() => rows.getSnapshot().seq === 6);
    expect(operation.getSnapshot().status).toBe('committed');
    stop();
  });

  test('a delayed old-account response cannot enter the new account or satisfy its request', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice');
    const release = deferred<void>(); let waiting = false;
    harness.beforeRead = async (_queries, principal) => { if (principal === 'alice') { waiting = true; await release.promise; } };
    const resource = client.watch<any[]>('cards.list', { columnId: 'col1' });
    const oldRequest = resource.refresh();
    await eventually(() => waiting);
    await client.auth.persona('bob');
    expect(resource.getSnapshot().data).toBeUndefined();
    const newRequest = resource.refresh();
    await newRequest;
    release.resolve();
    await expect(oldRequest).rejects.toThrow('account changed');
    expect(client.getSnapshot().principal?.id).toBe('bob');
    expect((await storage.load()).frame?.principal).toBe('bob');
    expect(resource.getSnapshot().data).toHaveLength(1);
  });

  test('pending operations survive account switches but cannot drain as another principal', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), client = harness.client(storage);
    await client.auth.persona('alice'); client.setOnline(false);
    const operation = client.mutate('cards.add', { columnId: 'col1', title: 'Alice only' });
    await operation.durable;
    // Keep Alice's mutation offline while the explicit sign-in request runs.
    harness.network = true;
    const signingIn = client.auth.persona('bob');
    client.setOnline(true);
    await signingIn;
    expect(client.getSnapshot().pending).toHaveLength(0);
    expect(client.operation(operation.id)).toBeUndefined();
    expect(harness.applied).toBe(0);
    await client.auth.persona('alice'); await client.operation(operation.id)!.settled;
    expect(harness.applied).toBe(1);
    expect(harness.calls.find(call => call.path === '/api/mutation')!.principal).toBe('alice');
  });

  test('an invalidation racing a read cannot revive the invalidated snapshot', async () => {
    const harness = new Harness(), client = harness.client(createMemoryStorage(), true);
    await client.auth.persona('alice');
    const resource = client.watch('cards.list', { columnId: 'col1' });
    const stop = resource.subscribe(() => {});
    await eventually(() => !!harness.eventStream);
    const release = deferred<void>(); let waiting = false, reads = 0;
    harness.beforeRead = async () => { if (++reads === 1) { waiting = true; await release.promise; } };
    const pending = resource.refresh();
    await eventually(() => waiting);
    harness.manifest = { ...harness.manifest, seq: 6 };
    harness.invalidate();
    await new Promise(resolve => setTimeout(resolve, 0));
    release.resolve(); await pending;
    expect(reads).toBe(2);
    expect(resource.getSnapshot().seq).toBe(6);
    stop();
  });

  test('live resource frames replace rows without a loading flash and publish revocation with independent neighbors', async () => {
    const harness = new Harness(), client = harness.client(createMemoryStorage(), true);
    await client.auth.persona('alice');
    const rows = client.watch<any[]>('cards.list', { columnId: 'col1' });
    const count = client.watch<number>('cards.count', { columnId: 'col1' });
    const observations: Array<{ title: string | undefined; countSeq: number | undefined; rowSeq: number | undefined }> = [];
    const stopRows = rows.subscribe(() => observations.push({ title: rows.getSnapshot().data?.[0]?.title,
      countSeq: count.getSnapshot().seq, rowSeq: rows.getSnapshot().seq }));
    const stopCount = count.subscribe(() => {});
    await eventually(() => !!harness.eventStream);
    harness.resources(); await eventually(() => rows.getSnapshot().data !== undefined);
    const first = observations.length;
    harness.rowTitle = 'Updated'; harness.manifest.seq = 6;
    harness.resources(); await eventually(() => rows.getSnapshot().seq === 6);
    expect(observations.slice(first).every(item => item.title !== undefined)).toBe(true);
    expect(observations.at(-1)!.title).toBe('Updated');
    expect(observations.at(-1)!.countSeq).toBe(6);
    expect(count.getSnapshot().data).toBeUndefined();
    harness.denyRows = true; harness.countState = 'zero'; harness.manifest.seq = 7;
    harness.resources(); await eventually(() => rows.getSnapshot().status === 'denied');
    expect(rows.getSnapshot().data).toBeUndefined();
    expect(count.getSnapshot().data).toBe(0);
    expect(count.getSnapshot().seq).toBe(7);
    expect(harness.calls.filter(call => call.path === '/api/events').at(-1)!.body).toContain('queries');
    stopRows(); stopCount();
  });

  test('switching a shared browser identity clears the other client before it can expose the old account', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice'); await first.query('cards.list', { columnId: 'col1' });
    const second = harness.client(storage); await second.ready;
    expect(second.getSnapshot().principal?.id).toBe('alice');
    const rows = second.watch('cards.list', { columnId: 'col1' });
    expect(rows.getSnapshot().data).toBeDefined();
    await first.auth.persona('bob');
    await eventually(() => second.getSnapshot().principal?.id === 'bob');
    expect(rows.getSnapshot().data).toBeUndefined();
    await first.auth.logout();
    await eventually(() => second.getSnapshot().status === 'signed-out');
    expect(rows.getSnapshot().data).toBeUndefined();
  });

  test('throwing application observers do not interrupt shared-memory authority withdrawal', async () => {
    const harness = new Harness(), storage = createMemoryStorage();
    const first = harness.client(storage); await first.auth.persona('alice');
    const throwing = harness.client(storage), later = harness.client(storage);
    throwing.setOnline(false); later.setOnline(false);
    await Promise.all([throwing.ready, later.ready]);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
    const reported: Array<{ error: unknown; principal?: string }> = [];
    Object.defineProperty(globalThis, 'reportError', { configurable: true,
      value: (error: unknown) => reported.push({ error, principal: throwing.getSnapshot().principal?.id }) });
    let laterNotifications = 0;
    const stopThrowing = throwing.subscribe(() => { throw new Error('memory observer failure'); });
    const stopLater = later.subscribe(() => { laterNotifications++; });
    try {
      await expect(first.auth.persona('bob')).resolves.toMatchObject({ principal: { id: 'bob' } });
      await eventually(() => throwing.getSnapshot().principal?.id === 'bob'
        && later.getSnapshot().principal?.id === 'bob');
      expect(reported.some(item => item.error instanceof Error && item.error.message === 'memory observer failure')).toBe(true);
      expect(reported.every(item => item.principal !== 'alice')).toBe(true);
      expect(laterNotifications).toBeGreaterThan(0);
      expect((await storage.load()).session?.principal.id).toBe('bob');
    } finally {
      stopThrowing(); stopLater();
      if (descriptor) Object.defineProperty(globalThis, 'reportError', descriptor);
      else delete (globalThis as typeof globalThis & { reportError?: unknown }).reportError;
    }
  });
});

test('storage updates preserve other clients intents instead of replacing the journal', async () => {
  const storage = createMemoryStorage();
  const first = { id: 'first', principal: 'alice', body: '{}', status: 'queued' as const, createdAt: 1 };
  const second = { ...first, id: 'second' };
  await Promise.all([storage.write({ operations: [first] }), storage.write({ operations: [second] })]);
  expect((await storage.load()).operations.map(entry => entry.id).sort()).toEqual(['first', 'second']);
});

test('resource identifiers have fixed length even for long valid arguments, and canonicalize object order', () => {
  const text = 'a'.repeat(20_000);
  const first = queryKey('search.results', { text, limit: 10 });
  expect(first).toHaveLength(64);
  expect(queryKey('search.results', { limit: 10, text })).toBe(first);
  expect(queryKey('search.results', { text: `${text}b`, limit: 10 })).not.toBe(first);
});

describe('platform lifecycle', () => {
  test('cached data and pending work become ready while the network hangs without native clone or UUID globals', async () => {
    const harness = new Harness(), storage = createMemoryStorage(), first = harness.client(storage);
    await first.auth.persona('alice');
    const before = await first.query<any[]>('cards.list', { columnId: 'col1' });
    first.setOnline(false);
    const held = first.mutate('cards.add', { columnId: 'col1', title: 'Held for native restart' });
    await held.durable; first.close();

    const descriptors = new Map(['crypto', 'structuredClone', 'TextEncoder'].map(name =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const));
    let networkCalls = 0, nextId = 0;
    const hanging = ((_input: RequestInfo | URL, init: RequestInit = {}) => {
      networkCalls++;
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort',
        () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }) as typeof fetch;
    let reopened: SnapbackClient | undefined, immediate: SnapbackClient | undefined;
    try {
      for (const name of descriptors.keys()) Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
      reopened = createClient({ url: 'http://snapback.test', storage, fetch: hanging, live: false,
        idFactory: () => `native-id-${++nextId}` });
      clients.push(reopened);
      await Promise.race([reopened.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('local ready waited for network')), 50))]);
      expect(reopened.getSnapshot().principal?.id).toBe('alice');
      expect(reopened.getSnapshot().pending.map(item => item.id)).toContain(held.id);
      await eventually(() => networkCalls > 0, 'opportunistic reconnect did not start');
      reopened.setOnline(false);
      expect(await reopened.query<any[]>('cards.list', { columnId: 'col1' })).toEqual(before);
      const next = reopened.mutate('cards.add', { columnId: 'col1', title: 'Created without global crypto' });
      await next.durable;
      expect(next.id).toBe('native-id-2');

      const callsBeforeImmediate = networkCalls;
      immediate = createClient({ url: 'http://snapback.test', storage, fetch: hanging, live: false,
        idFactory: () => `native-id-${++nextId}` });
      clients.push(immediate); immediate.setOnline(false);
      await immediate.ready; await new Promise(resolve => setTimeout(resolve, 0));
      expect(networkCalls).toBe(callsBeforeImmediate);
      expect(immediate.getSnapshot().principal?.id).toBe('alice');
      expect(immediate.getSnapshot().pending.map(item => item.id)).toContain(next.id);
    } finally {
      reopened?.close(); immediate?.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
    }
  });

  test('a never-synced client resolves honestly without inventing local data', async () => {
    let calls = 0;
    const client = createClient({ url: 'http://never-synced.test', storage: false, live: false,
      fetch: async () => { calls++; return new Promise<Response>(() => {}); }, idFactory: () => 'never-synced-client' });
    clients.push(client);
    await client.ready;
    expect(client.getSnapshot().status).toBe('signed-out');
    expect(client.watch('unknown.query', {}).getSnapshot().data).toBeUndefined();
    await expect(client.query('unknown.query', {})).rejects.toMatchObject({ code: 'S3_AUTH' });
    expect(calls).toBe(0);
  });

  test('owned storage closes only after a held write drains; explicit storage remains caller-owned', async () => {
    const harness = new Harness(), durable = createMemoryStorage(), seed = harness.client(durable);
    await seed.auth.persona('alice'); seed.setOnline(false); seed.close();
    const started = deferred<void>(), release = deferred<void>();
    let held = true, closes = 0;
    const storage: ClientStorage = {
      load: durable.load,
      async write(patch) {
        if (held && patch.session === null) { held = false; started.resolve(); await release.promise; }
        await durable.write(patch);
      },
      subscribe: durable.subscribe,
      async close() { closes++; },
    };
    const owned = createPlatformClient({ url: 'http://snapback.test', live: false }, {
      defaultStorage: () => storage, fetch: harness.fetch, idFactory: () => 'owned-client',
    });
    clients.push(owned); owned.setOnline(false); await owned.ready;
    const logout = owned.auth.logout(); await started.promise;
    owned.close();
    expect(closes).toBe(0);
    expect(() => owned.watch('cards.list', {})).toThrow(/closed/i);
    expect(() => owned.mutate('cards.add', {})).toThrow(/closed/i);
    release.resolve(); await logout; await owned.closeAsync();
    expect(closes).toBe(1);

    let externalCloses = 0;
    const external: ClientStorage = { load: durable.load, write: durable.write, async close() { externalCloses++; } };
    const callerOwned = createClient({ url: 'http://snapback.test', storage: external, fetch: harness.fetch,
      idFactory: () => 'external-client', live: false });
    clients.push(callerOwned); callerOwned.setOnline(false); await callerOwned.ready; await callerOwned.closeAsync();
    expect(externalCloses).toBe(0);
  });

  test('ignored close cleanup rejection does not become unhandled and remains awaitable', async () => {
    const memory = createMemoryStorage(), unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on('unhandledRejection', onUnhandled);
    const client = createPlatformClient({ url: 'http://snapback.test', live: false }, {
      defaultStorage: () => ({ load: memory.load, write: memory.write, async close() { throw new Error('close failed'); } }),
      fetch: async () => { throw new Error('unexpected network'); }, idFactory: () => 'cleanup-client',
    });
    try {
      await client.ready; client.close();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
      await expect(client.closeAsync()).rejects.toThrow('close failed');
    } finally { process.off('unhandledRejection', onUnhandled); }
  });
});
