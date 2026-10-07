// @ref LLP 0201.000#4 — own the foreground backend, keep its store, observe a real reconnect.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2]);
const binary = path.resolve(process.argv[3]);
const require = createRequire(path.join(root, 'package.json'));
const { ConvexClient, ConvexHttpClient } = require('convex/browser');
const { makeFunctionReference } = require('convex/server');
const WebSocket = require('ws');
const out = path.join(root, 'attempt-' + crypto.randomUUID());
fs.mkdirSync(out);
const store = path.join(out, 'store'); fs.mkdirSync(store);
const log = x => fs.appendFileSync(path.join(out, 'events.jsonl'), JSON.stringify({ at: Date.now(), ...x }) + '\n');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const delay = ms => new Promise(r => setTimeout(r, ms));
const origin = 'http://127.0.0.1:49580';
const secret = crypto.randomBytes(32).toString('hex');
const instance = 'clique-p2a-preflight';
const args = ['--interface', '127.0.0.1', '--port', '49580', '--site-proxy-port', '49581',
  '--instance-name', instance, '--instance-secret', secret, '--local-storage', path.join(store, 'files'),
  '--disable-beacon', path.join(store, 'data.sqlite3')];
const publicArgs = args.map((s, i) => args[i - 1] === '--instance-secret' ? '<private>' : s);
const reachable = port => new Promise(resolve => {
  const c = net.connect({ host: '127.0.0.1', port });
  c.setTimeout(300);
  c.once('connect', () => { c.destroy(); resolve(true); });
  c.once('error', () => resolve(false)); c.once('timeout', () => { c.destroy(); resolve(false); });
});
async function wait(fn, label, ms = 30000) {
  const until = Date.now() + ms;
  do { if (await fn()) return; await delay(200); } while (Date.now() < until);
  throw Error('timeout:' + label);
}
let backend, client, ordinal = 0;
async function start() {
  for (const p of [49580, 49581]) if (await reachable(p)) throw Error('occupied-port:' + p);
  const fd = fs.openSync(path.join(out, 'backend-' + (++ordinal) + '.log'), 'wx');
  backend = spawn(binary, args, { cwd: root, stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
  log({ kind: 'foreground-start', pid: backend.pid, argv: [binary, ...publicArgs], store });
  await wait(async () => { if (backend.exitCode !== null) throw Error('backend-exited'); return reachable(49580); }, 'backend-start');
}
async function stop() {
  if (!backend) return;
  const p = backend;
  const live = () => {
    if (p.exitCode !== null || p.signalCode !== null) return false;
    const ps = spawnSync('ps', ['-p', String(p.pid), '-o', 'stat='], { encoding: 'utf8' });
    if (ps.error || ![0, 1].includes(ps.status)) throw Error('owned-backend-membership-unavailable');
    return !!ps.stdout.trim() && !ps.stdout.trim().startsWith('Z');
  };
  // process.kill throws synchronously; EPERM/ESRCH require another liveness
  // observation, including after the last escalation. This is our direct child.
  for (const [signal, duration] of [['SIGTERM', 10000], ['SIGKILL', 5000]]) {
    const until = Date.now() + duration;
    while (live()) {
      try { process.kill(p.pid, signal); }
      catch (e) { if (!['EPERM', 'ESRCH'].includes(e.code)) throw e; }
      if (Date.now() >= until) break;
      await delay(100);
    }
    if (!live()) break;
  }
  if (live()) throw Error('owned-backend-cleanup-incomplete');
  log({ kind: 'foreground-stop', pid: p.pid, exitCode: p.exitCode, signal: p.signalCode });
  for (let i = 0; i < 5; i++) {
    const open = await reachable(49580); log({ kind: 'offline-probe', reachable: open });
    if (open) throw Error('owned-backend-still-reachable'); await delay(200);
  }
}
let result;
try {
  if (require('convex/package.json').version !== '1.45.0') throw Error('wrong-convex-pin');
  fs.mkdirSync(path.join(root, 'convex'), { recursive: true });
  const functions = `import { mutationGeneric as mutation, queryGeneric as query } from 'convex/server';
export const add = mutation({handler: async (ctx, args) => ctx.db.insert('probe', {value: args.value})});
export const list = query({handler: async ctx => ctx.db.query('probe').collect()});\n`;
  fs.writeFileSync(path.join(root, 'convex/probe.js'), functions);
  await start();
  const key = spawnSync(binary, ['keygen', 'admin-key', '--instance-name', instance, '--instance-secret', secret], { encoding: 'utf8' });
  if (key.status !== 0) throw Error('keygen-failed');
  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: origin, CONVEX_SELF_HOSTED_ADMIN_KEY: key.stdout.trim(), CONVEX_AGENT_MODE: 'anonymous' };
  delete env.CONVEX_DEPLOYMENT; delete env.CONVEX_DEPLOY_KEY;
  const deploy = spawnSync(process.execPath, [path.join(root, 'node_modules/convex/bin/main.js'), 'dev', '--once', '--typecheck', 'disable'], { cwd: root, env, encoding: 'utf8', timeout: 90000 });
  fs.writeFileSync(path.join(out, 'deploy.log'), (deploy.stdout + deploy.stderr).split(key.stdout.trim()).join('<private>'));
  if (deploy.status !== 0) throw Error('deploy-failed');
  const add = makeFunctionReference('probe:add'), list = makeFunctionReference('probe:list');
  const http = new ConvexHttpClient(origin);
  const nonce = crypto.randomUUID();
  await http.mutation(add, { value: nonce });
  let latest = [];
  client = new ConvexClient(origin, { webSocketConstructor: WebSocket, unsavedChangesWarning: false });
  client.onUpdate(list, {}, rows => { latest = rows; log({ kind: 'subscription', rows }); });
  await wait(() => latest.some(r => r.value === nonce), 'first-subscription');
  const before = fs.statSync(store);
  await stop();
  await wait(() => !client.connectionState().isWebSocketConnected, 'disconnect');
  log({ kind: 'client-disconnected', state: client.connectionState() });
  await start();
  await wait(() => client.connectionState().isWebSocketConnected, 'reconnect');
  const rows = await http.query(list, {});
  if (rows.filter(r => r.value === nonce).length !== 1) throw Error('persisted-row-lost-or-duplicated');
  await http.mutation(add, { value: nonce + ':after' });
  await wait(() => latest.some(r => r.value === nonce + ':after'), 'same-client-live-update');
  const after = fs.statSync(store);
  if (before.dev !== after.dev || before.ino !== after.ino) throw Error('store-directory-replaced');
  result = { pass: true, convex: '1.45.0', backendBinary: binary, backendSha256: sha(binary),
    backendVersion: spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    store, device: before.dev, inode: before.ino, origin, foregroundOwnership: true,
    sameClientReconnected: true, persistedRows: rows, networkingSubstitution: false };
} catch (e) {
  result = { pass: null, nativeSegment: 'unmeasured-by-setup', reason: String(e), convex: '1.45.0',
    networkingSubstitution: false, ownerRulingRequired: true };
} finally {
  const cleanupErrors = [];
  for (const [operation, action] of [['client', () => client?.close()], ['backend', stop]]) {
    try { await action(); }
    catch (e) { cleanupErrors.push({ operation, reason: String(e), outcomeClass: 'operator-setup' }); }
  }
  result.cleanupErrors = cleanupErrors;
  result.cleanupComplete = cleanupErrors.length === 0;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ attempt: out, ...result }));
}
process.exitCode = result.pass === true && result.cleanupComplete ? 0 : 2;
