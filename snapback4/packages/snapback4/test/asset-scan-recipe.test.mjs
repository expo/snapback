import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const guide = readFileSync(new URL('../../../crates/snapback4-lang/src/guide/asset_sharing.md', import.meta.url), 'utf8');
const source = guide.match(/```js\n([\s\S]*?)\n```/)[1].replace(/import[^\n]+\n/, '');
const {scanClean} = await import(`data:text/javascript;base64,${Buffer.from(`class Retry extends Error {}\nclass GiveUp extends Error {}\n${source}`).toString('base64')}`);
const bytes = new TextEncoder().encode('%PDF-test');
const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
test('the published scanner adapter approves only an explicit clean verdict for the same bytes', async () => {
  let request;
  assert.equal(await scanClean(bytes, 'https://trusted-scanner', async (url, init) => {
    assert.equal(url, 'https://trusted-scanner'); request = init;
    return Response.json({verdict:'clean', sha256});
  }), sha256);
  assert.equal(request.body, bytes); assert.equal(request.headers['x-content-sha256'], sha256);
  for (const reply of [null, {}, {verdict:'clean'}, {verdict:'clean',sha256:'different'}, {verdict:'pending',sha256}, {verdict:'infected',sha256}]) {
    await assert.rejects(scanClean(bytes, 'https://trusted-scanner', async () => Response.json(reply)), error => error.constructor.name === (reply?.verdict === 'infected' ? 'GiveUp' : 'Retry'));
  }
  for (const doFetch of [async()=>{throw new Error('offline');}, async()=>new Response('bad JSON'), async()=>Response.json({verdict:'clean',sha256},{status:503}), async()=>{throw new DOMException('deadline','TimeoutError');}]) {
    await assert.rejects(scanClean(bytes,'https://trusted-scanner',doFetch), /scanner unavailable or invalid reply/);
  }
});
