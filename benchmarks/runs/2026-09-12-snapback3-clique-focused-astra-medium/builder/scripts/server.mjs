import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const proc = spawn('/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node', ['node_modules/snapback3/dist/cli.mjs','serve','.', '--port','54900'],{stdio:'inherit'});
appendFileSync('run-log.md', `${Math.floor(Date.now()/1000)} server PID=${proc.pid} backend port=54900; source: diagnostic; evidence: evidence/server.log\n`);
appendFileSync('evidence/server-pids.jsonl',JSON.stringify({pid:proc.pid,role:'snapback3',port:54900})+'\n');
proc.on('exit',code=>process.exit(code??1));
