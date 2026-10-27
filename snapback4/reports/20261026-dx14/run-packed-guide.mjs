// Execute the shipped DX14 TS snippets and jobs headline from installed tarballs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {globSync} from 'node:fs';
const packs=resolve(process.argv[2]??'/tmp/dx14-packs'),base='/tmp/dx14-replay/packed-guide';mkdirSync(base,{recursive:true});
const cwd=mkdtempSync(join(base,'run-')),hosts=[],rows=[];
const artifact=join(import.meta.dirname,'packed-guide-replays.json');
const files=['snapback4-0.4.43.tgz','snapback4-expo-0.4.43.tgz','snapback4-linux-x64-0.4.43.tgz'];
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=Object.fromEntries(files.map(file=>[file,digest(join(packs,file))]));
let phase='install',failure;
function run(exe,args,options={}){return execFileSync(exe,args,{cwd,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],...options});}
try{
 writeFileSync(join(cwd,'package.json'),'{"private":true,"type":"module"}');
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--legacy-peer-deps','--omit=optional','--cache',join(cwd,'npm-cache'),...files.map(file=>join(packs,file)),'playwright-core@1.55.1','react@19.3.0']);
 const pkg=join(cwd,'node_modules/snapback4'),binary=join(cwd,'node_modules/snapback4-linux-x64/snapback4');assert.ok(existsSync(binary));
 const kit=await import(pathToFileURL(join(pkg,'dist/proof.js'))),{createClient}=await import(pathToFileURL(join(pkg,'dist/client.js')));
 const backend={env:{SNAPBACK4_BIN:binary},logsDir:join(cwd,'private-logs')};
 phase='extract exact shipped snippets';
 const reference=readFileSync(join(pkg,'CLIENT-AND-OPERATIONS.md'),'utf8'),section=reference.split('## Headless settlement and labelled controls\n')[1]?.split('\n## ')[0];assert.ok(section);
 const blocks=[...section.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map(match=>match[1]);assert.equal(blocks.length,2);
 const app=join(cwd,'template');mkdirSync(app);run(binary,['init','--web'],{cwd:app});run(binary,['check'],{cwd:app});
 mkdirSync(join(app,'scripts'),{recursive:true});writeFileSync(join(app,'scripts/save-title.ts'),blocks.find(text=>text.includes('function saveTitle')));writeFileSync(join(app,'scripts/choose-owner.ts'),blocks.find(text=>text.includes('function chooseOwner')));
 phase='execute literal saveTitle TS';
 const {saveTitle}=await import(pathToFileURL(join(app,'scripts/save-title.ts'))),{api}=await import(pathToFileURL(join(app,'snapback/generated/api.ts')));
 const dev=await kit.startDev({...backend,cwd:app,args:['--memory']});hosts.push(dev);
 const client=createClient({url:dev.url,persona:'alice'});
 try{const write=await saveTitle(client,'Packed guide title');assert.equal(write.state,'sent');assert.equal(write.result.title,'Packed guide title');const read=await client.query(api.list,{c:null});assert.ok(read.data.some(row=>row.title==='Packed guide title'));}finally{await client.close();}
 rows.push({step:'saveTitle snippet saved byte-for-byte as scripts/save-title.ts; native Node24 import of generated api.add .ts; real template backend',status:'pass',outcome:'sent receipt and authoritative list contain the supplied title',snippetSha256:digest(join(app,'scripts/save-title.ts'))});
 phase='execute literal chooseOwner TS';
 const {chooseOwner}=await import(pathToFileURL(join(app,'scripts/choose-owner.ts')));
 const chrome=process.env.CHROME??globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`).sort().reverse()[0];assert.ok(chrome,'Chromium executable needed');
 await kit.withBrowser({cwd,executablePath:chrome,logsDir:join(cwd,'private-logs')},async context=>{const page=await context.newPage();await page.setContent('<label>Owner<select><option value="">Choose</option><option value="alice">Alice</option><option value="bob">Bob</option></select></label>');await chooseOwner(page,'bob');assert.equal(await page.locator('select').inputValue(),'bob');});
 rows.push({step:'chooseOwner snippet saved byte-for-byte as scripts/choose-owner.ts; native Node24 import; real Chromium',status:'pass',outcome:'wrapped Owner combobox selected bob; option text did not change the required label',snippetSha256:digest(join(app,'scripts/choose-owner.ts'))});
 phase='extract installed CLI jobs headline';
 const guide=run(binary,['guide','jobs','--full']),quarry=guide.match(/```quarry\n([\s\S]*?)\n```/)?.[1];assert.ok(quarry);assert.match(quarry,/\.sentAt < periodEnd/);assert.ok(!quarry.includes('.sentAt >= periodStart'));
 const job=join(cwd,'jobs');mkdirSync(join(job,'snapback'),{recursive:true});writeFileSync(join(job,'snapback/schema.q'),quarry+'\n');
 const jobHost=await kit.startDev({...backend,cwd:job,args:['--unsafe-dev-doors']});hosts.push(jobHost);
 phase='seed jobs rows and advance skipped windows';
 const now=await jobHost.now(),day=86400000,end=Math.ceil((now+4*day-8*3600000)/day)*day+8*3600000;
 const seed=[['old',now-30*day,false],['current',end-1,false],['boundary',end,false],['future',end+day,false],['already',now-30*day,true]].map(([id,sentAt,reminded])=>({table:'invites',row:{id,inviteeId:'dev:alice',sentAt,reminded}}));
 const seeded=await fetch(jobHost.url+'/seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(seed)});const seedReply=await seeded.json();assert.equal(seeded.ok,true);assert.ok(!seedReply.denied);
 const advanced=await jobHost.advance(`${end-now}ms`,{drain:true}),schedule=advanced.fired.find(value=>value.name==='remindDaily'||value.schedule==='remindDaily')??advanced.fired[0];assert.ok(schedule);assert.equal(schedule.firedWindows.length,1);assert.equal(schedule.firedWindows[0].periodEnd,end);assert.ok(schedule.skippedPeriods>0);
 const inspect=()=>JSON.parse(run(binary,['data','invites','--json'],{cwd:job})).rows;
 const state=Object.fromEntries(inspect().map(row=>[row.id,row.reminded]));assert.deepEqual(state,{old:true,current:true,boundary:false,future:false,already:true});
 const replay=JSON.parse(run(binary,['run','remind',JSON.stringify({periodStart:end-day,periodEnd:end}),'--port',new URL(jobHost.url).port,'--json'],{cwd:job}));assert.equal(replay.state,'done');assert.equal(replay.rowsWritten,0);assert.deepEqual(Object.fromEntries(inspect().map(row=>[row.id,row.reminded])),state);
 rows.push({step:'first Quarry fence from installed CLI guide jobs --full, unchanged; seeded old/current/exact-boundary/future/already-reminded rows; advanced >4 daily boundaries with kit',status:'pass',outcome:'one coalesced latest window processed old and current rows, excluded sentAt == periodEnd and future rows; same-window replay wrote zero rows',quarrySha256:createHash('sha256').update(quarry).digest('hex'),skippedPeriods:schedule.skippedPeriods,firedWindows:schedule.firedWindows.length,reminded:state});
}catch(error){failure={phase,message:typeof error?.code==='string'?error.code:(error?.name??'Error')};throw error;}
finally{
 let cleanupFailed=false;for(const host of hosts.reverse()){try{await host.stop();}catch{cleanupFailed=true;}}
 const report={date:'2026-10-26',runtime:process.version,tarballs:hashes,method:'npm-installed local client/Expo/Linux tarballs with native Node24 .ts stripping; packed Linux binary only, no checkout-binary override',rows,ok:!failure&&!cleanupFailed,...(failure?{failure}:{}),cleanup:{ownedHostsStopped:!cleanupFailed,temporaryTreeRemoved:true},limitations:['Focused runtime documentation replay only; no publication qualification claim.','First-account appendix source tests remain separately recorded by the lead.']};
 rmSync(cwd,{recursive:true,force:true});try{rmSync(base);}catch{}writeFileSync(artifact,JSON.stringify(report,null,2)+'\n');if(cleanupFailed)throw Error('packed guide host cleanup failed');
}
console.log(JSON.stringify({artifact,passed:rows.length,ok:true}));
