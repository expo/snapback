#!/usr/bin/env node
// Qualification only. Node 24, npm, a built snapback4 and the retained fixture packet.
// Mac: node scripts/contended-reads.mjs --prepare --work /tmp/ct-store --binary target/production/snapback4
// Then: node scripts/contended-reads.mjs --work /tmp/ct-store --binary target/production/snapback4 --out /tmp/ct-after
// Linux: prefix BOTH commands with taskset -c <CPUs>; children inherit affinity.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { once } from 'node:events';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { availableParallelism, cpus, hostname, loadavg, platform } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { hostSample, maintenanceSnapshot, waitForMaintenance } from './contended-observation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv.includes('--mixed')) {
  const { runMixed } = await import('./contended-mixed.mjs');
  await runMixed(argv);
  process.exit(0);
}
const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const work = resolve(option('--work', '/tmp/snapback4-contended-reads'));
const binary = resolve(option('--binary', join(here, '../target/production/snapback4')));
const out = resolve(option('--out', join(work, 'measurements')));
const port = Number(option('--port', '49376'));
const rounds = Number(option('--rounds', '5'));
const cores = availableParallelism();
const levels = option('--levels', '0,0.5,1,1.5').split(',').map(Number);
assert(levels.length > 0 && levels.every(v=>[0,0.5,1,1.5].includes(v)) && Number.isInteger(rounds) && rounds > 0, 'invalid levels or rounds');
const url = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ns = () => Number(process.hrtime.bigint());
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(work, { recursive: true });
await mkdir(out, { recursive: true });
assert(!(await access(join(out, 'metadata.json')).then(()=>true,()=>false)), 'choose a fresh --out directory; existing measurements are never overwritten');
const owned = new Set();
const track = child => { owned.add(child); child.once('exit',()=>owned.delete(child)); return child; };
for (const [signal,code] of [['SIGINT',130],['SIGTERM',143]]) process.once(signal,()=> {
  void Promise.all([...owned].map(stop)).finally(()=>process.exit(code));
});

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await exited; } finally { clearTimeout(watchdog); }
}
async function start(trace) {
  const logPath = join(out, trace ? 'server.log' : 'prepare-server.log');
  const log = openSync(logPath, 'w');
  const env = { ...process.env };
  if (trace) env.SNAPBACK4_READ_TRACE = join(out, 'server-trace.jsonl');
  else delete env.SNAPBACK4_READ_TRACE;
  const child = track(spawn(binary, ['dev', '--port', String(port), '--replay', '--no-watch'],
    { cwd: join(work, 'replay-instance'), env, stdio: ['ignore', log, log] }));
  closeSync(log);
  child.on('error', error => console.error(error));
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`server exited ${child.exitCode ?? child.signalCode}; see ${logPath}`);
    // Own readiness line first: never attach to an unrelated listener at this port.
    try { if ((await readFile(logPath,'utf8')).split('\n').includes(url) && (await fetch(`${url}/auth/config`)).ok) return child; } catch {}
    await sleep(100);
  }
  await stop(child); throw Error('server did not become ready');
}
if (argv.includes('--prepare')) {
  const existing = await access(join(work,'replay-instance/.snapback4/store.sqlite')).then(()=>true,()=>false);
  assert(!existing, '--prepare needs a new work directory; use the existing store without --prepare');
  execFileSync('tar', ['xzf', join(here, '../reports/20261001-ct-contended-reads/inputs/packet.tar.gz'), '-C', work]);
  execFileSync('npm', ['install', '--prefix', work, '--no-audit', '--no-fund', 'snapback4@0.4.10'], { stdio: 'inherit' });
  await mkdir(join(work, 'replay-instance/snapback'), { recursive: true });
  for (const name of ['schema.q', 'config.q', 'digest.q']) await cp(join(work, 'snapback', name), join(work, 'replay-instance/snapback', name));
  await mkdir(join(work, 'evidence'), { recursive: true });
  const { Adapter } = await import(pathToFileURL(join(work, 'scripts/replay-adapter.mjs')));
  const previous = process.cwd(); process.chdir(work);
  const adapter = new Adapter({ url, fixtures: 'fixtures', receipts: 'evidence/replay.jsonl' });
  const files = ['starter-m1.log', 'starter-m2.log', 'starter-m3.log', 'scale.log'].map(n => 'fixtures/' + n);
  const expected = JSON.parse(await readFile('fixtures/invariant-manifest-combined.json', 'utf8'));
  assert.equal(sha(await readFile('fixtures/scale.log')), expected.artifacts['scale.log'].sha256);
  const server = await start(false);
  const timer = setInterval(() => console.log('settled actions', adapter.count), 30000);
  try {
    await adapter.prepare(files);
    outer: for (const file of files) for (const line of (await readFile(file, 'utf8')).trim().split('\n')) {
      if (line === '# checkpoint 50%') break outer;
      if (!line.startsWith('#')) await adapter.action(line);
    }
    await writeFile('evidence/actors.json', JSON.stringify({ count: adapter.count,
      principals: Object.fromEntries(adapter.principals), credentials: Object.fromEntries(adapter.credentials) }));
    const { verify } = await import(pathToFileURL(join(work, 'scripts/scale-verify.mjs')));
    await verify(adapter, expected.checkpoints['50%'], '50%');
    console.log('50% checkpoint complete', adapter.count);
    await writeFile(join(out,'prepare-maintenance.json'),JSON.stringify({actions:adapter.count,...maintenanceSnapshot(join(work,'replay-instance/.snapback4/store.sqlite'))},null,2));
  } finally { clearInterval(timer); adapter.close(); await stop(server); process.chdir(previous); }
  process.exit(0);
}

