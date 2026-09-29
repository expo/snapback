// node witness/per-row.mjs [output.jsonl]; PQ_TIERS/PQ_SIZES/PQ_SHAPES select cells.
import { mkdtempSync, cpSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, devServer, root } from './lib.mjs';
import { createLocalClient } from '../packages/snapback4/dist/local.js';
import { processDevice } from '../packages/snapback4/dist/native.js';
import { exercise, instrumentation, pause } from './per-row-workload.mjs';
const sourceDir = mkdtempSync(join(tmpdir(), 'sb4-pq-'));
cpSync(join(root, process.env.PQ_CHAT ? 'witness/per-row-chat.q' : 'witness/per-row.q'), join(sourceDir, 'schema.q'));
const sizes = (process.env.PQ_SIZES ?? '100,500,1000').split(',').map(Number);
const tiers = (process.env.PQ_TIERS ?? 'wasm,worker,online,process').split(',');
const shapes = (process.env.PQ_SHAPES ?? 'point,page,duplicate,list').split(',');
const seed = Array.from({ length: 1000 }, (_, slot) => ({ table: 'cards', row: { id: 'c' + slot, slot, label: 'card ' + slot, owner: 'dev:alice' } }));
if (process.env.PQ_CHAT) {
  seed.length = 0;
  for (const person of ['alice', 'bob']) seed.push({ table: 'profiles', row: { id: person, principal: 'dev:' + person, displayName: person, handle: person, bio: null, location: null, link: null, avatar: null } });
  for (let i = 0; i < 1000; i++) {
    seed.push({ table: 'conversations', row: { id: 'c' + i, kind: 'group', title: 'Group ' + i, description: null, creatorId: 'dev:alice', lastOrdinal: 0, disappearing: 'off', accent: null, background: null } });
    for (const person of ['alice', 'bob']) seed.push({ table: 'members', row: { id: 'c' + i + '-' + person, conversation: 'c' + i, principal: 'dev:' + person, role: 'admin', joinedOrdinal: 0, deliveredOrdinal: 0, seenOrdinal: 0 } });
  }
}
const output = process.argv[2];
const emit = record => { const line = JSON.stringify(record); console.log(line); if (output) appendFileSync(output, line + '\n'); };
let browser, cpuCdp, browserCdp;
const rss = pid => { try { return Number(readFileSync('/proc/' + pid + '/status', 'utf8').match(/VmRSS:\s+(\d+)/)[1]) * 1024; } catch { return 0; } };
const processInfo = pid => { try { const stat = readFileSync('/proc/' + pid + '/stat', 'utf8').split(' '); return { rss: rss(pid), cpuSeconds: (Number(stat[13]) + Number(stat[14])) / 100 }; } catch { return { rss: 0, cpuSeconds: 0 }; } };
const sourceOverrides = {};
if (process.env.PQ_BASELINE) for (const name of ['local.ts', 'local-reads.ts', 'local-query.ts', 'local-search.ts', 'client.ts', 'observe-watch.ts', 'react.tsx', 'read-observation.ts', 'read-expiry.ts']) {
  sourceOverrides[join(root, 'packages/snapback4/src', name)] = execFileSync('git', ['show', (process.env.PQ_BASELINE === '1' ? 'ac5c4e21c86c7d54552cfd0316e66d06ba69d492' : process.env.PQ_BASELINE) + ':snapback4/packages/snapback4/src/' + name], { encoding: 'utf8' });
}
if (process.env.PQ_TRACE) sourceOverrides[join(root, 'packages/snapback4/src/client.ts')] = readFileSync(join(root, 'packages/snapback4/src/client.ts'), 'utf8').replace('function scheduleRead(watch: Watch) {', 'function scheduleRead(watch: Watch) { const k = new Error().stack?.split("\\n").slice(2,5).join("|"); const counters = (globalThis as any).pqSchedules ??= {}; counters[k!] = (counters[k!] ?? 0) + 1;');
try {
  if (tiers.some(t => t !== 'process')) browser = await launch({ sourceDir, seed, sourceOverrides, entrySource: `import '${join(root, 'witness/per-row-browser.tsx')}';` });
  if (browser && process.env.PQ_TIMEOUT) await browser.page.addInitScript(ms => { window.pqTimeout = ms; }, Number(process.env.PQ_TIMEOUT));
  if (browser && process.env.PQ_PREFILL) { for (const [name, args] of [['edit',{id:'c0',label:'prefilled'}],['unrelated',{}]]) await fetch(browser.api + '/m/' + name, {method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify({id:crypto.randomUUID(),args})}); }
  if (browser) await browser.page.exposeFunction('pqCpu', async () => (await cpuCdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration')?.value);
  if (browser) {
    browserCdp = await browser.page.context().browser().newBrowserCDPSession();
    await browser.page.exposeFunction('pqHost', async () => { const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo'); const renderers = processInfo.filter(p => p.type === 'renderer'); return { rss: renderers.reduce((n,p) => n + rss(p.id), 0), cpuSeconds: renderers.reduce((n,p) => n + p.cpuTime, 0) }; });
  }
  for (const tier of tiers) for (const n of sizes) for (const shape of shapes) {
    try {
      if (tier !== 'process') {
        await browser.reload();
        await browser.page.waitForFunction(() => typeof window.measure === 'function');
        const cdp = await browser.page.context().newCDPSession(browser.page);
        await cdp.send('Performance.enable');
        cpuCdp = cdp;
        const result = await browser.page.evaluate(({ url, tier, n, shape }) => window.measure(url, tier, n, shape), { url: browser.api, tier, n, shape });
        const metrics = await cdp.send('Performance.getMetrics'); await cdp.detach();
        emit({ tier, ...result, rendererTaskSeconds: metrics.metrics.find(m => m.name === 'TaskDuration')?.value });
      } else {
        const server = await devServer({ sourceDir, seed });
        const meter = instrumentation(); let devicePid;
        globalThis.pqHost = () => processInfo(devicePid);
        const client = await createLocalClient({ url: server.api, persona: 'alice', fetch: meter.fetch, waitSeconds: 1,
          device: meter.device(processDevice({ binary: resolve(root, 'target/debug/snapback4'), dir: join(server.app, 'device'), spawn(...args) { const child = spawn(...args); devicePid = child.pid; return child; } })), name: 'pq' });
        let observations = [];
        try {
          await client.sync(); await pause(200);
          const result = await exercise({ client, url: server.api, n, shape, meter,
            mount: async requests => { observations = requests.map(({ op, args }) => { const w = client.observe(op, args); w.subscribe(() => {}); return w; }); },
            snapshots: () => observations.map(w => w.getSnapshot()), unmount: async () => observations.forEach(w => w.close()) });
          emit({ tier, ...result, longestMainThreadTaskMs: null });
        } finally { await client.close(); await server.close(); }
      }
    } catch (error) { emit({ tier, n, shape, error: String(error) }); }
  }
} finally { await browser?.close(); rmSync(sourceDir, { recursive: true, force: true }); }
