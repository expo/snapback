import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {nativeFingerprint} from '../../../crates/snapback4/src/verbs/witness/export-cache.mjs';
const project=path.resolve('target/nx',process.argv[2]),helper=path.join(project,'node_modules/@expo/image-utils/build/Image.js');
const original=fs.readFileSync(helper);let before,changed,restored;
try{
 before=nativeFingerprint(project,{},'control');assert.equal(before.effective.dependencyAudit.audited,true);assert.equal(before.effective.retainApplicationJs,false);
 fs.appendFileSync(helper,'\n// NX changed external native-writer helper control\n');
 changed=nativeFingerprint(project,{},'control');assert.equal(changed.effective.dependencyAudit.audited,false);assert.equal(changed.effective.retainApplicationJs,true);
 assert.ok(changed.inputs.files.some(row=>row.path===(process.argv[2]==='plain'?'App.tsx':'app/_layout.tsx')));
}finally{fs.writeFileSync(helper,original);}
restored=nativeFingerprint(project,{},'control');assert.equal(restored.hash,before.hash);
const record={starter:process.argv[2],before:before.effective.dependencyAudit,changed:changed.effective.dependencyAudit,retainedApplicationJs:changed.effective.retainApplicationJs,restoredKey:restored.hash};
fs.writeFileSync(path.resolve('reports/20261001-nx-export-proves-native/round2',`${process.argv[2]}-dependency-control.json`),JSON.stringify(record,null,2)+'\n');console.log(record);
