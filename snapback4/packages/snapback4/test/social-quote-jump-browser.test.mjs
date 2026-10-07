import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guest } from 'snapback4/auth';
import { binary, server } from './helpers/app-server.mjs';
import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';

const root = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(root, 'package.json'));
// Actual RN-web layout/virtualization, published hooks, generated Quarry and HTTP.
// DOM mounting alone cannot satisfy the quote-jump regression.
test('social quote jumps with real FlatList layout and history reads', { timeout: hangBudget(65) }, async t => {
  const dir = mkdtempSync(join(root, '.social-quote-jump-'));
  let vite, browser;
  t.after(async () => { await browser?.close(); await vite?.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const args of [['new', dir, '--template', 'social'], ['check']]) {
    const run = spawnSync(binary, args, { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  const { url } = await server(t, undefined, readFileSync(join(dir, 'snapback/schema.q'), 'utf8'));
  const signed = await guest(url); assert.equal(signed.ok, true);
  const session = signed.session, owner = session.principal, rows = [];
  for (const [conversation, count] of [['far', 32], ['visible', 2], ['absent', 32], ['beyond-horizon', 532]]) {
    rows.push({ table: 'conversations', row: { id: conversation, title: conversation, creatorId: owner, lastOrdinal: count } });
    rows.push({ table: 'members', row: { id: `${conversation}-member`, conversation, principal: owner, joinedOrdinal: 0, deliveredOrdinal: count, seenOrdinal: 0 } });
    for (let ordinal = 1; ordinal <= count; ordinal++) {
      if (conversation === 'absent' && ordinal === 1) continue;
      rows.push({ table: 'messages', row: { id: `${conversation}-${ordinal}`, conversation, sender: owner, ordinal, recipients: 0,
        text: ordinal === 1 ? `Original ${conversation}` : ordinal === count ? `Reply ${conversation}` : `Message ${ordinal} ${'variable height text '.repeat(ordinal % 9)}`,
        photo: null, replyTo: ordinal === count ? `${conversation}-1` : null, at: ordinal } });
    }
  }
  const seeded = await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ url, session }));
  writeFileSync(join(dir, 'device.wasm'), readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')));
  writeFileSync(join(dir, 'picker.js'), 'export async function launchImageLibraryAsync() { return { canceled: true }; }');
  writeFileSync(join(dir, 'index.html'), '<style>html,body,#root{margin:0;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}</style><div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, 'harness.jsx'), `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FlatList} from 'react-native';
import {SnapbackProvider} from 'snapback4/react';
import {createClient} from 'snapback4/client';
import {createApp} from 'snapback4/app';
import {memorySessionStore, keepSession} from 'snapback4/auth';
import {webDevice, memoryPersistence} from 'snapback4/web';
import {ConversationScreen} from './src/Conversation';
import {api} from './snapback/generated/api';
const {url,session} = await (await fetch('/fixture.json')).json();
window.calls=[];
const monitoredFetch=(input,init)=>{const path=new URL(input instanceof Request?input.url:input).pathname;if(path.startsWith('/q/'))window.calls.push({path,args:JSON.parse(init.body).args});return fetch(input,init);};
const store=memorySessionStore(); await keepSession(url,session,store);
const replica = new URLSearchParams(location.search).has('replica');
const app=replica?createApp({url,sessionStore:store,fetch:monitoredFetch,device:webDevice({wasm:fetch('/device.wasm'),persist:memoryPersistence()})}):null;
if(app){const opened=await app.ready;if(!opened.ok)throw Error(JSON.stringify(opened));await app.client.sync();}
const client=app?.client??createClient({url,session,fetch:monitoredFetch});
window.scrollAttempts=0;window.scrollFailures=0;
const scroll=FlatList.prototype.scrollToIndex;
FlatList.prototype.scrollToIndex=function(args){window.scrollAttempts++;if(window.failScroll){window.failScroll--;window.scrollFailures++;this.props.onScrollToIndexFailed({index:args.index,averageItemLength:70,highestMeasuredFrameIndex:0});return;}return scroll.call(this,args);};
const offset=FlatList.prototype.scrollToOffset;
FlatList.prototype.scrollToOffset=function(args){if(!window.blockScroll)return offset.call(this,args);};
function Screen(){const [conversation,setConversation]=useState('far');window.route=setConversation;return <SnapbackProvider client={client}><ConversationScreen conversation={conversation} url={url}/></SnapbackProvider>;}
const root=createRoot(document.getElementById('root'));root.render(<Screen/>);
window.readHistory=args=>client.query(api.history,args);
window.finish=async()=>{root.unmount();await (app?app.close():client.close());};
window.fixtureReady=true;
`);
  const viteModule = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')).href);
  // Bundle RN-web's CommonJS dependencies before mounting the immutable fixture.
  await viteModule.build({ root: dir, configFile: false, logLevel: 'error',
    resolve: { alias: [
      { find: /^react-native$/, replacement: require.resolve('react-native-web').replace('/dist/cjs/', '/dist/') },
      { find: 'expo-image-picker', replacement: join(dir, 'picker.js') },
      { find: './intent-store', replacement: join(dir, 'src/intent-store.web.ts') },
    ] }, esbuild: { jsx: 'automatic' }, build: { target: 'esnext', outDir: 'built', minify: false },
  });
  for (const name of ['fixture.json', 'device.wasm']) writeFileSync(join(dir, 'built', name), readFileSync(join(dir, name)));
  vite = await createBrowserServer({ root: join(dir, 'built'), configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  await vite.listen();
  browser = await require('playwright-core').chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  for (const tier of ['online', 'replica']) await t.test(tier, async t => {
    const page = await browser.newPage({ viewport: { width: 520, height: 800 } }), errors = [];
    t.after(() => page.close());
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    page.setDefaultTimeout(10000);
    await loadBrowserPage(t, page, vite.resolvedUrls.local[0] + (tier === 'replica' ? '?replica' : ''));
    await page.waitForFunction(() => window.fixtureReady);
    const composer = page.getByTestId('composer');
    const quote = name => page.getByRole('button', { name: `Jump to quoted message: Original ${name}`, exact: true });
    const viewport = async id => page.evaluate(id => {
      const bubble=document.querySelector('[data-testid="message-'+id+'"]'),list=document.querySelector('[data-testid="history"]');
      if(!bubble||!list)return null;
      const b=bubble.getBoundingClientRect(),v=list.getBoundingClientRect();
      return {top:b.top,bottom:b.bottom,viewportTop:v.top,viewportBottom:v.bottom,highlighted:bubble.getAttribute('aria-label')==='Highlighted message',color:getComputedStyle(bubble).backgroundColor};
    }, id);
    const assertJump = async (name, id) => {
      await quote(name).waitFor();
      await page.evaluate(() => {window.jumpStarted=performance.now();});
      await quote(name).click();
      await page.waitForFunction(id => {
        const bubble=document.querySelector('[data-testid="message-'+id+'"]'),list=document.querySelector('[data-testid="history"]');
        if(!bubble||!list)return false;
        const b=bubble.getBoundingClientRect(),v=list.getBoundingClientRect();
        if(b.top>=v.top&&b.bottom<=v.bottom&&b.top>=0&&b.bottom<=innerHeight&&bubble.getAttribute('aria-label')==='Highlighted message'){
          window.jumpElapsed=performance.now()-window.jumpStarted;return true;
        }return false;
      }, id, {timeout:4000});
      const evidence = await viewport(id);
      assert.equal(evidence.color,'rgb(255, 232, 154)');
      const elapsed = await page.evaluate(() => window.jumpElapsed);assert.ok(elapsed<4000, JSON.stringify({elapsed,evidence}));
      t.diagnostic(JSON.stringify({tier,name,elapsed,...evidence}));
    };
    await t.test('30 intervening messages: original enters viewport and draft keeps its owner', async () => {
      await quote('far').waitFor();
      assert.equal(await page.getByTestId('message-far-1').count(), 0);
      await composer.fill('Draft survives quote jump');
      await page.evaluate(() => {window.composerNode=document.querySelector('[data-testid="composer"]');});
      await assertJump('far','far-1');
      assert.equal(await composer.inputValue(),'Draft survives quote jump');
      assert.equal(await composer.evaluate(node=>node===window.composerNode),true);
      await page.getByRole('button',{name:'Latest messages',exact:true}).click();
      await quote('far').waitFor();
      assert.equal(await composer.inputValue(),'Draft survives quote jump');
    });
    await t.test('already visible original highlights without moving the list; highlight clears', async () => {
      await page.evaluate(()=>window.route('visible'));
      await quote('visible').waitFor();
      const before = await viewport('visible-1');assert.ok(before.top>=before.viewportTop&&before.bottom<=before.viewportBottom);
      await assertJump('visible','visible-1');
      assert.equal((await viewport('visible-1')).top,before.top);
      await page.waitForFunction(()=>!document.querySelector('[aria-label="Highlighted message"]'),null,{timeout:3000});
    });
    await t.test('absent original says unavailable and cannot move the list', async () => {
      await page.evaluate(()=>window.route('absent'));
      const unavailable=page.getByText('Quoted message unavailable',{exact:true});await unavailable.waitFor();
      assert.equal(await page.getByRole('button',{name:/Jump to quoted/}).count(),0);
      const before=await viewport('absent-32'),attempts=await page.evaluate(()=>window.scrollAttempts);
      await unavailable.click();
      assert.equal((await viewport('absent-32')).top,before.top);
      assert.equal(await page.evaluate(()=>window.scrollAttempts),attempts);
      assert.equal(await page.getByRole('button',{name:'Latest messages',exact:true}).count(),0);
    });
    await t.test('one anchored read reaches beyond the 500-row sync horizon', async () => {
      await page.evaluate(()=>{window.calls=[];window.route('beyond-horizon');});
      await quote('beyond-horizon').waitFor();
      assert.equal(await page.getByTestId('message-beyond-horizon-1').count(),0);
      await assertJump('beyond-horizon','beyond-horizon-1');
      const anchored=await page.evaluate(()=>window.calls.filter(call=>call.path==='/q/history'&&call.args.through===1));
      assert.ok(anchored.length>=1,JSON.stringify(await page.evaluate(()=>window.calls)));
      assert.ok(anchored.every(call=>call.args.c==null),'no distance-proportional cursor scan');
    });
    await t.test('reply affordance sends the original ID with the text', async () => {
      await page.evaluate(()=>window.route('visible'));
      await quote('visible').waitFor();
      await page.getByTestId('message-visible-1').getByRole('button',{name:'Reply',exact:true}).click();
      await page.getByRole('button',{name:'Cancel reply',exact:true}).waitFor();
      await composer.fill('UI reply '+tier);
      await page.getByRole('button',{name:'Send',exact:true}).click();
      await page.waitForFunction(async text=>(await window.readHistory({conversation:'visible'})).data?.some(row=>row.text===text&&row.replyTo==='visible-1'),'UI reply '+tier);
    });
    await t.test('loaded offscreen original retries an unmeasured index and scrolls into view', async () => {
      await page.evaluate(()=>window.route('far'));
      await quote('far').waitFor();
      await page.getByRole('button',{name:'Older messages',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-testid="history"]') && [...document.querySelectorAll('[role="button"]')].some(node=>node.textContent==='Older messages'&&node.getAttribute('aria-disabled')==='true'));
      const before=await viewport('far-1');
      assert.ok(!before||before.top>=before.viewportBottom,JSON.stringify(before));
      const failures=await page.evaluate(()=>{window.failScroll=1;return window.scrollFailures;});
      await assertJump('far','far-1');
      assert.equal(await page.evaluate(()=>window.scrollFailures),failures+1);
      assert.equal(await page.getByRole('button',{name:'Latest messages',exact:true}).count(),0,'loaded target needs no replacement window');
    });
    await t.test('failed scrolling stops at four seconds, keeps draft, and permits an explicit retry', async () => {
      await page.evaluate(()=>window.route('absent'));
      await page.getByText('Quoted message unavailable',{exact:true}).waitFor();
      await page.evaluate(()=>window.route('far'));
      await quote('far').waitFor();
      await page.getByRole('button',{name:'Older messages',exact:true}).click();
      await page.waitForFunction(()=>[...document.querySelectorAll('[role="button"]')].some(node=>node.textContent==='Older messages'&&node.getAttribute('aria-disabled')==='true'));
      await composer.fill('Kept through timeout');
      await page.evaluate(()=>{window.blockScroll=true;window.failScroll=10000;});
      await quote('far').click();
      await page.getByText('Could not reach quoted message. Tap the quote to retry.',{exact:true}).waitFor({timeout:5000});
      assert.equal(await page.locator('[aria-label="Highlighted message"]').count(),0);
      assert.equal(await composer.inputValue(),'Kept through timeout');
      await page.evaluate(()=>{window.blockScroll=false;window.failScroll=0;});
      await assertJump('far','far-1');
    });
    await page.evaluate(()=>window.finish());assert.deepEqual(errors,[]);
  });
});
