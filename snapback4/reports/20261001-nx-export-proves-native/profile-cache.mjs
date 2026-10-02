import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { inventory, hash } from '../../crates/snapback4/src/verbs/witness/payload.mjs';
import { nativeFingerprint, lookupTopology } from '../../crates/snapback4/src/verbs/witness/export-cache.mjs';
const project=path.resolve('target/nx/social'), cache=path.join(project,'.snapback4-witness');
let previous=performance.now();
function time(label) { console.log(label, Math.round(performance.now()-previous));previous=performance.now(); }
const base=JSON.parse(fs.readFileSync(path.join(cache,'export-base.json')));time('parse base');
nativeFingerprint(project,base.exportFingerprint.toolchain,base.exportFingerprint.adapter);time('project fingerprint');
inventory(base.executedApp.path);time('app inventory');
inventory(path.join(cache,'snapshot/node_modules'));time('dependency inventory');
lookupTopology(base.lookupTopology.roots);time('topology');
for(const input of base.nativeClosure.compiler.inputs) {if(!input.missing) hash(fs.readFileSync(input.path));}time('compiler inputs');
inventory(path.join(cache,'snapshot'),p=>(p!=='ios'&&!p.startsWith('ios/'))||(p.startsWith('ios/build/')&&p!=='ios/build/generated'&&!p.startsWith('ios/build/generated/')));time('native tree');
JSON.stringify(base,null,2);time('serialize base');
