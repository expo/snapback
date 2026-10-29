import './test-npm-cache.mjs';
// Run modified starters and literal guide recipes through installed tarballs.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),scratch='/tmp/dx13-replay/packed';mkdirSync(scratch,{recursive:true});
const out=join(root,'reports/20261026-dx13/packed.json'),results=[];
const nativeBinary=resolve(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'));
const binarySha256=createHash('sha256').update(readFileSync(nativeBinary)).digest('hex');
const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1',CHROME:process.env.CHROME??'/home/ccheever/.cache/ms-playwright/chromium-1193/chrome-linux/chrome'};
delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
const run=(binary,args,cwd)=>execFileSync('timeout',['600s',binary,...args],{cwd,env,encoding:'utf8',maxBuffer:8*1024*1024});
try{
 const pack=source=>join(scratch,JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',scratch],source))[0].filename);
 const client=pack(join(root,'packages/snapback4')),expo=pack(join(root,'packages/snapback4-expo'));
 const nativeName=`snapback4-${process.platform}-${process.arch}`,native=join(scratch,'native');mkdirSync(native);
 copyFileSync(join(root,'packages',nativeName,'package.json'),join(native,'package.json'));
 copyFileSync(nativeBinary,join(native,'snapback4'));const platform=pack(native);
 const bootstrap=join(scratch,'bootstrap');mkdirSync(bootstrap);
 writeFileSync(join(bootstrap,'package.json'),JSON.stringify({private:true,dependencies:{snapback4:`file:${client}`},optionalDependencies:{[nativeName]:`file:${platform}`}}));
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund'],bootstrap);
 const packedCli=join(bootstrap,'node_modules/.bin/snapback4');
 for(const kind of ['web','expo']){
  const cwd=join(scratch,kind);mkdirSync(cwd);const steps=[];results.push({kind,steps});
  const step=(name,fn)=>{try{const value=fn();steps.push({name,ok:true});return value;}catch(error){steps.push({name,ok:false,error:String(error.message).slice(0,3000)});throw error;}};
  step('packed-init',()=>run(packedCli,['init','.',`--${kind}`,'--online','--password'],cwd));
  const manifest=JSON.parse(readFileSync(join(cwd,'package.json')));manifest.dependencies.snapback4=`file:${client}`;manifest.optionalDependencies={[nativeName]:`file:${platform}`};if(kind==='expo')manifest.dependencies['snapback4-expo']=`file:${expo}`;writeFileSync(join(cwd,'package.json'),JSON.stringify(manifest,null,2));
  step('install-progress',()=>run(process.execPath,['scripts/install.mjs','--no-audit','--no-fund'],cwd));
  const cli=join(cwd,'node_modules/.bin/snapback4');
  for(const code of ['E_SERVE_DEPLOYMENT_MISMATCH','E_SERVE_STORE_MISSING','E_SERVE_LOCK_BARRIER'])step(`why-${code}`,()=>{const text=run(cli,['why',code],cwd);if(!text.includes(code)||!text.includes('guide staging'))throw Error(`missing packed explanation: ${code}`);});
  step('check',()=>run(cli,['check'],cwd));step('typecheck',()=>run('npm',['run','typecheck'],cwd));
  step('frontend-proof',()=>run(process.execPath,['scripts/frontend-proof.mjs'],cwd));
  // The recipe is extracted byte-for-byte, including repeat-safe credentials.
  if(kind==='web'){
   const guide=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8');
   writeFileSync(join(cwd,'snapback/schema.q'),guide.match(/```quarry\n([\s\S]*?)```/)[1]);
   step('guide-check',()=>run(cli,['check'],cwd));
   writeFileSync(join(cwd,'staging.mjs'),guide.match(/```js\n([\s\S]*?)```/)[1]);
   for(let i=1;i<=2;i++)step(`literal-staging-recipe-${i}`,()=>run(process.execPath,['staging.mjs','--once'],cwd));
  }
 }
}finally{writeFileSync(out,JSON.stringify({binarySha256,results},null,2)+'\n');rmSync(scratch,{recursive:true,force:true});}
console.log(JSON.stringify(results));
