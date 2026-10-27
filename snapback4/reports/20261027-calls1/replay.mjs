// Read only the copied Quarry sources; never opens a wave34 lane or its store.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const {cli,startDev}=await import(join(root,'packages/snapback4/dist/proof.js'));
const {createClient}=await import(join(root,'packages/snapback4/dist/client.js'));
const {signup}=await import(join(root,'packages/snapback4/dist/auth.js'));
const copies=JSON.parse(readFileSync('/tmp/calls1/lane-copies.json','utf8'));
const env={...process.env,SNAPBACK4_BIN:join(root,'target/debug/snapback4')};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b1sAAAAASUVORK5CYII=','base64');
const receipts=[];
for(const copy of copies){
 const cwd=copy.destination;
 const original=copy.copied.map(name=>[name,createHash('sha256').update(readFileSync(join(cwd,'snapback',name))).digest('hex')]);
 // A lane-shaped red is added to the COPY, retaining every original rule and operation.
 const file=join(cwd,'snapback','calls1.q');
 writeFileSync(file,'query nullableDeadline(at: time ?):\n  require at + 1 > now else LATE\n  return 1\n');
 const before=await cli(['check','--json'],{cwd,env});
 assert.match(before.stdout+before.stderr,/E_QUARRY_TYPE/);
 const fixed=await cli(['check','--fix','--json'],{cwd,env});
 assert.doesNotMatch(fixed.stdout+fixed.stderr,/E_QUARRY_TYPE/);
 assert.match(fixed.stderr,/--- calls1.q\n\+\+\+ calls1.q/);
 const text=readFileSync(file,'utf8');assert.match(text,/at != null and \(at \+ 1 > now\)/);
 const again=await cli(['check','--fix','--json'],{cwd,env});
 assert.equal(readFileSync(file,'utf8'),text);assert.doesNotMatch(again.stderr,/fix:/);
 const row={lane:copy.lane,sourceDigests:original,compilerFixCycles:1,idempotent:true,checkExit:fixed.code,scope:'compiler refusal resolved; original security gate verdict retained'};
 if(copy.lane.startsWith('026-')||copy.lane.startsWith('038-')){
  // Original image-only backend and ordinary password signup, on a fresh in-memory host.
  const host=await startDev({cwd,env,args:['--memory','--no-watch']});let client;
  try{
   const account=await signup(host.url,'calls1@example.test','Calls1-password-2026');assert.equal(account.ok,true,JSON.stringify(account));
   client=createClient({url:host.url,session:account.session});
   const upload=await client.upload(png,{file:{type:'image/png',name:'evidence.png',size:png.length}});
   assert.equal(upload.ok,true,JSON.stringify(upload));assert.equal(upload.asset.type,'image/png');
   const bad=await client.upload(Buffer.from('spoofed bytes'),{file:{type:'image/png',name:'fake.png'}});
   assert.equal(bad.ok,false);assert.equal(bad.why.code,'E_ASSET_TYPE');
   row.imageMetadataAccepted=true;row.spoofedImageRefused=true;row.uploadFixCycles=0;
  }finally{client?.close();await host.stop();}
 }
 // Every original copied source remains unchanged by the automatic fix.
 for(const [name,digest] of original)assert.equal(createHash('sha256').update(readFileSync(join(cwd,'snapback',name))).digest('hex'),digest);
 receipts.push(row);writeFileSync('/tmp/calls1/replay-results.json',JSON.stringify(receipts,null,2));
 console.log(`${copy.lane}: compiler fixed in one run${row.imageMetadataAccepted?'; original image backend accepts metadata and refuses spoofed bytes':''}`);
}
