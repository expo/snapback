import fs from 'node:fs'; import path from 'node:path';
import { pluginTree } from '../../../crates/snapback4/src/verbs/witness/effective-config.mjs';
import { inventory, hash } from '../../../crates/snapback4/src/verbs/witness/payload.mjs';
const pinsFile='crates/snapback4/src/verbs/witness/native-mods.json', pins=JSON.parse(fs.readFileSync(pinsFile)), rows=[];
for(const starter of ['plain','social']) {
 const root=path.resolve('target/nx',starter), include=p=>p!=='node_modules'&&!p.startsWith('node_modules/');
 const before=inventory(root,include).files;
 for(const [source,target] of [['packages/snapback4/bin/snapback4.js','node_modules/snapback4/bin/snapback4.js'],['packages/snapback4-expo/export-ios.mjs','node_modules/snapback4-expo/export-ios.mjs']]) fs.copyFileSync(source,path.join(root,target));
 const after=inventory(root,include).files, old=new Map(before.map(r=>[r.path,r]));
 const delta=after.filter(r=>JSON.stringify(old.get(r.path))!==JSON.stringify(r)).map(r=>({path:r.path,before:old.get(r.path),after:r}));
 if(delta.some(r=>!['node_modules/snapback4/bin/snapback4.js','node_modules/snapback4-expo/export-ios.mjs'].includes(r.path)))throw Error('unexpected dependency delta');
 const plugin=pluginTree(path.join(root,'node_modules/snapback4-expo')); if(!pins['snapback4-expo'].includes(plugin))pins['snapback4-expo'].push(plugin);
 const digest=hash(JSON.stringify(after)); if(!pins._dependencySnapshots.includes(digest))pins._dependencySnapshots.push(digest);
 rows.push({starter,digest,plugin,delta,reason:'Only CLI signal handling and export wrapper changed; no plugin/native writer changes.'});
}
fs.writeFileSync(pinsFile,JSON.stringify(pins,null,2)+'\n');
const previous=JSON.parse(fs.readFileSync('reports/20261001-nx-export-proves-native/round4/dependency-audit.json'));
for(const row of rows) if(!row.delta.length) { const root=path.resolve('target/nx',row.starter); const files=inventory(root,p=>p!=='node_modules'&&!p.startsWith('node_modules/')).files;row.delta=previous.find(r=>r.starter===row.starter).delta.map(r=>({path:'node_modules/'+r.path,before:{...r.after,path:'node_modules/'+r.path},after:files.find(f=>f.path==='node_modules/'+r.path)})); }
fs.writeFileSync('reports/20261001-nx-export-proves-native/round5/dependency-audit.json',JSON.stringify(rows,null,2)+'\n');
console.log(rows.map(({delta,...r})=>({...r,changes:delta.map(d=>d.path)})));
