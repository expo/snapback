// Real wasm over one atomic filesystem batch. The parent kills this process
// after publication and attempt persistence, without calling close().
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {webDevice} from '../../dist/web.js';
import {DeliveryQueue} from '../../dist/delivery.js';
import {wasm,backend,snapshot} from './delivery-fixture.mjs';
const [directory,mode]=process.argv.slice(2);
const file=name=>join(directory,encodeURIComponent(name)+'.json');
const load=async name=>{try{return JSON.parse(await readFile(file(name),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
const persist={
 async claim(name){return {name,async release(){}};},load,
 async save(name,changes){const path=file(name),rows=new Map((await load(name)).map(c=>[JSON.stringify([c.s,c.k]),c]));for(const c of changes){const k=JSON.stringify([c.s,c.k]);if(c.v===null)rows.delete(k);else rows.set(k,c);}await writeFile(path+'.tmp',JSON.stringify([...rows.values()]));await rename(path+'.tmp',path);}
};
const core=await webDevice({wasm,persist}).open('crash',mode==='write'?backend:null);
const call=async request=>{const r=await core.call(request);if(r.denied)throw Error(JSON.stringify(r.denied));return r.ok;};
const request=action=>call({op:'delivery',viewer:'dev:alice',action});
await request('read');if(mode==='write')await call(snapshot);
const storage={async clear(){await request('clear');},async update(edit){for(;;){const read=await request('read'),state=JSON.parse(read.value),result=edit(state);if(await call({op:'delivery',viewer:'dev:alice',action:'write',expected:read.value,value:JSON.stringify(state)}))return result;}}};
const q=new DeliveryQueue({local:true,storage,mint:()=>`${mode}-attempt`,ready:()=>true,
 async send(mutation,body){const state=JSON.parse((await request('read')).value);process.send({mutation,body,state});return new Promise(()=>{});}
});
setInterval(()=>{},1000);await q.start();await q.pump();
