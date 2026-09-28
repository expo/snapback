import assert from 'node:assert/strict';
import { Pages } from '../../dist/react-pages.js';
import { until } from './app-server.mjs';
import { compare } from './search-oracle.mjs';
const query = { kind: 'query', name: 'search' };

// Generated independently of result/cursor contents: each seed supplies the
// direction, page size, tied Unicode IDs and a different replacement position.
export async function generatedCategory({ seed, direction, limit, model, client, owner, mutate, calls, events }) {
  const category = seed % 4;
  events.push(['rebirth', 'projection', 'invalid-input', 'argument-change'][category]);
  if (category === 0) {
    const candidate = [...model.images.values()].filter(r => r.room === 'left')[seed % [...model.images.values()].filter(r => r.room === 'left').length];
    const row = { ...candidate, room: 'live', at: direction === 'last' ? 999999 : -999999, text: seed % 3 ? 'tea reborn' : 'coffee reborn' };
    await mutate('rebirth', row); model.write(row);
    // No write during this traversal: current image wins even if it does not
    // match the needle. Check the complete identity set through bounded pages.
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
