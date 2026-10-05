import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.023#10 — key-order-only React renders preserve the observation and page chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { server as appServer, binary } from './helpers/app-server.mjs';
import { processDevice } from '../dist/native.js';
const root = resolve(import.meta.dirname, '../../..');

async function browserFixture(t, harness, setup = async () => {}) {
  const require = createRequire(join(root, 'packages/snapback4/package.json'));
  const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')).href);
  const temporary = mkdtempSync(join(tmpdir(), 'sb4-row-keys-'));
  let server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); rmSync(temporary, { recursive: true, force: true }); });
  writeFileSync(join(temporary, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(temporary, 'harness.jsx'), harness);
  server = await createServer({ root: temporary, configFile: false, logLevel: 'error',
    // This immutable fixture must retain its page through held notification
    // turns; a development reload would replace the context under assertions.
    server: { hmr: false, watch: null, host: '127.0.0.1', port: 0, fs: { allow: [root, temporary] } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
      { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
      ...['client', 'react', 'local', 'web'].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === 'react' ? 'tsx' : 'ts'}`) })),
    ] } });
  await server.listen();
  browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
  await setup(page);
  await page.goto(server.resolvedUrls.local[0]);
  return page;
}

test('useQuery and usePage keep canonical arguments across renders, preserving loaded pages', async t => {
  const page = await browserFixture(t, harness);
  await page.waitForFunction(() => window.latest?.query.data && window.latest.page.items.length === 1);
  await page.evaluate(() => window.latest.page.loadMore());
  await page.waitForFunction(() => window.latest.page.items.length === 2);
  const before = await page.evaluate(() => window.calls);
  assert.equal(before, 3);
  await page.evaluate(() => { window.loading = 0; window.change(1); });
  await page.waitForFunction(() => window.latest?.mode === 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => ({ calls: window.calls, loading: window.loading, rows: window.latest.page.items.length })),
    { calls: before, loading: 0, rows: 2 });
  await page.evaluate(() => window.change(2)); // A different retention policy owns different watches.
  await page.waitForFunction(n => window.calls >= n + 2 && window.latest.query.data && window.latest.page.items.length === 1, before);
  const afterPolicy = await page.evaluate(() => window.calls);
  await page.evaluate(() => window.change(3)); // Array order is significant.
  await page.waitForFunction(n => window.calls >= n + 2 && window.latest.query.data, afterPolicy);
  await page.evaluate(() => window.finish());
});

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from 'snapback4/client';
import { SnapbackProvider, useQuery, usePage } from 'snapback4/react';
window.calls = 0; window.loading = 0;
const client = createClient({ url: 'http://row-keys.test', persona: 'alice', fetch: async (input, init) => {
  const path = new URL(input).pathname;
  if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
  if (path === '/changes') return new Promise((_, reject) => {
    if (init.signal.aborted) reject(Error('closed'));
    else init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
  });
  if (path.startsWith('/q/')) {
    window.calls++;
    const args = JSON.parse(init.body).args;
    return Response.json({ data: [args.c ? 2 : 1], complete: true, next: args.c ? null : 'next', seq: 1, tables: ['cards'] });
  }
  throw Error(path);
} });
const q = {kind:'query',name:'one'}, p = {kind:'query',name:'page'};
await client.query(q, {}); window.calls = 0;
function Screen() {
  const [mode, change] = useState(0); window.change = change;
  const ids = mode === 3 ? [2,1] : [1,2];
  const args = mode === 0 ? {id:'a', filter:{x:1,y:2}, ids} : {ids, filter:{y:2,x:1}, id:'a'};
  const options = mode >= 2 ? {keep:true} : undefined;
  const query = useQuery(q, args, options), page = usePage(p, args, options);
  if (query.loading || page.read.loading) window.loading++;
  window.latest = {mode,query,page};
  return <span>{page.items.length}</span>;
}
const root = createRoot(document.getElementById('root'));
root.render(<SnapbackProvider client={client}><Screen /></SnapbackProvider>);
window.finish = async () => { root.unmount(); await client.close(); };
`;


test('1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders', async t => {
  const page = await browserFixture(t, rowsHarness);
  page.setDefaultTimeout(hangBudget(1000));
  await page.waitForFunction(() => window.ready === 1000);
  await page.evaluate(() => { window.loading = 0; window.revalidating = 0; window.edit(); });
  await page.waitForFunction(() => window.changed === 1000);
  assert.deepEqual(await page.evaluate(() => ({ loading: window.loading, calls: window.calls, rows: window.changed })),
    { loading: 0, calls: 2000, rows: 1000 });
  assert.ok(await page.evaluate(() => window.revalidating > 0), 'queued rows keep an explicitly revalidating answer');
  await page.evaluate(() => window.finish());
});
const rowsHarness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from 'snapback4/client';
import { SnapbackProvider, useQuery } from 'snapback4/react';
// This mock tests render/answer ordering, not the one-second withdrawal law.
// Keep semantic time fixed while React and 1,000 immediate replies are serviced;
// the real-clock cases below and the expiry suite retain their timing assertions.
const wall = Date.now(); Date.now = () => wall;
window.calls = 0; window.loading = 0; window.ready = 0; window.changed = 0; window.revalidating = 0;
let seq = 1, change;
const client = createClient({ url: 'http://row-render.test', persona: 'alice', fetch: async (input, init) => {
  const path = new URL(input).pathname;
  if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
  if (path === '/changes') {
    // The fixture holds change evidence, not network progress. A long mount
    // must not trip the real five-second packet-silence watchdog.
    let cleanup;
    return new Response(new ReadableStream({
      start(controller) {
        const beat = () => controller.enqueue(new Uint8Array([32, 10]));
        const timer = setInterval(beat, 500);
        const abort = () => { cleanup(); controller.error(init.signal.reason); };
        cleanup = () => { clearInterval(timer); init.signal.removeEventListener('abort', abort); };
        change = () => {
          cleanup(); controller.enqueue(new TextEncoder().encode(JSON.stringify({seq, generation: 1, tables: ['cards']}))); controller.close();
        };
        if (init.signal.aborted) abort();
        else { init.signal.addEventListener('abort', abort, {once: true}); beat(); }
      },
      cancel() { cleanup(); }
    }));
  }
  if (path.startsWith('/q/')) { window.calls++; return Response.json({data: seq, seq, tables: ['cards']}); }
  throw Error(path);
} });
const op = {kind:'query', name:'row'}, ready = new Set(), changed = new Set();
await client.query(op, {}); window.calls = 0;
function Row({id}) {
  const read = useQuery(op, {id});
  if (read.loading) window.loading++;
  if (read.revalidating) window.revalidating++;
  if (read.data === 1) ready.add(id);
  if (read.data === 2 && !read.revalidating) changed.add(id);
  window.ready = ready.size; window.changed = changed.size;
  return <span>{read.data}</span>;
}
const root = createRoot(document.getElementById('root'));
root.render(<SnapbackProvider client={client}>{Array.from({length:1000}, (_,id) => <Row key={id} id={id}/>)}</SnapbackProvider>);
window.edit = () => { seq++; change(); };
window.finish = async () => { root.unmount(); await client.close(); };
`;

test('ready per-row completions share a React notification turn; publication does not wait for that turn', async t => {
  const page = await browserFixture(t, publicationHarness);
  await page.waitForFunction(() => window.batch?.ready());
  await page.evaluate(() => window.batch.edit());
  await page.waitForFunction(() => window.batch.replaced() === 8);
  await page.evaluate(() => window.batch.renderTurn());
  const held = await page.evaluate(() => window.batch.result());
  t.diagnostic(JSON.stringify(held));
  assert.equal(held.commits, 1, 'one invalidation render; ready rows must not each walk the entire React tree');
  assert.equal(held.loading, 0);
  assert.equal(held.replaced, 8, 'current answers publish before their batched UI notification');
  await page.evaluate(() => window.batch.release());
  await page.waitForFunction(() => window.batch.finished());
  assert.equal(await page.evaluate(() => window.batch.result().loading), 0);
  await page.evaluate(() => window.batch.finish());
});

test('a terminal refusal bypasses a held ready-notification turn and retires its pending completions', async t => {
  const page = await browserFixture(t, publicationHarness);
  await page.waitForFunction(() => window.batch?.ready());
  await page.evaluate(() => window.batch.edit());
  await page.waitForFunction(() => window.batch.replaced() === 8);
  await page.evaluate(() => window.batch.refuse());
  await page.waitForFunction(() => window.batch.denied());
  await page.evaluate(() => window.batch.release());
  await page.evaluate(() => window.batch.renderTurn());
  assert.equal(await page.evaluate(() => window.batch.denied()), true, 'late ready callbacks and bodies cannot restore data');
  await page.evaluate(() => window.batch.finish());
});

const publicationHarness = `
import React, {Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from 'snapback4/client';
import {SnapbackProvider, useQuery} from 'snapback4/react';
let seq=1, change, edited=false, held=false, commits=0, loading=0;
const turns=[], replies=[], raw=[], rendered=new Map(), originalLater=window.setTimeout.bind(window), originalFrame=window.requestAnimationFrame.bind(window);
const client=createClient({url:'http://publication-turn.test',persona:'alice',fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/schema')return Response.json({schema:{tables:{}},programs:[],generation:1});
  if(path==='/changes')return new Promise((resolve,reject)=>{
    change=body=>resolve(Response.json(body ?? {seq,generation:1,tables:['cards']}));
    init.signal.addEventListener('abort',()=>reject(Error('closed')),{once:true});
  });
  if(path.startsWith('/q/')){
    const {id}=JSON.parse(init.body).args;
    if(edited && held && id>=8)await new Promise(resolve=>replies.push(resolve));
    return Response.json({data:seq,seq,tables:['cards']});
  }
  throw Error(path);
}});
await client.query({kind:'query',name:'warm'},{});
const observe=client.observe;
client.observe=(...args)=>{const handle=observe(...args);raw.push(handle);return handle;};
const op={kind:'query',name:'row'};
function Row({id}){
  const read=useQuery(op,{id});rendered.set(id,read);
  if(edited && read.loading)loading++;
  return <span>{read.data}</span>;
}
const root=createRoot(document.getElementById('root'));
root.render(<SnapbackProvider client={client}><Profiler id="rows" onRender={()=>{if(edited)commits++;}}>
  {Array.from({length:32},(_,id)=><Row key={id} id={id}/>)}
</Profiler></SnapbackProvider>);
const replaced=()=>raw.filter(h=>h.getSnapshot().data===2).length;
window.batch={
  ready:()=>rendered.size===32 && [...rendered.values()].every(r=>r.data===1 && !r.revalidating),
  edit(){
    // Hold notification/timer turns, not response bodies or promise continuations.
    // Freeze the authorization clock during this deliberate host suspension.
    const now=Date.now();Date.now=()=>now;held=true;edited=true;
    window.setTimeout=(run,ms,...args)=>held && ms<=50 ? (turns.push(()=>run(...args)), -turns.length) : originalLater(run,ms,...args);
    window.requestAnimationFrame=run=>held ? (turns.push(run), -turns.length) : originalFrame(run);
    seq++;change();
  },
  replaced,
  result:()=>({commits,loading,replaced:replaced()}),
  refuse:()=>change({seq,generation:1,denied:{code:'E_TEST_TERMINAL',family:'auth',message:'revoked'}}),
  denied:()=>raw.every(h=>h.getSnapshot().denied?.code==='E_TEST_TERMINAL') && [...rendered.values()].every(r=>r.denied?.code==='E_TEST_TERMINAL'),
  renderTurn:()=>new Promise(resolve=>originalFrame(()=>originalFrame(resolve))),
  release(){held=false;window.setTimeout=originalLater;window.requestAnimationFrame=originalFrame;turns.splice(0).forEach(run=>run());replies.splice(0).forEach(run=>run());},
  finished:()=>[...rendered.values()].every(r=>r.data===2 && !r.revalidating),
  finish:async()=>{root.unmount();await client.close();}
};
`;

for (const tier of ['wasm', 'worker', 'process']) test(`${tier}: 1,000 per-row hooks retain through a relevant write with the real clock`, async t => {
  const { url, dir } = await appServer(t, '', readFileSync(new URL('../../../witness/per-row.q', import.meta.url), 'utf8'));
  const seed = Array.from({ length: 1000 }, (_, slot) => ({ table: 'cards', row: { id: 'c' + slot, slot, owner: 'dev:alice', label: 'original' } }));
  assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(seed) }).then(r => r.json())).seeded, 1000);
  const cores = [];
  t.after(async () => {
    await Promise.all(cores.map(async opened => { const core = await opened.catch(() => undefined); await core?.close(); }));
  });
  const page = await browserFixture(t, localRowsHarness, async page => {
    await page.addInitScript(config => { window.pqConfig = config; }, { url, tier });
    if (tier === 'process') {
      // The hooks and SDK run in Chromium; these bindings carry the unmodified
      // process adapter's device calls to its real SQLite process on Node.
      // A development-server reload can open another device. Each bridge owns
      // its handle, and teardown closes even handles abandoned by that reload.
      await page.exposeFunction('pqOpen', async (name, backend) => {
        const id = cores.length;
        const opened = processDevice({ binary, dir: join(dir, 'react-device') }).open(name, backend);
        cores.push(opened);
        await opened;
        return id;
      });
      await page.exposeFunction('pqCall', async (id, request) => (await cores[id]).call(request));
      await page.exposeFunction('pqClose', async id => (await cores[id]).close());
    }
  });
  page.setDefaultTimeout(hangBudget(1000));
  await page.waitForFunction(() => window.pq?.ready);
  if (tier === 'process') {
    const opened = cores.length;
    await page.reload();
    await page.waitForFunction(() => window.pq?.ready);
    assert.ok(cores.length > opened, 'a reload owns a new process handle');
  }
  await page.evaluate(() => window.pq.edit());
  await page.waitForFunction(() => window.pq?.finished() || window.pq?.result().loading > 0);
  const result = await page.evaluate(() => window.pq.result());
  t.diagnostic(JSON.stringify({ tier, ...result }));
  assert.equal(result.loading, 0, 'no loading render after the relevant write');
  assert.equal(result.calls, 2000, 'one mount and one replacement per distinct observation');
  assert.equal(result.revalidated, 1000);
  assert.ok(result.lastStart - result.firstStart > 1000, 'later attempts wait beyond the one-second episode bound');
  assert.equal(result.wallIsReal, true);
  assert.equal(result.link, 'online', 'the controlled feed remains live during the queue');
  await page.evaluate(() => window.pq.finish());
});

const localRowsHarness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackProvider, useQuery } from 'snapback4/react';
import { createLocalClient } from 'snapback4/local';
import { webDevice } from 'snapback4/web';
const {url, tier} = window.pqConfig, reads = new Map(), revalidated = new Set(), starts = [];
let edited = false, loading = 0, calls = 0;
const wall = Date.now(), realStart = performance.now();
const base = tier === 'process' ? { async open(name, backend) {
  const id = await window.pqOpen(name, backend);
  return { call: request => window.pqCall(id, request), close: () => window.pqClose(id) };
} } : webDevice({worker: tier === 'worker'});
const client = await createLocalClient({url, persona:'alice', name:'pq-real-clock', device:{async open(...args){
  const core = await base.open(...args);
  return {...core, async call(request, committed) {
    if(request.op === 'query') {
      calls++;
      if(edited) {
        starts.push(Date.now());
        // Short service time per attempt forces >1s aggregate queue wait.
        // No clock or episode duration is altered.
        await new Promise(resolve => setTimeout(resolve, 15));
      }
    }
    return core.call(request, committed);
  }};
}}, fetch: (input, init) => {
  if(new URL(input).pathname !== '/changes') return fetch(input,init);
  // Hold change evidence so edit() owns the sync, but keep the real link
  // watchdog healthy throughout mount and the >1s replacement queue.
  let timer;
  return Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      const stop = () => {clearInterval(timer); controller.close();};
      if(init.signal.aborted) {stop(); return;}
      timer = setInterval(() => controller.enqueue(new Uint8Array([32])), 1000);
      init.signal.addEventListener('abort',stop,{once:true});
    },
    cancel(){clearInterval(timer);}
  })));
}});
await client.sync(); calls = 0;
const op = {kind:'query',name:'point'};
function Row({id}) {
  const read = useQuery(op,{id:'c'+id}); reads.set(id,read);
  if(edited && read.loading) loading++;
  if(edited && read.revalidating) revalidated.add(id);
  return <span>{read.data?.label ?? 'loading'}</span>;
}
const root = createRoot(document.getElementById('root'));
root.render(<SnapbackProvider client={client}>{Array.from({length:1000}, (_,id)=><Row key={id} id={id}/>)}</SnapbackProvider>);
const ready = () => reads.size === 1000 && [...reads.values()].every(r => r.data && !r.revalidating);
window.pq = {
  get ready(){return ready();},
  async edit(){
    edited = true;
    const reply = await fetch(url+'/m/edit',{method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify({id:crypto.randomUUID(),args:{id:'c0',label:'changed'}})}).then(r=>r.json());
    if(reply.state !== 'sent') throw Error(JSON.stringify(reply));
    await client.sync();
  },
  finished: () => ready() && calls === 2000 && reads.get(0).data.label === 'changed',
  result: () => ({loading,calls,revalidated:revalidated.size,firstStart:starts[0],lastStart:starts.at(-1),wallIsReal:Date.now()-wall >= 1000 && performance.now()-realStart >= 1000,link:client.link()}),
  finish: async () => {root.unmount(); await client.close();}
};
`;
