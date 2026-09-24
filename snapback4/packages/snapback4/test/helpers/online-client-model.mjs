// Seeded wire/storage scheduler around the real clients. The oracle tracks
// disclosed rows, acknowledged revocations, durable intents, and lifetimes;
// it does not import the client's authority or journal implementation.
import assert from 'node:assert/strict';
import { promiseHooks } from 'node:v8';
import { createClient } from '../../dist/client.js';
import { createApp } from '../../dist/app.js';
import { keepSession } from '../../dist/auth.js';
import { storeKey } from '../../dist/app-storage.js';
import { ReadObservation } from '../../dist/read-observation.js';

export const round9Operations = ['query', 'observe', 'write', 'revoke', 'release', 'poll', 'replace', 'regress', 'unavailable', 'close', 'signOut', 'reopen', 'login', 'holdStorage', 'failStorage', 'tick'];
export const round10Operations = [...round9Operations, 'upload', 'asset', 'act', 'refresh'];
export const round12Operations = [...round10Operations, 'guest', 'duplicate'];
export const operations = [...round12Operations, 'recoverPending', 'refreshUnreached'];
export function generate(seed, length = 32, vocabulary = operations) {
  let x = seed >>> 0;
  const choose = n => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  return [{ op: 'query' }, { op: 'release' }, { op: 'observe' },
    ...Array.from({ length }, () => ({ op: vocabulary[choose(vocabulary.length)], pick: choose(100), holdReturn: choose(4) === 0 }))];
}
const microtasks = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

