import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const upgrade=fileURLToPath(new URL('../bin/upgrade.js',import.meta.url));
for(const pm of ['npm','bun','pnpm']) for(const [floor,current,wanted] of [['57.0.30','57.0.22','57.0.30'],['57.0.22','57.0.22','57.0.22'],['57.0.22','57.0.30','57.0.30']]) test(`upgrade aligns Expo ${current} at floor ${floor} and preserves sections with ${pm}`,t=>{
  const cwd=mkdtempSync(join(tmpdir(),'reg-upgrade-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'tools'));mkdirSync(join(cwd,'package'));
  writeFileSync(join(cwd,'package/bundledNativeModules.json'),JSON.stringify({'expo-sqlite':'~57.0.3','expo-dev-client':'~57.0.19','expo-modules-core':'~57.0.18',react:'19.2.3','react-native':'0.86.3','expo-router':'~57.0.23','react-native-reanimated':'4.5.1','react-native-worklets':'0.10.1'}));
  const archive=join(cwd,'expo.tgz');
  assert.equal(spawnSync('tar',['-czf',archive,'package'],{cwd,timeout:10000}).status,0);
  const preload=join(cwd,'fetch.mjs');writeFileSync(preload,`import {readFileSync} from 'node:fs';globalThis.fetch=async()=>new Response(readFileSync(${JSON.stringify(archive)}));`);
  writeFileSync(join(cwd,'package.json'),JSON.stringify({packageManager:pm+'@1',dependencies:{snapback4:'0.4.29',expo:current,'expo-sqlite':'56.0.0','expo-router':'57.0.20',react:'19.2.3','react-native':'0.86.3'},devDependencies:{'snapback4-expo':'0.4.29','expo-dev-client':'57.0.18'}}));
  const script=`#!${process.execPath}
const fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
if(['view','info'].includes(args[0]))console.log(JSON.stringify(args[2]==='peerDependencies'?{expo:'>=${floor} <58','expo-modules-core':'>=57.0.23 <58'}:args[2]==='dist.tarball'?'https://example.invalid/expo.tgz':'0.4.31'));
else {const p=JSON.parse(fs.readFileSync('package.json'));if(p.dependencies.expo!=='${wanted}'||p.devDependencies['snapback4-expo']!=='0.4.31')process.exit(8);}
`;
  writeFileSync(join(cwd,'tools',pm),script,{mode:0o755});
  const result=spawnSync(process.execPath,[upgrade,'--to','0.4.31'],{cwd,encoding:'utf8',timeout:20000,env:{...process.env,PATH:join(cwd,'tools')+delimiter+process.env.PATH,NODE_OPTIONS:'--import '+pathToFileURL(preload).href}});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
  assert.equal(pkg.dependencies['expo-sqlite'],'57.0.3');assert.equal(pkg.dependencies.expo,wanted);assert.equal(pkg.dependencies['react-native'],'0.86.3');assert.equal(pkg.dependencies['expo-modules-core'],'57.0.23');
  assert.equal(pkg.dependencies['react-native-reanimated'],'4.5.1');assert.equal(pkg.dependencies['react-native-worklets'],'0.10.1');assert.equal(pkg.dependencies['expo-router'],'57.0.23');
  assert.equal(pkg.devDependencies['expo-dev-client'],'57.0.19');assert.equal(pkg.devDependencies['snapback4-expo'],'0.4.31');
  assert.ok(result.stdout.includes(`expo ${current} → ${wanted}`),result.stdout);
  assert.deepEqual(readFileSync(join(cwd,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).at(-1),['install',...(pm==='pnpm'?['--no-frozen-lockfile']:[])]);
});


test('DX4 upgrade narration scans authored scripts and preserves quiet/JSON warning data', async t=>{
  const {upgradeWarnings}=await import('../bin/upgrade-warnings.js');
  const cwd=mkdtempSync(join(tmpdir(),'dx4-upgrade-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'scripts'));mkdirSync(join(cwd,'node_modules'));
  writeFileSync(join(cwd,'scripts/acceptance.mjs'),'await startDev(); fetch(url+"/dev/reset"); fetch(url+"/seed");');
  writeFileSync(join(cwd,'scripts/frontend.ts'),'const headers={"x-snapback-persona":"alice"};');
  writeFileSync(join(cwd,'node_modules/noise.js'),'startDev(); /dev/status');
  const warnings=upgradeWarnings(cwd,'use identity password\n');
  assert.equal(warnings.length,2);assert.match(warnings[0],/CLOSED.*guide staging/);assert.match(warnings[0],/scripts\/acceptance.mjs/);assert.match(warnings[0],/scripts\/frontend.ts/);
  assert.match(warnings[1],/reruns see old rows.*--memory.*scripts\/acceptance.mjs/);assert.ok(warnings.every(w=>!w.includes('noise.js')));
  assert.equal(upgradeWarnings(cwd,'use identity\n').length,1);
});


test('DX4 unreadable migration subdirectories report incomplete scans without aborting',async t=>{
  if (process.getuid?.()===0) {t.skip('root bypasses filesystem read permissions');return;}
  const {upgradeWarnings}=await import('../bin/upgrade-warnings.js');
  const cwd=mkdtempSync(join(tmpdir(),'dx4-upgrade-permissions-'));const denied=join(cwd,'private');mkdirSync(denied);
  writeFileSync(join(cwd,'accept.mjs'),'startDev();');chmodSync(denied,0);
  t.after(()=>{chmodSync(denied,0o700);rmSync(cwd,{recursive:true,force:true});});
  const warnings=upgradeWarnings(cwd,'use identity password');assert.match(warnings.join('\n'),/migration scan incomplete/);assert.match(warnings.join('\n'),/accept.mjs/);
});


test('DX6 warning thresholds require an actual upgrade and ignore refusal probes', async t => {
  const {upgradeWarnings}=await import('../bin/upgrade-warnings.js');
  const cwd=mkdtempSync(join(tmpdir(),'dx6-warnings-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  writeFileSync(join(cwd,'refusal.test.mjs'),'assert.equal((await fetch(url+"/seed")).status,403);');
  writeFileSync(join(cwd,'acceptance.mjs'),'await startDev({args:["--memory"]}); createClient({session:{principal,token}}); const now=await host.advance(10);new Date(now);');
  assert.deepEqual(upgradeWarnings(cwd,'use identity password','0.4.37','0.4.37'),[]);
  assert.deepEqual(upgradeWarnings(cwd,'use identity password',undefined,'0.4.37'),[]);
  const warnings=upgradeWarnings(cwd,'use identity password','0.4.35','0.4.37');
  assert.equal(warnings.length,2,warnings.join('\n'));
  assert.match(warnings[0],/session literals.*acceptance.mjs/);
  assert.match(warnings[1],/advance\(\).*acceptance.mjs/);
  assert.ok(warnings.every(w=>!w.includes('CLOSED')&&!w.includes('startDev() persists')));
});

test('DX6 nonterminal checks acknowledge advice once and fresh projects stay quiet', t => {
  const cwd=mkdtempSync(join(tmpdir(),'dx6-delivery-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'snapback'));mkdirSync(join(cwd,'.snapback4'));
  writeFileSync(join(cwd,'package.json'),JSON.stringify({name:'warning-test'}));
  writeFileSync(join(cwd,'snapback/schema.q'),'use identity password');
  writeFileSync(join(cwd,'acceptance.mjs'),'startDev();');
  const module=pathToFileURL(fileURLToPath(new URL('../bin/upgrade-warnings.js',import.meta.url))).href;
  const check=()=>spawnSync(process.execPath,['--input-type=module','-e',`import {firstCheckWarnings} from ${JSON.stringify(module)};firstCheckWarnings();`],{cwd,encoding:'utf8',timeout:10000});
  assert.equal(check().stderr,'','fresh init has no historical migration');
  rmSync(join(cwd,'.snapback4/project-warnings-version.json'));
  writeFileSync(join(cwd,'.snapback4/runtime-version.json'),JSON.stringify({version:'0.4.32'}));
  const first=check();assert.equal(first.status,0);assert.match(first.stderr,/startDev\(\) persists/);
  assert.equal(check().stderr,'','piped stderr is acknowledged after delivery');
});
