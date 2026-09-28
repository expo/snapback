// @ref LLP 3000.028#7.2 — mixed drain on the actual builder program and copied store.
// Run after ordinary-search.mjs. Only this lane's copies are opened or modified.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '../../packages/snapback4/dist/client.js';
import {createLocalClient} from '../../packages/snapback4/dist/local.js';
import {processDevice} from '../../packages/snapback4/dist/native.js';
import {login} from '../../packages/snapback4/dist/auth.js';
import {parkedChanges} from '../../packages/snapback4/test/helpers/sync-control.mjs';
const root=resolve(import.meta.dirname,'../..'),binary=join(root,'target/debug/snapback4');
const work=join(import.meta.dirname,'.work/os-r1-builder-drain'),app=join(work,'app');
const report=join(root,'reports/20260928-os-ordinary-search/round1');
mkdirSync(work,{recursive:true});
assert.equal(spawnSync('cp',['-a','--reflink=auto',join(import.meta.dirname,'.work/os-r1-u0500/app'),app]).status,0);
const fixture=readFileSync(join(report,'u0500/builder-search.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse).find(r=>r.stage==='floor-fixture');
let output='',client,owner;
const records=[],record=x=>{records.push(x);writeFileSync(join(report,'builder-drain.jsonl'),records.map(JSON.stringify).join('\n')+'\n');console.log(JSON.stringify(x));};
const host=spawn(binary,['dev','--port','0','--no-watch','--replay'],{cwd:app,stdio:['ignore','pipe','pipe']});
for(const stream of [host.stdout,host.stderr])stream.on('data',v=>output+=v);
try{
 let url;for(let n=0;n<3600;n++){assert.equal(host.exitCode,null,output.slice(-1000));url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)break;await delay(50);}assert.ok(url);
 const evidence=process.env.P19_EVIDENCE??'/home/ccheever/sb4-intent/rg-evidence/lane';
 const line=readFileSync(join(evidence,'instrument/fixtures/scale.log'),'utf8').split('\n').find(l=>/ u0500 register /.test(l));
 const tokens=line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t=>t.startsWith('"')?JSON.parse(t):t);
 const signed=await login(url,tokens[3],tokens[4]);assert.ok(signed.ok);
 const requests=[];
 client=await createLocalClient({url,session:signed.session,device:processDevice({binary,dir:join(work,'device')}),fetch:async(input,init)=>{
  if(new URL(input).pathname==='/changes')return parkedChanges(init.signal);
  const r=await fetch(input,init);if(new URL(input).pathname.startsWith('/q/'))requests.push(await r.clone().json());return r;
 }});await client.sync();
 owner=createClient({url,persona:'osowner'});
 assert.equal((await owner.mutate({kind:'mutation',name:'removeMember'},{conversation:fixture.conversation,principal:signed.session.principal})).state,'sent');await client.sync();
 // Place low word heads in each added current scope. The device
 // deliberately does not acquire these chats: server knowledge remains online.
 const count=Number(process.env.OS_DRAIN_SCOPES??245), words=Number(process.env.OS_DRAIN_WORDS??32);
 for(let first=0;first<count;first+=5){const rows=[];
  for(let n=first;n<Math.min(first+5,count);n++){
   const id=`os-drain-${n}`;
   rows.push({table:'conversations',row:{id,kind:'group',title:'OS drain',description:'',creator:'dev:osowner',lastOrdinal:words}});
   rows.push({table:'members',row:{id:'m-'+id,conversation:id,principal:signed.session.principal,role:'member',joinedOrdinal:0}});
   for(let word=0;word<words;word++) rows.push({table:'messages',row:{id:`msg-${id}-${word}`,conversation:id,sender:'dev:osowner',ordinal:word+1,recipients:1,text:`coffee${String(word).padStart(3,'0')}`,at:1}});
  }
  const r=await fetch(url+'/seed',{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json());assert.equal(r.seeded,rows.length,JSON.stringify(r));
 }
 let c;
 for(let page=0;page<2;page++){
  const before=requests.length,read=await client.query({kind:'query',name:'osSearch'},{q:'coffee',c});
  const remote=requests.at(-1);record({page,scopesAdded:count,wordsPerScope:words,requests:requests.length-before,read,remote});
  assert.equal(requests.length-before,1);assert.equal(remote.denied,undefined,JSON.stringify(remote));
  assert.equal(remote.complete,false);assert.equal(remote.cut,'meter');assert.ok(remote.next);assert.ok(remote.data.length>0&&remote.data.length<20);
  assert.equal(read.complete,false);assert.equal(read.cut,'meter');assert.ok(read.next);
  if(page===0){assert.equal(read.data.length,20);assert.equal(JSON.parse(Buffer.from(read.next.slice(5),'base64url')).server,null);}
  c=read.next;
 }
 record({pass:true});
}catch(e){record({failure:String(e),stack:e.stack});process.exitCode=1;}
finally{await client?.close();await owner?.close();host.kill('SIGTERM');}
