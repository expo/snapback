// Real native-build controls, deliberately separate from the timing cohort.
import fs from 'node:fs'; import path from 'node:path'; import {spawnSync} from 'node:child_process'; import assert from 'node:assert/strict';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2');
const run=(starter,label,hit,marker)=>{
 const r=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(r.status,0);
 const row=JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));
 assert.equal(row.receiptExit,0);assert.equal(row.cache.hit,hit);assert.equal(row.bundleHash,row.loadedHash);
 if(marker)assert.equal(row.nativeMarker,marker);return row;
};
for(const starter of ['plain','social']){
 const project=path.resolve('target/nx',starter),configFile=path.join(project,'app.json'),original=fs.readFileSync(configFile);
 const input=path.join(project,'src/native-mode.js');fs.mkdirSync(path.dirname(input),{recursive:true});
 const rows=[];
 try{
  for(const mode of ['shadow','auto','dangerous']){
   const config=JSON.parse(original);
   const packageName=mode==='shadow'?'expo-status-bar':'expo-file-system';
   if(mode==='shadow'&&!config.expo.plugins.includes(packageName))config.expo.plugins.push(packageName);
   fs.writeFileSync(configFile,JSON.stringify(config,null,2)+'\n');
   const dir=path.join(project,packageName);fs.mkdirSync(dir,{recursive:true});
   const pure=`module.exports=config=>{config.ios??={};config.ios.infoPlist??={};config.ios.infoPlist.NXNativeMode=require('fs').readFileSync(require('path').join(config._internal.projectRoot,'src/native-mode.js'),'utf8');return config};`;
   const hidden=`const {withDangerousMod}=require('expo/config-plugins');module.exports=c=>withDangerousMod(c,['ios',async c=>c]);`;
   fs.writeFileSync(path.join(dir,'app.plugin.js'),mode==='dangerous'?hidden:pure);
   for(const value of ['first','second']){
    fs.writeFileSync(input,`${mode}-${value}`);
    rows.push(run(starter,`${mode}-${value}`,false,mode==='dangerous'?undefined:`${mode}-${value}`));
   }
   fs.rmSync(dir,{recursive:true});
  }
 }finally{fs.writeFileSync(configFile,original);fs.rmSync(input,{force:true});for(const name of ['expo-status-bar','expo-file-system'])fs.rmSync(path.join(project,name),{recursive:true,force:true});}
 fs.writeFileSync(path.join(report,`${starter}-plugin-controls.json`),JSON.stringify(rows,null,2));
}
