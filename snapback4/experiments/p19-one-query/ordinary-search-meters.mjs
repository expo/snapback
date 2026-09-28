// Capture server receipts after ordinary-search.mjs has prepared the lane-owned copy.
// Run from snapback4/; never opens the evidence database.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '../../packages/snapback4/dist/client.js';
import {login} from '../../packages/snapback4/dist/auth.js';
const base=process.cwd(), binary=base+'/target/debug/snapback4';
const host=spawn(binary,['dev','--port','0','--no-watch','--replay'],{cwd:base+'/experiments/p19-one-query/.work/os/app',stdio:['ignore','pipe','pipe']});
let output='',client;
for(const stream of [host.stdout,host.stderr])stream.on('data',b=>output+=b);
try {
 let url; for(let i=0;i<1200;i++){if(host.exitCode!==null)throw Error(output);url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)break;await delay(25)}
 if(!url)throw Error('server startup timeout');
 const line=readFileSync('/home/ccheever/sb4-intent/rg-evidence/lane/instrument/fixtures/scale.log','utf8').split('\n').find(l=>/ u0500 register /.test(l));
 const t=line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t=>t.startsWith('"')?JSON.parse(t):t);
 const auth=await login(url,t[3],t[4]);if(!auth.ok)throw Error('login refused');
 const observations=[];
 client=createClient({url,session:auth.session,fetch:async(input,init)=>{
  const start=performance.now();const response=await fetch(input,init);
  if(new URL(input).pathname.startsWith('/q/')){const value=await response.clone().json();observations.push({op:new URL(input).pathname,ms:performance.now()-start,meter:value.meter,complete:value.complete,nextBytes:value.next?.length??0,rows:value.data?.length});}
  return response;
 }});
 for(const name of ['osSearch','searchNewest']){let c;for(let page=0;page<3;page++){const r=await client.query({kind:'query',name},{q:'coffee',c});if(!r.data||!r.complete)throw Error(JSON.stringify(r));c=r.next;}}
 writeFileSync(base+'/reports/20260928-os-ordinary-search/server-meters.json',JSON.stringify(observations,null,2)+'\n');
}finally{await client?.close();if(host.exitCode===null){const end=new Promise(r=>host.once('exit',r));host.kill('SIGTERM');await end;}}
