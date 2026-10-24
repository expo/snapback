// Run every DX10 guide block from SDK/platform tarballs with no binary override.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),cwd=mkdtempSync(join(tmpdir(),'dx10-packed-native-'));
const env={...process.env,SNAPBACK4_BIN:''};
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const output={platform:process.platform,arch:process.arch,steps:[]};
try{
 assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
 const packs=join(cwd,'packs');mkdirSync(packs);
 const platform=join(cwd,'platform');mkdirSync(platform);
 copyFileSync(join(root,'packages/snapback4-linux-x64/package.json'),join(platform,'package.json'));
 copyFileSync(join(root,'target/debug/snapback4'),join(platform,'snapback4'));chmodSync(join(platform,'snapback4'),0o755);
 output.binarySha256=digest(join(platform,'snapback4'));
 const pack=dir=>{const result=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',packs],{cwd:dir,env,encoding:'utf8'}))[0];return join(packs,result.filename);};
 const sdk=pack(join(root,'packages/snapback4')),native=pack(platform);
 output.sdkSha256=digest(sdk);output.nativeTarballSha256=digest(native);
 const modules=join(cwd,'node_modules');mkdirSync(modules);
 for(const [name,tar] of [['snapback4',sdk],['snapback4-linux-x64',native]]){const path=join(modules,name);mkdirSync(path);execFileSync('tar',['-xzf',tar,'--strip-components=1','-C',path]);}
 mkdirSync(join(modules,'.bin'));symlinkSync('../snapback4/bin/snapback4.js',join(modules,'.bin/snapback4'));
 const kit=await import(pathToFileURL(join(modules,'snapback4/dist/proof.js')));
 const resolver=await import(pathToFileURL(join(modules,'snapback4/dist/resolve-binary.js')));
 assert.equal(resolver.resolveBinary(env),join(modules,'snapback4-linux-x64/snapback4'));
 const schema=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)```/)[1];
 mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),schema);
 await kit.deploy('production','snapback',{cwd,env});
 mkdirSync(join(cwd,'versions/v2'),{recursive:true});writeFileSync(join(cwd,'versions/v2/schema.q'),schema.replace('body: text 1..200','body: text 1..300'));
 const text=readFileSync(join(root,'crates/snapback4-lang/src/guide/testing.md'),'utf8');
 const blocks=[...text.slice(text.indexOf('## Check an npm serve script')).matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]);assert.equal(blocks.length,3);
 for(const [i,source] of blocks.slice(1).entries()){
  const name=`stage-${i}.mjs`;writeFileSync(join(cwd,name),source);
  const result=await kit.command(process.execPath,[name],{cwd,env,timeoutMs:120000,secret:true});assert.equal(result.code,0);output.steps.push({step:name,exit:result.code});
 }
 writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'prod:serve':'node serve.mjs'}}));
 writeFileSync(join(cwd,'serve.mjs'),`import {startServe} from 'snapback4/proof';const host=await startServe('production');console.log(JSON.stringify({backendUrl:host.url}));const hold=setInterval(()=>{},1000);process.once('SIGTERM',async()=>{await host.stop();clearInterval(hold)});`);
 writeFileSync(join(cwd,'check.mjs'),blocks[0]);
 for(const [step,binary,args] of [['serveCheck JS block',process.execPath,['check.mjs']],['npx guide command','npx',['snapback4','serve-check','--deployment','production','--script','prod:serve']]]){
  const result=await kit.command(binary,args,{cwd,env,timeoutMs:60000,secret:true});assert.equal(result.code,0);const report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.ok(report.upMs>=30000);output.steps.push({step,exit:result.code,report});
 }
 output.ok=true;
}finally{
 rmSync(cwd,{recursive:true,force:true});output.scratchRemoved=true;
 writeFileSync(join(import.meta.dirname,'packed-native-recipes.json'),JSON.stringify(output,null,2)+'\n');
}
