import {spawn} from 'node:child_process';
import fs from 'node:fs';
const mode=process.argv[2]??'serve',root=process.argv[3]??'.',port=process.argv[4]??'54900';
if(+port<54900||+port>54919)throw Error('Assigned port range only');
const log=fs.openSync(`evidence/server-${port}.log`,'a');
const child=spawn(process.execPath,['node_modules/snapback3/dist/cli.mjs',mode,root,'--port',port],{stdio:['ignore',log,log],detached:true});
fs.appendFileSync('evidence/server-pids.jsonl',JSON.stringify({pid:child.pid,role:'owner',port:+port,root,epoch:Date.now()/1000})+'\n');
fs.appendFileSync('run-log.md',`\n${Date.now()/1000} started owned ${mode} PID ${child.pid}, port ${port}, root ${root}.\n`);child.unref();console.log(child.pid);
