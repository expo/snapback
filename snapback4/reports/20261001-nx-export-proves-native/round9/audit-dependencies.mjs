import fs from 'node:fs';
import path from 'node:path';
import { pluginTree } from '../../../crates/snapback4/src/verbs/witness/effective-config.mjs';
import { inventory, hash, differences } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';
const rows=[];
const pins=JSON.parse(fs.readFileSync('crates/snapback4/src/verbs/witness/native-mods.json'));
for (const starter of ['plain','social']) {
 const beforeRoot=path.resolve('target/nx',starter),root=path.resolve('target/nx/round9',starter);
 const include=p=>p!=='node_modules'&&!p.startsWith('node_modules/');
 const before=inventory(beforeRoot,include).files,after=inventory(root,include).files;
 const delta=differences(before,after),digest=hash(JSON.stringify(after)),plugin=pluginTree(path.join(root,'node_modules/snapback4-expo'));
 const counts={};for(const d of delta){const p=d.path.split('/');const name=p[1]?.startsWith('@')?p.slice(1,3).join('/'):p[1];counts[name]=(counts[name]||0)+1;}
 rows.push({starter,beforeDigest:hash(JSON.stringify(before)),beforeAudited:pins._dependencySnapshots.includes(hash(JSON.stringify(before))),digest,audited:pins._dependencySnapshots.includes(digest),plugin,pluginAudited:pins['snapback4-expo'].includes(plugin),counts,delta});
}
fs.writeFileSync('target/nx/round9/dependency-delta.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows.map(({delta,...row})=>row),null,2));
