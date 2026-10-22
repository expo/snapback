import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const files=JSON.parse(fs.readFileSync(new URL('./integration22-final-files.json',import.meta.url)));
const models=files.filter(f=>/app-session-model|online-client-model/.test(f));
let failed=false;for(const [kind,list,slots]of[['files',files.filter(f=>!models.includes(f)),3],['models',models,1]]){if(!list.length)continue;const r=spawnSync('timeout',['14400s','node','scripts/run-client-tests.mjs',String(slots),kind,...list],{stdio:'inherit',timeout:14410000});failed||=r.status!==0;}process.exit(failed?1:0);
