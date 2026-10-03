import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2');
const shim=path.resolve('target/nx/no-runtime');fs.mkdirSync(shim,{recursive:true});fs.writeFileSync(path.join(shim,'xcrun'),`#!/bin/sh\nif [ "$1" = simctl ] && [ "$2" = list ] && [ "$3" = runtimes ]; then echo '{"runtimes":[]}'; exit 0; fi\nexec /usr/bin/xcrun "$@"\n`,{mode:0o755});
for(const starter of ['plain','social']){
 const project=path.resolve('target/nx',starter),source=path.join(project,starter==='plain'?'App.tsx':'app/_layout.tsx'),config=path.join(project,'app.json');
 const js=fs.readFileSync(source,'utf8'),app=fs.readFileSync(config);
 const run=(label,status)=>{const r=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(r.status,status);return JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));};
 try{
  // The final timing cohort leaves the stock native key warm.
  fs.writeFileSync(source,js+`\nthrow new Error('NX_R2_STARTUP_THROW');\n`);const crash=run('startup-throw',1);assert.equal(crash.cache.hit,true);assert.equal(crash.receiptExit,1);
  fs.writeFileSync(source,js);
  for(const scheme of ['FILE','File']){const c=JSON.parse(app);c.expo.ios.googleServicesFile=scheme+':///tmp/nx-external.plist';fs.writeFileSync(config,JSON.stringify(c));const r=run(scheme+'-url',1);assert.match(r.error,/E_WITNESS_NATIVE_COMPAT/);}
  fs.writeFileSync(config,app);
  const absent=run('missing-runtime',0);assert.equal(absent.environmentCondition,'missing-runtime');assert.equal(absent.receiptExit,1);
  const opted=run('opt-out',0);assert.equal(opted.receiptPath,undefined);
 }finally{fs.writeFileSync(source,js);fs.writeFileSync(config,app);}
}
