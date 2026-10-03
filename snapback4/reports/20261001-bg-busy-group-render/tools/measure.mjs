import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, cpus, loadavg, availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { signup } from '../../../packages/snapback4/dist/auth.js';
import { chromiumExecutable } from '../../../witness/lib.mjs';

const root = resolve(import.meta.dirname, '../../..');
const pollers=Number(process.env.BG_POLLERS ?? 0);
const runs = Number(process.env.BG_RUNS ?? 50);
const out = resolve(process.env.BG_OUT ?? join(root, 'reports/20261001-bg-busy-group-render/qualification.json'));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4-ll-measure');
const dir = mkdtempSync(join(tmpdir(), 'sb4-ll-'));
mkdirSync(join(dir, 'snapback'));
for (const name of ['schema.q', 'config.q']) copyFileSync(join(import.meta.dirname, '../calibration', name), join(dir, 'snapback', name));
copyFileSync(join(import.meta.dirname, 'page.jsx'), join(dir, 'page.jsx'));
writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/page.jsx"></script>');
const cache = process.env.BG_SEED_CACHE;
if (cache && existsSync(cache + '.sqlite')) {mkdirSync(join(dir,'.snapback4'));copyFileSync(cache+'.sqlite',join(dir,'.snapback4/store.sqlite'));}
const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, env: { ...process.env, LL_COMMIT_TRACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '', buffer = '';
const commits = [],serverEvents=[];
host.stdout.on('data', x => output += x);
host.stderr.on('data', x => {
  if (!String(x).startsWith('LL_') && !String(x).startsWith('BG_')) errors += x; buffer += x;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if(line.startsWith('BG_')) serverEvents.push(line);
    const match = /^LL_COMMIT (\S+) (\d+) ([\d.]+)$/.exec(line);
    if (match) commits.push({ name: match[1], seq: Number(match[2]), at: Number(match[3]) });
  }
});
let browser, vite, stopPolls;
const pollTasks=[],pollEvents=[];
const nodeNow = () => performance.timeOrigin + performance.now();
const samples = [];
async function until(fn, label, timeout = 15000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const result = await fn(); if (result) return result; await delay(10); }
  throw Error('timeout: ' + label + '\n' + errors.slice(-2500));
}
try {
  const url = await until(() => { if (host.exitCode !== null) throw Error(errors); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, 'server');
  const sessions = cache && existsSync(cache+'.json') ? JSON.parse(readFileSync(cache+'.json','utf8')) : [];
  if (!sessions.length) {
  for (let i = 0; i < 50; i++) {
    const signed = await signup(url, `member${i}@example.test`, 'long-test-password');
    assert.ok(signed.ok, JSON.stringify(signed)); sessions.push(signed.session);
  }
  }
  const principals = sessions.map(s => s.principal);
  const a = principals[0];
  const rows = [
    ...principals.map((principal,i) => ({table:'profiles',row:{id:'p'+i,principal,displayName:'Member '+i,handle:'member'+i,bio:'',location:''}})),
    {table:'conversations',row:{id:'room',kind:'group',title:'Busy room',description:'',creator:a,lastOrdinal:10000}},
    ...principals.map((principal,i) => ({table:'members',row:{id:'member'+i,conversation:'room',principal,role:i===0?'admin':'member',joinedOrdinal:0,seenOrdinal:0,deliveredOrdinal:0}})),
    ...Array.from({length:10000}, (_,i) => ({table:'messages',row:{id:'msg'+i,conversation:'room',sender:principals[i%50],ordinal:i+1,recipients:49,text:'History '+i,at:Date.now()-100000+i}}))
  ];
  if (!cache || !existsSync(cache+'.sqlite')) {
  const seeded = await fetch(url+'/seed',{method:'POST',body:JSON.stringify(rows)}).then(x=>x.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  console.log('seeded', rows.length);
  if (cache) {
    execFileSync('python3',['-c','import sqlite3,sys; a=sqlite3.connect(sys.argv[1]); b=sqlite3.connect(sys.argv[2]); a.backup(b)',join(dir,'.snapback4/store.sqlite'),cache+'.sqlite']);
    writeFileSync(cache+'.json',JSON.stringify(sessions),{mode:0o600});
  }
  }
  const pollAbort = new AbortController();
  // Optional extra pollers are outside the three-viewer calibration shape.
  for (let i=3;i<3+pollers;i++) pollTasks.push((async()=>{
    let since=0;
    while (!pollAbort.signal.aborted) {
      try {
        const started=nodeNow();
        const reply=await fetch(url+`/changes?since=${since}&wait=25`,{headers:{authorization:`Bearer ${sessions[i].token}`},signal:pollAbort.signal}).then(x=>x.json());
        if(reply.denied) {await delay(1000);continue;}
        pollEvents.push({member:i,started,at:nodeNow(),seq:reply.seq}); since=reply.seq;
      } catch(e) { if(!pollAbort.signal.aborted) throw e; }
    }
  })());
  stopPolls=()=>pollAbort.abort();
  const require = createRequire(join(root, 'package.json'));
  const { chromium } = require('playwright-core');
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')));
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  vite = await createServer({ root: dir, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    { find: '/bg-wasm.js', replacement: join(root, 'packages/snapback4/dist/wasm/snapback4_device.js') },
    ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
    ...['local', 'web', 'react', 'app', 'auth'].map(name => ({ find: 'snapback4/' + name, replacement: join(root, 'packages/snapback4/dist/' + name + '.js') })),
  ] } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [];
  for (const [index, session] of sessions.slice(0,3).entries()) {
    const context=await browser.newContext();
    const page=await context.newPage(); pages.push(page);
    page.on('pageerror',e=>{errors+='\nBROWSER '+e.stack;});
    console.log('opening viewer',index);
    page.on('console',msg=>{if(msg.text().startsWith('BG ')) console.log(index,msg.text());});
    await page.goto(vite.resolvedUrls.local[0]);
    await page.waitForFunction(()=>window.openClient);
    await page.evaluate(options=>window.openClient(options),{url,session,index});
    console.log('opened viewer',index);
  }
  const [sender,...receivers]=pages;
  for (const page of pages) await until(()=>page.locator('[data-message="msg9999"]').count(),'React history',120000);
  await delay(1000);
  for (const page of pages) await page.evaluate(()=>window.allEvents=[]);
  for (let run=0;run<runs;run++) {
    const value='busy-'+run;
    for (const page of pages) await page.evaluate(value=>window.prepare(value), value);
    const commitStart=commits.length,pollStart=pollEvents.length;
    const write=await sender.evaluate(value=>window.perform(value),value);
    const views=[];
    for (const receiver of receivers) {
      await until(()=>receiver.evaluate(()=>window.trial().reactCommit),'render '+run,120000);
      views.push({trial:await receiver.evaluate(()=>window.trial()),events:await receiver.evaluate(()=>window.events)});
    }
    const senderEvents=await sender.evaluate(()=>window.events);
    const commit=commits.slice(commitStart).find(c=>c.name==='send');
    assert.ok(commit,'instrumented commit');
    // Capture all recipients' notification, plus receipt-triggered follow-up work.
    await until(()=>pollEvents.slice(pollStart).filter(e=>e.seq>=commit.seq).length>=pollers,'all member polls',120000);
    samples.push({run,commit,senderEvents,views,polls:pollEvents.slice(pollStart),commits:commits.slice(commitStart)});
    console.log(JSON.stringify({run,commit:commit.at-senderEvents.find(e=>e.stage==='sender-call').at,render:views.map(v=>v.trial.reactCommit-senderEvents.find(e=>e.stage==='sender-call').at)}));
    writeFileSync(out,JSON.stringify({metadata:{profile:process.env.BG_PROFILE??'dev',runs,members:50,messages:10000,mountedWindow:20,acquisitionWindow:500,viewers:3,pollers,cpu:cpus()[0].model,load:loadavg(),browser:browser.version(),clock:'UNIX ms on one host',binary},samples,serverEvents,errors},null,2));
  }
  // Continue the trace across sample boundaries: a poll may return after a
  // concurrent sync already rendered the send. Do not force another sync.
  await until(async()=> (await Promise.all(pages.map(page=>page.evaluate(seq=>window.allEvents.some(e=>e.stage==='response'&&e.path==='/changes'&&e.seq>=seq),samples.at(-1).commit.seq)))).every(Boolean),'final notification',120000);
  const final=JSON.parse(readFileSync(out));
  final.allEvents=await Promise.all(pages.map(page=>page.evaluate(()=>window.allEvents)));
  writeFileSync(out,JSON.stringify(final,null,2));
  if (process.env.BG_MAX_P95) {
    const times=samples.map(s=>Math.max(...s.views.map(v=>v.trial.reactCommit-s.senderEvents.find(e=>e.stage==='sender-call').at))).sort((a,b)=>a-b);
    assert.ok(times[Math.ceil(times.length*.95)-1]<Number(process.env.BG_MAX_P95),'send-to-slower-viewer p95 bound');
  }
  assert.ok(!errors.includes('BROWSER '),errors);

} finally {
  stopPolls?.(); await Promise.allSettled(pollTasks);
  await browser?.close();
  await vite?.close();
  const exited = new Promise(resolve => host.once('exit', resolve));
  if (host.exitCode === null) { host.kill(); await exited; }
  rmSync(dir, { recursive: true, force: true });
}
