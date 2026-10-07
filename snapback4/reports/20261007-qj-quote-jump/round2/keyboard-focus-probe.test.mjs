// Adapted from Astra qj-r1 keyboard-focus probe; only paths are made lane-local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { symlinkSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guest } from '../../../packages/snapback4/dist/auth.js';
import { binary, server } from '../../../packages/snapback4/test/helpers/app-server.mjs';
import { createBrowserServer, loadBrowserPage } from '../../../packages/snapback4/test/helpers/browser-server.mjs';
import { hangBudget } from '../../../packages/snapback4/test/helpers/wait.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';

const root = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(root, 'package.json'));
// Actual RN-web layout/virtualization, published hooks, generated Quarry and HTTP.
// DOM mounting alone cannot satisfy the quote-jump regression.
test('social quote jumps with real FlatList layout and history reads', { timeout: hangBudget(90) }, async t => {
  const dir = mkdtempSync(join(root, '.qj-r2-keyboard-inputs-')); symlinkSync(join(root,'node_modules'),join(dir,'node_modules'));
  let vite, browser;
  t.after(async () => { await browser?.close(); await vite?.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const args of [['new', dir, '--template', 'social'], ['check']]) {
    const run = spawnSync(binary, args, { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  const { url } = await server(t, undefined, readFileSync(join(dir, 'snapback/schema.q'), 'utf8'));
  const signed = await guest(url); assert.equal(signed.ok, true);
  const second = await guest(url); assert.equal(second.ok,true); const secondSession=second.session; const session = signed.session, owner = session.principal, rows = [];
  for (const [conversation, count] of [['far', 32], ['visible', 2], ['absent', 32], ['beyond-horizon', 532], ['late', 32], ['above', 32], ['gesture', 32], ['keyboard', 32], ['native-drag', 32],['probe-wheel', 32],['probe-keyboard', 32],['probe-touch', 32],['probe-pointer', 32],['probe-route', 32],['probe-account', 32],['probe-new', 32],['probe-expiry', 32],['probe-jank', 32],['probe-body-keyboard', 32]]) {
    rows.push({ table: 'conversations', row: { id: conversation, title: conversation, creatorId: owner, lastOrdinal: count } });
    rows.push({ table: 'members', row: { id: `${conversation}-member`, conversation, principal: owner, joinedOrdinal: 0, deliveredOrdinal: count, seenOrdinal: 0 } });
    for (let ordinal = 1; ordinal <= count; ordinal++) {
      if (conversation === 'absent' && ordinal === 1) continue;
      const delayed = ['late', 'above', 'gesture', 'keyboard', 'native-drag', 'probe-wheel', 'probe-keyboard', 'probe-touch', 'probe-pointer', 'probe-route', 'probe-account', 'probe-new', 'probe-expiry', 'probe-jank', 'probe-body-keyboard'].includes(conversation);
      rows.push({ table: 'messages', row: { id: `${conversation}-${ordinal}`, conversation, sender: owner, ordinal, recipients: 0,
        text: delayed && ordinal === 1 ? 'Nested '.repeat(280) : delayed && ordinal === 2 ? `Original ${conversation}` : ordinal === 1 ? `Original ${conversation}` : ordinal === count ? `Reply ${conversation}` : `Message ${ordinal} ${'variable height text '.repeat(ordinal % 9)}`,
        photo: null, replyTo: delayed ? (ordinal === (conversation === 'above' ? 3 : 2) ? `${conversation}-1` : ordinal === count ? `${conversation}-2` : null) : ordinal === count ? `${conversation}-1` : null, at: ordinal } });
    }
  }
  const seeded = await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ url, session, secondSession }));
  writeFileSync(join(dir, 'device.wasm'), readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')));
  writeFileSync(join(dir, 'picker.js'), 'export async function launchImageLibraryAsync() { return { canceled: true }; }');
  writeFileSync(join(dir, 'index.html'), '<style>html,body,#root{margin:0;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}[data-testid="history"]{overflow-anchor:none}</style><div id="root"></div><script type="module" src="/harness.jsx"></script>');
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
const {url,session,secondSession} = await (await fetch('/fixture.json')).json();
window.calls=[];window.nestedPending={};window.releaseNested={};
const heldNested=new Map(['late', 'above', 'gesture', 'keyboard', 'native-drag', 'probe-wheel', 'probe-keyboard', 'probe-touch', 'probe-pointer', 'probe-route', 'probe-account', 'probe-new', 'probe-expiry', 'probe-jank', 'probe-body-keyboard'].map(room=>[room+'-1',new Promise(resolve=>window.releaseNested[room]=()=>{heldNested.delete(room+'-1');resolve();})]));
const monitoredFetch=async(input,init)=>{const path=new URL(input instanceof Request?input.url:input).pathname;if(path.startsWith('/q/'))window.calls.push({path,args:JSON.parse(init.body).args});const id=path==='/q/messagePhoto'&&JSON.parse(init.body).args.id;if(heldNested.has(id)){window.nestedPending[id]=true;await heldNested.get(id);}return fetch(input,init);};
const store=memorySessionStore(); await keepSession(url,session,store);
const replica = new URLSearchParams(location.search).has('replica');
const app=replica?createApp({url,sessionStore:store,fetch:monitoredFetch,device:webDevice({wasm:fetch('/device.wasm'),persist:memoryPersistence()})}):null;
if(app){const opened=await app.ready;if(!opened.ok)throw Error(JSON.stringify(opened));await app.client.sync();}
const client=app?.client??createClient({url,session,fetch:monitoredFetch});
window.commandTrace=[];window.scrollAttempts=0;window.scrollFailures=0;window.scrollCommands=0;
const renderList=FlatList.prototype.render;FlatList.prototype.render=function(){window.fixtureList=this;return renderList.call(this);};
const scroll=FlatList.prototype.scrollToIndex;
FlatList.prototype.scrollToIndex=function(args){window.commandTrace.push({kind:"index",at:performance.now(),args});window.scrollCommands++;window.scrollAttempts++;if(window.failScroll){window.failScroll--;window.scrollFailures++;this.props.onScrollToIndexFailed({index:args.index,averageItemLength:70,highestMeasuredFrameIndex:0});return;}return scroll.call(this,args);};
const offset=FlatList.prototype.scrollToOffset;
FlatList.prototype.scrollToOffset=function(args){window.commandTrace.push({kind:"offset",at:performance.now(),args});window.scrollCommands++;if(!window.blockScroll)return offset.call(this,args);};
const otherClient=createClient({url,session:secondSession}); function Screen(){const [conversation,setConversation]=useState('far');const [account,setAccount]=useState(client);window.accountSwitch=()=>setAccount(otherClient);window.accountRestore=()=>setAccount(client);window.route=setConversation;return <SnapbackProvider client={account}><ConversationScreen conversation={conversation} url={url}/></SnapbackProvider>;}
const root=createRoot(document.getElementById('root'));root.render(<Screen/>);
window.readHistory=args=>client.query(api.history,args);
window.finish=async()=>{window.jumpObserver?.disconnect();cancelAnimationFrame(window.jumpFrame);root.unmount();await Promise.all([otherClient.close(),(app?app.close():client.close())]);};
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
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } } });
  await vite.listen();
  browser = await require('playwright-core').chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  for (const tier of ['online']) await t.test(tier, async t => {
    const page = await browser.newPage({ viewport: { width: 520, height: 800 }, hasTouch:true }), errors = [];
    t.after(() => page.close());
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    page.setDefaultTimeout(hangBudget());
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
    const assertJump = async (name, id, driverDelay = Number(process.env.QJ_DRIVER_DELAY_MS ?? 0)) => {
      await quote(name).waitFor();
      // Arm before the action; browser timestamps and immutable observations
      // survive a descheduled driver and the deliberately brief highlight.
      await quote(name).evaluate((button, id) => {
        window.jumpObserver?.disconnect();cancelAnimationFrame(window.jumpFrame);
        const evidence=window.jumpEvidence={id};
        button.addEventListener('click',()=>{evidence.started=performance.now();},{once:true,capture:true});
        const record=()=>{
          if(evidence.started==null)return;
          const bubble=document.querySelector('[data-testid="message-'+id+'"]'),body=document.querySelector('[data-testid="jump-body-'+id+'"]'),list=document.querySelector('[data-testid="history"]');
          if(!bubble||!body||!list)return;
          const b=bubble.getBoundingClientRect(),text=body.getBoundingClientRect(),v=list.getBoundingClientRect();
          const target=b.height<=v.height?b:text;
          const visible=target.top>=v.top-1&&target.bottom<=v.bottom+1&&target.top>=0&&target.bottom<=innerHeight;
          const highlighted=bubble.getAttribute('aria-label')==='Highlighted message';
          if(!evidence.arrived&&bubble.id==='jump-completed-'+id&&visible&&highlighted){
            evidence.arrived={at:performance.now(),elapsed:performance.now()-evidence.started,top:target.top,bottom:target.bottom,viewportTop:v.top,viewportBottom:v.bottom,color:getComputedStyle(bubble).backgroundColor};
            window.afterJump?.();
          }
          if(evidence.arrived&&!highlighted)evidence.highlightClearedAt=performance.now();
        };
        window.jumpObserver=new MutationObserver(record);window.jumpObserver.observe(document.getElementById('root'),{subtree:true,attributes:true,childList:true});
        const frame=()=>{record();window.jumpFrame=requestAnimationFrame(frame);};window.jumpFrame=requestAnimationFrame(frame);
      }, id);
      await quote(name).click();
      // Astra's reproduction: only Node/Playwright pauses; the browser runs.
      if(driverDelay)await new Promise(resolve=>setTimeout(resolve,driverDelay));
      await page.waitForFunction(()=>window.jumpEvidence.arrived,null,{timeout:hangBudget()});
      const evidence=await page.evaluate(()=>window.jumpEvidence.arrived);
      assert.equal(evidence.color,'rgb(255, 232, 154)');
      assert.ok(evidence.elapsed<4000,JSON.stringify(evidence));
      if(!['gesture','keyboard','native-drag'].includes(name))await page.waitForFunction(id=>{
        const bubble=document.getElementById('jump-completed-'+id),body=document.querySelector('[data-testid="jump-body-'+id+'"]'),list=document.querySelector('[data-testid="history"]');
        if(!bubble||!body||!list)return false;
        const b=bubble.getBoundingClientRect(),v=list.getBoundingClientRect(),target=b.height<=v.height?b:body.getBoundingClientRect();
        return target.top>=v.top-1&&target.bottom<=v.bottom+1&&target.top>=0&&target.bottom<=innerHeight;
      },id,{timeout:hangBudget()});
      t.diagnostic(JSON.stringify({tier,name,driverDelay,...evidence}));
    };

    for(const mode of ['touch','margin','tab','blur']) await t.test('keyboard focus '+mode,async()=>{
      const name='probe-body-keyboard';
      await page.evaluate(()=>window.route('visible'));await quote('visible').waitFor();
      await page.evaluate(name=>window.route(name),name);await quote(name).waitFor();
      await page.getByRole('button',{name:'Older messages',exact:true}).click();
      await page.waitForFunction(name=>window.nestedPending[name+'-1'],name);
      if(mode==='touch'){
        const box=await quote(name).boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        await page.waitForFunction(name=>!!document.getElementById('jump-completed-'+name+'-2'),name);
      }else await assertJump(name,name+'-2');
      if(mode==='margin')await page.mouse.click(510,450);
      if(mode==='tab')await page.keyboard.press('Shift+Tab');
      if(mode==='blur')await page.evaluate(()=>document.activeElement.blur());
      await page.evaluate(()=>{
        window.userScrolls=[];window.userKeys=[];
        document.addEventListener('keydown',e=>window.userKeys.push({key:e.key,target:e.target.tagName}),true);
        document.querySelector('[data-testid="history"]').addEventListener('scroll',e=>window.userScrolls.push({at:performance.now(),top:e.target.scrollTop}));
      });
      const before=await page.evaluate(()=>({focus:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label'),commands:window.scrollCommands,top:document.querySelector('[data-testid="history"]').scrollTop}));
      await page.keyboard.press('PageUp');await page.waitForTimeout(650);
      const after=await page.evaluate(()=>({focus:document.activeElement.tagName,commands:window.scrollCommands,top:document.querySelector('[data-testid="history"]').scrollTop,keys:window.userKeys,scrolls:window.userScrolls,trace:window.commandTrace.slice(-5),highlight:!!document.querySelector('[aria-label="Highlighted message"]')}));
      console.log('KEYBOARD_FOCUS',JSON.stringify({mode,before,after}));
      assert.equal(after.commands,before.commands,'PageUp must cancel correction');
    });
    await page.evaluate(()=>window.finish());assert.deepEqual(errors,[]);
  });
});
