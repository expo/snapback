// @ref LLP 3000.023#12 — real Chromium/wasm qualification under competing live reads.
import assert from 'node:assert/strict';
import { createBrowserServer, loadBrowserPage } from '../packages/snapback4/test/helpers/browser-server.mjs';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, source } from '../packages/snapback4/test/helpers/answers-stay.mjs';
import { chromiumExecutable, root } from '../witness/lib.mjs';
const cleanups = [], t = { after(fn) { cleanups.push(fn); } };
try {
  const extra = `
table receipts:
  room: text <=40
  principal: principal
  ordinal: int
  read <- exists members[.room, viewer]
  insert <- allow
  sync to members[.room]
table reactions:
  room: text <=40
  principal: principal
  emoji: text <=40
  read <- exists members[.room, viewer]
  insert <- allow
  sync to members[.room]
mutation receipt():
  insert receipts { room: 'room', principal: viewer, ordinal: 1 }
mutation react():
  insert reactions { room: 'room', principal: viewer, emoji: 'heart' }
mutation move():
  update messages['item'] { room: 'other' }
mutation unsend():
  delete messages['item']
`;
  const f = await fixture(t, source.replace('query history(c: cursor?):','query history(c: cursor?, n: int):') + extra);
  const require = createRequire(join(root, 'package.json'));
  const { chromium } = require('playwright-core');
  const dir = mkdtempSync(join(tmpdir(),'sb4-rv-browser-'));
  cleanups.push(() => rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/harness.mjs"></script>');
  writeFileSync(join(dir,'harness.mjs'),readFileSync(new URL('./rv-retention-browser.mjs',import.meta.url),'utf8'));
  const pkg = createRequire(join(root,'packages/snapback4/package.json'));
  const vite = await createBrowserServer({ root:dir,configFile:false,logLevel:'error',server:{hmr:false,host:'127.0.0.1',port:0,fs:{allow:[root,dir]}},resolve:{alias:[
    ...['react','react-dom','react-dom/client'].map(name=>({find:new RegExp('^'+name+'$'),replacement:pkg.resolve(name)})),
    {find:/^rv-sdk\/(.*)$/,replacement:join(root,'packages/snapback4/dist/$1.js')},
  ]} });
  await vite.listen();cleanups.push(()=>vite.close());
  const browser = await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox']});cleanups.push(()=>browser.close());
  const page = await browser.newPage();page.on('pageerror',e=>console.error(e));
  await loadBrowserPage(t, page, vite.resolvedUrls.local[0]);await page.waitForFunction(()=>window.qualify);
  const result = await page.evaluate(url=>window.qualify(url),f.url);
  assert.equal(result.safe.loading,0,JSON.stringify(result));
  assert.ok(result.safe.revalidating && result.safe.heldMs > 1000);
  assert.equal(result.safe.converged,true);
  for (const event of result.revocations) assert.ok(event.withdrawn && event.elapsed < 1200,JSON.stringify(event));
  console.log(JSON.stringify({browser:await browser.version(),host:process.platform, ...result},null,2));
} finally {
  // A guard failure must not leave the browser, server or temporary cache alive.
  const errors = [];
  for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, 'revocation qualifier cleanup/guard failed');
}
