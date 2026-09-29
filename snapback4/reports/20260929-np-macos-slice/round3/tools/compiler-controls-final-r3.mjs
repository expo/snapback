import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process';
import {inventory,hash} from './lane/snapback4/crates/snapback4/src/verbs/witness/payload.mjs';
import {compilerClosure} from './lane/snapback4/crates/snapback4/src/verbs/witness/native-closure.mjs';
const dir='/Users/ccheever/sb4-np/evidence/round3/sealed-compiler-controls',root=dir+'/project',cache=root+'/.cache',records=cache+'/DerivedData/Build/Intermediates.noindex';
fs.mkdirSync(root+'/ios/Pods', {recursive:true});fs.mkdirSync(records,{recursive:true});fs.mkdirSync(dir+'/SharedNative',{recursive:true});
const external=dir+'/SharedNative/SnapbackConfig.h',safe=root+'/ios/safe.h';fs.writeFileSync(safe,'#define NATIVE 1\n');
const rows=[];
for(const kind of ['baseline','spaced','computed','pods-computed']){
 const source=root+'/ios/'+(kind==='pods-computed'?'Pods/':'')+'App.c';
 const code=kind==='baseline'?'#include "safe.h"\n':kind==='spaced'?`# include "${external}"\n`:`#define CONFIG "${external}"\n# include CONFIG\n`;
 fs.writeFileSync(source,code+'int native_value(void) { return NATIVE; }\n');
 const before=inventory(root+'/ios').sha256;
 let prior=null;
 for(const value of [1,2]){
  fs.writeFileSync(external,`#define NATIVE ${value}\n`);
  const argv=['--sdk','iphonesimulator','clang','-target','arm64-apple-ios27.0-simulator','-MD','-MF',records+'/App.d','-c',source,'-o',records+'/App.o'];
  const result=spawnSync('xcrun',argv,{encoding:'utf8',env:{...process.env,DEVELOPER_DIR:'/Applications/Xcode.app/Contents/Developer'}});
  assert.equal(result.status,0,result.stderr);
  const bytes=hash(fs.readFileSync(records+'/App.o'));if(prior && kind!=='baseline')assert.notEqual(bytes,prior);prior=bytes;
  assert.equal(inventory(root+'/ios').sha256,before);
  let refusal=null;try{compilerClosure(root,cache,['/Applications/Xcode.app/Contents/Developer'],[source]);}catch(e){refusal=String(e);}
  if(kind==='baseline')assert.equal(refusal,null);else{assert.match(refusal,/E_WITNESS_NATIVE_COMPAT: native input outside covered roots/);assert.ok(refusal.includes(external));}
  fs.copyFileSync(records+'/App.d',dir+`/${kind}-${value}.d`);
  for (const [p,suffix] of [[source,'c'],[external,'external.h'],[records+'/App.o','o']]) fs.copyFileSync(p,dir+`/${kind}-${value}.${suffix}`);
  rows.push({kind,value,argv,status:result.status,sourceSha256:hash(fs.readFileSync(source)),iosInventory:before,objectSha256:bytes,refusal});
 }
 fs.unlinkSync(source);
}
fs.writeFileSync(dir+'/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(({kind,value,refusal})=>({kind,value,refusal}))));
