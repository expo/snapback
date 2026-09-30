import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../../../packages/snapback4/test/helpers/pr-authority-fixture.mjs';
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
test('closed deadline copy follows same-identity existence changes',async t=>{
 t.mock.method(Date,'now',()=>1000);t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(t,'default'),closed=f.client.observe({kind:'query',name:'read'},{}),peer=f.client.observe({kind:'query',name:'read'},{});
 await settle();f.publish([]);await settle();f.hold();closed.close();
 f.owner().reload(true);closed.getSnapshot();
 f.owner().pending=()=>true;f.owner().updateExistence();
 assert.equal(closed.getSnapshot().existence,peer.getSnapshot().existence);
 peer.close();
});
