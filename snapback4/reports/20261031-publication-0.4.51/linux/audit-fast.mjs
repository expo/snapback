import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,cpSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [w,s,out]=process.argv.slice(2).map(p=>resolve(p));
const {evaluateStarterAudit}=await import(pathToFileURL(join(w,'scripts/publication-starters.mjs')));
if(existsSync(out))throw Error('audit output exists');mkdirSync(out,{recursive:true});
const version=JSON.parse(readFileSync(join(w,'packages/snapback4/package.json'))).version;
const client=join(s,`snapback4-${version}.tgz`),expo=join(s,`snapback4-expo-${version}.tgz`);
const binary=join(w,'target/debug/snapback4');
const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1',SNAPBACK4_INIT_INSTALL:'0',NPM_CONFIG_CACHE:join(out,'npm-cache'),npm_config_cache:join(out,'npm-cache')};delete env.SNAPBACK4_BIN;
const allow=JSON.parse(readFileSync(join(w,'scripts/starter-audit-allowlist.json')));
const summary={source:process.env.PUB51_SOURCE??spawnSync('git',['rev-parse','HEAD'],{cwd:w,encoding:'utf8'}).stdout.trim(),version,host:process.platform,started:new Date().toISOString(),stockInit:process.env.PUB51_STOCK_TEMPLATES??'host-current-source-cli',artifacts:Object.fromEntries([client,expo].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),cases:[]};
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));
for(const kind of ['web','expo']){
 const cwd=join(out,kind);mkdirSync(cwd);writeFileSync(join(cwd,'package.json'),'{"private":true}');
 const run=(cmd,args,label,allowed=[0])=>{const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:32*1024*1024});writeFileSync(join(out,`${kind}-${label}.log`),(r.stdout??'')+(r.stderr??''));if(r.error||r.signal||!allowed.includes(r.status))throw Error(`${kind} ${label}: ${r.error??r.signal??r.status}`);return r;};
 if(process.env.PUB51_STOCK_TEMPLATES){ cpSync(join(process.env.PUB51_STOCK_TEMPLATES,kind),cwd,{recursive:true}); } else { run(binary,['init','--no-install',`--${kind}`],'init'); }
 const p=JSON.parse(readFileSync(join(cwd,'package.json')));p.dependencies.snapback4=`file:${client}`;if(kind==='expo')p.dependencies['snapback4-expo']=`file:${expo}`;
 // Optional platform packages are not uploaded yet. Init ran the current-source CLI;
 // these consumers exercise only the real starter dependency/install/audit surface.
 writeFileSync(join(cwd,'package.json'),JSON.stringify(p,null,2));
 run(process.execPath,['scripts/install.mjs','--prefer-online','--no-audit','--no-fund'],'install');
 const r=run('npm',['audit','--json','--audit-level=low'],'audit',[0,1]);const report=JSON.parse(r.stdout);writeFileSync(join(out,`${kind}-audit.json`),JSON.stringify(report,null,2));
 const latest={};for(const entry of allow.filter(x=>x.starters.includes(kind))){for(const name of [entry.package,...(entry.metadataExceptions??[]).map(m=>m.package)])latest[name]=JSON.parse(run('npm',['view',name,'version','--json'],`latest-${name.replaceAll('/','-')}`).stdout);}
 const warnings=evaluateStarterAudit(report,kind,allow,latest);const result={kind,status:'passed',warnings,vulnerabilities:report.metadata.vulnerabilities};summary.cases.push(result);writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(result));
 rmSync(join(cwd,'node_modules'),{recursive:true,force:true});
}
summary.finished=new Date().toISOString();summary.status='passed';writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));rmSync(join(out,'npm-cache'),{recursive:true,force:true});console.log('AUDIT-FAST PASS');
