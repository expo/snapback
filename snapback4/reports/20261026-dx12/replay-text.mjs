// Compare proof observations on actual copied Expo web apps; retain counts only.
import {cpSync,mkdirSync,readFileSync,readdirSync,symlinkSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {withServeScript,withBrowser,startStatic,fillRN,renderedText,waitForFresh} from '../../packages/snapback4/dist/proof.js';
import {chromiumExecutable} from '../../witness/lib.mjs';
const old=await import(pathToFileURL('/tmp/dx12-replay/control-client/package/dist/proof.js'));
const root=resolve(import.meta.dirname,'../..'),evidence='/home/ccheever/sb4-loop/wave29/apps',rows=[];
try {
for(const number of ['015']){
 const name=readdirSync(evidence).find(n=>n.startsWith(number+'-snapback-')),src=join(evidence,name),cwd=join('/tmp/dx12-replay/text',name);mkdirSync(cwd,{recursive:true});
 for(const entry of readdirSync(src,{withFileTypes:true}))if(!['node_modules','.agent.ndjson','.git','.harness','logs','.scratch','.checkpoint'].includes(entry.name)&&(entry.isDirectory()||entry.isFile()))cpSync(join(src,entry.name),join(cwd,entry.name),{recursive:true,filter:p=>{try{return !statSync(p).isSocket();}catch{return false;}}});
 mkdirSync(join(cwd,'node_modules/.bin'),{recursive:true});for(const n of readdirSync(join(root,'node_modules')))if(!['.bin','snapback4'].includes(n))try{symlinkSync(join(root,'node_modules',n),join(cwd,'node_modules',n));}catch{}
 try{symlinkSync(join(root,'packages/snapback4'),join(cwd,'node_modules/snapback4'));}catch{}for(const n of readdirSync(join(root,'node_modules/.bin')))try{symlinkSync(join(root,'node_modules/.bin',n),join(cwd,'node_modules/.bin',n));}catch{}
 try{symlinkSync(join(root,'packages/snapback4/bin/snapback4.js'),join(cwd,'node_modules/.bin/snapback4'));}catch{}
 const env={SNAPBACK4_BIN:join(root,'target/debug/snapback4'),PATH:join(cwd,'node_modules/.bin')+':'+process.env.PATH};
 try{await withServeScript('prod:serve',async ready=>{
 const web=await startStatic('dist',{cwd});try{await withBrowser({cwd,executablePath:chromiumExecutable()},async context=>{
 const page=await context.newPage();await page.setViewportSize({width:700,height:400});await page.goto(web.url+'/?api='+encodeURIComponent(ready.backendUrl),{waitUntil:'domcontentloaded'});
 const account=ready.users[number==='009'?'registrar':'desk'][0];await fillRN(page.getByLabel('Email',{exact:true}),account.email);await fillRN(page.getByLabel('Password',{exact:true}),account.password);await page.getByRole('button',{name:/^sign in$/i}).click();await page.getByRole('button',{name:/^sign out$/i}).waitFor();await page.waitForTimeout(1000);
 const candidates=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.childElementCount===0&&!['INPUT','SCRIPT','STYLE'].includes(e.tagName)&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().top>innerHeight).map(e=>(e.textContent??'').trim()).filter(Boolean));
 let sample;for(const text of candidates){
 const raw=page.getByText(text,{exact:true});if(await raw.count()!==1)continue;
 const beforeInView=await raw.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});
 const before=await old.renderedText(page,text,{exact:true}).count();
 const after=renderedText(page,text,{exact:true});if(await after.count()!==1)continue;
 const begin=performance.now();await waitForFresh(after,null,2000);const inView=await after.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});sample={beforeCount:before,beforeInView,afterCount:1,inView,ms:Math.round(performance.now()-begin)};break;}
 rows.push({lane:name,candidateCount:candidates.length,...sample,ok:sample?sample.inView===true:null,...(sample?{}:{note:'No below-fold leaf on initial role screen; lane009 is exercised by the separate full doll journey.'})});
 });}finally{await web.stop();}
 },{cwd,env,deployment:'deploy',timeoutMs:60000,thenTimeoutMs:90000});}catch{rows.push({lane:name,ok:false,failure:'copied frontend proof refused'});}
 console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(join(import.meta.dirname,'text-measurements.json'),JSON.stringify({method:'actual copied Expo dist and prod:serve; real password login; unique below-fold leaf; baseline kit0.4.42 vs DX12; count and on-screen geometry only',rows},null,2)+'\n');

} finally { rmSync('/tmp/dx12-replay/text',{recursive:true,force:true}); }
