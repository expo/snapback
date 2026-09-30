import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/pr-authority-fixture.mjs';
import {sdk} from './helpers/answers-stay.mjs';
const {episodeDeadline}=await import(new URL('read-episode.js',sdk));
const q={kind:'query',name:'read'};
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
for(const closeBeforeReload of [false,true])test(`closed facade deadline cannot follow later queue pauses; closeBeforeReload=${closeBeforeReload}`,async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(t,'default'),closed=f.client.observe(q,{}),peer=f.client.observe(q,{});
 await settle();f.publish('A');await settle();f.hold();
 if(closeBeforeReload)closed.close();
 f.owner().reload(true);for(const notify of f.owner().subscribers)notify();
 assert.equal(episodeDeadline(closed.getSnapshot()),2000);
 if(!closeBeforeReload)closed.close();
 now=1200;f.owner().queueEpisode(true);now=1500;
 assert.equal(episodeDeadline(closed.getSnapshot()),2000,'already exposed deadline stays fixed');
 assert.equal(closed.getSnapshot(),closed.getSnapshot(),'stable closed snapshot');
 now=2500;
 assert.equal(peer.getSnapshot().data,'A');
 assert.equal(episodeDeadline(peer.getSnapshot()),3300);
  assert.deepEqual(closed.getSnapshot(),{loading:true});peer.close();
});

test('closed deadline copy follows same-identity existence changes',async t=>{
 t.mock.method(Date,'now',()=>1000);t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(t,'default'),closed=f.client.observe(q,{}),peer=f.client.observe(q,{});
 await settle();f.publish([]);await settle();f.hold();closed.close();
 f.owner().reload(true);closed.getSnapshot();
 f.owner().pending=()=>true;f.owner().updateExistence();
 assert.equal(closed.getSnapshot().existence,'partial');
 assert.equal(closed.getSnapshot().existence,peer.getSnapshot().existence);
 assert.equal(episodeDeadline(closed.getSnapshot()),2000);
 assert.equal(closed.getSnapshot(),closed.getSnapshot());
 peer.close();
});
