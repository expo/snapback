import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {nativeFingerprint} from '../../../crates/snapback4/src/verbs/witness/export-cache.mjs';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2'),rows=[];
for(const starter of ['plain','social']){
 const project=path.resolve('target/nx',starter),config=path.join(project,'app.json'),original=fs.readFileSync(config),input=path.join(project,'src/native-mode.js');
 assert.equal(fs.existsSync(input),false);fs.mkdirSync(path.dirname(input),{recursive:true});
 try{for(const mode of ['shadow','auto']){
  const name=mode==='shadow'?'expo-status-bar':'expo-file-system',dir=path.join(project,name);assert.equal(fs.existsSync(dir),false);fs.mkdirSync(dir);
  const app=JSON.parse(original);if(mode==='shadow'&&!app.expo.plugins.includes(name))app.expo.plugins.push(name);fs.writeFileSync(config,JSON.stringify(app));
  fs.writeFileSync(path.join(dir,'app.plugin.js'),`module.exports=c=>{c.ios??={};c.ios.infoPlist??={};c.ios.infoPlist.NXNativeMode=require('fs').readFileSync(require('path').join(c._internal.projectRoot,'src/native-mode.js'),'utf8');return c};`);
  fs.writeFileSync(input,'first');const before=nativeFingerprint(project,{},'final-control');fs.writeFileSync(input,'second');const after=nativeFingerprint(project,{},'final-control');
  assert.equal(before.effective.dependencyAudit.audited,true);assert.equal(after.effective.retainApplicationJs,false);
  assert.equal(after.inputs.files.some(row=>row.path==='src/native-mode.js'),false);
  assert.equal(before.effective.config.ios.infoPlist.NXNativeMode,'first');assert.equal(after.effective.config.ios.infoPlist.NXNativeMode,'second');assert.notEqual(before.hash,after.hash);
  rows.push({starter,mode,before:before.hash,after:after.hash,dependencyAudit:after.effective.dependencyAudit,applicationJsExcluded:true,evaluatedBefore:'first',evaluatedAfter:'second'});
  fs.rmSync(dir,{recursive:true});
 }}finally{fs.writeFileSync(config,original);fs.rmSync(input,{force:true});for(const name of ['expo-status-bar','expo-file-system'])fs.rmSync(path.join(project,name),{recursive:true,force:true});}
}
fs.writeFileSync(path.join(report,'final-structural.json'),JSON.stringify(rows,null,2)+'\n');console.log(rows);
