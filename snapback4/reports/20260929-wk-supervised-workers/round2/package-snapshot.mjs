import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'wk-r2-module-scope-')), project=join(root,'project');
mkdirSync(join(project,'snapback/workers/helpers'),{recursive:true});
for(const [where,name] of [[root,'ancestor'],[project,'local']]) {
 const dir=join(where,'node_modules',name);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'package.json'),JSON.stringify({name,type:'module',exports:'./index.js'}));
 writeFileSync(join(dir,'index.js'),`export default '${name}'`);
}
writeFileSync(join(project,'package.json'),' {"type":"module"} ');
writeFileSync(join(project,'snapback/schema.q'),'query hello():\n  return true\n');
writeFileSync(join(project,'snapback/workers/helpers/value.ts'),'export const value: string = "helper";');
writeFileSync(join(project,'snapback/workers/push.ts'),`import ancestor from 'ancestor';import local from 'local';import {value} from './helpers/value.ts';import {writeFileSync} from 'node:fs';writeFileSync('result',JSON.stringify({ancestor,local,value}));setInterval(()=>{},1000);`);
const child=spawn(process.argv[2],['dev','--port','0','--no-watch'],{cwd:project,stdio:['ignore','pipe','pipe']});
const done=once(child,'exit');let log='';child.stderr.on('data',b=>log+=b);child.stdout.resume();
try {
 for(let i=0;i<100&&!existsSync(join(project,'result'));i++) await sleep(50);
 assert.deepEqual(JSON.parse(readFileSync(join(project,'result'),'utf8')),{ancestor:'ancestor',local:'local',value:'helper'},log);
 console.log('PASS: snapshot preserves project ESM type, TypeScript helpers and both ancestor/local package lookup');
} finally {child.kill('SIGTERM');await done;rmSync(root,{recursive:true,force:true});}
