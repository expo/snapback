// Run from snapback4/. Reproduce the original full-suite fixture on isolated client copies.
// Pin the test before the round-3 correction; never replace the live dist during a suite.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import ts from 'typescript';
const root=process.cwd(), evidence=path.join(root,'reports/20260928-rg-receipts-at-scale/round3');
for (const mode of ['current','main-local']) {
 const copy=path.join(root,'target/rg-round3-maintained',mode);
 const pkg=path.join(copy,'packages/snapback4');
 fs.mkdirSync(path.join(pkg,'test'),{recursive:true});
 fs.cpSync('packages/snapback4/dist',path.join(pkg,'dist'),{recursive:true});
 fs.copyFileSync('packages/snapback4/package.json',path.join(pkg,'package.json'));
 fs.mkdirSync(path.join(pkg,'src'),{recursive:true});
 fs.cpSync('packages/snapback4/src/wasm',path.join(pkg,'src/wasm'),{recursive:true});
 fs.mkdirSync(path.join(copy,'crates/snapback4-lang/tests/fixtures'),{recursive:true});
 fs.copyFileSync('crates/snapback4-lang/tests/fixtures/maintained-columns.q',path.join(copy,'crates/snapback4-lang/tests/fixtures/maintained-columns.q'));
 if(!fs.existsSync(path.join(copy,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(copy,'node_modules'));
 if(mode==='main-local') {
  const source=execFileSync('git',['show','a745b110f:snapback4/packages/snapback4/src/local.ts'],{encoding:'utf8'});
  const built=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,rewriteRelativeImportExtensions:true}}).outputText;
  fs.writeFileSync(path.join(pkg,'dist/local.js'),built);
 }
 let test=execFileSync('git',['show','86fd998e8c6a111e3558411d006c20ec87ab2832:snapback4/packages/snapback4/test/maintained-columns.test.mjs'],{encoding:'utf8'});
 test=test.replace('assert.deepEqual(triple(interrupted),triple(deliveredParent),', 'console.log(JSON.stringify({family, interruptedPage, interrupted, state:await core.call({op:"sync_state",capture:false}), queued:await core.call({op:"queued"})}));\n  assert.deepEqual(triple(interrupted),triple(deliveredParent),');
 fs.writeFileSync(path.join(pkg,'test/maintained-columns.test.mjs'),test);
 const log=fs.openSync(path.join(evidence,`maintained-columns-${mode}.log`),'w');
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap',path.join(pkg,'test/maintained-columns.test.mjs')],{env:{...process.env,SNAPBACK4_BIN:path.join(root,'target/debug/snapback4')},stdio:['ignore',log,log]});
 fs.closeSync(log);console.log(mode,result.status);
}
