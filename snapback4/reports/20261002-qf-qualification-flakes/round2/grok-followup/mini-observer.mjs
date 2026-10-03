import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {runFile} from './snapback4/scripts/run-client-tests.mjs';
import {processTable} from './snapback4/scripts/test-processes.mjs';
import {createTokenInspector} from './snapback4/scripts/test-process-token.mjs';
let latest,baseline;const observations=[];
const scan=createTokenInspector({inspect:()=>{latest=processTable();baseline??=latest;return latest;},run:(...args)=>{
 const result=spawnSync(...args);let rows;try{rows=JSON.parse(result.stdout)}catch{return result}
 const errors=rows.filter(row=>row.error);
 if(errors.length){const pids=errors.map(row=>row.pid).join(',');const names=spawnSync('/bin/ps',['-p',pids,'-o','pid=,ppid=,pgid=,uid=,comm='],{encoding:'utf8',timeout:2000,env:{...process.env,LC_ALL:'C'}});
 observations.push({time:new Date().toISOString(),errors:errors.map(row=>({...row,process:latest.find(p=>p.pid===row.pid),baselineSession:baseline.find(p=>p.pid===row.session)})),names:names.stdout});}
 return result;
}});
const result=await runFile('snapback4/packages/snapback4/test/test-file-runner.test.mjs',{inspectToken:scan});
writeFileSync('observer.json',JSON.stringify({result,observations},null,2)+'\n');process.exitCode=result.passed?0:1;
