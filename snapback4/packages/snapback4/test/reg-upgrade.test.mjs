import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const upgrade=fileURLToPath(new URL('../bin/upgrade.js',import.meta.url));
for(const pm of ['npm','bun','pnpm']) for(const [floor,current,wanted] of [['57.0.30','57.0.22','57.0.30'],['57.0.22','57.0.22','57.0.22'],['57.0.22','57.0.30','57.0.30']]) test(`upgrade aligns Expo ${current} at floor ${floor} and preserves sections with ${pm}`,t=>{
  const cwd=mkdtempSync(join(tmpdir(),'reg-upgrade-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'tools'));mkdirSync(join(cwd,'package'));
  writeFileSync(join(cwd,'package/bundledNativeModules.json'),JSON.stringify({'expo-dev-client':'~57.0.19','expo-modules-core':'~57.0.18',react:'19.2.3','react-native':'0.86.3','expo-router':'~57.0.23','react-native-reanimated':'4.5.1','react-native-worklets':'0.10.1'}));
  const archive=join(cwd,'expo.tgz');
  assert.equal(spawnSync('tar',['-czf',archive,'package'],{cwd,timeout:10000}).status,0);
  const preload=join(cwd,'fetch.mjs');writeFileSync(preload,`import {readFileSync} from 'node:fs';globalThis.fetch=async()=>new Response(readFileSync(${JSON.stringify(archive)}));`);
  writeFileSync(join(cwd,'package.json'),JSON.stringify({packageManager:pm+'@1',dependencies:{snapback4:'0.4.29',expo:current,'expo-router':'57.0.20',react:'19.2.3','react-native':'0.86.3'},devDependencies:{'snapback4-expo':'0.4.29','expo-dev-client':'57.0.18'}}));
  const script=`#!${process.execPath}
const fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
if(['view','info'].includes(args[0]))console.log(JSON.stringify(args[2]==='peerDependencies'?{expo:'>=${floor} <58','expo-modules-core':'>=57.0.23 <58'}:args[2]==='dist.tarball'?'https://example.invalid/expo.tgz':'0.4.31'));
else {const p=JSON.parse(fs.readFileSync('package.json'));if(p.dependencies.expo!=='${wanted}'||p.devDependencies['snapback4-expo']!=='0.4.31')process.exit(8);}
`;
  writeFileSync(join(cwd,'tools',pm),script,{mode:0o755});
  const result=spawnSync(process.execPath,[upgrade,'--to','0.4.31'],{cwd,encoding:'utf8',timeout:20000,env:{...process.env,PATH:join(cwd,'tools')+delimiter+process.env.PATH,NODE_OPTIONS:'--import '+pathToFileURL(preload).href}});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
  assert.equal(pkg.dependencies.expo,wanted);assert.equal(pkg.dependencies['react-native'],'0.86.3');assert.equal(pkg.dependencies['expo-modules-core'],'57.0.23');
  assert.equal(pkg.dependencies['react-native-reanimated'],'4.5.1');assert.equal(pkg.dependencies['react-native-worklets'],'0.10.1');assert.equal(pkg.dependencies['expo-router'],'57.0.23');
  assert.equal(pkg.devDependencies['expo-dev-client'],'57.0.19');assert.equal(pkg.devDependencies['snapback4-expo'],'0.4.31');
  assert.ok(result.stdout.includes(`expo ${current} → ${wanted}`),result.stdout);
  assert.deepEqual(readFileSync(join(cwd,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).at(-1),['install',...(pm==='pnpm'?['--no-frozen-lockfile']:[])]);
});
