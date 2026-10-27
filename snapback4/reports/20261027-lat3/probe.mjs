// Private replay driver. Readiness (including credentials) stays in /tmp/lat3.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const kit=await import(pathToFileURL(resolve('node_modules/snapback4/dist/proof.js')).href);
const {logged,ready}=await import(pathToFileURL(resolve('node_modules/snapback4/dist/proof-process.js')).href);
const started=performance.now();
const run=logged('npm',['run','--silent','probe:serve'],{processGroup:true,env:{...process.env,SNAPBACK4_PROBE_HOLD:'1'}});
let value;
try {
 await ready(run,line=>{
  try {const x=JSON.parse(line);if(typeof x.backendUrl==='string'){value=x;return x.backendUrl;}}catch{}
 },300000);
 const readySeconds=(performance.now()-started)/1000;
 writeFileSync('lat3-users.private.json',JSON.stringify(value.sessions??value.users??value.accounts),{mode:0o600});
 const callsStarted=performance.now();
 const calls=await kit.command('npm',['run','--silent','client:calls'],{env:{...process.env,BACKEND_URL:value.backendUrl,SNAPBACK_URL:value.backendUrl,FRONTEND_URL:value.frontendUrl,CALLS_USERS:resolve('lat3-users.private.json'),SNAPBACK4_SERVE_JSON:JSON.stringify(value)},timeoutMs:300000});
 const callsSeconds=(performance.now()-callsStarted)/1000;
 writeFileSync('lat3-calls.stdout',calls.stdout,{mode:0o600});writeFileSync('lat3-calls.stderr',calls.stderr,{mode:0o600});
 writeFileSync('lat3-probe.json',JSON.stringify({readySeconds,callsCode:calls.code,callsSeconds}),{mode:0o600});
 process.exitCode=calls.code??1;
} finally {await kit.stopChild(run.child);}
