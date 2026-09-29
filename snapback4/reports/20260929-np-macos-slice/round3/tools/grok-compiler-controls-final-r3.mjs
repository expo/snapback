import fs from 'node:fs'; import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process';
import {hash} from './lane/snapback4/crates/snapback4/src/verbs/witness/payload.mjs';
import {compilerClosure} from './lane/snapback4/crates/snapback4/src/verbs/witness/native-closure.mjs';
const dir='/Users/ccheever/sb4-np/evidence/round3/sealed-grok-compiler-controls',root=dir+'/project',cache=root+'/.cache',records=cache+'/DerivedData/Build/Intermediates.noindex';
fs.mkdirSync(root+'/ios', {recursive:true});fs.mkdirSync(records,{recursive:true});
const external=dir+'/External.h',source=root+'/ios/App.c',rows=[];
for(const ext of ['pch','hh','hxx','modulemap']){
 const header=root+'/ios/Input.'+ext;
 fs.writeFileSync(header,ext==='modulemap'?`module External { header "${external}" export * }\n`:`# include "${external}"\n`);
 fs.writeFileSync(source,(ext==='modulemap'?'#pragma clang module import External\n':'#include "Input.'+ext+'"\n')+'int native_value(void) { return NATIVE; }\n');
 let previous;
 for(const value of [1,2]){
  fs.writeFileSync(external,`#define NATIVE ${value}\n`);
  const argv=['--sdk','iphonesimulator','clang','-target','arm64-apple-ios27.0-simulator','-MD','-MF',records+'/App.d','-c',source,'-o',records+'/App.o'];
  if(ext==='modulemap')argv.push('-fmodules','-fmodules-cache-path='+cache+'/modules','-fmodule-map-file='+header);
  const result=spawnSync('xcrun',argv,{encoding:'utf8',env:{...process.env,DEVELOPER_DIR:'/Applications/Xcode.app/Contents/Developer'}});assert.equal(result.status,0,result.stderr);
  const object=hash(fs.readFileSync(records+'/App.o'));if(previous)assert.notEqual(object,previous);previous=object;
  let refusal;try{compilerClosure(root,cache,['/Applications/Xcode.app/Contents/Developer'],[source]);}catch(e){refusal=String(e);}
  assert.match(refusal,/outside covered roots:.*External.h/);
  fs.copyFileSync(records+'/App.d',dir+`/${ext}-${value}.d`);
  for (const [p,suffix] of [[source,'c'],[external,'external.h'],[records+'/App.o','o']]) fs.copyFileSync(p,dir+`/${ext}-${value}.${suffix}`);
  fs.copyFileSync(header,dir+`/${ext}-${value}.input`);rows.push({ext,value,argv,objectSha256:object,headerSha256:hash(fs.readFileSync(header)),refusal});
 }
 fs.unlinkSync(header);
}
fs.writeFileSync(dir+'/results.json',JSON.stringify(rows,null,2));console.log(rows.length+' Clang include/module controls refused the external input');