// Instrument the published client's existing fetch and dispatcher, without replacing either.
// The header is a numeric correlation ID; it changes no query or authority.
const sdk = await import(pathToFileURL(join(work, 'node_modules/snapback4/dist/client.js')));
const auth = await import(pathToFileURL(join(work, 'node_modules/snapback4/dist/auth.js')));
const actors = JSON.parse(await readFile(join(work, 'evidence/actors.json'), 'utf8'));
const api = (await import(pathToFileURL(join(work, 'snapback/generated/api.ts')))).api;
if (argv.includes('--verify')) {
  const { Adapter } = await import(pathToFileURL(join(work, 'scripts/replay-adapter.mjs')));
  const { verify } = await import(pathToFileURL(join(work, 'scripts/scale-verify.mjs')));
  const adapter = new Adapter({url}); adapter.credentials = new Map(Object.entries(actors.credentials));
  adapter.principals = new Map(Object.entries(actors.principals));
  const server = await start(false); const previous = process.cwd(); process.chdir(work);
  try { await verify(adapter, JSON.parse(await readFile('fixtures/invariant-manifest-combined.json','utf8')).checkpoints['50%'], '50%'); }
  finally { adapter.close(); await stop(server); process.chdir(previous); }
  process.exit(0);
}
let current, nextId = 0;
const requests = new WeakMap(), sockets = new WeakMap(); let socketId = 0;
channel('undici:request:create').subscribe(({ request }) => {
  if (current && request.path.startsWith('/q/')) { requests.set(request, current); current.created = ns(); }
});
channel('undici:client:sendHeaders').subscribe(({ request, socket }) => {
  const sample = requests.get(request); if (!sample) return;
  sample.send = ns();
  if (!sockets.has(socket)) sockets.set(socket, ++socketId);
  sample.socket = sockets.get(socket);
  const received = () => { sample.wakeup = ns(); };
  socket.prependOnceListener('data', received);
});
channel('undici:request:headers').subscribe(({ request }) => { const sample = requests.get(request); if (sample) sample.headers = ns(); });
channel('undici:request:trailers').subscribe(({ request }) => { const sample = requests.get(request); if (sample) sample.body = ns(); });
const hostFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (current && String(input).includes('/q/')) {
    current.fetch = ns(); const headers = new Headers(init?.headers); headers.set('x-snapback-ct', String(current.id));
    const sample = current;
    return hostFetch(input, { ...init, headers }).then(response => { sample.serverTiming = response.headers.get('server-timing'); return response; });
  }
  return hostFetch(input, init);
};
const samples = [], processes = [], loadSamples = [], clients = new Map();
const server = await start(!argv.includes('--no-trace'));
const initialHostSample=hostSample([process.pid,server.pid]);
const metadata = { initialHostSample, host: hostname(), platform: platform(), node: process.version, uv: process.versions.uv,
  cpu: cpus()[0]?.model ?? 'unknown', cores, affinity:initialHostSample.affinity,
  binary, binarySha256: sha(readFileSync(binary)), client: JSON.parse(readFileSync(join(work, 'node_modules/snapback4/package.json'))).version,
  actions: actors.count, started: new Date().toISOString(), rounds, serverPid: server.pid, load: loadavg() };
