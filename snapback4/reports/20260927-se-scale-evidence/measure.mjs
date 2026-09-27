// Run from snapback4 after building the production CLI and JS package.
// SE_PRISTINE must be a private, never-served copy of the original DB + WAL + program.
// node reports/20260927-se-scale-evidence/measure.mjs quiet|cpu|writes [rounds=30]
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostname, loadavg, cpus, platform } from 'node:os';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { login } from '../../packages/snapback4/dist/auth.js';
import { createClient, mintId } from '../../packages/snapback4/dist/client.js';
import { defaultFetch } from '../../packages/snapback4/dist/node-fetch.js';

const [condition, count = '30'] = process.argv.slice(2);
assert.ok(['quiet', 'cpu', 'writes'].includes(condition));
const rounds = Number(count), root = process.cwd();
const evidence = resolve(root, 'reports/20260927-se-scale-evidence');
const target = resolve(root, `target/lane-se/${condition}`);
const pristine = resolve(process.env.SE_PRISTINE ?? 'target/lane-se/pristine');
const binary = resolve('target/production/snapback4');
const affinity = process.env.SE_CPUS ?? '70,71,72,73,74,75,76,77,78,79';
mkdirSync(target, { recursive: false });
execFileSync('cp', ['-a', '--reflink=auto', `${pristine}/.`, target]);
mkdirSync(`${target}/evidence`, { recursive: true });
const serverLog = openSync(`${evidence}/${condition}-server.log`, 'w');
const server = spawn('taskset', ['-c', affinity, binary, 'dev', '--replay', '--no-watch', '--port', '0'],
  { cwd: target, stdio: ['ignore', 'pipe', serverLog] });
const serverExit = once(server, 'exit');
const busy = [], clients = new Map(), samples = [], bursts = [];
let monitor, current, url;
const host = () => ({ at: Date.now(), load: loadavg(), stat: readFileSync('/proc/stat', 'utf8').split('\n').filter(s => /^cpu(?:\d| )/.test(s)),
  pressure: readFileSync('/proc/pressure/cpu', 'utf8').trim() });
const initial = host();
const metadata = { condition, rounds, hostname: hostname(), platform: platform(), cpu: cpus()[0].model,
  logicalCPUs: cpus().length, affinity, node: process.version, serverPid: server.pid, initial,
  binaryVersion: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  method: 'Unmodified builder scaleProbes; current online SDK, ordinary password login; 3 warm-ups + 20 sequential samples, eight probes; final corpus only' };
const queryOrder = ['following500', 'following5', 'celebrityFollower'].flatMap(name => Array(23).fill(name))
  .concat(Array(49).fill('paginationWarmup'), ['historyPage1', 'historyPage50', 'globalSearch', 'insights', 'trending'].flatMap(name => Array(23).fill(name)));
