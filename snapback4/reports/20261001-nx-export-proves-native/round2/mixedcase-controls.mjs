import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2');
for(const starter of ['plain','social']){
 const config=path.resolve('target/nx',starter,'app.json'),original=fs.readFileSync(config),label='mixedcase-url',file=path.join(report,`${starter}-${label}.json`);assert.equal(fs.existsSync(file),false);
 try{const c=JSON.parse(original);c.expo.ios.googleServicesFile='File:///tmp/nx-external.plist';fs.writeFileSync(config,JSON.stringify(c));
  const child=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(child.status,1);
  const row=JSON.parse(fs.readFileSync(file));assert.equal(row.label,label);assert.equal(row.status,1);assert.match(row.error,/E_WITNESS_NATIVE_COMPAT/);
 }finally{fs.writeFileSync(config,original);}
}
