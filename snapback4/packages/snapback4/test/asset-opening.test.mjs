// @ref LLP 3000.002.000#4 — a progressive opening refusal is loading until readiness or a terminal opening failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { avatarFixture } from './helpers/avatar-fixture.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { hangBudget } from './helpers/wait.mjs';

const root = resolve(import.meta.dirname, '../../..');
const clientDir = process.env.AV_CLIENT_DIR ?? join(root, 'packages/snapback4/dist');
test('WASM assets wait for default progressive opening, recover once, and expose permanent opening failure', { timeout: hangBudget(90) }, async t => {
  const f = await avatarFixture(t), dir = mkdtempSync(join(tmpdir(), 'sb4-asset-opening-'));
  const once = await f.upload(f.users.alice.client);
  await f.write(f.users.alice.client, 'messaging.send', { conversation: f.dm, id: 'opening-once', text: 'opening once', quote: null, photo: null, video: null, oncePhoto: { id: once.id } });
  const require = createRequire(join(root, 'package.json'));
  const react = createRequire(join(root, 'packages/snapback4/package.json'));
  let server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); rmSync(dir, { recursive: true, force: true }); });
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, 'harness.jsx'), harness);
  server = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir, clientDir] } }, resolve: { alias: [
    { find: /^react$/, replacement: react.resolve('react') },
    { find: /^react-dom\/client$/, replacement: react.resolve('react-dom/client') },
    ...['app', 'auth', 'react', 'web'].map(name => ({ find: `snapback4/${name}`, replacement: join(clientDir, `${name}.js`) })),
    { find: '#fetch', replacement: join(clientDir, 'default-fetch.js') },
  ] } });
  await server.listen();
  browser = await require('playwright-core').chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  for (const mode of ['default', 'once', 'awaited', 'delayed', 'late-refusal', 'late-failure', 'failed', 'throwing', 'download-failure', 'kept-upload', 'unmount', 'signout']) await t.test(mode, async t => {
    const page = await browser.newPage(); t.after(() => page.close());
    page.setDefaultTimeout(hangBudget());
    await loadBrowserPage(t, page, server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.boot);
    const options = { mode, url: f.url, session: f.users.bob.session, id: mode === 'once' ? once.id : f.users.alice.avatar.id };
    if (mode === 'awaited') {
      await page.evaluate(options => { window.booted = boot(options); }, options);
      await page.waitForFunction(() => window.openEntered);
      assert.equal(await page.evaluate(() => !!window.mounted), false, 'awaited retains its opening barrier');
      await page.evaluate(() => releaseOpening()); await page.evaluate(() => booted);
    } else {
      await page.evaluate(options => boot(options), options);
      await page.waitForFunction(() => window.outcomes.some(x => x.denied?.code === 'E_STORE'));
      assert.equal(await page.evaluate(() => window.state.status), 'loading');
      assert.equal(await page.evaluate(() => window.commits.some(x => x.status === 'denied' || x.status === 'error')), false);
      if (mode === 'delayed') await page.waitForFunction(() => window.state.waiting?.why?.code === 'E_ASSET_WAIT');
      if (mode === 'kept-upload') await page.waitForFunction(() => window.uploadLookups > 0);
      if (mode === 'unmount') await page.evaluate(() => root.unmount());
      if (mode === 'signout') await page.evaluate(() => { window.signingOut = app.auth.logout(); });
      await page.evaluate(() => releaseOpening());
      if (mode === 'late-refusal' || mode === 'late-failure') {
        await page.waitForFunction(() => window.localSnapshot().executable || window.localSnapshot().state === 'unavailable');
        await page.evaluate(() => releaseOutcome());
      }
      if (mode === 'signout') await page.evaluate(() => signingOut);
    }
    if (mode === 'failed' || mode === 'late-failure') {
      await page.waitForFunction(() => window.state.status === 'denied');
      assert.equal(await page.evaluate(() => window.state.why.message), 'permanent opening failure');
    } else if (mode === 'throwing' || mode === 'download-failure') {
      await page.waitForFunction(() => window.state.status === 'error');
      await page.waitForFunction(() => window.localSnapshot().executable && window.localSnapshot().acquired);
      assert.equal(await page.evaluate(() => window.state.why.code), mode === 'throwing' ? 'E_CLIENT' : 'E_OFFLINE');
      assert.equal(await page.evaluate(() => window.attempts), 2, 'acquisition does not replay terminal exceptions or unrelated download errors');
    } else if (mode === 'unmount' || mode === 'signout') {
      await page.evaluate(() => app.close());
      assert.equal(await page.evaluate(() => window.outcomes.filter(x => x.url).length), 0, 'retired selection never downloads after opening');
      if (mode === 'signout') assert.equal(await page.evaluate(() => window.state.why.code), 'E_AUTH');
    } else {
      await page.waitForFunction(() => window.state.status === 'ready');
      const handle = await page.evaluate(() => window.state.url);
      await page.waitForFunction(() => window.localSnapshot().executable && window.localSnapshot().acquired);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await page.evaluate(() => window.state.url), handle, 'ready handle survives acquisition and recovery events');
      assert.equal(await page.evaluate(() => window.outcomes.filter(x => x.url).length), 1, 'acquisition notifications cannot fetch another view');
      assert.equal(await page.evaluate(() => window.transfers.filter(x => x.ok).length), 1, 'one successful byte transfer, including actual one-view media');
      if (mode === 'kept-upload') {
        await page.waitForFunction(() => window.uploadState?.state?.state === 'queued');
        assert.ok(await page.evaluate(() => window.uploadLookups >= 2), 'kept snapshot recovers without onUploads/link notification');
        await page.evaluate(() => root.unmount());
        assert.equal(await page.evaluate(() => window.activeStatusSubscriptions), 0, 'both hook subscriptions are released');
      }
    }
    await page.evaluate(() => app.close());
  });
});

