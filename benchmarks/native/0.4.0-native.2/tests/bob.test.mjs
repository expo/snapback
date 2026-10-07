import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { conversation } from '../driver/bob-wait.mjs';
const require=createRequire(process.env.CLIQUE_PLAYWRIGHT_PACKAGE ?? new URL('../ui/package.json',import.meta.url));
const {chromium}=require('playwright');
test('Bob waits for delayed identity and timestamped message bodies', async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();await page.setContent('<div id="root"></div>');
  await page.evaluate(()=>setTimeout(()=>{document.getElementById('root').outerHTML='<div data-conversation="c" data-principal="b"><p data-testid="sm-convo-bubble" aria-valuetext="q1"><span data-testid="sm-convo-body">first</span><time>12:00</time></p><p data-testid="sm-convo-bubble" aria-valuetext="q2"><span data-testid="sm-convo-body">second</span><time>12:00</time></p></div>';},1500));
  const started=performance.now();
  const result=await conversation(page,{conversationId:'c',bob:'b',queuedBodies:['first','second']});
  assert.ok(performance.now()-started>=1400);assert.deepEqual(result.rows.map(r=>r.body),['first','second']);
  assert.deepEqual(result.screen,[{conversationId:'c',principal:'b'}]);
 } finally {await browser.close();}
});
test('Bob cannot accept another principal or a render beyond the bound',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();await page.setContent('<div data-conversation="c" data-principal="eve"></div>');
  const start=performance.now();const result=await conversation(page,{conversationId:'c',bob:'b',queuedBodies:['first','second']},300);
  assert.ok(performance.now()-start>=290);assert.deepEqual(result.rows,[]);assert.equal(result.screen[0].principal,'eve');
 } finally {await browser.close();}
});
