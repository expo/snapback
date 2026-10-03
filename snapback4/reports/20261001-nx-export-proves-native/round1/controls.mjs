import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
const starter=process.argv[2],report=path.resolve('reports/20261001-nx-export-proves-native/round1'),project=path.resolve('target/nx',starter);
const source=path.join(project,starter==='plain'?'App.tsx':'app/_layout.tsx'),original=fs.readFileSync(path.join(report,starter+'-original.txt'),'utf8');
const configPath=path.join(project,'app.json'),config=fs.readFileSync(configPath,'utf8');
const read=label=>JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));
function run(label){spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});return read(label);}
function pass(r,hit){assert.equal(r.status,0);assert.equal(r.receiptExit,0);assert.equal(r.cache.hit,hit);assert.deepEqual(Object.values(r.segments),['passed','passed','passed']);assert.equal(r.bundleHash,r.loadedHash);}
// A genuinely fresh Xcode product from the same JS/export must have the same
// Metro inventory, before any overlay of that fresh product can hide leftovers.
fs.rmSync(path.join(project,'.snapback4-witness'),{recursive:true,force:true});
const fresh=run('asset-fresh');pass(fresh,false);
const base=JSON.parse(fs.readFileSync(path.join(project,'.snapback4-witness/export-base.json')));
const removed=read('asset-removed');
assert.equal(fresh.bundleHash,removed.bundleHash,'fresh build uses the exact same export');
assert.deepEqual(base.metroResources,removed.metroResources);
const removedBuild=JSON.parse(gunzipSync(fs.readFileSync(path.join(report,'evidence',`${starter}-asset-removed`,'build.json.gz'))));
const topology=inv=>inv.files.map(({path,type})=>({path,type}));
assert.deepEqual(topology(base.executedApp.inventory),topology(removedBuild.executedApp.inventory));
fs.writeFileSync(path.join(report,`${starter}-resource-comparison.json`),JSON.stringify({equal:true,completeAppTopologyEqual:true,cachedAppTopology:topology(removedBuild.executedApp.inventory),freshAppTopology:topology(base.executedApp.inventory),cachedOverlay:removed.metroResources,freshXcodeProduct:base.metroResources},null,2));
// Install an actual local git fork under the unchanged package name/version.
const plugin=starter==='plain'?'expo-status-bar':'expo-secure-store';
const packageDir=path.join(project,'node_modules',plugin),fork=path.resolve('target/nx',starter+'-plugin-fork'),backup=fork+'-original';
fs.cpSync(packageDir,backup,{recursive:true});fs.cpSync(packageDir,fork,{recursive:true});
const manifestPath=path.join(project,'package.json'),lockPath=path.join(project,'package-lock.json');
const manifestBytes=fs.readFileSync(manifestPath),lockBytes=fs.readFileSync(lockPath);
const forkSource=`const fs=require('fs');const path=require('path');const original=require('./plugin/build/${plugin==='expo-status-bar'?'withStatusBar':'withSecureStore'}');module.exports=(config,props)=>{config=(original.default||original)(config,props);config.ios??={};config.ios.infoPlist??={};config.ios.infoPlist.NXNativeMode=fs.readFileSync(path.join(config._internal.projectRoot,'src/native-mode.js'),'utf8');return config;};\n`;
fs.writeFileSync(path.join(fork,'app.plugin.js'),forkSource);
for(const args of [['init','-q'],['add','.'],['-c','user.name=NX control','-c','user.email=noreply@openai.com','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','Native-mode plugin fork control']]){
  const result=spawnSync('git',args,{cwd:fork,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
try {
  const installed=spawnSync('/Users/ccheever/.volta/tools/image/node/24.18.0/bin/npm',['install','--ignore-scripts','--no-audit','--no-fund',`${plugin}@git+file://${fork}`],{cwd:project,encoding:'utf8',env:{...process.env,PATH:'/Users/ccheever/.volta/tools/image/node/24.18.0/bin:'+process.env.PATH}});
  fs.writeFileSync(path.join(report,starter+'-fork-install.log'),installed.stdout+installed.stderr);assert.equal(installed.status,0,installed.stderr);
  const lock=JSON.parse(fs.readFileSync(lockPath));
  fs.writeFileSync(path.join(report,starter+'-fork-provenance.json'),JSON.stringify({plugin,spec:JSON.parse(fs.readFileSync(manifestPath)).dependencies[plugin],installed:lock.packages['node_modules/'+plugin],source:forkSource},null,2));
  fs.writeFileSync(path.join(project,'src/native-mode.js'),'first');
  const forkFirst=run('plugin-fork-first');pass(forkFirst,false);assert.equal(forkFirst.nativeMarker,'first');
  fs.writeFileSync(path.join(project,'src/native-mode.js'),'second');
  const forkSecond=run('plugin-fork-second');pass(forkSecond,false);assert.equal(forkSecond.nativeMarker,'second');
} finally {
  fs.rmSync(packageDir,{recursive:true});fs.cpSync(backup,packageDir,{recursive:true});
  fs.writeFileSync(manifestPath,manifestBytes);fs.writeFileSync(lockPath,lockBytes);
}
try {
  const external=path.resolve('target/nx',starter+'-external.plist');fs.writeFileSync(external,'first');
  const changed=JSON.parse(config);changed.expo.ios.googleServicesFile=external;fs.writeFileSync(configPath,JSON.stringify(changed));
  const outside=run('out-of-tree');assert.notEqual(outside.status,0);assert.notEqual(outside.phase,'environment');
  fs.writeFileSync(external,'second');const replaced=run('out-of-tree-replaced');assert.notEqual(replaced.status,0);assert.notEqual(replaced.phase,'environment');
} finally {fs.writeFileSync(configPath,config);}
// Restore the audited plugin base once before timing the intentional app failure.
const restored=run('restored');pass(restored,false);
fs.writeFileSync(source,original+`\nthrow new Error('NX_R1_STARTUP_THROW');\n`);
const thrown=run('startup-throw');assert.notEqual(thrown.status,0);assert.equal(thrown.receiptExit,1);assert.notEqual(thrown.phase,'environment');
fs.writeFileSync(source,original);
const absent=run('missing-runtime');assert.equal(absent.status,0);assert.equal(absent.environmentCondition,'missing-runtime');assert.equal(absent.receiptExit,1);
const off=run('opt-out');assert.equal(off.status,0);assert.equal(off.receiptPath,undefined);
const dirs=fs.readdirSync(path.join(project,'artifacts/native-smoke')).map(name=>path.join(project,'artifacts/native-smoke',name));
const retained=dirs.filter(dir=>fs.existsSync(path.join(dir,'finished.json'))&&!fs.existsSync(path.join(dir,'retention.json')));
assert.equal(retained.length,5);
assert.equal(fs.existsSync(path.join(project,'.snapback4-witness/tmp')),false);
fs.writeFileSync(path.join(report,starter+'-retention.json'),JSON.stringify({totalRuns:dirs.length,fullEvidenceRuns:retained.length,olderReceiptsCompressed:true,perRunAppCopies:0,privateTmpDirectories:0},null,2));
