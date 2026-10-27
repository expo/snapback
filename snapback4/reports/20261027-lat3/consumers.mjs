import {proveStarters} from '../../scripts/publication-starters.mjs';
import {proveProofKit} from '../../scripts/publication-proof-kit.mjs';
import {proveStaging} from '../../scripts/publication-staging.mjs';
import {proveProduction} from '../../scripts/publication-production.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [client,platform,expo,out]=process.argv.slice(2).map(path=>resolve(path));
mkdirSync(out,{recursive:true});
const receipt={qualification:false,artifacts:[client,platform,expo].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),results:[]};
for(const [name,run] of [
 ['starters',()=>proveStarters(client,platform,expo,join(out,'starters'))],
 ['proof-kit',()=>proveProofKit(client,platform,join(out,'proof-kit'))],
 ['staging',()=>proveStaging(client,platform,join(out,'staging'))],
 ['production',()=>proveProduction(client,platform,expo,join(out,'production'))],
]) {
 mkdirSync(join(out,name==='proof-kit'?'proof-kit':name),{recursive:true});
 const start=performance.now();
 try {const result=await run();receipt.results.push({name,status:'passed',seconds:(performance.now()-start)/1000,result});}
 catch(error){receipt.results.push({name,status:'failed',seconds:(performance.now()-start)/1000,message:error.message});process.exitCode=1;}
 writeFileSync(join(out,'consumers.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(name,receipt.results.at(-1).status,receipt.results.at(-1).seconds.toFixed(3));
}