async function client(actor) {
  if (clients.has(actor)) return clients.get(actor);
  const result = await auth.login(url, ...actors.credentials[actor]); assert(result.ok, JSON.stringify(result));
  const c = sdk.createClient({ url, token: result.session.token }); clients.set(actor, c); return c;
}
const endpoints = [
  ['following500', 'u0500', 'home', {}], ['following5', 'u0005', 'home', {}],
  ['celebrityFollowing', 'u0901', 'home', {}], ['globalSearch', 'u0500', 'searchMessages', { q: 'coffee' }],
  ['insights', 'u0500', 'insights', {}], ['trending', 'u0500', 'trending', {}],
  ['busyPage1', 'u0005', 'history', { conversation: sdk.idFrom('g0001') }],
];
const answers = new Map(), answerValues = new Map();
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'asOf').map(([k,v]) => [k, normalized(v)]));
  return value;
}
try {
  metadata.maintenanceWait=await waitForMaintenance(join(work,'replay-instance/.snapback4/store.sqlite'),join(out,'maintenance-wait.json'),server);
  for (const [,actor] of endpoints) await client(actor);
  let cursor = null;
  for (let i = 1; i < 50; i++) {
    const r = await clients.get('u0005').query(api.history, { conversation: sdk.idFrom('g0001'), c: cursor });
    assert('data' in r); cursor = r.next ?? null; if (!cursor) break;
  }
  if (cursor) endpoints.push(['busyPage50', 'u0005', 'history', { conversation: sdk.idFrom('g0001'), c: cursor }]);
  for (const level of levels) {
    const busy = Math.round(cores * level), children = [];
    try {
      for (let i = 0; i < busy; i++) {
        const p = track(spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); let x=1; for(;;) { for(let i=0;i<1000000;i++) x=Math.imul(x,1664525)+1013904223|0; }'], {stdio:['ignore','pipe','inherit']}));
        children.push(p); processes.push({pid:p.pid, level});
        await Promise.race([
          once(p.stdout, 'data'),
          once(p, 'error').then(([error]) => { throw error; }),
          once(p, 'exit').then(([code,signal]) => { throw Error(`busy child exited before readiness: ${code ?? signal}`); }),
        ]);
      }
      await sleep(2000);
      loadSamples.push({ level, phase:'start', at:new Date().toISOString(), ...hostSample([process.pid,server.pid,...children.map(p=>p.pid)]) });
      for (let round = 0; round < rounds; round++) for (const [endpoint, actor, op, args] of endpoints) {
        for (let i = 0; i < 23; i++) {
          const sample = { id: ++nextId, level, busy, round, endpoint, index:i, start:ns() }; current = sample;
          const result = await clients.get(actor).query(api[op], args);
          sample.end = ns(); current = undefined;
          assert('data' in result, `${endpoint}: ${JSON.stringify(result)}`);
          const digest = sha(JSON.stringify(normalized({ data:result.data, complete:result.complete, next:result.next })));
          if(answers.has(endpoint) && digest!==answers.get(endpoint)) {
            await writeFile(join(out,`mismatch-${endpoint}-${sample.id}.json`),JSON.stringify({endpoint,level,round,index:i,at:new Date().toISOString(),first:answerValues.get(endpoint),now:result},null,2));
            assert.equal(digest,answers.get(endpoint),`${endpoint} answer changed after maintenance became idle`);
          }
          if(!answers.has(endpoint)){answers.set(endpoint,digest);answerValues.set(endpoint,result)}
          sample.answer = digest; samples.push(sample);
        }
      }
      assert(children.every(p => p.exitCode === null && p.signalCode === null), 'a busy process exited');
      loadSamples.push({ level, phase:'end', at:new Date().toISOString(), ...hostSample([process.pid,server.pid,...children.map(p=>p.pid)]) });
      console.log(JSON.stringify({level,busy,samples:samples.length,load:loadavg()}));
    } finally { await Promise.all(children.map(stop)); }
  }
} finally {
  current = undefined; globalThis.fetch = hostFetch;
  for (const c of clients.values()) c.close();
  await stop(server);
  await writeFile(join(out,'client-samples.json'), JSON.stringify(samples));
  await writeFile(join(out,'metadata.json'), JSON.stringify({...metadata,finished:new Date().toISOString(),processes,loadSamples},null,2));
}
const traces = argv.includes('--no-trace') ? [] : (await readFile(join(out,'server-trace.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const byId = new Map(traces.map(t => [t.id,t]));
const summary = [];
const distribution = values => { const sorted = values.toSorted((a,b)=>a-b); return {p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]}; };
for (const level of levels) for (const [endpoint] of endpoints) {
  const selected = samples.filter(s=>s.level===level && s.endpoint===endpoint && s.index>=3);
  const stages = {};
  const add = (name, value) => { (stages[name] ??= []).push(value/1e6); };
  for (const s of selected) {
    add('client',s.end-s.start); add('clientSend',s.send-s.start); add('clientDecode',s.end-s.wakeup);
    const t=byId.get(s.id); if (!t) { assert(argv.includes('--no-trace'),`missing server trace ${s.id}`); continue; }
    assert(t.accepted >= s.send && s.wakeup >= t.write_start, 'client and server clocks disagree');
    add('sendToAccept',t.accepted-s.send); add('acceptToDispatch',t.dispatched-t.accepted);
    add('dispatchToRun',t.started-t.dispatched); add('engineLock',t.engine_wait);
    add('readerLock',t.readers_wait); add('otherLocks',Math.max(0,t.mutex_wait-t.readers_wait));
    add('query',t.query_end-t.query_start); add('encoding',t.encode_end-t.encode_start);
    add('write',t.write_end-t.write_start); add('responseToWake',s.wakeup-t.write_start);
    add('server',t.write_end-t.accepted);
  }
  const cohorts=[]; for(let round=0;round<rounds;round++) cohorts.push({round,...distribution(selected.filter(s=>s.round===round).map(s=>(s.end-s.start)/1e6))});
  summary.push({level,endpoint,n:selected.length,...distribution(stages.client),stages:Object.fromEntries(Object.entries(stages).map(([key,v])=>[key,distribution(v)])),cohorts});
}
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));
console.table(summary.map(({level,endpoint,p50,p95})=>({level,endpoint,p50:+p50.toFixed(3),p95:+p95.toFixed(3)})));
