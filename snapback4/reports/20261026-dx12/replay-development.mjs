import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {startDev,devAccounts} from '../../packages/snapback4/dist/proof.js';
const root='/home/ccheever/sb4-loop/wave29/apps',work='/tmp/dx12-replay/development';mkdirSync(work,{recursive:true,mode:0o700});const rows=[];
try{for(const name of readdirSync(root).filter(n=>/^\d+-snapback-/.test(n))){const src=join(root,name);const idea=JSON.parse(readFileSync(join(src,'.lane-idea.json')));if(idea.model!=='codex')continue;
 const cwd=join(work,name);mkdirSync(join(cwd,'snapback'),{recursive:true});let text='';for(const f of readdirSync(join(src,'snapback')))if(f.endsWith('.q')){cpSync(join(src,'snapback',f),join(cwd,'snapback',f));text+=readFileSync(join(src,'snapback',f),'utf8')+'\n';}
 const found=/mutation\s+(provision)\(([\s\S]*?)\):/.exec(text),role=found&&/(\w+)\s*:\s*enum\(([^)]+)\)/.exec(found[2]);if(!role){rows.push({lane:name,ok:false,reason:'no generic enum provisioning plan'});continue;}
 const names=[...role[2].matchAll(/'([^']+)'/g)].map(m=>m[1]),roles=Object.fromEntries(names.map(n=>[n,1]));let host;const began=performance.now();try{host=await startDev({cwd,args:['--memory'],env:{SNAPBACK4_BIN:'/home/ccheever/projects/sb4-b29-dx12/snapback4/target/debug/snapback4'}});
 const accounts=await devAccounts(host,{roles,provision:{name:found[1]},args:account=>Object.fromEntries([...found[2].matchAll(/(\w+)\s*:\s*text\b/g)].map(m=>[m[1],m[1].toLowerCase().includes("email")?account.email:"DX12 "+account.role])),timeoutMs:30000});let loggedIn=0;
 for(const account of Object.values(accounts).flat()){const r=await fetch(host.url+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password}),signal:AbortSignal.timeout(5000)});if((await r.json()).session?.principal===account.principal)loggedIn++;}
 rows.push({lane:name,ok:loggedIn===names.length,roles:names.length,realPasswordLogins:loggedIn,ms:Math.round(performance.now()-began)});
 }catch{rows.push({lane:name,ok:false,reason:'development plan refused',ms:Math.round(performance.now()-began)});}finally{await host?.stop();}
 console.log(JSON.stringify(rows.at(-1)));
}writeFileSync(new URL('./development-measurements.json',import.meta.url),JSON.stringify({method:'all23 wave29 Codex schemas on copies; infer existing provision role enum; devAccounts 1 real password user per role then ordinary password login; no credentials retained',rows},null,2)+'\n');}
finally{rmSync(work,{recursive:true,force:true});}
