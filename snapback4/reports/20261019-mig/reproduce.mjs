// Five real wave-17 schemas/stores, copied read-only. No original app is changed.
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, chmodSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
process.env.SNAPBACK4_BIN=join(root,'target/debug/snapback4');
const {cli,startServe}=await import(pathToFileURL(join(root,'packages/snapback4/dist/proof.js')));
const apps=process.env.WAVE17_APPS??'/home/ccheever/sb4-loop/wave17/apps';
const out=process.env.MIG_REPRO??'/home/ccheever/sb4-loop/wave17-repro/mig';
mkdirSync(out,{recursive:true,mode:0o700});
const backup=String.raw`import sqlite3,sys,urllib.parse
source=sqlite3.connect('file:'+urllib.parse.quote(sys.argv[1])+'?mode=ro',uri=True)
target=sqlite3.connect(sys.argv[2]);source.backup(target);target.close();source.close()`;
const targets={1:{bookings:['length','weight']},5:{pieces:['cone'],firings:['cone']},6:{people:['name'],pairs:['nameA','nameB'],logs:['buddyName'],cards:['diverName']},12:{parties:['partyNames']},36:{requests:['amount']}};
function migrationLines(app,plan,n,removed){
 if(!plan.bridge)return removed;
 const source=readFileSync(join(app,plan.bridge),'utf8');
 return removed+(n===1?replaceDecl(source,'backfillVehicleClasses').count:replaceDecl(source,'backfillPiece').count+replaceDecl(source,'backfillFiring').count);
}
const plans={
  1:{job:'backfillVehicleClasses',bridge:'migrations/vehicle-class-bridge.q',fills:"backfill bookings vehicleClasses(length: int, weight: int):\n  {vehicleClass:inferredClass(length, weight)}\n",remove:[]},
  5:{bridge:'versions/bridge/schema.q',fills:"backfill pieces types(cone: enum('06','04','5','6','10')):\n  {firingType:'bisque' if startsWith(cone, '0') else 'glaze'}\nbackfill firings types(cone: enum('06','04','5','6','10')):\n  {firingType:'bisque' if startsWith(cone, '0') else 'glaze'}\n",remove:[]},
  6:{job:'migrateNames',fills:"backfill people names(name: text <=60):\n  {firstName:beforeLast(name, ' '), lastName:afterLast(name, ' ')}\nbackfill pairs names(nameA: text <=60, nameB: text <=60):\n  {firstNameA:beforeLast(nameA, ' '), lastNameA:afterLast(nameA, ' '), firstNameB:beforeLast(nameB, ' '), lastNameB:afterLast(nameB, ' ')}\nbackfill logs names(buddyName: text <=60):\n  {buddyFirstName:beforeLast(buddyName, ' '), buddyLastName:afterLast(buddyName, ' ')}\nbackfill cards names(diverName: text <=60):\n  {diverFirstName:beforeLast(diverName, ' '), diverLastName:afterLast(diverName, ' ')}\n",remove:['migrateNames']},
  12:{job:'migratePartySides',fills:"backfill parties sides(partyNames: text <=300):\n  {petitionerName:trim(before(partyNames, ' v. ')), respondentName:trim(after(partyNames, ' v. '))}\n",remove:['migratePartySides']},
  36:{job:'backfillPrices',fills:"backfill requests prices(amount: int):\n  {unitPrice:amount, quantity:1}\n",remove:['backfillPrices','backfillDaily']},
};
function lines(s){return s.split('\n').filter(s=>s.trim()).length;}
function replaceDecl(source,name,replacement=''){
 const input=source.split('\n');let count=0;const kept=[];
 for(let i=0;i<input.length;){
  if(new RegExp('^(?:fn|job|mutation|schedule) '+name+'(?:\\(|\\s|:)').test(input[i])){
   const start=i++;while(i<input.length&&(input[i].startsWith(' ')||!input[i].trim()))i++;
   count+=lines(input.slice(start,i).join('\n'));if(replacement)kept.push(replacement.trimEnd());
  }else kept.push(input[i++]);
 }
 return {source:kept.join('\n'),count};
}
async function checked(cwd,args,env={}){
 const result=await cli(args,{cwd,env,timeoutMs:120000});
 assert.equal(result.code,0,`${args.join(' ')}\n${result.stderr}\n${result.stdout}`);return result;
}
async function snapshot(cwd,dir,n){
 const data={};
 for(const [table,fields]of Object.entries(targets[n])){
  const count=JSON.parse((await checked(cwd,['sql',`SELECT COUNT(*) FROM "${table}"`,'--release',dir,'--json'])).stdout).rows[0][0];
  const result=JSON.parse((await checked(cwd,['sql',`SELECT id, ${fields.map(f=>'"'+f+'"').join(', ')} FROM "${table}" ORDER BY id`,'--release',dir,'--limit',String(count+1),'--json'])).stdout);
  assert.equal(result.more,false);data[table]=result.rows.map(row=>Object.fromEntries(['id',...fields].map((field,i)=>[field,row[i]])));
 }
 return data;
}
async function values(cwd,dir,table,fields){
 const result=JSON.parse((await checked(cwd,['sql',`SELECT id, ${fields.join(', ')} FROM "${table}" ORDER BY id`,'--release',dir,'--limit','1000000','--json'])).stdout);assert.equal(result.more,false);
 return new Map(result.rows.map(row=>[row[0],Object.fromEntries(fields.map((f,i)=>[f,row[i+1]]))]));
}
async function assertMigrated(cwd,dir,n,before){
 for(const [table,rows]of Object.entries(before)){
  const fields=n===1?['vehicleClass']:n===5?['firingType']:n===12?['petitionerName','respondentName']:n===36?['unitPrice','quantity']:table==='people'?['firstName','lastName']:table==='pairs'?['firstNameA','lastNameA','firstNameB','lastNameB']:table==='logs'?['buddyFirstName','buddyLastName']:['diverFirstName','diverLastName'];
  const after=await values(cwd,dir,table,fields);assert.equal(after.size,rows.length,`${n}/${table} population`);
  for(const row of rows){
   let wanted;
   if(n===1)wanted={vehicleClass:row.weight>3500?'commercial':row.length>=500?'van':'car'};
   else if(n===5)wanted={firingType:row.cone.startsWith('0')?'bisque':'glaze'};
   else if(n===12){const at=row.partyNames.indexOf(' v. ');wanted={petitionerName:(at<0?row.partyNames:row.partyNames.slice(0,at)).trim(),respondentName:(at<0?'':row.partyNames.slice(at+4)).trim()};}
   else if(n===36)wanted={unitPrice:row.amount,quantity:1};
   else {
    const mappings=table==='people'?[['name','firstName','lastName']]:table==='pairs'?[['nameA','firstNameA','lastNameA'],['nameB','firstNameB','lastNameB']]:table==='logs'?[['buddyName','buddyFirstName','buddyLastName']]:[['diverName','diverFirstName','diverLastName']];wanted={};
    for(const[from,first,last]of mappings){const at=row[from].lastIndexOf(' ');wanted[first]=at<0?row[from]:row[from].slice(0,at);wanted[last]=at<0?'':row[from].slice(at+1);}
   }
   assert.deepEqual(after.get(row.id),wanted,`${n}/${table}/${row.id}`);
  }
 }
}
async function post(host,token,name,args){
 const response=await fetch(host.url+'/m/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({args}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();assert.equal(result.state,'sent',JSON.stringify(result));return result;
}
const results=[];
for(const n of [1,5,6,12,36]){
 const app=join(apps,readdirSync(apps).find(name=>name.startsWith(String(n).padStart(3,'0')+'-snapback-')));
 const cwd=join(out,String(n).padStart(3,'0'));rmSync(cwd,{recursive:true,force:true});mkdirSync(cwd,{recursive:true,mode:0o700});
 const plan=plans[n],original=readFileSync(join(app,'snapback/schema.q'),'utf8');let candidate=original,removed=0;
 for(const name of plan.remove){const r=replaceDecl(candidate,name);candidate=r.source;removed+=r.count;}
 if(n===6){for(const[name,fn]of [['splitFirst','beforeLast'],['splitLast','afterLast']]){const r=replaceDecl(candidate,name,`fn ${name}(name: text <=60): ${fn}(name, ' ')`);candidate=r.source;removed+=r.count-1;}}
 if(n===12){const r=replaceDecl(candidate,'splitPartyNames',"fn splitPartyNames(value: text <=300): {petitionerName:trim(before(value, ' v. ')), respondentName:trim(after(value, ' v. '))}");candidate=r.source;removed+=r.count-1;}
 candidate+='\n'+plan.fills;
 for(const[name,source]of [['legacy',original],['candidate',candidate]]){mkdirSync(join(cwd,name),{recursive:true});writeFileSync(join(cwd,name,'schema.q'),source);}
 if(plan.bridge){mkdirSync(join(cwd,'bridge'));cpSync(join(app,plan.bridge),join(cwd,'bridge/schema.q'));}
 const prepared=join(cwd,'prepared');mkdirSync(prepared);
 cpSync(join(app,'deploy/current'),join(prepared,'current'));
 cpSync(join(app,'deploy/releases.jsonl'),join(prepared,'releases.jsonl'));
 cpSync(join(app,'deploy/releases'),join(prepared,'releases'),{recursive:true,filter:path=>!path.split('/').some(p=>['node_modules','.snapback4','generated','dist','.native'].includes(p))});
 execFileSync('python3',['-c',backup,join(app,'deploy/store.sqlite'),join(prepared,'store.sqlite')],{timeout:30000});chmodSync(join(prepared,'store.sqlite'),0o600);
 await checked(cwd,['rollback',prepared,'--to','1']);
 // Reconstruct the exact v1 shape in this private copy, dropping only retained
 // v2 cells/tables. The original production store is never pruned or opened RW.
 await checked(cwd,['prune',prepared,'--allow-destructive']);
 for(const variant of ['legacy','declarative']){
  const dir=join(cwd,variant+'-deployment');cpSync(prepared,dir,{recursive:true});
  const host=await startServe(dir,{cwd});
  try{
   const token=await host.operatorToken('benchmark');
   if(n===5){const ops=await host.operatorToken('ops');await post(host,ops,'provision',{who:'service:benchmark',name:'Benchmark staff',role:'tech'});}
   const before=await snapshot(cwd,dir,n);
   if(variant==='declarative'){
    const preview=await checked(cwd,['deploy',dir,'--schema','candidate','--check','--restore-dormant']);writeFileSync(join(cwd,'preview.txt'),preview.stdout);
    assert.deepEqual(await snapshot(cwd,dir,n),before,'preview is read-only');
   }
   const started=performance.now();
   if(variant==='legacy'){
    await checked(cwd,['deploy',dir,'--schema',plan.bridge?'bridge':'legacy','--restore-dormant']);
    if(n===5){for(const table of ['pieces','firings'])for(const row of before[table])await post(host,token,table==='pieces'?'backfillPiece':'backfillFiring',{[table==='pieces'?'piece':'firing']:row.id});}
    else {const args=n===36?JSON.stringify({periodStart:Date.now()-86400000,periodEnd:Date.now()}):'{}';await checked(cwd,['run',plan.job,args,'--release',dir],{SNAPBACK4_SERVICE_TOKEN:token});}
    if(plan.bridge)await checked(cwd,['deploy',dir,'--schema','legacy','--restore-dormant']);
   }else await checked(cwd,['deploy',dir,'--schema','candidate','--restore-dormant']);
   const ms=performance.now()-started;
   await assertMigrated(cwd,dir,n,before);assert.deepEqual(await snapshot(cwd,dir,n),before,'migration preserves historical inputs');
   if(variant==='declarative'){
    await checked(cwd,['rollback',dir,'--to','1']);assert.deepEqual(await snapshot(cwd,dir,n),before,'old view preserves historical inputs');
    await checked(cwd,['rollback',dir,'--to','latest']);await assertMigrated(cwd,dir,n,before);
   }
   const record=results.find(r=>r.lane===n)??{lane:n,app:app.split('/').at(-1),rows:Object.values(before).reduce((sum,rows)=>sum+rows.length,0),oldBackendLines:lines(original),newBackendLines:lines(candidate),newBackfillLines:lines(plan.fills),replacedSourceLines:removed,oldMigrationAndSplitLines:migrationLines(app,plan,n,removed),migrationLinesSaved:migrationLines(app,plan,n,removed)-lines(plan.fills)};
   record[variant+'Ms']=Math.round(ms);if(!results.includes(record))results.push(record);
  }finally{await host.stop();}
 }
 const record=results.find(r=>r.lane===n);record.savedMs=record.legacyMs-record.declarativeMs;
 writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(record));
 // Keep modified schemas, previews and measured results. Private cloned stores,
 // credentials, copied release trees and subprocess logs are scratch.
 for(const dir of ['prepared','legacy-deployment','declarative-deployment','logs'])rmSync(join(cwd,dir),{recursive:true,force:true});
}
writeFileSync(join(root,'reports/20261019-mig/five-lanes.json'),JSON.stringify(results,null,2)+'\n');
