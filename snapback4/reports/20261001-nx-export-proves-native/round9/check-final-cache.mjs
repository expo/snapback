import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { nativeFingerprint } from '../../../crates/snapback4/src/verbs/witness/export-cache.mjs';
const rows=[];
for(const starter of ['plain','social']) {
 const root=path.resolve('target/nx/round9',starter);
 const a=nativeFingerprint(root,{},'round9',{PATH:process.env.PATH,TMPDIR:'/tmp/nx-a',EXPO_PUBLIC_SNAPBACK4_URL:'http://127.0.0.1:43111'});
 const b=nativeFingerprint(root,{},'round9',{PATH:process.env.PATH,TMPDIR:'/tmp/nx-b',EXPO_PUBLIC_SNAPBACK4_URL:'http://127.0.0.1:43112'});
 assert.equal(a.effective.dependencyAudit.audited,true);
 assert.equal(a.effective.retainApplicationJs,false);
 assert.equal(a.environment,null);
 assert.equal(a.hash,b.hash);
 rows.push({starter,hash:a.hash,dependencyAudit:a.effective.dependencyAudit,retainApplicationJs:a.effective.retainApplicationJs,conservativePlugins:a.effective.conservativePlugins,unobserved:a.effective.unobserved,registeredMods:a.effective.mods.length,differentGeneratedEnvironmentSameKey:a.hash===b.hash});
}
fs.writeFileSync('reports/20261001-nx-export-proves-native/round9/final-cache-validation.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows));
