import fs from 'node:fs';import path from 'node:path';import {gunzipSync} from 'node:zlib';import {pluginTree,evaluate} from '../../../crates/snapback4/src/verbs/witness/effective-config.mjs';import {inventory,hash} from '../../../crates/snapback4/src/verbs/witness/payload.mjs';
const report=path.resolve('reports/20261001-nx-export-proves-native/round3'),pinsFile=path.resolve('crates/snapback4/src/verbs/witness/native-mods.json'),pins=JSON.parse(fs.readFileSync(pinsFile));const rows=[];
for(const starter of ['plain','social']){
 const project=path.resolve('target/nx',starter),inputs=inventory(project,p=>p!=='node_modules'&&!p.startsWith('node_modules/'));
 const old=JSON.parse(gunzipSync(fs.readFileSync(`reports/20261001-nx-export-proves-native/round2/evidence/${starter}-cold/build.json.gz`))).exportFingerprint.inputs.files.filter(r=>r.path==='node_modules'||r.path.startsWith('node_modules/'));
 const before=new Map(old.map(r=>[r.path,r])),after=new Map(inputs.files.map(r=>[r.path,r]));
 const delta=[...new Set([...before.keys(),...after.keys()])].filter(p=>JSON.stringify(before.get(p))!==JSON.stringify(after.get(p))).map(p=>({path:p,before:before.get(p),after:after.get(p)}));
 const digest=hash(JSON.stringify(inputs.files));
 rows.push({starter,digest,delta,package:pluginTree(path.join(project,'node_modules/snapback4-expo'))});
}
fs.writeFileSync(path.join(report,'dependency-delta.json'),JSON.stringify(rows,null,2));console.log(rows.map(({delta,...r})=>({...r,changes:delta.map(d=>d.path)})));
