import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalClient} from '../dist/local.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
import {server,until} from './helpers/app-server.mjs';
const wasm=readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
const source=`use personas alice
table messages:
  room: text <=100
  ordinal: int
  unique room, ordinal
  immutable room, ordinal
  read <- allow
  insert <- allow
  sync public
mutation add(n: int):
  insert messages { room: 'c', ordinal: n }
`;

test('real local outbox keeps submission order ahead of delivery load', {timeout:20000},async t=>{
 const {url}=await server(t,'sync public',source);
 let offline=false;const writes=[],reports=[];
 const client=await createLocalClient({url,persona:'alice',waitSeconds:1,device:webDevice({wasm,persist:memoryPersistence()}),fetch:async(input,init)=>{
  if(offline)throw TypeError('offline');
  const path=new URL(input).pathname;
  if(path==='/schema'){
   const backend=await fetch(input,init).then(r=>r.json());
   backend.schema.delivery=[{table:'messages',group:'room',position:'ordinal',mutation:'delivered',args:['conversation','from','through']}];
   return Response.json(backend);
  }
  if(path==='/m/add')writes.push(JSON.parse(init.body).args.n);
  if(path==='/m/delivered'){
   reports.push({body:JSON.parse(init.body),writes:[...writes]});
   const head=await fetch(`${url}/probe`,{headers:init.headers}).then(r=>r.json());
   return Response.json({state:'sent',head:head.seq,seq:head.seq,store_id:head.store_id});
  }
  return fetch(input,init);
 }});
 t.after(()=>client.close());
 await until(()=>client.link()==='online');
 offline=true;
 assert.equal((await client.mutate({kind:'mutation',name:'add'},{n:1})).state,'pending');
 const pending=await Promise.all(Array.from({length:20},(_,i)=>client.mutate({kind:'mutation',name:'add'},{n:i+2})));
 assert.ok(pending.every(w=>w.state==='pending'));assert.deepEqual(reports,[]);
 offline=false;
 await until(()=>reports.length>0,'delivery after outbox flush');
 const order=Array.from({length:21},(_,i)=>i+1);
 assert.deepEqual(writes,order);assert.deepEqual(reports[0].writes,order);
 assert.deepEqual(reports[0].body.args,{conversation:'c',from:1,through:21});
});
