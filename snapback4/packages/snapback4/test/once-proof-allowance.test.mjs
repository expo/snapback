import test from 'node:test';
import assert from 'node:assert/strict';
import {server} from './helpers/app-server.mjs';
import { open, q } from './helpers/answers-stay.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const source=`use personas alice, bob\ntable docs:\n  photo: image <=10000 once ?\n  photos: [image <=10000 once] <=500 ?\n  public\n  update <- allow\n  sync public\nmutation fill(id: docs, photos: [image <=10000] <=500):\n  update docs[id] { photos }\nquery page():\n  return docs[] first 10 by byId\n`;
for (const host of ['online', 'process', 'wasm']) test(`${host}: masked cells cannot decide whether a different live cell restores`,async t=>{
 const f=await server(t,undefined,source);
 const post=async(path,body)=>fetch(f.url+path,{method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify(body)}).then(r=>r.json());
 const upload=async()=>{const r=await fetch(f.url+'/assets',{method:'POST',headers:{'x-snapback-persona':'alice'},body:png}).then(r=>r.json());assert.ok(r.asset);return r.asset;};
 const live=await upload(), olds=[await upload(),await upload()];
 assert.equal((await post('/seed',[{table:'docs',row:{id:'a',photo:{id:live.id},photos:null}},{table:'docs',row:{id:'b',photo:null,photos:null}}])).seeded,2);
 const client = await open(t, f, host);
 const query=async()=>client.query(q('page'), {});
 const before=await query();assert.equal(before.data[0].photo?.id,live.id,JSON.stringify(before));
 for(const [i,id] of ['a','b'].entries()){
   const r=await post('/m/fill',{id:'fill-'+id,args:{id,photos:Array.from({length:500},()=>({id:olds[i].id}))}});
   assert.equal(r.state,'sent',JSON.stringify(r));
   const view=await fetch(f.url+'/assets/'+olds[i].id,{headers:{'x-snapback-persona':'bob'}});assert.equal(view.status,200);await view.arrayBuffer();
   const again=await fetch(f.url+'/assets/'+olds[i].id,{headers:{'x-snapback-persona':'bob'}});assert.equal(again.status,410);
 }
 const after=await query();

 t.diagnostic(JSON.stringify({ liveRestored: after.data?.[0]?.photo?.id === live.id, listMasked: after.data?.[0]?.photos === null }));
 assert.equal(after.data[0].photo?.id,live.id,'a masked viewed-list changed restoration of the unrelated live cell');
 assert.equal(after.data[0].photos,null);
});
