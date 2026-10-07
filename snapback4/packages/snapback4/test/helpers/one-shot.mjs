import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { parkedChanges } from './sync-control.mjs';

// Suspend the real evaluator at its last continuation, before the production
// publication fence. This changes scheduling only, never an answer or predicate.
const key = Symbol.for('snapback4.test.oneShot');
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (/\/dist\/(client|local)\.js$/.test(url)) {
    const source = String(loaded.source);
    const pattern = url.endsWith('/local.js')
      ? /const result = await runLocal\(op, args(?:, undefined, false, undefined, signal)?\);/
      : /const result = await (?:read\.fetch\([^\n]+|runQuery\(op, args, false, signal\));/;
    assert.equal(source.match(new RegExp(pattern.source, 'g'))?.length, 1, url);
    return { ...loaded, source: source.replace(pattern, '$&\nawait globalThis[Symbol.for("snapback4.test.oneShot")]?.boundary?.(result);') };
  }
  if (url.endsWith('/dist/app-client.js')) {
    const source = String(loaded.source), marker = '    let active = true;';
    assert.equal(source.split(marker).length, 2);
    return { ...loaded, source: source.replace(marker, `
    const originalCheck = check;
    check = async () => {
      const allowed = await originalCheck();
      await globalThis[Symbol.for('snapback4.test.oneShot')]?.authority?.(raw);
      return allowed;
    };
${marker}`) };
  }
  return loaded;
} });
const { fixture, opener, q, m, until, parked, source } = await import('./answers-stay.mjs');
const { createClient } = await import('../../dist/client.js');
const { createLocalClient } = await import('../../dist/local.js');
const { createApp } = await import('../../dist/app.js');
const { memorySessionStore, keepSession } = await import('../../dist/auth.js');
hooks.deregister();
export { q, m, until, parked };
export const program = source + `
view total: count messages by .room
  online only
query insights():
  return total['room']
query heldInsights() held:
  return total['room']
query heldChoice() held:
  if messages['item'].body = 'image-1':
    return total['room']
  return 7
query heldTime(cutoff: time) held:
  if now < cutoff:
    return total['room']
  return 7
query heldArgument(want: bool) held:
  if want:
    return total['room']
  return 7
query heldMembership() held:
  if exists members['room', viewer]:
    return total['room']
  return 7
query heldItem() held:
  return messages['item']
query keyed(tag: int):
  return messages['item']
`;

export async function setup(t, tier, { fetch: intercept, device: wrap, changes, program: customProgram, serverOptions } = {}) {
  const f = await fixture(t, customProgram ?? program, serverOptions);
  const controls = {}; globalThis[key] = controls;
  let online = true;
  const transport = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') return Response.json({ ok: true, session });
    if (path === '/auth/logout') return Response.json({ ok: true });
    if (path === '/changes') return changes ? changes(init.signal) : parkedChanges(init.signal);
    if (!online) throw new TypeError('test link down');
    const headers = new Headers(init?.headers); const persona = headers.get('authorization') === 'Bearer alice-session' ? 'alice' : 'bob'; headers.delete('authorization'); headers.set('x-snapback-persona', persona);
    const send = () => fetch(input, { ...init, headers });
    return intercept ? intercept(path, init, send) : send();
  };
  const deviceTier = tier.replace('app-', '');
  const base = deviceTier === 'online' ? undefined : opener(deviceTier, join(f.dir, 'device'));
  const device = base && (wrap ? { async open(...args) { return wrap(await base.open(...args)); } } : base);
  const options = { url: f.url, persona: 'bob', waitSeconds: 0, fetch: transport, ...(device ? { device } : {}) };
  const session = { kind: 'user', principal: 'dev:bob', token: 'test', expiresAt: Date.now() + 86400000 };
  let client, app;
  if (tier.startsWith('app-')) {
    const sessionStore = memorySessionStore(); await keepSession(f.url, session, sessionStore);
    app = createApp({ ...options, sessionStore });
    assert.equal((await app.ready).ok, true); client = app.client;
  } else client = device ? await createLocalClient(options) : createClient(options);
  t.after(async () => { delete globalThis[key]; await (app ?? client).close(); });
  if (client.sync) await client.sync();
  return { ...f, client, app, controls, link(up) { online = up; },
    async offline() {
      online = false;
      // A transport probe, not an invented setter on the production client.
      if (client.sync) await client.sync(); else await client.query(q('insights'), {});
      assert.equal(client.link(), 'offline');
    } };
}
