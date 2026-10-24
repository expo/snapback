// @ref LLP 3000.000.000.001#13-wave-26-developer-loop-repairs-dx9 — qualify every template through installed bytes, collecting all results.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {starterCases} from './publication-starters.mjs';
const root=resolve(import.meta.dirname,'..');
const scratch=mkdtempSync(join(tmpdir(),'sb4-dx9-starters-'));
const output=resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))??join(root,'reports/20261024-dx9/starters.json'));
const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1',npm_config_cache:'/tmp/dx9-npm-cache'};
delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
const run=(binary,args,cwd)=>execFileSync('timeout',['240s',binary,...args],{cwd,env,encoding:'utf8',maxBuffer:4*1024*1024});
const personaOnly=process.argv.includes('--personas');
const results=personaOnly?JSON.parse(readFileSync(output)).results.filter(r=>!r.starter.endsWith('-personas')):[];
try {
  const pack=source=>join(scratch,JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',scratch],source))[0].filename);
  const client=pack(join(root,'packages/snapback4')),expo=pack(join(root,'packages/snapback4-expo'));
  const nativeName=`snapback4-${process.platform}-${process.arch}`,native=join(scratch,'native');mkdirSync(native);
  copyFileSync(join(root,'packages',nativeName,'package.json'),join(native,'package.json'));
  copyFileSync(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'),join(native,'snapback4'));
  const platform=pack(native);
  const personas=["web","web-online","expo"].map(id=>({...starterCases.find(s=>s.id===id),id:id+"-personas",personas:true}));
  for(const starter of personaOnly?personas:[...starterCases, ...["web", "web-online", "expo"].map(id=>({...starterCases.find(s=>s.id===id),id:id+"-password",password:true})),...personas]) {
    const dir=join(scratch,starter.id);mkdirSync(dir);
    const result={starter:starter.id,steps:[],mac:'skipped by DX9 brief'};
    const step=(name,fn)=>{try{fn();result.steps.push({name,status:'passed'});return true;}catch(error){result.steps.push({name,status:'failed',message:String(error.message).slice(0,1200)});return false;}};
    try {
      writeFileSync(join(dir,'package.json'),JSON.stringify({private:true}));
      if(!step('install-cli',()=>run('npm',['install','--no-save','--ignore-scripts','--no-audit','--no-fund',client,platform],dir)))continue;
      const cli=join(dir,'node_modules/.bin/snapback4');
      if(starter.password||starter.personas) {
        mkdirSync(join(dir,'snapback'));
        const source=readFileSync(join(root,'crates/snapback4/src/verbs/init/starter/schema.q'),'utf8').replace(/^use identity.*$/m,starter.personas?'':'use identity password').replace(/^use personas.*\n/m,'');
        const identitySource=starter.personas?'use personas alice, bob\n'+source:source;
        writeFileSync(join(dir,'snapback/schema.q'),identitySource);
      }
      if(!step('init',()=>run(cli,['init',...starter.flags,...((starter.password||starter.personas)?['--skip-existing']:[])],dir)))continue;
      const manifest=JSON.parse(readFileSync(join(dir,'package.json')));manifest.dependencies.snapback4=`file:${client}`;
      manifest.optionalDependencies={[nativeName]:`file:${platform}`};
      if(starter.kind==='expo')manifest.dependencies['snapback4-expo']=`file:${expo}`;
      writeFileSync(join(dir,'package.json'),JSON.stringify(manifest,null,2));
      if(!step('install',()=>run('npm',['install','--no-audit','--no-fund'],dir)))continue;
      step('check',()=>run(cli,['check'],dir));
      step('typecheck',()=>run('npm',['run','typecheck'],dir));
      step('build',()=>run('npm',['run',starter.kind==='expo'?'build:web':'build'],dir));
      if(!starter.template)step('frontend-proof',()=>run(process.execPath,['scripts/frontend-proof.mjs'],dir));
      // Include dev dependencies; keep the exact audit evidence, never waive a red.
      const audit=spawnSync('timeout',['120s','npm','audit','--json'],{cwd:dir,env,encoding:'utf8',maxBuffer:4*1024*1024});
      let data;try{data=JSON.parse(audit.stdout);}catch{}
      result.steps.push({name:'npm-audit',status:audit.status===0?'passed':'failed',exit:audit.status,vulnerabilities:data?.metadata?.vulnerabilities,advisories:Object.entries(data?.vulnerabilities??{}).map(([name,v])=>({name,range:v.range,fixAvailable:v.fixAvailable,via:v.via.filter(x=>typeof x==='object').map(x=>({title:x.title,url:x.url,range:x.range}))}))});
    } finally {results.push(result);rmSync(dir,{recursive:true,force:true});}
    mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify({results},null,2)+'\n');
  }
} finally {mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify({results},null,2)+'\n');rmSync(scratch,{recursive:true,force:true});}
console.log(JSON.stringify(results.map(r=>({starter:r.starter,steps:r.steps.map(s=>`${s.name}:${s.status}`)}))));
if(results.some(r=>r.steps.some(s=>s.status!=='passed')))process.exitCode=1;
