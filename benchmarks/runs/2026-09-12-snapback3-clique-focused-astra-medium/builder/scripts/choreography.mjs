import fs from 'node:fs';import {spawn} from 'node:child_process';
const env={...process.env,CHOREO_BASE_URL:'http://127.0.0.1:54900'};
for(const p of JSON.parse(fs.readFileSync('instrument/fixtures/personas.json')).starter)env[`CHOREO_${p.id.toUpperCase()}_PASSWORD`]=p.password;
const p=spawn('/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node',['choreography/choreography.mjs','m1','--lane-run-id','astra-clique-snapback3','--suite-status','suite-status.json','--setup-identity','setup-identity.json','--receipts','evidence/choreography-m1.jsonl'],{env,stdio:'inherit'});p.on('exit',c=>process.exit(c??1));
