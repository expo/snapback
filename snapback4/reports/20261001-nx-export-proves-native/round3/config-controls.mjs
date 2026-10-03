import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {nativeFingerprint} from '../../../crates/snapback4/src/verbs/witness/export-cache.mjs';
const report=path.resolve('reports/20261001-nx-export-proves-native/round3'),rows=[];
for(const starter of ['plain','social']){
 const project=path.resolve('target/nx',starter),file=path.join(project,'app.json'),original=fs.readFileSync(file),input=path.join(project,'src/native-mode.js');
 const put=(p,v)=>{p=path.join(project,p);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v)};
 const config=JSON.parse(original);
 const run=label=>{const prior=path.join(report,`${starter}-${label}.json`);if(fs.existsSync(prior)){const row=JSON.parse(fs.readFileSync(prior));if(row.status===0)return row;let retry=1;while(fs.existsSync(path.join(report,`${starter}-${label}-retry${retry}.json`)))retry++;label+=`-retry${retry}`;}const r=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(r.status,0);return JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)))};
 try{
  for(const reference of ['./x.js','plugins/x.js']){
   config.expo.plugins=[...JSON.parse(original).expo.plugins,reference];put('app.json',JSON.stringify(config));
   put(reference,`module.exports=c=>{const fs=require('fs'),p=require('path');if(fs.existsSync(p.join(c._internal.projectRoot,'ios'))){c.ios??={};c.ios.infoPlist??={};c.ios.infoPlist.NXNativeMode=fs.readFileSync(p.join(c._internal.projectRoot,'src/native-mode.js'),'utf8')}return c};`);
   put('src/native-mode.js','first');const first=nativeFingerprint(project,{},'round3-control');put('src/native-mode.js','second');const second=nativeFingerprint(project,{},'round3-control');
   assert.equal(first.effective.config.ios.infoPlist?.NXNativeMode,undefined);assert.equal(second.effective.config.ios.infoPlist?.NXNativeMode,undefined);assert.ok(second.effective.retainApplicationJs);assert.ok(second.inputs.files.some(r=>r.path==='src/native-mode.js'));assert.notEqual(first.hash,second.hash);
   rows.push({starter,reference,first:first.hash,second:second.hash,conservativePlugins:second.effective.conservativePlugins,retainsJs:true,evaluatedNativeModeAbsent:true});
   if(reference==='plugins/x.js'){
    for(const value of ['first','second']){put('src/native-mode.js',value);const result=run(`ios-context-${value}`);assert.equal(result.cache.hit,false);assert.equal(result.nativeMarker,value);assert.equal(result.bundleHash,result.loadedHash);}
   }
   fs.rmSync(path.join(project,reference));
  }
  config.expo.plugins=[...JSON.parse(original).expo.plugins,'plugins/late.js'];put('app.json',JSON.stringify(config));
  put('plugins/late.js',`const {withInfoPlist}=require('expo/config-plugins');module.exports=c=>withInfoPlist(c,c=>{c.mods.ios.late=async x=>x;return c});`);
  const late=nativeFingerprint(project,{},'round3-control');assert.ok(late.effective.unobserved.includes('late'));rows.push({starter,lateUnobserved:late.effective.unobserved,retainsJs:late.effective.retainApplicationJs});
  config.expo.plugins=JSON.parse(original).expo.plugins;config.expo.icon='https://example.invalid/native-icon.png';put('app.json',JSON.stringify(config));
  assert.throws(()=>nativeFingerprint(project,{},'round3-control'),/remote or URI/);
  const remote=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,'remote-icon'],{stdio:'inherit'});assert.equal(remote.status,1);
  const failed=JSON.parse(fs.readFileSync(path.join(report,`${starter}-remote-icon.json`)));assert.match(failed.error,/E_WITNESS_NATIVE_COMPAT/);assert.equal(failed.loadedHash,undefined);
  rows.push({starter,remoteIcon:'refused',phase:failed.phase,error:failed.error});
 }finally{fs.writeFileSync(file,original);fs.rmSync(input,{force:true});for(const f of ['x.js','plugins/x.js','plugins/late.js'])fs.rmSync(path.join(project,f),{force:true});fs.rmdirSync(path.join(project,'plugins'));}
}
fs.writeFileSync(path.join(report,'config-controls.json'),JSON.stringify(rows,null,2)+'\n');console.log(rows);
