import assert from 'node:assert/strict';
import { Pages } from '../../dist/react-pages.js';
import { until } from './app-server.mjs';
import { compare, random } from './search-oracle.mjs';
const query = { kind: 'query', name: 'search' };

// Generated independently of result/cursor contents: each seed supplies the
// direction, page size, tied Unicode IDs and a different replacement position.
export async function generatedCategory({ seed, direction, limit, model, client, owner, mutate, calls, events }) {
  const category = seed % 4;
  events.push(['rebirth', 'projection', 'invalid-input', 'argument-change'][category]);
  if (category === 0) {
    // These draws are independent of the category/cut divisibility schedule.
    const rng = random(seed ^ 0x9e3779b9), candidates = [...model.images.values()].filter(r => r.room === 'left');
    const candidate = candidates[rng(candidates.length)], matching = !!rng(2), placement = ['before','middle','after'][rng(3)], expired = rng(4) === 0;
    const sign = direction === 'first' ? 1 : -1;
    const row = { ...candidate, room: 'live', at: placement === 'middle' ? candidate.at : sign * (placement === 'before' ? -999999 : 999999), text: matching ? 'coffee reborn' : 'tea reborn' };
    await mutate('rebirth', row); model.write(row);
    if (expired) { row.expires = 1; await mutate('edit', row); model.write(row); }
    events.push(`reuse:${matching ? 'coffee' : 'tea'}:${placement}`, `reuse:${expired ? 'expired' : 'live'}`);
    // No write during this traversal: a readable current image wins even if
    // it does not match the needle. Check the complete identity set through bounded pages.
    const expected = model.readable(true).sort((a,b) => (direction === 'first' ? 1 : -1) * compare(a,b));
    const all = []; let c;
    for (let page = 0; page < 100; page++) {
      const before = calls(), read = await client.query(query, { q: 'cof', c });
      assert.equal(calls()-before, 1); assert.ok(read.data, JSON.stringify(read));
      all.push(...read.data); c = read.next; if (!c) break;
    }
    assert.equal(c, null); assert.deepEqual(all, expected, 'generated ID reuse: current image is authoritative');
  } else if (category === 1) {
    const op = { kind:'query', name:'summaries' }, pages = new Pages(client, op, {}), stop = pages.subscribe(()=>{});
    try {
      await until(()=> !pages.getSnapshot().read.loading, 'generated projection');
      const expected = [...model.images.values()].filter(r => r.room === 'live').sort(compare).slice(0,limit).map(r => ({id:r.room,text:r.text}));
      assert.deepEqual(pages.getSnapshot().items, expected, 'generated projected id is not row identity');
    } finally { stop(); }
  } else if (category === 2) {
    // Ensure this goes through the early server decoder, rather than a local
    // retained scan's independent input validation.
    await mutate('join', {room:'left'}); model.members.add('left'); await client.sync(); model.sync();
    const args = seed % 3 ? {q: seed} : {q:'coffee', unexpected: true};
    const before = calls(), read = await client.query(query, args);
    assert.equal(read.denied?.code, 'E_INPUT', 'generated permanent refusal survives composition');
    assert.equal(calls()-before, 1);
    const watch = client.observe(query,args), start=calls(), stop=watch.subscribe(()=>{});
    try {
      await until(()=>!!watch.getSnapshot().denied, 'generated permanent refused observation');
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(calls()-start,1,'permanent refusal never refreshes identity');
    } finally { stop(); watch.close(); }
    await mutate('leave',{room:'left'}); model.members.delete('left'); await client.sync(); model.sync();
  } else {
    const first = await client.query(query,{q:'cof'}); assert.ok(first.next);
    const row = { ...[...model.rows.values()].find(r=>r.room==='live'), text:'tea changed', at:direction === 'last' ? 999999 : -999999 };
    await mutate('edit',row); model.write(row);
    const read = await client.query(query,{q:'tea',c:first.next});
    assert.deepEqual(read.data,[row],'generated argument change restarts at the new needle head');
  }
}

// A full page of overlap, plus lookahead, crosses the old quadratic step cap.
// Stable rows and independent authored images determine the whole traversal.
export async function generatedLargeOverlap({ seed, direction, limit, model, client, mutate, calls, events, placement = 'after', matching = true }) {
  const candidates = [...model.images.values()].filter(row => row.room === 'left');
  assert.ok(candidates.length > limit);
  const sign = direction === 'first' ? 1 : -1;
  for (const candidate of candidates) {
    const row = {...candidate, room:'live', text:matching ? 'coffee reborn' : 'tea reborn',
      at:placement === 'middle' ? candidate.at : candidate.at + sign * (placement === 'before' ? -10000 : 10000)};
    await mutate('rebirth',row); model.write(row);
  }
  const expected = model.readable(true).sort((a,b)=>sign*compare(a,b)), all=[];
  let c;
  for(let page=0;page<20;page++) {
    const before=calls(), read=await client.query(query,{q:'cof',c});
    assert.equal(calls()-before,1);assert.equal(read.denied,undefined,`large overlap seed ${seed}`);
    assert.ok(Array.isArray(read.data));assert.ok(read.data.length || read.complete || read.next);
    assert.deepEqual(read.data,expected.slice(all.length,all.length+read.data.length),'large overlap exact next prefix');
    all.push(...read.data);c=read.next;if(!c)break;
  }
  assert.equal(c,null);assert.deepEqual(all,expected,'large overlap complete traversal');
  events.push(`large:${limit}:${direction}`,`large:${matching ? 'coffee' : 'tea'}:${placement}`);
}
