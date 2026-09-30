// Isolate the late one-shot approval fence from the reused-handle fix.
import {cpSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const dest='target/pr-r2-approval-control';mkdirSync(dest,{recursive:true});
cpSync('packages/snapback4/dist',`${dest}/dist`,{recursive:true});
cpSync('packages/snapback4/package.json',`${dest}/package.json`);
const file=`${dest}/dist/local.js`, code=readFileSync(file,'utf8');
const fence=' && (!("data" in result.read) || !changesStopped && !partitionDenied && answers.blocked(result) === undefined)';
if(!code.includes(fence)) throw Error('Expected publication fence missing');
writeFileSync(file,code.replace(fence,''));
const result=spawnSync(process.execPath,['--test','--test-name-pattern=dormant local handle','packages/snapback4/test/subscription-pressure-round2.test.mjs'],{env:{...process.env,RL_TEST_SDK:resolve(dest,'dist')},encoding:'utf8'});
writeFileSync('reports/20260930-pr-subscription-pressure/round2/approval-control.log',result.stdout+result.stderr);
writeFileSync('reports/20260930-pr-subscription-pressure/round2/approval-control.exit',`${result.status}\n`);
console.log(result.status,result.stdout.slice(-2000));
if(result.status!==1||!result.stdout.includes('one-shot facade cannot approve data across a terminal refusal'))throw Error('Control failed to detect the intended stale approval');
