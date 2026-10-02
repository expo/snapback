import fs from 'node:fs';import {inventory,hash} from '/Users/ccheever/sb4-np/lane-nx/snapback4/crates/snapback4/src/verbs/witness/payload.mjs';import {pluginTree} from '/Users/ccheever/sb4-np/lane-nx/snapback4/crates/snapback4/src/verbs/witness/effective-config.mjs';import {execFileSync} from 'node:child_process';
const rows=[];
for(const [r,c] of [['r4','e1adc01ddc'],['r5','adbabda71e']])for(const s of ['plain','social']) {
const project=`/Users/ccheever/sb4-np/nx-r5b/${r}-${s}`;
const pins=JSON.parse(execFileSync('git',['show',`${c}:snapback4/crates/snapback4/src/verbs/witness/native-mods.json`],{encoding:'utf8'}));
const digest=hash(JSON.stringify(inventory(project,p=>p!=='node_modules'&&!p.startsWith('node_modules/')).files));
const plugin=pluginTree(project+'/node_modules/snapback4-expo');const row={r,s,project,dependencyDigest:digest,audited:pins._dependencySnapshots.includes(digest),expoTree:plugin,expoAudited:pins['snapback4-expo'].includes(plugin)};rows.push(row);console.log(row);
}
fs.writeFileSync('/Users/ccheever/sb4-np/lane-nx/snapback4/reports/20261001-nx-export-proves-native/round5b/dependency-audit.json',JSON.stringify(rows,null,2)+'\n');if(rows.some(r=>!r.audited||!r.expoAudited))process.exitCode=1;