const harness = `
import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, localStatus } from 'snapback4/app';
import { keepSession, localStorageSessionStore } from 'snapback4/auth';
import { webDevice } from 'snapback4/web';
import { AppProvider, useAsset, useUpload } from 'snapback4/react';
window.boot = async ({mode,url,session,id}) => {
  const sessions=localStorageSessionStore(); await keepSession(url,session,sessions);
  const inner=webDevice(); const gate=new Promise(resolve=>{window.releaseOpening=resolve;});
  const device={custody:(...args)=>inner.custody(...args),open:async(...args)=>{window.openEntered=true;await gate;if(mode==='failed'||mode==='late-failure')throw Object.assign(Error('permanent opening failure'),{why:{code:'E_STORE',family:'store',message:'permanent opening failure',retryable:false}});return inner.open(...args);}};
  window.transfers=[];
  window.app=createApp({url,sessionStore:sessions,device,...(mode==='awaited'?{startup:'awaited'}:{}),fetch:async(input,init)=>{const response=await fetch(input,init);if(new URL(input).pathname.startsWith('/assets/'))transfers.push({ok:response.ok,status:response.status});return response;}});
  const ready=await app.ready;if(!ready.ok)throw Error(JSON.stringify(ready));
  window.localSnapshot=()=>localStatus(app.client).getSnapshot(); window.commits=[];window.outcomes=[];
  window.activeStatusSubscriptions=0;
  const statusSource=localStatus(app.client),subscribe=statusSource.subscribe;
  statusSource.subscribe=listener=>{activeStatusSubscriptions++;const stop=subscribe(listener);return()=>{activeStatusSubscriptions--;stop();};};
  window.uploadLookups=0;
  if(mode==='kept-upload')app.client.uploadIntent=async id=>{uploadLookups++;if(!localSnapshot().executable)throw Error('storage still opening');return {id,state:'queued'};};
  const outcomeGate=new Promise(resolve=>{window.releaseOutcome=resolve;});
  window.attempts=0;
  const asset=app.client.asset;app.client.asset=async id=>{attempts++;if(localSnapshot().executable){if(mode==='throwing')throw Error('terminal reader exception');if(mode==='download-failure')return {denied:{code:'E_OFFLINE',family:'link',message:'download interrupted',retryable:true}};}const result=await asset(id);outcomes.push(result);if(result.denied?.code==='E_STORE'&&(mode==='late-refusal'||mode==='late-failure'))await outcomeGate;return result;};
  function Probe(){window.state=useAsset(id);window.uploadState=useUpload({kind:'mutation',name:'unused'},'doc',mode==='kept-upload'?'kept':undefined);useLayoutEffect(()=>{commits.push(state);});return React.createElement('span',null,state.status);}
  window.root=createRoot(document.getElementById('root'));root.render(React.createElement(AppProvider,{app},React.createElement(Probe)));window.mounted=true;
};
`;
