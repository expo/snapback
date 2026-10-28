// Actual installed tarball consumers; debug platform here is not publication qualification.
import {proveStarters} from '../../scripts/publication-starters.mjs';
import {proveProofKit} from '../../scripts/publication-proof-kit.mjs';
import {proveStaging} from '../../scripts/publication-staging.mjs';
import {proveProduction} from '../../scripts/publication-production.mjs';
import {proveDay2} from '../../scripts/publication-day2.mjs';
import {proveMigrations} from '../../scripts/publication-migrations.mjs';
import {proveDX16} from '../../scripts/publication-dx16.mjs';
import {mkdirSync,writeFileSync,readFileSync,copyFileSync,chmodSync,globSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),base=process.env.DX16_CONSUMER_BASE??'/tmp/dx16-replay/consumers',packs=join(base,'packs');mkdirSync(packs,{recursive:true});
process.env.SNAPBACK4_INIT_INSTALL='0';process.env.RUST_TEST_THREADS='4';
process.env.npm_config_cache=join(base,'npm-cache');mkdirSync(process.env.npm_config_cache,{recursive:true});
process.env.CHROME??=globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`).sort().reverse()[0];
process.env.SNAPBACK4_CONSUMER_TIMEOUT_MS='180000';
const version=JSON.parse(readFileSync(join(root,'packages/snapback4/package.json'))).version;
copyFileSync(join(root,'target/debug/snapback4'),join(root,'packages/snapback4-linux-x64/snapback4'));chmodSync(join(root,'packages/snapback4-linux-x64/snapback4'),0o755);
for(const pkg of ['snapback4','snapback4-linux-x64','snapback4-expo'])execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',packs],{cwd:join(root,'packages',pkg),timeout:120000,stdio:'pipe'});
const paths=['snapback4','snapback4-linux-x64','snapback4-expo'].map(p=>join(packs,`${p}-${version}.tgz`));
const result={qualification:false,binaryProfile:'dev/test debug=0, not production publication',packs:Object.fromEntries(paths.map(p=>[p.split('/').at(-1),createHash('sha256').update(readFileSync(p)).digest('hex')])),steps:[]};
const steps=[['day2',proveDay2,[...paths.slice(0,2),base]],['starters',proveStarters,[...paths,base]],['proofKit',proveProofKit,[...paths.slice(0,2),base]],['staging',proveStaging,[...paths.slice(0,2),base]],['production',proveProduction,[...paths,base]],['migrations',proveMigrations,[...paths.slice(0,2),base]]];
for(const [name,fn,args] of steps){
 const start=Date.now();try{
  const value=await fn(...args);result.steps.push({name,ok:true,seconds:(Date.now()-start)/1000,value});
  if(name==='day2'){const t=Date.now();try{const value=await proveDX16(value.directory);result.steps.push({name:'DX16',ok:true,seconds:(Date.now()-t)/1000,value});}catch(error){result.steps.push({name:'DX16',ok:false,seconds:(Date.now()-t)/1000,error:String(error).slice(0,2000)});}}
 }catch(error){result.steps.push({name,ok:false,seconds:(Date.now()-start)/1000,error:String(error).slice(0,2000)});}
 writeFileSync(process.env.DX16_CONSUMER_REPORT??join(import.meta.dirname,'packed-consumers.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.steps.at(-1)));
}
if(result.steps.some(s=>!s.ok))process.exitCode=1;