export async function execute(commands, tier, coverage = {}, { journalSize = 0, unknownReceipts = 0, oldestFailure = false, saturated = false, keepUnreachedSession = false } = {}) {
  const url = 'https://online-model.invalid', values = new Map(), holds = [], tasks = [], owners = [], apps = [], watches = [];
  const sessions = new Map(), receipts = new Map(), admitted = new Set(), terminalWrites = new Set(), revoked = new Set(), mutations = new Map();
  const errors = [], trace = [], returnHolds = new Set(), roots = new Map();
  const rotations = [], submissions = [], minted = new Set(), retiredWrites = new Set();
  const unreachedRefreshes = [], explicitLogoutTokens = new Set();
  let failNextRefresh = false;
  // R6: an id the server may have executed is never admitted again by this app
  // while its record might matter. Track displacement independently of whether
  // the implementation remembered the id in its compact set.
  const displacedByRetirement = new Set();
  const ordinaryFailedIds = new Set();
  const settlements = new WeakMap();
  const stopSettlements = promiseHooks.onSettled(promise => settlements.get(promise)?.());
  let store = 'A', head = 10, privateRow = true, unavailable = false, stores = 0, ticket = 0, serial = 0, writeId = 0;
  let app, client, holdStorage = false, failStorage = false, draining = false, requests = 0;
  const count = key => { coverage[key] = (coverage[key] ?? 0) + 1; };
  const invariant = (id, ok, why) => { if (!ok) errors.push(`${id}: ${why}`); };
  const journal = () => [...values.entries()].filter(([key]) => key.endsWith('.writes')).map(([, value]) => JSON.parse(value));
  const durable = id => journal().some(j => j.retirementFull || j.retired?.includes(id) || j.receipts.some(write => write.id === id)) && !journal().some(j => j.pending.some(write => write.id === id));
  function hold(kind, detail, release) {
    count('held.' + kind);
    return new Promise(resolve => holds.push({ kind, ...detail, release: () => { release?.(); resolve(); } }));
  }
  const storage = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) {
      if (key.endsWith('.writes')) {
        const next = JSON.parse(value), prior = JSON.parse(values.get(key) ?? '{"pending":[],"receipts":[]}');
        const retiring = prior.pending.some(p => !next.pending.some(n => n.id === p.id));
        if (retiring && holdStorage && !draining) { holdStorage = false; await hold('storage', {}, null); }
        if (retiring && failStorage && !draining) { count('failed.storage'); throw Error('injected terminal persistence failure'); }
        if (next.receipts.length === 256) count('journal.full');
        if (next.retired?.length) count('journal.compact');
        const storeRetirement = prior.pending.some(p => !next.pending.some(n => n.id === p.id)
          && next.receipts.some(r => r.id === p.id && ['E_STORE_REPLACED', 'E_STORE_RESTORE'].includes(r.why?.code)));
        if (storeRetirement) for (const receipt of prior.receipts) {
          if (!next.receipts.some(r => r.id === receipt.id)) {
            displacedByRetirement.add(receipt.id); count('retirement.displaced.' + receipt.state);
            if (ordinaryFailedIds.has(receipt.id)) count('retirement.displaced.ordinary-failure');
          }
        }
        for (const entry of next.pending) if (!prior.pending.some(p => p.id === entry.id)) {
          count('check.retirement-admission');
          invariant('R6', !prior.retirementFull && !retiredWrites.has(entry.id) && !displacedByRetirement.has(entry.id),
            `readmitted protected id ${entry.id} after retirement or saturation`);
        }
        values.set(key, value);
        for (const entry of next.pending) admitted.add(entry.id);
      } else values.set(key, value);
    },
    async delete(key) { values.delete(key); },
  };
  // Virtual timers let randomized schedules cross retry deadlines without
  // seconds of real waiting. Each turn has a hard bound on fired timers.
  const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout, timers = new Map();
  let time = 0, timerId = 0;
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    const handle = { id: ++timerId, unref() { return this; } };
    timers.set(handle, { at: time + Number(ms), fn: () => fn(...args) }); return handle;
  };
  globalThis.clearTimeout = handle => { timers.delete(handle); };
  async function advance(ms) {
    time += ms;
    for (let n = 0; ; n++) {
      const next = [...timers].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) return;
      assert.ok(n < 64, 'R4: timer loop exceeds 64 callbacks in one turn');
      timers.delete(next[0]); next[1].fn(); await microtasks();
    }
  }
  function ownerFor(c) {
    let owner = owners.find(o => o.client === c);
    if (!owner) {
      owner = { client: c, terminal: false, id: owners.length, tokens: new Set([c.session()?.token]) }; owners.push(owner);
      c.onSession(value => {
        if (value) {
          invariant('R2', !owner.terminal, `owner ${owner.id} installed a session after terminal refusal`);
          owner.tokens.add(value.token);
        }
      });
      c.onWrite(value => {
        if (['E_STORE_REPLACED', 'E_STORE_RESTORE'].includes(value.why?.code)) owner.terminal = true;
        count('write.emitted'); write(value);
      });
    }
    return owner;
  }
  function read(owner, value, site, at = { terminal: owner.terminal, revoked }) {
    count('read.' + site);
    if (value.denied?.code === 'E_STORE_REPLACED' || value.denied?.code === 'E_STORE_RESTORE') {
      owner.terminal = true; count('terminal.' + value.denied.code);
    }
    invariant('R2', !at.terminal || !('data' in value), `owner ${owner.id} returned data after terminal refusal at ${site}`);
    for (const row of value.data ?? []) invariant('R1', !(value.fresh && at.revoked.has(row.secret)), `revoked ${row.secret} was fresh at ${site}`);
  }
  function write(value) {
    if (value.state === 'pending') return;
    if (['E_CLOSED', 'E_AUTH'].includes(value.why?.code)) return; // cancellation does not retire a durable intent
    if (tier === 'app' && admitted.has(value.id)) {
      count('check.durable-terminal');
      invariant('R3', durable(value.id), `terminal ${value.id} still has durable pending intent`);
    }
    if (admitted.has(value.id) || tier === 'client') terminalWrites.add(value.id);
    if (admitted.has(value.id) && ['E_STORE_REPLACED', 'E_STORE_RESTORE'].includes(value.why?.code)) retiredWrites.add(value.id);
    if (value.state === 'sent') {
      const mutation = mutations.get(value.id);
      if (mutation?.revoke) { if (!revoked.has(mutation.store)) count('ack.revocation'); revoked.add(mutation.store); }
    }
  }
  function track(promise, label, owner, kind, pendingId) {
    const task = { label, pending: true };
    tasks.push(task);
    // Promise callbacks may run after a later refusal. Check authority when
    // the public promise actually settles, not when its consumer resumes.
    const capture = () => { task.at = { terminal: owner?.terminal, revoked: new Set(revoked) }; };
    capture(); settlements.set(promise, capture);
    Promise.resolve(promise).then(result => {
      task.result = result;
      if (kind === 'read') read(owner, result, 'direct', task.at);
      if (kind === 'write') write(result);
      if (kind === 'receipt' && app.client === owner.client && app.auth.state === 'signed-in' && owner.client.link() === 'online'
        && journal().some(j => j.pending.some(p => p.id === pendingId)) && holds.some(h => h.path?.startsWith('/m/') && h.body.id === pendingId)) {
        count('check.admitted-pending');
        invariant('R6', result?.state === 'pending', `held admitted intent ${pendingId} recovered as ${result?.why?.code ?? result?.state}`);
      }
      if (['upload', 'asset', 'act', 'refresh'].includes(kind)) {
        if (['E_STORE_REPLACED', 'E_STORE_RESTORE'].includes((result.denied ?? result.why)?.code)) owner.terminal = true;
        invariant('R2', !task.at.terminal || !(result.ok || 'url' in result || result.state === 'done' || result.state === 'pending'), `${kind} succeeded or remained pending after terminal refusal`);
        if (kind === 'asset' && 'url' in result) { result.revoke(); count('asset.released'); }
      }
    }, error => { errors.push(`unexpected rejection ${label}: ${error.message}`); }).finally(() => { task.pending = false; });
    return task;
  }
  function issue() {
    const session = { principal: 'alice', token: `token-${++serial}`, kind: 'user', expiresAt: Date.now() + 30 * 86400_000 };
    sessions.set(session.token, session); minted.add(session.token); return session;
  }
  const fetcher = async (input, init = {}, origin) => {
    const path = new URL(input).pathname, args = typeof init.body === 'string' ? JSON.parse(init.body) : {}, token = new Headers(init.headers).get('authorization')?.slice(7);
    count('wire.' + path); requests++;
    if (path.startsWith('/auth/')) {
      // Login and guest mint before their response body is delivered.
      if (path === '/auth/logout') {
        const kept = unreachedRefreshes.find(r => r.token === token && r.owner?.terminal && r.owner.client.session()?.token === token);
        invariant('session recovery', !kept || !sessions.has(token) || explicitLogoutTokens.has(token), 'terminal client revoked the live unrotated bearer needed by recovery');
        sessions.delete(token); return Response.json({ ok: true });
      }
      if (!['/auth/refresh', '/auth/login', '/auth/guest'].includes(path)) throw Error('unexpected auth route ' + path);
    }
    const effectful = path === '/assets' || path.startsWith('/m/') || path.startsWith('/a/') || path.startsWith('/auth/');
    if (!effectful) invariant('R2', !!init.signal, `${path} has no client lifetime signal`);
    invariant('R2', !init.signal?.aborted, `sent ${path} with a retired lifetime`);
    // Query/mutation requests share the raw client's lifetime signal. Change
    // requests have their own watchdog; they remain explicitly scheduled.
    let owner = init.signal ? roots.get(init.signal) : undefined;
    if (!owner && !['/changes', '/probe', '/auth/login', '/auth/guest'].includes(path)) {
      // Restored outbox sends can start before createApp publishes its new
      // raw client. They belong to that opener, not the retired visible one.
      const visible = origin?.app?.client ?? origin?.client ?? client;
      if (!(effectful && origin?.app?.auth.state === 'restoring')) owner = ownerFor(visible);
      if (init.signal && owner) roots.set(init.signal, owner);
    }
    if (owner) invariant('R2', !owner.terminal, `owner ${owner.id} sent ${path} after terminal refusal`);
    if (path === '/auth/refresh' && failNextRefresh) {
      failNextRefresh = false; count('refresh.unreached');
      unreachedRefreshes.push({ token, owner });
      if (!draining) await hold('transport', { path, token, owner }, null);
      // The connection reset before any server effect. The old bearer is live.
      throw new TypeError('refresh connection reset before reaching server');
    }
    let body, rotation;
    if (['/auth/login', '/auth/guest'].includes(path)) body = { session: issue() };
    else if (!sessions.has(token)) body = { denied: { code: 'E_AUTH', family: 'auth', message: 'sign in' } };
    else if (path === '/auth/refresh') {
      sessions.delete(token); const next = issue(); body = { session: next };
      rotation = { owner, token: next.token }; rotations.push(rotation);
      count('refresh.committed');
    }
    else if (path === '/probe') {
      if (unreachedRefreshes.some(r => r.token === token)) count('probe.unrotated');
      body = { ok: true, store_id: store, seq: head };
    }
    else if (path === '/changes') body = { store_id: store, seq: head, generation: 1, tables: ['secrets'] };
    else if (path.startsWith('/m/')) {
      invariant('R6', !displacedByRetirement.has(args.id), `id ${args.id} displaced by retirement posted to ${store}`);
      invariant('R3', !terminalWrites.has(args.id), `terminal write ${args.id} replayed on ${store}`);
      const receiptKey = `${store}/${args.id}`;
      if (receipts.has(receiptKey)) body = { ...receipts.get(receiptKey), replayed: true, head };
      else {
        if (path === '/m/revoke') privateRow = false;
        head++;
        mutations.set(args.id, { store, revoke: path === '/m/revoke' });
        body = { state: 'sent', id: args.id, seq: head, head, store_id: store };
        receipts.set(receiptKey, body);
      }
    } else if (path === '/assets') body = { asset: { id: `${store}:photo`, type: 'image/png', bytes: 1 } };
    else if (path.startsWith('/assets/')) body = {};
    else if (path.startsWith('/a/')) body = { id: args.id, state: 'done', result: store, store_id: store, seq: head };
    else if (path.startsWith('/q/')) {
      body = { seq: head, store_id: store, tables: ['secrets'], ...(unavailable ? { loading: true, data: null, complete: false }
        : { data: privateRow ? [{ secret: store, request: args.args.ticket }] : [], complete: true }) };
      if (args.args.holdReturn) returnHolds.add(args.args.ticket);
      const key = `query.requests.${args.args.ticket}`;
      count(key);
      if (args.args.direct && coverage[key] > 1) count('query.refetch');
      if (args.args.direct) invariant('R4', coverage[key] <= 4, `direct read ${args.args.ticket} exceeded four requests`);
    } else throw Error('unexpected route ' + path);
    // Headers arrive now; bodies may finish out of order, even after abort.
    const delivered = async () => {
      if (!draining || path === '/changes') {
        const pending = hold('body', { path, owner, body, signal: init.signal }, null);
        // Match fetch: abort rejects an unread body, even if the effect has
        // already committed. Aborting never rolls back the server's ledger.
        await new Promise((resolve, reject) => {
          const abort = () => {
            count('body.aborted');
            invariant('effect custody', !effectful, `${path} aborted after its server effect committed`);
            reject(new DOMException('body aborted', 'AbortError'));
          };
          init.signal?.addEventListener('abort', abort, { once: true });
          if (init.signal?.aborted) abort();
          void pending.then(resolve).finally(() => init.signal?.removeEventListener('abort', abort));
        });
      }
      if (effectful) invariant('effect custody', !init.signal?.aborted, `${path} lost its committed response body`);
      if (rotation) rotation.delivered = true;
    };
    return { ok: !body.denied, status: body.denied ? 401 : 200, body: null, headers: new Headers({ 'content-type': 'image/png' }),
      async blob() { await delivered(); return new Blob(['x'], { type: 'image/png' }); }, async json() {
      await delivered();
      return body;
    } };
  };
  const originalFetch = ReadObservation.prototype.fetch;
  ReadObservation.prototype.fetch = async function (...args) {
    const result = await originalFetch.apply(this, args);
    const id = result.read.data?.[0]?.request;
    if (returnHolds.delete(id) && !draining) await hold('return', { id }, null);
    return result;
  };
  async function open() {
    if (tier === 'app') {
      const origin = {}; app = createApp({ url, sessionStore: storage, fetch: (input, init) => fetcher(input, init, origin) }); origin.app = app; apps.push(app);
      track(app.ready, 'ready');
      app.auth.onChange(() => { ownerFor(app.client); });
      await microtasks(); client = app.client;
    } else { const origin = {}; client = createClient({ url, session: issue(), fetch: (input, init) => fetcher(input, init, origin) }); origin.client = client; }
    ownerFor(client);
  }
  function check() { if (errors.length) assert.fail(errors[0] + '\ntrace=' + JSON.stringify(trace)); }
  function release(pick = 0, onlyPoll = false) {
    const candidates = holds.filter(h => !onlyPoll || h.path === '/changes');
    if (!candidates.length) return;
    const chosen = candidates[pick % candidates.length];
    if (holds.indexOf(chosen) > 0) count('released.reordered');
    holds.splice(holds.indexOf(chosen), 1); chosen.release(); count('released.' + chosen.kind);
  }
  async function command(step) {
    trace.push(step); count('op.' + step.op);
    if (tier === 'app') client = app.client;
    const owner = ownerFor(client);
    const before = requests;
    switch (step.op) {
      case 'query': {
        const args = { ticket: ++ticket, direct: true, holdReturn: step.holdReturn };
        track(client.query({ kind: 'query', name: 'page' }, args), 'query', owner, 'read'); break;
      }
      case 'observe': {
        const watch = client.observe({ kind: 'query', name: 'page' }, { ticket: ++ticket, holdReturn: step.holdReturn });
        watches.push(watch); watch.subscribe(() => read(owner, watch.getSnapshot(), 'observed')); break;
      }
      case 'write': case 'revoke': {
        const id = String(++writeId).padStart(26, '0');
        const op = { kind: 'mutation', name: step.op === 'revoke' ? 'revoke' : 'charge' };
        submissions.push({ client, owner, id, op });
        track(client.mutate(op, {}, { id }), step.op, owner, 'write'); break;
      }
      case 'duplicate': {
        const entry = submissions.length ? submissions[(step.pick ?? 0) % submissions.length] : undefined;
        if (entry) { count('write.duplicate'); track(entry.client.mutate(entry.op, {}, { id: entry.id }), 'duplicate', entry.owner, 'write'); }
        break;
      }
      case 'recoverPending': {
        const pending = journal().flatMap(j => j.pending).find(entry => holds.some(h => h.path === '/m/' + entry.op && h.body.id === entry.id));
        if (tier === 'app' && app.auth.state === 'signed-in' && client.viewer() && !owner.terminal && pending) {
          // A journal read can wait behind a held persistence operation. Keep
          // the scheduler free to release it, just as for queries and writes.
          track(client.write(pending.id), 'recoverPending', owner, 'receipt', pending.id);
        }
        break;
      }
      case 'upload': track(client.upload(new Uint8Array([1])), 'upload', owner, 'upload'); break;
      case 'asset': track(client.asset('photo'), 'asset', owner, 'asset'); break;
      case 'act': track(client.act({ kind: 'action', name: 'charge' }, {}), 'act', owner, 'act'); break;
      case 'refresh': track(client.refreshSession(), 'refresh', owner, 'refresh'); break;
      case 'refreshUnreached': failNextRefresh = true; track(client.refreshSession(), 'refreshUnreached', owner, 'refresh'); break;
      case 'release': release(step.pick); break;
      case 'poll': release(step.pick, true); break;
      case 'replace': store = 'B' + (++stores); head = 1; privateRow = true; break;
      case 'regress': head = Math.max(0, head - 5); break;
      case 'unavailable': unavailable = !unavailable; break;
      case 'close': track(tier === 'app' ? app.close() : client.close(), 'close'); break;
      case 'signOut':
        for (const o of tier === 'app' ? owners : [owner]) explicitLogoutTokens.add(o.client.session()?.token);
        track(tier === 'app' ? app.auth.logout() : client.signOut(), 'signOut'); break;
      case 'reopen': {
        const prior = tier === 'app' ? app.close() : client.close();
        track(prior.then(open), 'reopen'); break;
      }
      case 'login': if (tier === 'app') track(app.auth.login('alice@example.com', 'password'), 'login'); break;
      case 'guest': if (tier === 'app') track(app.auth.guest(), 'guest'); break;
      case 'holdStorage': holdStorage = true; break;
      case 'failStorage': failStorage = !failStorage; break;
      case 'tick': await advance(1000); break;
    }
    await microtasks();
    invariant('R4', requests - before <= 64, `one ${step.op} step sent ${requests - before} requests`);
    check();
  }
  try {
    if (tier === 'app') {
      await keepSession(url, issue(), storage);
      if (journalSize || saturated) {
        count('journal.preloaded.' + journalSize);
        const history = Array.from({ length: journalSize }, (_, n) => {
          const id = String(100_000 + n).padStart(26, '0');
          if (oldestFailure && n === 0) {
            count('journal.preloaded.ordinary-failure'); ordinaryFailedIds.add(id);
            return { state: 'failed', id, why: { code: 'E_UNIQUE', family: 'input', message: 'a prior write failed its unique constraint' } };
          }
          if (n < journalSize - unknownReceipts) return { state: 'sent', id, seq: 1, replayed: true };
          retiredWrites.add(id); admitted.add(id); terminalWrites.add(id);
          return { state: 'failed', id, why: { code: 'E_STORE_RESTORE', family: 'store', message: 'unknown prior outcome' } };
        });
        const pending = saturated ? [{ owner: 'alice', id: '00000000000000000000090000', op: 'charge', args: {} }] : [];
        const full = saturated ? { retirementFull: true, retired: Array.from({ length: 4096 }, (_, n) => String(200_000 + n).padStart(26, '0')) } : {};
        if (saturated) {
          count('journal.saturated');
          // This intent was admitted, and may have executed, before saturation.
          receipts.set(`${store}/${pending[0].id}`, { state: 'sent', id: pending[0].id, seq: 1, store_id: store });
        }
        await storage.set(storeKey('writes', url, 'alice'), JSON.stringify({ owner: 'alice', backend: url, pending, receipts: history, ...full }));
      }
    }
    await open();
    if (saturated) await command({ op: 'recoverPending' });
    for (const step of commands) await command(step);
    // Fair drain: release every held body, stop observers, allow persistence,
    // and advance retry timers. Work may not remain without an external hold.
    draining = true; failStorage = false; holdStorage = false;
    for (const watch of watches) watch.close();
    for (let round = 0; round < 40; round++) {
      for (const h of holds.splice(0)) h.release();
      await microtasks(); await advance(1000); check();
      if (!tasks.some(task => task.pending) && !holds.some(h => h.path !== '/changes')) break;
      assert.ok(round < 39, 'R4: fair drain did not settle within 40 rounds\n' + JSON.stringify(trace));
    }
    if (keepUnreachedSession) {
      const token = unreachedRefreshes[0]?.token;
      assert.ok(token && coverage['probe.unrotated'] > 0, 'the replacement probe presented the original bearer');
      assert.equal(app.auth.state, 'signed-in', 'replacement keeps a session the new store accepts');
      assert.equal(app.client.session()?.token, token);
      assert.ok(sessions.has(token), 'the kept bearer is still live at the server');
    }
    // Reopen over the same durable store, proving terminal intents do not
    // replay. Restorable pending outcomes may settle during this final drain.
    for (const a of apps) track(a.close(), 'final-close');
    for (const owner of owners) if (tier === 'client') track(owner.client.close(), 'final-close');
    for (let n = 0; n < 12; n++) { for (const h of holds.splice(0)) h.release(); await microtasks(); }
    for (const r of rotations) if (r.delivered && r.owner?.terminal && !r.owner.tokens.has(r.token)) {
      count('refresh.retired'); invariant('R2', !sessions.has(r.token), 'unkept terminal successor was not revoked');
    }
    if (tier === 'app') {
      await open();
      for (let n = 0; n < 12; n++) { for (const h of holds.splice(0)) h.release(); await microtasks(); }
      if (app.client.viewer()) for (const id of new Set([...retiredWrites, ...displacedByRetirement])) {
        count('write.retired-retry');
        if (displacedByRetirement.has(id)) count('write.displaced-retry');
        if (displacedByRetirement.has(id) && ordinaryFailedIds.has(id)) count('write.displaced-ordinary-retry');
        track(app.mutate({ kind: 'mutation', name: 'charge' }, {}, { id }), 'retired-retry', ownerFor(app.client), 'write');
      }
      for (let n = 0; n < 12; n++) { for (const h of holds.splice(0)) h.release(); await microtasks(); }
      track(app.close(), 'reopened-close');
    }
    for (let n = 0; n < 12; n++) { for (const h of holds.splice(0)) h.release(); await microtasks(); }
    const kept = new Set(owners.map(owner => owner.client.session()?.token));
    for (const [key, value] of values) if (key.endsWith('.session')) kept.add(JSON.parse(value).token);
    for (const token of minted) {
      count('check.bearer-custody');
      invariant('R5', kept.has(token) || !sessions.has(token), `minted bearer ${token} was neither kept nor revoked`);
    }
    check();
    assert.ok(tasks.every(task => !task.pending), 'R4: pending tasks after cleanup: ' + tasks.filter(t => t.pending).map(t => t.label));
  } finally {
    draining = true; failStorage = false;
    for (const a of apps) void a.close();
    for (const owner of owners) if (tier === 'client') void owner.client.close();
    for (let n = 0; n < 15; n++) { for (const h of holds.splice(0)) h.release(); await microtasks(); }
    ReadObservation.prototype.fetch = originalFetch;
    stopSettlements();
    globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear;
  }
}
