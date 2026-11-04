import assert from 'node:assert/strict';
import {cli} from 'snapback4/proof';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,delimiter} from 'node:path';
const base="/home/ccheever/sb4-intent/0453/linux-qualification-0.4.53/day2-compatibility";
for(const code of [0,17]){
 const project=join(base,'owned-install-'+code),bin=join(base,'mock-npm-'+code);
 mkdirSync(project);mkdirSync(bin);
 writeFileSync(join(bin,'npm'),'#!/bin/sh\necho INSTALL_PRIVATE_PROGRESS\nsleep 0.1\nexit '+code+'\n',{mode:0o755});
 const result=await cli(['init','--web','--online','--password'],{cwd:project,env:{...process.env,PATH:bin+delimiter+process.env.PATH,SNAPBACK4_INIT_INSTALL:'1'}});
 assert.equal(result.code,code,result.stdout+result.stderr);
 assert.doesNotMatch(result.stdout+result.stderr,/INSTALL_PRIVATE_PROGRESS|still running/);
 const state=JSON.parse(readFileSync(join(project,'.snapback4/install.json'),'utf8'));
 assert.equal(state.state,'finished');assert.equal(state.code,code);
 assert.match(readFileSync(join(project,'.snapback4/install.log'),'utf8'),/INSTALL_PRIVATE_PROGRESS/);
}
console.log('packed init default foreground ownership, quiet output and exit propagation passed');
