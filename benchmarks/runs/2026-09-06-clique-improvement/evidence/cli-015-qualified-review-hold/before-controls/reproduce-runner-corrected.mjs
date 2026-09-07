import { build } from '/Users/ccheever/projects/snapback-worktrees/clique-release-next/snapback2/node_modules/esbuild/lib/main.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'runner-before-corrected');await mkdir(root);
const source='/Users/ccheever/projects/snapback-worktrees/clique-release-next/snapback2/packages/snapback2/src/test.ts';
const built=await build({entryPoints:[source],outfile:resolve(root,'test-runner.mjs'),bundle:true,format:'esm',platform:'node',target:'node20',external:['expo-file-system','expo/fetch'],metafile:true});
await writeFile(resolve(root,'inputs.json'),JSON.stringify(built.metafile,null,2));
await writeFile(resolve(root,'test.mjs'),await readFile(resolve(root,'test-runner.mjs')));
const module=resolve(root,'drift.mjs');
await writeFile(module,`import {journey} from './test.mjs';\nconst names=process.argv.includes('--list')?['target','other']:['other','target'];\nfor(const name of names)journey(name,()=>{if(name==='target')throw Error('selected failure');});\n`);
const rows=[];
for(const [name,extra] of [['discovery',['--list']],['selected-index-zero',['--journey-index','0']],['full',[]]]){
 const argv=[resolve(root,'test-runner.mjs'),'--url','http://127.0.0.1:1','--secret','CONSPICUOUS-FAKE-NOT-A-CREDENTIAL',...extra,'--',module];
 const start=performance.now();const p=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:15000});
 rows.push({name,pid:p.pid,exitCode:p.status,error:p.error?.message,seconds:(performance.now()-start)/1000,argv,stdout:p.stdout,stderr:p.stderr});
}
await writeFile(resolve(root,'receipt.json'),JSON.stringify({source,sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),networkUsed:false,serverStarted:false,rows},null,2));
if(rows[0].exitCode!==0||rows[1].exitCode!==0||!rows[1].stdout.includes('"name":"other"')||rows[2].exitCode!==1)throw Error('counterexample not reproduced');
console.log(JSON.stringify({observed:'discovery target at0; isolated index0 runs other and passes; full executes target and fails',rows:rows.map(({name,pid,exitCode,seconds})=>({name,pid,exitCode,seconds}))}));
