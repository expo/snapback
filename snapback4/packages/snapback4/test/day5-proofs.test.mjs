import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {testSource} from '../dist/proof.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;

test('quiet upgrade retains project actions and exposes package-manager failures',t=>{
  const cwd=mkdtempSync(join(tmpdir(),'sb4-day5-upgrade-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const write=(file,text)=>{mkdirSync(join(cwd,file,'..'),{recursive:true});writeFileSync(join(cwd,file),text);};
  write('package.json',JSON.stringify({name:'quiet-project',packageManager:'npm@10',dependencies:{snapback4:version}}));
  write('node_modules/snapback4/package.json',JSON.stringify({name:'snapback4',version,exports:{'./bin-path':'./dist/bin-path.js'}}));
  write('node_modules/snapback4/dist/bin-path.js','');
  write('node_modules/snapback4/CHANGELOG.md',`## ${version}\nLOUD HISTORY\n`);
  write('tools/npm',`#!${process.execPath}\nif(process.argv[2]==='view'){console.log(JSON.stringify('${version}'));}else{console.log('INSTALL NOISE');if(process.env.FAIL_INSTALL){console.log('actual stdout install error');console.error('actual install error');process.exit(17)}}\n`);
  const {chmodSync}=process.getBuiltinModule('node:fs');chmodSync(join(cwd,'tools/npm'),0o755);
  const run=(fail,json=false)=>spawnSync(binary,['upgrade','--quiet','--to',version,...(json?['--json']:[])],{cwd,encoding:'utf8',timeout:60000,env:{...process.env,PATH:join(cwd,'tools')+':'+process.env.PATH,...(fail?{FAIL_INSTALL:'1'}:{})}});
  const result=run(false);assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/project quiet-project: snapback4@/);assert.doesNotMatch(result.stdout+result.stderr,/INSTALL NOISE|LOUD HISTORY|upgrade plan:/);
  const failed=run(true);assert.notEqual(failed.status,0);assert.match(failed.stderr,/actual install error/);assert.match(failed.stdout,/actual stdout install error/);assert.match(failed.stderr,/E_UPGRADE/);
  const failedJson=run(true,true);assert.equal(JSON.parse(failedJson.stdout).ok,false);assert.match(failedJson.stderr,/actual stdout install error/);
});

test('testSource fixtureOnly explicitly reaches the CLI without conflating query probes and cases',async t=>{
  const cwd=mkdtempSync(join(tmpdir(),'sb4-day5-fixture-only-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const previous=process.env.SNAPBACK4_BIN;t.after(()=>{if(previous===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=previous;});
  const fake=join(cwd,'fake.mjs');writeFileSync(fake,`#!${process.execPath}\nif(!process.argv.includes('--fixture-only')){console.error('fixture-only flag missing');process.exit(1)}console.log('SNAPBACK4_TEST_CASES {"run":0,"skipped":0}');\n`,{mode:0o755});
  process.env.SNAPBACK4_BIN=fake;
  const result=await testSource('versions/v1',{cwd,fixtureOnly:true});assert.equal(result.casesRun,0);
});

test('quiet JSON upgrade retains stdout-only post-check refusals on stderr',t=>{
  const cwd=mkdtempSync(join(tmpdir(),'sb4-day5-upgrade-check-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const write=(file,text,mode)=>{mkdirSync(join(cwd,file,'..'),{recursive:true});writeFileSync(join(cwd,file),text,{mode});};
  write('package.json',JSON.stringify({name:'check-refusal',packageManager:'npm@10',dependencies:{snapback4:version}}));
  write('snapback/schema.q','query alive():\n  return true\n');
  write('node_modules/snapback4/package.json',JSON.stringify({name:'snapback4',version,exports:{'./bin-path':'./dist/bin-path.js'}}));
  write('node_modules/snapback4/dist/bin-path.js','');
  write('node_modules/snapback4/bin/snapback4.js',"console.log('E_DEVICE_BROKEN: stdout-only diagnostic'); process.exit(19);\n");
  write('tools/npm',`#!${process.execPath}\nif(process.argv[2]==='view')console.log(JSON.stringify('${version}'));\n`,0o755);
  const result=spawnSync(binary,['upgrade','--quiet','--to',version,'--json'],{cwd,encoding:'utf8',timeout:60000,env:{...process.env,PATH:join(cwd,'tools')+':'+process.env.PATH}});
  assert.notEqual(result.status,0);assert.equal(JSON.parse(result.stdout).ok,false);
  assert.match(result.stderr,/E_DEVICE_BROKEN: stdout-only diagnostic/);
  assert.match(result.stderr,/post-upgrade check refused/);
});

test('relocated starter qualifier uses an explicitly transported generated proof',async t=>{
  const cwd=mkdtempSync(join(tmpdir(),'sb4-day5-relocated-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const app=join(cwd,'app');mkdirSync(app);
  const initialized=spawnSync(binary,['init','--web'],{cwd:app,encoding:'utf8',timeout:60000});
  assert.equal(initialized.status,0,initialized.stdout+initialized.stderr);
  const proofPath=join(app,'scripts/frontend-proof.mjs'),template=readFileSync(proofPath,'utf8');
  rmSync(proofPath);writeFileSync(join(app,'src/App.tsx'),'function Home(){return <FirstRead />;}\n');
  const isolated=join(cwd,'proof','starters.mjs');mkdirSync(join(cwd,'proof'));
  copyFileSync(join(root,'scripts/publication-starters.mjs'),isolated);
  const {installCustomWriteScenario}=await import(pathToFileURL(isolated));
  assert.throws(()=>installCustomWriteScenario(app,'web'),/ENOENT/);
  installCustomWriteScenario(app,'web',template);
  assert.match(readFileSync(proofPath,'utf8'),/const within = page.locator\("#proof-rows"\);/);
});
