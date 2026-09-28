import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { Pages } from '../dist/react-pages.js';
import { server, until } from './helpers/app-server.mjs';
const source=`use personas alice
table messages:
  room: id
  body: text <=200
  at: time
  public
query summaries(c: cursor ?):
  return messages first 2 by .at after c { id: .room, body }
`;
test('review Pages preserves distinct projected results sharing an id field',async t=>{
 const {url}=await server(t,'',source);
 const client=createClient({url,persona:'alice'});t.after(()=>client.close());
 const rows=[{id:'m1',room:'room1',body:'first message',at:1},{id:'m2',room:'room1',body:'second message',at:2}];
 assert.equal((await fetch(`${url}/seed`,{method:'POST',body:JSON.stringify(rows.map(row=>({table:'messages',row})))}).then(r=>r.json())).seeded,2);
 const op={kind:'query',name:'summaries'},raw=await client.query(op,{});
 assert.equal(raw.data.length,2,JSON.stringify(raw));
 const pages=new Pages(client,op,{});const stop=pages.subscribe(()=>{});t.after(stop);
 await until(()=>pages.getSnapshot().items.length>0,'projection');
 console.log('PROJECTION',JSON.stringify({raw:raw.data,accumulated:pages.getSnapshot()}));
 assert.equal(pages.getSnapshot().items.length,2,'both source rows must remain');
});