try {
  const lines = createInterface({ input: server.stdout });
  [url] = await Promise.race([once(lines, 'line'), serverExit.then(() => { throw Error('server exited at startup'); })]);
  url = url.trim(); assert.match(url, /^http:\/\/127\.0\.0\.1:/);
  lines.on('line', line => appendFileSync(`${evidence}/${condition}-server.log`, `${line}\n`));
  metadata.url = url;
  const instrument = async (input, init) => {
    const start = performance.now();
    const response = await defaultFetch(input, init);
    if (current && String(input).includes('/q/')) {
      current.headersMs = performance.now() - start;
      current.header = response.headers.get('server-timing');
      assert.ok(current.header);
      current.server = Object.fromEntries(current.header.split(',').map(metric => {
        const [name, duration] = metric.trim().split(';dur='); return [name, Number(duration)];
      }));
    }
    return response;
  };
  for (const actor of ['u0500', 'u0005', 'u0901']) {
    const auth = await login(url, `${actor}@example.com`, 'CliqueScale!20260808');
    assert.ok(auth.ok, JSON.stringify(auth));
    clients.set(actor, createClient({ url, session: auth.session, fetch: instrument }));
  }
  const q = name => ({ kind: 'query', name });
  const group = await clients.get('u0500').query(q('messaging.groupByTitle'), { title: 'Busy Group 0001' });
  assert.ok(group.data?.id, JSON.stringify(group));
  const conversation = group.data.id;
  const { scaleProbes } = await import(pathToFileURL(`${target}/scripts/scale-probes.mjs`));
  process.chdir(target); // Builder writes evidence/scale-<label>-probes.json.
  monitor = setInterval(() => appendFileSync(`${evidence}/${condition}-host.jsonl`, `${JSON.stringify(host())}\n`), 1000);
  if (condition === 'cpu') {
    // Ten external single-thread processes, one on each allowed CPU. Nothing
    // outside this list of recorded child PIDs is signalled or reconfigured.
    for (const cpu of affinity.split(',')) {
      const child = spawn('taskset', ['-c', cpu, process.execPath, '-e', 'for (;;) { Math.sqrt(Math.random()); }'], { stdio: 'ignore' });
      busy.push(child);
    }
    metadata.contentionPids = busy.map(child => child.pid);
  }
  for (let round = 0; round < rounds; round++) {
    execFileSync(binary, ['doctor', '--latency', '--reset', '--url', url], { cwd: target });
    if (condition === 'writes') {
      // Replay a settled burst through the actual 50-member send operation.
      // Fresh IDs avoid replaying cached receipts; no jobs run in dev --replay.
      const start = performance.now();
      for (let n = 0; n < 64; n++) {
        const id = mintId();
        const result = await clients.get('u0500').mutate({ kind: 'mutation', name: 'messaging.send' },
          { id, conversation, text: `scale evidence ${round} ${n}` }, { id });
        assert.equal(result.state, 'sent', JSON.stringify(result));
      }
      bursts.push({ round, writes: 64, milliseconds: performance.now() - start });
    }
    let index = 0;
    const seen = new Map();
    const ctx = { chat: () => conversation, query: async (actor, op, args) => {
      const probe = queryOrder[index++], ordinal = seen.get(probe) ?? 0;
      seen.set(probe, ordinal + 1);
      current = { condition, round, probe, ordinal, warmup: probe === 'paginationWarmup' || ordinal < 3,
        at: Date.now(), operation: op.name, hostLoad: loadavg() };
      const sample = current, start = performance.now();
      try {
        const result = await clients.get(actor).query(op, args);
        sample.client = performance.now() - start;
        sample.complete = result.complete; sample.cut = result.cut ?? null;
        assert.ok(sample.server, 'each query needs its own response timing');
        samples.push(sample); return result;
      } finally { current = null; }
    } };
    const result = await scaleProbes(ctx, `${condition}-${round}`);
    assert.equal(index, queryOrder.length);
    for (const sample of samples.filter(s => s.round === round && !s.warmup))
      sample.builderClient = result.probes[sample.probe].milliseconds[sample.ordinal - 3];
    result.deployment = `${metadata.binaryVersion}; ${hostname()}; Linux x86_64; dev --replay; condition=${condition}`;
    const doctor = JSON.parse(execFileSync(binary, ['doctor', '--latency', '--json', '--url', url], { cwd: target, encoding: 'utf8' }));
    writeFileSync(`${evidence}/${condition}-round-${round}.json`, JSON.stringify({ result, doctor }, null, 2));
    writeFileSync(`${evidence}/${condition}-samples.json`, JSON.stringify({ metadata, bursts, samples }, null, 2));
    console.log(`${condition} round ${round + 1}/${rounds}: search ${result.probes.globalSearch.p95.toFixed(3)}ms; trending ${result.probes.trending.p95.toFixed(3)}ms; load ${loadavg()[0]}`);
  }
  metadata.final = host();
  writeFileSync(`${evidence}/${condition}-samples.json`, JSON.stringify({ metadata, bursts, samples }, null, 2));
} finally {
  clearInterval(monitor);
  for (const child of busy) child.kill('SIGTERM');
  await Promise.all([...clients.values()].map(client => client.close()));
  server.kill('SIGTERM'); await serverExit;
  closeSync(serverLog);
}
