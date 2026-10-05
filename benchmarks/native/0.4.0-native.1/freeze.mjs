#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
// @ref LLP 0201.000#6 — a parallel version; never rewrite the current series' manifest.
const root=dirname(fileURLToPath(import.meta.url));
const benchmarks=resolve(root,'../..');
const digest=x=>createHash('sha256').update(x).digest('hex');
const omitted=new Set(['instrument.manifest.json','INSTRUMENT.sha256','INSTRUMENT_COMMIT','identity.json','QUALIFIED.json']);
function inventory(dir,prefix='') {
 const files={};
 for(const name of readdirSync(dir).sort()) {
  if(name==='__pycache__'||name==='node_modules'||name==='.DS_Store'||(!prefix&&omitted.has(name)))continue;
  const p=join(dir,name),rel=prefix+name,s=lstatSync(p);
  if(s.isSymbolicLink())throw Error('symlink:'+rel);
  if(s.isDirectory())Object.assign(files,inventory(p,rel+'/'));
  else files[rel]=digest(readFileSync(p));
 }
 return files;
}
const files=inventory(root);
const lines=Object.entries(files).map(([p,h])=>`${h}  ${p}\n`).join('');
const inRepository=existsSync(join(benchmarks,'tools/lane-setup.mjs'));
const retained=!inRepository ? JSON.parse(readFileSync(join(root,'instrument.manifest.json'),'utf8')) : null;
const base=inRepository ? readFileSync(join(benchmarks,'instrument.manifest.json')) : Buffer.from(JSON.stringify(retained.inherited.manifest,null,2)+'\n');
const sourceCommit=inRepository ? execFileSync('git',['log','-1','--format=%H','--','benchmarks/instrument.manifest.json'],{cwd:resolve(benchmarks,'..'),encoding:'utf8'}).trim() : retained.inherited.sourceCommit;

const manifest={schemaVersion:'benchmark-native-instrument-snapshot.v1',instrumentPin:'social-messenger@0.4.0-native.1',protocol:'clique-native/1',
 status:'qualification-candidate',scoredUse:false,qualificationGate:'LLP 0201.000 section 7; Phase 2 remains required',
 seriesBreak:{previous:'social-messenger@0.3.8-m8',new:'social-messenger@0.4.0-native.1',reason:'New native authoring aid, obligations, observations and O4 missing-evidence policy',comparableOverall:false},
 versions:{ui:'0.4.0-native.1',native:'0.4.0-native.1',inheritedWeb:'0.3.8-m8'},
 inherited:{sourceCommit,manifestSha256:digest(base),manifest:JSON.parse(base)},inventorySha256:digest(lines),files};
const formatted=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')) {
 if(readFileSync(join(root,'instrument.manifest.json'),'utf8')!==formatted||readFileSync(join(root,'INSTRUMENT.sha256'),'utf8')!==lines)throw Error('native instrument freeze drift');
 console.log(JSON.stringify({valid:true,instrumentPin:manifest.instrumentPin,inventorySha256:manifest.inventorySha256,files:Object.keys(files).length}));
} else {
 writeFileSync(join(root,'instrument.manifest.json'),formatted);writeFileSync(join(root,'INSTRUMENT.sha256'),lines);
 console.log(JSON.stringify({instrumentPin:manifest.instrumentPin,inventorySha256:manifest.inventorySha256}));
}
const at=process.argv.indexOf('--materialize');
if(at>=0) {
 const destination=resolve(process.argv[at+1]);if(existsSync(destination))throw Error('destination must be new');
 const { materializeInstrumentSnapshot }=await import('../../tools/materialize-instrument.mjs');
 // The inherited instrument is a separate immutable component, preserving its VERSION and receipt semantics.
 mkdirSync(destination,{recursive:true});
 // Current source may have advanced without re-freezing the historical manifest.
 // Recover precisely the manifest's committed snapshot, never repair old hashes in place.
 const stage=mkdtempSync(join(tmpdir(),'ni-web-source-'));
 try {
  const paths=[...new Set(['benchmarks/instrument.manifest.json',...Object.values(manifest.inherited.manifest.artifacts).map(a=>'benchmarks/'+a.path)])];
  const archive=execFileSync('git',['archive',sourceCommit,...paths],{cwd:resolve(benchmarks,'..'),maxBuffer:64*1024*1024});
  execFileSync('tar',['xf','-','-C',stage],{input:archive});
  materializeInstrumentSnapshot({sourceRoot:join(stage,'benchmarks'),outPath:join(destination,'web-0.3.8-m8')});
 } finally {rmSync(stage,{recursive:true,force:true});}

 cpSync(root,join(destination,'native-0.4.0-native.1'),{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.includes('node_modules')});
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 writeFileSync(join(destination,'INSTRUMENT_COMMIT'),commit+'\n');
 writeFileSync(join(destination,'instrument.manifest.json'),formatted);
 writeFileSync(join(destination,'INSTRUMENT.sha256'),lines);
 console.log(JSON.stringify({destination,commit,inventorySha256:manifest.inventorySha256}));
}
