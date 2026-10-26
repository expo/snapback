// Run the existing four first-account tests with path-only harness adaptations.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,copyFileSync,symlinkSync,existsSync,rmdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(import.meta.dirname,'../../..'),sb=join(repo,'snapback4'),packs=resolve(process.argv[2]??'/tmp/dx14-packs');
const finalNative=resolve(process.argv[3]??'/tmp/dx14-replay/language/final-snapback4');
const base='/tmp/dx14-replay/packed-tutorial';mkdirSync(base,{recursive:true});const cwd=mkdtempSync(join(base,'run-'));
const artifact=join(import.meta.dirname,'packed-tutorial-replays.json'),adaptations=[];const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const run=(exe,args,options={})=>execFileSync(exe,args,{cwd,encoding:'utf8',timeout:240000,stdio:['ignore','pipe','pipe'],...options});
let report;
try{
 // Keep the package wrapper/notices, replace only its ignored native artifact.
 const nativePackage=join(cwd,'native-package');mkdirSync(nativePackage);run('tar',['-xf',join(packs,'snapback4-linux-x64-0.4.43.tgz'),'-C',nativePackage,'--strip-components=1']);
 assert.ok(existsSync(finalNative));copyFileSync(finalNative,join(nativePackage,'snapback4'));run('npm',['pack','--json','--ignore-scripts','--pack-destination',packs],{cwd:nativePackage});
 writeFileSync(join(cwd,'package.json'),'{"private":true,"type":"module"}');
 const files=['snapback4-0.4.43.tgz','snapback4-expo-0.4.43.tgz','snapback4-linux-x64-0.4.43.tgz'];const hashes=Object.fromEntries(files.map(file=>[file,digest(join(packs,file))]));
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--legacy-peer-deps','--omit=optional','--cache',join(cwd,'npm-cache'),...files.map(file=>join(packs,file)),'react@19.3.0']);
 for(const name of ['typescript','expo-modules-core','@types'])symlinkSync(join(sb,'node_modules',name),join(cwd,'node_modules',name),'dir');
 const pkg=join(cwd,'node_modules/snapback4'),native=join(cwd,'node_modules/snapback4-linux-x64/snapback4');assert.equal(digest(native),digest(finalNative));
 let harness=readFileSync(join(sb,'packages/snapback4/test/first-account.test.mjs'),'utf8');
 const replace=(from,to,description)=>{assert.ok(harness.includes(from),description);harness=harness.replaceAll(from,to);adaptations.push(description);};
 const fixture=path=>pathToFileURL(join(sb,'packages/snapback4/test',path)).href;
 replace("'./helpers/server-output.mjs'",JSON.stringify(fixture('helpers/server-output.mjs')),'captureStdout helper uses original repository helper URL');
 replace("'./helpers/wait.mjs'",JSON.stringify(fixture('helpers/wait.mjs')),'wait/hang-budget helper uses original repository helper URL');
 for(const file of ['app.js','auth.js','native.js'])replace(JSON.stringify('../dist/'+file),JSON.stringify(pathToFileURL(join(pkg,'dist',file)).href),'SDK '+file+' import resolves installed tarball dist');
 replace('const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");','const pkg = '+JSON.stringify(pkg)+';','pkg path points to installed tarball; appendix, application scratch dirs and public exports use it');
 replace('resolve(pkg, "../../crates/snapback4-lang/src/guide/feeds.md")',JSON.stringify(join(sb,'crates/snapback4-lang/src/guide/feeds.md')),'Following comparison reads original repository feeds fixture');
 replace('resolve(pkg, "../../apps/chat-expo/package.json")',JSON.stringify(join(sb,'apps/chat-expo/package.json')),'React Native and SecureStore type fixture resolver uses original repository Expo workspace');
 replace('"node_modules/@types/react/index.d.ts"',JSON.stringify(join(sb,'node_modules/@types/react/index.d.ts')),'React root type path uses original repository type fixture');
 replace('"node_modules/@types/react/*"',JSON.stringify(join(sb,'node_modules/@types/react/*')),'React subpath types use original repository type fixture');
 const path=join(cwd,'first-account.test.mjs');writeFileSync(path,harness);
 const {runFile}=await import(pathToFileURL(join(sb,'scripts/run-client-tests.mjs')));let output='';
 const result=await runFile(path,{env:{SNAPBACK4_BIN:native},onOutput:text=>{output+=text;}});
 const reference=readFileSync(join(pkg,'CLIENT-AND-OPERATIONS.md'),'utf8').split('## Your first working account screen')[1];assert.ok(reference);
 const blocks=[...reference.matchAll(/^```(quarry|tsx?)\n([\s\S]*?)^```/gm)].map(match=>({language:match[1],sha256:createHash('sha256').update(match[2]).digest('hex')}));
 report={date:'2026-10-27',runtime:process.version,tarballs:hashes,native:{source:finalNative,sourceSha256:digest(finalNative),installedPackage:'snapback4-linux-x64',installedSha256:digest(native)},harness:'existing packages/snapback4/test/first-account.test.mjs copied with path-only adaptations',adaptations,unchangedApplicationBlocks:blocks,checks:output.split('\n').filter(line=>/^(?:ok \d+ - README|not ok \d+ - README|# first account |# tests |# pass |# fail |# skipped )/.test(line)),ok:result.passed,scope:'All four original tests: public exports and kept intent, Following reader comparison, online/local generated API/password/profile/avatar/reopen/denied/same-id recovery.',limitations:['The Following card comparison and TypeScript/React/React Native/SecureStore compiler infrastructure use the repository fixtures.','SDK/runtime imports and tutorial text use npm-installed tarballs; Expo native module types use the installed Expo source package.','The two runtime device tiers are Node online and the packed Linux process device; no Expo/iOS native execution or publication qualification is claimed.','Application src/client.ts and App.tsx fences are typechecked unchanged by the original harness; runtime assertions use its generated-API flow rather than rendering an Expo screen.'],cleanup:{temporaryApplicationsAndStoresRemoved:true}};
 assert.ok(result.passed,'packed tutorial first-account harness failed; inspect sanitized report');
}catch(error){report??={date:'2026-10-27',ok:false,adaptations,failure:{name:error.name,message:error.code??'packed tutorial replay failed'},cleanup:{temporaryApplicationsAndStoresRemoved:true}};throw error;}
finally{rmSync(cwd,{recursive:true,force:true});try{rmdirSync(base);}catch{}report.cleanup.temporaryRootRemoved=!existsSync(base);writeFileSync(artifact,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({artifact,ok:report.ok,checks:report.checks}));
