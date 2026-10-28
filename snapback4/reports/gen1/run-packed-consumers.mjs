// Reproduction of the executed /tmp/gen1-consumers.mjs with portable import/root paths.
import {proveStarters} from '../../scripts/publication-starters.mjs';
import {proveProofKit} from '../../scripts/publication-proof-kit.mjs';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'), scratch=process.env.GEN1_CONSUMER_DIR ?? '/tmp/gen1-consumers';
mkdirSync(scratch,{recursive:true});
const pack=name=>{
 const result=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',scratch],{cwd:join(root,'packages',name),encoding:'utf8'}));
 return join(scratch,result[0].filename);
};
const binary=join(root,'packages/snapback4-linux-x64/snapback4');
let client,platform,expo;
try {
 copyFileSync(join(root,'target/debug/snapback4'),binary);
 client=pack('snapback4');platform=pack('snapback4-linux-x64');expo=pack('snapback4-expo');
} finally {rmSync(binary,{force:true});}
const results={qualification:false,platform:'linux-x64',binaryProfile:'dev, incremental=0 debug=0',artifacts:[client,platform,expo].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),results:[]};
for(const [name,run] of [['starters',()=>proveStarters(client,platform,expo,scratch)],['proof-kit',()=>proveProofKit(client,platform,scratch)]]){
 const started=performance.now();
 try {const result=await run();results.results.push({name,status:'passed',seconds:(performance.now()-started)/1000,result});}
 catch(error){results.results.push({name,status:'failed',seconds:(performance.now()-started)/1000,error:error.stack});process.exitCode=1;}
 writeFileSync(join(root,'reports/gen1/packed-consumers.json'),JSON.stringify(results,null,2)+'\n');
}
