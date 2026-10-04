// @ref LLP 3000.030#15 — exact audited dependency snapshots, never an audit bypass.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { inventory, differences, hash } from '../../crates/snapback4/src/verbs/witness/payload.mjs';
import { pluginTree } from '../../crates/snapback4/src/verbs/witness/effective-config.mjs';
const report=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(report,'../..');
const output=path.join(report,'round2/framework-audit.json');
assert.ok(!fs.existsSync(output),'preserve the audit, do not silently recalculate');
const pinPath=path.join(root,'crates/snapback4/src/verbs/witness/native-mods.json');
const pins=JSON.parse(fs.readFileSync(pinPath));
const framework=path.join(root,'packages/snapback4-expo/ios/Snapback4Device.xcframework');
const archive=path.join(os.homedir(),'sb4-np/evidence-archive/20261003-nz-native-proof-zero-cost/blobs');
function retain(value){const bytes=Buffer.from(JSON.stringify(value));const sha256=hash(bytes);fs.mkdirSync(archive,{recursive:true});const file=path.join(archive,sha256);if(!fs.existsSync(file))fs.writeFileSync(file,bytes);return{sha256,bytes:bytes.length};}
const records=[];
for(const starter of ['plain','social']){
 const project=path.join(root,`target/nz/r1-${starter}-B`),pkg=path.join(project,'node_modules/snapback4-expo');
 const deps=()=>inventory(project,p=>p!=='node_modules'&&!p.startsWith('node_modules/'));
 const before=deps(),pluginBefore=pluginTree(pkg);
 assert.ok(pins._dependencySnapshots.includes(before.sha256),'base dependency snapshot must already be audited');
 assert.ok(pins['snapback4-expo'].includes(pluginBefore),'base plugin tree must already be audited');
 const dest=path.join(pkg,'ios/Snapback4Device.xcframework');
 fs.rmSync(dest,{recursive:true});fs.cpSync(framework,dest,{recursive:true,preserveTimestamps:true});
 const after=deps(),pluginAfter=pluginTree(pkg),delta=differences(before.files,after.files);
 assert.ok(delta.length>0);
 for(const d of delta){
  assert.ok(d.path.startsWith('node_modules/snapback4-expo/ios/Snapback4Device.xcframework/'),d.path);
  assert.equal(d.expected?.type,'file');assert.equal(d.actual?.type,'file');
  assert.equal(d.expected.mode,d.actual.mode);
 }
 records.push({starter,project,pluginBefore,pluginAfter,dependencyBefore:before.sha256,dependencyAfter:after.sha256,
  beforeInventory:retain(before),afterInventory:retain(after),delta});
 if(!pins['snapback4-expo'].includes(pluginAfter))pins['snapback4-expo'].push(pluginAfter);
 if(!pins._dependencySnapshots.includes(after.sha256))pins._dependencySnapshots.push(after.sha256);
}
const record={at:new Date().toISOString(),source:'abafa9af9cd58e30a3b0dc6461cd4ab339c3cb83; core/device/build-xcframework script match this main commit',
 command:'LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/build-xcframework.sh',
 rationale:'The existing audited NX fixtures ship an engine that rejects source-write-reservations-v1 from merged main. Replace only the two compiled native engine slices and associated framework headers/metadata from the merged source. Every other installed dependency byte and mode, including all executable plugin/JS code, remains in the previously audited snapshot. No audit predicate changes.',
 framework:inventory(framework),records};
fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n');
fs.writeFileSync(pinPath,JSON.stringify(pins,null,2)+'\n');
console.log(records.map(r=>({starter:r.starter,filesChanged:r.delta.map(d=>d.path),plugin:r.pluginAfter,dependencies:r.dependencyAfter})));
