// Run the literal shipped workflow through installed client/platform tarballs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const [packArg,dirArg]=process.argv.slice(2),packs=resolve(packArg),dir=resolve(dirArg);
mkdirSync(dir,{recursive:true});
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:300000,maxBuffer:16<<20,env:{...process.env,SNAPBACK4_INIT_INSTALL:'0',npm_config_registry:'http://127.0.0.1:4873/'}});
const started=Date.now();
writeFileSync(join(dir,'package.json'),'\n{"private":true,"type":"module"}\n');
run('npm',['install','--no-save','--no-audit','--no-fund','--ignore-scripts',join(packs,'snapback4-0.4.44.tgz'),join(packs,'snapback4-linux-x64-0.4.44.tgz')]);
const cli=join(dir,'node_modules/.bin/snapback4');
const start=run(cli,['guide','start']),workflow=run(cli,['guide','workflow','--repeat']);
assert.ok(Buffer.byteLength(start)<=8001&&Buffer.byteLength(workflow)<=8001);
mkdirSync(join(dir,'snapback'));writeFileSync(join(dir,'snapback/schema.q'),workflow.split('```quarry\n')[1].split('```')[0]);
const checked=run(cli,['check']);assert.match(checked,/API index: `guide api generated`/);
run(cli,['init','--web','--online','--password','--no-install']);
writeFileSync(join(dir,'scripts/acceptance.mjs'),workflow.split('```js\n')[1].split('```')[0]);
for(let n=0;n<2;n++)assert.match(run(process.execPath,['scripts/acceptance.mjs']),/acceptance passed/);
const signatures={};for(const module of ['app','witness','react','client','auth','proof','generated'])signatures[module]=run(cli,['guide','api',module]);
for(const file of ['README.md','SERVER.md','CLIENT-AND-OPERATIONS.md']){const doc=readFileSync(join(dir,'node_modules/snapback4',file),'utf8');assert.ok(doc.includes('guide start'));}
const report={ok:true,wallMs:Date.now()-started,startBytes:Buffer.byteLength(start),workflowBytes:Buffer.byteLength(workflow),acceptanceRuns:2,signatures:Object.fromEntries(Object.entries(signatures).map(([k,v])=>[k,Buffer.byteLength(v)])),qualification:false};
console.log(JSON.stringify(report,null,2));
